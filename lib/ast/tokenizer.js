// dsh-skip-func-length: tokenizeUncached 为纯线性解析主体（逐字符状态机），拆成多个函数会引入跨函数
//   共享的可变状态（行号/块注释状态/输出数组），反而更易出错、更难读；故整文件豁免函数长度检查。
/**
 * AST 实现层 · 分词器
 *
 * 职责：把源码切成 token 流（字符串/模板串/注释感知），并提供按文本内容的 LRU 缓存。
 * 本模块是全部 token 级检查的公共底座——其余 ast/ 模块都通过 tokenize() 取流。
 *
 * 自研 tokenizer 的原因：零第三方依赖；Node 无内置 JS AST，token 级已足够覆盖
 *   「注释/字符串里的内容不算代码」这类判定（逐行正则做不到）。
 */

/**
 * tokenize 结果缓存（2026-09-13 性能优化）。
 *
 * 动机：审计一个文件时，多条 AST 精筛规则（short-func-name / magic-number /
 * credential-value / small-file-read）会**各自独立**调用 tokenize，同一个文件
 * 被重复切词 5+ 次。实测 1255 行文件单次 tokenize 16ms，重复调用白浪费约 64ms/文件，
 * 在弱 CPU 机器 + 大仓库上直接表现为「提交推送卡住」。
 *
 * tokenize 是纯函数（同输入必得同输出）且调用方只读返回数组（无 push/splice/sort），
 * 因此可按文本内容缓存。用 Map（插入序 LRU）+ 上限淘汰，避免长驻进程内存无界增长。
 */
const TOKEN_CACHE = new Map();

/** tokenize 缓存条目上限（按文件数；单文件 token 量随行数增长，此值控制常驻上限）。 */
const TOKEN_CACHE_MAX = 512;

/**
 * 轻量 tokenizer：把文本切成 token 流，字符串/模板串/注释原样保留但标记类型。
 *
 * 结果按文本内容缓存（见 TOKEN_CACHE）：同一文件被多条规则重复切词时只算一次。
 * 返回的是**共享数组**——调用方只读，禁止原地修改（push/splice/sort）。
 *
 * @param {string} text 文件全文
 * @returns {Array<{type:string, value:string, line:number}>}
 * type: ident / punct / str / tmpl / comment / num / ws / other
 */
export function tokenize(text = '') {
  const key = String(text);
  const cached = TOKEN_CACHE.get(key);
  if (cached) {
    // LRU 触达：删后重插使其移到队尾（Map 保持插入序，队首即最久未用）
    TOKEN_CACHE.delete(key);
    TOKEN_CACHE.set(key, cached);
    return cached;
  }
  const tokens = tokenizeUncached(text);
  TOKEN_CACHE.set(key, tokens);
  if (TOKEN_CACHE.size > TOKEN_CACHE_MAX) {
    // 淘汰最久未用的一条（Map 首个键）
    const oldest = TOKEN_CACHE.keys().next();
    if (!oldest.done) TOKEN_CACHE.delete(oldest.value);
  }
  return tokens;
}

/** 清空 tokenize 缓存（测试/长驻进程内存回收用）。 */
export function clearTokenCache() {
  TOKEN_CACHE.clear();
}

/**
 * tokenize 的实际实现（不做缓存）。外部一律走 tokenize()。
 * @param {string} text 文件全文
 * @returns {Array<{type:string, value:string, line:number}>} token 流
 */
