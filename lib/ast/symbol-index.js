/**
 * 跨文件符号索引（稳定 ID + import 解析 + 跨文件调用落地）
 *
 * 【为什么需要】现有 lib/ast 是**单文件**分析：callgraph.js 头部明确「跨文件调用…不强行判断」。
 *   要支撑「谁调用了谁」「哪些导出没人用」这类跨文件事实，先得有一份工程级符号索引。
 *
 * 【稳定 ID】`<清洗后的相对路径>#<清洗后的符号名>`，**不含行号**——行号会随编辑漂移，
 *   把行号放进 ID 会让缓存与引用全废。ID 只由「路径 + 符号名」决定，改行、加注释都不变。
 *
 * 【调用落地（宁缺勿错）】每个调用点按三级判定落到定义：
 *   ① local  —— 本文件有同名声明
 *   ② import —— 该名字来自 import/require，沿说明符解析到工程内文件，取该文件的导出
 *   ③ unique —— 全工程**有且仅有一个**文件导出该名字
 *   三级都不成立或出现多个候选 → **不连边**，记进 unresolved（供「分析覆盖率」统计）。
 *
 * 【纯函数化】不碰文件系统：调用方传 `files`（相对路径列表）与 `readFile(rel)`，
 *   便于单测用内存工程、也便于上层换成带缓存的读取（配合按文件失效的增量索引）。
 */
import { tokenize } from './tokenizer.js';
import { collectNamedFnRanges } from './callgraph.js';

/** 解析相对说明符时的候选后缀（按顺序尝试）。 */
const RESOLVE_SUFFIXES = ['', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '/index.js', '/index.mjs', '/index.ts', '/index.tsx'];
/** 声明类关键字（后接标识符即为声明）。 */
const DECL_KEYWORDS = ['function', 'class', 'const', 'let', 'var'];
/** 调用点排除的关键字（形如 `if (`、`return (` 不是调用）。 */
const CALL_EXCLUDE = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'new', 'function', 'import']);
/**
 * TS 项目的 ESM 写法：源码是 `x.ts`，import 却写 `./x.js`（Node 解析规范）。
 * 因此当 `.js/.mjs/.cjs` 后缀解析不到时，把后缀换成对应 TS 扩展再试一遍。
 */
const TS_FALLBACK = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts', '.ts'], '.cjs': ['.cts', '.ts'], '.jsx': ['.tsx'] };
/** 往回找 `export` 关键字的最多 token 数（`export function f` / `export const f` 都在 4 个 token 内）。 */
const EXPORT_LOOKBACK = 4;
/** 往回找 CJS `require` 赋值左侧名字的最多 token 数（`const { a, b } = require(...)`）。 */
const CJS_LOOKBACK = 12;

/** 把任意字符串清洗成可用作 ID 片段的标识符（保留 `$`，JS 合法）。 */
export function sanitizeId(input) {
  return String(input || '').replace(/[^A-Za-z0-9_$]/g, '_');
}

/**
 * 生成稳定符号 ID（不含行号）。
 * @param {string} relPath 相对路径（如 `lib/a.js`）
 * @param {string} name 符号名
 * @returns {string} 如 `lib_a_js#alpha`
 */
export function symbolId(relPath, name) {
  const cleanPath = sanitizeId(String(relPath || '').replace(/\\/g, '/').replace(/\.[^./]+$/, ''));
  return `${cleanPath}#${sanitizeId(name)}`;
}

/** 去掉字符串字面量的引号。 */
function unquote(raw) {
  const s = String(raw || '');
  return s.length >= 2 && (s[0] === '"' || s[0] === "'" || s[0] === '`') ? s.slice(1, -1) : s;
}

/** 收集声明：`function/class/const|let|var NAME`，并标记是否被 export。 */
function collectDeclarations(tokens) {
  const decls = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !DECL_KEYWORDS.includes(t.value)) continue;
    const nameTok = tokens[i + 1];
    if (!nameTok || nameTok.type !== 'ident') continue;
    // 往回看是否为 `export`（`export function f` / `export const f`）
    let exported = false;
    for (let j = i - 1; j >= 0 && j > i - EXPORT_LOOKBACK; j--) {
      if (tokens[j].type === 'comment' || tokens[j].type === 'ws') continue;
      exported = tokens[j].type === 'ident' && tokens[j].value === 'export';
      break;
    }
    decls.push({ name: nameTok.value, kind: t.value === 'function' ? 'function' : t.value, line: nameTok.line, exported });
  }
  return decls;
}

