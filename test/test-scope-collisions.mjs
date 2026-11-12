/**
 * 拼接产物作用域撞名检查（通用）测试。
 *
 * 背景：多段 JS 拼进同一作用域时，`var`/`function` 同名会**后者覆盖前者且不报错**，
 *   表现为某段功能静默失效、无异常可查。典型落点：浏览器插件分片拼 factory、
 *   `<script>` 引入多段脚本、`cat a.js b.js > bundle.js`。
 *
 * 判定必须**按真实作用域帧**（不是缩进/深度）：两个不同函数里的同名局部变量不算撞名；
 *   同一函数体/同一代码块里重复声明才算。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { analyzeScopeCollisions } from '../lib/ast/scope-collisions.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('同一函数作用域内重名（var + function 同名）→ 报', () => {
  const text = 'load({ factory: (r) => {\n  var s = 1;\n  function s() {}\n  return s;\n} });';
  const r = analyzeScopeCollisions(text);
  assert.equal(r.ok, false);
  assert.match(r.violations.join('\n'), /静默覆盖/);
});

test('两个不同函数里的同名局部变量 → 不报（不能按深度误判）', () => {
  const text = 'load({ factory: (r) => {\n  function a() { var x = 1; return x; }\n  function b() { var x = 2; return x; }\n} });';
  const r = analyzeScopeCollisions(text);
  assert.equal(r.ok, true, `不应误报：${r.violations.join('；')}`);
});

test('同一代码块内 const 重复声明 → 报（块级作用域）', () => {
  const text = 'load({ factory: (r) => {\n  const dup = 1;\n  const dup = 2;\n} });';
  const r = analyzeScopeCollisions(text);
  assert.equal(r.ok, false);
  assert.ok(r.duplicates.some((d) => d.name === 'dup' && d.scope === 'block'));
});

test('兄弟 for 循环各自的 const 同名 → 不报（for 头部是每语句独立作用域）', () => {
  // 回归：本项目自审计实测 16 处误报，全是 `for (const r of …)` 兄弟循环
  const text = 'load({ factory: (r) => {\n  for (const item of r.a) out.push(item);\n  for (const item of r.b) out.push(item);\n} });';
  const result = analyzeScopeCollisions(text);
  assert.equal(result.ok, true, `兄弟循环同名合法，不应报：${result.violations.join('；')}`);
});

test('兄弟 for await 循环里的 const 同名 → 不报（for await 也识别为 for 头部）', () => {
  const text = 'load({ factory: (r) => {\n  for await (const chunk of r.a) out.push(chunk);\n  for await (const chunk of r.b) out.push(chunk);\n} });';
  const result = analyzeScopeCollisions(text);
  assert.equal(result.ok, true, `for await 兄弟循环不应报：${result.violations.join('；')}`);
});

test('for 头部作用域不放大判定：同函数体两次 function 同名仍报', () => {
  const text = 'load({ factory: (r) => {\n  const DUP = 1;\n  for (const other of r.list) out.push(other);\n  function dup() {}\n  function dup() {}\n  return DUP;\n} });';
  const result = analyzeScopeCollisions(text);
  assert.equal(result.ok, false);
  assert.ok(result.duplicates.some((d) => d.name === 'dup'), '同一函数体里两次 function 声明必须报');
  assert.ok(!result.duplicates.some((d) => d.name === 'DUP'), 'for 头部声明与函数体声明不同名，不应混为一条');
});

test('文件顶层声明 → 报（拼接产物应零顶层声明）', () => {
  const r = analyzeScopeCollisions('var topLevelThing = 1;\nload({ factory: (r) => {} });');
  assert.equal(r.ok, false);
  assert.match(r.violations.join('\n'), /顶层声明/);
});

test('前缀只约束共享作用域；函数内部局部变量不受约束', () => {
  const text = 'load({ factory: (r) => {\n  const dshgp_ok = 1;\n  function dshgp_f() { const localVar = 2; return localVar + dshgp_ok; }\n} });';
  const r = analyzeScopeCollisions(text, { prefix: 'dshgp_' });
  assert.equal(r.ok, true, `局部变量不应要求前缀：${r.violations.join('；')}`);
});

test('共享作用域缺前缀 → 报', () => {
  const text = 'load({ factory: (r) => {\n  const badName = 1;\n  return badName;\n} });';
  const r = analyzeScopeCollisions(text, { prefix: 'dshgp_' });
  assert.equal(r.ok, false);
  assert.match(r.violations.join('\n'), /缺少 dshgp_ 前缀/);
});

test('allowlist 放行宿主契约名（module/exports/jsx…）', () => {
  const text = 'load({ factory: (r) => {\n  var module = {};\n  var exports = module.exports;\n  return exports;\n} });';
  const r = analyzeScopeCollisions(text, { prefix: 'dshgp_', allowlist: ['module', 'exports'] });
  assert.equal(r.ok, true, r.violations.join('；'));
});

test('真实产物 lib/client.js 按 package.json 配置通过', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const cfg = pkg.dshScopeCheck;
  assert.ok(cfg && Array.isArray(cfg.files) && cfg.files.length, 'package.json 必须声明 dshScopeCheck.files');
  for (const rel of cfg.files) {
    const r = analyzeScopeCollisions(readFileSync(join(ROOT, rel), 'utf8'), {
      prefix: cfg.prefix || '',
      allowlist: cfg.allowlist || [],
      topLevelMustBeEmpty: cfg.topLevelMustBeEmpty !== false,
    });
    assert.equal(r.ok, true, `${rel} 不应有作用域违规：${r.violations.slice(0, 3).join('；')}`);
  }
});

/* ── CLI 级：约定按「文件所属项目」取，不能拿本项目的 dshgp_ 去要求别人 ── */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CLI = join(ROOT, 'scripts', 'check-js-scope.mjs');
/** 造一个「别人的项目」：裸名声明，无任何约定配置。 */
function makeForeignProject({ withContract = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-foreign-'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'bundle.js'), 'load({ factory: (r) => {\n  var someName = 1;\n  return someName;\n} });\n', 'utf8');
  if (withContract) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foreign', dshScopeCheck: { files: ['dist/bundle.js'], prefix: 'ext_' } }), 'utf8');
  }
  return dir;
}

