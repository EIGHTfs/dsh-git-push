// dsh-git-push 测试：重复代码检测（maintainability/no-duplicate-code，该抽公共函数）
/**
 * 覆盖：lib/ast/dup-code.js 的 collectDupCodeCandidates / findDuplicateBodies +
 *   lib/checks/dup-code.js 的 checkDuplicateCode。
 * 判定标准（量化判定标准）：
 *   · 同一归一化结构 ≥3 处 + 函数体 ≥5 行 → 报（该抽公共函数）
 *   · 2 处 / 不足 5 行 / test 夹具 / 参数 >5 / 布尔 flag → 不报
 *   · severity 恒 warning（只提示不拦截）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectDupCodeCandidates, findDuplicateBodies } from '../lib/ast/dup-code.js';
import { checkDuplicateCode } from '../lib/checks/dup-code.js';

// ---------- AST 层 ----------

test('dup-code：同一结构 3 个函数体被识别为重复（归一化哈希）', () => {
  const src = `
function parseUser(row) {
  const name = String(row.name || '').trim();
  const age = Number(row.age) || 0;
  if (name && age > 0) return { name, age };
  return null;
}
function parseOrder(row) {
  const name = String(row.name || '').trim();
  const age = Number(row.age) || 0;
  if (name && age > 0) return { name, age };
  return null;
}
function parseItem(row) {
  const name = String(row.name || '').trim();
  const age = Number(row.age) || 0;
  if (name && age > 0) return { name, age };
  return null;
}
`;
  const cands = collectDupCodeCandidates(src, 'demo.js');
  assert.equal(cands.length, 3, `应提取 3 个函数体（实际 ${cands.length}）`);
  const dups = findDuplicateBodies([cands]);
  assert.equal(dups.length, 1, `应发现 1 组重复（实际 ${dups.length}）`);
  assert.equal(dups[0].instances.length, 3, '重复实例数应为 3');
  assert.ok(dups[0].lines >= 5, `函数体行数应 ≥5（实际 ${dups[0].lines}）`);
});

test('dup-code：归一化——变量名不同但结构相同仍算重复', () => {
  const a = `
function alpha(x) {
  const total = Number(x) || 0;
  const scaled = total * 2;
  if (scaled > 100) return scaled;
  return total;
}
`;
  const b = `
function beta(y) {
  const count = Number(y) || 0;
  const scaled = count * 2;
  if (scaled > 100) return scaled;
  return count;
}
`;
  const ca = collectDupCodeCandidates(a, 'a.js');
  const cb = collectDupCodeCandidates(b, 'b.js');
  assert.equal(ca.length, 1, `a.js 应提取 1 个候选（实际 ${ca.length}）`);
  assert.equal(cb.length, 1, `b.js 应提取 1 个候选（实际 ${cb.length}）`);
  assert.equal(ca[0].hash, cb[0].hash, '变量名不同应归一化为同一 hash');
});

test('dup-code：字符串内容不同 → 结构不同 → 不算重复', () => {
  const a = `
function alpha() {
  const msg = 'hello world';
  const upper = msg.toUpperCase();
  return upper.length;
}
`;
  const b = `
function beta() {
  const msg = 'goodbye cruel world';
  const upper = msg.toUpperCase();
  return upper.length;
}
`;
  const ca = collectDupCodeCandidates(a, 'a.js');
  const cb = collectDupCodeCandidates(b, 'b.js');
  assert.equal(ca.length, 1, `a.js 应提取 1 个候选（实际 ${ca.length}）`);
  assert.equal(cb.length, 1, `b.js 应提取 1 个候选（实际 ${cb.length}）`);
  assert.notEqual(ca[0].hash, cb[0].hash, '字符串内容不同不应归为同一结构');
});

test('dup-code：不足 5 行的函数不报（不值得抽）', () => {
  const src = `
function one(x) { return x + 1; }
function two(x) { return x + 1; }
function three(x) { return x + 1; }
`;
  const cands = collectDupCodeCandidates(src, 'demo.js');
  assert.equal(cands.length, 0, '单行函数不应成为候选（<5 行）');
});

test('dup-code：2 处重复不报（观察档）', () => {
  const src = `
function alpha(x) {
  const total = Number(x) || 0;
  return total > 0 ? total : 0;
}
function beta(y) {
  const count = Number(y) || 0;
  return count > 0 ? count : 0;
}
`;
  const cands = collectDupCodeCandidates(src, 'demo.js');
  const dups = findDuplicateBodies([cands]);
  assert.equal(dups.length, 0, '仅 2 处重复不应报（≥3 才抽）');
});

// ---------- checks 层 ----------

test('dup-code：checkDuplicateCode 跨文件聚合 ≥3 处 → finding（severity warning）', () => {
  const mk = (fnName) => `
function ${fnName}(row) {
  const name = String(row.name || '').trim();
  const age = Number(row.age) || 0;
  if (name && age > 0) return { name, age };
  return null;
}
`;
  const fileTexts = [
    { path: 'src/a.js', text: mk('parseA') },
    { path: 'src/b.js', text: mk('parseB') },
    { path: 'src/c.js', text: mk('parseC') },
  ];
  const findings = checkDuplicateCode(fileTexts, [{ id: 'maintainability/no-duplicate-code', severity: 'warning', dimensions: ['可维护性'] }]);
  assert.equal(findings.length, 1, `应有 1 条 finding（实际 ${findings.length}）`);
  assert.equal(findings[0].severity, 'warning', 'severity 恒 warning（最高只警告不拦截）');
  assert.ok(findings[0].message.includes('重复'), 'message 应说明重复（实际 ' + findings[0].message + '）');
});

test('dup-code：test 夹具目录不报', () => {
  const mk = (fnName) => `
function ${fnName}(row) {
  const name = String(row.name || '').trim();
  const age = Number(row.age) || 0;
  if (name && age > 0) return { name, age };
  return null;
}
`;
  const fileTexts = [
    { path: 'test/a.test.js', text: mk('parseA') },
    { path: 'test/b.test.js', text: mk('parseB') },
    { path: 'test/c.test.js', text: mk('parseC') },
  ];
  const findings = checkDuplicateCode(fileTexts, [{ id: 'maintainability/no-duplicate-code', severity: 'warning' }]);
  assert.equal(findings.length, 0, 'test/ 夹具不应报重复');
});

test('dup-code：布尔 flag 参数 / 参数过多 → 不报（伪公共）', () => {
  const mk = (fnName, params) => `
function ${fnName}(${params}) {
  const a = Number(x) || 0;
  const b = Number(y) || 0;
  if (a > 0 && b > 0) return a + b;
  return 0;
}
`;
  // 3 个带布尔 flag 的相同结构
  const fileTexts = [
    { path: 'src/a.js', text: mk('fA', 'x, y, force') },
    { path: 'src/b.js', text: mk('fB', 'x, y, force') },
    { path: 'src/c.js', text: mk('fC', 'x, y, force') },
  ];
  const findings = checkDuplicateCode(fileTexts, [{ id: 'maintainability/no-duplicate-code', severity: 'warning' }]);
  assert.equal(findings.length, 0, '布尔 flag 参数的伪公共函数不应报');
});
