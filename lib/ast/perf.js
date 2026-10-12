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
 * 查询/解析类函数名（本规则只看这类）——这类通常纯函数且可能开销不小，重复调用值得记忆化。
 * 实测不加这层收窄时，本仓库 184 个文件里误报 218 处（log/push/emit/readFile 等重复调用
 * 多是有意为之）。
 */
const LOOKUP_LIKE_RE = /(?:^|\.)?(?:resolve|lookup|canonical|toPath|find[A-Z]|get[A-Z]|parse[A-Z]|normalize[A-Z]|compute[A-Z]|build[A-Z]|read[A-Z])/;

/**
 * 只保留**最内层**循环区间（不含其它循环区间的那些）。
 *
 * 为什么：外层区间会把「不同内层循环里文本相同的调用」误判成重复。
 *   实测误报：两个相邻的内层循环里写了同一个调用（`for (…of io.reads) { resolveIoPath(…) }`
 *   与 `for (…of io.writes) { …同一个调用… }`），它们是独立内层循环，却被外层区间当成重复。
 *   只比最内层后，这类误报消失；而真实案例（同一内层循环内重复调用同一函数）仍会被抓到。
 * @param {string} text 文件全文
 * @returns {Array<[number, number]>} 最内层区间列表
 */
function innermostLoopRanges(text) {
  const all = collectLoopRanges(text);
  return all.filter((r) => !all.some((o) => o !== r && o[0] > r[0] && o[1] < r[1]));
}

/**
 * astConfirmKind: "repeat-identical-call" 的 **allow** 集合 ——
 * 同一个循环体内 ≥2 次**实参完全相同**的函数调用所在行。
 *
 * 背景（真实案例）：外部项目里 `resolveModuleToFilePath` 在解析循环中被调用 8762 次（约 180 次/文件），
 *   累计 4581ms 占全量扫描 89%；而 fs 探测只有 191 次/11ms —— 瓶颈是**重复纯计算**，
 *   加一层记忆化后该函数 4581ms → 344ms、整体 5143ms → 763ms。
 *
 * 判据与边界（宁可漏报不误报）：
 *   · 只看循环体内（复用 loopBodyLines）；
 *   · 比较「函数名 + 实参文本（去空白）」完全相同 —— 实参不同的重复调用（如同名函数不同入参）
 *     不报，因为无法静态判断哪个更贵；
 *   · 只匹配**无嵌套括号**的调用（保守，嵌套实参的调用一律不判）；
 *   · 排除注释/字符串里的示例。
 * 注意：本规则是**代理特征**——它抓「完全重复的调用」，而案例里更常见的是「入参部分重叠」，
 *   那类只能靠运行时探针（分阶段计时 + 调用计数）定位。
 * 收窄：只判**查询/解析类**函数名（resolve/lookup/findX/getX/parseX/normalizeX/computeX/buildX）——
 *   这类通常纯函数且可能开销不小；而 log/push/emit/readFile 之类重复调用多是有意为之
 *   （实测不加这层收窄时，本仓库 184 个文件里误报 218 处）。
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号集合
 */
export function repeatIdenticalCallLines(text = '') {
  const s = String(text || '');
  const out = new Set();
  const tokens = tokenize(s);
  // 只比最内层循环区间：外层区间会把不同内层循环里文本相同的调用误判成重复（实测误报已修）
  for (const [a, b] of innermostLoopRanges(s)) {
    const body = s.slice(a, b + 1);
    const seen = new Map();
    const re = /([A-Za-z_$][\w.$]*)\s*\(([^()]*)\)/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      if (!LOOKUP_LIKE_RE.test(m[1])) continue;
      const line = lineOf(s, a + m.index);
      if (inCommentOrString(tokens, line, m[0])) continue;
      const key = `${m[1]}(${m[2].replace(/\s+/g, '')})`;
      if (seen.has(key)) {
        if (seen.get(key) !== line) out.add(line); // 同一行内的重复（如 a() && a()）不算
      } else {
        seen.set(key, line);
      }
    }
  }
  return out;
}

