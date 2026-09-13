/**
 * AST 实现层 · 代码行判定
 *
 * 职责：判断某行是否「真在代码里」（而非注释/字符串内），并取出代码里的字符串字面量。
 *   供 regex 类规则做二次确认，避免注释中的示例被当真实代码报错。
 */

import { tokenize } from './tokenizer.js';

/* ───────────────────────── 正则初筛 → AST 精筛（通用设施） ───────────────────────── */

/**
 * 正则初筛 → token 级精筛（所有文本型检查的通用两段式）。
 *
 * 为什么两段式：正则快、能一次筛出候选行；但正则无法区分「代码」与「注释/字符串」，
 * 单用必然误报（注释版本号、CSS 字号、i18n 字典值）。tokenizer 能精确分类，但全量
 * token 化成本高于正则。两段式 = 正则初筛候选行 → 只对候选行做 token 判定。
 *
 * @param {string} text 文件全文
 * @param {number[]} candidateLines 正则初筛命中的行号（1-based）
 * @returns {{isCode: (line:number)=>boolean}} isCode(line) 判定该行是否含「代码 token」
 *   （注释/字符串/模板串/纯空白行 → false；含 ident/num/punct 的行 → true）
 */
export function makeCodeLineFilter(text = '', candidateLines = []) {
  const want = new Set(candidateLines);
  const codeLines = new Set();
  const suspect = new Set();
  for (const t of tokenize(text)) {
    if (!want.has(t.line)) continue;
    if (t.type === 'ident' || t.type === 'num') codeLines.add(t.line);
    if (t.type === 'punct') suspect.add(t.line);
  }
  for (const l of suspect) {
    // 只有标点（如 `}` `);`）不算代码行，需同时有 ident/num
    if (!codeLines.has(l)) codeLines.delete(l);
  }
  return {
    isCode: (line) => codeLines.has(line),
  };
}

/**
 * 判定一组字符串字面量值是否出现在代码里（供「重复硬编码串」等规则精筛）。
 * @param {string} text 文件全文
 * @returns {Set<string>} 代码中出现的字符串字面量裸值集合
 */
export function codeStringLiterals(text = '') {
  const out = new Set();
  for (const t of tokenize(text)) {
    if (t.type !== 'str' && t.type !== 'tmpl') continue;
    out.add(String(t.value).replace(/^(['"`])([\s\S]*)\1$/, '$2'));
  }
  return out;
}
