import { readText } from './collector.js';

/* ───────── 文件上下文常量 ───────── */
const MK_DIR_SCOPE_LOOKAHEAD = 20; // 命中行向后查 mkdir 调用的保守跨度
const FUNC_START_SCAN_BACK = 60;   // 向上找函数起点的最大行数

/**
 * 写文件前 mkdir 语义豁免：
 * robustness/mkdir-before-write 用纯 regex 匹配 `fs.writeFile(...)` 等写语句，
 * 看不到同函数内先执行的 mkdir/ensureDataDir 调用 → 把「先建目录再写」的
 * 常规安全写法误报成 ENOENT 风险。
 * 判定：命中行向上找最近函数体边界（前一个 `){`/`=>{` 或 `function` 行），
 * 该函数体内（往后至函数闭括号前，保守取命中行前 40 行 + 命中行后 20 行）
 * 若出现 mkdirSync/mkdir(/ensureDataDir 调用则视为已确保目录存在。
 * @param {string[]} lines 文件全部行
 * @param {number} lineIdx 命中行索引（0 基）
 * @returns {boolean} true=同一函数内已建目录（应豁免）
 */
export function hasMkdirInSameFunction(lines, lineIdx) {
  // mkdir 语义家族：字面量之外还要认**常见封装命名**。
  //   实测（2026-11-01 外部会话逐行样本）：`ensureDir(path.dirname(file))` 就在写语句**上一行**，
  //   但旧正则只认 `mkdir(Sync)?(` / `ensureDataDir(`，于是把「先建目录再写」报成 ENOENT 风险。
  const MKDIR_CALL_RE = new RegExp(
    '\\b(?:mkdir|mkdirSync|mkdirp|mkdtemp|mkdtempSync|ensure[A-Za-z0-9_]*Dir|ensureDir[A-Za-z0-9_]*)' +
    '\\s*\\(|recursive\\s*:\\s*true',
  );
  // 逐层向外找（最多 3 层）：写语句常在**嵌套回调/循环体**里，而目录由外层函数建好——
  //   嵌套体在定义时就处于外层函数体内，外层先执行 mkdir、再调用写在里面的回调，
  //   目录此时必然已存在（实测：diag-upload 的 mkdir 在 128 行、写在 199 行的回调里；
  //   export-bundle 的 mkdir 在 186/207 行、写在 237 行）。
  const helpers = mkdirHelperNames(lines);
  for (const { start, end } of enclosingScopes(lines, lineIdx)) {
    for (let i = start; i <= end && i < lines.length; i++) {
      if (i === lineIdx) continue;
      if (MKDIR_CALL_RE.test(String(lines[i] || ''))) return true;
    }
    // 一层间接：本文件里定义的 helper，其函数体含 mkdir ⇒ 调用它等同已建目录
    //   （样本：write-result.mjs 的 ensureDir 是**同文件私有函数**，调用点没有 mkdir 字面量）
    for (const name of helpers) {
      const callRe = new RegExp(`\\b${name}\\s*\\(`);
      for (let i = start; i <= end && i < lines.length; i++) {
        if (i === lineIdx) continue;
        if (callRe.test(String(lines[i] || ''))) return true;
      }
    }
  }
  return false;
}

/**
 * 由内向外列出命中所处的作用域（最多 3 层）。
 *   为什么要多层：写语句常落在 `files.forEach(() => { … })`、`for { … }` 这类嵌套体里，
 *   而 mkdir 在外层函数里——只看最内层会把「外层早已建好目录」误判成没建。
 */
function enclosingScopes(lines, lineIdx) {
  const out = [functionScope(lines, lineIdx)];
  // 再并上「包含写语句的**顶层函数**」：写语句经常落在嵌套回调/循环体里，
  //   而 mkdir 由外层函数建好——两层一起看才覆盖得住（逐层推断父块容易跳到兄弟块，
  //   实测会把 diag-upload 的链走歪到无关块）。顶层函数超过 400 行时只取前 400 行。
  const top = topLevelFunctionScope(lines, lineIdx);
  if (top && top.start !== out[0].start) out.push(top);
  return out;
}

/**
 * 包含该行的顶层函数范围（列 0 起笔的 `function` / `const f = (...) =>`）。
 *   Node 服务的模块基本都这么写；取不到时返回 null（退化为只看内层作用域）。
 */
