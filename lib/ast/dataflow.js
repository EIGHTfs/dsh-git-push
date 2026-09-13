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

/** 清空动作：方法调用（对象.clear() / .reset() / .flush() / .purge()）。 */
const CLEAR_METHODS = new Set(['clear', 'reset', 'empty', 'flush', 'purge']);
/** 访问动作：方法读——清空后调用会拿 undefined（.get() / .at(0) / .first() / .peek()）。
 *   shift/pop 是「消费式访问」，常见于 `while (len) { shift() }` 保护模式，不报（宁漏不误报）。 */
const ACCESS_METHODS = new Set(['get', 'at', 'first', 'last', 'peek', 'head']);
/** 写回动作：清空后重新填充（push/add/set/append/unshift/assign）→ 撤销清空标记。 */
const WRITE_METHODS = new Set(['push', 'add', 'set', 'append', 'unshift', 'assign', 'insert']);

/**
 * 收集文本里所有「函数体 token 区间」——function 声明 + 方法 + 箭头函数，
 *   以及**排除函数体后**的顶层作用域孤岛区间。
 *
 * 互斥性（2026-09-14 修复跨函数误连）：
 *   旧实现把顶层作用域 = 整个文件区间，导致「模块级清空（顶层 `resultsByIndex =
 *   new Map()` 重置）→ 另一函数里的访问」被误判为同函数。正确做法是：
 *   顶层只保留**不属于任何函数体**的 token 段（变量声明/模块级语句），
 *   与各函数体区间互斥，各自独立扫描——清空动作和访问动作必须落在同一区间。
 *
 * @param {Array} tokens token 流
 * @returns {Array<[number, number]>} [startIdx, endIdx]（含大括号，闭区间；互斥不重叠）
 */
