/**
 * AST 实现层 · 数据流检查（三层审计 L2）
 *
 * 职责：同函数内的「清空后访问」数据流判定——变量/对象先被清空
 *   （clear()/reset()/splice(0)/length=0/=[]/=null/delete），之后在同一
 *   函数体内又被读取/访问（.get()/.at()/[下标] 等），构成「读已清空对象」
 *   风险（拿到 undefined / 空值）。
 *
 * 为什么是 L2（AST+YAML）而不是 L1（正则）：
 *   L1 正则只能筛「文件里同时出现过清空词和访问词」，无法区分两者是否
 *   在同一函数内、是否先后有序。L2 用 token 级函数区间（collectInnerFnRanges）
 *   精确到「同一函数体、清空行 < 访问行」才算命中。
 *
 * 为什么够不到 L3（运行时）：
 *   闭包捕获、跨模块引用、异步回调里的真实时序（清空在 setTimeout 后执行、
 *   访问在 Promise resolve 时）静态无法确定——那是 scripts/audit-runtime-check.mjs
 *   的职责，本模块只在静态可判定时给结论。
 *
 * 判定保守（宁漏不误报）：
 *   ① 只统计同一函数体区间内的动作（顶层/function/方法/箭头函数体）；
 *   ② 清空与访问必须命中**同一个对象名**（ident 相同）；
 *   ③ 访问行必须在清空行**之后**（行号单调）；
 *   ④ **写回撤销**：清空后被重新填充（push/set/add/重新赋值）→ 撤销清空标记，
 *      其后访问不算命中（对象已被重新填充，不是「读已清空对象」）。
 */

import { tokenize } from './tokenizer.js';
import { matchBrace } from './brace.js';

/** 清空动作：方法调用（对象.clear() / .reset() / .flush() / .purge()）。
 *  **刻意不含 empty**：empty() 在各语言都是**查询**（Python Queue.empty() / C++ vector.empty()
 *  返回 bool，JS 库的 isEmpty 同义），把它当清空会制造系统性误报——
 *  实测真实语料：`while not q.empty():` 之后的 `q.get()` 被误报成"清空后访问"。
 *  **刻意不含 reset**（2026-11-06 实测追加）：业务代码里 reset() 绝大多数是
 *  「**恢复默认值/重置状态**」而不是「清空容器」——被重置后对象**仍有内容**，之后读取完全安全。
 *  实测证据：某配置类 `reset() -> bool`，测试断言 `cfg.reset()` 后 `cfg.get("general.theme") == "dark"`
 *  （有效值，不是空）；同语料 13 条命中里 **12 条**都源于把 reset() 当清空。
 *  真正的容器清空在各语言里用 clear()（本表保留）。若某库确把 reset() 用作清空，宁可漏报。 */
const CLEAR_METHODS = new Set(['clear', 'flush', 'purge']);
/** 访问动作：方法读——清空后调用会拿 undefined（.get() / .at(0) / .first() / .peek()）。
 *   shift/pop 是「消费式访问」，常见于 `while (len) { shift() }` 保护模式，不报（宁漏不误报）。 */
const ACCESS_METHODS = new Set(['get', 'at', 'first', 'last', 'peek', 'head']);
/** 写回动作：清空后重新填充（push/add/set/append/unshift/assign）→ 撤销清空标记。 */
const WRITE_METHODS = new Set(['push', 'add', 'set', 'append', 'unshift', 'assign', 'insert']);

/**
 * 收集文本里所有「函数体 token 区间」——function 声明 + 方法 + 箭头函数，
 *   以及**排除函数体后**的顶层作用域孤岛区间。
 *
 * 互斥性（修复跨函数误连）：
 *   旧实现把顶层作用域 = 整个文件区间，导致「模块级清空（顶层 `resultsByIndex =
 *   new Map()` 重置）→ 另一函数里的访问」被误判为同函数。正确做法是：
 *   顶层只保留**不属于任何函数体**的 token 段（变量声明/模块级语句），
 *   与各函数体区间互斥，各自独立扫描——清空动作和访问动作必须落在同一区间。
 *
 * @param {Array} tokens token 流
 * @returns {Array<[number, number]>} [startIdx, endIdx]（含大括号，闭区间；互斥不重叠）
 */
