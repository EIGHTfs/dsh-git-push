// 架构事实提取（事实层）。
//
// 定位（与 archify 的分工）：本插件做「事实导出」，archify 做「渲染」。
//   这里产出的每一条事实都必须能**反查到真实文件/符号**——这是与「让 AI 自由生成 JSON」的本质区别：
//   我们不编拓扑，只导出代码里已经存在的关系。
//
// 复用既有能力（不重写）：
//   · 文件扫描：lib/audit/collector.js 的 collectTextFiles（已内置 .gitignore / .auditignore 剪枝）
//   · token / AST：lib/ast/* 的 tokenize、checkComplexityAst、maxFunctionLength
//   · 函数清单：lib/ast/size.js 的 funcRangesAst（与 docs/FUNCTIONS.md 同源）
//
// 产出结构：
//   { modules: [{ id, dir, files:[rel], fileCount, funcCount, maxComplexity, maxFuncLines, layer }],
//     edges:   [{ from, to, count, kind:'import'|'resource' }],
//     totals:  { modules, files, funcs, edges } }
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { collectTextFiles } from '../audit/collector.js';
import { checkComplexityAst } from '../ast/control-flow.js';
import { maxFunctionLength } from '../ast/size.js';
import { lineStats } from '../ast/line-count.js';
// 函数清单**必须与 docs/FUNCTIONS.md 同一实现**：实测 lib/ast/size.js 的 funcRangesAst 与
//   scripts/doc-func.mjs 的 scanFileFuncs 结果不同（同一批文件 33 vs 38），
//   用前者会让事实层报的函数数与已发布的 FUNCTIONS.md 对不上。
//   注：这里是 lib 反向引用 scripts（层次上不理想），后续应把扫描器提到 lib 下由两边共用。
import { scanFileFuncs } from '../../scripts/doc-func.mjs';
// 五张事实清单的纯函数扫描器（规范第 3.5 节）：网址 / API / 函数 / 文件
import { scanUrls, scanApis, functionsFromScan } from './lists.js';
// 复用审计侧的「构建产物」判定（连字符/点分隔 hash 文件名、压缩单行等）——提取器不该把打包产物当事实来源
import { isBuildArtifactFile } from '../audit/audit-file.js';
import { scanIoRiskAst } from '../ast/io-risk.js';

/** 源码文件扩展名（事实提取只认这些为「代码」）。 */
const SRC_RE = /\.(m?js|cjs|ts|mts|py|sh)$/;

/**
 * 探测源码根：lib/ → src/ → source/ → 含源码文件最多的顶层目录。
 * 与 scripts/archify-imports.mjs 的口径保持一致（那里是脚本侧的同一逻辑）。
 */
export function detectSourceRoot(repoPath) {
  for (const cand of ['lib', 'src', 'source']) if (existsSync(join(repoPath, cand))) return cand;
  // 代码就在**仓库根**的形态（core.js / cli.js / server.js 全在根目录，没有 lib/src）：
  //   根目录源码文件 >= 3 个即认定源码根是仓库根（用 '.' 表示）。
  //   缺这条时工具侧会挑「文件最多的子目录」当源码根，把根目录真正的核心文件整片漏掉
  //   （实测 Pawchive-downloader 曾因此得到 webui-static / 0 条边）。
  //   注意：这份实现与 scripts/archify-imports.mjs 里的同名函数是**两处逻辑**，
  //   改动必须同步——两处不一致时，工具与预览脚本会对同一个仓库给出不同结构。
  try {
    const rootSrc = readdirSync(repoPath, { withFileTypes: true })
      .filter((it) => it.isFile() && SRC_RE.test(it.name)).length;
    if (rootSrc >= 3) return '.';
  } catch { /* 读不到就继续按子目录挑 */ }
  let best = null;
  let bestCount = 0;
  try {
    for (const it of readdirSync(repoPath, { withFileTypes: true })) {
      if (!it.isDirectory() || it.name.startsWith('.') || it.name === 'node_modules') continue;
      const n = collectSync(join(repoPath, it.name)).filter((f) => SRC_RE.test(f)).length;
      if (n > bestCount) { best = it.name; bestCount = n; }
    }
  } catch { /* 读不到就没有源码根 */ }
  return bestCount > 0 ? best : null;
}