function collectFnBodies(tokens) {
  const fnRanges = []; // 函数体区间（含大括号）
  // ① function 声明/表达式体（function f() {...} / const f = function() {...}）
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
  // ② 箭头函数体（() => {...}）与方法简写（method() {...}）
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
  // ③ 顶层作用域孤岛：文件中不属于任何函数体的 token 段
  //    排序去重叠（嵌套函数只留最外层；matchBrace 对嵌套天然返回外层闭区间）
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
    const obj = t.value;
    const nxt = tokens[i + 1];
    const memberIdx = (nxt?.type === 'punct' && nxt.value === '.') ? i + 2 : -1;
    const member = memberIdx >= 0 && tokens[memberIdx]?.type === 'ident' ? tokens[memberIdx].value : null;
    const callOpen = memberIdx >= 0 && tokens[memberIdx + 1]?.type === 'punct' && tokens[memberIdx + 1].value === '(';

    // ── 写回撤销：obj.push( / .add( / .set( → 该对象不再是「已清空」──
    if (callOpen && WRITE_METHODS.has(member)) {
      clearMap.delete(obj);
      continue;
    }
    // ── 写回撤销：obj 作为实参传入函数调用（foo(obj) / walkVideos(root, files, 0)）──
    //    被调函数可能通过引用填充 obj（数组/对象是引用传递），静态无法确认——
    //    保守撤销清空标记（宁漏不误报；真实时序交给 L3 运行时确认）。
    //    判定：obj 位于实参位（前 token 是 '(' 或 ','，后 token 是 ',' 或 ')'），
    //    且不是清空动作接收者（obj 后面不是 '.'）。
    if (nxt?.type === 'punct' && (nxt.value === ',' || nxt.value === ')')) {
      let prev = null;
      for (let j = i - 1; j >= 0; j--) {
        if (tokens[j].type === 'ws' || tokens[j].type === 'comment') continue;
        prev = tokens[j];
        break;
      }
      if (prev && prev.type === 'punct' && (prev.value === '(' || prev.value === ',')) {
        clearMap.delete(obj);
      }
      continue;
    }
    // ── 赋值统一处理：= 后跟清空值（null/undefined/[]）是清空动作；其他 rhs 是写回 ──
    if (nxt?.type === 'punct' && nxt.value === '=') {
      // 跳过空白/注释取 rhs 第一个有效 token
      let rhs = null;
      for (let j = i + 2; j <= to; j++) {
        const tj = tokens[j];
        if (tj?.type === 'ws' || tj?.type === 'comment') continue;
        rhs = tj;
        break;
      }
      if (!rhs) continue;
      const isEmptyAssign = (rhs.type === 'ident' && (rhs.value === 'null' || rhs.value === 'undefined'))
        || (rhs.type === 'punct' && rhs.value === '[' && tokens[i + 3]?.type === 'punct' && tokens[i + 3].value === ']');
      if (isEmptyAssign) {
        // 2026-09-14：声明初始化（var/let/const obj = [] / = null）不算清空——
        //   变量**首次声明**时置空是初始化，不是「把已有值的对象清空」。
        //   例：`var allVideos = []; ... allVideos[i]`（先声明空数组后填充使用）是
        //   正常模式，不应报「清空后访问」。
        let decl = false;
        for (let j = i - 1; j >= 0; j--) {
          if (tokens[j].type === 'ws' || tokens[j].type === 'comment') continue;
          decl = tokens[j].type === 'ident' && (tokens[j].value === 'var' || tokens[j].value === 'let' || tokens[j].value === 'const');
          break;
        }
        if (!decl) {
          clearMap.set(obj, { line: t.line, op: `= ${rhs.value === '[' ? '[]' : rhs.value}` });
        }
      } else {
        clearMap.delete(obj); // 非清空赋值 = 写回
      }
      continue;
    }

    // ── 清空动作 ──
    // ① obj.clear() / obj.reset() / obj.flush()
    if (callOpen && CLEAR_METHODS.has(member)) {
      clearMap.set(obj, { line: t.line, op: `.${member}()` });
      i = memberIdx + 1;
      continue;
    }
    // ② obj.splice(0 [, n]) —— 从 0 删起 = 清空
    if (callOpen && member === 'splice') {
      const arg1 = tokens[memberIdx + 2];
      if (!arg1 || (arg1.type === 'num' && Number(arg1.value) === 0)) {
        clearMap.set(obj, { line: t.line, op: '.splice(0)' });
      }
      i = memberIdx + 1;
      continue;
    }
    // ④ obj.length = 0
    if (member === 'length' && tokens[memberIdx + 1]?.type === 'punct' && tokens[memberIdx + 1].value === '='
      && tokens[memberIdx + 2]?.type === 'num' && Number(tokens[memberIdx + 2].value) === 0) {
      clearMap.set(obj, { line: t.line, op: '.length = 0' });
      i = memberIdx + 2;
      continue;
    }

    // ── 访问动作（仅当已被清空且未被写回）──
    if (!clearMap.has(obj)) continue;
    const cleared = clearMap.get(obj);
    // ⑤ obj.get() / obj.at() / obj.first() / obj.peek() / obj.head()
    if (callOpen && ACCESS_METHODS.has(member)) {
      out.push({ line: t.line, obj, clearLine: cleared.line, clearOp: cleared.op, accessOp: `.${member}()` });
      clearMap.delete(obj); // 同对象只报一次（防同一清空后 N 次访问刷屏）
      i = memberIdx + 1;
      continue;
    }
    // ⑥ obj[下标]（读）——清空后下标读必然 undefined/越界（length 读安全不报：
    //    数组清空后读 length 返回 0 是正常防御，不是「读已清空对象」）
    if (nxt?.type === 'punct' && nxt.value === '[') {
      const idx = tokens[i + 2];
      if (idx && (idx.type === 'num' || idx.type === 'ident')) {
        out.push({ line: t.line, obj, clearLine: cleared.line, clearOp: cleared.op, accessOp: `[${idx.value}]` });
        clearMap.delete(obj);
      }
      continue;
    }
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
  const bodies = collectFnBodies(tokens);
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