function topLevelFunctionScope(lines, lineIdx) {
  const TOP_RE = /^(?:export\s+)?(?:async\s+)?(?:function\s+[A-Za-z_$][\w$]*\s*\(|const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\()/;
  let start = -1;
  for (let i = lineIdx; i >= 0 && i >= lineIdx - 600; i--) {
    if (TOP_RE.test(String(lines[i] || ''))) { start = i; break; }
  }
  if (start < 0) return null;
  let depth = 0;
  let started = false;
  let end = Math.min(lines.length - 1, start + 400);
  for (let i = start; i < lines.length; i++) {
    let text = stripBracesNoise(String(lines[i] || ''));
    if (i === start) {
      const lastOpen = text.lastIndexOf('{');
      if (lastOpen >= 0) text = text.slice(lastOpen);
    }
    for (const ch of text) {
      if (ch === '{') { depth += 1; started = true; }
      else if (ch === '}') { depth -= 1; if (started && depth <= 0) { end = i; break; } }
    }
    if (started && depth <= 0) { end = i; break; }
  }
  return { start, end: Math.max(start, end) };
}

/**
 * 写语句是否在「try { … } catch { /* 非关键 *\/ }」里 —— 即 best-effort 写入。
 * 这类写入失败通常只影响附属信息（如 LRU 时间戳），按 warning 报会淹没有效信号；
 * 调用方据此把它降级为提示（仍可见、仍可追踪，只是不当作缺陷）。
 */
export function isBestEffortWrite(lines, lineIdx) {
  // 精确判定：反向扫描找到**包裹本行的最近一层块**，看它的开括号是不是 `try {`。
  //   早先写法（往回 40 行找 try、再往后 40 行找 catch）太松：同一函数里别处的 try/catch
  //   也会命中，把正常写入误判成 best-effort（实测 config/spine 的被误判）。
  let depth = 0;
  for (let i = lineIdx; i >= 0 && i >= lineIdx - 200; i--) {
    const text = stripBracesNoise(String(lines[i] || ''));
    for (let k = text.length - 1; k >= 0; k--) {
      const ch = text[k];
      if (ch === '}') depth += 1;
      else if (ch === '{') {
        depth -= 1;
        if (depth < 0) {
          const head = text.slice(0, k).trim();
          if (/\btry$/.test(head)) return true;    // 最近的块就是 try 块
          return false;                             // 最近的块不是 try（if/for/函数体…）
        }
      }
    }
  }
  return false;
}

/** 向上找最近的函数起点，再按花括号配平取函数体范围（含跨 70+ 行的远距离 mkdir）。 */
function functionScope(lines, lineIdx) {
  // 函数起点识别：**必须带词边界**，否则 `if (!x) {` 会从第二个字符 `f (!x) {` 被当成函数起点、
  //   `} catch (e) {` 会从 `atch (e) {` 被匹配 —— 作用域一步错，后面全盘错（实测：
  //   ModelStage config.mjs 的作用域被算成 82..89，而写语句在 93 行，mkdir 就在上一行也看不见）。
  //   同理数括号前要先剔除字符串/注释里的花括号，否则 `'{'`、`// }` 会把配平带偏。
  const NOT_FUNC_KW = '(?!(?:if|for|while|switch|catch|do|else|try|return|typeof|new)\\b)';
  const BOUNDARY = '(?:^|[^\\w$])';
  const FUNC_START_RE = new RegExp(
    `(?:${BOUNDARY}(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*[A-Za-z_$][\\w$]*\\s*\\([^)]*\\)\\s*\\{` +
    `|${BOUNDARY}${NOT_FUNC_KW}[A-Za-z_$][\\w$]*\\s*\\([^)]*\\)\\s*\\{` +
    '|=>\\s*\\{)',
  );
  let start = 0;
  for (let i = lineIdx; i >= 0 && i >= lineIdx - 400; i--) {
    if (FUNC_START_RE.test(String(lines[i] || ''))) { start = i; break; }
  }
  let depth = 0;
  let started = false;
  let end = Math.min(lines.length - 1, start + 400);
  for (let i = start; i < lines.length; i++) {
    let text = stripBracesNoise(String(lines[i] || ''));
    // 起点行只从**函数体开括号**（该行最后一个 `{`）开始算深度：
    //   否则解构参数 `function f({ a, b }) {` 里的那对花括号会把深度配平到 0，
    //   作用域当场就"结束"在本行（实测：writeResult 的作用域被算成 31..31，整段函数体全在范围外）。
    if (i === start) {
      const lastOpen = text.lastIndexOf('{');
      if (lastOpen >= 0) text = text.slice(lastOpen);
    }
    for (const ch of text) {
      if (ch === '{') { depth += 1; started = true; }
      else if (ch === '}') {
        depth -= 1;
        if (started && depth <= 0) { end = i; break; }
      }
    }
    if (started && depth <= 0) { end = i; break; }
  }
  return { start, end: Math.max(start, end) };
}

/**
 * 数花括号前剔除「字符串/注释里的花括号」——否则 `const a = '{'`、`// }` 会把配平带偏，
 * 作用域提前结束（实测：写语句落在作用域之外 ⇒ mkdir 就在上一行也判不出）。
 */
function stripBracesNoise(line) {
  return String(line)
    .replace(/\/\/.*$/, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

/** 收集「函数体里含 mkdir 家族调用」的本文件函数名（一层间接判定用）。 */
function mkdirHelperNames(lines) {
  const names = new Set();
  const DEF_RES = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  ];
  const MKDIR_DEF_RE = /\b(?:mkdir|mkdirSync|mkdirp|mkdtemp|mkdtempSync)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const text = String(lines[i] || '');
    for (const re of DEF_RES) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (!m) continue;
      const { end } = functionScope(lines, i);
      let has = false;
      for (let k = i; k <= end && k < lines.length; k++) {
        if (MKDIR_DEF_RE.test(String(lines[k] || ''))) { has = true; break; }
      }
      if (has) names.add(m[1]);
    }
  }
  return names;
}

/**
 * 写目标是否「来自调用方」——若是，则目录创建责任不在本函数，mkdir-before-write 应豁免。
 *
 * 背景（2026-10-17 ZipCalm 反馈：robustness 槽位 4 条里 3 条跨界误报）：
 *   上一档 hasMkdirInSameFunction 只看**同函数**，而这些站点把写目标交给调用方准备：
 *     · store.js      `const tmpPath = `${ctx.historyFile}.tmp`; fs.writeFile(tmpPath, …)`
 *     · writer.js     `fs.createWriteStream(ctx.tempPath)`
 *     · tarFamily.js  `fs.createWriteStream(plannedEntry.targetPath)`
 *     · zip/index.js  `openArchivePipeline(tempPath, level)` ⇒ `fs.createWriteStream(tempPath)`
 *   目标要么是**形参**、要么是形参的成员/由形参派生的临时路径 ⇒ 目录由调用方（或临时目录
 *   提供方）负责建 ⇒ 规则说的「直接 writeFile 而不 mkdir ⇒ ENOENT」在本站点**不成立**
 *   （判错事实 = 真误报 ✓，不是"不想改"）。
 *
 * 判据（保守，只认能静态确认的归属）：
 *   ① 取下写调用的首参表达式，取它的**根标识符**；
 *   ② 根标识符若在**所属函数的形参列表**里 ⇒ 外来目标 ⇒ 豁免；
 *   ③ 根标识符是局部变量时，看它的赋值 RHS 是否**以形参为根**（如 `${ctx.x}.tmp`）⇒ 豁免；
 *   ④ 其余（本地字面量 / join(...) 现场拼路径 / 无赋值可查）⇒ **不豁免**，交给同函数档判定 ✓
 * @param {string[]} lines 文件全部行
 * @param {number} lineIdx 命中行索引（0 基）
 * @returns {boolean} true=写目标来自调用方（应豁免）
 */
export function hasForeignWriteTarget(lines, lineIdx) {
  const line = String(lines[lineIdx] || '');
  // 取写调用的首参（到第一个逗号/右括号为止；模板串与成员链都吃）
  const m = line.match(/(?:writeFile|writeFileSync|createWriteStream|appendFile|appendFileSync|createWriteStreamSync)\s*\(\s*([^,)]+)/);
  if (!m) return false;
  const target = m[1].trim();
  const rootMatch = target.match(/^[$A-Za-z_][\w$]*/);
  if (!rootMatch) return false;
  const root = rootMatch[0];
  const params = enclosingParams(lines, lineIdx);
  if (params.has(root)) return true;
  // 局部变量：查它的赋值 RHS 是否以形参为根（`${ctx.historyFile}.tmp` 这类临时路径）
  const assignRe = new RegExp(`(?:const|let|var)\\s+${root}\\s*=\\s*([^;]+)`);
  for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 40); i--) {
    const mm = String(lines[i] || '').match(assignRe);
    if (!mm) continue;
    const rhs = mm[1];
    // ⚠️ 只认「同目录派生」：模板串/字符串拼接（`${ctx.x}.tmp`、x + '.tmp'）与成员传递；
    //   join(...) / resolve(...) 会**新增路径段**（join(dir,'sub','a.json')）⇒ 目录可能还没建，
    //   仍由本函数负责 ⇒ 不豁免 ✓（否则会把真命中一起修掉 ✗，实测过一轮）
    if (/\bjoin\s*\(|\bresolve\s*\(/.test(rhs)) return false;
    const ids = rhs.match(/[$A-Za-z_][\w$]*/g) || [];
    return ids.some((id) => params.has(id)); // 由形参派生 ⇒ 目录由调用方负责
  }
  return false;
}

/**
 * 取「所属函数」的形参名集合（向上找最近的函数签名；找不到返回空集）。
 * 支持 function 声明/表达式、方法简写、箭头函数与 async 变体；
 * 默认值、类型注解、解构都做保守处理（解构里的标识符也算形参 ✓）。
 * @param {string[]} lines 文件全部行
 * @param {number} lineIdx 命中行索引（0 基）
 * @returns {Set<string>} 形参名集合
 */
function enclosingParams(lines, lineIdx) {
  const out = new Set();
  // ⚠️ 控制流行不是函数签名：`if (cond) {` / `for (…) {` / `while (…) {` / `catch (e) {` 等
  //   都能被 `(…)\s*{` 匹配上 ⇒ 会把判定用的花括号误当函数体、参数集取成条件里的标识符 ✗
  //   （2026-10-17 实测：正是这一条让 hasForeignWriteTarget 对 ZipCalm 三处全部返回 false）
  const CTRL_RE = /^\s*(?:\}\s*)?(?:if|for|while|switch|catch|do|else|return|with)\b/;
  // ⚠️ 第二个实测坑：**行内回调**里的 `=>` 也会被当成函数头 ✗
  //   store.js 的 `const body = … ? \`${entries.map((item) => JSON.stringify(item))…` 与
  //   writer.js 的 `createThrottledReporter(ctx.onProgress || (() => {}), {`
  //   都被扫成"签名" ⇒ 参数集 {item} / 空 ⇒ ctx 不在其中 ⇒ 判不出来 ✓（已修：箭头必须**以 => 结尾**）
  // ③ 嵌套回调里写的目标，其目录往往由**外层函数**的形参决定（tarFamily 的 planned 来自外层）⇒
  //   向外收集多层作用域的形参并集（上限 4 层，避免过度收集削弱规则）
  const MAX_SCOPE_HEADS = 4;
  for (let i = lineIdx, heads = 0; i >= Math.max(0, lineIdx - FUNC_START_SCAN_BACK) && heads < MAX_SCOPE_HEADS; i--) {
    const text = String(lines[i] || '');
    if (CTRL_RE.test(text)) continue;
    const isDecl = /(?:^|\s)(?:async\s+)?function\b/.test(text);
    const isArrowHead = /(?:\([^()]*\)|[$A-Za-z_][\w$]*)\s*=>\s*\{?\s*$/.test(text);
    const isMethod = !/=>/.test(text) && /^\s*(?:export\s+)?(?:async\s+)?[$A-Za-z_][\w$]*\s*\([^)]*\)\s*\{/.test(text);
    if (!isDecl && !isArrowHead && !isMethod) continue;
    const sig = text.match(/(?:function\s*[$A-Za-z_][\w$]*\s*|(?:async\s+)?)(\([^)]*\))/)
      || (isArrowHead ? text.match(/(\([^)]*\))\s*=>/) : null);
    if (!sig) continue;
    for (const part of sig[1].replace(/[()]/g, '').split(',')) {
      const name = (part.split(/[=:]/)[0].match(/[$A-Za-z_][\w$]*/g) || []).pop();
      if (name) out.add(name);
    }
    heads += 1;
  }
  return out;
}