function tokenizeUncached(text = '') {
  const tokens = [];
  const lines = String(text).split('\n');
  let line = 1;
  // 块注释跨行状态（2026-09-13 修）：旧实现在**单行内**找 `*/`，多行块注释
  //   （JSDoc `/** ... */`）的续行 ` * 说明 +1` 会被当成代码 → ident/num token 泄漏，
  //   导致注释里的版本号/数字被魔数等规则误报。改为跨行携带 inBlock 状态。
  let inBlock = false;
  // Python 三引号字符串跨行状态（2026-10-05）：主循环按行 split，
  //   多行 docstring（"""…\n…"""）若按行独立 tokenize 会在换行处被切断成两个
  //   str + 中间内容被拆碎（数字/文本误报魔数/重复串）。跨行携带 tripleQuote
  //   状态：进入三引号后，后续行整行并入同一 str token，直到闭合三引号。
  let tripleQuote = '';
  let tripleBuf = '';
  for (const raw of lines) {
    const src = raw;
    let i = 0;
    const n = src.length;
    const push = (type, value) => tokens.push({ type, value, line });
    while (i < n) {
      const ch = src[i];
      const next = src[i + 1];
      // 三引号续行：整行剩余内容并入缓冲，直到找到闭合
      if (tripleQuote) {
        const end = src.indexOf(tripleQuote.repeat(3), i);
        if (end === -1) { tripleBuf += src.slice(i) + '\n'; i = n; break; }
        tripleBuf += src.slice(i, end);
        push('str', tripleQuote.repeat(3) + tripleBuf + tripleQuote.repeat(3));
        tripleQuote = ''; tripleBuf = '';
        i = end + 3;
        continue;
      }
      // 块注释续行：整行剩余内容都是注释（含 ` * xxx` 的星号续行）
      if (inBlock) {
        const end = src.indexOf('*/', i);
        if (end === -1) { push('comment', src.slice(i)); i = n; break; }
        push('comment', src.slice(i, end + 2));
        i = end + 2;
        inBlock = false;
        continue;
      }
      // 空白 / 行注释 / 块注释（跨行：本行找不到 `*/` 则整行剩余为注释并置 inBlock）
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '/' && next === '/') { push('comment', src.slice(i)); break; }
      // Python `#` 行注释（2026-10-05）：仅在**行首**（前面只可能有空白）识别——
      //   JS 类私有字段 `#foo` 不在行首，CSS 选择器不在此 tokenizer；行首 `#` 是
      //   Python 注释的确定形态（shebang `#!/usr/bin/env` 也算注释）。
      if (ch === '#' && /^\s*$/.test(src.slice(0, i))) { push('comment', src.slice(i)); break; }
      if (ch === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end === -1) { push('comment', src.slice(i)); inBlock = true; i = n; break; }
        const seg = src.slice(i, end + 2);
        push('comment', seg);
        i += seg.length;
        continue;
      }
      // 三引号开始（""" 或 '''，2026-10-05）：单行内闭合 → 整体消费为 str；
      //   跨行未闭合 → 设 tripleQuote 状态，整行及后续行并入缓冲
      if ((src.startsWith('"""', i) || src.startsWith("'''", i))) {
        const q = ch;
        const q3 = q.repeat(3);
        const end = src.indexOf(q3, i + 3);
        if (end === -1) {
          tripleQuote = q; tripleBuf = src.slice(i + 3) + '\n';
          i = n; break;
        }
        push('str', src.slice(i, end + 3));
        i = end + 3;
        continue;
      }
      // 字符串 / 模板字符串 / 正则 / 数字 / 标识符 / 运算符 —— 抽成独立消费函数
      const res = consumeLexeme(src, i, n, ch, next, tokens, push);
      if (res) { i = res; continue; }
      // 标点 / 其他（单字符）
      push('punct', ch);
      i++;
    }
    line++;
  }
  return tokens;
}

/** 多字符运算符（最长匹配优先，2026-09-13 修）：旧实现逐字符推送标点，导致
 *   `?.`（可选链）被切成 `?` + `.`、`??` 切成两个 `?`、`||` 切成两个 `|`
 *   → 圈复杂度把每个可选链当三元运算符（严重高估），而 `||`/`&&`/`??` 反而
 *   识别不到（漏报）。这里按长度降序匹配；**可选链 `?.` 与空值合并 `??`
 *   必须切成不同 token**——前者不产生独立执行路径（不是分支），后者是分支。 */
const MULTI_OPS = ['===', '!==', '**=', '<<=', '>>=', '...', '??=', '&&=', '||=', '?.', '??',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '::'];

/** 正则可接在哪些关键字后（return/typeof/case/in/of/new/delete/void/do/else/yield/await）。 */
const REGEX_AFTER_KEYWORD = /^(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await|instanceof)$/;

/**
 * 消费一个词素（字符串/模板/正则/数字/标识符/运算符）。由 tokenizeUncached 主循环分派。
 * 返回消费后的新 i；不匹配（纯标点）返回 0。
 * 拆出的原因（2026-10-05）：tokenizeUncached 圈复杂度 61（阈值 15）——逐字符状态机
 *   分支密集，全部内联在 while 里无法维护；按词素类型抽独立函数，主循环只做分派。
 */
