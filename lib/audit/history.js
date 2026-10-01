/**
 * audit --history 历史提交审计：遍历 + 快照审计核心（1.7.0）。
 *
 * 语义（需求）：
 *   · **只看历史提交**——不审当前工作区/diff；遍历 git log 指定范围（起始~结束，皆缺省=全部历史、含两端）
 *   · 每个提交用 `git archive` 解出**代码快照**到临时目录，跑 `auditFull` 全量审计
 *     （审计规则与当前工作区同一套——不新增第二套审计逻辑）
 *   · **按提交后台串行**：runHistoryAudit 逐个提交顺序执行（非并发），每提交落盘一份审计清单
 *
 * git 命令经 runGit/gitRaw（带 DSH_GIT_ENFORCE_PASS 的插件包装器）；archive 二进制走 gitRaw Buffer。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit, gitRaw } from '../git/exec.js';
import { auditFull } from './orchestrate.js';
import { scoreQuality } from '../score/index.js';
import { resolveReportDir, writeCommitReport, writeHistoryIndex } from './history-report.js';

/* ───────── 历史审计常量 ───────── */
const SHA_SHORT_LEN = 7;      // 短 sha 截断长度
const SUBJECT_MAX_LEN = 80;   // 提交标题截断长度

/**
 * 列出历史提交（范围含两端）。
 * @param {string} repoPath git 仓库路径
 * @param {{since?: string, until?: string}} [range] since/until 为空 = 全历史（到 HEAD）
 * @returns {Array<{sha,short,subject,author,date}>} 旧→新顺序（git log --reverse）
 */
export function listHistoryCommits(repoPath, { since = '', until = '' } = {}) {
  const sinceTrim = String(since || '').trim();
  const untilTrim = String(until || '').trim();
  // 范围：since^..until（含 since 与 until 两端）；both 空 = 全历史
  const range = untilTrim || 'HEAD';
  // range 是提交范围参数，不能放 `--` 之后（`--` 后 git 当路径 → 空结果）
  const res = runGit(['log', '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s', '--reverse', range], { cwd: repoPath });
  if (!res.ok) return { error: `读取提交历史失败: ${res.stderr || 'git log 出错'}` };
  const out = [];
  for (const line of String(res.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    const [sha, short, author, date, ...subjectParts] = line.split('\x1f');
    out.push({ sha, short: short || sha.slice(0, SHA_SHORT_LEN), author: author || '', date: date || '', subject: (subjectParts.join('\x1f') || '').slice(0, SUBJECT_MAX_LEN) });
  }
  if (sinceTrim) {
    // since 语义「从此提交开始（含）」，不用 `since^..until` 范围（根提交无父会 ambiguous）；
    //   取 until 全部历史后截断到 since 出现处
    const idx = out.findIndex((c) => c.sha === sinceTrim || c.short === sinceTrim || c.sha.startsWith(sinceTrim));
    if (idx === -1) return { error: `起始提交不存在: ${sinceTrim}` };
    return out.slice(idx);
  }
  return out;
}

/**
 * 对单个历史提交做「快照全量审计」：git archive 解临时目录 → auditFull → 评分 → 清理。
 * @param {string} repoPath git 仓库
 * @param {object} commit listHistoryCommits 单条
 * @param {object} [opts] auditFull 的 opts（rulesetDir/maxScanFiles/slots/disabledSlots/includeIgnored…）
 * @param {object} [weights] scoreQuality 权重覆盖
 * @returns {Promise<{summary, quality, findings, fileCount}>}
 */
export async function auditHistoryCommit(repoPath, commit, opts = {}, weights = {}) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'dshgp-hist-'));
  const tarPath = join(tmpDir, 'snapshot.tar');
  try {
    // git archive <sha> → Buffer（二进制，不用 runGit 的 utf8 通道）
    const arch = gitRaw(['archive', commit.sha], { cwd: repoPath });
    if (arch.error || arch.status !== 0) {
      return { error: `git archive ${commit.short} 失败: ${String(arch.error || arch.stderr).slice(0, 200)}` };
    }
    writeFileSync(tarPath, arch.stdout);
    execFileSync('tar', ['-x', '-C', tmpDir, '-f', tarPath], { stdio: 'ignore' });
    const historyAudit = await auditFull(tmpDir, opts);
    const quality = scoreQuality(historyAudit.findings || [], weights, { files: historyAudit.files, docsScore: historyAudit.docsScore });
    return {
      summary: historyAudit.summary || {},
      quality,
      findings: historyAudit.findings || [],
      docsScore: historyAudit.docsScore,
      fileCount: historyAudit.files ?? 0,
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * 串行执行历史审计：逐提交审计 + 落盘 + 进度回调 + 汇总；signal.aborted 时停（已落盘保留）。
 * @param {string} repoPath git 仓库
 * @param {object} [opts] { since, until, outDir, auditOpts, weights, signal, onCommit }
 * @returns {Promise<{ok:boolean, reportDir, total, processed, aborted?, summary, entries, error?}>}
 */
export async function runHistoryAudit(repoPath, { since = '', until = '', outDir = '', auditOpts = {}, weights = {}, signal, onCommit } = {}) {
  const commits = listHistoryCommits(repoPath, { since, until });
  if (Array.isArray(commits) === false || commits.error) {
    return { ok: false, error: commits.error || '读取提交历史失败' };
  }
  if (!commits.length) return { ok: false, error: '没有可审计的历史提交（空仓库？）' };
  const dir = resolveReportDir(repoPath, outDir);
  const entries = [];
  let aborted = false;
  for (let i = 0; i < commits.length; i += 1) {
    if (signal && signal.aborted) { aborted = true; break; }
    const commit = commits[i];
    const res = await auditHistoryCommit(repoPath, commit, auditOpts, weights);
    if (res.error) {
      entries.push({ ...commit, error: res.error, summary: {}, quality: {}, findings: [] });
    } else {
      const entry = { ...commit, ...res };
      entries.push(entry);
      writeCommitReport(dir, entry);
    }
    onCommit?.({ index: i + 1, total: commits.length, short: commit.short, ok: !res.error, error: res.error });
  }
  writeHistoryIndex(dir, { repoPath, since, until, total: commits.length, processed: entries.filter((e) => !e.error).length, entries });
  return {
    ok: true,
    reportDir: dir,
    total: commits.length,
    processed: entries.length,
    failed: entries.filter((e) => e.error).length,
    aborted,
    entries: entries.map((e) => ({ sha: e.sha, short: e.short, subject: e.subject, ok: !e.error, error: e.error, summary: e.summary, quality: e.quality })),
  };
}