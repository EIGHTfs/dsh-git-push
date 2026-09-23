/**
 * 调用链追踪（2026-09-23，方案 Step 5/P3）——单文件调用图
 *
 * 用途：io-risk 等规则的「请求路径」判定升级——不只靠函数体内特征（detectRequestContext），
 * 还看**调用链**：被请求路径函数调用的函数，也在请求路径上。
 *
 * 局限（按方案标记「需人工复核」不强行判断）：跨文件调用、动态调用 obj[method]()、
 * 回调传递断链。
 */

import { tokenize } from './tokenizer.js';

/** 请求路径函数名模式（子串匹配，与 io-risk 的 REQUEST_PATTERNS 语义互补）。 */
const REQUEST_PATH_NAMES = ['handle', 'request', 'route', 'onrequest', 'middleware', 'api', 'controller', 'service'];

/**
 * 构建单文件调用图：calleeName → Set(callerName)（调用者列表）。
 * 只统计「具名函数体内」的具名调用（ident(...) 且被调名是 ident），
 * 动态调用（obj[method](...) / 匿名回调）天然落不进图——按盲区处理。
 * @param {string} text 文件全文
 * @returns {Map<string, Set<string>>} callee → callers
 */
export function buildCallGraph(text) {
  const tokens = tokenize(text);
  const graph = new Map();
  // 函数边界（名称 → [startIdx, endIdx]）：function NAME / const NAME = function / NAME = (...) => / NAME(...) { }
  const fnRanges = collectNamedFnRanges(tokens);
  for (const [fnName, [startIdx, endIdx]] of fnRanges) {
    for (let i = startIdx; i < endIdx; i++) {
      const t = tokens[i];
      if (t.type !== 'ident') continue;
      const nx = tokens[i + 1];
      if (!(nx && nx.type === 'punct' && nx.value === '(')) continue;
      // 排除函数自身声明（function NAME( 处的 NAME 后是 '(' 但那是声明）——fnName 的声明 token 不在本函数体前
      if (t.value === fnName && tokens[i - 1] && tokens[i - 1].type === 'ident' && ['function', 'const', 'let', 'var'].includes(tokens[i - 1].value)) continue;
      const callee = t.value;
      if (!graph.has(callee)) graph.set(callee, new Set());
      graph.get(callee).add(fnName);
    }
  }
  return graph;
}

/**
 * 判定函数是否在请求路径上（调用链向上追溯：本函数被某请求路径函数调用，或
 * 该调用者又被请求路径函数调用……）。向上遍历防环。
 * @param {string} fnName 目标函数名
 * @param {Map<string, Set<string>>} graph buildCallGraph 结果
 * @param {(name:string)=>boolean} [isRequestName] 请求路径函数名判定（缺省 REQUEST_PATH_NAMES）
 * @returns {boolean}
 */
export function isInRequestPath(fnName, graph, isRequestName) {
  const isReq = isRequestName || ((n) => REQUEST_PATH_NAMES.some((p) => String(n).toLowerCase().includes(p)));
  const visited = new Set();
  const stack = [fnName];
  while (stack.length) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    const callers = graph.get(cur);
    if (!callers) continue;
    for (const caller of callers) {
      if (isReq(caller)) return true;
      stack.push(caller);
    }
  }
  return false;
}

/** 收集具名函数体 token 区间：[name, [startIdx, endIdx]]（function NAME / const NAME = (...) => {} / NAME = function）。 */
function collectNamedFnRanges(tokens) {
  const out = [];
  // ① function NAME(...) { ... }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.type === 'ident' && t.value === 'function')) continue;
    let j = i + 1;
    let name = '(匿名)';
    if (tokens[j] && tokens[j].type === 'ident') { name = tokens[j].value; j += 1; }
    // 找函数体 {（限 24 token）
    let openIdx = -1;
    for (let k = j; k < Math.min(tokens.length, j + 24); k++) {
      if (tokens[k].type === 'punct' && tokens[k].value === '{') { openIdx = k; break; }
      if (tokens[k].type === 'punct' && tokens[k].value === ';') break;
    }
    if (openIdx === -1) continue;
    const closeIdx = matchBraceIdx(tokens, openIdx);
    if (closeIdx > openIdx) { if (name !== '(匿名)') out.push([name, [openIdx, closeIdx]]); i = closeIdx; }
  }
  // ② const NAME = (...) => { } / const NAME = function ...（箭头）
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.type === 'ident' && ['const', 'let', 'var'].includes(t.value))) continue;
    const name = tokens[i + 1];
    if (!(name && name.type === 'ident')) continue;
    // 向后找 => 后第一个 {（限 30 token）
    for (let j = i + 2; j < Math.min(tokens.length, i + 30); j++) {
      if (tokens[j].type === 'punct' && tokens[j].value === '=>') {
        let openIdx = -1;
        for (let k = j + 1; k < Math.min(tokens.length, j + 24); k++) {
          if (tokens[k].type === 'punct' && tokens[k].value === '{') { openIdx = k; break; }
        }
        if (openIdx !== -1) {
          const closeIdx = matchBraceIdx(tokens, openIdx);
          if (closeIdx > openIdx) out.push([name.value, [openIdx, closeIdx]]);
        }
        break;
      }
      if (tokens[j].type === 'punct' && tokens[j].value === ';') break;
    }
  }
  return out;
}

/** 从 openIdx（应为 `{`）找配对闭括号下标（无配对返回 openIdx）。 */
function matchBraceIdx(tokens, openIdx) {
  let depth = 0;
  for (let j = openIdx; j < tokens.length; j++) {
    if (tokens[j].type === 'punct' && tokens[j].value === '{') depth++;
    else if (tokens[j].type === 'punct' && tokens[j].value === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return openIdx;
}