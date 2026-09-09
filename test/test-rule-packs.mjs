/**
 * 规则总入口测试：编译函数注册 / 字段探测指派 / 显式 kind / dimensions 绑定 / 装载合并。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../lib/rule/compilers.js'; // 副作用导入：注册 13 种编译函数
import { compileRule, compileAllRules, RULE_COMPILERS } from '../lib/rule/registry.js';
import { loadRuleFiles, RULE_SLOTS } from '../lib/rule/loader.js';

test('注册表：13 种编译函数已注册', () => {
  const kinds = RULE_COMPILERS.map((e) => e.kind);
  for (const k of ['credential-ref', 'credential-file', 'secret', 'func-lines',
    'min-length', 'max-lines', 'max-complexity', 'max-depth', 'min-occurrences', 'repeated-string',
    'regex', 'path-regex', 'semantic']) {
    assert.ok(kinds.includes(k), `缺 ${k}`);
  }
});

test('字段探测：id 前缀 credref- → credential-ref', () => {
  const res = compileRule({ id: 'credref-plain-secret', name: '明文凭据', pattern: 'x' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'credential-ref');
});

test('字段探测：id 前缀 secret- → secret', () => {
  const res = compileRule({ id: 'secret-aws', name: 'AWS', pattern: 'AKIA' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'secret');
});

test('字段探测：path_pattern → path-regex（非 credfile 前缀）', () => {
  const res = compileRule({ id: 'path/x', name: '路径规则', path_pattern: '.*\\.key$' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'path-regex');
});

test('字段探测：max_complexity → max-complexity', () => {
  const res = compileRule({ id: 'c1', name: '复杂度', max_complexity: 10 });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'max-complexity');
  assert.equal(res.rule.threshold, 10);
});

test('数值拆分：min_occurrences + ignore_values → repeated-string', () => {
  const res = compileRule({ id: 'r1', name: '重复串', min_occurrences: 3, ignore_values: ['', ' '] });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'repeated-string');
  assert.deepEqual(res.rule.ignoreValues, ['', ' ']);
});

test('数值拆分：min_occurrences 无 ignore → min-occurrences', () => {
  const res = compileRule({ id: 'm1', name: '重复数', min_occurrences: 5 });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'min-occurrences');
});

test('显式 kind 优先：kind: path-regex + pattern 字段 → path-regex', () => {
  const res = compileRule({ id: 'p1', kind: 'path-regex', name: '路径', pattern: 'x', path_pattern: 'y' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'path-regex');
});

test('dimensions 绑定：func-lines → 可读性+可维护性（多维度）', () => {
  const res = compileRule({ id: 'func-lines', name: '函数超长', max_lines: 50 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.rule.dimensions, ['可读性', '可维护性']);
});

test('dimensions 绑定：secret → 安全性', () => {
  const res = compileRule({ id: 'secret-x', name: 'x', pattern: 'y' });
  assert.deepEqual(res.rule.dimensions, ['安全性']);
});

test('未知规则：既无 kind 也无字段 → 报错不静默', () => {
  const res = compileRule({ id: 'unknown', name: '无字段规则' });
  assert.equal(res.ok, false);
  assert.match(res.error, /无法识别规则类型/);
});

test('未知显式 kind → 报错', () => {
  const res = compileRule({ id: 'z', kind: 'not-a-kind', name: 'z' });
  assert.equal(res.ok, false);
  assert.match(res.error, /未知规则类型/);
});

test('装载：nodejs 槽位 yml 已落地，编译全部成功', () => {
  assert.ok(RULE_SLOTS.includes('nodejs'));
  const r = loadRuleFiles(['nodejs']);
  assert.equal(r.ok, true, `errors: ${r.errors.join('; ')}`);
  assert.equal(r.files.length, 1, 'nodejs 文件应成功加载');
});

test('装载→编译闭环：nodejs 槽位 11 条全编译', () => {
  const r = loadRuleFiles(['nodejs']);
  const ctx = { errors: [] };
  const compiled = compileAllRules(r.merged.rules, ctx);
  assert.equal(compiled.length, 11, `编译 ${compiled.length} 条`);
  assert.equal(ctx.errors.length, 0, `errors: ${ctx.errors.join('; ')}`);
  // 每条都带 dimensions 和 kind
  for (const c of compiled) {
    assert.ok(Array.isArray(c.dimensions) && c.dimensions.length > 0, `${c.id} 缺 dimensions`);
    assert.ok(typeof c.kind === 'string' && c.kind, `${c.id} 缺 kind`);
  }
});

test('编译统计：各 kind 分桶正确', () => {
  const r = loadRuleFiles(['nodejs']);
  const compiled = compileAllRules(r.merged.rules, { errors: [] });
  const byKind = {};
  for (const c of compiled) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  assert.equal(byKind['secret'], 2, '2 条 secret');
  assert.equal(byKind['credential-file'], 1);
  assert.equal(byKind['func-lines'], 1);
  assert.equal(byKind['regex'], 2);
  assert.equal(byKind['path-regex'], 1);
  assert.equal(byKind['semantic'], 1);
  assert.equal(byKind['repeated-string'], 1);
  assert.equal(byKind['min-length'], 1);
  assert.equal(byKind['max-complexity'], 1);
});