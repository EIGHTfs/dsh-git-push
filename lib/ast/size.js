/**
 * AST 实现层 · 规模检查
 *
 * 职责：函数长度、文件长度、重复字符串。
 *   函数长度按括号平衡区间统计函数体内语句密度，单行海量语句也能识别。
 */

import { tokenize } from './tokenizer.js';
import { matchBrace } from './brace.js';
import { javaKtFuncRanges } from './lang.js';

/** 函数体行数默认阈值：≥ WARN 报 warning，≥ BLOCK 报 blocker。 */
const FUNC_LINES_WARN = 50;
const FUNC_LINES_BLOCK = 100;
/** 从 `function` 关键字向后搜索函数体 `{` 的 token 窗口（覆盖 name(params ) { 形态）。 */
const FUNC_BODY_LOOKAHEAD_TOKENS = 20;
/** 行注释密度默认阈值（0~1——行注释占有效代码行比例，超过提示「注释复述代码」）。 */
const COMMENT_DENSITY_WARN_DEFAULT = 0.4;

/**
 * 列出全文所有函数的**精确行范围**（AST 级，tokenizer 括号配对）。
 *
 * 与 checkFuncLinesAst 共用同一套边界算法，区别是：本函数返回**全部**函数（不只超限的），
 * 供上层在此基础上做「语句密度」等派生判定，避免上层再自建第二套边界识别
 * （历史教训：上层曾用正则找起点 + 自己数花括号，未剥离字面量，把 8 行函数算成 242 行 blocker）。
 * @param {string} text 文件全文
 * @returns {Array<{startLine:number, endLine:number, len:number}>} 按出现顺序
 */
/** 从 function 标记提取函数名：`function NAME(` 直接取；`const f = function(` 向前找声明名；否则 (匿名)。 */
function funcNameAt(tokens, i) {
  const nx = tokens[i + 1];
  if (nx && nx.type === 'ident') return nx.value;
  if (nx && nx.type === 'punct' && nx.value === '(') {
    // 向前找 const/let/var NAME =
    for (let k = i - 1; k >= Math.max(0, i - 6); k--) {
      const tk = tokens[k];
      if (tk && tk.type === 'ident' && ['const', 'let', 'var'].includes(tk.value)) {
        const nm = tokens[k + 1];
        if (nm && nm.type === 'ident') return nm.value;
      }
    }
  }
  return '(匿名)';
}

/**
 * Python 函数范围收集（行级缩进法）。
 *
 * Python 无 `function` 关键字与大括号——`def name(...):` + 缩进定义函数体。
 * funcRangesAst 的大括号配对法对 Python 完全失效，这里按行扫描：
 *   · `def name(...):` 行 = 函数起点
 *   · 函数体 = 后续缩进 > def 行缩进的行，直到缩进回到 def 缩进或更浅（或文件尾）
 *   · 行内对象/列表推导不产生缩进块，天然正确
 * 返回 [{startLine, endLine, len, name}]，与 funcRangesAst 输出结构一致，
 * 由 funcRangesAst 合并（JS + Python 双语言函数范围）。
 * @param {string} text 文件全文
 * @returns {Array<{startLine:number, endLine:number, len:number, name:string}>}
 */
export function pythonFuncRanges(text = '') {
  const out = [];
  const lines = String(text).split('\n');
  const DEF_RE = /^(\s*)def\s+([A-Za-z_]\w*)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = DEF_RE.exec(lines[i]);
    if (!m) continue;
    const defIndent = m[1].length;
    const name = m[2];
    // 找函数体结束：后续首个「非空且缩进 <= defIndent」的行是函数外的行；函数体 = 其间行
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue; // 空行属于函数体（不结束）
      const indent = (l.match(/^\s*/) || [''])[0].length;
      // 注释行：`#` 顶格或在任何缩进——不算「函数外」，跳过（注释不打断函数体）
      if (/^\s*#/.test(l)) continue;
      if (indent <= defIndent) break;
      end = j;
    }
    out.push({ startLine: i + 1, endLine: end + 1, len: end - i + 1, name });
    i = end; // 跳过函数体，继续找下一个 def
  }
  return out;
}