/**
 * 收集 ESM 导入绑定：`import X from 's'` / `import {a, b as c} from 's'` / `import * as ns from 's'`。
 * 每条绑定记 `{local, imported}` —— **别名必须保留原名**，否则解析时拿本地名去目标文件找导出必然落空。
 */
function collectEsmImports(tokens) {
  const imports = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'import') continue;
    const bindings = [];
    let source = '';
    for (let j = i + 1; j < tokens.length; j++) {
      const tk = tokens[j];
      if (tk.type === 'str') { source = unquote(tk.value); break; }
      if (tk.type === 'punct' && tk.value === ';') break;
      if (tk.type === 'ident' && (tk.value === 'from' || tk.value === 'type')) continue;
      if (tk.type === 'ident' && tk.value === 'as') {
        const ns = tokens[j + 1]; // `import * as ns`：整模块命名空间，按 '*' 记账
        if (ns && ns.type === 'ident') { bindings.push({ local: ns.value, imported: '*' }); j++; }
        continue;
      }
      if (tk.type !== 'ident') continue;
      const next = tokens[j + 1];
      if (next && next.type === 'ident' && next.value === 'as') {
        const alias = tokens[j + 2]; // `{ imported as local }`
        if (alias && alias.type === 'ident') { bindings.push({ local: alias.value, imported: tk.value }); j += 2; }
        continue;
      }
      const isDefault = next && next.type === 'ident' && next.value === 'from';
      bindings.push({ local: tk.value, imported: isDefault ? 'default' : tk.value });
    }
    if (source) imports.push({ source, bindings, line: t.line });
  }
  return imports;
}

/**
 * 收集 CJS 导入：`const x = require('s')` / `const { a, b: c } = require('s')`。
 * 解构改名（`b: c`）无法从 token 反推，这里按同名近似记账（宁可少解析，不猜错目标）。
 */
function collectCjsImports(tokens) {
  const imports = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'require') continue;
    const open = tokens[i + 1];
    const arg = tokens[i + 2];
    if (!open || open.value !== '(' || !arg || arg.type !== 'str') continue;
    const bindings = [];
    for (let j = i - 1; j >= 0 && j > i - CJS_LOOKBACK; j--) {
      const tk = tokens[j];
      if (tk.type === 'ident' && !['const', 'let', 'var'].includes(tk.value)) bindings.push({ local: tk.value, imported: tk.value });
      if (tk.type === 'punct' && tk.value === '=') break;
    }
    imports.push({ source: unquote(arg.value), bindings, line: t.line });
  }
  return imports;
}

/**
 * 收集调用点：标识符紧跟 `(`，且不在函数声明处、不是关键字、**不是成员调用**。
 *
 * 成员调用（`obj.method(`、`a?.b(`）与符号索引能解析的「跨文件函数调用」不是一类东西：
 *   把它算进来会让「未解析」爆炸（实测 2 万次调用里绝大多数是 `console.log`/`arr.map` 这类），
 *   覆盖率随之虚低、指标失去意义。这里单独计数（skippedMemberCalls）以便如实说明被排除的量。
 * @returns {{calls:Array, skippedMemberCalls:number}}
 */
function collectCallSites(tokens, fnRanges) {
  const calls = [];
  let skippedMemberCalls = 0;
  const declNameIdx = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ident' && DECL_KEYWORDS.includes(t.value) && tokens[i + 1] && tokens[i + 1].type === 'ident') declNameIdx.add(i + 1);
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || CALL_EXCLUDE.has(t.value) || declNameIdx.has(i)) continue;
    const nx = tokens[i + 1];
    if (!nx || nx.type !== 'punct' || nx.value !== '(') continue;
    if (isMemberAccess(tokens, i)) { skippedMemberCalls++; continue; }
    calls.push({ name: t.value, line: t.line, caller: findEnclosingFn(i, fnRanges) });
  }
  return { calls, skippedMemberCalls };
}

/** 该标识符是否是成员访问（前面是 `.` 或 `?.`，跳过空白/注释）。 */
function isMemberAccess(tokens, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    const tk = tokens[j];
    if (tk.type === 'ws' || tk.type === 'comment') continue;
    if (tk.type === 'punct' && (tk.value === '.' || tk.value === '?.')) return true;
    return false;
  }
  return false;
}

/** 找到包含该 token 下标的具名函数（作为调用者）。 */
function findEnclosingFn(idx, fnRanges) {
  for (const [name, [start, end]] of fnRanges) {
    if (idx > start && idx < end) return name;
  }
  return '';
}

/**
 * 提取单文件的符号事实（纯函数）。
 * @param {string} relPath 相对路径
 * @param {string} text 文件全文
 * @returns {{path:string, declarations:Array, imports:Array, calls:Array}}
 */
