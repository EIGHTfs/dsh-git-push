// dsh-skip-func-length: 检查器主体为纯解析函数（tokenize/checkSyncFs），长而线性，拆分反损可读性
/**
 * dsh-git-push 评分总入口：AST(token) 级质量检查器（具体实现层）
 *
 * 三层职责：① 规则声明在 lib/audit-rules/*.yml（阈值/豁免清单/上下文关键字）
 *          ② 具体实现在本文件（token 级解析：字符串/模板串/注释感知）
 *          ③ 调用包装在 lib/audit/checks.js（把命中转成 finding，不重复造逻辑）
 * 新增/修改检查逻辑一律写在本文件，不要在 checks.js 里用正则重新实现一遍。
 *
 * 修逐行正则的假阴性（0.1.5）：
 *   1) sync-fs named import：只认 fs.*Sync 前缀，import { readFileSync } 后直调漏检
 *   2) empty-catch 多行：只看 catch 行+下一行，多行空块漏检
 *   3) func-lines 超长坏样本：行数启发式对单行海量语句漏检（checks.js 已补）
 *
 * 实现：轻量 tokenizer（字符串/模板串/注释感知）→ 括号平衡区间 → 判定。
 * 零第三方依赖（Node 无内置 JS AST，token 级足够覆盖上述三类）。
 * token 化的额外收益（硬编码魔数检测）：注释里的版本号（// v1.8.0）、字符串里的
 * CSS 字号、i18n 字典值都不是 num token，天然不进入数字字面量检查——从根上消除误报。
 */
const SYNC_FS_FNS = new Set([
  'readFileSync', 'writeFileSync', 'readdirSync', 'existsSync', 'statSync', 'mkdirSync',
  'rmSync', 'unlinkSync', 'readlinkSync', 'lstatSync', 'renameSync', 'copyFileSync', 'appendFileSync',
]);

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

/** 括号平衡扫描：从 startIdx 的 '{' 找匹配 '}'，返回 [openIdx, closeIdx] 或 null。 */
function matchBrace(tokens, openIdx) {
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
 * 检查 async 路径中的 fs 同步调用（AST 级，修 named import 假阴性）。
 * @param {string} text 文件全文
 * @returns {Array<{line:number, call:string, via:string}>} via: 'named-import' | 'fs-prefix'
 */
export function checkSyncFs(text = '') {
  const tokens = tokenize(text);
  // 1) 收集 named import 的 fs 同步函数：import { readFileSync, X } from 'node:fs'
  const namedSync = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type === 'ident' && tokens[i].value === 'import'
      && tokens[i + 1].type === 'punct' && tokens[i + 1].value === '{') {
      let j = i + 2;
      const names = [];
      while (j < tokens.length && !(tokens[j].type === 'punct' && tokens[j].value === '}')) {
        if (tokens[j].type === 'ident') names.push(tokens[j].value);
        j++;
      }
      // 找 from 'node:fs' / 'fs'
      let k = j + 1;
      let from = '';
      while (k < tokens.length && k < j + 8) {
        if (tokens[k].type === 'ident' && tokens[k].value === 'from') {
          const strTok = tokens[k + 1];
          if (strTok && strTok.type === 'str') {
            from = strTok.value.replace(/['"]/g, '');
            if (/^(node:)?fs$/.test(from)) {
              for (const nm of names) if (SYNC_FS_FNS.has(nm)) namedSync.add(nm);
            }
          }
          break;
        }
        k++;
      }
      i = j;
    }
  }
  // 2) 定位所有 async 函数边界（async function / async X( / async (）
  const asyncRanges = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ident' && t.value === 'async') {
      // 向后找函数体 '{'（跳过函数名/参数，限 20 token）
      for (let j = i + 1; j < Math.min(tokens.length, i + 20); j++) {
        const tj = tokens[j];
        if (tj.type === 'punct' && tj.value === '{') {
          const range = matchBrace(tokens, j);
          if (range) asyncRanges.push([tokens[j].line, tokens[range[1]].line, j, range[1]]);
          break;
        }
        if (tj.type === 'punct' && (tj.value === ';' || tj.value === '}')) break;
      }
    }
  }
  // 3) 找同步调用：named 直调 或 fs.XSync( 前缀
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    let call = '';
    let via = '';
    if (namedSync.has(t.value)) {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'punct' && nx.value === '(') { call = t.value; via = 'named-import'; }
    } else if (t.value === 'fs') {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'punct' && nx.value === '.') {
        const nn = tokens[i + 2];
        if (nn && nn.type === 'ident' && SYNC_FS_FNS.has(nn.value)) {
          const after = tokens[i + 3];
          if (after && after.type === 'punct' && after.value === '(') { call = nn.value; via = 'fs-prefix'; }
        }
      }
    }
    if (!call) continue;
    // 判定是否在 async 函数区间内（token 索引区间）
    const inAsync = asyncRanges.some(([, , oi, ci]) => i > oi && i < ci);
    if (inAsync) out.push({ line: t.line, call, via });
  }
  return out;
}

/**
 * 检查静默吞错 catch（AST 级，括号平衡 → 块内去注释/空白后为空即报）。
 * @param {string} text 文件全文
 * @returns {Array<{line:number}>}
 */
