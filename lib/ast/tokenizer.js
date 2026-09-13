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
  for (const raw of lines) {
    const src = raw;
    let i = 0;
    const n = src.length;
    const push = (type, value) => tokens.push({ type, value, line });
    while (i < n) {
      const ch = src[i];
      const next = src[i + 1];
      // 块注释续行：整行剩余内容都是注释（含 ` * xxx` 的星号续行）
      if (inBlock) {
        const end = src.indexOf('*/', i);
        if (end === -1) { push('comment', src.slice(i)); i = n; break; }
        push('comment', src.slice(i, end + 2));
        i = end + 2;
        inBlock = false;
        continue;
      }
      // 空白
      if (/\s/.test(ch)) { i++; continue; }
      // 行注释
      if (ch === '/' && next === '/') { push('comment', src.slice(i)); break; }
      // 块注释（跨行：本行找不到 `*/` 则整行剩余为注释并置 inBlock）
      if (ch === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end === -1) { push('comment', src.slice(i)); inBlock = true; i = n; break; }
        const seg = src.slice(i, end + 2);
        push('comment', seg);
        i += seg.length;
        continue;
      }
      // 字符串（' "）
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        let str = ch;
        while (j < n) {
          if (src[j] === '\\') { str += src[j] + (src[j + 1] || ''); j += 2; continue; }
          str += src[j];
          if (src[j] === ch) { j++; break; }
          j++;
        }
        push('str', str);
        i = j;
        continue;
      }
      // 模板字符串（`）——嵌套 ${} 简化处理：遇未闭合 ` 归并到行尾
      if (ch === '`') {
        let j = i + 1;
        let str = ch;
        while (j < n && src[j] !== '`') {
          if (src[j] === '\\') { str += src[j] + (src[j + 1] || ''); j += 2; continue; }
          str += src[j];
          j++;
        }
        if (j < n) { str += '`'; j++; }
        push('tmpl', str);
        i = j;
        continue;
      }
      // 数字
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
        let j = i;
        while (j < n && /[0-9._a-zA-Z]/.test(src[j])) j++;
        push('num', src.slice(i, j));
        i = j;
        continue;
      }
      // 标识符（含 $ _ 中文）
      if (/[A-Za-z_$\u4e00-\u9fa5]/.test(ch)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$\u4e00-\u9fa5]/.test(src[j])) j++;
        push('ident', src.slice(i, j));
        i = j;
        continue;
      }
      // 多字符运算符（最长匹配优先，2026-09-13 修）：旧实现逐字符推送标点，导致
      //   `?.`（可选链）被切成 `?` + `.`、`??` 切成两个 `?`、`||` 切成两个 `|`
      //   → 圈复杂度把每个可选链当三元运算符（严重高估），而 `||`/`&&`/`??` 反而
      //   识别不到（漏报）。这里按长度降序匹配；**可选链 `?.` 与空值合并 `??`
      //   必须切成不同 token**——前者不产生独立执行路径（不是分支），后者是分支。
      const MULTI_OPS = ['===', '!==', '**=', '<<=', '>>=', '...', '??=', '&&=', '||=', '?.', '??',
        '=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '::'];
      let op = null;
      for (const cand of MULTI_OPS) {
        if (src.startsWith(cand, i)) { op = cand; break; }
      }
      if (op) {
        push('punct', op);
        i += op.length;
        continue;
      }
      // 标点 / 其他（单字符）
      push('punct', ch);
      i++;
    }
    line++;
  }
  return tokens;
}
