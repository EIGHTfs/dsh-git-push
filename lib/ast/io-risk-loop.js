/**
 * dsh-git-push — I/O 风险分级：循环判定
 *
 * 职责：判断某处 I/O 是否在循环体内、以及该循环执行次数能否静态确定为很少
 *   （小字面量数组 → 判定降级）。这是分级里最易出错的一块：
 *   「迭代器表达式内的 I/O 只执行一次」与「数组方法回调体内的 I/O 逐元素执行」
 *   形态相邻而语义相反，判据与反例都记在各函数注释里。
 *
 * 分层：lib/ast/io-risk.js 的从属模块（由该文件再导出），调用方不应直接 import。
 */
import { LOOP_KEYWORDS, LOOP_METHODS, isLoopHead } from './io-risk-const.js';
import {
  SMALL_FIXED_LOOP_MAX, LOOP_BODY_SEARCH_TOKENS, findLoopRange, matchParen, endLineOf, seekLoopBody,
  isSingleStmtLoopClose, classifyFnHead, classifySyncFnHead,
} from './io-risk-fn.js';

/**
 * 数组方法调用（`.some(` / `.map(` 等）的接收者是否为固定小字面量数组。
 *   形如 `['a','b','c'].some(...)`：向前找到匹配的 `]`，其配对 `[` 即数组字面量，
 *   元素数 ≤ SMALL_FIXED_LOOP_MAX 才算固定小集合。
 * @returns {boolean}
 */
export function isSmallLiteralCallee(tokens, methodIdx) {
  // methodIdx 指向方法名，其前应为 `.`，再前应为 `]`
  if (tokens[methodIdx - 1]?.value !== '.') return false;
  const close = methodIdx - 2;
  if (tokens[close]?.value !== ']') return false;
  const open = matchingBracketBack(tokens, close);
  return open !== -1 && countLiteralElements(tokens, open) <= SMALL_FIXED_LOOP_MAX;
}

