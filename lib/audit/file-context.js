import { readText } from './collector.js';

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
  for (let i = Math.max(0, lineIdx - 60); i < lineIdx; i++) {
    if (FUNC_START_RE.test(String(lines[i] || ''))) scopeStart = i;
  }
  // 向后找闭括号粗略平衡点（保守取 20 行），期间出现 mkdir 即豁免
  const scopeEnd = Math.min(lines.length, lineIdx + 20);
  for (let i = scopeStart; i < scopeEnd; i++) {
    if (i === lineIdx) continue;
    if (MKDIR_RE.test(String(lines[i] || ''))) return true;
  }
  return false;
}

/**
 * 外部 API 调用超时语义豁免：
 * robustness/timeout-on-external-api 规则用纯 regex 匹配 `fetch(`/`axios.(` 等调用，
 * 无法看到同一调用表达式内的超时参数 → 把「已设置 AbortSignal.timeout / AbortController /
 * timeout 选项」的调用误报成无超时。
 * 判定：命中行内联有超时设置（单行调用），或命中行前/后（各最多 12 行、括号未闭合区间）
 * 出现 AbortSignal.timeout / AbortController / timeout: / timeout = 即视为已设超时。
 * 2026-09-20 修误报：只往后看会漏「init/options 定义在调用之前」的写法——
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
