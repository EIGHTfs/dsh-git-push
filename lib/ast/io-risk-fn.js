/**
 * dsh-git-push — I/O 风险分级：函数边界识别与 token 配对
 *
 * 职责：从 token 流里认出函数边界（普通函数 / 箭头函数 / 对象方法简写 / 类方法），
 *   以及圆括号、花括号、方括号的前后向配对 —— 上下文判定的公共基础设施。
 *   不含「风险等级」概念，只回答「这段代码属于哪个函数体」。
 *
 * 分层：lib/ast/io-risk.js 的从属模块（由该文件再导出），调用方不应直接 import。
 */
import { matchBrace } from './brace.js';

/**
 * 取包含该行的最内层循环范围（含 smallFixed 标记）。
 *   嵌套循环时取最内层：内层规模才是单次 I/O 的实际重复次数。
 * @returns {Array|null} [起行, 止行, smallFixed]
 */
export function enclosingLoop(loops, line) {
  let best = null;
  for (const entry of loops) {
    if (line < entry[0] || line > entry[1]) continue;
    if (!best || entry[0] >= best[0]) best = entry;
  }
  return best;
}

/** 函数体 '{' 的搜索窗口（token 数）：够覆盖 `async function name(a, b, c) {` 这类长签名。 */
export const BODY_SEARCH_TOKENS = 40;
/** 循环体 '{' 的搜索窗口（token 数）：够覆盖 `for (const x of someLongExpression) {`。 */
export const LOOP_BODY_SEARCH_TOKENS = 30;
/** 不能作为函数名的关键字：这些后面跟 `(...) {` 时是语句块，不是方法简写。 */
export const FUNCTION_HEAD_EXCLUDE = new Set([
  'for', 'while', 'if', 'else', 'switch', 'do', 'try', 'catch', 'finally',
  'return', 'typeof', 'new', 'delete', 'void', 'in', 'of', 'await', 'yield',
]);
/** 箭头函数 `=>` 的搜索窗口（token 数）：够覆盖 `const f = (a, b) => {`。 */
export const ARROW_SEARCH_TOKENS = 60;
/** 「固定小循环」的元素数上限：字面量数组不超过此值时，循环内同步 I/O 不算高风险。 */
export const SMALL_FIXED_LOOP_MAX = 5;

/**
 * 找函数/循环体的 '{'。
 * @returns {number} '{' 的 token 下标；遇 ';' 或超窗口返回 -1
 */
export function findBody(tokens, from, window = BODY_SEARCH_TOKENS) {
  for (let j = from; j < Math.min(tokens.length, from + window); j++) {
    if (tokens[j].type === 'punct' && tokens[j].value === '{') return j;
    if (tokens[j].type === 'punct' && tokens[j].value === ';') return -1;
  }
  return -1;
}

/**
 * 识别 `async` 开头的函数/箭头函数，返回其函数体 '{' 下标。
 *   覆盖三种形态：`async function f() {` / `async (...) => {` / `async x => {`
 * @returns {number} '{' 下标；无法识别返回 -1
 */
export function findAsyncBody(tokens, i) {
  const nx = tokens[i + 1];
  if (nx && nx.type === 'ident' && nx.value === 'function') return findBody(tokens, i + 2);
  for (let j = i + 1; j < Math.min(tokens.length, i + BODY_SEARCH_TOKENS); j++) {
    if (tokens[j].type === 'punct' && tokens[j].value === '=>') return findBody(tokens, j + 1);
    if (tokens[j].type === 'punct' && tokens[j].value === ';') break;
  }
  return -1;
}

/**
 * 识别循环体范围。
 *   两种收尾形态：① `for (...) {` 花括号配对；② 单语句体 `for (...) x++;`
 * @returns {[number, number]|null} [起行, 止行]
 */
export function findLoopRange(tokens, i) {
  const found = seekLoopBody(tokens, i);
  if (!found) return null;
  // 单语句循环体：结束行由扫描时确定
  const endLine = found.singleStmt ? found.endLine : endLineOf(tokens, matchBrace(tokens, found.brace));
  if (endLine === null) return null;
  // 起始行取**循环体**而非循环头：
  //   `for (const line of readFileSync(f).split('\n')) {` 里 readFileSync 只执行一次，
  //   若把循环头那一行也算进范围，就会被误报成「循环内 I/O」（实测 repos.js:81）。
  //   有花括号体时用 '{' 所在行；单语句体时用语句自身所在行。
  const bodyStart = found.singleStmt
    ? (tokens[i + 1]?.line ?? tokens[i].line)
    : tokens[found.brace].line;
  return [Math.max(tokens[i].line, bodyStart), endLine];
}

/** 花括号配对结果的结束行；配对失败返回 null。 */
export function endLineOf(tokens, range) {
  return range ? tokens[range[1]].line : null;
}

/**
 * 从循环关键字找循环体。
 *   拆自 findLoopRange（原函数圈复杂度 14，超阈值 10）。
 * @returns {{brace:number}|{singleStmt:true,endLine:number}|null}
 */