/** 同步列目录下的源码文件（仅用于源码根探测这种小范围统计）。 */
function collectSync(dir, out = [], depth = 0) {
  if (depth > 3) return out;
  try {
    for (const it of readdirSync(dir, { withFileTypes: true })) {
      if (it.name.startsWith('.') || it.name === 'node_modules') continue;
      const p = join(dir, it.name);
      if (it.isDirectory()) collectSync(p, out, depth + 1);
      else out.push(p);
    }
  } catch { /* 忽略不可读目录 */ }
  return out;
}

/**
 * 从一个 IO 调用行里取出文件路径字面量（事实：只认源码里明写的字符串，猜不出来就留空）。
 *
 * 复用关系：调用与读写类型来自 lib/ast/io-risk.js 的 scanIoRiskAst（同一口径）；
 *   它本身不带路径，故这里按行号回到源码里取**像路径的**字符串字面量。
 *   实测坑：直接取第一个字面量会抓到 `'utf8'` / `'buffer'` / 日志模板等噪声，
 *   故要求候选「含 / 或 . 且有扩展名或变量拼接」，并排除常见编码/选项词。
 * @returns {string|null}
 */
export function ioPathFromLine(text, line) {
  const src = String(text).split('\n')[line - 1] || '';
  const NOISE = new Set(['utf8', 'utf-8', 'buffer', 'ascii', 'latin1', 'base64', 'hex', 'json', 'binary', '\\n', 'r', 'w', 'a', 'wx']);
  for (const m of src.matchAll(/['"`]([^'"`\n]{1,200})['"`]/g)) {
    const v = m[1].trim();
    if (!v || NOISE.has(v)) continue;
    // 排除转义序列与模板拼接出来的内容（实测 `\n` 里的反斜杠会被「含 / 或 \」规则误判成路径；
    //   日志与 JSON.stringify 的模板同理）——只认「以路径形态开头」的字符串
    if (/^\\/.test(v) || v.startsWith('${') || v.includes('${')) continue;
    const looksLikePath = /[/\\]/.test(v) || /\.[a-zA-Z0-9]{1,8}$/.test(v);
    if (looksLikePath) return v;
  }
  return null;
}

/**
 * 取「包含第 line 行的**完整语句**」文本（把跨行的表达式拼回一条）。
 *
 * 为什么需要：IO 路径解析原先**按行**取字面量，遇到跨行表达式就漏——
 *   实测 Pawchive cli.js:142 `const LOG_PATH = process.env.PAWCHIVE_LOG || path.join(__dirname, 'pawchive.log');`
 *   这类写法一旦换行，`'pawchive.log'` 就不在同一行上，事实就丢了。
 * 做法（确定性）：向前补齐到语句边界（上一行以 ; { } 结尾，或本行以 const/let/var/function/return 开头），
 *   向后补齐到括号配平；最多各看 8 行，避免把整个文件粘进来。
 * @returns {string} 语句文本（取不到就返回该行本身）
 */
export function statementAt(text, line) {
  const lines = String(text).split('\n');
  const i = line - 1;
  if (i < 0 || i >= lines.length) return '';
  const startsStatement = (s) => /^\s*(const|let|var|function|return|if|for|while|await|export)\b/.test(s);
  let buf = lines[i];
  let j = i - 1;
  while (j >= 0 && i - j <= 8 && !/[;{}]\s*$/.test(lines[j]) && !startsStatement(buf)) {
    buf = `${lines[j]}\n${buf}`;
    j -= 1;
  }
  const count = (s, re) => (s.match(re) || []).length;
  let k = i + 1;
  while (k < lines.length && k - i <= 8
    && count(buf, /[([{]/g) > count(buf, /[)\]}]/g)) {
    buf += `\n${lines[k]}`;
    k += 1;
  }
  return buf;
}

/**
 * 收集文件内「变量名 → 路径字面量」映射，供 IO 提取回填**变量间接引用**的路径。
 *
 * 为什么需要：IO 路径提取原本只看**调用同一行**上的字面量，遇到 `fs.readFileSync(fp)` 这种
 *   变量间接引用就一条都拿不到（实测 Pawchive-downloader 的 cli.js：真实 IO 里
 *   `pawchive-index.html` / `creators-cache.json` / `pawchive.log` 全在变量里，
 *   结果只提取到直接写在调用行上的 `.env`）。
 *
 * 确定性口径（不猜）：只认本文件内 `const/let/var NAME = <含字符串字面量的表达式>`，
 *   取该表达式里**最后一个像路径的字面量**（`path.join(__dirname, '.env')` → `.env`；
 *   `path.join(ROOT, 'cache', 'x.json')` → `x.json`）。
 * @returns {Map<string,string>} 变量名 → 路径字面量
 */
export function collectPathConsts(text) {
  const map = new Map();
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    // 只处理「声明」开头的行；表达式本身用 statementAt 取**完整语句**（支持跨行）
    if (!/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/.test(lines[i])) continue;
    const stmt = statementAt(text, i + 1);
    const m = stmt.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/);
    if (!m) continue;
    const [, name, rhs] = m;
    const lits = [...rhs.matchAll(/['"`]([^'"`\n]{1,200})['"`]/g)].map((x) => x[1]);
    const cand = lits.reverse().find((v) => !v.startsWith('${') && (/[/\\]/.test(v) || /\.[a-zA-Z0-9]{1,8}$/.test(v)));
    if (cand) map.set(name, cand);
  }
  return map;
}

/**
 * 从一行里取出**最多两个**路径字面量（复制/移动这类调用有源与目标两个路径）。
 * 规则与 ioPathFromLine 一致：只认像路径的具体字面量，模板拼接与编码噪声不算。
 * @returns {string[]}
 */
export function ioPathsFromLine(text, line) {
  const src = String(text).split('\n')[line - 1] || '';
  const NOISE = new Set(['utf8', 'utf-8', 'buffer', 'ascii', 'latin1', 'base64', 'hex', 'json', 'binary', '\\n', 'r', 'w', 'a', 'wx']);
  const out = [];
  for (const m of src.matchAll(/['"`]([^'"`\n]{1,200})['"`]/g)) {
    const v = m[1].trim();
    if (!v || NOISE.has(v)) continue;
    if (/^\\/.test(v) || v.startsWith('${') || v.includes('${')) continue;
    if (!(/[/\\]/.test(v) || /\.[a-zA-Z0-9]{1,8}$/.test(v))) continue;
    out.push(v);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * 提取一个文件的 IO 事实：读了哪些路径、写了哪些路径。
 *   ① fs 调用：复用 lib/ast/io-risk.js 的 scanIoRiskAst（同一口径拿读写分类）+ 行内路径字面量
 *   ② **fetch / apiFetch 的字符串字面量路径**：主题类插件的数据文件常走 HTTP 取（如
 *      `apiFetch("/theme-mediascape-assets/boot/boot.json")`），fs 扫描看不见；
 *      这里按 kind='read' 收进来，路径是否落回仓库由上层做「唯一后缀匹配」再判定。
 * @returns {{reads:string[],writes:string[]}}
 */
export function extractFileIo(text) {
  const reads = new Set();
  const writes = new Set();
  const entries = []; // IO 明细（op/path/line），供 IR 的 io 清单
  // **只解析一次**：这两个原本写在命中循环里，等于「每个 IO 命中都把整个文件重解析一遍」
  //   ⇒ O(命中数 × 文件行数) 的平方级开销。实测后果：扫一个有几百处 IO 的仓库 >120 秒跑不完
  //   （archify 仓库 299 个源码文件，此前直接超时）。提到循环外后按文件线性。
  const lines = String(text).split('\n');
  const consts = collectPathConsts(text);
  let hits = [];
  try { hits = scanIoRiskAst(text) || []; } catch { hits = []; }
  for (const h of hits) {
    // **复用 io-risk 的 kind 分类**（实测它已覆盖 read/write/rename/delete），本函数只做映射：
    //   read → 读；write → 写；rename（copyFileSync/renameSync）→ **源读 + 目标写**；
    //   delete（unlinkSync）→ 写（对文件系统是一次变更）
    let paths = ioPathsFromLine(text, h.line);
    if (!paths.length) {
      // 变量间接引用：调用行上是 `fs.readFileSync(fp)` 这种变量，字面量在别的行上。
      //   回填本文件内 `const/let/var NAME = <含路径字面量>` 的映射（实测 Pawchive cli.js 的真实 IO
      //   全在变量里，缺这条就只拿到直接写在调用行上的 `.env`）。
      const src = lines[h.line - 1] || '';
      for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) {
        if (consts.has(m[0]) && !paths.includes(consts.get(m[0]))) paths.push(consts.get(m[0]));
        if (paths.length >= 2) break;
      }
    }
    if (!paths.length) continue;
    // 明细（供 IR 的 io 清单用）：op / path / 行号——规范第 3.5 节要求每条都可反查
    for (const p of paths) entries.push({ op: h.kind, path: p, line: h.line });
    if (h.kind === 'read') reads.add(paths[0]);
    else if (h.kind === 'write') writes.add(paths[0]);
    else if (h.kind === 'rename') { reads.add(paths[0]); if (paths[1]) writes.add(paths[1]); }
    else if (h.kind === 'delete') writes.add(paths[0]);
  }
  // fetch 类（含 apiFetch / httpFetch 等以 fetch 结尾的调用）的字符串字面量路径
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue; // 注释里的示例不算事实
    for (const m of line.matchAll(/\b\w*fetch\w*\s*\(\s*['"`]([^'"`\n]{1,200})['"`]/gi)) {
      const v = m[1].trim();
      if (v) reads.add(v);
    }
  }
  return { reads: [...reads], writes: [...writes], entries };
}
/**
 * 把源码里的 IO/URL 路径解析成「相对仓库根」的路径。
 *   ① 相对路径（`./x`、`../x`）→ 按读取文件所在目录归一（normalizeIoPath）
 *   ② 其它形态（服务端 URL 路径如 `/theme-mediascape-assets/boot/boot.json`）→
 *      用**唯一后缀匹配**落回仓库真实文件：只有当该路径的尾部在仓库里**唯一命中**一个文件时才算事实，
 *      命中 0 个或多个一律放弃（不猜）。这样主题类插件走 fetch 的数据文件也能上图。
 * @param {string} baseDir 读取文件所在目录
 * @param {string} p 源码里的路径字面量
 * @param {string[]} repoFiles 仓库内文件相对路径清单
 * @returns {string|null}
 */
export function resolveIoPath(baseDir, p, repoFiles = []) {
  const s = String(p || '').replace(/\\/g, '/').trim();
  if (!s) return null;
  if (s.startsWith('.')) return normalizeIoPath(baseDir, s);
  // 唯一后缀匹配：从完整路径开始逐级去掉前导段，直到在仓库里唯一命中
  const segs = s.replace(/^\/+/, '').split('/').filter(Boolean);
  for (let i = 0; i < segs.length; i += 1) {
    const suffix = segs.slice(i).join('/');
    const hits = repoFiles.filter((f) => f === suffix || f.endsWith(`/${suffix}`));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null; // 歧义 ⇒ 不猜
  }
  return null;
}

/**
 * 把源码里的 IO 路径归一成「相对仓库根」的形式。
 *   只处理相对路径（`./x`、`../x`）：绝对路径与裸名（`utf8` 之类已被上游过滤）不归一。
 *   `a/b.js` 读 `../tree-doc.json` → `tree-doc.json`；读 `./pkg.json` → `a/pkg.json`。
 * @returns {string|null} 归一后的仓库相对路径（无法归一返回 null）
 */
export function normalizeIoPath(baseDir, p) {
  const s = String(p || '').replace(/\\/g, '/');
  if (!s || s.startsWith('/') || /^[a-zA-Z]+:/.test(s)) return null;
  const stack = s.startsWith('.') && baseDir ? baseDir.split('/') : [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { stack.pop(); continue; }
    stack.push(seg);
  }
  return stack.join('/') || null;
}

export function importSpecifiers(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/g)) out.add(m[1]);
  return [...out];
}

/** 把一个 import 说明符归属到源码根下的模块 id（不在源码根下返回 null）。 */
export function resolveModule(fromRel, spec, sourceRoot) {
  if (!spec.startsWith('.')) return null;
  const parts = resolve(dirname(join('/', fromRel)), spec).slice(1).split(sep);
  // 源码根就是**仓库根**（'.'）时，模块 id = 目标文件自身（去扩展名）——
  //   不能走下面的 parts[0] !== sourceRoot 判断：那时 parts[0] 是文件名，永远不等于 '.'，
  //   会把所有边丢掉（实测 Pawchive-downloader 工具侧因此 9 模块 0 边）。
  //   注意：这与 scripts/archify-imports.mjs 的 resolveLibModule 是**两处逻辑**，改动必须同步。
  if (sourceRoot === '.') {
    const base = parts[parts.length - 1] || '';
    return base.replace(/\.(m?js|cjs|ts|mts)$/, '') || null;
  }
  if (parts[0] !== sourceRoot || parts.length < 2) return null;
  return parts[1].replace(/\.(m?js|cjs|ts|mts)$/, '');
}

/** 架构事实提取默认最多扫描的文件数（大仓库限流；调用方可用 maxFiles 覆盖）。 */
const DEFAULT_MAX_FILES = 4000;

/**
 * 提取一个仓库的架构事实。
 * @param {string} repoPath 仓库根
 * @param {{maxFiles?:number}} [opts] maxFiles 限制扫描文件数（大仓库可用）
 * @returns {Promise<{modules:object[],edges:object[],totals:object,sourceRoot:string|null}>}
 */
export async function extractArchFacts(repoPath, { maxFiles = DEFAULT_MAX_FILES } = {}) {
  const sourceRoot = detectSourceRoot(repoPath);
  if (!sourceRoot) return { modules: [], edges: [], totals: { modules: 0, files: 0, funcs: 0, edges: 0 }, sourceRoot: null };
  // 复用收集器：它已处理 .gitignore / .auditignore 与文本判定。
  //   注意：它返回的是 { path, ext, full }（**不含 text**），故这里自己读盘——
  //   实测把 f.text 当正文会得到 undefined，导致函数数/复杂度/边全部为 0。
  // `respectAuditIgnore: false` —— 架构事实要的是「仓库里有什么代码」，不是「审计扫哪些」。
  //   `.auditignore` 是**审计豁免**（别对它报误报），把它当排除项会让被豁免的文件整片从架构图消失
  //   （实测 Pawchive 的 adapters/KToolBox-webui.js 因此整目录缺席，连带 4 条路由定义丢失）。
  const collected = await collectTextFiles(repoPath, { depth: 10, gitIgnoreRoot: repoPath, respectAuditIgnore: false });
  // 后缀匹配的候选必须是**全部已收集文件**（含 .json/.yml/.md）——实测踩过：只拿源码文件清单
  //   （.js/.mjs/.ts/…）去匹配，`/theme-mediascape-assets/boot/boot.json` 永远匹配不到 boot/boot.json。
  const allRepoFiles = collected.map((f) => relative(repoPath, f.full).split(sep).join('/'));
  const files = collected
    .map((f) => ({ rel: relative(repoPath, f.full).split(sep).join('/'), full: f.full }))
    .filter((f) => SRC_RE.test(f.rel))
    // 排除**构建产物**（如 webui-static/assets/MCPPage-Cx6aA0Qm.js 这类带 hash 的打包文件）：
    //   实测它们会被当成事实来源，把 API/URL 清单污染成噪声（5 条「路由定义」全来自打包产物）。
    //   判定复用审计侧同一函数，避免两套口径。
    .filter((f) => !isBuildArtifactFile(f.rel))
    .slice(0, maxFiles)
    .map((f) => {
      try { return { ...f, text: readFileSync(f.full, 'utf8') }; } catch { return { ...f, text: '' }; }
    });

  const byModule = new Map();
  const edgeCount = new Map();
  const edgeEvidence = new Map(); // (from→to) → 首次出现的 `文件:行号`（IR 的 evidence）
  // 五张事实清单（规范第 3.5 节）——逐文件收集，每条都可反查
  const filesList = [];
  const functionsList = [];
  const urlsList = [];
  const apisList = [];
  const ioList = [];
  let ioEntries = [];
  for (const f of files) {
    const parts = f.rel.split('/');
    // 模块 id：源码根为 '.'（代码全在仓库根）时，**每个源码文件自己就是一个模块**，id 取去扩展名的文件名；
    //   这条分支必须与 resolveModule 的 '.' 分支保持一致——实测漏了它时两侧 id 对不上
    //   （这边给 `core.js`、那边给 `progress`）⇒ 边全部匹配失败、提取到 0 条边。
    const modId = sourceRoot === '.'
      ? (parts[0] || '').replace(/\.(m?js|cjs|ts|mts)$/, '')
      : (parts[0] === sourceRoot
        ? (parts.length > 2 ? parts[1] : (parts[1] || '').replace(/\.(m?js|cjs)$/, ''))
        : parts[0]);
    if (!modId) continue;
    if (!byModule.has(modId)) byModule.set(modId, { id: modId, files: [], funcCount: 0, funcNames: [], maxComplexity: 0, maxFuncLines: 0, ioReads: [], ioWrites: [] });
    const mod = byModule.get(modId);
    mod.files.push(f.rel);
    try {
      // IO 事实（复用 io-risk 的读写分类 + 行内路径字面量）：模块读了哪些文件、写了哪些文件。
      //   **路径要先归一**：源码里的 IO 路径是相对**读取它的那个文件**的（`./package.json`、
      //   `../../tree-doc.json`），不归一就会出现同物不同写法（实测 `./package.json` 与
      //   `package.json` 被当成两个数据文件节点）。这里统一解析成「相对仓库根」的路径。
      const io = extractFileIo(f.text);
      ioEntries = io.entries || [];
      const baseDir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
      for (const p of io.reads) {
        const rel = resolveIoPath(baseDir, p, allRepoFiles);
        if (rel && !mod.ioReads.includes(rel)) mod.ioReads.push(rel);
      }
      for (const p of io.writes) {
        const rel = resolveIoPath(baseDir, p, allRepoFiles);
        if (rel && !mod.ioWrites.includes(rel)) mod.ioWrites.push(rel);
      }
    } catch { /* IO 提取失败不影响其它事实 */ }
    try {
      // 返回形状实测：funcRangesAst → 数组；maxFunctionLength → 数字；
      //   checkComplexityAst → [{line,name,complexity,level}]，故取最大 complexity
      // 函数数复用 **docs/FUNCTIONS.md 的同一实现**（scanFileFuncs），保证两边对得上；
      //   同时收集**函数名**（供架构图用 cards 列函数清单——同一份事实，不再另扫）。
      //   注意其返回形状是 { file, funcs, totalLines }——取 funcs（实测踩过：直接取返回值 .length 恒为 0）
      const funcs = scanFileFuncs(f.full).funcs || [];
      mod.funcCount += funcs.length;
      for (const fn of funcs) {
        // 不再限制每模块的函数名个数（原来最多留 60 个）：事实层负责给全，页面折叠由渲染器处理。
        if (fn?.name && !mod.funcNames.includes(fn.name)) mod.funcNames.push(fn.name);
      }
      const cx = checkComplexityAst(f.text);
      const cxMax = Array.isArray(cx) ? cx.reduce((n, x) => Math.max(n, Number(x.complexity) || 0), 0) : 0;
      mod.maxComplexity = Math.max(mod.maxComplexity, cxMax);
      mod.maxFuncLines = Math.max(mod.maxFuncLines, Number(maxFunctionLength(f.text)) || 0);
    } catch { /* 单文件解析失败不影响其它事实 */ }
    // 五张事实清单（规范第 3.5 节）：文件 / 函数 / 网址 / IO / API。
    //   都是**逐文件收集**，每条都带 file（+ 行号），保证可反查；取不到就是空数组，不编造。
    const isSrc = SRC_RE.test(f.rel);
    // 行数**同时给出总行与代码行**（代码行 = 总行 − 纯注释行 − 空行，口径见 lib/ast/line-count.js）：
    //   只给总行时，注释/空行多的文件会显得比实际大；只给代码行，又与「文件多少行」的直觉不符。
    //   lines 仍为总行（保持既有消费者语义不变），新增 codeLines 供规模判断使用。
    const lineInfo = lineStats(f.text);
    filesList.push({ path: f.rel, lines: lineInfo.total, codeLines: lineInfo.code, funcs: mod.funcCount, isSource: isSrc });
    if (isSrc) {
      // scanFileFuncs 收的是绝对路径，会把绝对路径回显到 file 字段 ⇒ 覆盖成仓库相对路径（规范要求可反查且不含本机路径）
      functionsList.push(...functionsFromScan({ ...scanFileFuncs(f.full), file: f.rel }, modId));
      urlsList.push(...scanUrls(f.text, f.rel, modId));
      apisList.push(...scanApis(f.text, f.rel, modId));
    }
    for (const en of ioEntries) ioList.push({ op: en.op, path: en.path, file: f.rel, line: en.line, module: modId });
    for (const spec of importSpecifiers(f.text)) {
      const to = resolveModule(f.rel, spec, sourceRoot);
      if (!to || to === modId) continue;
      const k = `${modId}→${to}`;
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
      // **证据行号**：记该 import 在本文件里**首次出现**的行（IR 的 edges[].evidence 用它）。
      //   只取首次：同一模块对之间的多次引用合并成一条边，证据留最早那处即可定位。
      if (!edgeEvidence.has(k)) {
        const idx = f.text.indexOf(spec);
        const line = idx < 0 ? 0 : f.text.slice(0, idx).split('\n').length;
        edgeEvidence.set(k, `${f.rel}:${line}`);
      }
    }
  }
  const modules = [...byModule.values()].map((m) => ({
    id: m.id,
    dir: `${sourceRoot}/${m.id}`,
    files: m.files,
    fileCount: m.files.length,
    funcCount: m.funcCount,
    maxComplexity: m.maxComplexity,
    maxFuncLines: m.maxFuncLines,
    funcNames: m.funcNames,
    ioReads: m.ioReads,
    ioWrites: m.ioWrites,
  }));
  const ids = new Set(modules.map((m) => m.id));
  const edges = [...edgeCount.entries()]
    .map(([k, count]) => {
      const [from, to] = k.split('→');
      const ev = edgeEvidence.get(k);
      return { from, to, count, kind: 'import', ...(ev ? { evidence: [ev] } : {}) };
    })
    .filter((e) => ids.has(e.from) && ids.has(e.to));
  return {
    modules,
    edges,
    // 五张事实清单（规范第 3.5 节）：图的原始形态，与 nodes/edges 同源
    files: filesList,
    functions: functionsList,
    urls: urlsList,
    io: ioList,
    apis: apisList,
    totals: {
      modules: modules.length,
      files: files.length,
      funcs: modules.reduce((n, m) => n + m.funcCount, 0),
      edges: edges.length,
    },
    sourceRoot,
  };
}