/**
 * 外部 API 调用超时语义豁免：
 * robustness/timeout-on-external-api 规则用纯 regex 匹配 `fetch(`/`axios.(` 等调用，
 * 无法看到同一调用表达式内的超时参数 → 把「已设置 AbortSignal.timeout / AbortController /
 * timeout 选项」的调用误报成无超时。
 * 判定：命中行内联有超时设置（单行调用），或命中行前/后（各最多 12 行、括号未闭合区间）
 * 出现 AbortSignal.timeout / AbortController / timeout: / timeout = 即视为已设超时。
 * 修误报：只往后看会漏「init/options 定义在调用之前」的写法——
 *   `const init = { signal: AbortSignal.timeout(MS) }; await fetch(url, init)` 的
 *   signal 在 fetch 前 6 行，后看 12 行永远扫不到 → 加前向 12 行扫描。
 * @param {string} line 命中的行文本
 * @param {string[]} lines 文件全部行
 * @param {number} lineIdx 命中行索引（0 基）
 * @returns {boolean} true=调用已设超时（应豁免）
 */
/** 超时语义特征（行内/区间扫描复用）。 */
const TIMEOUT_SIGNAL_RE = /AbortSignal\.timeout|AbortController|timeout\s*[:=]/;

/**
 * 区间扫描：lines[start, end) 内是否出现超时信号。
 * 从 hasExternalCallTimeout 抽出（前向 12 行扫描），独立成函数降圈复杂度。
 * @param {string[]} lines 文件全部行
 * @param {number} start 起始行索引（含）
 * @param {number} end 结束行索引（不含）
 * @returns {boolean} true=区间内有超时设置
 */