/**
 * 最大函数长度（行数，跨语言：JS/Python/Java/Kotlin 统一由 funcRangesAst 提供范围）。
 * 供 file-health / max-lines 的「聚合型 vs 臃肿型」判定：最大函数 > 合规阈值 = 臃肿型
 * （文件大是因为藏着大函数，该罚）；全部函数合规（含无函数的数据文件）= 聚合型
 * （文件大只是函数多，可接受不按规模扣分）。
 * 注意：纯 JS 文件的 Java/Python 探测零命中，无额外开销（tokenize 有 LRU 缓存）。
 * @param {string} text 文件全文
 * @returns {number} 最大函数行数（无函数返回 0）
 */
export function maxFunctionLength(text = '') {
  let max = 0;
  for (const r of funcRangesAst(String(text))) {
    if (r.len > max) max = r.len;
  }
  return max;
}

export function funcRangesAst(text = '') {
  const tokens = tokenize(text);
  const out = [];
  // 合并 Python 函数范围（缩进法）——Python 项目函数长度/复杂度/嵌套
  //   规则依赖它（python/max-function-length 等此前对 py 全失效）。
  for (const r of pythonFuncRanges(text)) out.push(r);
  // Java/Kotlin 方法范围（方法签名 + 括号配对）——语言路由：JS 用 function 关键字、
  //   Python 按 def+缩进、Java/Kotlin 无声明关键字，只能靠「方法签名 + 括号配对」判定——
  //   Java/Kotlin 无 function 关键字，JS 大括号法零命中 → 由 lang.js 的
  //   javaKtFuncRanges 补充（轻量内容探测，纯 JS 项目不受影响）。
  for (const r of javaKtFuncRanges(text)) {
    // 与 JS 分支结果去重（极端混合文件里同名起点的保守处理）
    if (!out.some((o) => o.startLine === r.startLine)) out.push(r);
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'function') continue;
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + FUNC_BODY_LOOKAHEAD_TOKENS); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') { openIdx = j; break; }
      if (tj.type === 'punct' && tj.value === ';') break;
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    const startLine = tokens[openIdx].line;
    const endLine = tokens[range[1]].line;
    out.push({ startLine, endLine, len: endLine - startLine + 1, name: funcNameAt(tokens, i) });
    i = range[1];
  }
  return out;
}

/**
 * 统计指定行范围内的注释行数（多项检查共用：函数长度/文件长度的「非注释部分」口径）。
 * 与 countCommentLines 同思路（comment token 按物理行去重、跨行块注释逐行覆盖），
 * 但限定在 [startLine, endLine] 闭区间内。
 * @param {Array} tokens tokenize 输出
 * @param {number} startLine 起始物理行（含）
 * @param {number} endLine 结束物理行（含）
 * @returns {number} 范围内注释行数
 */
export function countCommentLinesInRange(tokens, startLine = 1, endLine = Infinity) {
  const commentLines = new Set();
  for (const t of tokens) {
    if (t.type !== 'comment') continue;
    const start = Number(t.line) || 1;
    if (start < startLine || start > endLine) continue;
    commentLines.add(start);
    const newlines = String(t.value || '').match(/\n/g)?.length || 0;
    for (let i = 1; i <= newlines; i++) {
      if (start + i <= endLine) commentLines.add(start + i);
    }
  }
  return commentLines.size;
}

/**
 * 检查单函数超长（AST 级：括号平衡精确统计函数体行数）。
 * 判定按**非注释部分**（codeLen = 总行数 − 范围内注释行），
 *   注释/文档行不占「代码规模」预算；总行数仍随返回供展示。
 * @param {string} text 文件全文
 * @param {{warn?: number, block?: number}} [opts]
 * @returns {Array<{line:number, len:number, codeLen:number, commentLines:number, level:'warning'|'blocker'}>}
 */
export function checkFuncLinesAst(text = '', { warn = FUNC_LINES_WARN, block = FUNC_LINES_BLOCK } = {}) {
  const tokens = tokenize(text);
  const out = [];
  // 统一走 funcRangesAst（JS 大括号 + Python 缩进双语言函数范围）——
  //   旧内联扫描只认 `function`+`{`，Python def 函数长度规则（python/max-function-length）
  //   对 py 文件全失效。funcRangesAst 已合并 pythonFuncRanges。
  for (const r of funcRangesAst(text)) {
    const startLine = r.startLine;
    const endLine = r.endLine;
    const len = endLine - startLine + 1;
    const commentLines = countCommentLinesInRange(tokens, startLine, endLine);
    const codeLen = Math.max(1, len - commentLines);
    if (codeLen > warn) {
      out.push({ line: startLine, name: r.name || '(匿名)', len, codeLen, commentLines, level: codeLen > block ? 'blocker' : 'warning' });
    }
  }
  return out;
}