export function checkEmptyCatchAst(text = '') {
  const tokens = tokenize(text);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'catch') continue;
    // 找 catch 后的 '{'（跳过 (param) 与空白，限 10 token）
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 10); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') { openIdx = j; break; }
      if (tj.type === 'punct' && tj.value === '}') break; // catch (e) 无块 → 不是本类
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    const [, closeIdx] = range;
    // 块内判定：有实质语句 → 正常；仅有说明性注释 → 视为「已说明的静默」（不算问题）；
    // 真正空块（无语句也无注释）→ 报问题（静默吞错且无任何交代）。
    let hasBody = false;
    let hasNote = false;
    for (let k = openIdx + 1; k < closeIdx; k++) {
      const tk = tokens[k];
      if (tk.type === 'ws') continue;
      if (tk.type === 'comment') {
        // 2026-09-13 修：注释「交代了原因」即算已说明——不再只看说明词表。
        //   旧逻辑只认词表（跳过/忽略/…），「/* 无缓存/损坏则空 */」「预热失败不影响
        //   主链路」这类**实质说明了为什么静默**的注释会误报（它们是好的静默）。
        //   判定：去空白后长度 ≥ 4 且不只含单个标识符（`// e` 这种占位不算交代）。
        //   词表语义保留为兜底（含说明词但很短也认）。
        const noteText = String(tk.value || '').replace(/[/*\s]/g, '');
        if (/跳过|忽略|已断开|不抛|按空|不阻断|无需|降级|兜底|视为|不回滚|非\s*JSON|raw|空仓|best-effort/i.test(tk.value || '')
          || (noteText.length >= 4 && !/^[a-zA-Z_$][\w$]*$/.test(noteText))) hasNote = true;
        continue;
      }
      hasBody = true;
      break;
    }
    if (!hasBody && !hasNote) out.push({ line: t.line });
  }
  return out;
}

/**
 * 检查单函数超长（AST 级：括号平衡精确统计函数体行数）。
 * @param {string} text 文件全文
 * @param {{warn?: number, block?: number}} [opts]
 * @returns {Array<{line:number, len:number, level:'warning'|'blocker'}>}
 */
export function checkFuncLinesAst(text = '', { warn = 50, block = 100 } = {}) {
  const tokens = tokenize(text);
  const out = [];
  const fnStart = new Set(['function']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !fnStart.has(t.value)) continue;
    // function 关键字后找 '{'（限 20 token：name( params ) {）
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 20); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') { openIdx = j; break; }
      if (tj.type === 'punct' && tj.value === ';') break;
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    const startLine = tokens[openIdx].line;
    const endLine = tokens[range[1]].line;
    const len = endLine - startLine + 1;
    if (len > warn) {
      out.push({ line: startLine, len, level: len > block ? 'blocker' : 'warning' });
    }
    i = range[1];
  }
  return out;
}

/**
 * 检查函数/变量命名长度不足（min-length kind，AST 级）。
 * 覆盖：function 声明名的长度、参数名单字母、变量声明名单字母。
 * @param {string} text 文件全文
 * @param {object} [opts] { min=2, allow=['i','j','k','x','y','z','e','_','$','a','b','n','p','s','v','f','t','r','id','ok','db','fs','os','el','cb','err','req','res','ctx','args' } }
 * @returns {Array<{line:number, name:string, type:string}>}
 */
export function checkNameLengthAst(text = '', { min = 2, allow = [] } = {}) {
  const tokens = tokenize(text);
  const out = [];
  const allowSet = new Set(['i', 'j', 'k', 'x', 'y', 'z', 'e', '_', '$', 'a', 'b', 'n', 'p', 's', 'v', 'f', 't', 'r',
    'id', 'ok', 'db', 'fs', 'os', 'el', 'cb', 'err', 'req', 'res', 'ctx', 'args', 'key', 'val', 'fn', 'ns', ...allow,
    // 2026-09-13：i18n/字典领域标准缩写——tr/L 是翻译与字典加载的通用命名（对标
    //   react-i18next 的 t、i18n 字典 dict），不是「无法猜出含义」的缩写。
    'tr', 'L', 'i18n', 'dict', 'locale']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // 函数声明：function 后的 ident
    if (t.type === 'ident' && t.value === 'function') {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'ident' && nx.value.length < min && !allowSet.has(nx.value)) {
        out.push({ line: nx.line, name: nx.value, type: 'function' });
      }
      continue;
    }
    // 变量声明：const/let/var 后的 ident
    if (t.type === 'ident' && ['const', 'let', 'var'].includes(t.value)) {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'ident' && nx.value.length < min && !allowSet.has(nx.value)) {
        out.push({ line: nx.line, name: nx.value, type: 'variable' });
      }
    }
  }
  return out;
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
function collectInnerFnRanges(tokens, from, to) {
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

export function checkComplexityAst(text = '', { warn = 10, block = 20 } = {}) {
  const tokens = tokenize(text);
  const out = [];
  const branch = new Set(['if', 'for', 'while', 'case', 'catch', 'do']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'function') continue;
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 20); j++) {
      if (tokens[j].type === 'punct' && tokens[j].value === '{') { openIdx = j; break; }
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    // 2026-09-13 修：嵌套函数的复杂度**不得累加到外层**（旧实现整段计入，导致
    //   只要函数里定义了几个带分支的内部函数，外层就被虚报成高复杂度——如
    //   makeTitleResolver 自身仅 2 个 catch + 2 个 ??，却被报 29）。
    //   做法：先收集内层函数体的 token 区间，扫外层时跳过这些区间；内层自身
    //   由后续迭代单独评估（不再 i = range[1] 整体跳过，否则内层永远扫不到）。
    const innerRanges = collectInnerFnRanges(tokens, openIdx + 1, range[1]);
    const inInner = (k) => innerRanges.some(([a, b]) => k >= a && k < b);
    let cx = 1;
    for (let k = openIdx + 1; k < range[1]; k++) {
      if (inInner(k)) continue;
      const tk = tokens[k];
      if (tk.type === 'comment') continue;
      if (tk.type === 'ident' && branch.has(tk.value)) cx++;
      // 分支点：逻辑与/或、空值合并、三元问号。**排除可选链 `?.`**——它是空值保护，
      //   不产生独立执行路径（2026-09-13 修：多字符 token 化后 `?.` 是独立 token，
      //   不再被误认成三元 `?`）。
      if (tk.type === 'punct' && ['&&', '||', '??', '?'].includes(tk.value)) cx++;
    }
    if (cx > warn) {
      const nx = tokens[i + 1];
      out.push({ line: tokens[openIdx].line, name: nx?.type === 'ident' ? nx.value : '(匿名)', complexity: cx, level: cx > block ? 'blocker' : 'warning' });
    }
    // 不跳过内部：继续迭代把内层函数也评估掉（i 只前进到本函数声明之后）
    i = openIdx;
  }
  return out;
}

