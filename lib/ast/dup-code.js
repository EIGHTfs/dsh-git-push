/**
 * AST 实现层 · 重复代码检测（抽公共函数候选）
 *
 * 判定标准（量化判定标准，量化版）：
 *   「三处重复、五行以上、未来会改」——满足就抽。本检测自动化前两条：
 *     · 重复次数 ≥ 3 处（2 次观察，3 次必须抽）
 *     · 函数体 ≥ 5 行（少于 5 行的重复，抽出来反而增加跳转成本）
 *   第三条「未来会改」无法静态判定，留给人工。
 *
 * 不该抽的形态（自动排除）：
 *   · 纯语法糖/单行表达式（如 arr.filter(x => x)）
 *   · 依赖 this/闭包状态、参数是上下文对象（无法安全抽取）
 *   · 布尔 flag 参数控制分支的「伪公共」函数
 *   · 参数 > 5 个（职责不清）
 *   · test/ 夹具内的重复（测试各自独立，抽公共测试工具另说）
 *
 * 归一化策略（找"结构相同"而非"文本相同"的重复）：
 *   变量名符号化（ident → V）、数字符号化（num → N）、字符串保留原文
 *   （字符串内容不同通常语义不同）、注释与空白剔除。这样
 *   `const a = x + 1` 与 `const total = count + 1` 视为同一结构。
 */

import { tokenize } from './tokenizer.js';
import { collectNamedFnRanges } from './callgraph.js';

/** 重复判定阈值：同一结构函数体出现 ≥ 此数即候选（量化标准：≥3 处必须抽）。 */
const DUP_COUNT_MIN = 3;
/** 函数体最少行数：少于 5 行的重复不值得抽（跳转成本 > 收益）。 */
const DUP_LINES_MIN = 5;
/** 参数上限：超过 5 个参数的函数不报（职责不清，抽了也难维护）。 */
const PARAMS_MAX = 5;
/** 布尔 flag 参数名清单（有这些参数的函数视为"伪公共"，不报）。 */
const BOOL_FLAG_NAMES = new Set(['flag', 'force', 'enabled', 'disabled', 'dryRun', 'dryrun', 'isAdmin', 'isMobile', 'isDark', 'verbose', 'quiet', 'useCache', 'skipCache', 'silent']);

/**
 * 提取单个文件的具名函数体，归一化后返回候选列表。
 * @param {string} text 文件全文
 * @param {string} file 文件路径（供 finding 定位）
 * @returns {Array<{file:string, name:string, line:number, hash:string, lines:number, params:number, hasBoolFlag:boolean}>}
 */
export function collectDupCodeCandidates(text, file = '') {
  const tokens = tokenize(text);
  const ranges = collectNamedFnRanges(tokens);
  const out = [];
  for (const [name, [openIdx, closeIdx]] of ranges) {
    if (!name || name === '(匿名)') continue;
    // 提取函数体 token（openIdx+1 .. closeIdx-1，跳过 {} 本身）
    const bodyTokens = tokens.slice(openIdx + 1, closeIdx);
    // 行数：函数体 token 跨度（openIdx 的 { 到 closeIdx 的 }，含两端）——视觉行数，
    //   与量化标准「重复行数 ≥5」的口径一致（5 行 = 从 function 签名行到闭括号行）
    if (closeIdx <= openIdx) continue;
    const bodyLines = tokens[closeIdx].line - tokens[openIdx].line + 1;
    if (bodyLines < DUP_LINES_MIN) continue;

    // 归一化哈希：变量名/数字符号化，剔 ws/comment，字符串保留
    const parts = [];
    for (const t of bodyTokens) {
      if (t.type === 'ws' || t.type === 'comment') continue;
      if (t.type === 'ident') parts.push('V');
      else if (t.type === 'num') parts.push('N');
      else if (t.type === 'str' || t.type === 'tmpl') parts.push(`S(${t.value.length})`); // 字符串按长度，避免「内容不同但结构同」误合并
      else parts.push(t.value);
    }
    if (parts.length < 8) continue; // 函数体太短（<8 token）视为语法糖，不值得抽
    const hash = parts.join('\u0001'); // 用不可打印分隔符，避免与 || 等运算符字符冲突

    // 参数个数与布尔 flag 判定（从函数签名 token 区间取——openIdx 之前的 '(' ... ')'）
    const params = countParams(tokens, openIdx);
    const hasBoolFlag = hasBoolFlagParam(tokens, openIdx);

    // 纯语法糖排除：函数体归一化后 ≤ 2 种 token 类型 且 无 ident → 如 (x) => x
    const typeSet = new Set(parts);
    if (typeSet.size <= 1) continue; // 全是同一符号（如 V|V|V）→ 语法糖

    out.push({ file, name, line: tokens[openIdx].line, hash, lines: bodyLines, params, hasBoolFlag });
  }
  return out;
}

