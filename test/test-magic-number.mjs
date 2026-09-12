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
  const text = [
    'const timeout = 30000;',
    'const limit = 100;',
    'const chunkSize = 4096;',
    'const retryDelay = 2000;',
    '',
  ].join('\n');
  const found = hits(text);
  assert.ok(found.length >= 1, '魔数上下文应命中');
  for (const h of found) assert.equal(h.kind, 'magic-number-smart', 'kind 应为 magic-number-smart');
  for (const h of found) assert.equal(h.severity, 'warning', 'severity warning');
  // 单数字（\b\d{2,}\b 不覆盖 1-9）与合法常量上下文不误报
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