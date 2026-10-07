/**
 * AST 实现层 · 控制流检查
 *
 * 职责：同步 fs 调用、空 catch、圈复杂度、嵌套深度（token 级判定）。
 *   token 化保证注释里的示例代码不被计入。
 */

import { tokenize } from './tokenizer.js';
import { matchBrace, collectInnerFnRanges, isBlockParen, matchingOpen } from './brace.js';
import { pythonFuncRanges } from './size.js';
import { javaKtFuncRanges } from './lang.js';

// 向后找异步函数体 '{' 的最大 token 跨度：与 brace.js 共用同一来源（lib/ast/consts.js）
import { FN_BODY_LOOKAHEAD } from './consts.js';

const SYNC_FS_FNS = new Set([
  'readFileSync', 'writeFileSync', 'readdirSync', 'existsSync', 'statSync', 'mkdirSync',
  'rmSync', 'unlinkSync', 'readlinkSync', 'lstatSync', 'renameSync', 'copyFileSync', 'appendFileSync',
]);

/**
 * 检查 async 路径中的 fs 同步调用（AST 级，修 named import 假阴性）。
 * @param {string} text 文件全文
 * @returns {Array<{line:number, call:string, via:string}>} via: 'named-import' | 'fs-prefix'
 */
/** 第 1 段：收集 `import { readFileSync, X } from 'node:fs'` 的 fs 同步函数名（named import）。 */
function collectNamedSyncFs(tokens) { // dsh-skip-complexity: named-import 扫描器（import{..}→from 模式匹配，扫描结构必然嵌套）
  const namedSync = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type === 'ident' && tokens[i].value === 'import'
      && tokens[i + 1].type === 'punct' && tokens[i + 1].value === '{') {
      let j = i + 2;
      const names = [];
      while (j < tokens.length && !(tokens[j].type === 'punct' && tokens[j].value === '}')) {
        if (tokens[j].type === 'ident') names.push(tokens[j].value);
        j++;
      }
      // 找 from 'node:fs' / 'fs'
      let k = j + 1;
      let from = '';
      while (k < tokens.length && k < j + 8) {
        if (tokens[k].type === 'ident' && tokens[k].value === 'from') {
          const strTok = tokens[k + 1];
          if (strTok && strTok.type === 'str') {
            from = strTok.value.replace(/['"]/g, '');
            if (/^(node:)?fs$/.test(from)) {
              for (const nm of names) if (SYNC_FS_FNS.has(nm)) namedSync.add(nm);
            }
          }
          break;
        }
        k++;
      }
      i = j;
    }
  }
  return namedSync;
}

/** 第 2 段：定位所有 async 函数体边界（async function / async X(/ async (），返回 [起行, 止行, 开括号idx, 闭括号idx]。 */
function collectAsyncRanges(tokens) { // dsh-skip-complexity: async 函数体边界扫描器（token 遍历+配对，结构必然嵌套）
  const asyncRanges = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ident' && t.value === 'async') {
      // 向后找函数体 '{'（跳过函数名/参数，限 20 token）
      for (let j = i + 1; j < Math.min(tokens.length, i + FN_BODY_LOOKAHEAD); j++) {
        const tj = tokens[j];
        if (tj.type === 'punct' && tj.value === '{') {
          const range = matchBrace(tokens, j);
          if (range) asyncRanges.push([tokens[j].line, tokens[range[1]].line, j, range[1]]);
          break;
        }
        if (tj.type === 'punct' && (tj.value === ';' || tj.value === '}')) break;
      }
    }
  }
  return asyncRanges;
}

