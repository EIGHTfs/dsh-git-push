/**
 * 审计结果 API 端点测试（2026-09-27）
 *
 * 覆盖 /api/git-push/audit：
 *   · 缺 repo 时回落默认扫描根 / 400
 *   · groupBy=rule 聚合返回（key/count/sample）
 *   · severity 过滤生效（filtered 条数）
 *   · groupBy=file / severity / slot 维度可用
 *   · withFindings 附加明细
 *   · 审计异常（仓库不存在）返回 500 而非崩溃
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { handleHttp } from '../lib/app/http-handlers.js';

// 2026-10-05：改相对路径派生（此前硬编码机器绝对路径 /volume1/...，换机即失效）
const ROOT = join(import.meta.dirname, '..');
const ENV = { workspaceRoot: ROOT };

test('/api/git-push/audit：groupBy=rule 聚合（count 降序 + sample）', async () => {
  const r = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-push/audit', body: { repo: ROOT, groupBy: 'rule', top: 5 } }, ENV, {});
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

test('/api/git-push/audit：severity 过滤只留指定级别', async () => {
  const r = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-push/audit', body: { repo: ROOT, groupBy: 'severity', severity: 'warning' } }, ENV, {});
  assert.equal(r.status, 200);
  const b = r.body;
  assert.ok(b.groups.every((g) => g.key === 'warning'), `severity 过滤后只应剩 warning 组，实际 ${b.groups.map((g) => g.key)}`);
  assert.ok(b.filtered > 0, 'filtered 应大于 0');
});

test('/api/git-push/audit：groupBy=file 与 slot 维度可用', async () => {
  const rf = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-push/audit', body: { repo: ROOT, groupBy: 'file', top: 3 } }, ENV, {});
  assert.equal(rf.status, 200);
  assert.ok(rf.body.groups.length > 0, 'file 维度应返回分组');
  assert.ok(rf.body.groups.every((g) => typeof g.key === 'string' && g.key.length > 0), 'file 维度键应为非空字符串（含 README.md 等文档）');

  const rs = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-push/audit', body: { repo: ROOT, groupBy: 'slot', top: 3 } }, ENV, {});
  assert.equal(rs.status, 200);
  assert.ok(rs.body.groups.length > 0, 'slot 维度应返回分组');
});

test('/api/git-push/audit：withFindings 附加明细', async () => {
  const r = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-push/audit', body: { repo: ROOT, groupBy: 'rule', top: 1, withFindings: true } }, ENV, {});
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.findings), 'withFindings=true 应附 findings 数组');
  assert.ok(r.body.findings.length > 0, 'findings 非空');
});

test('/api/git-push/audit：仓库不存在 → 仍返回 ok（0 文件，非崩溃）', async () => {
  // auditFull 对不存在路径收集 0 文件、不抛错（非 git 目录可查的设计）——200 + 空组
  const r = await handleHttp({ method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-push/audit', body: { repo: '/nonexistent/definitely/not/here' } }, ENV, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.files, 0, '0 文件');
  assert.equal(r.body.total, 0, '0 findings');
});

test('/api/git-push/audit：GET 走 query 参数聚合', async () => {
  // 只读请求免 Origin 校验；groupBy 从 query 取
  const r = await handleHttp({ method: 'GET', url: `/api/git-push/audit?repo=${encodeURIComponent(ROOT)}&groupBy=severity&top=3` }, ENV, {});
  assert.equal(r.status, 200);
  assert.ok(r.body.groups.length > 0, 'GET query 聚合生效');
  assert.ok(r.body.groups.every((g) => ['blocker', 'warning', 'notice', 'error', 'info'].includes(g.key)), 'severity 组键为级别（含 info）');
});

test('/api/git-push/audit：POST body 优先于 query（参数合并）', async () => {
  // query 说 groupBy=file，body 说 groupBy=rule → body 覆盖
  const r = await handleHttp(
    { method: 'POST', origin: 'http://127.0.0.1', url: '/api/git-push/audit?groupBy=file', body: { repo: ROOT, groupBy: 'rule', top: 2 } },
    ENV, {},
  );
  assert.equal(r.status, 200);
  assert.ok(r.body.groups.length > 0);
  // rule 维度的组键应为规则名（含 / 分隔）
  assert.ok(r.body.groups.some((g) => g.key.includes('/')), 'body 覆盖后按 rule 分组');
});
