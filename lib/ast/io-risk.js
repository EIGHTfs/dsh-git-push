/**
 * dsh-git-push — I/O 风险分级（AST 层，2026-09-17）
 *
 * 职责：找出文件里的**全部** fs 调用（同步 + 异步），判定每个调用的上下文
 *   （异步路径 / 循环内 / 请求处理路径 / 启动路径）与操作类别（读 / 写 / 删 / 改名），
 *   据此给出四级风险，供审计 findings 与 scripts/scan-file-io.mjs 共用。
 *
 * 分层约定（README「正则初筛 → AST 精筛」）：本文件属 `lib/ast/` 实现层，
 *   只把**判定结果**交出去；调用方（lib/checks/）只做「转 finding / 转报表」。
 *
 * 四级风险（写类操作加权一档）：
 *   🔴 high   —— 异步路径中的同步 I/O；或循环内的 I/O（含异步，逐次 await 放大阻塞）
 *   🟠 medium —— 请求处理路径上的 I/O；或写/删类操作落在并发路径
 *   🟡 low    —— 启动路径上的同步 I/O（模块顶层 / apply() 等一次性初始化）
 *   🟢 safe   —— 异步 + 无循环 + 非关键路径
 *
 * 写/删优先：`write`/`delete`/`rename` 在同一上下文下**提升一档**
 *   （safe → low，low → medium，medium → high），因为写错/删错不可逆。
 */
import { tokenize } from './tokenizer.js';
import { matchBrace } from './brace.js';

/** 同步 fs 调用名（带 Sync 后缀）→ 统一视为阻塞调用。 */
const SYNC_FS_FNS = new Set([
  'readFileSync', 'writeFileSync', 'appendFileSync', 'existsSync', 'statSync', 'lstatSync',
  'readdirSync', 'mkdirSync', 'rmdirSync', 'rmSync', 'unlinkSync', 'renameSync',
  'copyFileSync', 'chmodSync', 'chownSync', 'openSync', 'closeSync', 'readSync',
  'writeSync', 'truncateSync', 'realpathSync', 'symlinkSync', 'linkSync', 'accessSync',
]);

/** 异步 fs 调用名（无 Sync 后缀的常见形态）。 */
const ASYNC_FS_FNS = new Set([
  'readFile', 'writeFile', 'appendFile', 'stat', 'lstat', 'readdir', 'mkdir', 'rmdir',
  'rm', 'unlink', 'rename', 'copyFile', 'chmod', 'chown', 'open', 'close', 'read',
  'write', 'truncate', 'realpath', 'symlink', 'link', 'access', 'createReadStream',
  'createWriteStream', 'watch', 'opendir',
]);

/** 操作类别：写 / 删 / 改名 涉及数据安全，风险加权。 */
const KIND_BY_FN = {
  writeFileSync: 'write', writeFile: 'write', appendFileSync: 'write', appendFile: 'write',
  createWriteStream: 'write', writeSync: 'write', write: 'write', truncateSync: 'write',
  truncate: 'write',
  unlinkSync: 'delete', unlink: 'delete', rmSync: 'delete', rm: 'delete',
  rmdirSync: 'delete', rmdir: 'delete',
  renameSync: 'rename', rename: 'rename', copyFileSync: 'rename', copyFile: 'rename',
};

/** 循环体识别：for/while/do 关键字与数组迭代方法。 */
const LOOP_KEYWORDS = new Set(['for', 'while', 'do']);
const LOOP_METHODS = new Set([
  'forEach', 'map', 'filter', 'reduce', 'reduceRight', 'flatMap', 'some', 'every',
  'find', 'findIndex', 'findLast', 'findLastIndex',
]);

