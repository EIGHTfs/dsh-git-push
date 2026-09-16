/**
 * 检查层 · 文件健康度
 *
 * 职责：按行数/字节数/最长行三维给文件打分，识别超大文件与超长行。
 */

import { makeFinding, CODE_EXTS } from '../audit/index.js';
import { checkFileLines } from '../ast/index.js';
import { capSeverity } from './common.js';

/* ───────────────────────── 默认参数（与 lib/rule/compilers/file-health.js 的默认值一致； ─────────────────────────
 * 规则条目可用 snake_case 字段覆盖，未覆盖时用这里的兜底值。两处需同步修改。） */

/** 三维权重（合计 1.0）：行数 / 大小 / 单行最大长度。 */
const WEIGHT_LINES = 0.4;
const WEIGHT_SIZE = 0.35;
const WEIGHT_LINE_LENGTH = 0.25;
/** 等级边界（各 4 个分隔点 → 0~4 级）。 */
const LINE_LEVELS = [200, 400, 800, 1500];
const SIZE_LEVELS = [30, 100, 300, 1000];
const LENGTH_LEVELS = [120, 200, 300, 500];
/** 等级扣分表（level 0~4）。 */
const LEVEL_PENALTIES = [0, 1.0, 2.5, 4.5, 7.0];
/** 满分基准与下限分。 */
const BASE_SCORE = 10;
const MIN_SCORE = 0.1;
/** 严重度分界。 */
const WARN_SCORE = 9;
const BLOCK_SCORE = 5;

/** 文件健康度矩阵评分（1.0.13）：行数×40% + 大小×35% + 行长×25% → 加权等级 → 插值扣分 → score/10。
 * 豁免：generated./.min./locales/ 跳过；constants/ 行数等级强制 0；routes/ 行数阈值放宽（等级-1，最小0）。
 * 输出：score<blockScore → blocker；score<warnScore → warning；否则 pass（不产出 finding）。
 * 诊断 message 含三维等级/得分/verdict/优先处理维度，可直接展示。 */
export function checkFileHealth({ file, relPath, text, rules }) {
  const findings = [];
  const rule = rules?.[0];
  if (!rule) return findings;
  const x = rule; // ruleOut 把 extra 展开进 rule 顶层（无 rule.extra 属性）
  const rel = relPath || file || '';
  // 豁免判定：相对路径可能是 'constants/table.js' 或 '/constants/table.js'，模式统一匹配两种形态
  const relNorm = rel.startsWith('/') ? rel : '/' + rel;
  // 跳过类（generated/min/locales）——先试精确（如 .generated. 可命中文件名），再试带斜杠（目录形态）
  if ((x.exemptSkip || []).some((p) => p.includes('/') ? relNorm.includes(p) : rel.includes(p))) return findings;
  // 行数豁免类（constants）：行数等级强制 0
  const constMode = (x.exemptConstants || []).some((p) => p.includes('/') ? relNorm.includes(p) : rel.includes(p));
  // 行数阈值放宽类（routes）：行数等级减 1
  const routesMode = (x.exemptRoutes || []).some((p) => p.includes('/') ? relNorm.includes(p) : rel.includes(p));

  const lines = text.split('\n');
  const lineCount = lines.length;
  const sizeKb = Buffer.byteLength(text, 'utf8') / 1024;
  let maxLen = 0;
  for (const ln of lines) { if (ln.length > maxLen) maxLen = ln.length; }

  const levelOf = (val, levels) => {
    for (let i = 0; i < levels.length; i++) if (val <= levels[i]) return i;
    return levels.length;
  };
  let linesLevel = levelOf(lineCount, x.lineLevels || LINE_LEVELS);
  const sizeLevel = levelOf(sizeKb, x.sizeLevels || SIZE_LEVELS);
  const lenLevel = levelOf(maxLen, x.lengthLevels || LENGTH_LEVELS);
  if (constMode) linesLevel = 0;                       // constants：行数豁免
  if (routesMode) linesLevel = Math.max(0, linesLevel - 1); // routes：行数阈值放宽

  const weights = {
    lines: x.weightLines !== undefined ? x.weightLines : WEIGHT_LINES,
    size: x.weightSize !== undefined ? x.weightSize : WEIGHT_SIZE,
    len: x.weightLineLength !== undefined ? x.weightLineLength : WEIGHT_LINE_LENGTH,
  };
  const weighted = linesLevel * weights.lines + sizeLevel * weights.size + lenLevel * weights.len;
  // 扣分插值：penalties[i] 对应等级 i；小数等级按相邻线性插值
  const penalties = x.penalties || LEVEL_PENALTIES;
  const lo = Math.floor(weighted);
  const hi = Math.min(lo + 1, penalties.length - 1);
  const frac = weighted - lo;
  const penalty = penalties[lo] + (penalties[hi] - penalties[lo]) * frac;
  const base = x.baseScore !== undefined ? x.baseScore : BASE_SCORE;
  const score = Math.max(MIN_SCORE, base - penalty);

  const warnScore = x.warnScore !== undefined ? x.warnScore : WARN_SCORE;
  const blockScore = x.blockScore !== undefined ? x.blockScore : BLOCK_SCORE;
  if (score >= warnScore) return findings; // 健康：不产出

  // 优先处理维度 = 等级最高的维度（并列取首个）
  const dims = [['行数', linesLevel], ['大小', sizeLevel], ['行长', lenLevel]].sort((a, b) => b[1] - a[1]);
  const top = dims[0];
  const sev = score < blockScore ? 'blocker' : 'warning';
  const label = ['优秀', '良好', '警戒', '危险', '严重'];
  // 2026-09-13 修 bug：总分标签曾硬编码「🟠 危险」，导致 8.4/10（刚低于 warn_score 9 的
  //   提示阈值）也被写成「危险」，与规则文档「score≥9 健康，<9 提示拆分，<5 blocker」不符。
  //   现按分数区间给档：<block_score 严重 / <(block+warn)/2 危险 / 其余 提示（轻度）。
  const mid = (blockScore + warnScore) / 2;
  const scoreTag = score < blockScore ? '🔴 严重' : (score < mid ? '🟠 危险' : '🟡 提示');
  findings.push(makeFinding({
    file, line: 1, rule: rule.id || 'maintainability/file-health', kind: 'file-health',
    severity: sev,
    message: `文件健康度 ${score.toFixed(1)}/10（${scoreTag}）：`
      + `行数 ${lineCount}→L${linesLevel}(${label[linesLevel]})、大小 ${sizeKb.toFixed(1)}KB→L${sizeLevel}(${label[sizeLevel]})、`
      + `最大行长 ${maxLen}→L${lenLevel}(${label[lenLevel]})；优先处理：${top[0]}（L${top[1]}）`,
    dimensions: rule.dimensions || ['可维护性', '可读性'],
    exemptHint: 'dsh-skip-quality（文件头=整文件）', scoreImpact: sev === 'blocker' ? 2 : 1,
  }));
  return findings;
}
