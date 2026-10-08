/**
 * 行数口径**单一来源**：代码行 = 总行 − 纯注释行 − 空行。
 *
 * 【为什么需要单一来源】此前「行数」在多处各算各的：
 *   `lib/checks/file-health.js` 用「总行 − 纯注释行」（**没减空行** ✗）、
 *   `lib/ast/size.js` 与 `lib/arch/extract.js` 直接用总行 ✗ —— 同一文件在不同规则/报告里
 *   给出不同的「行数」，无法对照，也无法作为拆分依据。
 *
 * 【口径】按**行上有哪些 token** 判定（单趟、无歧义）：
 *   · 有非注释 token（哪怕只有一个 `}`）→ **代码行**（行尾注释不影响 ✓）；
 *   · 只有 comment token → **纯注释行**（含块注释覆盖的每一行 ✓）；
 *   · 都没有（`trim()` 为空）→ **空行**。
 *   于是「纯注释行」与「空行」天然不重叠 ✓（块注释内部的空行算注释行 ✓），无需取并集再修正 ✓。
 *
 * 【不做的事】不判断「有效代码」（只有 `}` 的行仍算代码行 ✓）—— 口径要稳定可预期 ✓，
 *   不做语义判断，否则不同人算出的数不一样 ✓。
 */

import { tokenize } from './tokenizer.js';

/**
 * 统计一个文件的行数分布（单趟 token 判定）。
 * @param {string} text 文件全文
 * @returns {{total:number, comment:number, blank:number, code:number}} 总行 / 纯注释行 / 空行 / 代码行
 */
export function lineStats(text) {
  const src = String(text || '');
  const total = src.split('\n').length;
  const codeLines = new Set();
  const commentLines = new Set();
  for (const t of tokenize(src)) {
    const span = String(t.value).split('\n').length - 1;
    const bucket = t.type === 'comment' ? commentLines : codeLines;
    for (let i = 0; i <= span; i += 1) bucket.add(t.line + i);
  }
  let code = 0;
  let comment = 0;
  for (let i = 1; i <= total; i += 1) {
    if (codeLines.has(i)) code += 1;            // 有代码 → 代码行（行尾注释不影响）
    else if (commentLines.has(i)) comment += 1; // 只有注释 → 纯注释行
  }
  return { total, comment, blank: total - code - comment, code };
}

/**
 * 代码行数（口径见模块头注释）。
 * @param {string} text 文件全文
 * @returns {number} 代码行
 */
export function codeLineCount(text) {
  return lineStats(text).code;
}
