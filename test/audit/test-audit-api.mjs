/**
 * test-audit-api.mjs —— 同族测试合并（test-audit-api.mjs · test-audit-api-http.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { aggregateFindings, parseSeverityFilter, GROUP_BY_KEYS } from '../../lib/app/audit-api.js';
import { handleHttp } from '../../lib/app/http-handlers.js';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
// ── 原 test-audit-api.mjs ──
{
  /**
   * 审计结果 API 聚合层测试
   *
   * 覆盖 aggregateFindings 的维度/过滤/top 与 parseSeverityFilter：
   *   · groupBy=rule/file/severity/slot 四种维度
   *   · severity 白名单过滤（含非法值回落）
   *   · top 截断（0=全部）
   *   · slot 维度用 ruleSlotMap 归组
   */

  const mk = (rule, severity, file, line = 1) => ({ rule, severity, file, line, message: `${rule}@${file}:${line}` });

  test('[audit-api] audit-api：GROUP_BY_KEYS 四维度齐全', () => {
    assert.deepEqual(GROUP_BY_KEYS, ['rule', 'file', 'severity', 'slot']);
  });

  test('[audit-api] audit-api：groupBy=rule 按警告类型聚合（count 降序）', () => {
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

  test('[audit-api] audit-api：groupBy=file 按文件名聚合', () => {
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

  test('[audit-api] audit-api：groupBy=severity 按严重级别聚合', () => {
    const findings = [
      mk('r1', 'blocker', 'a.js'), mk('r2', 'warning', 'b.js'), mk('r3', 'warning', 'c.js'), mk('r4', 'notice', 'd.js'),
    ];
    const r = aggregateFindings(findings, { groupBy: 'severity' });
    assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [
      ['warning', 2], ['blocker', 1], ['notice', 1],
    ]);
  });

  test('[audit-api] audit-api：groupBy=slot 按规则包归组（ruleSlotMap 映射）', () => {
    const map = new Map([['security/x', 'nodejs'], ['readability/y', 'nodejs'], ['robustness/z', 'private']]);
    const findings = [
      mk('security/x', 'warning', 'a.js'), mk('readability/y', 'warning', 'b.js'), mk('robustness/z', 'warning', 'c.js'),
    ];
    const r = aggregateFindings(findings, { groupBy: 'slot', ruleSlotMap: map });
    assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [
      ['nodejs', 2], ['private', 1],
    ]);
  });

  test('[audit-api] audit-api：slot 维度无映射的规则归「未归类」', () => {
    const r = aggregateFindings([mk('orphan/rule', 'warning', 'a.js')], { groupBy: 'slot', ruleSlotMap: new Map() });
    assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [['未归类', 1]]);
  });

  test('[audit-api] audit-api：severity 白名单过滤（只留指定级别）', () => {
    const findings = [
      mk('r1', 'blocker', 'a.js'), mk('r2', 'warning', 'b.js'), mk('r3', 'warning', 'c.js'), mk('r4', 'notice', 'd.js'),
    ];
    const r = aggregateFindings(findings, { groupBy: 'rule', severityFilter: 'warning,blocker' });
    assert.equal(r.filtered, 3, 'blocker+warning 共 3 条');
    assert.ok(r.groups.every((g) => g.sample.severity !== 'notice'), '过滤后不应含 notice');
    assert.equal(r.total, 4, 'total 保持原始条数');
  });

  test('[audit-api] audit-api：severity 过滤空/非法回落不过滤', () => {
    const findings = [mk('r1', 'warning', 'a.js'), mk('r2', 'notice', 'b.js')];
    assert.equal(aggregateFindings(findings, { severityFilter: '' }).filtered, 2);
    assert.equal(aggregateFindings(findings, { severityFilter: '  ' }).filtered, 2);
    assert.equal(aggregateFindings(findings, { severityFilter: 'blocker,blocker' }).filtered, 0, '去重后仅 blocker，无命中');
  });

  test('[audit-api] audit-api：top 截断每组条数（0=全部）', () => {
    const findings = [
      mk('r1', 'warning', 'a.js'), mk('r2', 'warning', 'b.js'), mk('r3', 'warning', 'c.js'),
    ];
    assert.equal(aggregateFindings(findings, { groupBy: 'file', top: 2 }).groups.length, 2);
    assert.equal(aggregateFindings(findings, { groupBy: 'file', top: 0 }).groups.length, 3);
    assert.equal(aggregateFindings(findings, { groupBy: 'file', top: -1 }).groups.length, 3, '非法 top 回落 0=全部');
  });

  test('[audit-api] audit-api：非法 groupBy 回落 rule', () => {
    const r = aggregateFindings([mk('x/rule', 'warning', 'a.js')], { groupBy: 'bogus' });
    assert.deepEqual(r.groups.map((g) => [g.key, g.count]), [['x/rule', 1]]);
  });

  test('[audit-api] audit-api：parseSeverityFilter 解析/去重/trim', () => {
    assert.deepEqual(parseSeverityFilter('warning,blocker'), ['warning', 'blocker']);
    assert.deepEqual(parseSeverityFilter(' WARNING , notice '), ['warning', 'notice']);
    assert.deepEqual(parseSeverityFilter('blocker,blocker'), ['blocker']);
    assert.equal(parseSeverityFilter(''), null);
    assert.equal(parseSeverityFilter(null), null);
    assert.equal(parseSeverityFilter(' , , '), null);
  });


  // ---------- 2026-10-05：豁免类型统计（audit 透明性） ----------

  test('[audit-api] exemptStatsOf：按豁免类型分组计数，无 exemptHint 不计数', async () => {
    const { exemptStatsOf, GROUP_BY_KEYS } = await import('../../lib/app/audit-api.js');
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
  // ---------- code_audit 输出详细度（2026-11-06 反转默认：**默认带详细**） ----------
  //   理由：调用方（AI/脚本）拿到的就该是能直接读的问题明细，而不是只有分数再自己去查聚合 API
  //   —— 多一跳就多一次漏看的可能。需要精简时显式 opt-out。

  test('[audit-api] code_audit：默认返回 findings+yaml（详细）；includeFindings=false / summaryOnly=true 才精简', async () => {
    const { callTool } = await import('../../lib/app/tool-call.js');
    const base = { repo: process.cwd() };
    const full = await callTool('code_audit', base, {}, { defaultScanRoot: '' }, null, null, null);
    assert.ok(Array.isArray(full.findings), '默认必须返回 findings 数组（详细）');
    assert.ok(full.apiGuide, '仍带 apiGuide 供全量查询');
    assert.ok(full.exemptStats && full.groupByTypes, '摘要字段同时保留');

    const slim = await callTool('code_audit', { ...base, includeFindings: false }, {}, { defaultScanRoot: '' }, null, null, null);
    assert.equal(slim.findings, undefined, 'includeFindings=false 时不返回 findings（精简）');
    assert.ok(slim.summary && slim.quality, '精简态仍带评分与摘要');

    const slim2 = await callTool('code_audit', { ...base, summaryOnly: true }, {}, { defaultScanRoot: '' }, null, null, null);
    assert.equal(slim2.findings, undefined, 'summaryOnly=true 等价精简');
  });
}

// ── 原 test-audit-api-http.mjs ──
{
  /**
   * 审计结果 API 端点测试
   *
   * 覆盖 /api/git-audit/audit：
   *   · 缺 repo 时回落默认扫描根 / 400
   *   · groupBy=rule 聚合返回（key/count/sample）
   *   · severity 过滤生效（filtered 条数）
   *   · groupBy=file / severity / slot 维度可用
   *   · withFindings 附加明细
   *   · 审计异常（仓库不存在）返回 500 而非崩溃
   */

  // 改相对路径派生（此前硬编码机器绝对路径 /volume1/...，换机即失效）
  const ROOT = join(import.meta.dirname, '..', '..');
  const ENV = { workspaceRoot: ROOT };

  test('[audit-api-http] /api/git-audit/audit：groupBy=rule 聚合（count 降序 + sample）', async () => {
    const r = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-audit/audit', body: { repo: ROOT, groupBy: 'rule', top: 5 } }, ENV, {});
    assert.equal(r.status, 200);
    const b = r.body;
    assert.equal(b.ok, true);
    assert.ok(Array.isArray(b.groups) && b.groups.length > 0, '应返回分组');
    assert.ok(b.groups.every((g) => typeof g.key === 'string' && g.count > 0), '每组有 key 与正计数');
    assert.ok(b.groups.every((g) => g.sample && g.sample.rule), '每组带 sample 明细');
    // count 降序校验
    for (let i = 1; i < b.groups.length; i++) assert.ok(b.groups[i - 1].count >= b.groups[i].count, '按 count 降序');
    assert.ok(b.summary && typeof b.summary.total === 'number', '带 summary');
  });

  test('[audit-api-http] /api/git-audit/audit：severity 过滤只留指定级别', async () => {
    const r = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-audit/audit', body: { repo: ROOT, groupBy: 'severity', severity: 'warning' } }, ENV, {});
    assert.equal(r.status, 200);
    const b = r.body;
    assert.ok(b.groups.every((g) => g.key === 'warning'), `severity 过滤后只应剩 warning 组，实际 ${b.groups.map((g) => g.key)}`);
    assert.ok(b.filtered > 0, 'filtered 应大于 0');
  });

  test('[audit-api-http] /api/git-audit/audit：groupBy=file 与 slot 维度可用', async () => {
    const rf = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-audit/audit', body: { repo: ROOT, groupBy: 'file', top: 3 } }, ENV, {});
    assert.equal(rf.status, 200);
    assert.ok(rf.body.groups.length > 0, 'file 维度应返回分组');
    assert.ok(rf.body.groups.every((g) => typeof g.key === 'string' && g.key.length > 0), 'file 维度键应为非空字符串（含 README.md 等文档）');

    const rs = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-audit/audit', body: { repo: ROOT, groupBy: 'slot', top: 3 } }, ENV, {});
    assert.equal(rs.status, 200);
    assert.ok(rs.body.groups.length > 0, 'slot 维度应返回分组');
  });

  test('[audit-api-http] /api/git-audit/audit：withFindings 附加明细', async () => {
    const r = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-audit/audit', body: { repo: ROOT, groupBy: 'rule', top: 1, withFindings: true } }, ENV, {});
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.findings), 'withFindings=true 应附 findings 数组');
    assert.ok(r.body.findings.length > 0, 'findings 非空');
  });

  test('[audit-api-http] /api/git-audit/audit：仓库不存在 → 仍返回 ok（0 文件，非崩溃）', async () => {
    // auditFull 对不存在路径收集 0 文件、不抛错（非 git 目录可查的设计）——200 + 空组
    const r = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-audit/audit', body: { repo: '/nonexistent/definitely/not/here' } }, ENV, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.files, 0, '0 文件');
    assert.equal(r.body.total, 0, '0 findings');
  });

  test('[audit-api-http] /api/git-audit/audit：GET 走 query 参数聚合', async () => {
    // 只读请求免 Origin 校验；groupBy 从 query 取
    const r = await handleHttp({ method: 'GET', url: `/api/git-audit/audit?repo=${encodeURIComponent(ROOT)}&groupBy=severity&top=3` }, ENV, {});
    assert.equal(r.status, 200);
    assert.ok(r.body.groups.length > 0, 'GET query 聚合生效');
    assert.ok(r.body.groups.every((g) => ['blocker', 'warning', 'notice', 'error', 'info'].includes(g.key)), 'severity 组键为级别（含 info）');
  });

  test('[audit-api-http] /api/git-audit/audit：POST body 优先于 query（参数合并）', async () => {
    // query 说 groupBy=file，body 说 groupBy=rule → body 覆盖
    const r = await handleHttp(
      { method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-audit/audit?groupBy=file', body: { repo: ROOT, groupBy: 'rule', top: 2 } },
      ENV, {},
    );
    assert.equal(r.status, 200);
    assert.ok(r.body.groups.length > 0);
    // rule 维度的组键应为规则名（含 / 分隔）
    assert.ok(r.body.groups.some((g) => g.key.includes('/')), 'body 覆盖后按 rule 分组');
  });
}