test('CLI：别人项目（无约定）不报「缺少 dshgp_ 前缀」', () => {
  const dir = makeForeignProject();
  try {
    const r = spawnSync(process.execPath, [CLI, join(dir, 'dist', 'bundle.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `不应报错；输出：${r.stderr || r.stdout}`);
    assert.doesNotMatch(r.stderr || '', /dshgp_/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI：项目自己声明了前缀才检查（未带前缀 → 报）', () => {
  const dir = makeForeignProject({ withContract: true });
  try {
    const r = spawnSync(process.execPath, [CLI, join(dir, 'dist', 'bundle.js')], { encoding: 'utf8' });
    assert.equal(r.status, 1, '声明了 ext_ 前缀但文件未带 → 应 exit 1');
    assert.match(r.stderr || '', /缺少 ext_ 前缀/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ── 审计管线：kind=scope-collision 必须经「规则 yml → 编译器 → 检查器 → 调度」生效 ── */

import { checkScopeCollision } from '../lib/checks/scope-collision.js';
import { TOOL_REGISTRY } from '../lib/app/command-registry.js';

/** 编译后的规则对象（与 structure.js 编译器产出同形）。 */
const RULE = { id: 'dsh/scope-collision', severity: 'error', level: 'blocker', dimensions: ['健壮性'] };

/** 造一个带 package.json 的项目目录，返回目标文件绝对路径。 */
function makeAuditProject({ name = 'app', contract = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-audit-'));
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'bundle.js'), 'load({ factory: (r) => {\n  var plainName = 1;\n  function apply() { return plainName; }\n  function apply() { return 2; }\n} });\n', 'utf8');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...(contract ? { dshScopeCheck: contract } : {}) }), 'utf8');
  return dir;
}

test('审计检查器：同帧 function 重名 → blocker（后者静默顶掉前者，是真缺陷）', () => {
  const dir = makeAuditProject();
  try {
    const file = join(dir, 'lib', 'bundle.js');
    const findings = checkScopeCollision({ file, relPath: 'lib/bundle.js', text: readFileSync(file, 'utf8'), rules: [RULE] });
    const dup = findings.filter((f) => /被声明 2 次以上/.test(f.message));
    assert.equal(dup.length, 1, `应报 1 条同帧重名：${JSON.stringify(findings)}`);
    assert.equal(dup[0].severity, 'blocker');
    assert.equal(dup[0].rule, 'dsh/scope-collision');
    assert.ok(dup[0].line > 0, 'finding 必须带行号（否则报告无法定位）');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('审计检查器：纯 var 重复 → warning（同一声明重复写入，运行时无害）', () => {
  const dir = makeAuditProject();
  try {
    const file = join(dir, 'lib', 'var-only.js');
    writeFileSync(file, 'load({ factory: (r) => {\n  var same = 1;\n  var same = 2;\n  return same;\n} });\n', 'utf8');
    const findings = checkScopeCollision({ file, relPath: 'lib/var-only.js', text: readFileSync(file, 'utf8'), rules: [RULE] });
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].severity, 'warning', '纯 var 重复不应拦提交');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('审计检查器：项目没声明 dshScopeCheck → 只查同帧重名，不报前缀（外来项目零噪音）', () => {
  const dir = makeAuditProject();
  try {
    const file = join(dir, 'lib', 'bundle.js');
    const findings = checkScopeCollision({ file, relPath: 'lib/bundle.js', text: readFileSync(file, 'utf8'), rules: [RULE] });
    assert.ok(!findings.some((f) => /前缀/.test(f.message)), `外来项目不应收到前缀告警：${JSON.stringify(findings)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('审计检查器：声明了契约但文件不在 files 清单 → 仍不查前缀（分片源码不是产物）', () => {
  const dir = makeAuditProject({ contract: { files: ['lib/other.js'], prefix: 'ext_', topLevelMustBeEmpty: true } });
  try {
    const file = join(dir, 'lib', 'bundle.js');
    const findings = checkScopeCollision({ file, relPath: 'lib/bundle.js', text: readFileSync(file, 'utf8'), rules: [RULE] });
    assert.ok(!findings.some((f) => /前缀|顶层声明/.test(f.message)), JSON.stringify(findings));
    assert.equal(findings.filter((f) => /被声明 2 次以上/.test(f.message)).length, 1, '通用项（同帧重名）仍要查');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('审计检查器：文件在 files 清单 → 按项目契约查前缀与顶层零声明（warning 封顶）', () => {
  const dir = makeAuditProject({ contract: { files: ['lib/bundle.js'], prefix: 'ext_', topLevelMustBeEmpty: true } });
  try {
    const file = join(dir, 'lib', 'bundle.js');
    const findings = checkScopeCollision({ file, relPath: 'lib/bundle.js', text: readFileSync(file, 'utf8'), rules: [RULE] });
    const prefixHits = findings.filter((f) => /缺少 ext_ 前缀/.test(f.message));
    assert.ok(prefixHits.length >= 2, `应命中 prefix（plainName/apply）：${JSON.stringify(findings)}`);
    for (const hit of prefixHits) assert.notEqual(hit.severity, 'blocker', '契约类问题不得拦提交');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('豁免注册表：scope-collision 必须能被某个 dsh-skip-* 标记真豁免（防「提示写了不生效」）', async () => {
  const { exemptHintForFinding } = await import('../lib/exempt/index.js');
  const hit = exemptHintForFinding({ kind: 'scope-collision', rule: 'dsh/scope-collision', dimensions: ['健壮性'] });
  assert.ok(hit && hit.marker, 'scope-collision 不在任何标记的 blocked 清单里 → 照提示写标记也不生效');
});

test('注册表：scope_check 工具与 CLI 命令同源声明（加一条注册表 = 工具 + CLI 同时生效）', () => {
  const entry = TOOL_REGISTRY.find((t) => t.name === 'scope_check');
  assert.ok(entry, '注册表必须有 scope_check');
  assert.equal(entry.cli, 'scope-check', 'CLI 命令名由注册表 cli 字段派生');
  for (const flag of ['files', 'repo', 'prefix', 'allowlist', 'topLevelMustBeEmpty']) {
    assert.ok(entry.params.some((p) => p.flag === flag), `缺参数 ${flag}`);
  }
});

test('规则包：scope-collision 规则只声明 kind/严重度，**不得**写入任何项目的前缀约定', () => {
  const yml = readFileSync(join(ROOT, 'lib', 'audit-rules', 'audit-rules-dsh.yml'), 'utf8');
  const block = yml.split('- id: dsh/scope-collision')[1] || '';
  const rule = block.split(/\n  - id: /)[0];
  assert.match(rule, /kind:\s*"scope-collision"/, '必须声明 kind');
  // 规则包跨仓库共享：写死 dshgp_ 会让所有被审项目收到「缺少 dshgp_ 前缀」。
  //   只查「YAML 键」形态（缩进 + 键名 + 冒号），避免误伤 mitigation 正文里提到的键名。
  assert.doesNotMatch(rule, /^\s+prefix\s*:/m, 'yml 不得写死前缀（会污染其它项目）');
  assert.doesNotMatch(rule, /^\s+(top_level_must_be_empty|topLevelMustBeEmpty)\s*:/m, 'yml 不得写死顶层零声明');
});

test('CLI：audit-sluice scope-check 有违规时退出码非 0（脚本/门禁可判失败）', () => {
  const dir = makeAuditProject();
  try {
    // scope-check 属审计侧命令 → 走 audit-sluice 入口
    const cli = join(ROOT, 'cli-audit.mjs');
    const bad = spawnSync(process.execPath, [cli, 'scope-check', join(dir, 'lib', 'bundle.js')], { encoding: 'utf8' });
    assert.equal(bad.status, 1, `撞名文件应 exit 1；输出：${bad.stdout || bad.stderr}`);
    assert.match(bad.stdout || '', /被声明 2 次以上/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI：audit-sluice scope-check 无参数时读项目 dshScopeCheck.files', () => {
  const dir = makeAuditProject({ contract: { files: ['lib/bundle.js'], prefix: 'ext_', topLevelMustBeEmpty: true } });
  try {
    const cli = join(ROOT, 'cli-audit.mjs');
    const r = spawnSync(process.execPath, [cli, 'scope-check'], { encoding: 'utf8', cwd: dir });
    assert.match(r.stdout || '', /策略来源：项目 package.json/, `应按项目契约：${r.stdout}`);
    assert.equal(r.status, 1, '该文件有撞名 → exit 1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