export function extractFileSymbols(relPath, text) {
  const tokens = tokenize(String(text || ''));
  const fnRanges = collectNamedFnRanges(tokens);
  const { calls, skippedMemberCalls } = collectCallSites(tokens, fnRanges);
  return {
    path: relPath,
    declarations: collectDeclarations(tokens),
    imports: [...collectEsmImports(tokens), ...collectCjsImports(tokens)],
    calls,
    skippedMemberCalls,
  };
}

/**
 * 把 import 说明符解析到工程内文件。
 * @param {string} relPath 引用方相对路径
 * @param {string} source 说明符（如 `./a.js`、`../lib/b`、`react`）
 * @param {Set<string>} fileSet 工程内全部相对路径
 * @returns {string|null} 命中的工程内文件；裸包名或解析不到返回 null
 */
export function resolveSpecifier(relPath, source, fileSet) {
  const spec = String(source || '');
  if (!spec.startsWith('.')) return null; // 裸包名：外部依赖，不解析
  const baseDir = String(relPath).replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const joined = `${baseDir}/${spec}`.replace(/\/\.\//g, '/');
  const parts = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const base = parts.join('/');
  for (const suffix of RESOLVE_SUFFIXES) {
    const cand = base + suffix;
    if (fileSet.has(cand)) return cand;
  }
  // TS 回退：`./x.js` 实际是 `x.ts` / `x.tsx`（Node 解析规范下的 TS 写法）
  const extMatch = base.match(/(\.(?:js|mjs|cjs|jsx))$/);
  if (extMatch) {
    const stem = base.slice(0, -extMatch[1].length);
    for (const alt of TS_FALLBACK[extMatch[1]] || []) {
      if (fileSet.has(stem + alt)) return stem + alt;
    }
  }
  return null;
}

/**
 * 构建工程级符号索引。
 * @param {string[]} files 工程内文件相对路径列表
 * @param {{readFile:(rel:string)=>string}} opts 读取文件内容（调用方提供，便于单测与缓存）
 * @returns {object} 索引对象（见下方字段）
 */
export function buildSymbolIndex(files = [], opts = {}) {
  const readFile = opts.readFile;
  if (typeof readFile !== 'function') throw new TypeError('buildSymbolIndex 需要 readFile(rel)');
  const fileSet = new Set(files);
  const perFile = new Map();
  for (const rel of files) perFile.set(rel, extractFileSymbols(rel, readFile(rel)));
  const exportsByFile = collectExports(perFile);
  const symbols = flattenSymbols(exportsByFile, perFile);
  const { edges, unresolved, importRefs } = resolveCalls(perFile, exportsByFile, fileSet);
  return { files: [...files], symbols, exportsByFile, perFile, edges, unresolved, importRefs, stats: indexStats(perFile, symbols, edges, unresolved) };
}

/** 每个文件的导出表：name → {id, kind, line}。 */
function collectExports(perFile) {
  const out = new Map();
  for (const [rel, facts] of perFile.entries()) {
    const map = new Map();
    for (const d of facts.declarations) {
      if (d.exported) map.set(d.name, { id: symbolId(rel, d.name), kind: d.kind, line: d.line });
    }
    out.set(rel, map);
  }
  return out;
}

/** 全工程符号表：id → {id, file, name, kind, line}。 */
function flattenSymbols(exportsByFile, perFile) {
  const symbols = new Map();
  for (const [rel, map] of exportsByFile.entries()) {
    for (const [name, info] of map.entries()) symbols.set(info.id, { id: info.id, file: rel, name, kind: info.kind, line: info.line });
  }
  for (const [rel, facts] of perFile.entries()) {
    for (const d of facts.declarations) {
      const id = symbolId(rel, d.name);
      if (!symbols.has(id)) symbols.set(id, { id, file: rel, name: d.name, kind: d.kind, line: d.line });
    }
  }
  return symbols;
}

/** 建「名字 → 导出它的文件」反查表（用于 unique 判定）。 */
function buildNameIndex(exportsByFile) {
  const byName = new Map();
  for (const [rel, map] of exportsByFile.entries()) {
    for (const [name, info] of map.entries()) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ file: rel, id: info.id });
    }
  }
  return byName;
}

