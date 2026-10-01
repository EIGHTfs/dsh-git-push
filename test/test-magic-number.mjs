// dsh-skip-sensitive: 测试 fixture 含 mock token 字面量（非真实凭据）
/**
 * 1.0.7 硬编码魔数检测（magic-number-smart，版本号豁免版）测试。
 * 场景对照（用户 2026-09-12 YAML）：检测 \b\d{2,}\b / 0x 十六进制 / 小数，
 * 豁免版本号/日期时间/HTTP 状态码/常见合法常量/状态枚举；magic_number_hints
 * 上下文内数字报魔数，legitimate_hints 上下文内数字豁免；同一数字 ≥3 次强制标记。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMagicNumberSmart, groupByKind } from '../lib/audit/checks.js';
import { compileAllRules } from '../lib/rule/registry.js';
import { loadRuleFiles } from '../lib/rule/loader.js';

const RULE = { id: 'readability/magic-number-smart', kind: 'magic-number-smart', severity: 'warning' };

function hits(text) {
  return checkMagicNumberSmart({ file: 'magic-test.js', text, rules: [RULE] });
}

test('magic-number-smart：版本号/日期/HTTP 状态码/常见常量豁免', () => {
  const text = [
    'const VERSION = "1.2.3";',
    'const pkg = "v2.0.1";',
    'const today = "2026-09-12";',
    'const ts = 1784000000000;',
    'const hour = 18;',
    'if (res.status === 404) return;',
    'const code = 500;',
    'const PAGE = 10;',
    'const KB = 1024;',
    'const DAY = 86400;',
    'const version = "3.14.0";',
    'const status = 200;',
    '',
  ].join('\n');
  assert.equal(hits(text).length, 0, '全部豁免场景不应命中');
});

test('magic-number-smart：魔数上下文（magic_number_hints）命中', () => {
  // 更新：`const timeout = 30000` 这类「变量名表意」的赋值已是命名常量（定义值），
  //   新规则豁免（isNamedConstantValue 放宽：含 timeout/limit/size/… 语义词尾的变量名算常量）。
  //   真魔数上下文 = 数字出现在 callback/调用/运算里且无表意变量名——如 setTimeout(…, 30000)。
  const text = [
    'setTimeout(fn, 30000);',
    'fetch(url, { timeout: 100 });',
    'while (q.length > 4096) {}',
    '',
  ].join('\n');
  const found = hits(text);
  assert.ok(found.length >= 1, '魔数上下文应命中');
  for (const h of found) assert.equal(h.kind, 'magic-number-smart', 'kind 应为 magic-number-smart');
  for (const h of found) assert.equal(h.severity, 'warning', 'severity warning');
});

test('magic-number-smart：同一数字 ≥3 次强制标记且合并 1 条', () => {
  const text = ['const a = 777;', 'const b = 777;', 'const c = 777;', ''].join('\n');
  const found = hits(text);
  assert.equal(found.length, 1, '跨行同数字合并为 1 条');
  assert.match(found[0].message, /777/, 'message 含具体数字');
});

test('magic-number-smart：普通无上下文数字不强制时报（count<3 且非魔数上下文）', () => {
  // \b\d{2,}\b 会匹配 42，但无魔数上下文且非重复 → 不报（只报上下文或重复）
  const text = 'const total = 42;\n';
  assert.equal(hits(text).length, 0, '无上下文单次数字不报');
});

test('magic-number-smart：yml 规则可编译且走 groupByKind 分组', () => {
  const loaded = loadRuleFiles(['nodejs']);
  assert.equal(loaded.ok, true, 'nodejs yml 加载成功');
  const rules = loaded.merged.rules || [];
  const compiled = compileAllRules(rules);
  assert.ok(compiled.some((r) => r.kind === 'magic-number-smart'), 'nodejs yml 应编译出 magic-number-smart');
  const grouped = groupByKind(compiled);
  assert.ok(Array.isArray(grouped['magic-number-smart']), 'grouped[magic-number-smart] 应存在');
});

// ---------- 2026-09-27 误报修复防回归 ----------
test('magic-number-smart：对象字面量常量定义豁免（const X = { width: 1400 }）', () => {
  const text = 'const SHOT_VIEWPORT = { width: 1400, height: 900 };\n';
  assert.equal(hits(text).length, 0, '对象字面量常量定义值不报（建议提取常量自相矛盾）');
});

test('magic-number-smart：非常量声明的对象数字仍报', () => {
  const text = 'function f() { return { width: 1400 }; }\n';
  assert.ok(hits(text).length >= 1, '非命名常量的对象数字照报');
});

test('magic-number-smart：rgba 色值豁免（255 是 RGB 通道上限）', () => {
  const text = '  --x: rgba(255,255,255,.08);\n';
  assert.equal(hits(text).length, 0, 'rgba 色值 255 不报');
  assert.ok(hits('setValue(255);\n').length >= 1, '非色值上下文的裸 255 照报');
});
// ---------- 2026-09-30：配置类形态豁免（Pawchive 误报核对落地） ----------

test('magic-number-smart：env 兜底默认值（Number(env) || N / ?? N）豁免', () => {
  assert.equal(hits('const a = Number(env) || 3000;\n').length, 0, '|| 兜底不报');
  assert.equal(hits('const b = process.env.X ?? 60000;\n').length, 0, '?? 兜底不报');
});

test('magic-number-smart：配置语义属性值豁免（pageSize/apiTimeoutMs），普通对象照报', () => {
  assert.equal(hits('const CONFIG = { pageSize: 50 };\n').length, 0, '配置字段 pageSize 不报');
  assert.equal(hits('const CONFIG = { apiTimeoutMs: 30000 };\n').length, 0, '配置字段 apiTimeoutMs 不报');
  assert.ok(hits('function f() { return { width: 1400 }; }\n').length >= 1, '普通对象 width 照报');
});

test('magic-number-smart：member 赋值默认值（CONFIG.pageSize = 50）豁免', () => {
  assert.equal(hits('CONFIG.pageSize = 50;\n').length, 0, 'member 赋值配置字段不报');
});

// ---------- 2026-10-05：Pawchive 驱动豁免扩展（env 兜底已 1.12.1；本次 const 表意/嵌套常量/阈值/AbortSignal） ----------

test('magic-number-smart：const 表意名豁免（barW），单字母 const 仍报', () => {
  assert.equal(hits('const barW = 18;\n').length, 0, 'const 表意名（≥3 字符）不报');
  assert.ok(hits('const a = 777;\n').length >= 1, '单字母 const 仍报（非表意）');
});

test('magic-number-smart：命名常量嵌套对象/数组内值豁免（MAGIC 文件头）', () => {
  assert.equal(hits('const MAGIC = { JPEG: [0xff, 0xd8], PNG: [0x89, 0x50] };\n').length, 0, 'const 常量对象嵌套数组值不报');
});

test('magic-number-smart：比较阈值豁免（n < 1048576）', () => {
  assert.equal(hits('const x = n < 1048576 ? 1 : 2;\n').length, 0, '比较运算符后阈值不报');
});

test('magic-number-smart：AbortSignal.timeout 配置豁免；setTimeout 回调用时长仍报', () => {
  assert.equal(hits('signal: AbortSignal.timeout(5000),\n').length, 0, 'AbortSignal.timeout 参数不报');
  assert.ok(hits('setTimeout(fn, 30000);\n').length >= 1, 'setTimeout 回调用时长是魔数上下文仍报');
});
