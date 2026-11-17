#!/usr/bin/env node
/**
 * 语法检查脚本（npm run check）
 * 递归检查 lib/****.js + cli.mjs 语法；任一失败退出 1（checkSyncInAsync 的脚本侧实现）。
 *
 * 2026-10-09（任务.md C8 分片改造）新增两条：
 *   ① **跳过 `lib/client-parts/`**：那是客户端**分片源码**——单个分片是片段（首片开 `factory`、
 *      尾片收尾），单独 `node --check` 必然失败；语法检查只对**产物** `lib/client.js` 做。
 *   ② **产物新鲜度门禁**：`lib/client.js` 必须与分片按 PART_ORDER 拼出来的一致，
 *      防止有人直接手改产物（下次构建就被覆盖，改动静默丢失）。
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClient } from './build-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** 递归收集 .js 文件（跳过 node_modules、点开头目录，以及分片目录 client-parts）。 */
function collectJs(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (name === 'client-parts') continue; // 分片是片段，见文件头 ①
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectJs(p, acc);
    else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

/** 递归收集 .json（同样的跳过规则，但不跳过 client-parts——那里没有 .json）。 */
function collectJson(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectJson(p, acc);
    else if (name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

// 三个 CLI 入口都要做语法检查：它们不是 lib/ 下的文件，靠 collectJs 收不到——
//   漏检的后果是「新入口语法错，但门禁全绿」（与被拆出来的入口一起构成盲区）。
// 只检查现存入口：审计 CLI 已随审计能力独立成包（audit-sluice），宿主不再提供 cli-audit.mjs。
const CLI_ENTRY_FILES = ['cli.mjs', 'cli-tool.mjs'];
const CLI_ENTRIES = CLI_ENTRY_FILES.map((name) => join(ROOT, name));
const files = [...collectJs(join(ROOT, 'lib')), ...CLI_ENTRIES];
// docs/*.json 也必须能解析：版本表与发版说明直接依赖 docs/releases.json，
//   而它曾在 2.8.4 因一个尾随逗号变成非法 JSON 却**四项门禁全绿**（缺口）——这类错误必须在门禁里变红 ✗
const jsonFiles = [...collectJson(join(ROOT, 'lib')), ...collectJson(join(ROOT, 'docs'))];
let fail = 0;
let jsonFail = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe', encoding: 'utf8' });
    console.log(`✔ ${f.replace(ROOT + '/', '')}`);
  } catch (e) {
    fail++;
    console.error(`✗ ${f.replace(ROOT + '/', '')}: ${String(e?.stderr || e).trim().split('\n')[0]}`);
  }
}

// JSON 可解析性门禁（独立计数，不并入上面的语法通过率）
for (const f of jsonFiles) {
  try {
    JSON.parse(readFileSync(f, 'utf8'));
    console.log(`✔ ${f.replace(ROOT + '/', '')}`);
  } catch (e) {
    jsonFail++;
    console.error(`✗ ${f.replace(ROOT + '/', '')}: JSON 解析失败——${String(e?.message || e).split('\n')[0]}`);
  }
}

// 产物新鲜度：client.js 必须是分片构建出来的那一份
try {
  const built = buildClient();
  const current = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
  if (built === current) {
    console.log('✔ lib/client.js 与分片一致（构建产物新鲜）');
  } else {
    fail++;
    console.error('✗ lib/client.js 与分片不一致——请运行 node scripts/build-client.mjs 重新生成（不要手改产物）');
  }
} catch (e) {
  fail++;
  console.error(`✗ 分片构建校验失败：${e.message}`);
}

// ── 拼接产物作用域门禁（2026-11-05）───────────────────────────────────
// 背景：lib/client-parts/*.js 是**平铺拼接**的片段，14 个分片最终落在**同一个 factory
//   函数作用域**里。JS 的 var/function 提升规则是「同名后者覆盖前者且不报错」——
//   一处重名就让某分片功能在运行时静默失效，且没有任何报错可查。
//   构建脚本头部早写了「顶层零声明 + dshgp_ 前缀」两条铁律，但此前**只是注释**：
//   新鲜度门禁只保证「产物 == 分片拼接」，保证不了「拼出来的不撞名」。
// 检查项（通用实现在 lib/ast/scope-collisions.js，项目差异走 package.json 的 dshScopeCheck）：
//   ① 同作用域重名（var/function 静默覆盖的触发条件，始终检查）；
//   ② 文件顶层零声明；③ 共享作用域命名前缀。
try {
  const { analyzeScopeCollisions } = await import('../../audit-sluice/lib/ast/scope-collisions.js');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const cfg = pkg?.dshScopeCheck;
  const files = Array.isArray(cfg?.files) && cfg.files.length ? cfg.files : [];
  if (!files.length) {
    console.log('✔ 拼接产物作用域：未配置 dshScopeCheck.files，跳过');
  }
  for (const rel of files) {
    const abs = join(ROOT, rel);
    const scope = analyzeScopeCollisions(readFileSync(abs, 'utf8'), {
      prefix: String(cfg.prefix || ''),
      allowlist: Array.isArray(cfg.allowlist) ? cfg.allowlist.map(String) : [],
      topLevelMustBeEmpty: cfg.topLevelMustBeEmpty !== false,
    });
    if (scope.ok) {
      console.log(`✔ ${rel} 作用域契约（顶层零声明 · 共享作用域 ${scope.declarations.filter((d) => d.frameId === scope.sharedFrameId).length} 个声明均合规 · 无同帧重名）`);
    } else {
      fail += 1;
      for (const v of scope.violations) console.error(`✗ ${rel} 作用域：${v}`);
    }
  }
} catch (e) {
  fail += 1;
  console.error(`✗ 拼接产物作用域检查失败：${e.message}`);
}

// ── 解耦门禁：宿主里不许留审计实现 / 耦合面只允许三个中间层文件 ────────────────
// 不变量（宿主 = dsh-git-push，实现 = 独立包）：
//   ① 宿主 `lib/` 下不得出现审计实现目录：实现住在独立包里，宿主里再出现一份就是双真相，
//      两份实现迟早判得不一样，而「哪份生效」取决于走了哪条分支——这几乎无法排查。
//   ② 宿主对实现包的引用只能经由三个文件中转：
//        lib/preprocess/providers.js        —— provider 声明与入口解析（唯一的「找包」处）
//        lib/commit-push/pre-commit-engine.js —— 子进程跑实现（门禁契约）
//        lib/app/preprocess-client.js        —— 进程内调实现公开面（工具/HTTP）
//      别处直接 import 包名 = 绕过 provider 抽象，换/加实现时那处会悄悄指向旧包。
const FORBIDDEN_IMPL_DIRS = new Set(['ast', 'audit', 'audit-rules', 'checks', 'exempt', 'rule', 'score', 'lint-adapter', 'link-check']);
const IMPL_PACKAGE = 'audit-sluice';
/** 允许直接引用实现包的文件（相对仓库根）。 */
const COUPLING_FILES = new Set([
  'lib/preprocess/providers.js',
  'lib/commit-push/pre-commit-engine.js',
  'lib/app/preprocess-client.js',
]);

const strayImplementations = [];
for (const f of files) {
  const rel = f.replace(ROOT + '/', '');
  if (!rel.startsWith('lib/')) continue;
  const top = rel.slice('lib/'.length).split('/')[0];
  if (rel.includes('/') && FORBIDDEN_IMPL_DIRS.has(top)) strayImplementations.push(rel);
}
if (strayImplementations.length) {
  fail += strayImplementations.length;
  console.error(`✗ 解耦违规：宿主 lib/ 下又出现审计实现目录（实现归独立包）：${strayImplementations.join(', ')}`);
} else {
  console.log('✔ 解耦：宿主 lib/ 下无审计实现目录（实现归独立包）');
}

const couplingHits = [];
for (const f of files) {
  const rel = f.replace(ROOT + '/', '');
  if (!rel.startsWith('lib/')) continue;
  if (COUPLING_FILES.has(rel)) continue;
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  // 只看模块说明符（注释里提到包名是说明性文字，不构成耦合）
  const specifier = new RegExp(`(?:from\\s+|import\\s*\\(\\s*)['\"](?:[^'\"]*/)?${IMPL_PACKAGE}(?:/[^'\"]*)?['\"]`, 'g');
  for (const m of src.matchAll(specifier)) {
    couplingHits.push(`${rel} → ${m[0].trim()}`);
  }
}
if (couplingHits.length) {
  fail += couplingHits.length;
  console.error(`✗ 耦合面违规：实现包只能经由 ${[...COUPLING_FILES].join(' / ')} 引用，发现：${couplingHits.join('；')}`);
} else {
  console.log(`✔ 耦合面：实现包只经 ${COUPLING_FILES.size} 个中间层文件引用（无旁路）`);
}

// ── 实现参数名门禁：宿主不许写死某个实现的工具参数名 ────────────────
//   实现自己的参数按次走 preprocessStages[].args（自由字典）；键名→CLI 参数的映射由 provider 的 manifest 声明。
//   这里钉住最容易回潮的写法：参数名以字面量出现在宿主 lib/ 里（允许的三个中间层文件除外）。
const IMPL_PARAM_LITERAL = /['"`]auditExempt[A-Za-z]*['"`]/;
const paramLiteralHits = [];
for (const f of files) {
  const rel = f.replace(ROOT + '/', '');
  if (!rel.startsWith('lib/')) continue;
  if (COUPLING_FILES.has(rel)) continue;
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  // 逐行扫，跳过整行注释（注释里解释历史是允许的）
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (IMPL_PARAM_LITERAL.test(line)) paramLiteralHits.push(`${rel}: ${trimmed.slice(0, 80)}`);
  }
}
if (paramLiteralHits.length) {
  fail += paramLiteralHits.length;
  console.error(`✗ 实现参数名违规：宿主不得写死实现参数名（应由实现的 manifest 声明）：${paramLiteralHits.join('；')}`);
} else {
  console.log('✔ 实现参数名：宿主 lib/ 未写死任何实现参数名（由 provider 自报）');
}

console.log(`\n${files.length - fail}/${files.length} 文件语法通过`);
console.log(`${jsonFiles.length - jsonFail}/${jsonFiles.length} 个 JSON 可解析`);
process.exitCode = (fail > 0 || jsonFail > 0) ? 1 : 0;
