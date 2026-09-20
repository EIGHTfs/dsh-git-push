/**
 * AST 实现层 · 规模检查
 *
 * 职责：函数长度、文件长度、重复字符串。
 *   函数长度按括号平衡区间统计函数体内语句密度，单行海量语句也能识别。
 */

import { tokenize } from './tokenizer.js';
import { matchBrace } from './brace.js';

/** 函数体行数默认阈值：≥ WARN 报 warning，≥ BLOCK 报 blocker。 */
const FUNC_LINES_WARN = 50;
const FUNC_LINES_BLOCK = 100;
/** 从 `function` 关键字向后搜索函数体 `{` 的 token 窗口（覆盖 name( params ) { 形态）。 */
const FUNC_BODY_LOOKAHEAD_TOKENS = 20;

/**
 * 列出全文所有函数的**精确行范围**（AST 级，tokenizer 括号配对）。
 *
 * 与 checkFuncLinesAst 共用同一套边界算法，区别是：本函数返回**全部**函数（不只超限的），
 * 供上层在此基础上做「语句密度」等派生判定，避免上层再自建第二套边界识别
 * （历史教训：上层曾用正则找起点 + 自己数花括号，未剥离字面量，把 8 行函数算成 242 行 blocker）。
 * @param {string} text 文件全文
 * @returns {Array<{startLine:number, endLine:number, len:number}>} 按出现顺序
 */
export function funcRangesAst(text = '') {
  const tokens = tokenize(text);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'function') continue;
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + FUNC_BODY_LOOKAHEAD_TOKENS); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') { openIdx = j; break; }
      if (tj.type === 'punct' && tj.value === ';') break;
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    const startLine = tokens[openIdx].line;
    const endLine = tokens[range[1]].line;
    out.push({ startLine, endLine, len: endLine - startLine + 1 });
    i = range[1];
  }
  return out;
}

/**
 * 统计指定行范围内的注释行数（多项检查共用：函数长度/文件长度的「非注释部分」口径）。
 * 与 countCommentLines 同思路（comment token 按物理行去重、跨行块注释逐行覆盖），
 * 但限定在 [startLine, endLine] 闭区间内。
 * @param {Array} tokens tokenize 输出
 * @param {number} startLine 起始物理行（含）
 * @param {number} endLine 结束物理行（含）
 * @returns {number} 范围内注释行数
 */
export function countCommentLinesInRange(tokens, startLine = 1, endLine = Infinity) {
  const commentLines = new Set();
  for (const t of tokens) {
    if (t.type !== 'comment') continue;
    const start = Number(t.line) || 1;
    if (start < startLine || start > endLine) continue;
    commentLines.add(start);
    const newlines = String(t.value || '').match(/\n/g)?.length || 0;
    for (let i = 1; i <= newlines; i++) {
      if (start + i <= endLine) commentLines.add(start + i);
    }
  }
  return commentLines.size;
}

/**
 * 检查单函数超长（AST 级：括号平衡精确统计函数体行数）。
 * 2026-09-20：判定按**非注释部分**（codeLen = 总行数 − 范围内注释行），
 *   注释/文档行不占「代码规模」预算；总行数仍随返回供展示。
 * @param {string} text 文件全文
 * @param {{warn?: number, block?: number}} [opts]
 * @returns {Array<{line:number, len:number, codeLen:number, commentLines:number, level:'warning'|'blocker'}>}
 */
export function checkFuncLinesAst(text = '', { warn = FUNC_LINES_WARN, block = FUNC_LINES_BLOCK } = {}) {
  const tokens = tokenize(text);
  const out = [];
  const fnStart = new Set(['function']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !fnStart.has(t.value)) continue;
    // function 关键字后找 '{'（限 20 token：name( params ) {）
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + FUNC_BODY_LOOKAHEAD_TOKENS); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') { openIdx = j; break; }
      if (tj.type === 'punct' && tj.value === ';') break;
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    const startLine = tokens[openIdx].line;
    const endLine = tokens[range[1]].line;
    const len = endLine - startLine + 1;
    const commentLines = countCommentLinesInRange(tokens, startLine, endLine);
    const codeLen = Math.max(1, len - commentLines);
    if (codeLen > warn) {
      out.push({ line: startLine, len, codeLen, commentLines, level: codeLen > block ? 'blocker' : 'warning' });
    }
    i = range[1];
  }
  return out;
}

/** 语句密度门槛（条/行）：低于此值说明语句正常铺开分布，不算「单行海量语句」。 */
const STMT_DENSITY_MIN = 3;

/**
 * 检查「单行/极少行堆叠海量语句」（AST 级，tokenizer 计数）。
 *
 * 为什么独立于行数判定：`function f() { a++; a++; … ×200 }` 挤在**一行**，行数=1 永远
 *   超不过 50 行阈值，只能按**语句密度**（语句数 ÷ 函数体行数）识别。
 *
 * 为什么不与行数判定重复报：两处都基于同一份 AST 函数范围；本函数跳过「已被行数判定报出」
 *   的函数（见 `reportedByLines`），避免同一函数在同一规则下产生两条 finding。
 *
 * 历史（2026-09-13 误报）：旧实现在 `lib/checks/` 层用正则找起点、自己数花括号、无条件套用
 *   语句总数阈值 → 把 DSH 客户端 bundle 的单入口工厂 `factory: (require) => { … }`（整个
 *   插件体都在这个箭头函数里，横跨上千行、语句数自然过百，密度却不到 1）误报为 blocker。
 *   现加密度门槛，并把全部字符级操作收敛到 AST 层（tokenizer 计数，不经正则）。
 *
 * @param {string} text 文件全文
 * @param {{threshold?: number, blockThreshold?: number, skipLines?: Set<number>}} [opts]
 *   skipLines：已被行数判定报出的函数起始行，不再重复报
 * @returns {Array<{line:number, stmtCount:number, bodyLines:number, density:number, level:'warning'|'blocker'}>}
 */
