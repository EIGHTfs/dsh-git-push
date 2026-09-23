/**
 * 变量作用域分类器 · 最小版（2026-09-23，方案 Step 1）
 *
 * 基于 token 流的行号区间法（零依赖，复用 dataflow 的函数体区间思路）：
 *   预扫描 tokens 得到「函数体区间」与「循环体区间」，再按声明所在行号归类：
 *     - 在函数体内 → 'function'
 *     - 在循环体内 → 'loop'（同时标注 inFunction）
 *     - 其余 → 'module'（顶层）
 * 另提供「模块级常量赋值」判定（isModuleConstAssignment）——供 magic-number 等规则
 * 豁免 `const MAX_RETRY = 3` 这类模块级命名常量（用户方案：模块/全局作用域豁免常量）。
 */

import { tokenize } from './tokenizer.js';

/** 收集函数体行号区间 [startLine, endLine]（function 声明/表达式/箭头/方法）。 */
export function collectFnLineRanges(text) {
  const tokens = tokenize(text);
  const ranges = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.type === 'ident' && t.value === 'function')) continue;
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 24); j++) {
      if (tokens[j].type === 'punct' && tokens[j].value === '{') { openIdx = j; break; }
      if (tokens[j].type === 'punct' && (tokens[j].value === ';' || tokens[j].value === '}')) break;
    }
    if (openIdx === -1) continue;
    const depth = braceCloseIdx(tokens, openIdx);
    if (depth > openIdx) ranges.push([tokens[openIdx].line, tokens[depth].line]);
  }
  return ranges;
}

/** 收集循环体行号区间 [startLine, endLine]（for/while/do/for-in/for-of）。 */
export function collectLoopLineRanges(text) {
  const tokens = tokenize(text);
  const ranges = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !['for', 'while', 'do'].includes(t.value)) continue;
    // for (...) { / while (...) { / do { —— 找循环后第一个 '{'
    for (let j = i + 1; j < Math.min(tokens.length, i + 24); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') {
        const depth = braceCloseIdx(tokens, j);
        if (depth > j) ranges.push([tokens[j].line, tokens[depth].line]);
        break;
      }
      // 2026-09-23 fix：for 头部分号（for (let i=0; ...)）不能提前 break——只以 } 或超限终止
      if (tj.type === 'punct' && tj.value === '}') break;
    }
  }
  return ranges;
}

/** 从 openIdx（应为 `{`）找配对闭括号下标（无配对返回 openIdx）。 */
function braceCloseIdx(tokens, openIdx) {
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



/** 启动路径函数名模式（一次性初始化：apply/init/main/bootstrap/setup 等），豁免大函数/high 复杂度。 */
const STARTUP_PATH_PATTERNS = ['apply', 'init', 'main', 'bootstrap', 'setup', 'mount', 'start', 'boot', 'register', 'configure', 'sync', 'restore', 'migrate'];

/** 按函数名判执行路径：'startup' | 'unknown'（请求路径等复杂判定留给调用链分析）。 */
export function classifyFunctionPath(fnName = '') {
  if (STARTUP_PATH_PATTERNS.some((p) => String(fnName).toLowerCase().includes(p))) return 'startup';
  return 'unknown';
}
/**
 * 声明行号归类：'module' | 'function' | 'loop'。
 * @param {string} text 文件全文
 * @param {number} line 声明所在行号（1-based）
 * @returns {{scope: string, inFunction: boolean, inLoop: boolean}}
 */
export function classifyLineScope(text, line) {
  const inLoop = collectLoopLineRanges(text).some(([s, e]) => line >= s && line <= e);
  const inFunction = collectFnLineRanges(text).some(([s, e]) => line >= s && line <= e);
  return { scope: inFunction ? 'function' : 'module', inFunction, inLoop };
}

/**
 * 模块级常量赋值判定：该行形如 `const NAME = <数字>`（或 let/var + 大写常量名），
 * 且声明在模块顶层（不在函数体内）——magic-number 等规则豁免这类命名常量。
 * @param {string} text 文件全文
 * @param {number} line 目标行号
 * @returns {boolean}
 */
export function isModuleConstAssignment(text, line) {
  // 仅模块顶层：函数体内 `const x = 3` 不算命名常量（用户方案：函数内魔数照报）
  if (collectFnLineRanges(text).some(([sf, ef]) => line >= sf && line <= ef)) return false;
  const tokens = tokenize(text);
  // 行内找 const/let/var → ident → = 且右侧是 num（含大写常量名风格）
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.line !== line) continue;
    if (t.type !== 'ident' || !['const', 'let', 'var'].includes(t.value)) continue;
    const name = tokens[i + 1];
    if (!name || name.type !== 'ident' || name.line !== line) continue;
    // 常量名风格：全大写或 CamelCase（小写则不算命名常量）
    const isConstStyle = /^[A-Z]/.test(name.value) || /^[a-z]+[A-Z]/.test(name.value);
    if (!isConstStyle) continue;
    // 跳过 = 后是函数/表达式（非纯数字）的情况——找行内 '=' 后的 num
    for (let j = i + 2; j < tokens.length && tokens[j].line === line; j++) {
      if (tokens[j].type === 'punct' && tokens[j].value === '=') {
        const rhs = tokens[j + 1];
        if (rhs && rhs.type === 'num' && rhs.line === line) return true;
        break;
      }
    }
  }
  return false;
}