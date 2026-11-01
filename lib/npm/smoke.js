/**
 * 发布前冒烟：证明「这个包**装得上、加载得了、跑得起来**」——而不是只看 `npm publish --dry-run`
 * 的文件清单。
 *
 * 为什么需要（真实教训）：干跑只告诉你「哪些文件会进包」，不告诉你「装上后能不能 import」。
 *   我们踩过的两类坑都在干跑里看不见：
 *     · 依赖漏声明 / 子路径依赖缺失（`js-yaml`、`tree-sitter-wasms/out/*.wasm`）——装完才 ERR_MODULE_NOT_FOUND；
 *     · `exports` 收窄后内部子路径 `import('pkg/lib/x.js')` 直接 ERR_PACKAGE_PATH_NOT_EXPORTED，
 *       而公开面（`.` / `./audit` / `./client`）其实需要逐个 have-to-import 才算验过。
 *
 * 做法（全部在临时目录里，不污染仓库）：
 *   ① `npm pack` 出真实 tarball；② 建一个干净 consumer 工程并 `npm i <tgz>`（走真实依赖解析）；
 *   ③ 按 package.json 的 `exports` 公开面逐个 import；④ 逐个解析声明的 dependencies；
 *   ⑤ 清理临时目录，回执里给出每步结果与失败原因。
 *
 * 不做的事：不跑单测、不启宿主。它只回答「包本身能不能被正常消费」；
 *   「宿主能不能加载插件」属于隔离实例验证（test_env）的范畴，成本高得多，不做进默认门禁。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runNpm } from './registry.js';
import { npmArgs } from './npmrc.js';

const SMOKE_TIMEOUT_MS = 240000;

/**
 * 由 package.json 推导「必须能 import 的公开面」。
 *   exports 存对象时取所有 key（跳过 './package.json'——它不是模块，只能被读取）；
 *   没有 exports 时退化为包名根入口。
 */