/**
 * 检查嵌套深度（max-depth kind，AST 级）。
 * 统计函数体内「控制流块」最大嵌套层数（if/for/while/try/switch 等）。
 *
 * 2026-09-13 修 bug：旧实现把所有 `{` 都计入深度，**对象字面量/解构/JSON 结构**
 *   被当成嵌套层级——`return { version: 2, skills: {}, sessions: {} }` 会被报
 *   depth=4，`try { ... } catch { return {...} }`（真实深度 2）也被报 depth=4，
 *   造成大面积误报（一个仓库 19 条）。
 * 现只统计「块语句」大括号：仅当 `{` 跟着控制流关键字或函数体时才算一层；
 *   对象字面量（`{` 前是 `=`/`(`/`return`/`,`/`:`/`[` 等值位置）不计入。
 * 块级关键字（计入）：if / else / for / while / do / try / catch / finally / switch / function / =>。
 * @param {string} text 文件全文
 * @param {object} [opts] { warn=4, block=6 }
 * @returns {Array<{line:number, depth:number, level:string}>}
 */
export function checkNestingDepthAst(text = '', { warn = 4, block = 6 } = {}) {
  const tokens = tokenize(text);
  const out = [];
  // 进入块的前置关键字（`if (...) {`、`else {`、`try {`、`=> {` 等）
  const BLOCK_KW = new Set(['if', 'else', 'for', 'while', 'do', 'try', 'catch', 'finally', 'switch', 'function']);
  // 统计每个 `{` 是否属于块语句（与 token 下标对齐）
  const isBlockBrace = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.type === 'punct' && t.value === '{')) continue;
    // 向前找最近的有意义 token：若是 `)` → 可能 if/for/while/function 的参数尾（块）
    //   或箭头函数参数尾（块）；若直接是 BLOCK_KW/fn 关键字 → 块；
    //   若是 `=>` → 箭头函数体（块）；若是 `else`/`do`/`try`/`finally` → 块；
    //   其余（`=` `(` `,` `:` `[` `return` `=>` 之外的值位置）→ 对象字面量，不计。
    let prev = null;
    for (let j = i - 1; j >= 0; j--) {
      const tj = tokens[j];
      if (tj.type === 'ws' || tj.type === 'comment') continue;
      prev = tj;
      break;
    }
    let isBlock = false;
    if (prev) {
      if (prev.type === 'ident' && BLOCK_KW.has(prev.value)) isBlock = true;      // if (...) / else ...? 见下
      else if (prev.type === 'punct' && prev.value === '=>') isBlock = true;      // () => {
      else if (prev.type === 'punct' && prev.value === ')') {
        // `)` 前是 BLOCK_KW 或函数名 → 块语句/函数体；否则可能是调用参数里传对象
        let before = null;
        for (let j = tokens.indexOf(prev) - 1; j >= 0; j--) {
          const tj = tokens[j];
          if (tj.type === 'ws' || tj.type === 'comment') continue;
          before = tj;
          break;
        }
        isBlock = isBlockParen(tokens, prev) || (before && before.type === 'ident' && before.value === 'function');
      }
    }
    isBlockBrace.set(i, isBlock);
  }
  let depth = 0;
  let maxDepth = 0;
  let maxLine = 1;
  let fnStartLine = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ident' && t.value === 'function') fnStartLine = t.line;
    if (t.type === 'punct' && t.value === '{') {
      if (isBlockBrace.get(i)) {
        depth++;
        if (depth > maxDepth) { maxDepth = depth; maxLine = t.line; }
      }
    } else if (t.type === 'punct' && t.value === '}') {
      // 只有块大括号才减（对象字面量的 `}` 不影响）
      if (isBlockBrace.get(matchingOpen(tokens, i))) {
        depth--;
        if (depth === 0 && maxDepth > warn) {
          out.push({ line: fnStartLine || maxLine, depth: maxDepth, level: maxDepth > block ? 'blocker' : 'warning' });
        }
        if (depth <= 0) { depth = 0; maxDepth = 0; }
      }
    }
  }
  return out;
}