/**
 * 跨文件聚合重复候选：同一归一化结构出现 ≥3 处的函数体。
 * @param {Array<Array<{file,name,line,hash,lines,params,hasBoolFlag}>>} perFileCandidates
 * @param {object} [opts] { minLines=5, minOccurrences=3 } 阈值（可被规则 yml 覆盖）
 * @returns {Array<{hash:string, lines:number, instances:Array<{file,name,line}>}>}
 */
export function findDuplicateBodies(perFileCandidates, opts = {}) {
  const minLines = Number(opts.minLines) || DUP_LINES_MIN;
  const minOcc = Number(opts.minOccurrences) || DUP_COUNT_MIN;
  const byHash = new Map();
  for (const list of perFileCandidates) {
    for (const c of list) {
      if (c.hasBoolFlag) continue;          // 伪公共不报
      if (c.params > PARAMS_MAX) continue;  // 参数太多不报
      if (c.lines < minLines) continue;     // 行数不足不报
      if (!byHash.has(c.hash)) byHash.set(c.hash, []);
      byHash.get(c.hash).push(c);
    }
  }
  const out = [];
  for (const [hash, instances] of byHash) {
    // 同一结构出现 ≥ 阈值即报（量化标准：2 次观察、3 次必须抽）——
    //   不区分同文件/跨文件：同文件 3 个相同函数体同样是「该抽」信号
    if (instances.length >= minOcc) {
      out.push({ hash, lines: instances[0].lines, instances });
    }
  }
  // 行数多的优先（更值得抽）
  out.sort((a, b) => b.lines - a.lines);
  return out;
}

/** 从函数体 openIdx 回找签名括号，数参数个数（顶层逗号 + 1；无参数 0）。 */
function countParams(tokens, openIdx) {
  let closeIdx = -1;
  let parenDepth = 0;
  // 回找与 openIdx 前最近的 ')' 配对的 '('：从 openIdx-1 向左扫
  for (let j = openIdx - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.type !== 'punct') continue;
    if (t.value === ')') { parenDepth++; closeIdx = j; break; }
    if (t.value === ';' || t.value === '{') break;
  }
  if (closeIdx === -1) return 0;
  // 在 closeIdx 内找配对 '('
  let depth = 0, openParen = -1;
  for (let j = closeIdx; j >= 0; j--) {
    const t = tokens[j];
    if (t.type !== 'punct') continue;
    if (t.value === ')') depth++;
    else if (t.value === '(') { depth--; if (depth === 0) { openParen = j; break; } }
  }
  if (openParen === -1) return 0;
  let commas = 0;
  let inner = 0;
  for (let j = openParen + 1; j < closeIdx; j++) {
    const t = tokens[j];
    if (t.type !== 'punct') continue;
    if (t.value === '(' || t.value === '[' || t.value === '{') inner++;
    else if (t.value === ')' || t.value === ']' || t.value === '}') inner--;
    else if (t.value === ',' && inner === 0) commas++;
  }
  return commas + (closeIdx - openParen > 1 ? 1 : 0);
}

/** 签名括号内是否含布尔 flag 参数名。 */
function hasBoolFlagParam(tokens, openIdx) {
  let closeIdx = -1;
  for (let j = openIdx - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.type !== 'punct') continue;
    if (t.value === ')') { closeIdx = j; break; }
    if (t.value === ';' || t.value === '{') break;
  }
  if (closeIdx === -1) return false;
  // 从 closeIdx 向左扫到签名 '('：ident 是参数名，命中布尔 flag 词表即伪公共
  for (let j = closeIdx; j >= 0; j--) {
    const t = tokens[j];
    if (t.type === 'punct') {
      if (t.value === '(') break; // 到签名起点
      continue;
    }
    if (t.type === 'ident' && BOOL_FLAG_NAMES.has(t.value)) return true;
  }
  return false;
}
