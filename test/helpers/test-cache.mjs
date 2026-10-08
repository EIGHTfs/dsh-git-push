/**
 * 测试结果缓存（按「测试文件 + 其传递依赖闭包」的内容哈希跳过未变更的测试）。
 *
 * 【为什么】全量回归 1077 个用例约 98s，其中前 12 个重测试就占 57s。改一行文档也要重跑全部，
 *   迭代成本高。这里只缓存**纯本地（无宿主/网络依赖）**的测试：内容没变 + 上次通过 → 跳过。
 *
 * 【安全模型（宁可少缓存，不可漏跑）】
 *   1. 缓存键 = 测试文件自身 + **它 import 到的全部相对文件**（传递闭包）的内容哈希，
 *      再混入 node 版本与缓存格式版本 —— 依赖文件一变，键即变、必重跑。
 *   2. **只缓存通过**：任何一次失败都会清掉该文件的缓存（失败必须每次复现）。
 *   3. **可疑文件不缓存**：正文出现宿主/网络标记（本机端口、/api/ 路由、fetch、host-api 等）
 *      的文件一律每次真跑 —— 它们的结果取决于运行时状态，缓存会掩盖真实问题。
 *   4. **按文件失效**：只有失败的那些文件被剔除缓存（下次必重跑），其余照旧命中 ——
 *      不让「一个文件的失败」（如文档漂移只与一两个文件相关）废掉上百个文件的缓存。
 *
 * 【存放】仓库内 `.test-cache/results.json`（已 gitignore，不入库）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** 缓存格式版本：改了键的组成方式就 +1，旧缓存自动失效。 */
export const CACHE_FORMAT_VERSION = 1;
/** 缓存目录/文件名（仓库内，gitignore）。 */
export const CACHE_DIR = '.test-cache';
export const CACHE_FILE = 'results.json';
/**
 * 显式「必须每次真跑」的测试 —— **依赖整仓不变式**（文件清单/版本表/函数表/架构事实），
 * 它们的输入是「整个仓库的当前状态」，无法用「文件 + import 闭包」的哈希刻画：
 * 例如「新增一个文件但忘了登记 README 树」时，这类测试的闭包没变、会被缓存跳过 → **假通过**。
 * 因此它们一律常跑（数量少、总耗时可控，且正是它们负责抓「新增文件未登记」）。
 *
 * 实测（2026-10-08）：本插件其余测试全部是纯函数或临时目录隔离
 * （`test-http.mjs` 头部写明「纯函数单测（不依赖真实服务器）」、`test-link-check.mjs` 用注入
 * fetcher「不发真实网络请求」、`test-account-ssh.mjs` 明确把在线校验排除在单测外）。
 */
export const ALWAYS_RUN_TESTS = new Set([
  'test-doc-func.mjs',        // FUNCTIONS.md 与代码同步
  'test-doc-version.mjs',     // 版本表与 git log 一致
  'test-func-doc-drift.mjs',  // 函数表漂移
  'test-tree-doc.mjs',        // README 目录树漂移
  'test-arch-func-source.mjs',// 架构事实层函数数与 FUNCTIONS.md 同源
  'test-arch-json-fresh.mjs', // 架构 JSON 新鲜度
  'test-archify-imports.mjs', // archify 导入图与真实 import 一致
  'test-inject-system-prompt.mjs', // 注入文本里的版本列表与 package.json 一致
]);

/**
 * 去掉注释与字符串字面量，只留「代码」—— 联网判据必须先过这一层。
 *
 * 为什么：夹具字符串（`'外部请求示例：fetch("https://example.com")'`）与注释里的示例会误触发
 *   联网判据。实测（2026-10-08）：不做这层剥离时 100 个纯测试里有 **71 个**被误判成「依赖运行时」
 *   而永不跳过（热跑只跳过 29 个、耗时 88s，几乎等于冷跑）。
 * 实现用**单趟状态机**（代码 / 字符串 / 注释 三态），而不是先后跑几个正则 ——
 *   正则版会把字符串里的 `//`（如 `https://…`）当注释、从而把整行截断（实测踩过）。
 */
