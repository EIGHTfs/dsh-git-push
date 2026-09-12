// dsh-skip-sensitive: 测试 fixture 含 mock token 字面量（ghp_ 非真实凭据）
// dsh-skip-residue: 测试 fixture 含 debugger 关键词样本（规则定义示范文本）
/**
 * 豁免总入口测试（0.1.6）：7 标记全消费 + 位置语义（文件头整文件 / 行内单点）逐类验证。
 * 场景对照：旧项目 12 个豁免场景（文件头 sensitive/size/func-length/syntax/quality/residue/style
 * + 行尾 sensitive/residue/func-length 单点 + 豁免不越权 + 未豁免照常报）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXEMPT_MARKERS, hasHeaderExempt, hasLineExempt, exemptForFinding, exemptHintFor,
} from '../lib/exempt/index.js';

/** 构造最小 finding。 */
function f(kind, rule, line = 3) {
  return { file: 'a.js', line, rule: rule || kind, kind, severity: kind.startsWith('secret') ? 'blocker' : 'warning', dimensions: [], exemptHint: '', scoreImpact: 1 };
}

const SENSITIVE_TEXT = '// dsh-skip-sensitive: 测试含 mock token\n// 第二行\n// 第三行\nconst x = 1;';

// ---------- 注册表完整性 ----------
test('注册表：7 个标记齐全', () => {
  const markers = Object.keys(EXEMPT_MARKERS);
  assert.deepEqual(markers.sort(), [
    'dsh-skip-func-length', 'dsh-skip-quality', 'dsh-skip-residue',
    'dsh-skip-sensitive', 'dsh-skip-size', 'dsh-skip-style', 'dsh-skip-syntax',
  ].sort());
});

test('注册表：每个标记都有 blocked 声明与 hint', () => {
  for (const [m, meta] of Object.entries(EXEMPT_MARKERS)) {
    assert.ok(Array.isArray(meta.blocked) && meta.blocked.length > 0, `${m} 缺 blocked`);
    assert.ok(typeof meta.hint === 'string' && meta.hint.length > 0, `${m} 缺 hint`);
  }
});

test('注册表：sensitive/quality/func-length/residue 支持行级', () => {
  assert.equal(EXEMPT_MARKERS['dsh-skip-sensitive'].lineLevel, true);
  assert.equal(EXEMPT_MARKERS['dsh-skip-quality'].lineLevel, false);
  assert.equal(EXEMPT_MARKERS['dsh-skip-residue'].lineLevel, true);
  assert.equal(EXEMPT_MARKERS['dsh-skip-func-length'].lineLevel, true);
});

// ---------- 文件头豁免（整文件）----------
test('文件头 dsh-skip-sensitive → secret 整文件豁免', () => {
  assert.equal(hasHeaderExempt(SENSITIVE_TEXT, 'dsh-skip-sensitive'), true);
  assert.equal(exemptForFinding(f('secret', 'secret-aws-access-key'), SENSITIVE_TEXT), true);
  assert.equal(exemptForFinding(f('credential-ref', 'secret-generic-token'), SENSITIVE_TEXT), true);
  assert.equal(exemptForFinding(f('path-regex', 'path-private-key-location'), SENSITIVE_TEXT), true);
});

test('文件头 dsh-skip-sensitive → credential-file 豁免', () => {
  assert.equal(exemptForFinding(f('credential-file', 'credfile-key-file'), SENSITIVE_TEXT), true);
});

test('文件头 dsh-skip-func-length → func-lines 整文件豁免', () => {
  const t = '// dsh-skip-func-length\nfunction a() {}\nfunction b() {}';
  assert.equal(exemptForFinding(f('func-lines', 'func-lines', 2), t), true);
});

test('文件头 dsh-skip-quality → empty-catch/sync-fs/func-lines 豁免', () => {
  const t = '// dsh-skip-quality\nconst x = 1;';
  assert.equal(exemptForFinding(f('empty-catch', 'quality/empty-catch'), t), true);
  assert.equal(exemptForFinding(f('sync-fs', 'quality/sync-fs'), t), true);
  assert.equal(exemptForFinding(f('func-lines', 'func-lines'), t), true);
});

test('文件头 dsh-skip-residue → debugger/console/todo 残留豁免', () => {
  const t = '// dsh-skip-residue\nconst x = 1;';
  assert.equal(exemptForFinding(f('regex', 'style-debugger'), t), true);
  assert.equal(exemptForFinding(f('regex', 'style-console-log'), t), true);
  assert.equal(exemptForFinding(f('regex', 'style-todo-remark'), t), true);
});

