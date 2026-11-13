/**
 * test-npm-install.mjs —— 同族测试合并（test-npm-install.mjs · test-npm-local-registry.mjs · test-npm-smoke.mjs · test-npm-enobufs.mjs · test-npm-pack-parse.mjs · test-npm-cli-package.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { buildInstallArgs, installPackages, installingKeys, validateDest, validatePackageNames } from '../../lib/npm/install.js';
import { startLocalRegistry, runLocalPreview } from '../../lib/npm/local-registry.js';
import { packDryRun, parsePackOutput } from '../../lib/npm/publish.js';
import { runNpm, resolveNpmBin, NPM_TIMEOUT_MS } from '../../lib/npm/registry.js';
import { entrySpecsOf, isBrowserEntry, classifyPackageForm } from '../../lib/npm/smoke.js';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// ── 原 test-npm-install.mjs ──
{
  /**
   * Step 3 回归：安装参数与安全默认（纯函数）+ 假 npm 端到端（PATH 注入，不真装包）。
   *
   * 重点断言：**默认带 `--ignore-scripts`**（装包不执行 postinstall）；显式关闭时才不带；
   *   全局走 `-g`、指定目录走 `--prefix`；包名校验挡住选项注入与路径穿越。
   */


  test('[npm-install] validatePackageNames：正常包名/scope/带 tag 通过；选项注入与穿越被拒', () => {
    assert.deepEqual(validatePackageNames(['left-pad']).names, ['left-pad']);
    assert.deepEqual(validatePackageNames(['@scope/pkg', 'pkg@next']).names, ['@scope/pkg', 'pkg@next']);
    assert.equal(validatePackageNames(['--registry=http://evil']).ok, false);
    assert.match(validatePackageNames(['-g']).error, /不能以 - 开头/);
    assert.equal(validatePackageNames(['../etc/passwd']).ok, false);
    assert.equal(validatePackageNames([]).ok, false);
  });

  test('[npm-install] validateDest：不存在的目录 / 非目录 被拒', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-dest-'));
    assert.equal(validateDest(dir).ok, true);
    assert.equal(validateDest(join(dir, 'nope')).ok, false);
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'x', 'utf8');
    assert.equal(validateDest(file).ok, false);
    assert.equal(validateDest('').ok, false);
  });

  test('[npm-install] buildInstallArgs：默认 --ignore-scripts；全局 -g；指定目录 --prefix', () => {
    const d = buildInstallArgs({ names: ['left-pad'], dest: '/tmp/x' });
    assert.deepEqual(d.slice(0, 2), ['install', 'left-pad']);
    assert.ok(d.includes('--ignore-scripts'), '默认必须带 --ignore-scripts（不执行 postinstall）');
    assert.deepEqual(d.slice(d.indexOf('--prefix'), d.indexOf('--prefix') + 2), ['--prefix', '/tmp/x']);

    const noScripts = buildInstallArgs({ names: ['a'], dest: '/tmp/x', ignoreScripts: false });
    assert.equal(noScripts.includes('--ignore-scripts'), false, '显式关闭时不应带该开关');

    const g = buildInstallArgs({ names: ['a'], global: true });
    assert.ok(g.includes('-g'));
    assert.equal(g.includes('--prefix'), false, '全局安装不应同时给 --prefix');
  });

  test('[npm-install] installPackages（假 npm）：参数落盘可核对，日志留痕，非法入参不入锁', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fakenpm-install-'));
    const fake = join(dir, 'npm');
    const argFile = join(dir, 'args.txt');
    // 假 npm：把参数写到文件后成功退出（绝不真装包）
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${argFile}\nexit 0\n`, 'utf8');
    chmodSync(fake, 0o755);
    const dest = mkdtempSync(join(tmpdir(), 'dsh-install-dest-'));

    const r = installPackages({
      names: ['left-pad'], dest, registry: 'https://registry.npmjs.org/',
      workspaceRoot: dir, timeoutMs: 20_000, env: { PATH: `${dir}:${process.env.PATH}` },
    });
    assert.equal(r.ok, true, `假 npm 应成功，实得：${r.error}`);
    const args = readFileSync(argFile, 'utf8').trim().split('\n');
    assert.ok(args.includes('install') && args.includes('left-pad'), '应调用 npm install left-pad');
    assert.ok(args.includes('--ignore-scripts'), '默认安全开关必须生效');
    assert.ok(args.includes('--userconfig'), '必须走我们自己的 npmrc');
    assert.ok(r.logPath && r.logPath.endsWith('npm-install.log'), `应留痕日志，实得 ${r.logPath}`);

    // 锁语义：非法入参不会留下锁记录
    installPackages({ names: ['--bad'], dest, workspaceRoot: dir });
    assert.deepEqual(installingKeys(), [], '结束后不应残留进行中的锁');
  });
}

// ── 原 test-npm-local-registry.mjs ──
{
  /**
   * 本地 npm registry 协议测试（不调 npm CLI、不联网）。
   *
   * 为什么要测协议层：本地 registry 的用途是「发版前把 publish→install 真跑一遍」，
   *   它一旦有 bug（packument 缺字段、版本冲突没拦、tarball 路径不对），彩排就会给人假信心。
   *   所以这里直接按 npm 客户端的行为打三条路由：
   *     ① PUT  /:name          → 201；同版本重复 PUT → 403（与真 registry 语义一致）
   *     ② GET  /:name          → packument 含 dist-tags / versions / dist.tarball
   *     ③ GET  /:name/-/:file  → tarball 字节原样返回
   */


  const MANIFEST = { name: 'demo-pkg', version: '1.2.3', description: 'demo' };

  /** 造一份 npm publish 的请求体（_attachments 里是 base64 tarball）。 */
  function publishBody({ name = 'demo-pkg', version = '1.2.3', tag = 'beta', bytes = 'FAKE-TARBALL' } = {}) {
    const filename = `${name}-${version}.tgz`;
    return {
      _id: name,
      name,
      'dist-tags': { [tag]: version },
      versions: { [version]: { ...MANIFEST, name, version, dist: { shasum: 'x', integrity: 'y' } } },
      _attachments: { [filename]: { content_type: 'application/octet-stream', data: Buffer.from(bytes).toString('base64'), length: bytes.length } },
    };
  }

  async function withRegistry(fn) {
    const reg = await startLocalRegistry();
    try { return await fn(reg); } finally { await reg.close(); }
  }

  test('[npm-local-registry] PUT 收包 → 201，且 packument 可读', () => withRegistry(async (reg) => {
    const put = await fetch(`${reg.url}/demo-pkg`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(publishBody()),
    });
    assert.equal(put.status, 201);
    const doc = await (await fetch(`${reg.url}/demo-pkg`)).json();
    assert.equal(doc.name, 'demo-pkg');
    assert.deepEqual(doc['dist-tags'], { beta: '1.2.3' });
    assert.deepEqual(Object.keys(doc.versions), ['1.2.3']);
    assert.match(doc.versions['1.2.3'].dist.tarball, /\/demo-pkg\/-\/demo-pkg-1\.2\.3\.tgz$/);
  }));

  test('[npm-local-registry] 同版本重复 PUT → 403（与真 registry 一致，彩排才能发现"忘了升版本"）', () => withRegistry(async (reg) => {
    await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody()) });
    const again = await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody()) });
    assert.equal(again.status, 403);
    const body = await again.json();
    assert.match(String(body.error), /existing version/);
  }));

  test('[npm-local-registry] 新版本可以叠加，dist-tags 可切换', () => withRegistry(async (reg) => {
    await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody({ version: '1.2.3', tag: 'beta' })) });
    await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody({ version: '1.2.4', tag: 'latest' })) });
    const doc = await (await fetch(`${reg.url}/demo-pkg`)).json();
    assert.deepEqual(Object.keys(doc.versions).sort(), ['1.2.3', '1.2.4']);
    assert.equal(doc['dist-tags'].beta, '1.2.3');
    assert.equal(doc['dist-tags'].latest, '1.2.4');
  }));

  test('[npm-local-registry] tarball 原样可下载（字节一致）', () => withRegistry(async (reg) => {
    await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody({ bytes: 'HELLO-TARBALL-BYTES' })) });
    const doc = await (await fetch(`${reg.url}/demo-pkg`)).json();
    const url = doc.versions['1.2.3'].dist.tarball;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    assert.equal(buf.toString('utf8'), 'HELLO-TARBALL-BYTES');
  }));

  test('[npm-local-registry] 不存在的 tarball → 404', () => withRegistry(async (reg) => {
    const r = await fetch(`${reg.url}/demo-pkg/-/nope.tgz`);
    assert.equal(r.status, 404);
  }));

  test('[npm-local-registry] -/ping 健康检查', () => withRegistry(async (reg) => {
    const r = await fetch(`${reg.url}/-/ping`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  }));
}

// ── 原 test-npm-smoke.mjs ──
{
  /**
   * 发布前冒烟的门禁逻辑测试（不触网、不装包）。
   *
   * 背景：`npm publish --dry-run` 只回答「哪些文件会进包」，不回答「装上能不能用」。
   *   我们真实踩过的两类问题都藏在那一步之后：依赖漏声明/子路径依赖缺失、
   *   `exports` 收窄后内部路径 `import('pkg/lib/x.js')` 直接 ERR_PACKAGE_PATH_NOT_EXPORTED。
   *   故发布前要真装一次并**按公开面逐个 import**。
   *
   * 本测试锁「公开面推导」这条规则：
   *   · exports 对象的每个子路径都要验（`.` / `./audit`），但 `./package.json` 除外（只能读取）；
   *   · 浏览器端入口（如 `./client`）在 Node 里 import 必然失败，必须识别出来跳过而不是当失败；
   *   · 没有 exports 时退化为包名根入口。
   */


  test('[npm-smoke] entrySpecsOf：exports 对象 → 逐个子路径（跳过 ./package.json）', () => {
    const pkg = {
      name: 'demo',
      exports: { '.': './lib/index.js', './audit': './lib/audit/public.js', './package.json': './package.json' },
    };
    assert.deepEqual(entrySpecsOf(pkg), ['demo', 'demo/audit']);
  });

  test('[npm-smoke] entrySpecsOf：exports 是字符串 → 只有根入口', () => {
    assert.deepEqual(entrySpecsOf({ name: 'demo', exports: './index.js' }), ['demo']);
  });

  test('[npm-smoke] entrySpecsOf：无 exports → 根入口', () => {
    assert.deepEqual(entrySpecsOf({ name: 'demo', main: './index.js' }), ['demo']);
  });

  test('[npm-smoke] entrySpecsOf：没有 name → 空（冒烟会直接判失败）', () => {
    assert.deepEqual(entrySpecsOf({}), []);
  });

  test('[npm-smoke] isBrowserEntry：client/browser 类入口要跳过（Node 里必然 window is not defined）', () => {
    assert.equal(isBrowserEntry('./client'), true);
    assert.equal(isBrowserEntry('./client/index'), true);
    assert.equal(isBrowserEntry('./browser'), true);
    assert.equal(isBrowserEntry('./audit'), false);
    assert.equal(isBrowserEntry('./lib/client.js'), true);
    assert.equal(isBrowserEntry('.'), false);
  });
}

// ── 原 test-npm-enobufs.mjs ──
{
  /**
   * npm 执行器回归测试：ENOBUFS（子进程输出超过 maxBuffer）必须**自动放大缓冲重试一次** ✓。
   *
   * 历史现象（用户实测）：`npm 调用失败（…/npm）：spawnSync … ENOBUFS` ——
   *   真因是 npm 跑在了错误的 cwd（继承宿主 cwd，那里有 package.json ⇒ npm pack 输出 2.1MB）
   *   且缓冲上限不够；cwd 已在 lib/npm/publish.js 显式传（pack/publish 都以目标包为 cwd ✓），
   *   本测试锁的是**第二道防线**：即便输出真超限，也不该把一句 ENOBUFS 直接甩给上层 ✗。
   *
   * 怎么做到确定性：runNpm 支持注入 maxBuffer ✓ ⇒ 传 1 字节 ⇒ 首次必然 ENOBUFS ⇒
   *   若重试生效则整体成功（ok=true）✓；不生效则 ok=false 且 error 含 ENOBUFS ✗。
   */


  test('[npm-enobufs] ENOBUFS 自动重试：注入 1 字节缓冲也应最终成功', async () => {
    const r = await runNpm(['--version'], { timeoutMs: 120000, maxBuffer: 1 });
    assert.equal(r.ok, true,
      `1 字节缓冲必然先 ENOBUFS，重试放大后应成功——实得 ok=${r.ok} error=${String(r.error || '').slice(0, 120)}`);
    assert.match(String(r.stdout || ''), /\d+\.\d+/, '应拿到 npm 版本号');
    assert.ok(!/ENOBUFS/.test(String(r.error || '')), '成功路径不应残留 ENOBUFS 错误');
  });

  test('[npm-enobufs] 默认缓冲路径不受影响（不注入 maxBuffer）', async () => {
    const r = await runNpm(['--version'], { timeoutMs: 120000 });
    assert.equal(r.ok, true);
    assert.match(String(r.stdout || ''), /\d+\.\d+/);
  });

  test('[npm-enobufs] 返回结构稳定：bin / code / stdout / stderr 都在', async () => {
    const r = await runNpm(['--version'], { timeoutMs: 120000 });
    assert.equal(typeof r.bin, 'string');
    assert.equal(r.bin, resolveNpmBin({ env: process.env }) || r.bin);
    assert.equal(typeof r.code, 'number');
    assert.equal(typeof r.stdout, 'string');
    assert.equal(typeof r.stderr, 'string');
    assert.ok(NPM_TIMEOUT_MS > 0);
  });
}

// ── 原 test-npm-pack-parse.mjs ──
{
  /**
   * `npm pack --json` 输出解析（2026-11-05，外部会话实测反馈）。
   *
   * 背景：`npm pack` 会先跑包里的 `prepack` 脚本，脚本的 stdout 排在 JSON 之前。
   *   历史实现用 `text.search(/[[{]/)` 找「第一个 [ 或 {」，遇到 prepack 首行
   *   `[build] lib/client.js …` 就切错位置 ⇒ JSON.parse 抛错 ⇒ 被当成「清单为空」，
   *   好包被判死（真实 56 个文件）。**与 files 字段、stderr 都无关。**
   *
   * 判据：遍历每个 `[`/`{` 位置逐个试解析，第一个解析成功且不是标量的即为结果。
   *   本测试锁「任意前置污染都能解出来」，并用真实 npm pack 做端到端对照。
   */


  const CLEAN = JSON.stringify([{ id: 'demo@1.0.0', filename: 'demo-1.0.0.tgz', size: 1234, files: [{ path: 'package.json' }, { path: 'index.js' }] }]);

  test('[npm-pack-parse] parsePackOutput：干净 JSON 直接解析', () => {
    const r = parsePackOutput(CLEAN);
    assert.equal(r.ok, true);
    assert.equal(Array.isArray(r.value), true);
    assert.equal(r.value[0].files.length, 2);
  });

  test('[npm-pack-parse] parsePackOutput：前置 prepack 输出（[build] 开头）仍能解出', () => {
    // 复刻实测形态：首行以 `[build]` 开头，JSON 在后面
    const polluted = `[build] lib/client.js ← 33 片段，共 4499 行\n${CLEAN}`;
    const r = parsePackOutput(polluted);
    assert.equal(r.ok, true, '必须跳过 [build] 找到真正的 JSON');
    assert.equal(r.value[0].filename, 'demo-1.0.0.tgz');
  });

  test('[npm-pack-parse] parsePackOutput：前置含成对花括号的日志也不误判', () => {
    const polluted = `[build] {ok: false} done\nnpm notice something\n${CLEAN}`;
    const r = parsePackOutput(polluted);
    assert.equal(r.ok, true);
    assert.equal(r.value[0].size, 1234);
  });

  test('[npm-pack-parse] parsePackOutput：没有 JSON 时明确失败（不是静默当空）', () => {
    assert.equal(parsePackOutput('[build] only logs, no json here').ok, false);
    assert.equal(parsePackOutput('').ok, false);
  });

  test('[npm-pack-parse] parsePackOutput：标量 JSON 不算有效结果（避免把日志里的 1/true 当清单）', () => {
    assert.equal(parsePackOutput('1 2 3').ok, false);
    assert.equal(parsePackOutput('true [build]').ok, false);
  });

  test('[npm-pack-parse] 端到端：prepack 会 print 的真包，packDryRun 能拿到文件清单', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshgp-pack-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'dshgp-pack-demo',
        version: '1.0.0',
        description: 'pack parse demo',
        license: 'MIT',
        // prepack 的第一行就像真实仓那样以 `[` 开头，专门触发历史 bug
        scripts: { prepack: 'node prepack.cjs' },
        files: ['index.js', 'prepack.cjs'],
      }, null, 2), 'utf8');
      writeFileSync(join(dir, 'prepack.cjs'), "console.log('[build] emit lib/client.js');\n", 'utf8');
      writeFileSync(join(dir, 'index.js'), 'export const a = 1;\n', 'utf8');

      const r = packDryRun({ dir });
      assert.equal(r.ok, true, `packDryRun 失败：${r.error || ''}｜stdout=${String(r.packStdoutTail || '').slice(0, 200)}`);
      assert.ok(r.files.length >= 2, `应拿到至少 2 个文件，实际 ${r.files.length}：${JSON.stringify(r.files)}`);
      assert.ok(r.files.includes('package.json'), 'package.json 必须在清单里');
      assert.ok(r.filename.includes('dshgp-pack-demo'), `filename 异常：${r.filename}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// ── 原 test-npm-cli-package.mjs ──
{
  /**
   * 发布前彩排要按「包的真实形态」验证（2026-11-02，外部会话实测反馈）。
   *
   * 背景：纯 CLI 服务包只有 `bin`，没有 `main`/`exports`。历史实现一律 `import('<包名>')`
   *   探测公开面，对这类包必然失败（Cannot find package .../index.js），于是**好包被判死**，
   *   报错还写「安装后加载失败」，让人以为包坏了。
   *
   * 现在的判据：
   *   · 有库入口（main/exports）→ import 公开面
   *   · 只有 bin → **真跑** `<node> <安装位>/<bin> --version`（断言输出含版本）与 `--help`（断言退出码 0）
   *   · 两者都没有 → 明确报「没有任何可验证入口」，不说「加载失败」
   *
   * 为什么 bin 必须真跑：曾出现「bin 判据用字面路径比较、而 npm 装的是符号链接」导致
   *   `npx <命令>` 静默 exit 0 且零输出 —— 这种故障 import 永远测不到。
   */


  test('[npm-cli-package] classifyPackageForm：库包 / 纯 CLI / 两者都有 / 都没有', () => {
    assert.equal(classifyPackageForm({ name: 'a', exports: { '.': './i.js' } }).kind, 'library');
    const cli = classifyPackageForm({ name: 'zipcalm', bin: { zipcalm: 'bin/zipcalm.js' } });
    assert.equal(cli.kind, 'cli');
    assert.deepEqual(cli.bins, [{ command: 'zipcalm', path: 'bin/zipcalm.js' }]);
    assert.equal(classifyPackageForm({ name: 'c', main: './i.js', bin: 'cli.js' }).kind, 'both');
    assert.equal(classifyPackageForm({ name: 'd' }).kind, 'none');
  });

  test('[npm-cli-package] entrySpecsOf：纯 CLI 包没有库入口（返回空，而不是包名）', () => {
    assert.deepEqual(entrySpecsOf({ name: 'zipcalm', bin: { zipcalm: 'bin/zipcalm.js' } }), []);
    assert.deepEqual(entrySpecsOf({ name: 'lib', main: './index.js' }), ['lib']);
  });

  /** 造一个临时包（不联网：无依赖）。 */
  function makePackage({ name, version = '1.0.0', main, bin, binBody }) {
    const dir = mkdtempSync(join(tmpdir(), `dshgp-pkg-${name}-`));
    const pkg = { name, version, type: 'commonjs' };
    if (main) pkg.main = main;
    if (bin) pkg.bin = bin;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    if (main) writeFileSync(join(dir, main), 'module.exports = { ok: true };\n');
    if (bin) {
      const rel = typeof bin === 'string' ? bin : Object.values(bin)[0];
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), binBody || [
        '#!/usr/bin/env node',
        `if (process.argv.includes('--version')) { console.log('${version}'); process.exit(0); }`,
        "if (process.argv.includes('--help')) { console.log('usage: demo'); process.exit(0); }",
        'process.exit(0);',
      ].join('\n'), 'utf8');
    }
    return dir;
  }

  test('[npm-cli-package] 纯 CLI 包：彩排真跑 bin 并通过（不再 import）', async () => {
    const dir = makePackage({ name: 'dshgp-cli-demo', version: '1.2.3', bin: { 'dshgp-cli-demo': 'bin/cli.js' } });
    try {
      const r = await runLocalPreview({ dir, tag: 'beta', packageName: 'dshgp-cli-demo', entrySpecs: [], bins: [{ command: 'dshgp-cli-demo', path: 'bin/cli.js' }], expectedVersion: '1.2.3' });
      assert.equal(r.ok, true, `彩排应通过：${JSON.stringify(r.failures)}`);
      const steps = r.steps.map((x) => x.step);
      assert.ok(steps.includes('bin-version'), '必须跑过 bin --version');
      assert.ok(steps.includes('bin-help'), '必须跑过 bin --help');
      assert.ok(!steps.includes('import'), '纯 CLI 包不应走 import 检查');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('[npm-cli-package] bin 版本不符：彩排应拦住', async () => {
    const dir = makePackage({ name: 'dshgp-cli-badver', version: '9.9.9', bin: { 'dshgp-cli-badver': 'bin/cli.js' } });
    try {
      const r = await runLocalPreview({ dir, tag: 'beta', packageName: 'dshgp-cli-badver', entrySpecs: [], bins: [{ command: 'dshgp-cli-badver', path: 'bin/cli.js' }], expectedVersion: '1.0.0' });
      assert.equal(r.ok, false);
      assert.match(r.failures.join('\n'), /--version/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('[npm-cli-package] 既无库入口也无 bin：报「没有可验证入口」，不说「加载失败」', async () => {
    const dir = makePackage({ name: 'dshgp-empty-demo', version: '1.0.0' });
    try {
      const r = await runLocalPreview({ dir, tag: 'beta', packageName: 'dshgp-empty-demo', entrySpecs: [], bins: [] });
      assert.equal(r.ok, false);
      const text = r.failures.join('\n');
      assert.match(text, /可验证入口/);
      assert.doesNotMatch(text, /加载失败/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
