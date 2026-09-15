/**
 * AST 实现层 · 规模检查
 *
 * 职责：函数长度、文件长度、重复字符串。
 *   函数长度按括号平衡区间统计函数体内语句密度，单行海量语句也能识别。
 */

import { tokenize } from './tokenizer.js';
import { matchBrace } from './brace.js';

/**
 * 检查单函数超长（AST 级：括号平衡精确统计函数体行数）。
 * @param {string} text 文件全文
 * @param {{warn?: number, block?: number}} [opts]
 * @returns {Array<{line:number, len:number, level:'warning'|'blocker'}>}
 */
export function checkFuncLinesAst(text = '', { warn = 50, block = 100 } = {}) {
  const tokens = tokenize(text);
  const out = [];
  const fnStart = new Set(['function']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !fnStart.has(t.value)) continue;
    // function 关键字后找 '{'（限 20 token：name( params ) {）
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 20); j++) {
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
    if (len > warn) {
      out.push({ line: startLine, len, level: len > block ? 'blocker' : 'warning' });
    }
    i = range[1];
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
 * @param {string} text 文件全文
 * @param {object} [opts] { warn=500, block=1000 }
 * @returns {{lines:number, commentLines:number, level:string|null}}
 *   lines=总行数；commentLines=注释行数（注释行单独算，供报告展示；
 *   判定仍按总行数，不改变既有行为）。
 */
export function checkFileLines(text = '', { warn = 500, block = 1000 } = {}) {
  const lines = String(text).split('\n').length;
  const commentLines = countCommentLines(text);
  if (lines <= warn) return { lines, commentLines, level: null };
  return { lines, commentLines, level: lines > block ? 'blocker' : 'warning' };
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