test('文件头 dsh-skip-style → style-* 数值规则豁免', () => {
  const t = '// dsh-skip-style\nconst x = 1;';
  assert.equal(exemptForFinding(f('regex', 'style-min-length'), t), true);
  assert.equal(exemptForFinding(f('regex', 'style-max-complexity'), t), true);
  assert.equal(exemptForFinding(f('regex', 'style-repeated-string'), t), true);
});

test('文件头 dsh-skip-size → large-file/binary 豁免（位置语义：只能文件头）', () => {
  const t = '// dsh-skip-size\nconst x = 1;';
  assert.equal(exemptForFinding(f('large-file', 'binary-large-file'), t), true);
  assert.equal(exemptForFinding(f('binary', 'binary-file'), t), true);
  // 行级不支持（lineLevel=false）：标记写在第 4 行（前 3 行文件头之外）→ 不豁免
  const t2 = [
    'const a = 1;',
    'const b = 2;',
    'const c = 3;',
    'const x = 1; // dsh-skip-size（第 4 行，非文件头，无效）',
  ].join('\n');
  assert.equal(exemptForFinding(f('large-file', 'binary-large-file', 4), t2), false);
});

test('文件头 dsh-skip-syntax → syntax/json-parse/yaml-parse 豁免', () => {
  const t = '// dsh-skip-syntax\n{"bad": broken';
  assert.equal(exemptForFinding(f('syntax', 'syntax-js-error'), t), true);
  assert.equal(exemptForFinding(f('json-parse', 'syntax-json'), t), true);
  assert.equal(exemptForFinding(f('yaml-parse', 'syntax-yaml'), t), true);
});

// ---------- 行内单点豁免 ----------
test('行尾 dsh-skip-sensitive → 仅本行豁免，其他行照报（标记须在前 3 行之外才是单点）', () => {
  const t = [
    'const a = 1;',
    'const b = 2;',
    'const c = 3;',
    'const token = "ghp_1234567890abcdefghij"; // dsh-skip-sensitive',
    'const d = token;',
  ].join('\n');
  assert.equal(exemptForFinding(f('secret', 'secret-generic-token', 4), t), true, '标记行应豁免');
  assert.equal(exemptForFinding(f('secret', 'secret-generic-token', 5), t), false, '无标记行不应豁免');
  // 标记在第 2 行（前 3 行内）= 文件头 → 整文件豁免（符合设计，非单点）
  const t2 = [
    'const a = 1;',
    'const token = "ghp_1234567890abcdefghij"; // dsh-skip-sensitive',
    'const b = token;',
  ].join('\n');
  assert.equal(exemptForFinding(f('secret', 'secret-generic-token', 3), t2), true, '前 3 行内标记=文件头豁免整文件');
});

test('行尾 dsh-skip-func-length → 函数定义行豁免单函数', () => {
  const t = [
    'function longFn() { // dsh-skip-func-length',
    '  x();',
    '}',
  ].join('\n');
  assert.equal(exemptForFinding(f('func-lines', 'func-lines', 1), t), true);
  // 文件头无标记、其他函数不受影响
  const t2 = 'function other() { x(); } // 无标记';
  assert.equal(exemptForFinding(f('func-lines', 'func-lines', 1), t2), false);
});

test('行尾 dsh-skip-residue → 本行 debugger 豁免', () => {
  const t = 'debugger; // dsh-skip-residue';
  assert.equal(exemptForFinding(f('regex', 'style-debugger', 1), t), true);
});

// ---------- 豁免不越权 ----------
test('豁免不越权：sensitive 文件头不影响 func-lines/质量检查', () => {
  assert.equal(exemptForFinding(f('func-lines', 'func-lines', 3), SENSITIVE_TEXT), false);
  assert.equal(exemptForFinding(f('empty-catch', 'quality/empty-catch', 3), SENSITIVE_TEXT), false);
  assert.equal(exemptForFinding(f('sync-fs', 'quality/sync-fs', 3), SENSITIVE_TEXT), false);
});

test('豁免不越权：quality 文件头不影响 secret', () => {
  const t = '// dsh-skip-quality\nconst x = 1;';
  assert.equal(exemptForFinding(f('secret', 'secret-generic-token', 3), t), false);
});

test('豁免不越权：style 文件头不影响空 catch', () => {
  const t = '// dsh-skip-style\nconst x = 1;';
  assert.equal(exemptForFinding(f('empty-catch', 'quality/empty-catch', 3), t), false);
});