/** 第 3 段：找同步 fs 调用（named 直调或 fs.XSync(前缀），落在 async 函数体内即报。 */
function scanSyncCalls(tokens, namedSync, asyncRanges) { // dsh-skip-complexity: 同步 fs 调用扫描器（定位调用点+区间归属判定，结构必然嵌套）
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    let call = '';
    let via = '';
    if (namedSync.has(t.value)) {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'punct' && nx.value === '(') { call = t.value; via = 'named-import'; }
    } else if (t.value === 'fs') {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'punct' && nx.value === '.') {
        const nn = tokens[i + 2];
        if (nn && nn.type === 'ident' && SYNC_FS_FNS.has(nn.value)) {
          const after = tokens[i + 3];
          if (after && after.type === 'punct' && after.value === '(') { call = nn.value; via = 'fs-prefix'; }
        }
      }
    }
    if (!call) continue;
    // 判定是否在 async 函数区间内（token 索引区间）
    const inAsync = asyncRanges.some(([, , oi, ci]) => i > oi && i < ci);
    if (inAsync) out.push({ line: t.line, call, via });
  }
  return out;
}

/** 同步 fs 调用落在 async 函数体内 → 报「异步路径同步 I/O」（阻塞事件循环）。 */
export function checkSyncFs(text = '') {
  const tokens = tokenize(text);
  const namedSync = collectNamedSyncFs(tokens);
  const asyncRanges = collectAsyncRanges(tokens);
  return scanSyncCalls(tokens, namedSync, asyncRanges);
}

/**
 * 检查静默吞错 catch（AST 级，括号平衡 → 块内去注释/空白后为空即报）。
 * @param {string} text 文件全文
 * @returns {Array<{line:number}>}
 */