/** 语句密度门槛（条/行）：低于此值说明语句正常铺开分布，不算「单行海量语句」。 */
const STMT_DENSITY_MIN = 3;

/**
 * 检查「单行/极少行堆叠海量语句」（AST 级，tokenizer 计数）。
 *
 * 为什么独立于行数判定：`function f() { a++; a++; … ×200 }` 挤在**一行**，行数=1 永远
 *   超不过 50 行阈值，只能按**语句密度**（语句数 ÷ 函数体行数）识别。
 *
 * 为什么不与行数判定重复报：两处都基于同一份 AST 函数范围；本函数跳过「已被行数判定报出」
 *   的函数（见 `reportedByLines`），避免同一函数在同一规则下产生两条 finding。
 *
 * 历史（误报）：旧实现在 `lib/checks/` 层用正则找起点、自己数花括号、无条件套用
 *   语句总数阈值 → 把 DSH 客户端 bundle 的单入口工厂 `factory: (require) => { … }`（整个
 *   插件体都在这个箭头函数里，横跨上千行、语句数自然过百，密度却不到 1）误报为 blocker。
 *   现加密度门槛，并把全部字符级操作收敛到 AST 层（tokenizer 计数，不经正则）。
 *
 * @param {string} text 文件全文
 * @param {{threshold?: number, blockThreshold?: number, skipLines?: Set<number>}} [opts]
 *   skipLines：已被行数判定报出的函数起始行，不再重复报
 * @returns {Array<{line:number, stmtCount:number, bodyLines:number, density:number, level:'warning'|'blocker'}>}
 */
export function checkFuncDensityAst(text = '', { threshold = FUNC_LINES_WARN, blockThreshold = FUNC_LINES_BLOCK, skipLines = new Set() } = {}) {
  const tokens = tokenize(String(text));
  const out = [];
  for (const r of funcRangesAst(text)) {
    if (skipLines.has(r.startLine)) continue;
    const bodyLines = Math.max(1, r.len);
    // 语句数 = 该函数行范围内的分号 token 数（tokenizer 已剥离字符串/正则/注释内的分号）
    let stmtCount = 0;
    for (const t of tokens) {
      if (t.type !== 'punct' || t.value !== ';') continue;
      if (t.line >= r.startLine && t.line <= r.endLine) stmtCount += 1;
    }
    const density = stmtCount / bodyLines;
    if (stmtCount > threshold && density > STMT_DENSITY_MIN) {
      out.push({
        line: r.startLine, stmtCount, bodyLines, density,
        level: stmtCount > blockThreshold ? 'blocker' : 'warning',
      });
    }
  }
  return out;
}

/**
 * 统计注释行数（注释行单独算）：基于 tokenizer 的 comment token，
 * 对跨行块注释按换行拆分后按「物理行号去重」计注释行数。
 * @param {string} text 文件全文
 * @returns {number} 注释行数（0 = 无注释/无法解析）
 */
export function countCommentLines(text = '') {
  const tokens = tokenize(String(text));
  const commentLines = new Set();
  for (const t of tokens) {
    if (t.type !== 'comment') continue;
    const v = String(t.value || '');
    const start = Number(t.line) || 1;
    commentLines.add(start);
    // 跨行块注释：从起始行起按换行推进，覆盖到的每行都算注释行
    const newlines = v.match(/\n/g)?.length || 0;
    for (let i = 1; i <= newlines; i++) commentLines.add(start + i);
  }
  return commentLines.size;
}

/**
 * 检查文件行数（max-lines kind）。
 * 判定默认按**非注释部分**（codeLines = 总行数 − 注释行数），
 *   注释/文档行不占文件规模预算；总行数/注释行数仍随返回供展示。
 * @param {string} text 文件全文
 * @param {object} [opts] { warn=500, block=1000, excludeComments=true }
 *   excludeComments=false 时回退旧口径（按总行数判定）。
 * @returns {{lines:number, codeLines:number, commentLines:number, level:string|null}}
 */
export function checkFileLines(text = '', { warn = 500, block = 1000, excludeComments = true } = {}) {
  const lines = String(text).split('\n').length;
  const commentLines = countCommentLines(text);
  const codeLines = excludeComments ? Math.max(lines - commentLines, 0) : lines;
  if (codeLines <= warn) return { lines, codeLines, commentLines, level: null };
  return { lines, codeLines, commentLines, level: codeLines > block ? 'blocker' : 'warning' };
}