function hasTimeoutInRange(lines, start, end) {
  for (let i = start; i < end; i++) {
    if (TIMEOUT_SIGNAL_RE.test(String(lines[i] || ''))) return true;
  }
  return false;
}

/** 调用表达式闭合判定（括号深度归零且行尾闭合符号）——从后向扫描循环抽出。 */
function isCallClosed(s, depth) {
  return depth <= 0 && /\);|},|}\);/.test(s);
}

/**
 * 调用之后（括号未闭合区间，最多 12 行）的超时检测：
 * 跨行对象（fetch(url, { ... })）从下一行算起时首行的 `},` 会把深度归零提前
 * break，漏掉对象尾部的 signal: AbortSignal.timeout 字段——故起始括号深度计入
 * 命中行自身。从 hasExternalCallTimeout 抽出（后向扫描 + 括号深度平衡）。
 * @param {string} line 命中的行文本
 * @param {string[]} lines 文件全部行
 * @param {number} lineIdx 命中行索引（0 基）
 * @returns {boolean} true=调用之后已设超时
 */
function hasTimeoutAfterCall(line, lines, lineIdx) {
  let depth = (String(line || '').match(/\(/g) || []).length - (String(line || '').match(/\)/g) || []).length;
  const LIMIT = 12;
  for (let i = lineIdx + 1; i < Math.min(lines.length, lineIdx + 1 + LIMIT); i++) {
    const s = String(lines[i] || '');
    depth += (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    if (TIMEOUT_SIGNAL_RE.test(s)) return true;
    if (isCallClosed(s, depth)) break; // 调用表达式已闭合
  }
  return false;
}

export function hasExternalCallTimeout(line, lines, lineIdx) {
  if (TIMEOUT_SIGNAL_RE.test(line)) return true; // 单行内联超时
  // 前向扫描：init/options 常定义在调用之前（同函数内 signal: AbortSignal.timeout(...)）
  if (hasTimeoutInRange(lines, Math.max(0, lineIdx - 12), lineIdx)) return true;
  return hasTimeoutAfterCall(line, lines, lineIdx);
}

/**
 * 全仓 js-yaml 引用检测：扫描所有文本文件的 import/require 语句，
 * 判断仓库是否真的引用了 js-yaml 包。npm/undeclared-js-yaml 规则需要这个
 * 全仓语义证据——零依赖插件（lib 不 import js-yaml）不应被报「未声明 js-yaml 依赖」。
 * @param {Array<{path:string, full:string}>} files 收集的文件清单
 * @returns {boolean} true=全仓存在 js-yaml import/require
 */
export function detectRepoJsYamlImport(files) {
  const RE = /(?:from\s+['"]js-yaml['"]|require\s*\(\s*['"]js-yaml['"]\s*\)|import\s*\(\s*['"]js-yaml['"]\s*\))/;
  for (const f of files || []) {
    try {
      const t = readText(f.full);
      if (RE.test(t)) return true;
    } catch { /* 读失败跳过（collector 已保证可读） */ }
  }
  return false;
}

/**
 * 版本号「路径/文件名上下文」豁免：
 * version/embedded-major-zero 与 version/readme-zero-title 用 pattern 匹配任意
 * `v0.x.y` 字符串，会误伤「安装路径/文件名里的版本号」——如 README 数据示例
 * `Path('/vol2/.../dsh-v0.1.2-alpha.4/.dsh-home/...')` 里的 dsh-v0.1.2 是
 * DSH runtime 目录名（第三方环境路径），不是本项目版本标记，不应报。
 * 判定：v0.x.y 前一个字符是路径/文件名分隔符（/ - . _ 或字母数字），
 * 且整行含路径分隔符 / → 视为路径上下文，豁免。
 * @param {string} line 命中行文本
 * @returns {boolean} true=版本号处于路径/文件名上下文（应豁免）
 */
export function isVersionInPathContext(line) {
  const match = /[vV]0\.\d+\.\d+/.exec(String(line || ''));
  if (!match) return false;
  if (!String(line || '').includes('/')) return false; // 无路径分隔符 = 不是路径上下文
  const before = String(line || '')[match.index - 1] || '';
  return /[/\-._A-Za-z0-9]/.test(before);
}
