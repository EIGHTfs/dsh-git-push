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
  const MKDIR_RE = /mkdir(Sync)?\s*\(|ensureDataDir\s*\(|recursive:\s*true/;
  const FUNC_START_RE = /(function|=>)\s*\{|\)\s*(async\s*)?\{/;
  // 向上找函数起点（最多 60 行），命中即记下作用域起点
  let scopeStart = 0;
  for (let i = Math.max(0, lineIdx - FUNC_START_SCAN_BACK); i < lineIdx; i++) {
    if (FUNC_START_RE.test(String(lines[i] || ''))) scopeStart = i;
  }
  // 向后找闭括号粗略平衡点（保守取 20 行），期间出现 mkdir 即豁免
  const scopeEnd = Math.min(lines.length, lineIdx + MK_DIR_SCOPE_LOOKAHEAD);
  for (let i = scopeStart; i < scopeEnd; i++) {
    if (i === lineIdx) continue;
    if (MKDIR_RE.test(String(lines[i] || ''))) return true;
  }
  return false;
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