/**
 * 注释冗余检测（评审规则①）。
 *
 * 语义：**变量即注释**——语义明确的代码里变量名已表达内容，额外的行注释并不加深
 * 理解；应只保留具有隐性约束、复杂设计、外部契约、非显然决策的块注释，同时减少
 * 行注释。注释应解释「为什么」而非复述「做了什么」。
 *
 * 判据（保守，防误伤合理注释）：
 *   · 统计**行注释**行数（独立 `//` / `#` 行，非行尾注释）÷ 有效代码行数；
 *   · 行注释密度 > 阈值（默认 0.4，即行注释占代码行 40% 以上）→ 提示
 *     「行注释过多，可能复述代码」；
 *   · **块注释**（斜杠星号文档注释、Python docstring）不计入——那是设计说明，
 *     评审要求保留；
 *   · 连续注释块（≥3 行同属一个逻辑说明）不触发——大段注释往往是设计文档；
 *   · 只提示（warning），不拦截。
 *
 * @param {string} text 文件全文
 * @param {{warn?:number}} [opts] warn=行注释密度阈值（0~1）
 * @returns {Array<{line:number, commentLines:number, codeLines:number, ratio:number}>}
 */
export function checkCommentDensityAst(text = '', { warn = COMMENT_DENSITY_WARN_DEFAULT, minCodeLines = 5 } = {}) {
  const lines = String(text).split('\n');
  let commentLines = 0;
  let codeLines = 0;
  let inBlockComment = false;
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    // 跨行块注释（/* ... */ 未闭合）
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue; // 块注释不计入行注释密度
    }
    if (line.startsWith('/*')) { if (!line.includes('*/')) inBlockComment = true; continue; }
    // 文档注释 `/** */` 单行、`///` 也算块/文档注释不计（设计说明保留）
    if (/^\/\*\*/.test(line) || /^\/\/\//.test(line)) continue;
    // 行注释（// 或 # 开头；# 排除 shebang）——**行注释无论是否连续都计入**：
    // 修：评审要求是「减少行注释、保留块注释」——连续行注释是
    //   复述代码的高发区（每行注释对应一行简单语句），不是设计说明，count 不豁免。
    if (/^(\/\/|#)/.test(line) && !/^#!/.test(line)) {
      commentLines++;
    } else if (line) {
      // 代码行（非空、非注释）
      codeLines++;
    }
  }
  // 短文件（代码行 < minCodeLines）不判定：文件头说明/简述占比天然高且篇幅小，
  //   「注释复述代码」是长文件信号（行注释随代码量线性堆积时才该提示）。
  if (codeLines < minCodeLines) return [];
  const ratio = commentLines / codeLines;
  if (ratio > warn) {
    hits.push({ line: 1, commentLines, codeLines, ratio });
  }
  return hits;
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
    // ①c i18n 键/配置键（common.cancel / menu.save_as / zh-CN.foo / api.retry_times /
    //    downloader.files_netloc）：点分小写链是字典/配置引用键（多处引用同一键是正常
    //    用法，不是「应配置化的硬编码值」——键本身就是配置）。允许 snake_case 段
 // （Python 配置键惯例， 二次修：下划线段 files_netloc 此前漏豁免）。
    //    判据：全小写 + 点分 2~4 段 + 每段 [a-z][a-z0-9_]*（允许下划线）+ 段可含连字符；
    //    排除域名特征——末段是域名后缀（com/net/org/io 等）或含 example/test/localhost
    //    段的是真实业务/URL。`api.scheme`（配置字段名）算配置键豁免。
    if (/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){1,3}$/.test(v)
      && !/\.(com|net|org|io|dev|cn|co|example|test|localhost)$/.test(v)
      && !/(^|\.)(example|test|localhost|your|demo)\./.test(v)) continue;
    // ①d 路由/端点路径（/naming /session /api/foo）：路径段是小写词（含连字符），
    //    重复是「多处引用同一路由常量」的正常形态（路由表/链接/匹配共用），非硬编码值。
    //    排除含 `..`/空白/大写的真实路径与查询串（?a=b 是数据不是路由名）。
    if (/^\/[a-z0-9][a-z0-9/_-]*$/.test(v) && !v.includes('..') && !/[\s?]/.test(v)) continue;
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