/** 逐调用点做三级判定，产出跨文件边、未解析清单与被 import 引用到的导出集合。 */
function resolveCalls(perFile, exportsByFile, fileSet) {
  const byName = buildNameIndex(exportsByFile);
  const edges = [];
  const unresolved = [];
  const importRefs = new Set();
  for (const [rel, facts] of perFile.entries()) {
    const localNames = new Set(facts.declarations.map((d) => d.name));
    const importMap = buildImportMap(rel, facts.imports, fileSet, exportsByFile);
    for (const id of importMap.values()) importRefs.add(id);
    for (const call of facts.calls) {
      const hit = resolveOne(rel, call, localNames, importMap, byName);
      if (hit) edges.push(hit);
      else unresolved.push({ file: rel, name: call.name, line: call.line, reason: byName.has(call.name) ? 'ambiguous' : 'unknown' });
    }
  }
  return { edges, unresolved, importRefs };
}

/** 该文件的「本地名 → 目标导出 ID」映射（含 import 解析结果；用 binding.imported 去目标文件找导出）。 */
function buildImportMap(rel, imports, fileSet, exportsByFile) {
  const map = new Map();
  for (const imp of imports) {
    const target = resolveSpecifier(rel, imp.source, fileSet);
    if (!target) continue;
    const exportsOfTarget = exportsByFile.get(target) || new Map();
    for (const b of imp.bindings || []) {
      const exported = exportsOfTarget.get(b.imported);
      if (exported) map.set(b.local, exported.id);
    }
  }
  return map;
}

/** 单个调用点的三级判定。 */
function resolveOne(rel, call, localNames, importMap, byName) {
  if (localNames.has(call.name)) return { from: rel, to: symbolId(rel, call.name), via: 'local', line: call.line, caller: call.caller };
  if (importMap.has(call.name)) return { from: rel, to: importMap.get(call.name), via: 'import', line: call.line, caller: call.caller };
  const candidates = byName.get(call.name) || [];
  if (candidates.length === 1) return { from: rel, to: candidates[0].id, via: 'unique', line: call.line, caller: call.caller };
  return null;
}

/** 汇总统计（含「分析覆盖率」，供置信度指标使用）。 */
function indexStats(perFile, symbols, edges, unresolved) {
  const byVia = {};
  for (const e of edges) byVia[e.via] = (byVia[e.via] || 0) + 1;
  const facts = [...perFile.values()];
  const calls = facts.reduce((n, f) => n + f.calls.length, 0);
  const skippedMemberCalls = facts.reduce((n, f) => n + (f.skippedMemberCalls || 0), 0);
  const resolved = edges.length;
  return {
    files: perFile.size,
    declarations: facts.reduce((n, f) => n + f.declarations.length, 0),
    exports: facts.reduce((n, f) => n + f.declarations.filter((d) => d.exported).length, 0),
    symbols: symbols.size,
    calls,
    skippedMemberCalls,
    edges: resolved,
    edgesByVia: byVia,
    unresolved: unresolved.length,
    coverage: calls ? Math.round((resolved / calls) * 1000) / 10 : 100,
  };
}

/** 查询某个符号的全部调用者（去重，带调用行号）。 */
export function callersOf(index, id) {
  const target = index.symbols.get(id);
  const out = [];
  for (const e of index.edges) {
    if (e.to !== id) continue;
    out.push({ file: e.from, line: e.line, via: e.via, symbol: target ? target.name : id });
  }
  return out;
}

/**
 * 未被任何调用/导入引用的导出**候选**（动态访问、字符串引用等无法静态判定，故为候选而非结论）。
 * @param {object} index buildSymbolIndex 结果
 * @returns {Array<{id:string,file:string,name:string,line:number}>}
 */
export function unusedExportCandidates(index) {
  // 被调用边（import/unique）或被 import 引用（即便没调用）都算「有人用」——
  //   注意：动态访问（obj[name]、字符串引用、被外部工程 import）无法静态判定，故输出是**候选**。
  const referenced = new Set(index.importRefs || []);
  for (const e of index.edges) {
    if (e.via === 'import' || e.via === 'unique') referenced.add(e.to);
  }
  const out = [];
  for (const [file, map] of index.exportsByFile.entries()) {
    for (const [name, info] of map.entries()) {
      if (!referenced.has(info.id)) out.push({ id: info.id, file, name, line: info.line });
    }
  }
  return out;
}

/** 一行式摘要（工具/CLI 输出用）。 */
export function indexSummary(index) {
  const s = index.stats;
  return `符号索引：文件 ${s.files}｜声明 ${s.declarations}｜导出 ${s.exports}｜调用 ${s.calls}｜连边 ${s.edges}`
    + `（local ${s.edgesByVia.local || 0} / import ${s.edgesByVia.import || 0} / unique ${s.edgesByVia.unique || 0}）`
    + `｜未解析 ${s.unresolved}｜覆盖率 ${s.coverage}%`;
}