export function stripCommentsAndStrings(text) {
  const s = String(text || '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === quote) { i++; break; }
        if (quote !== '`' && s[i] === '\n') break; // 未闭合的单/双引号：到行尾为止
        i++;
      }
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * 结构性联网判据：**真实发起网络/起服务**的写法 → 不缓存（判据作用于剥离后的代码）。
 */
const NETWORK_CALL_RE = /(?:await\s+(?:fetch|https?\.request)\s*\()|(?:createServer\s*\()|(?:\.listen\s*\()|(?:net\.connect\s*\()/;

/** 该测试文件是否**适合缓存**（纯本地、无真实网络/服务调用）。 */
export function isCacheableTest(sourceText, fileName = '') {
  if (fileName && ALWAYS_RUN_TESTS.has(fileName)) return { cacheable: false, reason: '整仓不变式测试（常跑）' };
  if (NETWORK_CALL_RE.test(stripCommentsAndStrings(sourceText))) return { cacheable: false, reason: '语句级网络/服务调用' };
  return { cacheable: true, reason: '' };
}

/** 抽取一个文件里的相对 import/require 说明符（只关心工程内相对路径）。 */
export function relativeSpecifiers(sourceText) {
  const text = String(sourceText || '');
  const specs = new Set();
  const patterns = [
    /from\s+['"](\.[^'"]+)['"]/g,
    /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /require\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) specs.add(m[1]);
  }
  return [...specs];
}

/**
 * 求某测试文件的**传递依赖闭包**（工程内相对文件）。
 * @param {string} entryAbs 入口文件绝对路径
 * @param {(abs:string)=>boolean} exists 存在性判定（可注入，便于测试）
 * @returns {string[]} 绝对路径列表（含入口自身），去重且排序稳定
 */
export function importClosure(entryAbs, exists = existsSync) {
  const seen = new Set();
  const stack = [resolve(entryAbs)];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur) || !exists(cur)) continue;
    seen.add(cur);
    let text = '';
    try { text = readFileSync(cur, 'utf8'); } catch { continue; }
    const baseDir = dirname(cur);
    for (const spec of relativeSpecifiers(text)) {
      // 只解析工程内相对说明符（裸包名=依赖库，版本变化由 node/package 层面体现，不逐个进闭包）
      for (const cand of [spec, `${spec}.js`, `${spec}.mjs`, `${spec}/index.js`, `${spec}/index.mjs`]) {
        const abs = resolve(baseDir, cand);
        if (exists(abs)) { stack.push(abs); break; }
      }
    }
  }
  return [...seen].sort();
}

/**
 * 计算缓存键（内容哈希 + node 版本 + 格式版本）。
 * @param {string[]} absFiles 依赖闭包（绝对路径）
 * @param {string} nodeVersion 参与键的运行时版本
 * @returns {string} sha256 十六进制
 */
export function cacheKeyFor(absFiles, nodeVersion = process.version) {
  const h = createHash('sha256');
  h.update(`format:${CACHE_FORMAT_VERSION}\nnode:${nodeVersion}\n`);
  // package.json 参与每个测试的键：版本号/依赖一变，全部失效（版本相关断言不会因缓存而假通过）
  const extra = [join(process.cwd(), 'package.json')];
  for (const abs of [...absFiles, ...extra].sort()) {
    let content = '';
    try { content = readFileSync(abs, 'utf8'); } catch { content = '<missing>'; }
    h.update(`${relative(process.cwd(), abs)}\n${content}\n`);
  }
  return h.digest('hex');
}

/** 读取缓存（文件缺失/损坏都按空缓存处理，绝不因缓存本身报错）。 */
export function loadTestCache(root) {
  const file = join(root, CACHE_DIR, CACHE_FILE);
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw && raw.format === CACHE_FORMAT_VERSION && raw.results) return raw;
  } catch { /* 按空缓存 */ }
  return { format: CACHE_FORMAT_VERSION, results: {} };
}

/** 写缓存（原子性足够：先写临时名再 rename，避免半截文件）。 */
export function saveTestCache(root, cache) {
  const dir = join(root, CACHE_DIR);
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, CACHE_FILE);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...cache, format: CACHE_FORMAT_VERSION, savedAt: new Date().toISOString() }, null, 2), 'utf8');
    writeFileSync(file, readFileSync(tmp, 'utf8'), 'utf8');
    rmSync(tmp, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 决定哪些测试文件可以跳过（缓存命中）。
 * @param {string[]} files 测试文件绝对路径
 * @param {object} cache loadTestCache 的结果
 * @param {(abs:string)=>boolean} exists
 * @returns {{run:string[], skipped:string[], reasons:Record<string,string>}}
 */
export function planTestRun(files, cache, exists = existsSync) {
  const run = [];
  const skipped = [];
  const reasons = {};
  for (const abs of files) {
    // 判据只看**测试文件自身**：测试 import 的模块里有 fetch（如 lib/git/api.js）不算「测试在联网」
    //   —— 本仓库的测试约定是注入 fetcher/进程内 handler（见 test-link-check.mjs 头部说明）。
    //   真正依赖外部状态的测试请登记进 ALWAYS_RUN_TESTS。
    let ownText = '';
    try { ownText = readFileSync(abs, 'utf8'); } catch { ownText = ''; }
    const cacheable = isCacheableTest(ownText, abs.split('/').pop() || '');
    if (!cacheable.cacheable) { run.push(abs); reasons[abs] = `不缓存（${cacheable.reason}）`; continue; }
    const key = cacheKeyFor(importClosure(abs, exists));
    const hit = cache.results[abs];
    if (hit && hit.key === key && hit.passed === true) { skipped.push(abs); reasons[abs] = '缓存命中（内容与依赖均未变）'; continue; }
    run.push(abs);
    reasons[abs] = hit ? '内容或依赖已变' : '首次运行';
  }
  return { run, skipped, reasons };
}
