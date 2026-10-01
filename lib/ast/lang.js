/**
 * AST 实现层 · 语言路由
 *
 * 职责：按源码内容（或扩展名）判定语言，并为各语言提供「函数范围收集器」。
 *   tokenizer 是 JS 语法假设的通用切词器，对多数花括号系语言（Java/Kotlin/Go/Rust/
 *   Swift/C/C++/PHP）的「函数体边界」识别却各不同——JS 找 `function` 关键字、Python
 *   按 def+缩进、Java/Kotlin 按方法签名。本模块统一这层差异：detectLang 给出语言，
 *   funcRangesFor 返回该语言的函数范围收集函数（暂无实现的返回 null——槽位就绪，
 *   后续补语言规则时零架构改动）。
 *
 * 语言路由（funcRanges 函数）：
 *   js/ts/tsx/jsx  → funcRangesAst 的 JS 分支（大括号法，size.js）
 *   python         → pythonFuncRanges（缩进法，size.js）
 *   java/kotlin    → javaKtFuncRanges（方法签名 + 括号配对，本文件）
 *   go/rust/swift/cpp/php/rb → null 占位（语言专项规则 yml 已建槽位，范围解析待补）
 */
import { matchBrace } from './brace.js';
import { tokenize } from './tokenizer.js';

/** 方法签名 `(` 配对 `)` 的最大 token 跨度（防遍历到文件尾）。 */
const SIG_CLOSE_LOOKAHEAD = 40;
/** 配对 `)` 后找方法体 `{` 的最大 token 跨度（跳过 throws 子句/注解）。 */
const BODY_OPEN_LOOKAHEAD = 13;

/** 主流的「方法声明前导关键字/上下文排除集」——这些 ident 紧跟在 `X(` 前时不构成方法声明。 */
const NOT_METHOD_PREV = new Set([
  'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'catch', 'case',
  'new', 'throw', 'import', 'package', 'extends', 'implements', 'super', 'this',
  'class', 'interface', 'enum', 'function', 'const', 'let', 'var', 'def',
  'in', 'of', 'not', 'and', 'or', 'is', 'as', 'assert', 'yield', 'await',
]);

/**
 * Java/Kotlin 函数（方法）范围收集——token 级方法签名识别 + 括号配对。
 *
 * 为什么不能复用 JS 分支：Java/Kotlin 方法无 `function` 关键字——
 *   `public void foo(int x) {` / `private fun bar(): Int {`，JS 分支零命中。
 * 识别算法（token 级，天然剥离字符串/注释）：
 *   ① 候选：ident 紧跟 `(`（方法名/构造器名），且该 ident 前一非空白 token：
 *        - 是 `.` → 方法调用（helper.foo(）排除
 *        - 是 NOT_METHOD_PREV 关键字（return/if/new/class…）→ 排除
 *        - 是函数体/语句边界（`{` `}` `;` `,` `(` `=` `:` `)`）→ 排除
 *        - 其它（返回类型/修饰符/泛型尾 `>`/数组尾 `]`/`fun` 关键字）→ 候选
 *   ② 确认：`(` 括号配对到 `)`，其后 12 token 内出现 `{`（方法体）→ 方法声明；
 *      `)` 后跟 `;`（调用）/`,`/`)` 等 → 非方法体，排除。
 *      ——「配对后必须跟 `{`」是区分「方法声明」与「方法调用」的强判据：
 *        调用结尾是 `;`/`)`，声明结尾是 `{`（或 throws X {）。
 *   ③ 方法名：候选 ident 即方法名（构造器=类名，合法函数）。
 *   覆盖：Java 方法/构造器/静态块前的方法、Kotlin fun（含返回值 `: Type`、
 *       默认参数）。不覆盖：Kotlin 表达式体（fun x() = …）——无 `{}`，一般极短。
 *       局部 fun（Kotlin 允许嵌套）与 lambda `{` 的开始由 matchBrace 各自配对，
 *       内层独立计数（与 JS 内层函数同语义）。
 *
 * 返回 [{startLine, endLine, len, name}]（与 funcRangesAst 输出结构一致）。
 * @param {string} text 文件全文
 */
/** 方法名前一非 ws/comment token。 */
function prevNonWsToken(tokens, i) {
  for (let j = i - 1; j >= 0; j--) {
    const tj = tokens[j];
    if (tj.type === 'ws' || tj.type === 'comment') continue;
    return tj;
  }
  return null;
}