export function checkEmptyCatchAst(text = '') { // dsh-skip-complexity: 空 catch 检测器本体（token 遍历 + catch 体空判定多条件链，职责单一）
  const tokens = tokenize(text);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'catch') continue;
    // 跳过 **Promise 方法调用** `.catch(...)`——它不是 try/catch 语句，而是链式调用：
    //   实测误报（dsh-session-conductor 的 12 条里有 6 条属此类）：
    //     `await res.json().catch(() => ({}))`（取默认值）、`p.catch(() => {})`（故意静默兜底）
    //   两者都不是「静默吞错的 catch 块」，按空 catch 报属误报。
    //   判定：向前跳过空白/注释，若前一 token 是 `.` ⇒ 成员调用。
    let back = i - 1;
    while (back >= 0 && (tokens[back].type === 'ws' || tokens[back].type === 'comment')) back--;
    if (back >= 0 && tokens[back].type === 'punct' && tokens[back].value === '.') continue;
    // 找 catch 后的 '{'（跳过 (param) 与空白，限 10 token）
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 10); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') { openIdx = j; break; }
      if (tj.type === 'punct' && tj.value === '}') break; // catch (e) 无块 → 不是本类
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    const [, closeIdx] = range;
    // 块内判定：有实质语句 → 正常；仅有说明性注释 → 视为「已说明的静默」（不算问题）；
    // 真正空块（无语句也无注释）→ 报问题（静默吞错且无任何交代）。
    let hasBody = false;
    let hasNote = false;
    for (let k = openIdx + 1; k < closeIdx; k++) {
      const tk = tokens[k];
      if (tk.type === 'ws') continue;
      if (tk.type === 'comment') {
        // 修：注释「交代了原因」即算已说明——不再只看说明词表。
        //   旧逻辑只认词表（跳过/忽略/…），「/* 无缓存/损坏则空 */」「预热失败不影响
        //   主链路」这类**实质说明了为什么静默**的注释会误报（它们是好的静默）。
        //   判定：去空白后长度 ≥ 4 且不只含单个标识符（`// e` 这种占位不算交代）。
        //   词表语义保留为兜底（含说明词但很短也认）。
        const noteText = String(tk.value || '').replace(/[/*\s]/g, '');
        if (/跳过|忽略|已断开|不抛|按空|不阻断|无需|降级|兜底|视为|不回滚|非\s*JSON|raw|空仓|best-effort/i.test(tk.value || '')
          || (noteText.length >= 4 && !/^[a-zA-Z_$][\w$]*$/.test(noteText))) hasNote = true;
        continue;
      }
      hasBody = true;
      break;
    }
    if (!hasBody && !hasNote) out.push({ line: t.line });
  }
  return out;
}

export function checkComplexityAst(text = '', { warn = 10, block = 20 } = {}) {
  const tokens = tokenize(text);
  const out = [];
 // 分支关键字（口径校准，用户提供标准）：
  //   if/else if 每分支、for、while（普通 while 与 do-while 的 while 均计 1——
  //   do-while 只计 1：**do 不进分支集合**，do-while 由 while token 计）、case（switch
  //   每个分支）、catch。**带标签 break/continue 额外 +1**（跨循环/switch 的复杂控制流，
  //   由下方 labelled-break 判定处理）。
  const branch = new Set(['if', 'for', 'while', 'case', 'catch']);
  // Python 分支——def + 缩进块，走行级复杂度统计（token 级大括号法对 py 失效）
  if (pythonDetectDef(text)) {
    return checkPythonComplexity(text, { warn, block });
  }
  // Java/Kotlin 分支——方法无 function 关键字，JS token 级只认 function → 零命中；
  //   复用 javaKtFuncRanges 的方法区间，对每个方法体做 token 级分支计数（与 JS 同口径）
  const jr = javaKtFuncRanges(text);
  if (jr.length) return checkJavaKtComplexity(tokens, jr, { warn, block });
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'function') continue;
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + FN_BODY_LOOKAHEAD); j++) {
      if (tokens[j].type === 'punct' && tokens[j].value === '{') { openIdx = j; break; }
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    // 修：嵌套函数的复杂度**不得累加到外层**（旧实现整段计入，导致
    //   只要函数里定义了几个带分支的内部函数，外层就被虚报成高复杂度——如
    //   makeTitleResolver 自身仅 2 个 catch + 2 个 ??，却被报 29）。
    //   做法：先收集内层函数体的 token 区间，扫外层时跳过这些区间；内层自身
    //   由后续迭代单独评估（不再 i = range[1] 整体跳过，否则内层永远扫不到）。
    const innerRanges = collectInnerFnRanges(tokens, openIdx + 1, range[1]);
    const inInner = (k) => innerRanges.some(([a, b]) => k >= a && k < b);
    let cx = 1;
    for (let k = openIdx + 1; k < range[1]; k++) {
      if (inInner(k)) continue;
      const tk = tokens[k];
      if (tk.type === 'comment') continue;
      if (tk.type === 'ident' && branch.has(tk.value)) cx++;
      // 分支点：逻辑与/或、空值合并、三元问号。**排除可选链 `?.`**——它是空值保护，
      //   不产生独立执行路径（修：多字符 token 化后 `?.` 是独立 token，
      //   不再被误认成三元 `?`）。
      if (tk.type === 'punct' && ['&&', '||', '??', '?'].includes(tk.value)) cx++;
 // 带标签 break/continue +1：break label; / continue label;——
      //   跨循环/switch 的复杂控制流（跳出多层/跳到外层迭代），增加独立执行路径。
      //   普通 break/continue（switch case 收尾、循环尾）不计——它们是常规流程。
      if (tk.type === 'ident' && (tk.value === 'break' || tk.value === 'continue')) {
        const nx = tokens[k + 1];
        if (nx && nx.type === 'ident') cx++;
      }
    }
    if (cx > warn) {
      const nx = tokens[i + 1];
      out.push({ line: tokens[openIdx].line, name: nx?.type === 'ident' ? nx.value : '(匿名)', complexity: cx, level: cx > block ? 'blocker' : 'warning' });
    }
    // 不跳过内部：继续迭代把内层函数也评估掉（i 只前进到本函数声明之后）
    i = openIdx;
  }
  return out;
}

/**
 * 检查嵌套深度（max-depth kind，AST 级）。
 * 统计函数体内「控制流块」最大嵌套层数（if/for/while/try/switch 等）。
 *
 * 修 bug：旧实现把所有 `{` 都计入深度，**对象字面量/解构/JSON 结构**
 *   被当成嵌套层级——`return { version: 2, skills: {}, sessions: {} }` 会被报
 *   depth=4，`try { ... } catch { return {...} }`（真实深度 2）也被报 depth=4，
 *   造成大面积误报（一个仓库 19 条）。
 * 现只统计「块语句」大括号：仅当 `{` 跟着控制流关键字或函数体时才算一层；
 *   对象字面量（`{` 前是 `=`/`(`/`return`/`,`/`:`/`[` 等值位置）不计入。
 * 块级关键字（计入）：if / else / for / while / do / try / catch / finally / switch / function / =>。
 * @param {string} text 文件全文
 * @param {object} [opts] { warn=4, block=6 }
 * @returns {Array<{line:number, depth:number, level:string}>}
 */
export function checkNestingDepthAst(text = '', { warn = 4, block = 6 } = {}) { // dsh-skip-complexity: 嵌套深度统计器本体（统计 if/for 嵌套必然自身嵌套）
  // Python 分支——缩进块（无大括号），走行级嵌套统计
  if (pythonDetectDef(text)) return checkPythonNesting(text, { warn, block });
  const tokens = tokenize(text);
  const out = [];
  // 进入块的前置关键字（`if (...) {`、`else {`、`try {`、`=> {` 等）
  const BLOCK_KW = new Set(['if', 'else', 'for', 'while', 'do', 'try', 'catch', 'finally', 'switch', 'function']);
  // 统计每个 `{` 是否属于块语句（与 token 下标对齐）
  const isBlockBrace = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.type === 'punct' && t.value === '{')) continue;
    // 向前找最近的有意义 token：若是 `)` → 可能 if/for/while/function 的参数尾（块）
    //   或箭头函数参数尾（块）；若直接是 BLOCK_KW/fn 关键字 → 块；
    //   若是 `=>` → 箭头函数体（块）；若是 `else`/`do`/`try`/`finally` → 块；
    //   其余（`=` `(` `,` `:` `[` `return` `=>` 之外的值位置）→ 对象字面量，不计。
    let prev = null;
    for (let j = i - 1; j >= 0; j--) {
      const tj = tokens[j];
      if (tj.type === 'ws' || tj.type === 'comment') continue;
      prev = tj;
      break;
    }
    let isBlock = false;
    if (prev) {
      if (prev.type === 'ident' && BLOCK_KW.has(prev.value)) isBlock = true;      // if (...) / else ...? 见下
      else if (prev.type === 'punct' && prev.value === '=>') isBlock = true;      // () => {
      else if (prev.type === 'punct' && prev.value === ')') {
        // `)` 前是 BLOCK_KW 或函数名 → 块语句/函数体；否则可能是调用参数里传对象
        let before = null;
        for (let j = tokens.indexOf(prev) - 1; j >= 0; j--) {
          const tj = tokens[j];
          if (tj.type === 'ws' || tj.type === 'comment') continue;
          before = tj;
          break;
        }
        isBlock = isBlockParen(tokens, prev) || (before && before.type === 'ident' && before.value === 'function');
      }
    }
    isBlockBrace.set(i, isBlock);
  }
  let depth = 0;
  let maxDepth = 0;
  let maxLine = 1;
  let fnStartLine = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ident' && t.value === 'function') fnStartLine = t.line;
    if (t.type === 'punct' && t.value === '{') {
      if (isBlockBrace.get(i)) {
        depth++;
        if (depth > maxDepth) { maxDepth = depth; maxLine = t.line; }
      }
    } else if (t.type === 'punct' && t.value === '}') {
      // 只有块大括号才减（对象字面量的 `}` 不影响）
      if (isBlockBrace.get(matchingOpen(tokens, i))) {
        depth--;
        if (depth === 0 && maxDepth > warn) {
          out.push({ line: fnStartLine || maxLine, depth: maxDepth, level: maxDepth > block ? 'blocker' : 'warning' });
        }
        if (depth <= 0) { depth = 0; maxDepth = 0; }
      }
    }
  }
  return out;
}