/** 请求处理路径特征（在函数体内出现任一即认定）。 */
const REQUEST_PATTERNS = [
  /\b(?:req|request)\.(?:headers|method|url|body|on)\b/,
  /\bres\.(?:writeHead|write|end|setHeader|statusCode)\b/,
  /\b(?:handle|route|onRequest)[A-Za-z_$]*\s*\(/,
  /\bcreateServer\s*\(\s*(?:async\s*)?\(?\s*(?:req|request)\s*,/,
  /\(\s*(?:req|request)\s*,\s*(?:res|response)\s*\)/,
];

/** 风险档位（数值越大越高）。 */
const LEVELS = ['safe', 'low', 'medium', 'high'];

/** 徽标。 */
export const RISK_BADGE = { high: '🔴', medium: '🟠', low: '🟡', safe: '🟢' };

/** 风险中文名。 */
export const RISK_LABEL = { high: '高', medium: '中', low: '低', safe: '安全' };

/** 档位提升 n 级（用于写/删加权）。 */
function raise(level, n = 1) {
  const i = LEVELS.indexOf(level);
  return LEVELS[Math.min(LEVELS.length - 1, i + n)];
}

/**
 * 取包含该行的最内层循环范围（含 smallFixed 标记）。
 *   嵌套循环时取最内层：内层规模才是单次 I/O 的实际重复次数。
 * @returns {Array|null} [起行, 止行, smallFixed]
 */
function enclosingLoop(loops, line) {
  let best = null;
  for (const entry of loops) {
    if (line < entry[0] || line > entry[1]) continue;
    if (!best || entry[0] >= best[0]) best = entry;
  }
  return best;
}

/** 函数体 '{' 的搜索窗口（token 数）：够覆盖 `async function name(a, b, c) {` 这类长签名。 */
const BODY_SEARCH_TOKENS = 40;
/** 循环体 '{' 的搜索窗口（token 数）：够覆盖 `for (const x of someLongExpression) {`。 */
const LOOP_BODY_SEARCH_TOKENS = 30;
/** 不能作为函数名的关键字：这些后面跟 `(...) {` 时是语句块，不是方法简写。 */
const FUNCTION_HEAD_EXCLUDE = new Set([
  'for', 'while', 'if', 'else', 'switch', 'do', 'try', 'catch', 'finally',
  'return', 'typeof', 'new', 'delete', 'void', 'in', 'of', 'await', 'yield',
]);
/** 箭头函数 `=>` 的搜索窗口（token 数）：够覆盖 `const f = (a, b) => {`。 */
const ARROW_SEARCH_TOKENS = 60;
/** 「固定小循环」的元素数上限：字面量数组不超过此值时，循环内同步 I/O 不算高风险。 */
const SMALL_FIXED_LOOP_MAX = 5;

/**
 * 找函数/循环体的 '{'。
 * @returns {number} '{' 的 token 下标；遇 ';' 或超窗口返回 -1
 */
function findBody(tokens, from, window = BODY_SEARCH_TOKENS) {
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
function findAsyncBody(tokens, i) {
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
function findLoopRange(tokens, i) {
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
function endLineOf(tokens, range) {
  return range ? tokens[range[1]].line : null;
}

/**
 * 从循环关键字找循环体。
 *   拆自 findLoopRange（原函数圈复杂度 14，超阈值 10）。
 * @returns {{brace:number}|{singleStmt:true,endLine:number}|null}
 */
function seekLoopBody(tokens, i) {
  for (let j = i + 1; j < Math.min(tokens.length, i + LOOP_BODY_SEARCH_TOKENS); j++) {
    const tj = tokens[j];
    if (tj.type === 'punct' && tj.value === '{') return { brace: j };
    if (tj.type === 'punct' && tj.value === ';') return null;
    if (isSingleStmtLoopClose(tokens, j)) return { singleStmt: true, endLine: tj.line };
  }
  return null;
}

/** 单语句循环体（`for (...) x++;`）：括号配对完成却没 '{' → 认到该语句结束。 */
function isSingleStmtLoopClose(tokens, j) {
  const tj = tokens[j];
  if (tj.type !== 'punct' || tj.value !== ')') return false;
  const nextT = tokens[j + 1];
  if (!nextT) return false;
  return !(nextT.type === 'punct' && nextT.value === '{');
}

/**
 * 收集所有函数体范围（含 async 标记）与循环体范围，用于上下文归属判断。
 *
 * 刻意不跳过函数体：函数内还嵌着循环与内层函数，跳过会漏收内层范围。
 * @param {Array} tokens tokenize 结果
 * @returns {{asyncFns: Array, loops: Array}}
 */
function collectRanges(tokens) {
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
    if (isLoopHead(t)) {
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

/**
 * 识别**同步**函数体：`function f(){}` / `const f = () => {}` / `{ f(){} }` 方法简写。
 *   async 形态由 classifyFnHead 处理（此处跳过，避免与它重复收录）。
 * @returns {[number, number]|null} [起行, 止行]
 */
function classifySyncFnHead(tokens, i, t) {
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
function rangeOf(tokens, open) {
  if (open === -1) return null;
  const range = matchBrace(tokens, open);
  return range ? [tokens[open].line, tokens[range[1]].line] : null;
}

/** 从标识符起找同一层的 '=>'，返回其后函数体 '{' 下标（无则 -1）。 */
function findArrowBody(tokens, i) {
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
function findBodyAfterParen(tokens, parenIdx) {
  const close = matchParen(tokens, parenIdx);
  if (close === -1) return -1;
  const after = tokens[close + 1];
  return after && after.type === 'punct' && after.value === '{' ? close + 1 : -1;
}

/** 圆括号配对：返回右括号下标；不匹配返回 -1。 */
function matchParen(tokens, parenIdx) {
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
function classifyFnHead(tokens, i, t) {
  if (t.value !== 'async') return null;
  const open = findAsyncBody(tokens, i);
  if (open === -1) return null;
  const range = matchBrace(tokens, open);
  return range ? [tokens[open].line, tokens[range[1]].line] : null;
}

/**
 * 数组方法调用（`.some(` / `.map(` 等）的接收者是否为固定小字面量数组。
 *   形如 `['a','b','c'].some(...)`：向前找到匹配的 `]`，其配对 `[` 即数组字面量，
 *   元素数 ≤ SMALL_FIXED_LOOP_MAX 才算固定小集合。
 * @returns {boolean}
 */
function isSmallLiteralCallee(tokens, methodIdx) {
  // methodIdx 指向方法名，其前应为 `.`，再前应为 `]`
  if (tokens[methodIdx - 1]?.value !== '.') return false;
  const close = methodIdx - 2;
  if (tokens[close]?.value !== ']') return false;
  const open = matchingBracketBack(tokens, close);
  return open !== -1 && literalsInArray(tokens, open) <= SMALL_FIXED_LOOP_MAX;
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
function isSmallPushedArray(tokens, name, ofIdx) {
  // 声明处必须是字面量数组：`const name = [` / `let name = [`
  let declIdx = -1;
  for (let j = 0; j < ofIdx; j++) {
    if (tokens[j].type !== 'ident' || tokens[j].value !== name) continue;
    const eq = tokens[j + 1];
    const open = tokens[j + 2];
    if (eq && eq.type === 'punct' && eq.value === '='
      && open && open.type === 'punct' && open.value === '[') { declIdx = j + 2; }
  }
  if (declIdx === -1) return false;

  // 危险写法：出现即视为规模未知（保守起见宁可报高风险，也不放过真问题）
  const UNSAFE = new Set(['concat', 'splice', 'unshift', 'apply', 'flat', 'flatMap']);
  let pushes = 0;
  for (let j = 0; j < ofIdx; j++) {
    const t = tokens[j];
    // 展开运算符 `[...other]` 是 punct，会让规模不可静态确定
    if (t.type === 'punct' && t.value === '...') return false;
    if (t.type !== 'ident') continue;
    if (UNSAFE.has(t.value)) return false; // 任何合并/改写都让规模不可静态确定
    if (t.value !== 'push') continue;
    // 形态：name . push (
    if (tokens[j - 1]?.value === '.' && tokens[j - 2]?.value === name) {
      // push 若发生在循环体内（`for (const x of all) c.push(x)`），元素来自循环
      //   变量，规模取决于被遍历的集合 —— 不可静态确定，直接判为未知。
      //   注意从 **push 本身** 的位置起扫：若从参数位置起扫，push 自己的 '(' 会让
      //   深度立刻变负而被误判为「不在循环内」。
      if (insideLoopOver(tokens, j)) return false;
      pushes++;
      if (pushes + 1 > SMALL_FIXED_LOOP_MAX) return false; // 超出上限早退
      continue;
    }
  }
  // 字面量区元素数 + push 次数 ≤ 上限
  return literalsInArray(tokens, declIdx) + pushes <= SMALL_FIXED_LOOP_MAX;
}

/**
 * 循环头 `(...)` 的 token 下标范围 [openIdx, closeIdx]；无括号返回 null。
 */
function loopHeadSpan(tokens, i) {
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
function insideLoopOver(tokens, idx) {
  // 朴素且稳健：向左扫，遇到 `for`/`while` 关键字即认为在循环体内；
  //   途中若先遇到语句边界（`;`）或块边界（`}`），说明已经跨出当前语句，放弃。
  //   不区分花括号体与单语句体 —— 两种都算。
  let depth = 0;
  for (let j = idx - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.type !== 'punct') {
      // 未闭合的深度里遇到循环关键字：说明正处在它的头部/体内
      if (t.type === 'ident' && (t.value === 'for' || t.value === 'while')) return true;
      continue;
    }
    if (t.value === ')' || t.value === ']' || t.value === '}') { depth++; continue; }
    if (t.value === '(' || t.value === '[') { depth--; if (depth < 0) return false; continue; }
    if (t.value === '{') {
      // 块的**开**括号：它可能正是循环体（`for (...) {`）——不能就此放弃。
      //   回看它前面是不是循环头，是则命中；否则说明已跨出到别的作用域，放弃。
      if (depth > 0) { depth--; continue; }
      const prev = tokens[j - 1];
      if (prev?.value === 'do') return true;
      if (prev?.value === ')') {
        const paren = matchingParenBack(tokens, j - 1);
        if (paren !== -1) {
          const kw = tokens[paren - 1]?.value;
          return kw === 'for' || kw === 'while';
        }
      }
      return false;
    }
    if (t.value === ';' && depth === 0) return false;
  }
  return false;
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
function literalsInArray(tokens, openIdx) {
  let depth = 0;
  let count = 0;
  let hasElement = false;
  for (let j = openIdx; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type !== 'punct') { if (depth > 0) hasElement = true; continue; }
    if (t.value === '[') { depth++; continue; }
    if (t.value === ']') { depth--; if (depth === 0) return hasElement ? count + 1 : 0; continue; }
    if (t.value === '(' || t.value === '{') { depth++; continue; }
    if (t.value === ')' || t.value === '}') { depth--; continue; }
    if (t.value === ',' && depth === 1) count++;
  }
  return 0;
}

/**
 *   形如 `for (const x of ['a', 'b', 'c'])`：元素数固定且 ≤ SMALL_FIXED_LOOP_MAX。
 *   只认字面量数组字面形态；变量/函数调用一律视为规模未知（保守判高风险）。
 * @returns {boolean}
 */
function isSmallFixedLoop(tokens, i) {
  // ① 数组方法形式（`['a','b'].some((n) => ...)` / `.map(...)` 等）：
  //   受调用的数组若是字面量，规模同样固定且极小。这一形态不走 for...of，
  //   早先完全未覆盖——实测 `['README.md','readme.md'].some((n) => existsSync(...))`
  //   被报成「循环内 I/O 高风险」，但它最多跑 4 次。
  if (LOOP_METHODS.has(tokens[i].value) && isSmallLiteralCallee(tokens, i)) return true;

  // 找循环头里的 'of' / 'in' 关键字
  let ofIdx = -1;
  for (let j = i + 1; j < Math.min(tokens.length, i + LOOP_BODY_SEARCH_TOKENS); j++) {
    const tj = tokens[j];
    if (tj.type === 'ident' && (tj.value === 'of' || tj.value === 'in')) { ofIdx = j; break; }
    if (tj.type === 'punct' && (tj.value === '{' || tj.value === ';')) break;
  }
  if (ofIdx === -1) return false;

  const open = tokens[ofIdx + 1];
  // 注意：这里**不能**要求 open 是 punct —— 字面量数组（`of ['a','b']`）后跟 '['
  //   是 punct，但变量数组（`of candidates`）后跟的是 ident。早先沿用「必须是 punct」
  //   的旧检查，会把变量数组直接挡在门外，下方新增的 push 计数分支永远走不到
  //   （实测：分支内函数单独测返回 true，整体却恒 false）。
  if (!open) return false;
  // 变量数组（`for (const f of candidates)`）：回看它的声明，若以字面量数组起手
  //   且**仅用少量 push 追加**，则规模固定且极小 —— 与字面量数组同义，按小集合处理。
  //   实测 `const candidates = ['a']; if (x) candidates.push(b);` 这类「候选路径探测」
  //   被报成「循环内 I/O 高风险」，但实际只跑 2~3 次，开销微秒级。
  if (open.value !== '[') {
    return open.type === 'ident' && isSmallPushedArray(tokens, open.value, ofIdx);
  }

  // 数顶层逗号：深度回到 0 时遇 ']' 收尾
  let depth = 0;
  let count = 0;
  let hasElement = false;
  for (let j = ofIdx + 1; j < tokens.length; j++) {
    const tj = tokens[j];
    if (tj.type !== 'punct') { hasElement = true; continue; }
    if (tj.value === '[' || tj.value === '(' || tj.value === '{') { depth++; continue; }
    if (tj.value === ']') {
      depth--;
      if (depth === 0) return hasElement && count + 1 <= SMALL_FIXED_LOOP_MAX;
      continue;
    }
    if (tj.value === ')' || tj.value === '}') { depth--; continue; }
    if (tj.value === ',' && depth === 1) { count++; hasElement = true; }
    if (count + 1 > SMALL_FIXED_LOOP_MAX) return false; // 超上限早退
  }
  return false;
}

/** 是否循环头：for/while/do 关键字，或 .forEach/.map( 等方法调用。 */
function isLoopHead(t) {
  return LOOP_KEYWORDS.has(t.value) || LOOP_METHODS.has(t.value);
}

/**
 * 扫描文件内全部 fs 调用并分级。
 *
 * @param {string} text 文件全文
 * @returns {Array<{
 *   line:number, call:string, via:string, type:'sync'|'async', kind:'read'|'write'|'delete'|'rename',
 *   inAsync:boolean, inLoop:boolean, inRequest:boolean, inStartup:boolean,
 *   risk:'high'|'medium'|'low'|'safe', reason:string
 * }>}
 */
/** 模块顶层/初始化的判定常量（魔数具名化，说明取值理由）。 */

/**
 * 判断 token 位置是否是一个真实的 fs 调用。
 *   三个条件：① 标识符是已知 fs 函数名 ② 后一个 token 是 '('（调用形态）
 *   ③ 同步/异步归类。拆自 judgeIoTokend（原函数圈复杂度 12，超阈值 10）。
 * @returns {{token: object, isSync: boolean}|null}
 */
function classifyIoCall(tokens, idx) {
  const t = tokens[idx];
  if (t.type !== 'ident') return null;
  const isSync = SYNC_FS_FNS.has(t.value);
  const isAsync = !isSync && ASYNC_FS_FNS.has(t.value);
  if (!isSync && !isAsync) return null;
  // 必须是调用形态：名字后紧跟 '('（允许 fs.promises.readFile 的点号形态）
  const next = tokens[idx + 1];
  if (!next || next.type !== 'punct' || next.value !== '(') return null;
  return { token: t, isSync };
}

/**
 * 判定单条 I/O token 的上下文与风险等级。
 *   从 scanIoRiskAst 抽出（原函数圈复杂度 27 / 嵌套 4，超阈值），
 *   使主循环只负责遍历与筛形，判定逻辑可独立测试。
 *
 * @param {object} ctx { tokens, lines, idx, asyncFns, loops, within, enclosingFnText }
 * @returns {object|null} 命中项；非 I/O 调用返回 null
 */
function judgeIoTokend(ctx) {
  const { tokens, lines, idx, asyncFns, loops, within, enclosingFnText } = ctx;
  const callKind = classifyIoCall(tokens, idx);
  if (!callKind) return null;
  const { token: t, isSync } = callKind;

  const line = t.line;
  const inAsync = within(asyncFns, line);
  const loopHit = enclosingLoop(loops, line);
  // 迭代器表达式内的 I/O 只执行一次（进入循环前），不算「循环内」：
  //   `for (const line of readFileSync(f).split('\n'))` —— readFileSync 在头部括号内。
  //   同行代码无法靠行号区分，故按 token 下标判定。
  const inLoopHead = Boolean(loopHit && loopHit[3] && idx > loopHit[3][0] && idx < loopHit[3][1]);
  const inLoop = Boolean(loopHit) && !inLoopHead;
  // 只遍历固定小字面量数组的循环：I/O 次数确定且极少，不按「逐次阻塞放大耗时」计
  const inSmallFixedLoop = Boolean(loopHit && loopHit[2]);
  const inRequest = detectRequestContext(lines, enclosingFnText(line));
  const inStartup = !inAsync && !inLoop && !inRequest;
  const type = isSync ? 'sync' : 'async';
  const kind = KIND_BY_FN[t.value] || 'read';

  const { risk, reason } = gradeRisk({ isSync, inAsync, inLoop, inSmallFixedLoop, inRequest, kind });
  return { line, call: t.value, via: '', type, kind, inAsync, inLoop, inRequest, inStartup, risk, reason };
}

/** 请求路径判定：所在函数体内出现 HTTP 特征即算（文本回溯，回溯上限见常量）。 */
function detectRequestContext(lines, fnRange) {
  if (!fnRange) return false;
  const from = Math.max(0, fnRange[0] - 1);
  const body = lines.slice(from, fnRange[1]).join('\n');
  return REQUEST_PATTERNS.some((re) => re.test(body));
}

/**
 * 四级判定：上下文 + 操作类别。
 *   基础档由上下文决定，写/删/改名再按「数据不可逆」加权一档。
 * @returns {{risk: string, reason: string}}
 */
function gradeRisk({ isSync, inAsync, inLoop, inSmallFixedLoop, inRequest, kind }) {
  let risk = 'safe';
  let reason = '异步 + 无循环 + 非关键路径';
  // 「会重复执行」= 循环内（逐次执行）或请求路径（每次请求执行一次）。
  //   只有这类上下文才存在「反复 + 不可逆」的叠加；异步路径的同步 I/O 本身已是最高档，
  //   且它的风险来自「阻塞事件循环」而非重复，不参与加权。
  const repeated = (inLoop && !inSmallFixedLoop) || inRequest;
  if (isSync && inAsync) { risk = 'high'; reason = '异步路径中的同步 I/O（阻塞事件循环）'; }
  else if (inLoop && inSmallFixedLoop) { risk = 'low'; reason = '固定小数组循环内的同步 I/O（次数确定且极少，开销可忽略）'; }
  else if (inLoop) { risk = 'high'; reason = '循环内的 I/O（逐次阻塞，放大耗时）'; }
  else if (inRequest) { risk = 'medium'; reason = '请求处理路径上的 I/O'; }
  else if (isSync) { risk = 'low'; reason = '启动路径上的同步 I/O（一次性初始化）'; }

  // 写/删/改名加权一档（数据不可逆）——**仅当该次 I/O 会重复执行时**。
  //   加权要表达的是「反复执行 + 不可逆」的叠加风险：循环内逐次写盘、请求路径并发写。
  //   启动路径的一次性落盘（含 `.tmp` + rename 的标准原子写）执行一次即结束，
  //   不存在重复放大；对它加权会把这套**正确做法**报成「中风险」，
  //   实测 25 条 atomic-json/account-status/scan-repos 等原子写全被误升档。
  if (repeated && (kind === 'write' || kind === 'delete' || kind === 'rename')) {
    const raised = raise(risk, 1);
    if (raised !== risk) { reason += `；${kind} 类操作加权`; risk = raised; }
  }
  return { risk, reason };
}

/**
 * 扫描源码里的文件 I/O，按上下文与操作类别给出四级风险。
 * @param {string} text 源码全文
 * @returns {Array<object>} 命中项数组（见文件头字段说明）
 */
export function scanIoRiskAst(text = '') {
  const src = String(text);
  const tokens = tokenize(src);
  const { asyncFns, allFns, loops } = collectRanges(tokens);
  const lines = src.split('\n');
  const out = [];

  const within = (ranges, line) => ranges.some(([s, e]) => line >= s && line <= e);
  /**
   * 取最近函数体范围（含区间嵌套时取最内层，用于请求路径特征匹配）。
   *   必须用 allFns（含同步函数/箭头函数/方法简写）—— 请求路径判定看的是
   *   「这段函数体里有没有 HTTP 特征」，与函数是否 async 无关。
   *   早先误用 asyncFns，导致同步 handler（`function h(req,res){ res.end() }`）
   *   识别不到请求上下文，其中的 I/O 被降格成「启动路径一次性」→ 低估风险。
   */
  const enclosingFnText = (line) => {
    let best = null;
    for (const [s, e] of allFns) if (line >= s && line <= e) best = [s, e];
    return best;
  };

  const ctx = { tokens, lines, asyncFns, loops, within, enclosingFnText };
  for (let i = 0; i < tokens.length; i++) {
    const hit = judgeIoTokend({ ...ctx, idx: i });
    if (!hit) continue;
    out.push(hit);
    i += 1;
  }
  return out;
}

/**
 * 统计 I/O 分布（供报表与审计摘要用）。
 * @param {Array} hits scanIoRiskAst 的结果
 * @returns {{total:number, sync:number, async:number, syncRatio:number, byRisk:object, byKind:object, byFile:Array}}
 */
export function summarizeIoRisk(hits = []) {
  const list = Array.isArray(hits) ? hits : [];
  const sync = list.filter((h) => h.type === 'sync').length;
  const byRisk = { high: 0, medium: 0, low: 0, safe: 0 };
  const byKind = { read: 0, write: 0, delete: 0, rename: 0 };
  const fileMap = new Map();
  for (const hit of list) {
    byRisk[hit.risk] = (byRisk[hit.risk] || 0) + 1;
    byKind[hit.kind] = (byKind[hit.kind] || 0) + 1;
    if (hit.file) fileMap.set(hit.file, (fileMap.get(hit.file) || 0) + 1);
  }
  const byFile = [...fileMap.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
  return {
    total: list.length,
    sync,
    async: list.length - sync,
    syncRatio: list.length ? sync / list.length : 0,
    byRisk, byKind, byFile,
  };
}

/**
 * 生成改造优先级清单：按风险级别排序（同级内写/删优先、同步优先）。
 * @param {Array} hits 每条需带 file 字段
 * @returns {Array} 排序后的清单（含 rank 序号）
 */
export function rankIoFixList(hits = []) {
  const list = Array.isArray(hits) ? hits : [];
  const sorted = [...list].sort(compareFixPriority);
  return sorted.map((hit, idx) => ({ ...hit, rank: idx + 1 }));
}

/**
 * 改造优先级排序：风险 > 写类 > 同步 > 文件 > 行号。
 *   从 rankIoFixList 的比较器抽出（原为内联多级比较，变量名过短且难读）。
 * @returns {number} 负数 = a 优先
 */
function compareFixPriority(a, b) {
  const byRisk = LEVELS.indexOf(b.risk) - LEVELS.indexOf(a.risk);
  if (byRisk) return byRisk;
  const byKind = isWriteLike(b.kind) - isWriteLike(a.kind);
  if (byKind) return byKind;
  const byType = isSync(b.type) - isSync(a.type);
  if (byType) return byType;
  const byFile = String(a.file || '').localeCompare(String(b.file || ''));
  if (byFile) return byFile;
  return (a.line || 0) - (b.line || 0);
}

/** 写/删/改名优先于读（数据不可逆，改造收益更高）。 */
function isWriteLike(kind) {
  return kind === 'read' ? 0 : 1;
}

/** 同步调用优先于异步（阻塞事件循环，收益直接）。 */
function isSync(type) {
  return type === 'sync' ? 1 : 0;
}
