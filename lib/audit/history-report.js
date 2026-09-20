/**
 * audit --history 历史提交审计：落盘模块（1.7.0）。
 *
 * 职责：
 *   · resolveReportDir —— 保存位置解析（--out 缺省 = git 根 audit-history/ 子目录）
 *   · writeCommitReport —— 每个提交一份审计清单（<short>-<时间>.json 完整 + .md 可读版）
 *   · writeHistoryIndex —— SUMMARY.json 全部提交汇总（快速浏览）
 * 原子写复用 atomic-json（.tmp + rename），中断/崩溃不出现半文件。
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeJsonAtomic, writeTextAtomic } from '../git/atomic-json.js';

/** 报告保存位置：--out 缺省 = <git根>/audit-history（需求「缺省就是 git 根目录存所有提交的分析」）。 */
export function resolveReportDir(repoPath, outDir = '') {
  return String(outDir || '').trim() || join(String(repoPath || '.'), 'audit-history');
}

/** 可读 Markdown 清单（报告 .md 版；文件/规则/消息结构化展示）。 */
function renderMarkdown(entry = {}) {
  const lines = [];
  lines.push(`# 审计报告 · ${entry.short} ${entry.subject || ''}`);
  lines.push('');
  lines.push(`- 提交：${entry.sha}`);
  lines.push(`- 作者：${entry.author || ''}｜时间：${entry.date || ''}`);
  lines.push(`- 文件数：${entry.fileCount ?? 0}`);
  const q = entry.quality || {};
  lines.push(`- 质量：${q.emptyResult ? (q.emptyReason || '未评分') : `${q.score}/100（${q.level || ''}）`}`);
  const s = entry.summary || {};
  lines.push(`- summary：blocker ${s.blocker ?? 0} / warning ${s.warning ?? 0} / notice ${s.notice ?? 0}（total ${s.total ?? 0}）`);
  // 2026-09-21：文档加分制（0 分起、上限 10）——结构信号 + 交叉验证
  const ds = entry.docsScore;
  if (ds && Array.isArray(ds.items)) {
    const total = ds.items.filter((i) => i.hit).reduce((a, i) => a + (Number(i.score) || 0), 0);
    lines.push(`- 文档加分：命中 ${ds.hits?.length ?? 0}/${ds.items.length}（+${total.toFixed(1)}/10）`);
    if (Array.isArray(ds.review) && ds.review.length) lines.push(`- 建议人工复核：${ds.review.join('；')}`);
  }
  const findings = entry.findings || [];
  if (!findings.length) {
    lines.push('');
    lines.push('（无 findings）');
    return lines.join('\n') + '\n';
  }
  lines.push('');
  lines.push('## findings');
  for (const f of findings) {
    lines.push(`- [${f.severity}] ${f.rule} ${f.file}:${f.line} — ${String(f.message || '').slice(0, 160)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * 写单个提交的报告（json 完整 + md 可读），返回落盘路径。
 * @param {string} dir 保存目录（resolveReportDir 的结果）
 * @param {object} entry { sha, short, date, author, subject, summary, quality, findings, fileCount }
 * @returns {{json: string, md: string, base: string}}
 */
export function writeCommitReport(dir, entry = {}) {
  mkdirSync(dir, { recursive: true });
  const ts = String(entry.date || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
  const base = `${entry.short || 'unknown'}-${ts}`;
  const jsonPath = join(dir, base + '.json');
  const mdPath = join(dir, base + '.md');
  writeJsonAtomic(jsonPath, entry, { pretty: true });
  writeTextAtomic(mdPath, renderMarkdown(entry));
  return { json: jsonPath, md: mdPath, base };
}

/**
 * 写全部提交汇总（SUMMARY.json）。
 * @param {string} dir 保存目录
 * @param {object} meta { repoPath, since, until, total, processed, entries: [{sha,short,date,subject,summary,quality}] }
 */
export function writeHistoryIndex(dir, meta = {}) {
  mkdirSync(dir, { recursive: true });
  const agg = { blocker: 0, warning: 0, notice: 0, total: 0 };
  for (const e of meta.entries || []) {
    const s = e.summary || {};
    agg.blocker += s.blocker || 0;
    agg.warning += s.warning || 0;
    agg.notice += s.notice || 0;
    agg.total += s.total || 0;
  }
  writeJsonAtomic(join(dir, 'SUMMARY.json'), {
    generatedAt: new Date().toISOString(),
    repoPath: meta.repoPath || '',
    range: { since: meta.since || '', until: meta.until || '' },
    total: meta.total ?? 0,
    processed: meta.processed ?? 0,
    aggregate: agg,
    commits: (meta.entries || []).map((e) => ({
      sha: e.sha, short: e.short, date: e.date, author: e.author, subject: e.subject,
      summary: e.summary || {}, quality: e.quality || {},
    })),
  }, { pretty: true });
  return join(dir, 'SUMMARY.json');
}