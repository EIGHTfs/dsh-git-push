/**
 * 测试树扫描 + 结构门禁的自测（test/helpers/test-scan.mjs + test/run-tests.mjs 的接线）。
 *
 * 为什么单独测这件事：扫描逻辑决定「哪些测试会被跑」。它一旦退化回「只扫顶层」，
 *   把测试移进子目录就等于让它们静默消失，而回归报告仍然全绿——这是本仓库真实踩过的坑
 *   （test/audit/ 那 3 个 UI 测试从移进子目录起就再没被常规回归跑到）。
 *   所以扫描逻辑必须是**可被单测直接调**的纯函数，而不是埋在入口脚本里只能靠"跑一遍看数字"验证。
 *
 * 覆盖：
 *   ① 递归发现（子目录里的 test-*.mjs 都能收到）
 *   ② 归档隔离（_archived/ 下的文件进 archived、不进 regular，任意层级都算归档）
 *   ③ 共享目录排除（helpers/ fixtures/ 里的 mjs 永不当测试）
 *   ④ 结构门禁（顶层出现 test-*.mjs → violations 非空，且该文件不进常规回归）
 *   ⑤ 真实仓库接线（--dry-run --stats 报告出四类原因与各侧计数）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARCHIVED_DIR, scanTestTree, sideOf, structureViolations } from '../helpers/test-scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_DIR = join(ROOT, 'test');

/** 造一棵模拟测试树：四侧 + 归档 + 共享目录 + 一个违规的顶层文件。 */
function makeFakeTree() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-scan-'));
  const write = (rel) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "import { test } from 'node:test';\ntest('x', () => {});\n");
    return abs;
  };
  write('test-git/.keep');
  write('git/test-alpha.mjs');
  write('git/test-beta.mjs');
  write('audit/test-gamma.mjs');
  write('audit/_archived/test-archived-one.mjs');
  write('audit/_archived/nested/test-archived-two.mjs');
  write('tool/test-delta.mjs');
  write('app/test-epsilon.mjs');
  // 共享目录里的 mjs：名字就算叫 test-*.mjs 也不能被当测试
  write('helpers/test-should-not-count.mjs');
  write('fixtures/test-nor-this.mjs');
  // 违规：顶层 test-*.mjs
  const topLevel = write('test-legacy-top.mjs');
  return { dir, topLevel };
}

