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

/* ───────────────────────── 列级精筛（行级判定的加强版） ───────────────────────── */

/**
 * 正则初筛 → **列级** token 精筛。
 *
 * 为什么需要：行级判定只能回答「这一行有没有代码 token」，回答不了
 *   「正则命中的**那一处**是不是落在字符串/注释里」。实测遗留误报：
 *
 *     const hang = await provider.execute(session, { script: 'while (true) {}' });
 *
 *   该行确实含 ident（script / provider 等）⇒ 行级判定放行 ⇒
 *   performance/busy-wait-loop 把字符串字面量里的 while(true) 当成真实死循环报出 ✗。
 *
 * 做法：在行级判定之上，用 tokenizer 的 str/tmpl/comment token 构造「不透明区间」，
 *   命中列落在区间内 ⇒ 判为「不是代码」。
 *
 * @param {string} text 文件全文
 * @param {number[]} candidateLines 候选行（1-based）
 * @param {{file?:string}} [opts]
 * @returns {{isCode:(line:number)=>boolean, isCodeHit:(line:number, col:number)=>boolean}}
 *   isCodeHit 的 col 为 **1-based 列**（正则 exec 的 index + 1）；
 *   列缺失/非法时**退化为行级判定**（宁可放行，不因拿不到列而误杀）。
 */
export function makeCodeSpanFilter(text = '', candidateLines = [], opts = {}) {
  const base = makeCodeLineFilter(text, candidateLines, opts);
  // 不透明区间只取**单行 token**：跨行 token（三引号/多行块注释）的 col 是续行内位置，
  //   用它构造区间会算错。跨行场景本就由行级判定覆盖——续行不产 ident/num ⇒ 不算代码行。
  const opaque = new Map(); // line → [[startCol, endColExclusive), ...]
  for (const t of tokenize(text)) {
    if (t.type !== 'str' && t.type !== 'tmpl' && t.type !== 'comment') continue;
    const v = String(t.value);
    if (v.includes('\n')) continue;
    const col = Number(t.col);
    if (!Number.isFinite(col) || col < 1) continue;
    const arr = opaque.get(t.line) || [];
    arr.push([col, col + v.length]);
    opaque.set(t.line, arr);
  }
  return {
    isCode: base.isCode,
    isCodeHit: (line, col) => {
      if (!base.isCode(line)) return false;
      const ranges = opaque.get(line);
      if (!ranges || !ranges.length) return true;
      const c = Number(col);
      if (!Number.isFinite(c) || c < 1) return true; // 拿不到列 ⇒ 退化为行级判定
      for (const [s, e] of ranges) if (c >= s && c < e) return false;
      return true;
    },
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