/**
 * astConfirmKind: "loop-full-collection" 的 **allow** 集合 —— 循环体内做全量集合物化的行号。
 *
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

// ============================================================
// 2026-10-12 新增 4 条实战精筛
// 来源：gamebanana-mods-downloader 的真实修复提交（每条都验证过「修复前命中、修复后不报」）
// 共性：正则只能看出「写了某个调用/循环」，看不出**它在不在循环里、循环规模多大、函数会不会返回 undefined**
//   —— 这些必须按结构判定，故一律走 AST 精筛（allow 语义：只有这里返回的行才报）。
// ============================================================

/** 收集函数块体区间：function 声明 + 箭头函数块体。返回 [{name, a, b}]（a/b 为块体内部区间）。 */
function collectFuncRanges(text) {
  const out = [];
  const re = /(?:async\s+)?function\s*([\w$]*)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchingBrace(text, open);
    if (close > open) out.push({ name: m[1] || '(anonymous)', a: open + 1, b: close });
  }
  const re2 = /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>\s*\{/g;
  while ((m = re2.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchingBrace(text, open);
    if (close > open) out.push({ name: m[1], a: open + 1, b: close });
  }
  return out;
}

/** 直接整份写文件的函数名（同文件内 `writeFileSync` + `JSON.stringify` 同时出现）。 */
function directFullWriters(text) {
  const names = new Set();
  for (const f of collectFuncRanges(text)) {
    const body = text.slice(f.a, f.b);
    if (/writeFileSync\s*\(/.test(body) && /JSON\.stringify\s*\(/.test(body)) names.add(f.name);
  }
  return names;
}

/**
 * 把注释、字符串、模板串、正则字面量的**内容**替换为空格（保留换行，便于行号对齐）。
 *
 * 为什么需要：本规则与同族规则的判定正则直接跑在**原文**上，会把注释/字符串里的 "return"
 *   当成代码。实测误报（2026-10-13）：注释行以「…只认有值 return」结尾 + 换行 + 下一行代码，
 *   被 `/\breturn\s+[^\s;]/` 匹配成"循环体内有值 return"。
 * @param {string} text 文本
 * @returns {string} 同长度、仅注释与字面量内容被空格替换的文本
 */
function blankCommentsAndLiterals(text) {
  const src = String(text || '');
  let out = '';
  let i = 0;
  /** 正则字面量判定：向前找最近的非空白字符，非标识符/右括号/右方括号 ⇒ 视为正则开始。 */
  const isRegexStart = (idx) => {
    for (let k = idx - 1; k >= 0; k -= 1) {
      const c = src[k];
      if (/\s/.test(c)) continue;
      return !/[\w$)\]]/.test(c);
    }
    return true;
  };
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '/' && c2 === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '\u0060') { // \u0060 = 反引号：写转义而非字面反引号，避免本文件的区间解析被模板串状态带偏
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j += 1; break; }
        if (c !== '`' && src[j] === '\n') break;
        j += 1;
      }
      out += src.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }
    if (c === '/' && isRegexStart(i)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { j += 1; break; }
        else if (d === '\n') break;
        j += 1;
      }
      out += src.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * astConfirmKind: "loop-no-fallback-return" 的 **allow** 集合 ——
 * 函数顶层循环里有「有值 return」，而循环之后既无 return 也无 throw ⇒ 可能返回 undefined。
 *
 * 实战：`fetchJsonHeaders` 的 for 重试循环里 return，而网络错误时 maxAttempts(6) 大于循环上界
 *   retries(1) ⇒ 循环走完却不抛错 ⇒ **返回 undefined** ⇒ 调用方 `const { json } = await …` 解构崩溃，
 *   面板只显示 "Cannot destructure property 'json' of '(intermediate value)' as it is undefined"。
 * 边界：裸 `return;` 不算（排空/提前退出助手，返回值无人使用，如 native-host 的 pump()）。
 *
 * 2026-10-13 修误报（三处收窄，均为实测证伪的假阳性，错误逻辑已直接删除不留注释）：
 *   ① 剔除**嵌套函数体**：IIFE/内部箭头函数里的 return 不属于本循环
 *      （误报：`orchestrate.js` 循环体内 `(() => { try { return hasMarkBlock(…) } catch { return false } })()`）
 *   ② 剔除**注释与字符串/正则字面量**里的 return（误报：注释以「…return」结尾 + 换行 + 下一行代码）
 *   ③ 跳过 `for (;;)` / `while (true)` 且体内**无 break** 的循环：它只能经 return/throw 退出，走不到循环之后
 *      （误报：`lib/exempt/index.js` 的两个逐级向上查找循环）
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号集合
 */
export function loopNoFallbackReturnLines(text = '') {
  const s = String(text || '');
  const out = new Set();
  for (const f of collectFuncRanges(s)) {
    const body = s.slice(f.a, f.b);
    const all = collectLoopRanges(body);
    // 只看函数顶层循环（不含被别的循环包住的）
    const top = all.filter((r) => !all.some((o) => o !== r && o[0] < r[0] && o[1] > r[1]));
    for (const [a, b] of top) {
      const inner = body.slice(a, b + 1);
      // 收窄①：把嵌套函数体的字符区间挖空（保持长度，行号不受影响）
      let own = inner;
      for (const nf of collectFuncRanges(inner)) {
        own = own.slice(0, nf.a) + ' '.repeat(Math.max(0, nf.b - nf.a + 1)) + own.slice(nf.b + 1);
      }
      // 收窄②：注释与字面量内容挖空
      own = blankCommentsAndLiterals(own);
      if (!/\breturn\s+[^\s;]/.test(own)) continue;               // 只认有值 return
      // 收窄③：无限循环且无 break ⇒ 不需要兜底 return
      //   注意：区间起点是**花括号块**本身（nextBlockRange 返回 [open, close]，不含循环头），
      //   所以无限循环判定必须从块**之前**的文本回看，不能从块内取头。
      const before = body.slice(Math.max(0, a - 80), a);
      const infinite = /for\s*\(\s*;\s*;\s*\)\s*$/.test(before) || /while\s*\(\s*(?:true|1)\s*\)\s*$/.test(before);
      if (infinite && !/\bbreak\b/.test(own)) continue;
      const tail = body.slice(b + 1).replace(/\s|}/g, '');
      if (tail) continue;                                        // 循环之后还有语句
      out.add(lineOf(s, f.a + a));
    }
  }
  return out;
}