function consumeLexeme(src, i, n, ch, next, tokens, push) { // dsh-skip-complexity: 词素分派器（六类词素分派分支为结构必然，拆分后职责单一）
  // 字符串（' "）——普通单引号字符串；三引号（""" '''）由主循环专门处理
  if (ch === '"' || ch === "'") return consumeString(src, i, n, ch, push);
  // 模板字符串（`）——嵌套 ${} 简化处理：遇未闭合 ` 归并到行尾
  if (ch === '`') return consumeTemplate(src, i, n, push);
  // 正则字面量（/…/flags）——2026-09-17 修：旧实现不识别正则，把 `/^\s*(?:x|y)/` 拆成
  //   `/` `^` `\` `s` `*` `(` `?` `:` `|` `)` 等标点，其中的 `(` `)` `{` `}` 直接参与
  //   括号平衡，导致 matchBrace 跑飞：单个 12 行函数被算成 242 行（func-lines 误报 blocker）。
  //   判别依据：`/` 出现在「表达式起始位置」才是正则——即上一个有意义 token 不是
  //   标识符/数字/字符串/`)`/`]`/`}`（那些后面跟的 `/` 是除号）。
  if (ch === '/' && next !== '/' && next !== '*') {
    const consumed = consumeRegex(src, i, n, tokens, push);
    if (consumed) return consumed;
  }
  // 数字
  if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
    let j = i;
    while (j < n && /[0-9._a-zA-Z]/.test(src[j])) j++;
    push('num', src.slice(i, j));
    return j;
  }
  // 标识符（含 $ _ 中文）
  if (/[A-Za-z_$\u4e00-\u9fa5]/.test(ch)) {
    let j = i;
    while (j < n && /[A-Za-z0-9_$\u4e00-\u9fa5]/.test(src[j])) j++;
    push('ident', src.slice(i, j));
    return j;
  }
  // 多字符运算符（最长匹配优先）
  for (const cand of MULTI_OPS) {
    if (src.startsWith(cand, i)) { push('punct', cand); return i + cand.length; }
  }
  return 0;
}

/** 字符串字面量（' "）——遇转义 \ 跳两字符；未闭合归并到行尾。 */
function consumeString(src, i, n, ch, push) {
  let j = i + 1;
  let str = ch;
  while (j < n) {
    if (src[j] === '\\') { str += src[j] + (src[j + 1] || ''); j += 2; continue; }
    str += src[j];
    if (src[j] === ch) { j++; break; }
    j++;
  }
  push('str', str);
  return j;
}

/** 模板字符串（`）——遇 \ 跳两字符；未闭合归并到行尾（简单 ${} 处理）。 */
function consumeTemplate(src, i, n, push) {
  let j = i + 1;
  let str = '`';
  while (j < n && src[j] !== '`') {
    if (src[j] === '\\') { str += src[j] + (src[j + 1] || ''); j += 2; continue; }
    str += src[j];
    j++;
  }
  if (j < n) { str += '`'; j++; }
  push('tmpl', str);
  return j;
}

/** 正则字面量（/…/flags）；`/` 前一 token 是值表达式时为除号，返回 0 交给标点处理。 */
function consumeRegex(src, i, n, tokens, push) { // dsh-skip-complexity: 正则状态机（转义/字符组/闭包三态，天然多分支）
  const prevTok = tokens.length ? tokens[tokens.length - 1] : null;
  const prevIsValue = prevTok && (
    prevTok.type === 'ident' || prevTok.type === 'num' || prevTok.type === 'str'
    || prevTok.type === 'tmpl' || prevTok.type === 'regex'
    || (prevTok.type === 'punct' && [')', ']', '}'].includes(prevTok.value))
  );
  // 关键字后（return/typeof/case/in/of/new/delete/void/do/else/yield/await）可接正则
  const afterKeyword = prevTok && prevTok.type === 'ident' && REGEX_AFTER_KEYWORD.test(prevTok.value);
  if (prevIsValue && !afterKeyword) return 0;
  let j = i + 1;
  let re = '/';
  let inClass = false;   // 字符组 [ ] 内的 `/` 不结束正则
  let closed = false;
  while (j < n) {
    const cj = src[j];
    if (cj === '\\') { re += cj + (src[j + 1] || ''); j += 2; continue; }
    if (cj === '\n') break;               // 正则不能跨行，未闭合则放弃
    if (cj === '[') inClass = true;
    else if (cj === ']') inClass = false;
    re += cj;
    if (cj === '/' && !inClass) { closed = true; j++; break; }
    j++;
  }
  if (!closed) return 0;
  // 跟随的 flags（g/i/m/s/u/y/d）
  while (j < n && /[gimsuy]/.test(src[j])) { re += src[j]; j++; }
  push('regex', re);
  return j;
}