export function seekLoopBody(tokens, i) {
  for (let j = i + 1; j < Math.min(tokens.length, i + LOOP_BODY_SEARCH_TOKENS); j++) {
    const tj = tokens[j];
    if (tj.type === 'punct' && tj.value === '{') return { brace: j };
    if (tj.type === 'punct' && tj.value === ';') return null;
    if (isSingleStmtLoopClose(tokens, j)) return { singleStmt: true, endLine: tj.line };
  }
  return null;
}

/** 单语句循环体（`for (...) x++;`）：括号配对完成却没 '{' → 认到该语句结束。 */
export function isSingleStmtLoopClose(tokens, j) {
  const tj = tokens[j];
  if (tj.type !== 'punct' || tj.value !== ')') return false;
  const nextT = tokens[j + 1];
  if (!nextT) return false;
  return !(nextT.type === 'punct' && nextT.value === '{');
}

/**
 * 识别**同步**函数体：`function f(){}` / `const f = () => {}` / `{ f(){} }` 方法简写。
 *   async 形态由 classifyFnHead 处理（此处跳过，避免与它重复收录）。
 * @returns {[number, number]|null} [起行, 止行]
 */
export function classifySyncFnHead(tokens, i, t) {
  // `function name(` —— 前面不是 async（async 已在上一分支处理）
  if (t.value === 'function') {
    const open = findBody(tokens, i + 1);
    return rangeOf(tokens, open);
  }
  // 关键字一律不是函数名：`for (...) {` / `if (...) {` / `while (...) {` 等
  //   与「方法简写 name(...) {」在 token 形态上完全同形，不排除会把循环/分支
  //   体误收成函数体，进而让其中的 I/O 丢掉 inLoop/inAsync 上下文
  //   （实测：for 循环被当成方法后 inLoop 恒 false，三条循环用例全挂）。
  if (FUNCTION_HEAD_EXCLUDE.has(t.value)) return null;
  const next = tokens[i + 1];
  if (!next || next.type !== 'punct') return null;
  // 方法简写**先判**：`name(...) {` —— '(' 配对后紧跟 '{' 即是方法体。
  //   不能先找 `=>`：那样会把 `h(req,res){ ... }` 的方法体一路扫成箭头候选
  //   （深度归零后继续前进，越过分号，最终撞到外层 '}' 才以 -1 退出），
  //   导致对象方法简写的函数体从未被收录（实测 inRequest 漏判）。
  if (next.value === '(') {
    const brace = findBodyAfterParen(tokens, i + 1);
    if (brace !== -1) return rangeOf(tokens, brace);
  }
  // 箭头函数：`name = (...) => {` / `name: (...) => {`
  if (next.value === '=' || next.value === ':') {
    const arrow = findArrowBody(tokens, i);
    if (arrow !== -1) return rangeOf(tokens, arrow);
  }
  return null;
}

/** 花括号配对 → 行范围；open 非法返回 null。 */
export function rangeOf(tokens, open) {
  if (open === -1) return null;
  const range = matchBrace(tokens, open);
  return range ? [tokens[open].line, tokens[range[1]].line] : null;
}

/** 从标识符起找同一层的 '=>'，返回其后函数体 '{' 下标（无则 -1）。 */
export function findArrowBody(tokens, i) {
  let depth = 0;
  for (let j = i + 1; j < Math.min(tokens.length, i + ARROW_SEARCH_TOKENS); j++) {
    const tj = tokens[j];
    if (tj.type !== 'punct') continue;
    if (tj.value === '(' || tj.value === '[' || tj.value === '{') { depth++; continue; }
    if (tj.value === ')' || tj.value === ']' || tj.value === '}') { depth--; if (depth < 0) return -1; continue; }
    if (tj.value === ';' && depth === 0) return -1;
    if (tj.value === '=>' && depth === 0) return findBody(tokens, j + 1);
  }
  return -1;
}

/**
 * '(' 配对完成后的 '{'（方法简写）；无则 -1。
 *   注意 matchBrace 只配对**花括号**，不能拿它配圆括号——否则会从 '(' 位置
 *   一路扫到方法体的 '{...}' 并返回方法体本身，`after` 落到体后的 '}' 上，
 *   方法简写永远识别不出来（实测对象方法漏判的根因）。
 */
export function findBodyAfterParen(tokens, parenIdx) {
  const close = matchParen(tokens, parenIdx);
  if (close === -1) return -1;
  const after = tokens[close + 1];
  return after && after.type === 'punct' && after.value === '{' ? close + 1 : -1;
}

/** 圆括号配对：返回右括号下标；不匹配返回 -1。 */
export function matchParen(tokens, parenIdx) {
  let depth = 0;
  for (let i = parenIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'punct') continue;
    if (t.value === '(') depth++;
    else if (t.value === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * 判断 token 是否为 async 函数头，并返回函数体范围。
 *   只收 async 函数：同步函数体不参与 inAsync 判定（用它反而是误报来源）。
 * @returns {[number, number]|null} [起行, 止行]
 */
export function classifyFnHead(tokens, i, t) {
  if (t.value !== 'async') return null;
  const open = findAsyncBody(tokens, i);
  if (open === -1) return null;
  const range = matchBrace(tokens, open);
  return range ? [tokens[open].line, tokens[range[1]].line] : null;
}
