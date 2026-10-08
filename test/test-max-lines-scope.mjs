/**
 * max-lines 的**作用域声明驱动**回归测试（方案 A 的契约锁定）。
 *
 * 钉子（四态 + 兜底 + 不误伤）：
 *   ① 规则声明 scope_rules: dsh-client-entry → downgrade，且 fileScope 命中 → info 且不扣分
 *   ② 同声明 action: exempt，且 fileScope 命中 → **不出现在报告里**（静默豁免）
 *   ③ 普通文件超阈值（无作用域命中）→ 仍按规则分级 warning/blocker（**不得被误降级**）
 *   ④ 声明存在但 fileScope **不匹配** → 同样不降级（作用域是精确匹配，不是"有声明就降"）
 *   ⑤ 过渡兜底：未传 fileScope 但文件名为 client.js → 仍降级（迁移期行为不变；接通后删兜底）
 *   ⑥ 未超阈值 → 无命中
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkMaxLines } from '../lib/checks/structural.js';
import { normalizeScopeRules } from '../lib/rule/scope.js';

const RULE = { id: 'readability/max-file-length', severity: 'warning', threshold: 400 };
/** 500 行代码（超 400 → warning；未到 800 → 不 blocker）。 */
const BIG = 'const a = 1;\n'.repeat(500);
const HUGE = 'const a = 1;\n'.repeat(900);

/** 造一条带 scope_rules 的规则。 */
function withScope(action) {
  return { ...RULE, scopeRules: normalizeScopeRules({ scope_rules: [{ scope: 'dsh-client-entry', action }] }) };
}

test('① 声明 downgrade + fileScope 命中 → info 且 scoreImpact 0（仍报不排除）', () => {
  const r = checkMaxLines({ file: 'lib/client.js', text: BIG, rules: [withScope('downgrade')], fileScope: 'dsh-client-entry' });
  assert.equal(r.length, 1, '仍出现在报告里（不静默排除）');
  assert.equal(r[0].severity, 'info');
  assert.equal(r[0].scoreImpact, 0);
  assert.match(r[0].message, /DSH 要求客户端为\*\*单文件\*\*/);
});

test('② 声明 exempt + fileScope 命中 → 无命中（静默豁免）', () => {
  const r = checkMaxLines({ file: 'lib/client.js', text: BIG, rules: [withScope('exempt')], fileScope: 'dsh-client-entry' });
  assert.deepEqual(r, []);
});

test('③ 普通文件超阈值 → 仍按规则分级（不得被误降级）', () => {
  const warn = checkMaxLines({ file: 'lib/x.js', text: BIG, rules: [RULE] });
  assert.equal(warn[0].severity, 'warning');
  // 等级由 capSeverity 封顶在**规则自身 severity**（本规则声明 warning）→ 超 block 阈值也不升 blocker。
  //   若要真的 blocker，需规则自身 severity: blocker；这里钉的是「不被降级为 info」这一侧。
  const block = checkMaxLines({ file: 'lib/x.js', text: HUGE, rules: [RULE] });
  assert.equal(block[0].severity, 'warning', 'capSeverity 封顶：不因超 block 阈值而越过规则声明');
  assert.notEqual(block[0].severity, 'info', '普通大文件不得被误降级');
  const asBlocker = checkMaxLines({ file: 'lib/x.js', text: HUGE, rules: [{ ...RULE, severity: 'blocker' }] });
  assert.equal(asBlocker[0].severity, 'blocker', '规则声明 blocker 时超 block 阈值即为 blocker');
});

test('④ 有声明但 fileScope 不匹配 → 不降级（精确匹配）', () => {
  const r = checkMaxLines({ file: 'lib/x.js', text: BIG, rules: [withScope('downgrade')], fileScope: 'src' });
  assert.equal(r[0].severity, 'warning', '作用域不匹配时按规则自身分级');
});

test('⑤ 无 fileScope（调度层未推导出作用域）→ 不降级，按规则分级', () => {
  const r = checkMaxLines({ file: 'lib/client.js', text: BIG, rules: [RULE] });
  assert.equal(r[0].severity, 'warning', '降级只由 yml 声明驱动（写死正则的过渡兜底已删）');
});

test('⑥ 未超阈值 → 无命中', () => {
  assert.deepEqual(checkMaxLines({ file: 'lib/small.js', text: 'const a = 1;\n'.repeat(10), rules: [RULE] }), []);
});
