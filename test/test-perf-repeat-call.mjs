/**
 * 性能规则回归测试：同一循环体内重复调用同一函数（performance/repeat-identical-call）。
 *
 * 真实案例（规则来源）：外部项目 `packages/core/src/indexer/symbol-table.ts` 的
 *   `resolveModuleToFilePath` 在解析循环里被调用 **8762 次**（约 180 次/文件），累计 **4581ms**，
 *   占全量扫描 **89%**；同期 fs 同步探测只有 191 次/11ms —— 瓶颈是重复纯计算，不是 I/O。
 *   加一层 Map 记忆化后：该函数 4581ms → 344ms，整体 5143ms → 763ms（6.7×）。
 *
 * 边界（宁可漏报不误报）：只比「函数名 + 实参文本完全相同」的调用；实参不同的重复不报
 *   （无法静态判断哪个更贵）；只匹配无嵌套括号的调用；排除注释/字符串里的示例。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repeatIdenticalCallLines } from '../lib/ast/perf.js';
import { checkRegexRules } from '../lib/checks/regex.js';

const IN_LOOP_SAME_ARGS = [
  'for (const imp of imports) {',
  '  const a = resolveModuleToFilePath(filePath, imp.modulePath);',
  '  const b = resolveModuleToFilePath(filePath, imp.modulePath);',
  '  use(a, b);',
  '}',
].join('\n');

const IN_LOOP_DIFF_ARGS = [
  'for (const imp of imports) {',
  '  const a = resolveModuleToFilePath(filePath, imp.a);',
  '  const b = resolveModuleToFilePath(filePath, imp.b);',
  '}',
].join('\n');

const OUTSIDE_LOOP = [
  'const a = resolveModuleToFilePath(filePath, p);',
  'const b = resolveModuleToFilePath(filePath, p);',
].join('\n');

test('循环体内实参完全相同的重复调用 → 命中第 3 行', () => {
  const lines = repeatIdenticalCallLines(IN_LOOP_SAME_ARGS);
  assert.equal(lines.size, 1, '恰好命中一处（第二次调用的那一行）');
  assert.ok(lines.has(3), '命中第 3 行');
});

test('实参不同的重复调用 → 不命中（无法静态判断哪个更贵）', () => {
  assert.equal(repeatIdenticalCallLines(IN_LOOP_DIFF_ARGS).size, 0);
});

test('循环外的重复调用 → 不命中', () => {
  assert.equal(repeatIdenticalCallLines(OUTSIDE_LOOP).size, 0);
});

test('注释/字符串里的示例 → 不命中（allow 语义需自查，避免自报假阳性）', () => {
  const text = [
    'for (const x of xs) {',
    '  // 示例：resolveModuleToFilePath(filePath, p); resolveModuleToFilePath(filePath, p);',
    '  const s = "resolveModuleToFilePath(filePath, p);";',
    '  real(x);',
    '}',
  ].join('\n');
  assert.equal(repeatIdenticalCallLines(text).size, 0);
});

test('端到端：checkRegexRules 以 allow 语义只在循环体内报该规则', () => {
  const rule = {
    id: 'performance/repeat-identical-call',
    name: '同一循环体内重复调用同一函数',
    severity: 'warning',
    astConfirmKind: 'repeat-identical-call',
    subPatterns: [{ id: 'repeated-call', regex: /[A-Za-z_$][\w.$]*\s*\([^()]*\)/, message: '循环体内重复调用（实参相同）' }],
  };
  const hit = checkRegexRules({ file: 'a.ts', text: IN_LOOP_SAME_ARGS, rules: [rule] });
  assert.equal(hit.length, 1, '循环体内命中一次');
  assert.equal(hit[0].ruleId || hit[0].rule, 'performance/repeat-identical-call');
  assert.equal(checkRegexRules({ file: 'a.ts', text: IN_LOOP_DIFF_ARGS, rules: [rule] }).length, 0, '实参不同不报');
});