/**
 * 判断 `)` 是否属于控制流/函数签名的参数表尾（即其后 `{` 是块语句）。
 * 从 `)` 向前做括号配对找起始 `(`，再看 `(` 前一个 token：
 *   if/for/while/switch/catch/function/标识符（函数声明/表达式/方法名） → 是块语句头。
 * @param {Array} tokens token 流
 * @param {object} closeTok `)` token
 * @returns {boolean}
 */
function isBlockParen(tokens, closeTok) {
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
function matchingOpen(tokens, closeIdx) {
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
 * 判定「全量读入文件」是否属于**受控小文件**读取（memory-bomb 精筛，AST 级）。
 *
 * 规则语义：`fs.readFile(...)` 命中即报对「读本地小 JSON 配置/数据」的项目恒定误报。
 * 内存爆炸的真实风险在「读未知大小的大文件」；而读记分数据、标题缓存这类受控小文件
 * （通常紧跟 JSON.parse、或路径变量名含 data/cache/config/locale/store）不构成风险。
 *
 * 判定（满足任一即视为受控小文件读取 → 不报）：
 *   ① 同一行（或紧邻下一行）出现 JSON.parse —— 读 JSON 数据结构化的标准写法；
 *   ② 读取调用前后 6 个 token 内出现小文件语义标识符（data/cache/config/locale/settings/store/state）。
 *
 * @param {string} text 文件全文
 * @returns {Set<number>} 受控小文件读取的行号集合（这些行应从 memory-bomb 命中中剔除）
 */
export function checkSmallFileReadAst(text = '') {
  const tokens = tokenize(text);
  const out = new Set();
  const SMALL_HINTS = /(data|cache|config|locale|settings|store|state|manifest|package)/i;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // 找 readFile / readFileSync 调用
    if (!(t.type === 'ident' && /^readFile(Sync)?$/.test(t.value))) continue;
    // 邻近 token 文本（前后各 8 个）作为上下文
    const before = tokens.slice(Math.max(0, i - 8), i).map((x) => x.value).join(' ');
    const after = tokens.slice(i + 1, i + 9).map((x) => x.value).join(' ');
    const ctx = `${before} ${after}`;
    // 行级窗口：读入后常在下一行 JSON.parse（如 `const raw = await fs.readFile(f)` +
    //   `return migrate(JSON.parse(raw))`），token 窗口不够，按源码行扩到 ±3 行。
    const srcLines = String(text).split('\n');
    const lineWindow = srcLines.slice(Math.max(0, t.line - 4), t.line + 3).join(' ');
    // ① 同语句/邻近行里出现 JSON.parse（读 JSON 数据）
    if (/JSON\s*\.\s*parse/.test(ctx) || /JSON\s*\.\s*parse/.test(lineWindow)) { out.add(t.line); continue; }
    // ② 上下文含小文件语义标识符
    if (SMALL_HINTS.test(before) || SMALL_HINTS.test(after) || SMALL_HINTS.test(lineWindow)) { out.add(t.line); continue; }
    // ③ 变量名/参数名为 file/raw 且同语句有 JSON 语义 —— 保守起见不豁免
  }
  return out;
}


/**
 * 检查函数名过短（function-name-too-short kind，AST 级，正则初筛后的精筛）。
 *
 * 与纯正则的差别：正则 `function\s+[A-Za-z_$][\w$]{0,1}\s*\(` 命中即报，会把
 * **i18n 领域标准缩写**（tr = translate、t、L = locale dict）当「无法猜出含义的缩写」
 * 误报。本实现按 token 定位 function 声明后的函数名，长度 ≤ max 且**不在公认缩写
 * 白名单**里才报。
 *
 * @param {string} text 文件全文
 * @param {{max?: number, allow?: string[]}} [opts] max 默认 2；allow 追加白名单
 * @returns {Array<{line:number, name:string}>} 命中列表
 */
export function checkShortFunctionNameAst(text = '', { max = 2, allow = [] } = {}) {
  const tokens = tokenize(text);
  const out = [];
  // 长度 ≤2 但有公认语义的缩写（不报）：i18n 的 tr/t、字典 L、常见工具名
  const ALLOW = new Set(['tr', 't', 'r', 'L', 'i18n', 'db', 'fs', 'os', 'el', 'cb', 'fn', 'ns',
    'id', 'ok', 'kv', 'ui', 'js', 'ts', 'is', 'to', 'of', 'in', 'no', 'op', 'up', 'un',
    'i', 'j', 'k', 'x', 'y', 'z', 'e', 'a', 'b', 'n', 'p', 's', 'v', 'f', ...allow]);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.type === 'ident' && t.value === 'function')) continue;
    const nx = tokens[i + 1];
    if (!nx || nx.type !== 'ident') continue;
    if (nx.value.length <= max && !ALLOW.has(nx.value)) out.push({ line: nx.line, name: nx.value });
  }
  return out;
}

/**
 * 检查文件行数（max-lines kind）。
 * @param {string} text 文件全文
 * @param {object} [opts] { warn=500, block=1000 }
 * @returns {{lines:number, level:string|null}}
 */
export function checkFileLines(text = '', { warn = 500, block = 1000 } = {}) {
  const lines = String(text).split('\n').length;
  if (lines <= warn) return { lines, level: null };
  return { lines, level: lines > block ? 'blocker' : 'warning' };
}