/** 浏览器端入口（如 `./client`）：只能在宿主前端环境加载，Node 里 import 必然失败，冒烟时跳过。 */
export function isBrowserEntry(key) {
  // `./client`、`./client/index`、`./lib/client.js` 都算浏览器端入口
  return /(^|\/)client(\/|\.js)?(\/|$)|browser/i.test(String(key).replace(/^\.\//, ''));
}

export function entrySpecsOf(pkg) {
  const name = String(pkg?.name || '');
  if (!name) return [];
  const exp = pkg.exports;
  if (typeof exp === 'string') return [name];
  if (exp && typeof exp === 'object') {
    const subs = Object.keys(exp)
      .filter((k) => k === '.' || k.startsWith('./'))
      .filter((k) => k !== './package.json')
      .map((k) => (k === '.' ? name : `${name}/${k.slice(2)}`));
    return subs.length ? subs : [name];
  }
  return [name];
}

/** 冒烟主流程。 */
export async function smokeTestPackage({ dir = '', workspaceRoot = '', registry = '', timeoutMs = SMOKE_TIMEOUT_MS } = {}) {
  const steps = [];
  const failures = [];
  let tmp = '';
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const name = String(pkg.name || '');
    const version = String(pkg.version || '');
    if (!name) return { ok: false, steps, failures: ['package.json 缺 name'] };

    tmp = mkdtempSync(join(tmpdir(), 'dshgp-smoke-'));
    // ① 打真实 tarball
    const packDest = join(tmp, 'pack');
    const consumer = join(tmp, 'consumer');
    mkdirSync(packDest, { recursive: true });
    mkdirSync(consumer, { recursive: true });
    const packArgs = ['pack', '--pack-destination', packDest, ...npmArgs({ registry })];
    const packed = runNpm(packArgs, { cwd: dir, timeoutMs, env: { NO_UPDATE_NOTIFIER: '1' } });
    if (!packed.ok) {
      failures.push(`npm pack 失败：${String(packed.error || packed.stderr || '').slice(0, 300)}`);
      return { ok: false, steps, failures };
    }
    const tgzName = readdirSync(packDest).find((f) => f.endsWith('.tgz'));
    if (!tgzName) { failures.push('npm pack 没产出 tarball'); return { ok: false, steps, failures }; }
    const tgz = join(packDest, tgzName);
    const bytes = statSync(tgz).size;
    steps.push({ step: 'pack', ok: true, tgz: tgzName, bytes });

    // ② 干净 consumer 里真实安装
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'smoke-consumer', private: true, version: '0.0.0' }, null, 2), 'utf8');
    const installed = runNpm(['install', '--no-audit', '--no-fund', tgz], { cwd: consumer, timeoutMs, env: { NO_UPDATE_NOTIFIER: '1' } });
    if (!installed.ok) {
      failures.push(`npm install <tgz> 失败：${String(installed.error || installed.stderr || '').slice(0, 400)}`);
      return { ok: false, steps, failures, tgz: tgzName, bytes };
    }
    steps.push({ step: 'install', ok: true });

    // ③ 公开面逐个 import + ④ 依赖逐个解析（同一进程里做，省一次启动）
    const probe = join(consumer, 'probe.mjs');
    const deps = Object.keys(pkg.dependencies || {});
    // nodeEntries = 可在 Node 里加载的公开面；browserEntries = 仅前端可加载（跳过但如实列出）
    const nodeEntries = [];
    const browserEntries = [];
    for (const key of Object.keys(pkg.exports && typeof pkg.exports === 'object' ? pkg.exports : { '.': null })) {
      const spec = key === '.' ? name : `${name}/${key.slice(2)}`;
      if (key !== '.' && isBrowserEntry(key)) browserEntries.push(spec);
      else if (!key.startsWith('./') || key === './package.json') continue;
      else nodeEntries.push(spec);
    }
    writeFileSync(probe, [
      'import { createRequire } from "node:module";',
      'import { existsSync } from "node:fs";',
      'import { join } from "node:path";',
      `const specs = ${JSON.stringify(nodeEntries)};`,
      `const deps = ${JSON.stringify(deps)};`,
      'const out = { entries: [], deps: [] };',
      'for (const s of specs) {',
      '  try { await import(s); out.entries.push({ spec: s, ok: true }); }',
      '  catch (e) { out.entries.push({ spec: s, ok: false, error: String(e.code || "") + " " + String(e.message || e).slice(0, 200) }); }',
      '}',
      'const req = createRequire(import.meta.url);',
      'for (const d of deps) {',
      '  // 判据是「**依赖真的装进来了**」，不是「它的 main 能解析」：',
      '  //   有些包只发布子路径（如 tree-sitter-wasms 的 main 指向未发布目录，但 out/*.wasm 可用），',
      '  //   用 require.resolve(包名) 判会把正常包判成缺依赖。',
      '  const installed = existsSync(join(process.cwd(), "node_modules", d, "package.json"));',
      '  if (!installed) { out.deps.push({ dep: d, ok: false, error: "未安装（依赖闭包不全）" }); continue; }',
      '  if (d.startsWith("node:")) { out.deps.push({ dep: d, ok: true }); continue; }',
      '  try { req.resolve(d); out.deps.push({ dep: d, ok: true }); }',
      '  catch (e) { out.deps.push({ dep: d, ok: true, warn: `已安装，但 bare 名不可解析（可能只导出子路径）：${e.code || ""}` }); }',
      '}',
      'console.log(JSON.stringify(out));',
    ].join('\n'), 'utf8');
    // 直接用 node 跑探针脚本：比 `npm exec` 稳（后者在部分版本会给 stdout 加包装/额外行）
    let parsed = null;
    try {
      const { execFileSync } = await import('node:child_process');
      const stdout = execFileSync(process.execPath, [probe], { cwd: consumer, encoding: 'utf8', timeout: timeoutMs });
      parsed = JSON.parse(String(stdout).trim().split('\n').pop());
    } catch (e) {
      failures.push(`加载探针执行失败：${String(e.message || e).slice(0, 300)}`);
      return { ok: false, steps, failures, tgz: tgzName, bytes };
    }
    for (const it of parsed.entries || []) {
      if (it.ok) steps.push({ step: 'import', spec: it.spec, ok: true });
      else { steps.push({ step: 'import', spec: it.spec, ok: false }); failures.push(`公开面 import 失败：${it.spec} → ${it.error}`); }
    }
    for (const it of parsed.deps || []) {
      if (it.ok) steps.push({ step: 'dep', dep: it.dep, ok: true });
      else { steps.push({ step: 'dep', dep: it.dep, ok: false }); failures.push(`依赖解析失败：${it.dep} → ${it.error}`); }
    }
    return {
      ok: failures.length === 0,
      tgz: tgzName, bytes,
      entries: nodeEntries.length + browserEntries.length,
      deps: deps.length,
      // 浏览器端入口（如 ./client）不在 Node 里 import，如实列出而不是静默当通过
      browserEntries,
      steps, failures,
      hint: failures.length ? '包本身消费不了，先修再发' : '装得上、公开面能加载、依赖闭包完整',
    };
  } catch (e) {
    failures.push(`冒烟异常：${String(e?.message || e).slice(0, 300)}`);
    return { ok: false, steps, failures };
  } finally {
    if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ } }
  }
}