export function checkFuncDensityAst(text = '', { threshold = FUNC_LINES_WARN, blockThreshold = FUNC_LINES_BLOCK, skipLines = new Set() } = {}) {
  const tokens = tokenize(String(text));
  const out = [];
  for (const r of funcRangesAst(text)) {
    if (skipLines.has(r.startLine)) continue;
    const bodyLines = Math.max(1, r.len);
    // 语句数 = 该函数行范围内的分号 token 数（tokenizer 已剥离字符串/正则/注释内的分号）
    let stmtCount = 0;
    for (const t of tokens) {
      if (t.type !== 'punct' || t.value !== ';') continue;
      if (t.line >= r.startLine && t.line <= r.endLine) stmtCount += 1;
    }
    const density = stmtCount / bodyLines;
    if (stmtCount > threshold && density > STMT_DENSITY_MIN) {
      out.push({
        line: r.startLine, stmtCount, bodyLines, density,
        level: stmtCount > blockThreshold ? 'blocker' : 'warning',
      });
    }
  }
  return out;
}

/**
 * 统计注释行数（注释行单独算）：基于 tokenizer 的 comment token，
 * 对跨行块注释按换行拆分后按「物理行号去重」计注释行数。
 * @param {string} text 文件全文
 * @returns {number} 注释行数（0 = 无注释/无法解析）
 */
export function countCommentLines(text = '') {
  const tokens = tokenize(String(text));
  const commentLines = new Set();
  for (const t of tokens) {
    if (t.type !== 'comment') continue;
    const v = String(t.value || '');
    const start = Number(t.line) || 1;
    commentLines.add(start);
    // 跨行块注释：从起始行起按换行推进，覆盖到的每行都算注释行
    const newlines = v.match(/\n/g)?.length || 0;
    for (let i = 1; i <= newlines; i++) commentLines.add(start + i);
  }
  return commentLines.size;
}

/**
 * 检查文件行数（max-lines kind）。
 * 2026-09-20：判定默认按**非注释部分**（codeLines = 总行数 − 注释行数），
 *   注释/文档行不占文件规模预算；总行数/注释行数仍随返回供展示。
 * @param {string} text 文件全文
 * @param {object} [opts] { warn=500, block=1000, excludeComments=true }
 *   excludeComments=false 时回退旧口径（按总行数判定）。
 * @returns {{lines:number, codeLines:number, commentLines:number, level:string|null}}
 */
export function checkFileLines(text = '', { warn = 500, block = 1000, excludeComments = true } = {}) {
  const lines = String(text).split('\n').length;
  const commentLines = countCommentLines(text);
  const codeLines = excludeComments ? Math.max(lines - commentLines, 0) : lines;
  if (codeLines <= warn) return { lines, codeLines, commentLines, level: null };
  return { lines, codeLines, commentLines, level: codeLines > block ? 'blocker' : 'warning' };
}

/**
 * 检查重复出现的硬编码字符串/模板串（repeated-string / min-occurrences kind）。
 * 数值字面量（num）不参与统计——版本号/端口/阈值等数字重复属正常，
 * 按「硬编码文本」报会造成大面积噪音（如 README 里的 10/15）。
 * @param {string} text 文件全文
 * @param {object} [opts] { min=3, ignore=['', ' ', '\\n', '-', '/', '0', '1'] }
 * @returns {Array<{line:number, value:string, count:number}>}
 */
export function checkRepeatedStringsAst(text = '', { min = 3, ignore = [] } = {}) {
  const tokens = tokenize(text);
  // tokenizer 产出的字面量类型名是 str / tmpl / num（非 string/number）；
  // 类型名不匹配会让本检查永不命中，故按实际类型名收集；num 刻意排除（见上）
  const LITERAL_TYPES = new Set(['str', 'tmpl']);
  const ignoreSet = new Set(['', ' ', '\n', '-', '/', '0', '1', 'utf8', 'string', 'number', 'boolean', 'object', 'function', ...ignore]);
  const counts = new Map();
  for (const t of tokens) {
    if (!LITERAL_TYPES.has(t.type)) continue;
    // 去掉字面量外层引号（'' "" ``），计数与展示都用裸值
    const v = String(t.value).replace(/^(['"`])([\s\S]*)\1$/, '$2');
    if (ignoreSet.has(v) || v.length < 4) continue;
    // ① 纯标识符形状（含下划线）：kind 名/分派词（credential-ref、code_audit 等），重复属正常
    if (/^[a-z0-9][a-z0-9_-]{0,19}$/i.test(v)) continue;
    // ①b dotfile 名（.git/.dsh/.env 等）：路径/目录域名词汇，重复属正常
    if (/^\.[a-z0-9_-]{1,16}$/i.test(v)) continue;
    // ② 短期望词（2-4 个汉字）：可读性/可维护性/安全性 等维度名，重复属正常
    if (/^[\u4e00-\u9fff]{2,4}$/.test(v)) continue;
    // ③ 无值型特征（不含 ./:\ 空格/CJK）的短串：\n、-c、-q、[FUNC] 属控制串/标志，不报
    //    值型特征 = 含 路径分隔/点/冒号/反斜杠/空白/CJK —— 才像"硬编码值"
    if (!/[\s./:\\\u4e00-\u9fff]/.test(v)) continue;
    if (!counts.has(v)) counts.set(v, { value: v, count: 0, line: t.line });
    counts.get(v).count++;
  }
  return [...counts.values()].filter((x) => x.count >= min);
}
