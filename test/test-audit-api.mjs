/**
 * 审计结果 API 聚合层测试（2026-09-27）
 *
 * 覆盖 aggregateFindings 的维度/过滤/top 与 parseSeverityFilter：
 *   · groupBy=rule/file/severity/slot 四种维度
 *   · severity 白名单过滤（含非法值回落）
 *   · top 截断（0=全部）
 *   · slot 维度用 ruleSlotMap 归组
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFindings, parseSeverityFilter, GROUP_BY_KEYS } from '../lib/app/audit-api.js';

const mk = (rule, severity, file, line = 1) => ({ rule, severity, file, line, message: `${rule}@${file}:${line}` });

test('audit-api：GROUP_BY_KEYS 四维度齐全', () => {
  assert.deepEqual(GROUP_BY_KEYS, ['rule', 'file', 'severity', 'slot']);
});

test('audit-api：groupBy=rule 按警告类型聚合（count 降序）', () => {
  const findings = [
    mk('a/rule-1', 'warning', 'x.js'), mk('a/rule-1', 'warning', 'y.js'),
    mk('b/rule-2', 'blocker', 'z.js'), mk('c/rule-3', 'notice', 'w.js'),
  ];
  const r = aggregateFindings(findings, { groupBy: 'rule' });
  assert.equal(r.total, 4);
  assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [
    ['a/rule-1', 2], ['b/rule-2', 1], ['c/rule-3', 1],
  ]);
});

test('audit-api：groupBy=file 按文件名聚合', () => {
  const findings = [
    mk('r1', 'warning', 'src/a.js'), mk('r2', 'warning', 'src/a.js'),
    mk('r3', 'warning', 'lib/b.js'),
  ];
  const r = aggregateFindings(findings, { groupBy: 'file' });
  assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [
    ['src/a.js', 2], ['lib/b.js', 1],
  ]);
  assert.ok(r.groups[0].sample, '组应带 sample 供前端展示');
});

test('audit-api：groupBy=severity 按严重级别聚合', () => {
  const findings = [
    mk('r1', 'blocker', 'a.js'), mk('r2', 'warning', 'b.js'), mk('r3', 'warning', 'c.js'), mk('r4', 'notice', 'd.js'),
  ];
  const r = aggregateFindings(findings, { groupBy: 'severity' });
  assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [
    ['warning', 2], ['blocker', 1], ['notice', 1],
  ]);
});

test('audit-api：groupBy=slot 按规则包归组（ruleSlotMap 映射）', () => {
  const map = new Map([['security/x', 'nodejs'], ['readability/y', 'nodejs'], ['robustness/z', 'private']]);
  const findings = [
    mk('security/x', 'warning', 'a.js'), mk('readability/y', 'warning', 'b.js'), mk('robustness/z', 'warning', 'c.js'),
  ];
  const r = aggregateFindings(findings, { groupBy: 'slot', ruleSlotMap: map });
  assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [
    ['nodejs', 2], ['private', 1],
  ]);
});

test('audit-api：slot 维度无映射的规则归「未归类」', () => {
  const r = aggregateFindings([mk('orphan/rule', 'warning', 'a.js')], { groupBy: 'slot', ruleSlotMap: new Map() });
  assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [['未归类', 1]]);
});

test('audit-api：severity 白名单过滤（只留指定级别）', () => {
  const findings = [
    mk('r1', 'blocker', 'a.js'), mk('r2', 'warning', 'b.js'), mk('r3', 'warning', 'c.js'), mk('r4', 'notice', 'd.js'),
  ];
  const r = aggregateFindings(findings, { groupBy: 'rule', severityFilter: 'warning,blocker' });
  assert.equal(r.filtered, 3, 'blocker+warning 共 3 条');
  assert.ok(r.groups.every((g) => g.sample.severity !== 'notice'), '过滤后不应含 notice');
  assert.equal(r.total, 4, 'total 保持原始条数');
});

test('audit-api：severity 过滤空/非法回落不过滤', () => {
  const findings = [mk('r1', 'warning', 'a.js'), mk('r2', 'notice', 'b.js')];
  assert.equal(aggregateFindings(findings, { severityFilter: '' }).filtered, 2);
  assert.equal(aggregateFindings(findings, { severityFilter: '  ' }).filtered, 2);
  assert.equal(aggregateFindings(findings, { severityFilter: 'blocker,blocker' }).filtered, 0, '去重后仅 blocker，无命中');
});

test('audit-api：top 截断每组条数（0=全部）', () => {
  const findings = [
    mk('r1', 'warning', 'a.js'), mk('r2', 'warning', 'b.js'), mk('r3', 'warning', 'c.js'),
  ];
  assert.equal(aggregateFindings(findings, { groupBy: 'file', top: 2 }).groups.length, 2);
  assert.equal(aggregateFindings(findings, { groupBy: 'file', top: 0 }).groups.length, 3);
  assert.equal(aggregateFindings(findings, { groupBy: 'file', top: -1 }).groups.length, 3, '非法 top 回落 0=全部');
});

test('audit-api：非法 groupBy 回落 rule', () => {
  const r = aggregateFindings([mk('x/rule', 'warning', 'a.js')], { groupBy: 'bogus' });
  assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [['x/rule', 1]]);
});

test('audit-api：parseSeverityFilter 解析/去重/trim', () => {
  assert.deepEqual(parseSeverityFilter('warning,blocker'), ['warning', 'blocker']);
  assert.deepEqual(parseSeverityFilter(' WARNING , notice '), ['warning', 'notice']);
  assert.deepEqual(parseSeverityFilter('blocker,blocker'), ['blocker']);
  assert.equal(parseSeverityFilter(''), null);
  assert.equal(parseSeverityFilter(null), null);
  assert.equal(parseSeverityFilter(' , , '), null);
});


// ---------- 2026-10-05：豁免类型统计（audit 透明性） ----------

test('exemptStatsOf：按豁免类型分组计数，无 exemptHint 不计数', async () => {
  const { exemptStatsOf, GROUP_BY_KEYS } = await import('../lib/app/audit-api.js');
  const findings = [
    { exemptHint: 'dsh-skip-quality（文件头=整文件）', severity: 'warning' },
    { exemptHint: 'dsh-skip-quality（文件头=整文件）', severity: 'warning' },
    { exemptHint: 'dsh-skip-residue（行尾=本行）', severity: 'warning' },
    { exemptHint: 'dsh-skip-sensitive（文件头=整文件）', severity: 'warning' },
    { severity: 'warning' }, // 无豁免不计
  ];
  const es = exemptStatsOf(findings);
  assert.equal(es.total, 4);
  assert.equal(es.types.quality, 2);
  assert.equal(es.types.residue, 1);
  assert.equal(es.types.sensitive, 1);
  assert.equal(GROUP_BY_KEYS.join('|'), 'rule|file|severity|slot');
});
// ---------- 2026-10-05：code_audit includeFindings 参数（true 才输出全量审计结果） ----------

test('code_audit：includeFindings=true 返回 findings+yaml；默认不返回', async () => {
  const { callTool } = await import('../lib/app/tool-call.js');
  const base = { repo: process.cwd() };
  const full = await callTool('code_audit', { ...base, includeFindings: true }, {}, { defaultScanRoot: '' }, null, null, null);
  assert.ok(Array.isArray(full.findings), 'includeFindings=true 应返回 findings 数组');
  assert.ok(full.apiGuide, '仍带 apiGuide');
  const slim = await callTool('code_audit', base, {}, { defaultScanRoot: '' }, null, null, null);
  assert.equal(slim.findings, undefined, '默认不返回 findings（精简）');
  assert.ok(slim.exemptStats && slim.groupByTypes, '默认仍带豁免统计/聚合类型');
});
