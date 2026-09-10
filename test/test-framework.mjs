/**
 * 框架冒烟测试：npm test 可复现（node --test test/*.mjs）。
 * 覆盖：注册表行为 / 装载 / 评分 / 豁免 / CLI 参数解析。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registerCompiler, compileRule, compileAllRules, RULE_COMPILERS } from '../lib/rule/registry.js';
import { loadRuleFiles, RULE_SLOTS, discoverRuleSlots } from '../lib/rule/loader.js';
import { scoreQuality, DEFAULT_WEIGHTS, DIMENSION_ORDER } from '../lib/score/index.js';
import { EXEMPT_MARKERS, hasHeaderExempt, hasLineExempt, exemptHintFor } from '../lib/exempt/index.js';
import { parseArgv } from '../cli.mjs';

test('注册表：registerCompiler 后 compileRule 按 detect 指派', () => {
  registerCompiler('test-kind-a', (r) => r.path_pattern, (r) => ({ ok: true, rule: { kind: 'path-regex', dimensions: ['文档'] } }));
  const res = compileRule({ path_pattern: '*.md' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'path-regex');
});

test('注册表：显式 kind 优先于字段探测', () => {
  const res = compileRule({ kind: '不存在的kind' });
  assert.equal(res.ok, false);
  assert.match(res.error, /未知规则类型/);
});

test('注册表：compileRule 对字段可自动探测', () => {
  // 无 kind、无已知字段 → 报错而非静默跳过
  const res = compileRule({ id: 'x', name: '未知' });
  assert.equal(res.ok, false);
  assert.match(res.error, /无法识别规则类型/);
});

test('注册表：compileAllRules 收集错误不中断', () => {
  const ctx = { errors: [] };
  const out = compileAllRules([{ id: 'bad', name: '未知规则' }], ctx);
  assert.equal(out.length, 0);
  assert.equal(ctx.errors.length, 1);
});

test('装载：槽位全动态——由目录文件决定，放文件即生效', () => {
  const discovered = discoverRuleSlots();
  // 已建槽位必在发现列表里
  assert.ok(discovered.includes('nodejs'));
  assert.ok(discovered.includes('docs'));
  // 默认装载不报缺失：只装目录里真实存在的槽位
  const r = loadRuleFiles();
  assert.equal(r.errors.length, 0, `不应报缺失：${r.errors.join('; ')}`);
  for (const slot of r.order) assert.ok(discovered.includes(slot), `${slot} 应实际存在`);
  // template 默认不加载（模板保持为空，不进默认装载）
  assert.ok(!r.order.includes('template'));
});

test('装载：loadRuleFiles 对缺失槽位不崩溃，返回错误收集', () => {
  // audit-rules 目录尚未落任何 yml → 全部槽位报缺失，但函数正常返回
  const r = loadRuleFiles(['nodejs']);
  assert.equal(typeof r.ok, 'boolean');
  assert.ok(Array.isArray(r.errors));
});

test('评分：10 维度权重合计 100', () => {
  const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(total, 100);
  assert.equal(DIMENSION_ORDER.length, 10);
});

test('评分：无问题 → 满分 A 级', () => {
  const q = scoreQuality([]);
  assert.equal(q.score, 100);
  assert.equal(q.level, 'A');
});

test('评分：blocker 扣分重于 warning', () => {
  const q = scoreQuality([
    { severity: 'warning', dimensions: ['可读性'] },
    { severity: 'blocker', dimensions: ['安全性'] },
  ]);
  assert.ok(q.counts['可读性'] === 1);
  assert.ok(q.counts['安全性'] === 2);
});

test('豁免：7 类标记注册齐全', () => {
  assert.equal(Object.keys(EXEMPT_MARKERS).length, 7);
  assert.ok(EXEMPT_MARKERS['dsh-skip-sensitive']);
  assert.ok(EXEMPT_MARKERS['dsh-skip-func-length']);
});

test('豁免：文件头检测只看前 3 行', () => {
  const text = '// dsh-skip-sensitive: 测试\nconst a = 1;\n';
  assert.equal(hasHeaderExempt(text, 'dsh-skip-sensitive'), true);
  assert.equal(hasHeaderExempt('line1\nline2\nline3\nline4 dsh-skip-sensitive', 'dsh-skip-sensitive'), false);
});

test('豁免：行级检测', () => {
  assert.equal(hasLineExempt('const x = 1; // dsh-skip-sensitive', 'dsh-skip-sensitive'), true);
  assert.equal(hasLineExempt('const x = 1;', 'dsh-skip-sensitive'), false);
});

test('豁免：exemptHintFor 反查 non-empty', () => {
  const hint = exemptHintFor('func-lines');
  assert.ok(typeof hint === 'string' && hint.length > 0);
  assert.match(hint, /dsh-skip-func-length/);
});

test('CLI：parseArgv 支持 --depth 与 --full', () => {
  const { flags, positional } = parseArgv(['.', '--depth', '5']);
  assert.equal(flags.depth, 5);
  assert.equal(positional[0], '.');
  const { flags: f2 } = parseArgv(['--full', '/tmp']);
  assert.equal(f2.full, true);
});

test('CLI：未知参数报错（不走 HELP 静默）', () => {
  const { error } = parseArgv(['--not-exist']);
  assert.match(error, /未知参数/);
});

test('发现槽位：空目录不崩溃', () => {
  const slots = discoverRuleSlots('/tmp/nonexistent-dir-for-test');
  assert.ok(Array.isArray(slots));
  assert.equal(slots.length, 0);
});