/** 段①：函数声明/表达式体（function f() {...} / const f = function() {...}）。 */
function collectDeclaredFnBodies(tokens) {
  const fnRanges = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.type === 'ident' && t.value === 'function')) continue;
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 24); j++) {
      if (tokens[j].type === 'punct' && tokens[j].value === '{') { openIdx = j; break; }
    }
    if (openIdx === -1) continue;
    const r = matchBrace(tokens, openIdx);
    if (r) fnRanges.push(r);
  }
  return fnRanges;
}

/** 段②：箭头函数体（() => {...}）与方法简写（method() {...}）。 */
function collectArrowMethodBodies(tokens) {
  const fnRanges = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (t.type === 'punct' && t.value === '=>' && tokens[i + 1]?.type === 'punct' && tokens[i + 1]?.value === '{') {
      const r = matchBrace(tokens, i + 1);
      if (r) fnRanges.push(r);
    }
    if (t.type === 'punct' && t.value === ')' && tokens[i + 1]?.type === 'punct' && tokens[i + 1]?.value === '{') {
      let prev = null;
      for (let j = i - 1; j >= 0; j--) {
        if (tokens[j].type === 'ws' || tokens[j].type === 'comment') continue;
        prev = tokens[j];
        break;
      }
      if (prev && prev.type === 'ident') {
        const r = matchBrace(tokens, i + 1);
        if (r) fnRanges.push(r);
      }
    }
  }
  return fnRanges;
}

/**
 * 段③·前：Python 缩进式函数体区间（`def f():` / `async def f():`）。
 *
 * 为什么必须单独一段：前面两段都只认 **JS 风格**——`function` 关键字与 `) {`。
 *   Python 用 `def` + 缩进，两者都不命中，于是 `fnRanges` 为空，
 *   `mergeFnRanges` 的第 3 步退化成「整个文件一个区间」⇒ 同文件内**任意位置**的
 *   清空与访问都会被配成一对（实测：clear 在 invalidate()、访问在 build_index()，
 *   相距 177 行仍被报）。这是结构性失真，不能靠调判据修补。
 *
 * 块范围判据（与 Python 语法一致）：从 `def` 行起，向下直到首个
 *   **非空、非注释且缩进 ≤ def 缩进** 的行（该行已属同级/外层，不属于本函数体）。
 *   嵌套 def 会被各自识别并**独立成体**（不做父子合并，数据流不跨函数体）。
 * @param {string} text 源文本
 * @param {Array} tokens token 流（用于把行号换算成 token 下标，并确认 `def` 是真标识符）
 * @returns {Array<[number, number]>} token 下标闭区间
 */
function collectPythonDefBodies(text, tokens) {
  const src = String(text || '');
  if (!/^[ \t]*(async[ \t]+)?def[ \t]+\w+[ \t]*\(/m.test(src)) return [];
  const lines = src.split('\n');
  // tab 按 4 空格折算（与常见 Python 风格一致；混用缩进本身是语法错误，不深究）
  const indentOf = (s) => {
    const m = s.match(/^[ \t]*/);
    return m ? m[0].replace(/\t/g, '    ').length : 0;
  };
  const isBlankOrComment = (s) => !s.trim() || /^\s*#/.test(s);
  // 行号(1-based) → 该行首个/末个有效 token 下标
  const firstTokOfLine = new Map();
  const lastTokOfLine = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.type === 'ws' || tk.type === 'comment') continue;
    const ln = Number(tk.line) || 0;
    if (!ln) continue;
    if (!firstTokOfLine.has(ln)) firstTokOfLine.set(ln, i);
    lastTokOfLine.set(ln, i);
  }
  const ranges = [];
  for (let li = 0; li < lines.length; li++) {
    const m = lines[li].match(/^([ \t]*)(?:async[ \t]+)?def[ \t]+\w+[ \t]*\(/);
    if (!m) continue;
    const lineNo = li + 1;
    // 必须确认该行的 def 是**真 token**（避免三引号字符串/注释里的 "def "）
    const firstIdx = firstTokOfLine.get(lineNo);
    const firstTok = firstIdx === undefined ? null : tokens[firstIdx];
    const looksLikeDef = firstTok && (firstTok.value === 'def' || firstTok.value === 'async');
    const lineHasDefTok = looksLikeDef || [...(firstTokOfLine.keys())].length === 0;
    if (!lineHasDefTok) continue;
    const base = indentOf(lines[li]);
    let endLine = lineNo;
    for (let lj = li + 1; lj < lines.length; lj++) {
      const cur = lines[lj];
      if (isBlankOrComment(cur)) continue;            // 空行/注释不结束块
      if (indentOf(cur) <= base) break;               // 回到同级/外层 ⇒ 块结束
      endLine = lj + 1;
    }
    const startTok = firstTokOfLine.get(lineNo);
    const endTok = lastTokOfLine.get(endLine);
    if (startTok === undefined || endTok === undefined || endTok < startTok) continue;
    ranges.push([startTok, endTok]);
  }
  return ranges;
}

