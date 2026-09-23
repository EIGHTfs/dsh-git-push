/**
 * AST 实现层 · 控制流检查
 *
 * 职责：同步 fs 调用、空 catch、圈复杂度、嵌套深度（token 级判定）。
 *   token 化保证注释里的示例代码不被计入。
 */

import { tokenize } from './tokenizer.js';
import { matchBrace, collectInnerFnRanges, isBlockParen, matchingOpen } from './brace.js';

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
function collectNamedSyncFs(tokens) {
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

/** 第 2 段：定位所有 async 函数体边界（async function / async X( / async (），返回 [起行, 止行, 开括号idx, 闭括号idx]。 */
function collectAsyncRanges(tokens) {
  const asyncRanges = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ident' && t.value === 'async') {
      // 向后找函数体 '{'（跳过函数名/参数，限 20 token）
      for (let j = i + 1; j < Math.min(tokens.length, i + 20); j++) {
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

/** 第 3 段：找同步 fs 调用（named 直调或 fs.XSync( 前缀），落在 async 函数体内即报。 */
function scanSyncCalls(tokens, namedSync, asyncRanges) {
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
export function checkEmptyCatchAst(text = '') {
  const tokens = tokenize(text);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'catch') continue;
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
        // 2026-09-13 修：注释「交代了原因」即算已说明——不再只看说明词表。
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
  const branch = new Set(['if', 'for', 'while', 'case', 'catch', 'do']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'function') continue;
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 20); j++) {
      if (tokens[j].type === 'punct' && tokens[j].value === '{') { openIdx = j; break; }
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    // 2026-09-13 修：嵌套函数的复杂度**不得累加到外层**（旧实现整段计入，导致
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
      //   不产生独立执行路径（2026-09-13 修：多字符 token 化后 `?.` 是独立 token，
      //   不再被误认成三元 `?`）。
      if (tk.type === 'punct' && ['&&', '||', '??', '?'].includes(tk.value)) cx++;
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
 * 2026-09-13 修 bug：旧实现把所有 `{` 都计入深度，**对象字面量/解构/JSON 结构**
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
export function checkNestingDepthAst(text = '', { warn = 4, block = 6 } = {}) {
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