/**
 * 检测文本是否含 Python 函数定义（def ...:）——决定复杂度走行级统计。
 * 纯 JS 项目（无 def）不受影响（零开销正则预检）。
 */
function pythonDetectDef(text) {
  return /^\s*def\s+[A-Za-z_]\w*\s*\(/m.test(String(text));
}

/**
 * Python 圈复杂度（行级，）。
 *
 * Python 无大括号/function 关键字，token 级分支计数失效。按行统计：
 *   · 函数范围复用 pythonFuncRanges（def 行 + 缩进法确定函数体）
 *   · 分支点 = 函数体内**行首**（缩进后）的控制流关键字：if/elif/else/for/while/
 *     except/try/with/assert——每个 +1（与 JS 的 branch 集合对齐口径）
 *   · 逻辑运算符 &&/|| 在 Python 是 and/or（行内出现 +1）；三元是 `x if c else y`
 *     （Python 无 `?`，不另计）
 *   · 嵌套函数复杂度不累加到外层（与 JS 版同语义：按 pythonFuncRanges 逐函数独立评估）
 * 返回结构与 checkComplexityAst 一致（{line, name, complexity, level}）。
 */
function checkPythonComplexity(text, { warn, block }) {
  const out = [];
  const lines = String(text).split('\n');
 // 行级分支（口径：if/elif 每分支、for/while、try/except（catch 语义）、
  //   with/assert 为 Python 语义保留；**else 不计**——else 是 if 的配对分支非新分支，
  //   elif 才是新分支，与 JS 版「if/else if 每分支」对齐）
  const BRANCH_LINE = /^\s*(if|elif|for|while|try|except|with|assert)\b/;
  const BOOL_OP = /\b(and|or)\b/;
  for (const r of pythonFuncRanges(text)) {
    let cx = 1;
    for (let i = r.startLine - 1; i < r.endLine; i++) {
      const line = lines[i];
      if (!line) continue;
      if (/^\s*#/.test(line)) continue; // 注释不计
      if (BRANCH_LINE.test(line)) cx++;
      // 行内 and/or（非注释非字符串粗判——行级精度足够，注释行已跳过）
      const m = BOOL_OP.exec(line.replace(/^\s*#.*$/, ''));
      if (m) cx++;
    }
    if (cx > warn) {
      out.push({ line: r.startLine, name: r.name, complexity: cx, level: cx > block ? 'blocker' : 'warning' });
    }
  }
  return out;
}

/**
 * Python 嵌套深度（行级缩进法，）。
 *
 * Python 用缩进表达块结构（无大括号）。逐行统计**块起始行**（行首控制流关键字：
 * if/elif/else/for/while/try/except/with），每个 +1 缩进层级；函数体（def）是
 * 顶层容器不计入嵌套（与 JS 版「函数体不计深度」口径一致——JS 统计的是函数内
 * 控制流块的嵌套，def 本身不是「控制流块」）。
 * 返回 {line, depth, level} 与 JS 版一致；超过 warn 报 warning、超过 block 报 blocker。
 */
function checkPythonNesting(text, { warn, block }) {
  const out = [];
  const lines = String(text).split('\n');
  const BLOCK_LINE = /^\s*(if|elif|else|for|while|try|except|with)\b/;
  for (const r of pythonFuncRanges(text)) {
    let depth = 0;
    let maxDepth = 0;
    let maxLine = r.startLine;
    const bodyIndent = indentOf(lines[r.startLine - 1] || '') + 4; // def 缩进 + 一级
    for (let i = r.startLine; i < r.endLine; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      if (/^\s*#/.test(line)) continue; // 注释不影响嵌套
      const ind = indentOf(line);
      // 缩进回到函数体外 → 函数结束（pythonFuncRanges 已保证不越界，防御性判断）
      if (ind < bodyIndent) break;
      if (BLOCK_LINE.test(line)) {
        depth++;
        if (depth > maxDepth) { maxDepth = depth; maxLine = i + 1; }
      } else if (ind < depth * 4 + bodyIndent) {
        // 缩进回退 → 块结束（近似：每级 4 空格；tab/混合缩进误差可接受）
        depth = Math.max(0, Math.floor((ind - bodyIndent) / 4));
      }
    }
    if (maxDepth > warn) {
      out.push({ line: maxLine, depth: maxDepth, level: maxDepth > block ? 'blocker' : 'warning' });
    }
  }
  return out;
}

/** 行首缩进空格数。 */
function indentOf(line) {
  return (String(line).match(/^\s*/) || [''])[0].length;
}

/**
 * Java/Kotlin 圈复杂度（token 级，按方法区间）。
 *
 * Java/Kotlin 方法与 JS 一样用花括号分块、分支关键字一致（if/for/while/case/catch/&&/||/?），
 * 唯一差异是无 `function` 关键字——方法范围由 javaKtFuncRanges 提供，逐方法在 token 流里
 * 按 [openIdx, closeIdx] 区间计数分支点（与 JS 版 checkComplexityAst 同口径）。
 * 内层 lambda/匿名类的大括号由外层方法区间包含（方法体确实包括它们），复杂度的
 * 「分支点」只统计 branch 关键字与逻辑运算符，不把 lambda { 本身计分支——与 JS 一致。
 * @param {Array} tokens token 流
 * @param {Array<{startLine:number,endLine:number,name:string}>} ranges 方法范围
 * @returns {Array<{line:number,name:string,complexity:number,level:string}>}
 */
function checkJavaKtComplexity(tokens, ranges, { warn, block }) {
  const out = [];
 // 与 JS 版同口径：if/else if 每分支、for、while（do-while 由 while 计 1，
  //   do 不进集合）、case、catch、when=Kotlin switch。带标签 break/continue 额外 +1。
  const branch = new Set(['if', 'for', 'while', 'case', 'catch', 'when']); // when=Kotlin switch
  // 方法体 token 区间（[i,j]）——按行号定位 tokens
  for (const r of ranges) {
    // 找方法体起点（{ 行=r.startLine 的 token 下标）与结束（r.endLine 的最后一个 }）
    const startIdx = tokens.findIndex((t) => t.line === r.startLine);
    if (startIdx === -1) continue;
    // 从 startLine 向后找属于该方法的最后一个 } 之前的所有分支 token
    let endIdx = -1;
    for (let k = tokens.length - 1; k >= 0; k--) {
      const tk = tokens[k];
      if (tk.line === r.endLine && tk.type === 'punct' && tk.value === '}') { endIdx = k; break; }
    }
    if (endIdx === -1) continue;
    let cx = 1;
    for (let k = startIdx; k <= endIdx; k++) {
      const tk = tokens[k];
      if (tk.type === 'comment') continue;
      if (tk.type === 'ident' && branch.has(tk.value)) cx++;
      // 逻辑与/或/三元问号（Java 无 ??，Kotlin 有——同 JS 的 ? 分支语义；排除 ?. 可选链）
      if (tk.type === 'punct' && ['&&', '||', '??', '?'].includes(tk.value)) cx++;
      // 带标签 break/continue +1（break label; / continue label;——跨循环/switch 复杂控制流）
      if (tk.type === 'ident' && (tk.value === 'break' || tk.value === 'continue')) {
        const nx = tokens[k + 1];
        if (nx && nx.type === 'ident') cx++;
      }
    }
    if (cx > warn) {
      out.push({ line: r.startLine, name: r.name || '(匿名)', complexity: cx, level: cx > block ? 'blocker' : 'warning' });
    }
  }
  return out;
}