/** 段③：排序去重叠（嵌套只留最外层）+ 补顶层作用域孤岛（函数外 token 段）。 */
function mergeFnRanges(fnRanges, tokens) {
  fnRanges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of fnRanges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) { last[1] = Math.max(last[1], r[1]); continue; } // 重叠/嵌套 → 合并
    merged.push([r[0], r[1]]);
  }
  const bodies = [...merged];
  // 顶层孤岛 = [0, lastCode] 减去所有函数体区间
  let lastCode = tokens.length - 1;
  while (lastCode >= 0 && (tokens[lastCode].type === 'comment' || tokens[lastCode].type === 'ws')) lastCode--;
  if (lastCode >= 0) {
    let cursor = 0;
    for (const [fs, fe] of merged) {
      if (fs > cursor) bodies.push([cursor, fs - 1]); // 函数前的顶层段
      cursor = Math.max(cursor, fe + 1);
    }
    if (cursor <= lastCode) bodies.push([cursor, lastCode]); // 函数后的顶层段
  }
  return bodies;
}

/**
 * 收集全部函数体区间（声明/表达式/箭头/方法 + Python def 缩进体 + 顶层孤岛）。
 * @param {Array} tokens token 流
 * @param {string} [text] 源文本（Python 缩进体解析必需；缺省则退化为仅花括号语言）
 */
function collectFnBodies(tokens, text = '') {
  const fnRanges = [
    ...collectDeclaredFnBodies(tokens),
    ...collectArrowMethodBodies(tokens),
    ...collectPythonDefBodies(text, tokens),
  ];
  return mergeFnRanges(fnRanges, tokens);
}

/** 从 i 向前跳过空白/注释，取最近一个有效 token。 */
function prevNonWs(tokens, i) {
  for (let j = i - 1; j >= 0; j--) {
    if (tokens[j].type === 'ws' || tokens[j].type === 'comment') continue;
    return tokens[j];
  }
  return null;
}

/** 从 i 向后（含 i）跳过空白/注释，取最近一个有效 token。 */
function nextNonWs(tokens, i, to) {
  for (let j = i; j <= to; j++) {
    const tj = tokens[j];
    if (tj?.type === 'ws' || tj?.type === 'comment') continue;
    return tj;
  }
  return null;
}

/** obj 位于实参位（前 token 是 '(' 或 ','，后 token 是 ',' 或 ')'）→ 可能被引用填充，撤销清空。 */
function applyArgWriteback(tokens, i, nxt, obj, clearMap) {
  if (!(nxt?.type === 'punct' && (nxt.value === ',' || nxt.value === ')'))) return false;
  const prev = prevNonWs(tokens, i);
  if (prev && prev.type === 'punct' && (prev.value === '(' || prev.value === ',')) {
    clearMap.delete(obj);
  }
  return true;
}

/**
 * obj = rhs：rhs 是 null/undefined/[] 记清空；声明初始化不算清空；其它赋值记写回。
 * @returns {boolean} 本 token 已按赋值处理
 */