test('豁免不越权：文件头第 4 行标记不豁免（仅前 3 行）', () => {
  const t = [
    'const a = 1;',
    'const b = 2;',
    'const c = 3;',
    '// dsh-skip-sensitive（第 4 行无效）',
  ].join('\n');
  assert.equal(exemptForFinding(f('secret', 'secret-generic-token', 2), t), false);
});

test('无豁免标记 → 全部照报', () => {
  const t = 'const x = 1;';
  assert.equal(exemptForFinding(f('secret', 'secret-generic-token', 1), t), false);
  assert.equal(exemptForFinding(f('func-lines', 'func-lines', 1), t), false);
  assert.equal(exemptForFinding(f('empty-catch', 'quality/empty-catch', 1), t), false);
});

// ---------- exemptHintFor（查找提示） ----------
test('exemptHintFor：secret 反查 sensitive 提示', () => {
  const hint = exemptHintFor('secret');
  assert.ok(hint.includes('dsh-skip-sensitive'));
});

test('exemptHintFor：func-lines 反查（sensitive 先命中 blocked 也含 func？应给敏感优先）', () => {
  // blocked 枚举顺序：sensitive 不含 func-lines → 应命中 func-length 或 quality
  const hint = exemptHintFor('func-lines');
  assert.ok(hint.includes('dsh-skip-func-length') || hint.includes('dsh-skip-quality'));
});

test('exemptHintFor：未知 kind 给默认敏感提示', () => {
  assert.ok(exemptHintFor('unknown-kind').includes('dsh-skip-sensitive'));
});

// ---------- 12 场景计数（对照旧项目场景矩阵） ----------
test('场景矩阵：整文件 7 标记 + 行级 3 标记 = 12 场景全覆盖', () => {
  const headerMarkers = ['dsh-skip-sensitive', 'dsh-skip-size', 'dsh-skip-func-length', 'dsh-skip-syntax', 'dsh-skip-quality', 'dsh-skip-residue', 'dsh-skip-style'];
  const lineMarkers = Object.entries(EXEMPT_MARKERS).filter(([, m]) => m.lineLevel).map(([k]) => k);
  // 整文件 7 场景
  for (const m of headerMarkers) {
    assert.equal(hasHeaderExempt(`// ${m}\nx`, m), true, `${m} 文件头应豁免`);
  }
  // 行级 3 场景（sensitive/func-length/residue）
  assert.deepEqual(lineMarkers.sort(), ['dsh-skip-func-length', 'dsh-skip-residue', 'dsh-skip-sensitive'].sort());
  // 对应位置标记应豁免（行级标记在行内生效）
  for (const m of lineMarkers) {
    assert.equal(hasLineExempt(`const x = 1; // ${m}`, m), true, `${m} 行内应生效`);
  }
});

// ---------- 端到端（auditFile 正确消费） ----------
async function compileGrouped() {
  const { loadRuleFiles } = await import('../lib/rule/loader.js');
  const { compileAllRules } = await import('../lib/rule/registry.js');
  const { groupByKind } = await import('../lib/audit/checks.js');
  import('../lib/rule/compilers.js');
  const loaded = loadRuleFiles(['nodejs']);
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  return groupByKind(compiled);
}

test('端到端：dsh-skip-sensitive 文件头 → secret 不进入 findings', async () => {
  const { auditFile } = await import('../lib/audit/index.js');
  const grouped = await compileGrouped();
  const text = '// dsh-skip-sensitive: mock 测试\nconst token = "ghp_1234567890abcdefghij";\nconst aws = "AKIA1234567890ABCDEF";';
  const findings = auditFile({ file: 't.mjs', relPath: 't.mjs', text, grouped });
  const secrets = findings.filter((x) => x.kind.includes('secret') || x.kind === 'path-regex');
  assert.equal(secrets.length, 0, `sensitive 文件头应豁免全部 secret，实际 ${secrets.length}`);
});

test('端到端：无豁免 → secret 照常 block', async () => {
  const { auditFile } = await import('../lib/audit/index.js');
  const grouped = await compileGrouped();
  const text = 'const token = "ghp_1234567890abcdefghij";';
  const findings = auditFile({ file: 't.mjs', relPath: 't.mjs', text, grouped });
  const secrets = findings.filter((x) => x.kind.includes('secret'));
  assert.ok(secrets.length > 0, '无豁免时应报 secret');
});