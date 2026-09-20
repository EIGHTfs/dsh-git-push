/**
 * audit --history 历史提交审计测试（1.7.0）：
 *   范围语义（since/until 皆缺省=全部历史、含两端）、快照全量审计（c2 塞凭据应检出）、
 *   落盘（默认 git 根 audit-history/ + --out 指定）、参数缺省、中断安全（abort 后已落盘保留）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { listHistoryCommits, runHistoryAudit } from '../lib/audit/history.js';
import { resolveReportDir } from '../lib/audit/history-report.js';

/** 造临时仓库：c1 正常 → c2 塞凭据 → c3 新增文件。返回 { dir, commits }。 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-hist-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@example.com', { cwd: dir });
  execSync('git config user.name tester', { cwd: dir });
  writeFileSync(join(dir, 'a.js'), 'const a = 1;\n');
  execSync('git add -A && git commit -qm c1', { cwd: dir });
  writeFileSync(join(dir, 'a.js'), 'const token = "ghp_1234567890ABCDEFGHIJ";\n');
  execSync('git add -A && git commit -qm "c2 塞凭据"', { cwd: dir });
  writeFileSync(join(dir, 'b.js'), 'const b = 2;\n');
  execSync('git add -A && git commit -qm c3', { cwd: dir });
  return { dir, commits: listHistoryCommits(dir) };
}

test('resolveReportDir：--out 缺省 = git 根 audit-history/；指定则用指定目录', () => {
  assert.equal(resolveReportDir('/x/repo'), '/x/repo/audit-history', '缺省落 git 根 audit-history/');
  assert.equal(resolveReportDir('/x/repo', '/tmp/out'), '/tmp/out', '--out 指定生效');
});

test('listHistoryCommits：缺省=全部历史；since/until 含两端', () => {
  const { dir, commits } = makeRepo();
  try {
    assert.equal(commits.length, 3, '缺省应列出全部 3 个提交');
    assert.ok(!commits.error, commits.error || '');
    // since=中间提交 → 从它起到 HEAD（含 since）
    const fromSecond = listHistoryCommits(dir, { since: commits[1].sha });
    assert.deepEqual(fromSecond.map((c) => c.short), [commits[1].short, commits[2].short], 'since 含起始端');
    // until=第一个提交 → 只它一个
    const untilFirst = listHistoryCommits(dir, { until: commits[0].sha });
    assert.deepEqual(untilFirst.map((c) => c.short), [commits[0].short], 'until 含结束端');
    // since=c1 until=c2 → c1+c2（含两端）
    const sub = listHistoryCommits(dir, { since: commits[0].sha, until: commits[1].sha });
    assert.deepEqual(sub.map((c) => c.short), [commits[0].short, commits[1].short], '范围含两端');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runHistoryAudit：逐提交快照全量审计 + 落盘默认目录 + 凭据检出', async () => {
  const { dir, commits } = makeRepo();
  try {
    const r = await runHistoryAudit(dir, {});
    assert.equal(r.ok, true, r.error || '');
    assert.equal(r.total, 3, '全部提交');
    assert.equal(r.processed, 3, '全部处理成功');
    assert.equal(r.failed, 0, '无失败');
    assert.equal(r.reportDir, join(dir, 'audit-history'), '缺省落 git 根 audit-history/');
    // 落盘：3 份 json + 3 份 md + SUMMARY
    const files = readdirSync(r.reportDir);
    assert.equal(files.filter((f) => f.endsWith('.json')).length, 4, '3 提交 json + SUMMARY.json');
    assert.equal(files.filter((f) => f.endsWith('.md')).length, 3, '3 份可读 md');
    assert.ok(files.includes('SUMMARY.json'), '有汇总');
    // c2 塞凭据 → 该提交报告 blocker > 0
    const c2report = files.find((f) => f.startsWith(commits[1].short) && f.endsWith('.json'));
    assert.ok(c2report, 'c2 报告存在');
    const c2 = JSON.parse(readFileSync(join(r.reportDir, c2report), 'utf8'));
    assert.ok((c2.summary?.blocker || 0) > 0, `c2 应检出凭据 blocker（得 ${c2.summary?.blocker}）`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runHistoryAudit：--out 指定目录 + since/until 只落指定范围', async () => {
  const { dir, commits } = makeRepo();
  const out = mkdtempSync(join(tmpdir(), 'dshgp-hist-out-'));
  try {
    const r = await runHistoryAudit(dir, { since: commits[0].sha, until: commits[1].sha, outDir: out });
    assert.equal(r.total, 2, '范围=前两个提交');
    assert.equal(r.processed, 2);
    assert.equal(r.reportDir, out, '--out 生效');
    const files = readdirSync(out);
    assert.ok(files.some((f) => f.startsWith(commits[0].short)), '含 c1');
    assert.ok(files.some((f) => f.startsWith(commits[1].short)), '含 c2');
    assert.ok(!files.some((f) => f.startsWith(commits[2].short)), '不含 c3');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('runHistoryAudit：signal.aborted 中断——已落盘保留、processed 截断', async () => {
  const { dir, commits } = makeRepo();
  try {
    const ac = new AbortController();
    ac.abort(); // 立即中断
    const r = await runHistoryAudit(dir, { signal: ac.signal });
    assert.equal(r.ok, true);
    assert.equal(r.processed, 0, '首提交前即中断');
    assert.equal(r.aborted, true, '标记中断');
    assert.ok(existsSync(join(dir, 'audit-history')), '中断也建报告目录（SUMMARY 落盘）');
    // 非中断：先跑一部分再中断场景由 onCommit 覆盖（此处验证 interrupt 不抛）
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});