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
export function makeCodeLineFilter(text = '', candidateLines = [], opts = {}) {
  // 散文体文档（markdown/txt）：tokenizer 会把自然语言词判成 ident
  //   （「CIFS」「挂载适配」都是 ident），于是整段散文被当成「含代码 token 的行」，
  //   astConfirm 形同虚设——实测 README 版本记录里说明「token 被误报」的那句话
  //   本身被 security/no-hardcoded-credentials 报成 blocker。
  //   故对这类文件改用文档语义：只有**围栏代码块内**与**行内代码**才算代码。
  if (isProseDoc(text, opts.file)) return makeProseCodeFilter(text, candidateLines);

  const want = new Set(candidateLines);
  const codeLines = new Set();
  const suspect = new Set();
  for (const t of tokenize(text)) {
    if (!want.has(t.line)) continue;
    if (t.type === 'ident' || t.type === 'num') codeLines.add(t.line);
    if (t.type === 'punct') suspect.add(t.line);
  }
  for (const lineNo of suspect) {
    // 只有标点（如 `}` `);`）不算代码行，需同时有 ident/num
    if (!codeLines.has(lineNo)) codeLines.delete(lineNo);
  }
  return {
    isCode: (line) => codeLines.has(line),
  };
}

/**
 * 是否散文体文档 —— **只按扩展名判定**。
 *
 * 刻意不做内容特征兜底：shell 注释 `# cd "$X"` 与 markdown 标题 `# 标题`
 *   在文本层面完全同形，任何基于「以 # 开头」的启发式都会把 shell 脚本
 *   误判为文档，进而让所有行按「非围栏、非行内代码」被剔除——实测使
 *   folder/cd-to-maybe-missing 规则在 .sh 上整体失效（回归测试 test 542 失败）。
 *   调用方（lib/ast/shell.js）不传文件名，此时按代码处理是正确的默认。
 * @param {string} text 文件全文（当前未使用，保留签名以备扩展）
 * @param {string} file 文件路径（用于取扩展名）
 * @returns {boolean}
 */
function isProseDoc(text, file) {
  return /\.(md|markdown|txt|rst)$/i.test(String(file || ''));
}

/**
 * 文档语义的代码行判定：只有围栏代码块内、以及**行内代码片段本身**算「代码」。
 *
 * 关键区别在行内代码：不能「该行有行内代码 → 整行放行」。文档里一行往往既有
 *   散文又有多个行内片段（如版本记录一行写「...`chmod`/`utimes` 因 SMB 无 POSIX
 *   Extensions...`lib/fsx.js` 统一收口...」），整行放行等于把散文也当代码。
 *   实测 README 说明「token 被误报」的那句话因此被报成 blocker。
 * 做法：把该行的行内代码片段拼成「代码视图」，仅当代码视图里含 ident/num
 *   （即片段本身像代码）时才标为候选，供后续 token 级精筛继续判定。
 *
 * @returns {{isCode: (line:number)=>boolean}}
 */
function makeProseCodeFilter(text, candidateLines) {
  const want = new Set(candidateLines);
  const lines = String(text).split('\n');
  const codeLines = new Set();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      // 围栏标记行本身不算代码（它是文档语法）
      inFence = !inFence;
      continue;
    }
    if (inFence) { codeLines.add(i + 1); continue; }
    if (!want.has(i + 1)) continue; // 只判候选行，省 token 化成本
    // 取该行全部行内代码片段，判断「片段自身」是否像代码
    const snippets = String(line).match(/`[^`]+`/g) || [];
    if (!snippets.length) continue;
    const snippetText = snippets.map((x) => x.slice(1, -1)).join('\n');
    for (const t of tokenize(snippetText)) {
      if (t.type === 'ident' || t.type === 'num' || t.type === 'str') { codeLines.add(i + 1); break; }
    }
  }
  return { isCode: (line) => codeLines.has(line) };
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