/**
 * 检查重复出现的硬编码字符串/模板串（repeated-string / min-occurrences kind）。
 * 数值字面量（num）不参与统计——版本号/端口/阈值等数字重复属正常，
 * 按「硬编码文本」报会造成大面积噪音（如 README 里的 10/15）。
 * @param {string} text 文件全文
 * @param {object} [opts] { min=3, ignore=['', ' ', '\\n', '-', '/', '0', '1'] }
 * @returns {Array<{line:number, value:string, count:number}>}
 */
export function checkRepeatedStringsAst(text = '', { min = 3, ignore = [] } = {}) {
  const tokens = tokenize(text);
  // tokenizer 产出的字面量类型名是 str / tmpl / num（非 string/number）；
  // 类型名不匹配会让本检查永不命中，故按实际类型名收集；num 刻意排除（见上）
  const LITERAL_TYPES = new Set(['str', 'tmpl']);
  const ignoreSet = new Set(['', ' ', '\n', '-', '/', '0', '1', 'utf8', 'string', 'number', 'boolean', 'object', 'function', ...ignore]);
  const counts = new Map();
  for (const t of tokens) {
    if (!LITERAL_TYPES.has(t.type)) continue;
    // 去掉字面量外层引号（'' "" ``），计数与展示都用裸值
    const v = String(t.value).replace(/^(['"`])([\s\S]*)\1$/, '$2');
    if (ignoreSet.has(v) || v.length < 4) continue;
    // ① 纯标识符形状（含下划线）：kind 名/分派词（credential-ref、code_audit 等），重复属正常
    if (/^[a-z0-9][a-z0-9_-]{0,19}$/i.test(v)) continue;
    // ①b dotfile 名（.git/.dsh/.env 等）：路径/目录域名词汇，重复属正常
    if (/^\.[a-z0-9_-]{1,16}$/i.test(v)) continue;
    // ② 短期望词（2-4 个汉字）：可读性/可维护性/安全性 等维度名，重复属正常
    if (/^[\u4e00-\u9fff]{2,4}$/.test(v)) continue;
    // ③ 无值型特征（不含 ./:\ 空格/CJK）的短串：\n、-c、-q、[FUNC] 属控制串/标志，不报
    //    值型特征 = 含 路径分隔/点/冒号/反斜杠/空白/CJK —— 才像"硬编码值"
    if (!/[\s./:\\\u4e00-\u9fff]/.test(v)) continue;
    if (!counts.has(v)) counts.set(v, { value: v, count: 0, line: t.line });
    counts.get(v).count++;
  }
  return [...counts.values()].filter((x) => x.count >= min);
}

/* ───────────────────────── 正则初筛 → AST 精筛（通用设施） ───────────────────────── */

/**
 * 正则初筛 → token 级精筛（所有文本型检查的通用两段式）。
 *
 * 为什么两段式：正则快、能一次筛出候选行；但正则无法区分「代码」与「注释/字符串」，
 * 单用必然误报（注释版本号、CSS 字号、i18n 字典值）。tokenizer 能精确分类，但全量
 * token 化成本高于正则。两段式 = 正则初筛候选行 → 只对候选行做 token 判定。
 *
 * @param {string} text 文件全文
 * @param {number[]} candidateLines 正则初筛命中的行号（1-based）
 * @returns {{isCode: (line:number)=>boolean}} isCode(line) 判定该行是否含「代码 token」
 *   （注释/字符串/模板串/纯空白行 → false；含 ident/num/punct 的行 → true）
 */
export function makeCodeLineFilter(text = '', candidateLines = []) {
  const want = new Set(candidateLines);
  const codeLines = new Set();
  const suspect = new Set();
  for (const t of tokenize(text)) {
    if (!want.has(t.line)) continue;
    if (t.type === 'ident' || t.type === 'num') codeLines.add(t.line);
    if (t.type === 'punct') suspect.add(t.line);
  }
  for (const l of suspect) {
    // 只有标点（如 `}` `);`）不算代码行，需同时有 ident/num
    if (!codeLines.has(l)) codeLines.delete(l);
  }
  return {
    isCode: (line) => codeLines.has(line),
  };
}

/**
 * 判定一组字符串字面量值是否出现在代码里（供「重复硬编码串」等规则精筛）。
 * @param {string} text 文件全文
 * @returns {Set<string>} 代码中出现的字符串字面量裸值集合
 */
export function codeStringLiterals(text = '') {
  const out = new Set();
  for (const t of tokenize(text)) {
    if (t.type !== 'str' && t.type !== 'tmpl') continue;
    out.add(String(t.value).replace(/^(['"`])([\s\S]*)\1$/, '$2'));
  }
  return out;
}

/* ───────────────────────── 硬编码魔数检测（token 级，版本号豁免版） ───────────────────────── */

/** HTTP 常见状态码（魔数豁免清单：status/http 上下文里出现即豁免）。 */
const HTTP_STATUS_CODES = new Set([100, 101, 102, 103, 200, 201, 202, 203, 204, 205, 206, 207, 208, 226,
  300, 301, 302, 303, 304, 305, 307, 308, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410,
  411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
  500, 501, 502, 503, 504]);

/** 公认合法常量（进制/时间/容量等，无魔数上下文时豁免）。 */
const COMMON_NUM_CONSTANTS = new Set(['0', '1', '-1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '16',
  '24', '30', '31', '32', '60', '100', '128', '256', '365', '512', '1000', '1024', '2048', '3600', '4096', '86400', '65535']);

const DEFAULT_MAGIC_HINTS = ['timeout', 'retry', 'max', 'min', 'limit', 'size', 'count', 'port',
  'interval', 'delay', 'duration', 'threshold', 'buffer', 'chunk'];

const DEFAULT_LEGIT_HINTS = ['version', 'date', 'year', 'month', 'day', 'hour', 'minute', 'second', 'http', 'status'];

/**
 * 硬编码魔数检测（token 级，版本号豁免版）。
 *
 * 为什么是 token 级：逐行正则无法区分「代码里的数字」与「注释/字符串里的数字」——
 * 注释里的版本号（`// v1.8.0：数据升级`）、CSS 字号（'.x{font-weight:650}'）、
 * i18n 字典值都会误报。tokenizer 已把注释/字符串/模板串分类成独立 token 类型，
 * 只对 num token（真正的数字字面量）判定，从根上消除上述误报，无需任何「跳过行」补丁。
 *
 * 检测：num token 且形态为 ≥2 位整数 / 小数 / 十六进制（单数字与 0/1 边界天然不参与）。
 * 豁免（任一命中即不报）：
 *   · 公认合法常量（0/1/60/100/1000/1024/3600/86400 等），除非处于魔数上下文；
 *   · legit 上下文（version/date/year/month/day/hour/minute/second/http/status 词邻近）；
 *   · HTTP 状态码 + status/http 上下文；
 *   · 字符串/注释里的数字（tokenizer 层面即非 num，天然不进入检测）。
 * 强制报：邻近 token 命中魔数上下文（timeout/retry/max/min/limit/size/count/port/interval/
 *   delay/duration/threshold/buffer/chunk），或同一数字文件内出现 ≥ forceCount 次。
 *
 * @param {string} text 文件全文
 * @param {{magicHints?:string[], legitHints?:string[], forceCount?:number}} [opts]
 * @returns {Array<{line:number, raw:string, num:string, count:number, magicCtx:boolean}>}
 */
export function checkMagicNumberSmartAst(text = '', {
  magicHints = DEFAULT_MAGIC_HINTS, legitHints = DEFAULT_LEGIT_HINTS, forceCount = 3,
} = {}) {
  const tokens = tokenize(text);
  const hintTest = (hints) => {
    const res = hints.map((h) => new RegExp(`(^|[^a-z])${h}`, 'i'));
    return (ctx) => res.some((r) => r.test(ctx));
  };
  const isMagicCtx = hintTest(magicHints);
  const isLegitCtx = hintTest(legitHints);
  const hits = [];
  const counts = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'num') continue; // 注释/字符串/tmpl token 天然排除——本检查只认代码里的数字字面量
    const raw = String(t.value);
    const norm = raw.replace(/_/g, '').replace(/n$/, ''); // 60_000 → 60000、10n → 10
    if (!/^(?:0[xX][0-9a-fA-F]+|\d{2,}(?:\.\d+)?|\d+\.\d+)$/.test(norm)) continue; // 单数字不参与
    const numeric = /^0[xX]/.test(norm) ? parseInt(norm, 16) : Number(norm);
    if (!Number.isFinite(numeric)) continue;
    // 上下文 = 邻近 token 文本（前置 6 个看命名，后置 4 个看单位/参数位）
    const before = tokens.slice(Math.max(0, i - 6), i).map((x) => x.value).join(' ');
    const after = tokens.slice(i + 1, i + 5).map((x) => x.value).join(' ');
    const ctx = `${before} ${after}`;
    const magicCtx = isMagicCtx(before) || isMagicCtx(ctx);
    const legitCtx = isLegitCtx(ctx);
    // ── 2026-09-13 四类豁免（修 scoreboard 误报；规格表：版本号/日期/HTTP 状态码/
    //    常见合法常量自动豁免，无上下文裸数字仍报）──
    // ① 命名常量定义值：`const NAME = <数字>` / `const NAME = [<数字>, ...]`——
    //    数字就是该常量的定义值，报「建议提取为命名常量」自相矛盾
    //    （PAGE_SIZES = [10, 20, 50]、API_ROW_LIMIT = 200、TTL_MS = 5 * 60_000）。
    if (isNamedConstantValue(tokens, i)) continue;
    // ② HTTP 状态码：数字 ∈ HTTP_STATUS_CODES 且非魔数上下文即豁免——
    //    sendJson(res, 405, ...) 的 405、const code = 500 的 500 都是状态码不是魔数；
    //    不要求实参位置（状态码赋值给 code/status 类变量同样豁免）。
    if (!magicCtx && HTTP_STATUS_CODES.has(numeric)) continue;
    // ③ 函数参数默认值：`(e, max = 120)` —— 参数名 max 已说明含义，默认值不是硬编码
    if (/[,(]\s*[a-zA-Z_$][\w$]*\s*=\s*$/.test(before)) continue;
    // ④ 常见合法常量（1024/3600/86400 等进制、时间、容量单位）即使处于魔数上下文也豁免
    //    ——8 * 1024 * 1024 是 8MB 的容量表达，1024 是单位不是魔数。
    if (COMMON_NUM_CONSTANTS.has(norm)) continue;
    if (!magicCtx && legitCtx) continue;
    if (!magicCtx && HTTP_STATUS_CODES.has(numeric) && /status|http/i.test(ctx)) continue;
    counts.set(norm, (counts.get(norm) || 0) + 1);
    hits.push({ line: t.line, raw, num: norm, magicCtx });
  }
  // 输出：同一数字只报首次出现的行。
  // 2026-09-13 修：旧逻辑「count>=forceCount 或 magicCtx 才报」会把「单次出现且无
  //   魔数上下文的裸数字」过滤掉——规格表 ❌ 项（const x = 1.2 / if (score > 1.5) /
  //   const ratio = 1.2）全是这种情况，应报。豁免已在上面四类（命名常量值/HTTP 状态码
  //   实参/参数默认值/常见合法常量）处理完，能走到这里的数字就是该报的魔数；
  //   count 与 magicCtx 仅作 message 信息（forceCount 语义并入 message）。
  const out = [];
  const reported = new Set();
  for (const h of hits) {
    if (reported.has(h.num)) continue;
    reported.add(h.num);
    out.push({ line: h.line, raw: h.raw, num: h.num, count: counts.get(h.num) || 1, magicCtx: h.magicCtx });
  }
  return out;
}

/**
 * 判定数字 token 是否为「命名常量定义值」：向前看是否有 `const/let/var NAME = ` 模式
 * （NAME 为大写常量名或含 version/date 语义），数组字面量 [10, 20, 50] 内同样算。
 * 规则本意是「把散落的数字提取为命名常量」——数字已经是命名常量的定义值时不报。
 * @param {Array} tokens token 流
 * @param {number} numIdx 数字 token 下标
 * @returns {boolean}
 */
function isNamedConstantValue(tokens, numIdx) {
  // 从数字往回：先跳过「值表达式」部分——运算符（* / + - %）、其他数字、数组分隔符
  // （[ ] ,）都属于赋值右侧表达式；然后找 `=`，`=` 前一个标识符是常量名，
  // 再前一个是 const/let/var。命中 `const NAME = <expr>` 即视为命名常量定义值。
  //   const PAGE_SIZES = [10, 20, 50]  → 50 往回跳 , 20 , 10 [ 后遇 =
  //   const TTL_MS = 5 * 60_000       → 60000 往回跳 * 5 后遇 =
  const SKIP = new Set(['*', '/', '+', '-', '%', '[', ']', ',', '(', ')']);
  let eqIdx = -1;
  for (let j = numIdx - 1; j >= Math.max(0, numIdx - 12); j--) {
    const tj = tokens[j];
    if (tj.type === 'ws' || tj.type === 'comment') continue;
    if (tj.type === 'num' || SKIP.has(tj.value)) continue; // 值表达式/数组分隔符
    if (tj.value === '=') { eqIdx = j; break; }
    if (tj.value === ';') return false; // 越出语句
    if (tj.type === 'ident') return false; // 遇到别的标识符（如 return data.x + 1）
    return false;
  }
  if (eqIdx === -1) return false;
  // `=` 前一个非空白 token 应为常量名，再前一个应为 const/let/var
  let constName = null;
  let declKw = null;
  for (let j = eqIdx - 1; j >= 0; j--) {
    const tj = tokens[j];
    if (tj.type === 'ws' || tj.type === 'comment') continue;
    if (!constName) { if (tj.type !== 'ident') return false; constName = tj; continue; }
    declKw = tj;
    break;
  }
  if (!constName || !declKw || !['const', 'let', 'var'].includes(declKw.value)) return false;
  // 常量名：全大写（PAGE_SIZES/API_ROW_LIMIT/TTL_MS）或含 version/date 等语义
  return /^[A-Z][A-Z0-9_]*$/.test(constName.value)
    || /version|date|year|month|day|hour|minute|second|total|count|limit|size/i.test(constName.value);
}

/**
 * 检查「凭据类标识符是否真的被赋了字面量值」（no-hardcoded-credentials kind 的 AST 精筛）。
 *
 * 正则 `token\s*[=:]+\s*['"][^'"]+['"]` 命中即报，会把下列**非硬编码**场景误报：
 *  - 类型/存在性检查：`typeof cfg.githubToken === 'string'`、`next.apiKey.trim()`
 *  - 字段透传/引用：`cfg.githubToken = init.githubToken`（右侧是变量，不是字面量）
 *  - 默认值取自配置：`token = options.token || ''`（右侧是表达式/空串）
 * 本实现在 token 级确认：只有当「凭据标识符」右侧的赋值/初始化**直接是字符串字面量**
 * 且该字面量**非空、非占位符**时才判定为硬编码。
 *
 * @param {string} text 文件全文
 * @param {object} [opts] { literalOnly=true } 是否只认「右侧直接是字面量」
 * @returns {Set<number>} 判定为「确实硬编码凭据」的行号集合
 */
/**
 * 凭据占位符判据（模块级共用）——2026-09-13。
 *
 * 为什么不写在单个检查里：占位符识别被两处用到，必须**同一套判据**——
 *   ① checkCredentialRefAst（凭据标识符右侧字面量）
 *   ② checkPlaceholderCredentialAst（前缀型密钥串，如 ghp_/sk-/AKIA）
 *   各写一份必然漂移，出现「同一串值 A 规则放行、B 规则拦截」的矛盾。
 */

/** 明显不是真凭据的值：空、掩码、占位文案、演示/测试数据。 */
const CRED_PLACEHOLDER = /^(|\s*|x+|\*+|<[^>]*>|your[-_ ]?.*|change[-_ ]?me|todo|placeholder|example.*|demo.*|sample.*|test.*|dummy.*|fake.*|xxx.*|redacted|masked|none|null|undefined)$/i;

/** 单段文本是否占位符文案。 */
function isPlaceholderText(text) {
  return CRED_PLACEHOLDER.test(String(text));
}

/**
 * 常见凭据 scheme 前缀：判占位符前先剥掉再判一次。
 *   否则带前缀的演示值会漏判——`ghp_` + 「Example…」开头的演示值，其首个词不是 example，
 *   匹配不到 `example.*`，就被当成真凭据报拦截（演示数据/夹具里的常见写法）。
 *   剥前缀不会放过真凭据：真实随机串剥完仍非占位符，照样报。
 */
const CRED_SCHEME_PREFIX = /^(gh[pousr]_|github_pat_|sk-[a-z]*-?|xox[baprs]-|glpat-|AKIA)/i;

/** 去掉字符串字面量外层引号。 */
function stripQuotes(raw) {
  return String(raw).replace(/^(\'|"|`)([\s\S]*)\1$/, '$2').trim();
}

/**
 * 判断一个字面量值是否算「真凭据」（非空、非掩码、非占位/演示）。
 *
 * @param raw 原始字面量（可带引号）
 * @returns true = 像真凭据（应报）；false = 占位符/空值（豁免）
 */
export function isMeaningfulCredentialValue(raw) {
  const v = stripQuotes(raw);
  if (!v) return false;
  if (isPlaceholderText(v)) return false;
  return !isPlaceholderText(v.replace(CRED_SCHEME_PREFIX, ''));
}

/*
 * 刻意不做「按 -/_ 拆段逐段判占位符」：试过并撤回。
 *   拆段会把「sk- + test + 随机串」形状的值（scheme 段里带 test）整体豁免——
 *   但这类值是真检出：仓库自身测试夹具正是用它证明「非豁免目录的 blocker 会拦截提交」，
 *   放宽后门禁形同虚设。占位符豁免必须取最小面：只认「整串/剥掉 scheme 前缀后即以
 *   占位词开头」，不认藏在中间段里的演示词。
 */

/**
 * astConfirmKind: "placeholder-credential" 的精筛集合（mode: deny）。
 *
 * 场景：`secret-github-pat` / `secret-openai-key` / `secret-aws-access-key` 这类
 *   **前缀形状匹配**的规则（`\\bghp_[A-Za-z0-9]{20,}\\b`），只看形状不看语义——
 *   文档里写「测试用占位符 + ghp_ 前缀」、演示页假数据
 *   `ghp_ExampleToken…` 都会被判成真泄漏（error 级，摘要计入拦截数）。
 *
 * 判定：把命中的密钥串剥掉 scheme 前缀后套占位符判据；命中即加入豁免集。
 *   只看「该串本身是不是占位符」，不做路径/文件级豁免——真 token 无论写在哪个文件都照报。
 *
 * @param text 文件全文
 * @returns Set<number> 命中「占位符凭据」的行号（1 起始）
 */
export function checkPlaceholderCredentialAst(text = '') {
  const out = new Set();
  const SCAN = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16})\b/g;
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    SCAN.lastIndex = 0;
    let m;
    while ((m = SCAN.exec(lines[i])) !== null) {
      if (isMeaningfulCredentialValue(m[1]) === false) { out.add(i + 1); break; }
    }
  }
  return out;
}

export function checkCredentialRefAst(text = '') {
  const tokens = tokenize(text);
  const out = new Set();
  // 凭据语义标识符（命名含这些词的变量/字段才纳入判断）
  const CRED = /(password|passwd|pwd|secret|token|apikey|api_key|accesskey|access_key|cookie|credential|privatekey|private_key)/i;
  // 占位符/空值：不算硬编码（''、'xxx'、'your-token-here'、'CHANGE_ME' 等）
  const meaningful = (raw) => isMeaningfulCredentialValue(raw);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !CRED.test(t.value)) continue;
    // 向后找该标识符所在语句的赋值/比较运算符（遇到语句边界就放弃）
    let opIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 8); j++) {
      const tj = tokens[j];
      if (tj.type !== 'punct') continue;
      if ([';', '{', '}'].includes(tj.value)) break;      // 语句结束，本标识符未被赋值
      if (['=', ':', '==', '===', '!='].includes(tj.value)) { opIdx = j; break; }
      if (['.', '(', ')', ','].includes(tj.value)) continue;
    }
    if (opIdx === -1) continue;
    // 只看严格赋值 `=`（`==`/`===` 是判断、`:` 是对象字面量字段声明，另判）
    const opTok = tokens[opIdx];
    const next = tokens[opIdx + 1];
    if (!next) continue;
    if (opTok.value === '=') {
      // 右侧直接是字符串字面量 → 真硬编码
      if (next.type === 'str' && meaningful(next.value)) out.add(t.line);
      continue;
    }
    if (opTok.value === ':') {
      // 对象字面量 `token: 'abc'` → 真硬编码；`token: cfg.token` 是引用，不报
      if (next.type === 'str' && meaningful(next.value)) out.add(t.line);
    }
  }
  return out;
}
