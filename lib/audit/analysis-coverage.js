/**
 * 分析覆盖率（**信息项，不参与评分**）
 *
 * 【为什么需要】审计可能「规则全过」但其实根本没解析到代码（比如解析器看不懂某种语法、
 *   导入解析不到目标文件）——只看命中数与分数会被这种假绿误导。这里用符号索引给出三个数：
 *     ① 覆盖率 = 连边数 / 可解析调用数（成员调用 `x.y()` 不计入，它们本就不经符号索引解析）
 *     ② 未解析构成（unknown / ambiguous）与按文件的未解析 top
 *     ③ 被排除的成员调用量（说明分母口径，避免"看起来漏了很多"的误解）
 *
 * 【为什么不进评分】覆盖率高低受语言与工程风格影响很大（纯函数库天然高、框架代码天然低），
 *   直接计分会把「语言差异」算成「代码质量问题」。先作为可见性指标输出，口径稳定后再议是否计分。
 *
 * 【口径限制】需要**完整文件集**才能解析跨文件导入；diff 范围只含变动文件时无法给出可信覆盖率，
 *   此时返回 `{ skipped: 原因 }` 而不是给一个失真的数字。
 */
import { buildSymbolIndex } from '../ast/symbol-index.js';
import { collectTextFiles, readText } from './collector.js';
import { relative } from 'node:path';

/** 未解析 top 文件默认取前几个。 */
const DEFAULT_TOP_N = 5;

/**
 * 取「相对路径 → 文件内容」的条目集。
 * - 调用方直接给 `files: [{path, full}]`（含内容）时用它（单测/已读入场景，不再碰磁盘）；
 * - 否则按**审计同一套采集器**（collectTextFiles：gitignore/.auditignore 感知）从 repoPath 收集并读取，
 *   保证覆盖率与审计看到的是同一批文件。
 * @returns {Promise<Array<{path:string, full:string}>>}
 */
async function resolveEntries({ repoPath, files }) {
  if (Array.isArray(files) && files.length) {
    return files.map((f) => ({ path: String(f.path || f.rel || ''), full: String(f.full ?? '') })).filter((f) => f.path);
  }
  if (!repoPath) return [];
  const collected = await collectTextFiles(repoPath, { gitIgnoreRoot: repoPath, includeIgnored: false });
  const list = Array.isArray(collected) ? collected : (collected && collected.files) || [];
  return list
    .map((f) => ({ path: relative(repoPath, String(f.full || f.path || '')).replace(/\\/g, '/'), full: readText(String(f.full || '')) || '' }))
    .filter((f) => f.path && f.full);
}

/**
 * 计算分析覆盖率（信息项）。
 * @param {{repoPath?:string, files?:Array<{path?:string, rel?:string, full?:string}>, topN?:number}} [opts]
 *   files：已读入的文件（含内容）；未给则用 repoPath 按审计采集器现收现读
 * @returns {Promise<object>} 覆盖率信息对象（不参与评分）
 */
export async function computeAnalysisCoverage({ repoPath = '', files = null, topN = DEFAULT_TOP_N } = {}) {
  const entries = await resolveEntries({ repoPath, files });
  if (!entries.length) return { files: 0, note: '无文件可分析' };
  const byPath = new Map(entries.map((e) => [e.path, e.full]));
  const index = buildSymbolIndex([...byPath.keys()], { readFile: (rel) => byPath.get(rel) || '' });
  const s = index.stats;
  return {
    files: s.files,
    declarations: s.declarations,
    exports: s.exports,
    calls: s.calls,
    edges: s.edges,
    edgesByVia: s.edgesByVia,
    unresolved: s.unresolved,
    unresolvedByReason: countByReason(index.unresolved),
    memberCallsExcluded: s.skippedMemberCalls,
    coverage: s.coverage,
    topUnresolvedFiles: topUnresolvedFiles(index.unresolved, topN),
    note: '信息项，不参与评分；覆盖率 = 连边 / 可解析调用（成员调用 x.y() 已排除并单独计数）',
  };
}

/** 未解析原因计数。 */
function countByReason(unresolved) {
  const out = {};
  for (const u of unresolved) out[u.reason] = (out[u.reason] || 0) + 1;
  return out;
}

/** 按文件统计未解析调用数，取前 N（降序）。 */
function topUnresolvedFiles(unresolved, topN) {
  const counts = new Map();
  for (const u of unresolved) counts.set(u.file, (counts.get(u.file) || 0) + 1);
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, topN));
}

/**
 * 覆盖率一行文本（审计输出里附在 apiGuide 后面）。
 * @param {object} cov computeAnalysisCoverage 的结果（或 `{skipped}`）
 * @returns {string}
 */
export function formatAnalysisCoverageLine(cov = {}) {
  if (!cov || cov.skipped) return `分析覆盖率：跳过（${(cov && cov.skipped) || '未计算'}）`;
  if (!cov.files) return `分析覆盖率：${cov.note || '无文件'}`;
  const reasons = Object.entries(cov.unresolvedByReason || {}).map(([k, v]) => `${k} ${v}`).join(' / ');
  return `分析覆盖率 ${cov.coverage}%（连边 ${cov.edges} / 可解析调用 ${cov.calls}；未解析 ${cov.unresolved}${reasons ? `：${reasons}` : ''}；`
    + `已排除成员调用 ${cov.memberCallsExcluded}）——信息项，不参与评分`;
}
