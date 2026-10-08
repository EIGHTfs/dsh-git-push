/**
 * 性能反模式 AST 精筛：循环体内的「全量集合物化」。
 *
 * 【为什么单独成模块】正则只能看出「写了 Array.from(x.values())」，看不出它**在不在循环体里** ——
 *   而这两者代价天差地别：循环外做一次是 O(集合大小)，循环里做就是 O(循环次数 × 集合大小)，
 *   随数据量二次增长。
 *
 * 【真实样本（本规则的验证依据）】dsh-codegraph 的 `packages/core/src/indexer/symbol-table.ts`
 *   第 213 / 342 行在「按文件 / 按未解析继承」的循环体内写了
 *   `Array.from(this.nodes.values()).filter(...)`。实测（49 文件子集）：
 *   全量扫描 5047ms 中 `resolveCrossFileReferences` 独占 4621ms（**91.6%**），
 *   且每文件成本随规模从 54ms 涨到 102ms（10 → 50 文件）→ 292 文件时高达 1416ms/文件。
 *   根因就是这两处：每次物化整个节点表再过滤。
 *
 * 【局限】按大括号配对判定块体：单行无括号循环体（`for (...) doThing();`）不覆盖 ——
 *   宁可漏报，不误报。
 */

import { tokenize } from './tokenizer.js';

/** 求 `{`（openIdx 处）配对的 `}` 下标；找不到返回 -1。 */
function matchingBrace(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 求 `(`（openIdx 处）配对的 `)` 下标；找不到返回 -1。 */
function matchingParen(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 字符下标 → 1 基行号。 */
function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text[i] === '\n') n += 1;
  return n;
}

/**
 * 命中是否只是注释/字符串里的示例（token 级判定）。
 * @param {Array<{type:string,value:string,line:number}>} tokens tokenize 结果
 * @param {number} line 命中行号
 * @param {string} matchText 命中的原文
 * @returns {boolean} true = 该命中位于注释/字符串文本内，不算真实代码
 */
function inCommentOrString(tokens, line, matchText) {
  return tokens.some(
    (t) => t.line === line
      && (t.type === 'comment' || t.type === 'str' || t.type === 'tmpl')
      && String(t.value).includes(matchText)
  );
}

/** 从 startIdx 起找下一个块体 `{...}` 的范围（跳过 `for (...)` 圆括号内的对象字面量）。 */
function nextBlockRange(text, startIdx) {
  const paren = text.indexOf('(', startIdx);
  let from = startIdx;
  if (paren >= 0) {
    const closeParen = matchingParen(text, paren);
    if (closeParen > paren) from = closeParen;
  }
  const open = text.indexOf('{', from);
  if (open < 0) return null;
  const close = matchingBrace(text, open);
  return close > open ? [open, close] : null;
}

/** 收集所有循环块体（for/while/do 块 + 迭代回调块）的字符区间。 */
function collectLoopRanges(text) {
  const ranges = [];
  const loopRe = /\b(for|while|do)\b/g;
  let m;
  while ((m = loopRe.exec(text)) !== null) {
    const r = nextBlockRange(text, m.index);
    if (r) ranges.push(r);
  }
  // 迭代回调：`xs.forEach((x) => { ... })` 之类，同样构成「循环体内」
  const cbRe = /\.(forEach|map|filter|reduce|some|every|flatMap)\s*\(/g;
  while ((m = cbRe.exec(text)) !== null) {
    const openParen = text.indexOf('(', m.index);
    const r = nextBlockRange(text, openParen + 1);
    if (r) ranges.push(r);
  }
  return ranges;
}

/**
 * 循环体覆盖的行号集合（含循环头那一行到块体结束行）。
 * @param {string} text 文件全文
 * @returns {Set<number>} 行号集合
 */
export function loopBodyLines(text = '') {
  const s = String(text || '');
  const out = new Set();
  for (const [a, b] of collectLoopRanges(s)) {
    const first = lineOf(s, a);
    const last = lineOf(s, b);
    for (let l = first; l <= last; l += 1) out.add(l);
  }
  return out;
}

/**
 * astConfirmKind: "loop-full-collection" 的 **allow** 集合 —— 循环体内做全量集合物化的行号。
 * 判据：`Array.from(x.values() | x.keys() | x.entries())` 且该行落在循环体内。
 *
 * 为什么还要排注释/字符串：本规则用 allow 语义（引擎会跳过通用 codeFilter），
 *   注释里写的示例（如「循环内 Array.from(x.values()) 是反模式」）也含该字面量，
 *   会自报假阳性（实测：本仓库 lib/checks/regex.js 的规则说明注释被自己命中）。
 *   这里按 token 级判定：同一行存在 comment/str/tmpl 且其文本包含该命中串 → 不算命中。
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号集合
 */
export function loopFullCollectionLines(text = '') {
  const s = String(text || '');
  const loops = loopBodyLines(s);
  const out = new Set();
  if (loops.size === 0) return out;
  const tokens = tokenize(s);
  const re = /Array\.from\s*\(\s*[A-Za-z_$][\w.$]*\.(values|keys|entries)\s*\(\s*\)\s*\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const line = lineOf(s, m.index);
    if (!loops.has(line)) continue;
    if (inCommentOrString(tokens, line, m[0])) continue;
    out.add(line);
  }
  return out;
}