function applyAssignClearOrWriteback(tokens, i, to, t, nxt, obj, clearMap) {
  if (!(nxt?.type === 'punct' && nxt.value === '=')) return false;
  const rhs = nextNonWs(tokens, i + 2, to);
  if (!rhs) return true;
  const isEmptyAssign = (rhs.type === 'ident' && (rhs.value === 'null' || rhs.value === 'undefined'))
    || (rhs.type === 'punct' && rhs.value === '[' && tokens[i + 3]?.type === 'punct' && tokens[i + 3].value === ']');
  if (!isEmptyAssign) {
    clearMap.delete(obj);
    return true;
  }
  // 声明初始化（var/let/const 变量 = [] / = null）不算清空
  const prev = prevNonWs(tokens, i);
  const decl = prev && prev.type === 'ident' && (prev.value === 'var' || prev.value === 'let' || prev.value === 'const');
  // ① 注解位：`self._x: list = []` 里被赋空值的是 **_x**，但扫描到 `list` 时它也满足
  //    「ident 紧跟 =」——`list` 前面是 `:`（PEP 526 注解分隔符）⇒ 它在注解位，不是赋值目标。
  //    ⚠️ `:` 前面必须是**标识符**：Python 函数定义的 `def f(c):` 也用冒号，但其前是 `)`，
  //    若不加这条就会把函数体第一条语句的赋值误当注解位 —— 实测会压制真缺陷
  //    （`def f(c): c = []` 后 `c[0]` 本该报却不报）。
  const colonPrev = prev && prev.type === 'punct' && prev.value === ':'
    ? prevNonWs(tokens, prevNonWs(tokens, i) === prev ? i - 1 : i - 1)
    : null;
  const annPos = !!colonPrev && colonPrev.type === 'ident';
  // ② 多目标解包：`result, last = [], {}` 中 last 后面紧跟 `=`，但 `[]` 属于 **result**。
  //    判据：obj 之前（同语句内）出现过 `,` 而尚未出现 `=` ⇒ 它是解包目标之一，rhs 不归它。
  const unpackTarget = prev && prev.type === 'punct' && prev.value === ',';
  if (!decl && !annPos && !unpackTarget) {
    clearMap.set(obj, { line: t.line, op: `= ${rhs.value === '[' ? '[]' : rhs.value}` });
  }
  return true;
}

/**
 * 方法清空：.clear()/.reset()/.flush()、.splice(0)、.length = 0。
 * @returns {number} 新的循环下标 i；未命中返回原 i
 */
function applyClearMethods(t, member, memberIdx, callOpen, tokens, obj, clearMap, i) {
  if (callOpen && CLEAR_METHODS.has(member)) {
    clearMap.set(obj, { line: t.line, op: `.${member}()` });
    return memberIdx + 1;
  }
  if (callOpen && member === 'splice') {
    const arg1 = tokens[memberIdx + 2];
    if (!arg1 || (arg1.type === 'num' && Number(arg1.value) === 0)) {
      clearMap.set(obj, { line: t.line, op: '.splice(0)' });
    }
    return memberIdx + 1;
  }
  if (member === 'length' && tokens[memberIdx + 1]?.type === 'punct' && tokens[memberIdx + 1].value === '='
    && tokens[memberIdx + 2]?.type === 'num' && Number(tokens[memberIdx + 2].value) === 0) {
    clearMap.set(obj, { line: t.line, op: '.length = 0' });
    return memberIdx + 2;
  }
  return i;
}

/**
 * 清空后访问：.get()/.at() 或 [下标]。命中则记一条并撤销该对象标记（同对象只报一次）。
 * @returns {number} 新的循环下标 i
 */