/** 从 `]` 位置向左配对，返回 `[` 下标；不匹配返回 -1。 */
function matchingBracketBack(tokens, closeIdx) {
  let depth = 0;
  for (let j = closeIdx; j >= 0; j--) {
    const t = tokens[j];
    if (t.type !== 'punct') continue;
    if (t.value === ']') depth++;
    else if (t.value === '[') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

/**：字面量数组起手 + 仅少量 push 追加。
 *
 * 识别 `const candidates = ['a']; if (x) candidates.push(b); for (const f of candidates)`
 *   这类**候选路径探测**——它规模确定（≤ SMALL_FIXED_LOOP_MAX）、执行次数极少，
 *   与字面量数组同义；不识别会导致「循环内 I/O 高风险」误报（实测 config.js /
 *   readme-gen / credentials.js 共 8 处候选探测全被误判）。
 *
 * 保守策略：只要出现字面量数组**之外**的写入方式（concat/splice/展开赋值等），
 *   即视为规模未知，返回 false（宁可保守报高风险，也不放过真问题）。
 * @param {Array} tokens tokenize 结果
 * @param {string} name 数组变量名
 * @param {number} ofIdx 循环头 'of'/'in' 的位置（只回看它之前）
 * @returns {boolean}
 */
export function isSmallPushedArray(tokens, name, ofIdx) {
  // ① 声明处必须是字面量数组：`const name = [` / `let name = [`
  const declIdx = findLiteralArrayDecl(tokens, name, ofIdx);
  if (declIdx === -1) return false;

  // ② 统计其后的 push 次数；出现任何让规模不可静态确定的写法即判未知
  const pushes = countUnsafePushes(tokens, name, ofIdx);
  if (pushes === null) return false;

  // ③ 字面量区元素数 + push 次数 ≤ 上限
  return countLiteralElements(tokens, declIdx) + pushes <= SMALL_FIXED_LOOP_MAX;
}

/**
 * 回看 `name = [` 形态的声明位置；未以字面量数组起手返回 -1。
 *   取**最后一次**匹配（同名变量被重新赋值时，以离循环最近的一次为准）。
 * @returns {number} 数组 `[` 的 token 下标；未找到为 -1
 */
export function findLiteralArrayDecl(tokens, name, ofIdx) {
  let declIdx = -1;
  for (let j = 0; j < ofIdx; j++) {
    if (tokens[j].type !== 'ident' || tokens[j].value !== name) continue;
    const eq = tokens[j + 1];
    const open = tokens[j + 2];
    if (eq?.value === '=' && open?.value === '[') declIdx = j + 2;
  }
  return declIdx;
}

/** 让数组规模不可静态确定的写法（合并/改写类方法）。 */
export const UNSAFE_ARRAY_METHODS = new Set([
  'concat', 'splice', 'unshift', 'apply', 'flat', 'flatMap',
]);

/**
 * 数「安全 push」的次数。
 *   出现以下任一即返回 null（表示规模未知，调用方按高风险处理）：
 *     · 展开运算符 `...`
 *     · 合并/改写类方法（UNSAFE_ARRAY_METHODS）
 *     · push 发生在循环体内（元素来自被遍历集合，次数不可静态确定）
 *     · push 次数已超上限（早退）
 * @returns {number|null} push 次数；规模未知为 null
 */
export function countUnsafePushes(tokens, name, ofIdx) {
  let pushes = 0;
  for (let j = 0; j < ofIdx; j++) {
    const t = tokens[j];
    // 展开运算符 `[...other]` 是 punct，会让规模不可静态确定
    if (t.type === 'punct' && t.value === '...') return null;
    if (t.type !== 'ident') continue;
    if (UNSAFE_ARRAY_METHODS.has(t.value)) return null;
    if (t.value !== 'push') continue;
    // 形态：name . push (
    if (tokens[j - 1]?.value !== '.' || tokens[j - 2]?.value !== name) continue;
    // push 若发生在循环体内（`for (const x of all) c.push(x)`），元素来自循环变量，
    //   规模取决于被遍历的集合 —— 不可静态确定。
    //   注意从 **push 本身** 的位置起扫：若从参数位置起扫，push 自己的 '(' 会让
    //   深度立刻变负而被误判为「不在循环内」。
    if (insideLoopOver(tokens, j)) return null;
    pushes++;
    if (pushes + 1 > SMALL_FIXED_LOOP_MAX) return null;
  }
  return pushes;
}

/**
 * 循环头 `(...)` 的 token 下标范围 [openIdx, closeIdx]；无括号返回 null。
 */
export function loopHeadSpan(tokens, i) {
  // 只对关键字循环（for/while）剔除头部表达式：
  //   数组方法（`.forEach(cb)` / `.find(cb)`）的括号里是**回调体**，其中的 I/O
  //   会随每个元素执行，正是「循环内 I/O」，绝不能剔除（实测误判为 low）。
  if (!LOOP_KEYWORDS.has(tokens[i].value)) return null;
  let open = -1;
  for (let j = i + 1; j < Math.min(tokens.length, i + LOOP_BODY_SEARCH_TOKENS); j++) {
    const t = tokens[j];
    if (t.type !== 'punct') continue;
    if (t.value === '(') { open = j; break; }
    if (t.value === '{' || t.value === ';') return null;
  }
  if (open === -1) return null;
  const close = matchParenIn(tokens, open);
  return close === -1 ? null : [open, close];
}

/** 前向圆括号配对：返回右括号下标；不匹配返回 -1。 */
function matchParenIn(tokens, openIdx) {
  let depth = 0;
  for (let j = openIdx; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type !== 'punct') continue;
    if (t.value === '(') depth++;
    else if (t.value === ')') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

/**
 * 位置 idx 的 push 是否发生在某个循环体内。
 *
 * 用于识别「从大集合填充」：`for (const x of all) c.push(x)` 静态看只 push 一次，
 *   但实际执行次数 = all 的长度 —— 规模不可静态确定，必须按未知处理。
 *
 * 朴素但够用的判据：向前扫到最近的 `{`，若该 `{` 之前紧跟 `)` 且括号头是
 *   for/while/do，或直接是 `do {`，即认为在循环体内。
 * @returns {boolean}
 */
export function insideLoopOver(tokens, idx) {
  // 向左扫，遇到 `for`/`while` 关键字即认为在循环体内；
  //   途中若先遇到语句边界（`;`）或块边界（`}`），说明已跨出当前语句，放弃。
  //   不区分花括号体与单语句体 —— 两种都算。
  let depth = 0;
  for (let j = idx - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.type !== 'punct') {
      // 未闭合的深度里遇到循环关键字：说明正处在它的头部/体内
      if (t.type === 'ident' && LOOP_KEYWORDS.has(t.value)) return true;
      continue;
    }
    if (t.value === ')' || t.value === ']' || t.value === '}') { depth++; continue; }
    if (t.value === '(' || t.value === '[') { depth--; if (depth < 0) return false; continue; }
    if (t.value === '{') {
      if (depth > 0) { depth--; continue; }
      return isLoopBodyBrace(tokens, j);
    }
    if (t.value === ';' && depth === 0) return false;
  }
  return false;
}

/** 闭合类括号：向右扫时用于累计深度。 */

/** 开启类括号：向左扫时用于消解深度。 */

/**
 * 该 `{` 是否开启一个循环体。
 *   块的**开**括号可能是循环体（`for (...) {`）—— 回看它前面是不是循环头；
 *   不是则说明已跨出到别的作用域。
 * @returns {boolean}
 */
export function isLoopBodyBrace(tokens, braceIdx) {
  const prev = tokens[braceIdx - 1];
  if (prev?.value === 'do') return true;              // do { ... }
  if (prev?.value !== ')') return false;
  const paren = matchingParenBack(tokens, braceIdx - 1);
  if (paren === -1) return false;
  const kw = tokens[paren - 1]?.value;
  return kw === 'for' || kw === 'while';
}

/** 从右括号位置向左配对，返回左括号下标；不匹配返回 -1。 */
function matchingParenBack(tokens, closeIdx) {
  let depth = 0;
  for (let j = closeIdx; j >= 0; j--) {
    const t = tokens[j];
    if (t.type !== 'punct') continue;
    if (t.value === ')') depth++;
    else if (t.value === '(') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

/** 数 `[ ... ]` 字面量数组的元素个数（顶层逗号 + 1；空数组为 0）。 */

/**
 *   形如 `for (const x of ['a', 'b', 'c'])`：元素数固定且 ≤ SMALL_FIXED_LOOP_MAX。
 *   只认字面量数组字面形态；变量/函数调用一律视为规模未知（保守判高风险）。
 * @returns {boolean}
 */
export function isSmallFixedLoop(tokens, i) {
  // ① 数组方法形式（`['a','b'].some((n) => ...)`）：受调用的数组若是字面量，
  //   规模同样固定且极小。这一形态不走 for...of，早先完全未覆盖。
  if (LOOP_METHODS.has(tokens[i].value) && isSmallLiteralCallee(tokens, i)) return true;

  // ② for...of / for...in 形态：看被遍历的表达式
  const ofIdx = findOfKeyword(tokens, i);
  if (ofIdx === -1) return false;

  const open = tokens[ofIdx + 1];
  if (!open) return false;

  // 变量数组（`for (const f of candidates)`）：回看它的声明，若以字面量数组起手
  //   且仅用少量 push 追加，则规模固定且极小 —— 与字面量数组同义，按小集合处理。
  if (open.value !== '[') {
    return open.type === 'ident' && isSmallPushedArray(tokens, open.value, ofIdx);
  }
  // ③ 字面量数组形态：数顶层元素个数
  return countLiteralElements(tokens, ofIdx + 1) <= SMALL_FIXED_LOOP_MAX;
}

/**
 * 在循环头内定位 `of` / `in` 关键字；找不到返回 -1。
 *   扫到 `{` 或 `;` 即停 —— 说明已越过循环头。
 * @returns {number} 关键字 token 下标
 */
export function findOfKeyword(tokens, i) {
  const limit = Math.min(tokens.length, i + LOOP_BODY_SEARCH_TOKENS);
  for (let j = i + 1; j < limit; j++) {
    const tj = tokens[j];
    if (tj.type === 'ident' && (tj.value === 'of' || tj.value === 'in')) return j;
    if (tj.type === 'punct' && (tj.value === '{' || tj.value === ';')) break;
  }
  return -1;
}

/**
 * 从 `[` 起数顶层元素个数，判断是否为「固定小集合」（存在元素且 ≤ 上限）。
 *
 * 计数规则：深度回到 0 时遇 `]` 收尾；深度 1 上的逗号即分隔符。
 *   元素数超上限时早退，避免长数组上白扫。
 * @param {number} fromIdx 数组 `[` 的下标
 * @returns {boolean}
 */
export function countLiteralElements(tokens, fromIdx) {
  let depth = 0;
  let count = 0;
  let hasElement = false;
  for (let j = fromIdx; j < tokens.length; j++) {
    const tj = tokens[j];
    if (tj.type !== 'punct') { hasElement = true; continue; }
    if (tj.value === '[' || tj.value === '(' || tj.value === '{') { depth++; continue; }
    if (tj.value === ']') {
      depth--;
      if (depth === 0) return hasElement ? count + 1 : 0;
      continue;
    }
    if (tj.value === ')' || tj.value === '}') { depth--; continue; }
    if (tj.value === ',' && depth === 1) { count++; hasElement = true; }
    if (count + 1 > SMALL_FIXED_LOOP_MAX) return count + 1; // 超上限早退（已知大于上限）
  }
  return false;
}

/**
 * 收集所有函数体范围（含 async 标记）与循环体范围，用于上下文归属判断。
 *
 * 刻意不跳过函数体：函数内还嵌着循环与内层函数，跳过会漏收内层范围。
 * @param {Array} tokens tokenize 结果
 * @returns {{asyncFns: Array, loops: Array}}
 */
export function collectRanges(tokens) {
  const asyncFns = [];
  const allFns = [];
  const loops = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    const fnRange = classifyFnHead(tokens, i, t);
    if (fnRange) { asyncFns.push(fnRange); allFns.push(fnRange); continue; }
    // 同步函数/箭头函数/对象方法简写：不参与 inAsync，但要参与「请求路径」判定
    //   （否则同步 HTTP handler 里的 I/O 被误判成「启动路径一次性」而低估风险）。
    const syncRange = classifySyncFnHead(tokens, i, t);
    if (syncRange) { allFns.push(syncRange); continue; }
    if (isLoopHead(t, tokens[i - 1])) {
      const range = findLoopRange(tokens, i);
      // 固定小字面量数组（`for (const n of ['a','b','c'])`）迭代次数确定且极少，
      //   循环内同步 I/O 的开销 = 元素数个系统调用，不构成「逐次阻塞放大耗时」——
      //   标出来供判定层降级（实测：3 个 SSH key 名的探测循环被误判为高风险）。
      if (range) {
        // 第 4 项 = 循环头 `(...)` 的 token 下标范围，用于剔除「迭代器表达式内的 I/O」：
        //   `for (const line of readFileSync(f).split('\n'))` 里 readFileSync 只在
        //   进入循环前执行一次，把它算作循环内 I/O 是误报（实测 repos.js:81）。
        loops.push([range[0], range[1], isSmallFixedLoop(tokens, i), loopHeadSpan(tokens, i)]);
      }
    }
  }
  return { asyncFns, allFns, loops };
}
