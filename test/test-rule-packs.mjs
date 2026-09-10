/**
 * 规则总入口测试：编译函数注册 / 字段探测指派 / 显式 kind / dimensions 绑定 /
 * 正则安全编译 / 槽位配置驱动 / 装载合并。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../lib/rule/compilers.js'; // 副作用导入：注册编译函数
import { compileRule, compileAllRules, RULE_COMPILERS } from '../lib/rule/registry.js';
import { loadRuleFiles, RULE_SLOTS, resolveSlotOrder, discoverRuleSlots } from '../lib/rule/loader.js';
import { safeRe } from '../lib/rule/compilers.js';

test('注册表：编译函数已注册（含 credential-ref / credential-file / [FUNC]）', () => {
  const kinds = RULE_COMPILERS.map((e) => e.kind);
  for (const k of ['credential-ref', 'credential-file', '[FUNC]', 'func-lines',
    'min-length', 'max-lines', 'max-complexity', 'max-depth', 'min-occurrences', 'repeated-string',
    'regex', 'path-regex', 'semantic', 'link-check']) {
    assert.ok(kinds.includes(k), `缺 ${k}`);
  }
});

test('字段探测：id 前缀 credref- → credential-ref', () => {
  const res = compileRule({ id: 'credref-plain-text', name: '明文凭据', pattern: 'x' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'credential-ref');
});

test('字段探测：id 前缀 credfile- → credential-file', () => {
  const res = compileRule({ id: 'credfile-key-file', name: '私钥路径', pattern: 'x' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'credential-file');
});

test('字段探测：id 前缀 [FUNC]- → [FUNC]', () => {
  const res = compileRule({ id: '[FUNC]-aws', name: 'AWS', pattern: 'AKIA' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, '[FUNC]');
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

test('dimensions 绑定：[FUNC] → 安全性', () => {
  const res = compileRule({ id: '[FUNC]-x', name: 'x', pattern: 'y' });
  assert.deepEqual(res.rule.dimensions, ['安全性']);
});

test('未知规则：既无 kind 也无字段 → 报错不静默', () => {
  const res = compileRule({ id: 'unknown', name: '无字段规则' });
  assert.equal(res.ok, false);
  assert.match(res.error, /无法识别/);
});

test('未知显式 kind → 报错', () => {
  const res = compileRule({ id: 'z', kind: 'not-a-kind', name: 'z' });
  assert.equal(res.ok, false);
  assert.match(res.error, /未知规则类型/);
});

// ---------- 装载与编译（nodejs 槽位） ----------
test('装载：nodejs 槽位 yml 已落地，编译全部成功', () => {
  const r = loadRuleFiles(['nodejs']);
  assert.ok(RULE_SLOTS.includes('nodejs'));
  assert.equal(r.ok, true, `errors: ${r.errors.join('; ')}`);
  assert.equal(r.files.length, 1, 'nodejs 文件应成功加载');
});

test('装载：nodejs 槽位 11 条全编译', () => {
  const r = loadRuleFiles(['nodejs']);
  const ctx = { errors: [] };
  const compiled = compileAllRules(r.merged.rules, ctx);
  assert.equal(compiled.length, 11, `编译 ${compiled.length} 条`);
  assert.equal(ctx.errors.length, 0, `errors: ${ctx.errors.join('; ')}`);
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
  assert.equal(byKind['[FUNC]'], 2, '2 条 [FUNC]');
  assert.equal(byKind['credential-file'], 1);
  assert.equal(byKind['func-lines'], 1);
  assert.equal(byKind['regex'], 2);
  assert.equal(byKind['path-regex'], 1);
  assert.equal(byKind['semantic'], 1);
  assert.equal(byKind['repeated-string'], 1);
  assert.equal(byKind['min-length'], 1);
  assert.equal(byKind['max-complexity'], 1);
});

// ---------- 正则安全编译（1.0.x 修复：大小写不敏感防漏检） ----------
test('safeRe：默认大小写不敏感（驼峰/大写凭据写法不漏检）', () => {
  const errs = [];
  const re = safeRe('\\bapi[_-]?key\\s*=\\s*[\'"][^\'"]{12,}[\'"]', 'generic-token', errs);
  // 规则测试样本（非真实凭据）：字符串拼接构造，避免明文凭据入库
  const sample = 'sk-' + '1234567890abcdefghijklmn';
  const hitCamel = 'const api' + 'Key = ' + JSON.stringify(sample);
  const hitUpper = 'const API' + '_KEY = ' + JSON.stringify(sample);
  const hitSnake = 'const api' + '_key = ' + JSON.stringify(sample);
  assert.ok(re.test(hitCamel), 'apiKey 驼峰应命中');
  assert.ok(re.test(hitUpper), 'API_KEY 大写应命中');
  assert.ok(re.test(hitSnake), 'api_key 下划线应命中');
});

test('safeRe：(?-i) 可显式要求大小写敏感', () => {
  const errs = [];
  const re = safeRe('(?-i)TOKEN', 'x', errs);
  assert.ok(re.test('TOKEN'));
  assert.ok(!re.test('token'));
});

test('safeRe：(?i) 前缀合法（同义写法不报错）', () => {
  const errs = [];
  const re = safeRe('(?i)abc', 'x', errs);
  assert.equal(errs.length, 0);
  assert.ok(re.test('ABC'));
});

test('safeRe：非法正则不抛异常，收集错误返回 null', () => {
  const errs = [];
  const re = safeRe('([unclosed', 'bad', errs);
  assert.equal(re, null);
  assert.equal(errs.length, 1);
});

// ---------- 槽位配置驱动（槽位不写死，可配置顺序） ----------
test('槽位：resolveSlotOrder 默认取 RULE_SLOTS ∩ 目录实际文件', () => {
  const slots = resolveSlotOrder();
  assert.ok(slots.includes('nodejs'));
  for (const s of slots) assert.ok(discoverRuleSlots().includes(s), `${s} 应实际存在`);
});

test('槽位：显式配置数组生效（配置驱动，不写死）', () => {
  const slots = resolveSlotOrder(['docs']);
  assert.deepEqual(slots.filter((s) => s !== 'nodejs'), ['docs']);
});

test('槽位：逗号分隔字符串配置生效', () => {
  const slots = resolveSlotOrder('docs,nodejs');
  assert.equal(slots[0], 'docs');
  assert.equal(slots[1], 'nodejs');
});

test('槽位：未落文件的槽位静默跳过（不报缺失）', () => {
  const slots = resolveSlotOrder(['npm', 'nodejs']);
  assert.ok(!slots.includes('npm'), 'npm 未落文件应跳过');
  assert.ok(slots.includes('nodejs'));
});

test('槽位：目录新增槽位自动追加（新 yml 放进去即生效）', () => {
  const slots = resolveSlotOrder(['nodejs']);
  for (const s of discoverRuleSlots()) {
    if (s !== 'template') assert.ok(slots.includes(s), `${s} 应自动追加`);
  }
});

test('槽位：template 默认不加载（模板保持为空）', () => {
  assert.ok(!resolveSlotOrder().includes('template'));
});

test('槽位：环境变量 DSH_GIT_PUSH_RULE_SLOTS 可配置（脱离 DSH 时用）', () => {
  process.env.DSH_GIT_PUSH_RULE_SLOTS = 'docs';
  try {
    const slots = resolveSlotOrder();
    assert.equal(slots[0], 'docs');
  } finally { delete process.env.DSH_GIT_PUSH_RULE_SLOTS; }
});

test('装载：loadRuleFiles 无参走配置驱动（向后兼容数组入参）', () => {
  const r = loadRuleFiles();
  assert.equal(r.ok, true);
  assert.ok(r.merged.rules.length > 0);
  assert.ok(r.order.length > 0, '应返回生效槽位顺序');
  assert.equal(r.errors.length, 0, '已建槽位不应报缺失');
});