function applyAccessAfterClear(t, nxt, member, memberIdx, callOpen, tokens, i, obj, clearMap, out, to) {
  if (!clearMap.has(obj)) return i;
  const cleared = clearMap.get(obj);
  if (callOpen && ACCESS_METHODS.has(member)) {
    out.push({ line: t.line, obj, clearLine: cleared.line, clearOp: cleared.op, accessOp: `.${member}()` });
    clearMap.delete(obj);
    return memberIdx + 1;
  }
  if (nxt?.type === 'punct' && nxt.value === '[') {
    const idx = tokens[i + 2];
    // 写目标不是读：`obj[k] = v` / `obj[k] += v` 的 `[k]` 是**写入下标**，
    //   读一个刚清空的容器才危险，往刚清空的容器里写恰恰是"重新填充"（安全）。
    //   判据：配对 `]` 之后的下一个实义 token 若是 `=`/复合赋值，按写回处理（撤销清空），不报。
    if (idx && (idx.type === 'num' || idx.type === 'ident') && !isWriteSubscript(tokens, i, to)) {
      out.push({ line: t.line, obj, clearLine: cleared.line, clearOp: cleared.op, accessOp: `[${idx.value}]` });
      clearMap.delete(obj);
    } else if (idx && isWriteSubscript(tokens, i, to)) {
      clearMap.delete(obj); // 写入 = 重新填充，撤销清空标记（与 push/set 同口径）
    }
  }
  return i;
}

/** `obj[...]` 是否是**写入**目标（配对 `]` 后紧跟 `=` / 复合赋值）。 */
function isWriteSubscript(tokens, objIdx, to) {
  // 方括号配对自己走（brace.js 的 matchBrace 只处理 {}，且返回数组）
  let depth = 0;
  let close = -1;
  for (let k = objIdx + 1; k <= to && k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.type !== 'punct') continue;
    if (tk.value === '[') depth++;
    else if (tk.value === ']') {
      depth--;
      if (depth === 0) { close = k; break; }
    }
  }
  if (close < 0) return false;
  const after = nextNonWs(tokens, close + 1, to);
  if (!after || after.type !== 'punct') return false;
  return ['=', '+=', '-=', '*=', '/='].includes(after.value);
}

/**
 * 在单个函数体区间内判定「清空后访问」。
 *
 * @param {Array} tokens token 流
 * @param {number} from 区间起点（含）
 * @param {number} to 区间终点（含）
 * @returns {Array<{line:number, obj:string, clearLine:number, clearOp:string, accessOp:string}>}
 */
function scanClearThenAccess(tokens, from, to) {
  const out = [];
  const clearMap = new Map(); // obj -> { line, op }
  for (let i = from; i <= to; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    const identName = t.value;
    const nxt = tokens[i + 1];
    const memberIdx = (nxt?.type === 'punct' && nxt.value === '.') ? i + 2 : -1;
    const member = memberIdx >= 0 && tokens[memberIdx]?.type === 'ident' ? tokens[memberIdx].value : null;
    const callOpen = memberIdx >= 0 && tokens[memberIdx + 1]?.type === 'punct' && tokens[memberIdx + 1].value === '(';

    if (callOpen && WRITE_METHODS.has(member)) {
      clearMap.delete(identName);
      continue;
    }
    if (applyArgWriteback(tokens, i, nxt, identName, clearMap)) continue;
    if (applyAssignClearOrWriteback(tokens, i, to, t, nxt, identName, clearMap)) continue;
    const afterClear = applyClearMethods(t, member, memberIdx, callOpen, tokens, identName, clearMap, i);
    if (afterClear !== i) { i = afterClear; continue; }
    i = applyAccessAfterClear(t, nxt, member, memberIdx, callOpen, tokens, i, identName, clearMap, out, to);
  }
  return out;
}

/**
 * 三层审计 L2 入口：同函数「清空后访问」数据流检测。
 *
 * @param {string} text 文件全文
 * @returns {Array<{line:number, obj:string, clearLine:number, clearOp:string, accessOp:string}>}
 */
export function checkClearAccessAst(text = '') {
  const tokens = tokenize(text);
  const bodies = collectFnBodies(tokens, String(text || ''));
  const seen = new Set(); // 去重（同一行同对象只报一次）
  const out = [];
  for (const [from, to] of bodies) {
    for (const hit of scanClearThenAccess(tokens, from, to)) {
      const key = `${hit.line}:${hit.obj}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
    }
  }
  return out;
}