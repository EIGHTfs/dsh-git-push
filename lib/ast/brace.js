/**
 * AST 实现层 · 括号与区间工具
 *
 * 职责：括号配对、区间包含判定。供复杂度/嵌套/函数行数检查复用，
 *   让「某个 token 属于哪个函数体」这类判断只在一处实现。
 */

/** 括号平衡扫描：从 startIdx 的 '{' 找匹配 '}'，返回 [openIdx, closeIdx] 或 null。 */
export function matchBrace(tokens, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'punct') continue;
    if (t.value === '{') depth++;
    else if (t.value === '}') {
      depth--;
      if (depth === 0) return [openIdx, i];
    }
  }
  return null;
}

/**
 * 判断 `)` 是否属于控制流/函数签名的参数表尾（即其后 `{` 是块语句）。
 * 从 `)` 向前做括号配对找起始 `(`，再看 `(` 前一个 token：
 *   if/for/while/switch/catch/function/标识符（函数声明/表达式/方法名） → 是块语句头。
 * @param {Array} tokens token 流
 * @param {object} closeTok `)` token
 * @returns {boolean}
 */
export function isBlockParen(tokens, closeTok) {
  const closeIdx = tokens.indexOf(closeTok);
  let level = 0;
  let openIdx = -1;
  for (let j = closeIdx; j >= 0; j--) {
    const tj = tokens[j];
    if (tj.type !== 'punct') continue;
    if (tj.value === ')') level++;
    else if (tj.value === '(') { level--; if (level === 0) { openIdx = j; break; } }
  }
  if (openIdx === -1) return false;
  for (let j = openIdx - 1; j >= 0; j--) {
    const tj = tokens[j];
    if (tj.type === 'ws' || tj.type === 'comment') continue;
    if (tj.type === 'ident') return true;                      // if (…) / myFunc (…) / function f (…)
    // `)` `]` `.` 等 → 调用表达式（如 foo.bar(…)），其后 `{` 多半是对象实参 → 不计
    return false;
  }
  return false;
}

/** 找与 closeIdx 处 `}` 配对的 `{` 下标（无配对返回 -1）。 */
export function matchingOpen(tokens, closeIdx) {
  let level = 0;
  for (let j = closeIdx; j >= 0; j--) {
    const tj = tokens[j];
    if (tj.type !== 'punct') continue;
    if (tj.value === '}') level++;
    else if (tj.value === '{') { level--; if (level === 0) return j; }
  }
  return -1;
}

/**
 * 检查圈复杂度（max-complexity kind，AST 级）。
 * 复杂度 = 1 + 分支关键字数（if/for/while/case/catch/&&/||/?/??）。
 * @param {string} text 文件全文
 * @param {object} [opts] { warn=10, block=20 }
 * @returns {Array<{line:number, name:string, complexity:number, level:string}>}
 */
/**
 * 收集 [from, to) 区间内所有「嵌套 function 体」的 token 区间。
 * 供圈复杂度计算排除内层贡献（内层由外层循环单独评估）。
 *
 * @param {Array} tokens token 流
 * @param {number} from 起始下标（含）
 * @param {number} to 结束下标（不含）
 * @returns {Array<[number, number]>} 各内层函数体的 [openBraceIdx, closeBraceIdx]
 */
export function collectInnerFnRanges(tokens, from, to) {
  const ranges = [];
  for (let i = from; i < to; i++) {
    const t = tokens[i];
    if (!(t.type === 'ident' && t.value === 'function')) continue;
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(to, i + 20); j++) {
      if (tokens[j].type === 'punct' && tokens[j].value === '{') { openIdx = j; break; }
    }
    if (openIdx === -1) continue;
    const r = matchBrace(tokens, openIdx);
    if (r) ranges.push(r);
  }
  return ranges;
}
