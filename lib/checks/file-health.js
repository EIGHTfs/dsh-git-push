/**
 * 检查层 · 文件健康度
 *
 * 职责：按行数/字节数/最长行三维给文件打分，识别超大文件与超长行。
 */

import { makeFinding, CODE_EXTS } from '../audit/index.js';
import { checkFileLines, maxFunctionLength } from '../ast/index.js';
import { capSeverity } from './common.js';
import { tokenize } from '../ast/tokenizer.js';

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
 // 三维（行数/大小/行长）一律按**代码部分**统计（修复）：文档注释里内嵌的
  //   API 响应示例 JSON（pix-ezviewer response 类）把行数/大小/行长全撑成 L3-L4 假警报——
  //   注释是设计说明不是代码规模。用 tokenizer 标记注释行/注释字节，三个维度都扣掉注释。
  //   ①整行注释（该行 token 全是 comment，含跨行块注释覆盖的行）不计行数与行长；
  //   ②注释字节（全部 comment token 的文本长度）从文件大小中扣除——代码大小才是规模。
  const commentOnlyLines = new Set();
  let maxLen = 0;
  let codeBytes = 0;
  (function computeLineMetrics() {
    const tokens = tokenize(text);
    let commentBytes = 0;
    for (const t of tokens) {
      if (t.type !== 'comment') continue;
      commentBytes += Buffer.byteLength(String(t.value || ''), 'utf8');
      const start = Number(t.line) || 1;
      const newlines = String(t.value || '').match(/\n/g)?.length || 0;
      for (let lineIdx = start; lineIdx <= start + newlines; lineIdx++) commentOnlyLines.add(lineIdx);
    }
    // 整行代码行长（该行非注释 token 存在 → 代码行；否则纯注释行不计）
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (commentOnlyLines.has(i + 1)) continue; // 整行注释（含示例数据串）不计行长
      if (ln.length > maxLen) maxLen = ln.length;
    }
    codeBytes = Math.max(0, Buffer.byteLength(text, 'utf8') - commentBytes);
  })();
  const codeLineCount = lines.length - commentOnlyLines.size; // 代码行 ≈ 总行 − 注释行
  const codeLineCountSafe = Math.max(1, codeLineCount);
  const sizeKb = codeBytes / 1024;
  const maxCodeLen = maxLen;

  const levelOf = (val, levels) => {
    for (let i = 0; i < levels.length; i++) if (val <= levels[i]) return i;
    return levels.length;
  };
  let linesLevel = levelOf(codeLineCountSafe, x.lineLevels || LINE_LEVELS);
  const sizeLevel0 = levelOf(sizeKb, x.sizeLevels || SIZE_LEVELS);
  const lenLevel = levelOf(maxCodeLen, x.lengthLevels || LENGTH_LEVELS);
  if (constMode) linesLevel = 0;                       // constants：行数豁免
  if (routesMode) linesLevel = Math.max(0, linesLevel - 1); // routes：行数阈值放宽
 // 聚合型 vs 臃肿型（用户设计）：先罚函数，再考虑文件——函数是执行单元、
  //   文件是组织单元。最大函数 > 50 行（臃肿型：文件大是因为藏着大函数）→ 行数/大小
  //   维度正常计分；全部函数 ≤ 50 行（聚合型：文件大只是函数多/数据多，或纯数据文件
  //   无函数）→ 行数/大小维度豁免（不按文件规模扣分，文件边界只是导航成本）。
  const maxFuncLen = maxFunctionLength(text);
  const FUNC_COMPLIANT_LIMIT = 50; // 与 func-lines 默认 warn 阈值一致
 // 聚合型判定加「有函数」前提：只有文件**含函数且函数都合规**才算聚合型
  //   （文件大=函数多/数据多）；无函数的纯脚本/数据文件（顶层 1200 行语句）没有「函数
  //   多」作证据，不豁免，仍按行数/大小计分（避免脚本型大文件漏报）。
  const isAggregated = maxFuncLen > 0 && maxFuncLen <= FUNC_COMPLIANT_LIMIT;
  let sizeLevel = sizeLevel0;
  if (isAggregated) { linesLevel = 0; sizeLevel = 0; }

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
  // 修 bug：总分标签曾硬编码「🟠 危险」，导致 8.4/10（刚低于 warn_score 9 的
  //   提示阈值）也被写成「危险」，与规则文档「score≥9 健康，<9 提示拆分，<5 blocker」不符。
  //   现按分数区间给档：<block_score 严重 / <(block+warn)/2 危险 / 其余 提示（轻度）。
  const mid = (blockScore + warnScore) / 2;
  const scoreTag = score < blockScore ? '🔴 严重' : (score < mid ? '🟠 危险' : '🟡 提示');
  findings.push(makeFinding({
    file, line: 1, rule: rule.id || 'maintainability/file-health', kind: 'file-health',
    severity: sev,
    message: `文件健康度 ${score.toFixed(1)}/10（${scoreTag}）：`
      + `行数 ${codeLineCountSafe}→L${linesLevel}(${label[linesLevel]})、大小 ${sizeKb.toFixed(1)}KB→L${sizeLevel}(${label[sizeLevel]})、`
      + `最大代码行长 ${maxCodeLen}→L${lenLevel}(${label[lenLevel]})、最大函数 ${maxFuncLen} 行；优先处理：${top[0]}（L${top[1]}）`
      + `${isAggregated ? '（聚合型：文件大但最大函数 ≤50 行——函数多而非函数长，按组织单元不按规模扣分）' : ''}`
      + `${lenLevel > 0 ? '（行长按非注释代码行计；注释/文档内嵌示例数据串不计）' : ''}`,
    dimensions: rule.dimensions || ['可维护性', '可读性'],
    exemptHint: 'dsh-skip-quality（文件头=整文件）', scoreImpact: sev === 'blocker' ? 2 : 1,
  }));
  return findings;
}