test('扫描：递归发现四侧子目录里的 test-*.mjs', () => {
  const { dir } = makeFakeTree();
  try {
    const scan = scanTestTree(dir);
    const names = scan.regular.map((abs) => abs.slice(dir.length + 1).split('\\').join('/')).sort();
    assert.deepEqual(names, [
      'app/test-epsilon.mjs',
      'audit/test-gamma.mjs',
      'git/test-alpha.mjs',
      'git/test-beta.mjs',
      'tool/test-delta.mjs',
    ], `常规回归集合不符：${names.join(', ')}`);
    assert.deepEqual(Object.keys(scan.bySide).sort(), ['app', 'audit', 'git', 'tool'], '按侧分组应含四侧');
    assert.equal(scan.bySide.git.regular.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('扫描：_archived/ 下的测试一律归归档、不进常规回归（含嵌套层）', () => {
  const { dir } = makeFakeTree();
  try {
    const scan = scanTestTree(dir);
    const archived = scan.archived.map((abs) => abs.slice(dir.length + 1).split('\\').join('/')).sort();
    assert.deepEqual(archived, ['audit/_archived/nested/test-archived-two.mjs', 'audit/_archived/test-archived-one.mjs'],
      `归档集合不符：${archived.join(', ')}`);
    assert.ok(!scan.regular.some((abs) => abs.includes(ARCHIVED_DIR)), '归档文件不得出现在常规回归里');
    assert.equal(scan.bySide.audit.archived.length, 2, '按侧统计里归档也要可见（不许静默排除）');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('扫描：helpers/ 与 fixtures/ 里的 mjs 永不当测试', () => {
  const { dir } = makeFakeTree();
  try {
    const scan = scanTestTree(dir);
    const all = [...scan.regular, ...scan.archived].map((abs) => abs.slice(dir.length + 1));
    assert.ok(!all.some((rel) => rel.startsWith('helpers/') || rel.startsWith('fixtures/')), `共享目录被误当测试：${all.join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('结构门禁：顶层出现 test-*.mjs → violations 非空，且不计入常规回归', () => {
  const { dir, topLevel } = makeFakeTree();
  try {
    const scan = scanTestTree(dir);
    const violations = structureViolations(scan);
    assert.deepEqual(violations, ['test-legacy-top.mjs'], `违规清单不符：${violations.join(', ')}`);
    assert.ok(!scan.regular.includes(topLevel), '顶层违规文件不应被静默当成回归（否则新旧结构并存会跑两遍）');
    // 干净树 → 无违规
    const clean = mkdtempSync(join(tmpdir(), 'dshgp-scan-clean-'));
    try {
      mkdirSync(join(clean, 'git'), { recursive: true });
      writeFileSync(join(clean, 'git', 'test-ok.mjs'), "test('x', () => {});\n");
      assert.deepEqual(structureViolations(scanTestTree(clean)), [], '干净树不应报结构违规');
    } finally { rmSync(clean, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sideOf：能取出一级侧目录名（顶层文件返回空串）', () => {
  assert.equal(sideOf('/r/test', '/r/test/git/test-a.mjs'), 'git');
  assert.equal(sideOf('/r/test', '/r/test/audit/_archived/test-a.mjs'), 'audit');
  assert.equal(sideOf('/r/test', '/r/test/test-top.mjs'), '');
});

test('结构门禁：真实仓库顶层已无 test-*.mjs，且每侧都有测试', () => {
  const scan = scanTestTree(TEST_DIR);
  assert.deepEqual(structureViolations(scan), [], '真实仓库出现顶层 test-*.mjs');
  for (const side of ['git', 'audit', 'tool', 'app']) {
    assert.ok(scan.bySide[side]?.regular.length > 0, `${side}/ 下没有任何常规测试（目录漏了或扫描漏了）`);
  }
  assert.ok(scan.regular.length >= 150, `常规回归文件数异常偏少（${scan.regular.length}）——扫描可能退化成只扫顶层`);
});

// 干跑输出只取一次：每次 dry-run 都要为每个文件算 import 闭包（CIFS 上每次读几十个文件），
//   在测试里重复 spawn 会让这个自测本身变成慢测试。--only= 把范围缩到 3 个文件，
//   要验证的是「接线与输出格式」，不是「把 171 个文件都算一遍」（后者由全量回归自己证明）。
let dryRunOutput = null;
function dryRunStats() {
  if (dryRunOutput === null) {
    dryRunOutput = execFileSync(process.execPath, [join(TEST_DIR, 'run-tests.mjs'), '--dry-run', '--stats', '--only=test-cli'], {
      encoding: 'utf8', timeout: 120000, cwd: ROOT, maxBuffer: 32 * 1024 * 1024,
    });
  }
  return dryRunOutput;
}

test('接线：--dry-run --stats 能报告各侧计数、归档清单与四类原因', () => {
  const out = dryRunStats();
  // 各侧汇总行（跑/缓存跳过/归档）
  for (const side of ['git/', 'audit/', 'tool/', 'app/']) {
    assert.match(out, new RegExp(`── ${side.replace('/', '\\/')} ：常规 \\d+ 个（跑 \\d+ / 缓存跳过 \\d+）· 归档 \\d+ 个`), `缺少 ${side} 的汇总行`);
  }
  // 归档必须显式列出手动跑法（不静默排除）
  assert.match(out, /_archived\/ ：\d+ 个归档测试\*\*不参与回归\*\*/, '缺少归档说明');
  assert.match(out, /node --test test\/audit\/_archived\//, '缺少归档测试的手动跑命令');
  // 原因分布（dry-run 会打印四类计数）
  assert.match(out, /\[dry-run\] 原因分布：/, '缺少原因分布');
  // 逐文件行带侧标记（--only 命中哪个侧不固定，只要求「带侧标记」）
  assert.match(out, /\[(git|audit|tool|app)\] /, '逐文件行应带所属侧');
  // 不执行任何测试
  assert.match(out, /未执行任何测试/, 'dry-run 不得真跑测试');
});

test('接线：归档目录里的测试不在 --dry-run 的将真跑清单里', () => {
  const out = dryRunStats();
  const willRunLine = out.split('\n').find((line) => line.includes('将真跑：')) || '';
  assert.ok(willRunLine.length > 0, '未找到「将真跑」行');
  assert.ok(!willRunLine.includes('_archived'), `归档测试混进了将真跑清单：${willRunLine.slice(0, 300)}`);
});

test('缓存原因：planTestRun 能区分 命中 / 内容变 / 依赖变 / 不可缓存', async () => {
  const { planTestRun, selfHashOf, cacheKeyFor, importClosure } = await import('../helpers/test-cache.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-cache-reason-'));
  try {
    const depFile = join(dir, 'dep.mjs');
    const testFile = join(dir, 'test-hit.mjs');
    const netFile = join(dir, 'test-net.mjs');
    writeFileSync(depFile, 'export const v = 1;\n');
    writeFileSync(testFile, "import { v } from './dep.mjs';\ntest('x', () => v);\n");
    writeFileSync(netFile, "await fetch('https://example.com');\n");
    const files = [testFile, netFile];
    const keyOf = (abs) => cacheKeyFor(importClosure(abs));
    // 命中：键与自身哈希都对上且 passed
    let cache = { format: 2, results: { [testFile]: { key: keyOf(testFile), selfHash: selfHashOf(testFile), passed: true } } };
    let plan = planTestRun(files, cache);
    assert.deepEqual(plan.skipped, [testFile], '命中缓存的文件应被跳过');
    assert.match(plan.reasons[testFile], /缓存命中/);
    assert.match(plan.reasons[netFile], /不缓存/, '含 fetch 的文件必须判为不可缓存');
    // 内容变：测试文件自己改了（自身哈希变）
    writeFileSync(testFile, "import { v } from './dep.mjs';\ntest('x2', () => v + 1);\n");
    plan = planTestRun(files, cache);
    assert.ok(plan.run.includes(testFile));
    assert.match(plan.reasons[testFile], /内容变/);
    // 依赖变：只有依赖文件改了（自身哈希不变，键变了）
    cache = { format: 2, results: { [testFile]: { key: keyOf(testFile), selfHash: selfHashOf(testFile), passed: true } } };
    writeFileSync(depFile, 'export const v = 2;\n');
    plan = planTestRun(files, cache);
    assert.ok(plan.run.includes(testFile));
    assert.match(plan.reasons[testFile], /依赖变/);
    // 失败过的不缓存：passed:false → 必跑
    cache = { format: 2, results: { [testFile]: { key: keyOf(testFile), selfHash: selfHashOf(testFile), passed: false } } };
    plan = planTestRun(files, cache);
    assert.ok(plan.run.includes(testFile), '上次失败的文件必须重跑');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('缓存机制未被改坏：键仍是「内容哈希 + import 闭包」，不是 mtime', () => {
  const source = readFileSync(join(TEST_DIR, 'helpers', 'test-cache.mjs'), 'utf8');
  assert.match(source, /createHash\('sha256'\)/, '缓存键必须是内容哈希');
  assert.match(source, /importClosure\(/, '缓存键必须包含 import 闭包');
  assert.doesNotMatch(source, /mtimeMs|statSync\([^)]*\)\.mtime/, '缓存键不得退化成 mtime');
  assert.match(source, /passed === true/, '命中条件必须包含 passed === true');
});