/** 前一 token 是否构成「方法声名前导」——punct 泛型尾/数组尾，ident 非排除关键字。 */
function isMethodCandidate(prev) {
  if (!prev) return false;
  if (prev.type === 'punct') return prev.value === '>' || prev.value === ']';
  if (prev.type === 'ident') return !NOT_METHOD_PREV.has(prev.value);
  return false;
}

/** 从 `(` 起配对 `)`（depth 从 1 起，找到闭合或超出 SIG_CLOSE_LOOKAHEAD 窗口）。 */
function findMatchingParen(tokens, openIdx) {
  let depth = 1;
  for (let k = openIdx + 1; k < tokens.length && k < openIdx + SIG_CLOSE_LOOKAHEAD; k++) {
    const tk = tokens[k];
    if (tk.type !== 'punct') continue;
    if (tk.value === '(') depth++;
    else if (tk.value === ')') { depth--; if (depth === 0) return k; }
  }
  return -1;
}

/** 配对 `)` 后找方法体 `{`（BODY_OPEN_LOOKAHEAD 窗口内；遇 `;`/`{`/`)` 提前停）。 */
function findOpenBrace(tokens, closeIdx) {
  for (let k = closeIdx + 1; k < Math.min(tokens.length, closeIdx + BODY_OPEN_LOOKAHEAD); k++) {
    const tk = tokens[k];
    if (tk.type === 'ws' || tk.type === 'comment') continue;
    if (tk.type === 'punct') {
      if (tk.value === '{') return k;
      if (tk.value === ';' || tk.value === '{' || tk.value === ')') return -1;
    }
  }
  return -1;
}

export function javaKtFuncRanges(text = '') {
  const tokens = tokenize(text);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    const nx = tokens[i + 1];
    if (!nx || nx.type !== 'punct' || nx.value !== '(') continue;
    // ① 方法名前一 token 过滤（最近的非 ws/comment token）
    if (!isMethodCandidate(prevNonWsToken(tokens, i))) continue;
    // ② `(` 配对 `)` 后 12 token 内找 `{`
    const closeIdx = findMatchingParen(tokens, i + 1);
    if (closeIdx === -1) continue;
    const openIdx = findOpenBrace(tokens, closeIdx);
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    const startLine = tokens[openIdx].line;
    const endLine = tokens[range[1]].line;
    out.push({ startLine, endLine, len: endLine - startLine + 1, name: t.value });
    i = range[1]; // 跳过方法体（Java 无嵌套方法；Kotlin 局部 fun 由后续迭代各自评估——不整段跳过外层也能扫到内层，但跳过可避免外层方法重复计数其体内 lambda）
  }
  return out;
}

/**
 * 内容启发式语言检测（与 pythonDetectDef 同精度级别，用于 AST 层按语言路由）。
 *   优先级：python（def + 缩进无大括号）> java/kotlin（方法签名/class 大写/fun）> js。
 * @param {string} text 文件全文
 * @returns {'python'|'java'|'kotlin'|'js'|'other'}
 */
export function detectLang(text = '') {
  const s = String(text);
  if (/^\s*def\s+[A-Za-z_]\w*\s*\(/m.test(s)) return 'python';
  // Kotlin 强信号：fun 关键字（比 class 大写更早判——Kotlin 的 class/interface 声明
  //   形态与 Java 相同，先查 fun 避免 Kotlin 文件被 Java 迹象误夺）
  if (/^\s*fun\s+[A-Za-z_]\w*\s*\(/m.test(s) || /\bfun\s+[A-Za-z_]\w*\s*\(/m.test(s)) return 'kotlin';
  // Java 迹象：行首修饰符/返回类型 + 类/接口/枚举声明（类名惯例大写开头）
  if (/^\s*(public|private|protected|static|final|synchronized|abstract|native|default|strictfp)(\s|$)/m.test(s)
    || /(^|\n)\s*(public|abstract|final)?\s*(class|interface|enum)\s+[A-Z][A-Za-z0-9_]*/m.test(s)
    || /@(Override|Deprecated|SuppressWarnings|Test)\b/.test(s)) return 'java';
  return /^\s*(import|require|include|#include|use\s+)/m.test(s) ? 'other' : 'js';
}

/** 语言 → 函数范围收集器（null = 占位：语言专项规则槽位已建，范围解析待补）。 */
export const LANG_FUNC_RANGES = {
  java: javaKtFuncRanges,
  kotlin: javaKtFuncRanges,
  python: null, // 由 size.js 内联 pythonFuncRanges（避免循环依赖）
  js: null,     // 由 size.js 内联 funcRangesAst（JS 分支）
  go: null,
  rust: null,
  swift: null,
  cpp: null,
  php: null,
  rb: null,
};