/**
 * astConfirmKind: "loop-full-rewrite-call" 的 **allow** 集合 ——
 * 循环体内调用「整份重写文件」的函数（同文件一层解析：被调函数自己含 writeFileSync + JSON.stringify，
 * 或它调用了这样的函数）。
 *
 * 实战：`finalizeHtmls` 逐目录调 `ingestModDir` → `saveGameFile` 把整份游戏索引（15–26MB）重写一遍
 *   ⇒ 数千目录 = 几十 GB 写盘、收尾 634 秒、期间 /api/* 连续 74 秒全部超时。
 * **局限（必须说清）**：循环规模静态不可知 —— 「13 个游戏各写一次」与「4,598 个目录各写一次」代码同形
 *   ⇒ 本规则只作 warning，判真伪需运行期计数。
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号集合
 */
export function loopFullRewriteCallLines(text = '') {
  const s = String(text || '');
  const out = new Set();
  const direct = directFullWriters(s);
  if (direct.size === 0) return out;
  const tokens = tokenize(s);
  for (const [a, b] of collectLoopRanges(s)) {
    const body = s.slice(a, b + 1);
    const re = /([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const name = m[1];
      if (!direct.has(name)) continue;
      const line = lineOf(s, a + m.index);
      if (inCommentOrString(tokens, line, m[0])) continue;
      // 已批量化/已加守卫的不报（修好之后不该再被报）：
      //   · 实参里带 deferSave/批量标记 ⇒ 调用方已改为循环外统一落盘
      //   · 调用前面 ~200 字符内有 `if (changed…` ⇒ 只有内容真变了才写
      const args = body.slice(m.index, m.index + 160);
      if (/deferSave|batch|批量/i.test(args)) continue;
      const before = body.slice(Math.max(0, m.index - 200), m.index);
      if (/if\s*\([^)]*changed/.test(before)) continue;
      out.add(line);
    }
  }
  return out;
}

/**
 * astConfirmKind: "nested-linear-scan" 的 **allow** 集合 ——
 * 成员判定回调（filter/find/some/every）里再套 for 循环并做 `===` 比较 ⇒ O(n×m)。
 *
 * 实战：`planForAppend` 的「已在列表则跳过」用 `list.filter(u => { for (…of pendingMods) if (id === …) …;
 *   for (…of items) … })`：现场 2,544 × (3,655 + 36,739) ≈ **1.03 亿次**比较，纯 CPU 阻塞 12,784ms。
 *   改成先把两侧收进 Set 再判定 ⇒ O(n+m)，实测 14ms（913×）。
 * 边界：只看**块体**回调（表达式回调无循环体）；只看真的套了 for 且做了 === 的。
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号集合
 */
export function nestedLinearScanLines(text = '') {
  const s = String(text || '');
  const out = new Set();
  const tokens = tokenize(s);
  const re = /\.(filter|find|some|every)\s*\(/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const paren = s.indexOf('(', m.index);
    const close = matchingParen(s, paren);
    if (close < 0) continue;
    const cb = s.slice(paren, close);
    if (!/\bfor\s*(?:await\s*)?\(/.test(cb)) continue;
    if (!cb.includes('===')) continue;
    const line = lineOf(s, m.index);
    if (inCommentOrString(tokens, line, m[0])) continue;
    out.add(line);
  }
  return out;
}

/**
 * astConfirmKind: "long-sync-loop" 的 **allow** 集合 ——
 * async 函数内的长同步循环：循环体 ≥2 个同步调用且整段无 `await` 让出点 ⇒ 占满事件循环。
 *
 * 实战：`finalizeHtmls` 逐目录做 existsSync/statSync/readFileSync + 写 HTML，全程同步 ⇒ 事件循环被
 *   占满 **74 秒**，期间 /api/* 全部 8 秒超时。修法：每 5 个目录 `await setImmediate` 让出一次
 *   （总耗时不变，服务保持可响应）。
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号集合
 */
export function longSyncLoopLines(text = '') {
  const s = String(text || '');
  const out = new Set();
  for (const f of collectFuncRanges(s)) {
    if (!/async/.test(s.slice(Math.max(0, f.a - 60), f.a))) continue;   // 只在 async 函数内（才有让出的可能）
    const body = s.slice(f.a, f.b);
    for (const [a, b] of collectLoopRanges(body)) {
      const inner = body.slice(a, b + 1);
      if ((inner.match(/Sync\s*\(/g) || []).length < 2) continue;
      if (/\bawait\b/.test(inner)) continue;                            // 已有让出点
      out.add(lineOf(s, f.a + a));
    }
  }
  return out;
}
