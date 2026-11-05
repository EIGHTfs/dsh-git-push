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

const files = [...collectJs(join(ROOT, 'lib')), join(ROOT, 'cli.mjs')];
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
  const { analyzeScopeCollisions } = await import('../lib/ast/scope-collisions.js');
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

// ── 层边界门禁（2026-10-24）────────────────────────────────────────────
// 背景：审计引擎与提交推送**决定不拆成两个 npm 包**（拆包的持续成本——双包版本同步、
//   固定发布顺序、依赖范围——换不到真实收益：外部使用者要的是「提交前拦截」这个整体，
//   而「脱离 DSH 跑审计」已由 cli.mjs 的独立 CLI 覆盖）。
//   但不拆包不等于放弃边界：审计层对 git 层是**实测零依赖**，这个事实一旦被顺手 import
//   侵蚀就再也回不来（历史包袱太重 = 不可逆）。所以把它钉成门禁。
// 不变量：
//   ① 审计层任何文件都不得 import git/npm/commit-push 层（方向唯一：git → audit）；
//   ② 反向接缝数量有预算上限——允许存在（提交门禁必须调审计），但要能看见它在膨胀。
// lint-adapter（外部 linter 委托层）纳入审计层口径：编排层（audit）直接依赖它 ⇒ 它属于审计子图，
//   同样不得伸手 git 层（委托层只读项目文件 + 跑外部二进制，不需要凭据/git）。
const AUDIT_DIRS = new Set(['ast', 'audit', 'audit-rules', 'checks', 'exempt', 'rule', 'score', 'lint-adapter']);
const GIT_DIRS = new Set(['git', 'npm']);
const GIT_TOP = new Set(['commit-push.js']);
const AUDIT_TOP = new Set(['audit-defaults.js', 'skip-dirs.js']);
/** 反向接缝预算：实测 7 处（commit-push 3 + git/{ignore,repos,sensitive} 4）；上调需写明理由。 */
const SEAM_BUDGET = 7;

const layerOf = (rel) => {
  const top = rel.split('/')[0];
  if (rel.includes('/') && AUDIT_DIRS.has(top)) return 'AUDIT';
  if (rel.includes('/') && GIT_DIRS.has(top)) return 'GIT';
  if (!rel.includes('/') && GIT_TOP.has(rel)) return 'GIT';
  if (!rel.includes('/') && AUDIT_TOP.has(rel)) return 'AUDIT';
  return 'OTHER';
};

let boundaryViolations = 0;
const seams = [];
for (const f of files) {
  const rel = f.replace(ROOT + '/', '');
  if (!rel.startsWith('lib/')) continue;
  const inner = rel.slice('lib/'.length);
  if (layerOf(inner) !== 'AUDIT') continue;
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = join(dirname(f), m[1]).replace(ROOT + '/lib/', '');
    if (layerOf(target) === 'GIT') {
      boundaryViolations++;
      console.error(`✗ 层边界违规：审计层 lib/${inner} import 了 git 层 ${m[1]}（审计引擎解耦）`);
    }
  }
}
// 反向接缝统计（允许，但要可见）
for (const f of files) {
  const rel = f.replace(ROOT + '/', '');
  if (!rel.startsWith('lib/')) continue;
  const inner = rel.slice('lib/'.length);
  if (layerOf(inner) !== 'GIT') continue;
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = join(dirname(f), m[1]).replace(ROOT + '/lib/', '');
    if (layerOf(target) === 'AUDIT') seams.push(`${inner} → ${target}`);
  }
}
if (boundaryViolations) {
  fail += boundaryViolations;
  console.error(`✗ 层边界：${boundaryViolations} 处违规——审计层不得依赖 git/npm/commit-push`);
} else {
  console.log(`✔ 层边界：审计层对 git 层 0 依赖（解耦成立）`);
}
if (seams.length > SEAM_BUDGET) {
  fail++;
  console.error(`✗ 反向接缝 ${seams.length} 处 > 预算 ${SEAM_BUDGET}：提交门禁调审计是必需的，但膨胀说明边界在糊掉——要么收敛，要么改预算并写明理由`);
} else {
  console.log(`✔ 反向接缝（git → audit，唯一耦合面）：${seams.length}/${SEAM_BUDGET} 处`);
}

console.log(`\n${files.length - fail}/${files.length} 文件语法通过`);
console.log(`${jsonFiles.length - jsonFail}/${jsonFiles.length} 个 JSON 可解析`);
process.exitCode = (fail > 0 || jsonFail > 0) ? 1 : 0;
