/**
 * AST 实现层 · tree-sitter（真语法树 · WASM）
 *
 * 定位：**可选增强，绝不是必需依赖**。任何一步失败（资产缺失 / wasm 加载失败 / 无对应语法 /
 *   解析出语法错误 / 超出预算）都返回「未使用」信号，由调用方**回退**到
 *   lib/ast/code-lines.js 的 token 级判定（行级 + 列级，2.8.9 已落地）。
 *
 * 为什么这么设计：审计是提交门禁的一部分，**不能因为增强件坏了就整体失效** ✗。
 *   回退不是异常路径，而是常态路径之一 ✓。
 *
 * 资产：assets/tree-sitter/（web-tree-sitter@0.27.1 + 各语言预编译 grammar；MIT）
 *   来源、版本、sha256、可复现下载命令见该目录 README.md ✓
 *
 * 语言口径（既定口径）：**加载哪些语言 = lib/audit-rules/ 里存在哪些语言规则包**
 *   （**空占位包也算**：cpp/go/php/rust/swift）。语法文件不存在时该语言自动走回退 ✓。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/** 资产目录（插件根/assets/tree-sitter）——本文件在 lib/ast/，故上溯两级。
 *  可用 env `DSH_GIT_PUSH_TS_ASSETS` 覆盖：**回退路径测试**把它指向不存在的目录即可
 *  （测试禁止改动真实资产目录 ✗）。注意：本常量在**模块加载时**求值，测试需用子进程改 env ✓ */
export const ASSETS_DIR = process.env.DSH_GIT_PUSH_TS_ASSETS
  || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'tree-sitter');

/** 扩展名 → 语法名（grammar）。没有映射的扩展名一律走回退 ✓。 */
export const EXT_TO_GRAMMAR = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python',
};

/** 单文件解析预算（字符数）：超此长度不解析，直接回退（避免大文件拖慢审计）。 */
const MAX_PARSE_CHARS = Number(process.env.DSH_GIT_PUSH_TS_MAX_CHARS || 400000) || 400000;
/** 语法树缓存条数上限（按内容 hash 命中）。 */
const TREE_CACHE_MAX = Number(process.env.DSH_GIT_PUSH_TS_TREE_CACHE || 64) || 64;

/** 惰性状态（模块级）：web-tree-sitter 模块 / 初始化 Promise / 语言与解析器缓存。 */
let modPromise = null;
let initPromise = null;
const langCache = new Map();
const parserCache = new Map();
const treeCache = new Map(); // hash → tree（简单 FIFO 淘汰）

/** 资产是否就位（供调用方与自检使用）。 */
export function treesitterAvailable() {
  try {
    return existsSync(join(ASSETS_DIR, 'tree-sitter.js')) && existsSync(join(ASSETS_DIR, 'tree-sitter.wasm'));
  } catch { return false; }
}

/** 当前资产里实际可用的语法名列表（按目录里存在的 wasm 推断）。 */
export function availableGrammars() {
  try {
    return readdirSync(ASSETS_DIR)
      .map((f) => /^tree-sitter-(.+)\.wasm$/.exec(f))
      .filter(Boolean)
      .map((m) => m[1])
      .sort();
  } catch { return []; }
}

/** 由扩展名（可带点）取语法名；无映射返回 ''。 */
export function grammarForExt(ext = '') {
  const e = String(ext).toLowerCase().replace(/^\./, '');
  return EXT_TO_GRAMMAR[e] || '';
}

/** 懒加载 web-tree-sitter 运行时（ESM 具名导出：Parser / Language / Query）。
 *  文件名用上游原名：0.25.10 是 `tree-sitter.js` / `tree-sitter.wasm`（0.27.x 才是 web-tree-sitter.* ✗ 且与
 *  tree-sitter-wasms@0.1.13 的语法不兼容 —— 实测 0.27.1 在 getDylinkMetadata 处报空消息错误 ✗）。 */
async function loadModule() {
  if (!modPromise) {
    modPromise = import(pathToFileURL(join(ASSETS_DIR, 'tree-sitter.js')).href);
  }
  return modPromise;
}

/** 初始化一次（定位运行时 wasm）。失败返回 null（调用方回退）。 */
async function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      const { Parser } = await loadModule();
      // locateFile：告诉运行时去哪里取 web-tree-sitter.wasm（默认会按 URL 猜，容器里不可靠）
      await Parser.init({ locateFile: (f) => join(ASSETS_DIR, f) });
      return true;
    })().catch(() => null);
  }
  return initPromise;
}

/** 取（并缓存）某语言的 Parser；不可用返回 null。 */
async function getParser(grammar) {
  if (!grammar || !existsSync(join(ASSETS_DIR, `tree-sitter-${grammar}.wasm`))) return null;
  if (parserCache.has(grammar)) return parserCache.get(grammar);
  try {
    if (!(await ensureInit())) return null;
    const { Parser, Language } = await loadModule();
    let lang = langCache.get(grammar);
    if (!lang) {
      // 传**字节**而不是路径：0.27.x 的 load(路径) 会静默失败（Node 分支虽会 readFile，但 dylink 不兼容）；
      //   字节是唯一被实测验证可用的入口（0.25.10 ✓）
      lang = await Language.load(readFileSync(join(ASSETS_DIR, `tree-sitter-${grammar}.wasm`)));
      langCache.set(grammar, lang);
    }
    const parser = new Parser();
    parser.setLanguage(lang);
    parserCache.set(grammar, parser);
    return parser;
  } catch {
    return null; // 任何异常都退化为「不可用」⇒ 调用方回退 ✓
  }
}

/** 解析文本（按内容 hash 缓存语法树）；失败返回 null。 */
export async function parseText(text, grammar) {
  const src = String(text ?? '');
  if (!grammar || src.length > MAX_PARSE_CHARS) return null;
  const hash = `${grammar}:${createHash('sha1').update(src).digest('hex')}`;
  if (treeCache.has(hash)) return treeCache.get(hash);
  const parser = await getParser(grammar);
  if (!parser) return null;
  try {
    const tree = parser.parse(src);
    if (!tree || !tree.rootNode || tree.rootNode.hasError) return null; // 语法错误 ⇒ 不信任该树，回退 ✓
    treeCache.set(hash, tree);
    while (treeCache.size > TREE_CACHE_MAX) treeCache.delete(treeCache.keys().next().value);
    return tree;
  } catch {
    return null;
  }
}

/** 节点或其祖先是否属于「不透明」构造（字符串/注释/模板/正则字面量）。 */
export function isOpaqueNode(node) {
  for (let n = node; n; n = n.parent) {
    const t = String(n.type || '');
    if (/^(string|string_fragment|template_string|comment|line_comment|block_comment|regex|regex_pattern|interpreted_string_literal|raw_string_literal)$/.test(t)) return true;
    if (/comment|string/.test(t)) return true; // 各语言命名差异的兜底
  }
  return false;
}

/**
 * 用语法树确认一批命中是否为**真实代码**。
 *
 * @param {{text:string, ext?:string, grammar?:string, hits:Array<{line:number, col:number}>}} p
 * @returns {Promise<{used:boolean, keep:boolean[], reason?:string}>}
 *   used=false ⇒ **调用方必须回退**到 token 级判定（keep 无意义）；
 *   used=true  ⇒ keep[i] 表示第 i 个命中是否为真代码（true=保留上报）。
 */
export async function confirmHits({ text, ext = '', grammar = '', hits = [] } = {}) {
  const g = grammar || grammarForExt(ext);
  if (!g || !hits.length) return { used: false, keep: [], reason: 'no-grammar-or-hits' };
  const tree = await parseText(text, g);
  if (!tree) return { used: false, keep: [], reason: 'parse-unavailable' };
  try {
    const keep = hits.map((h) => {
      const line = Number(h?.line);
      const col = Number(h?.col);
      if (!Number.isFinite(line) || line < 1) return true;      // 拿不到位置 ⇒ 不拦（宁可放行不误杀）
      const column = Number.isFinite(col) && col > 0 ? col - 1 : 0;
      const node = tree.rootNode.descendantForPosition({ row: line - 1, column });
      if (!node) return true;
      return !isOpaqueNode(node);
    });
    return { used: true, keep };
  } catch {
    return { used: false, keep: [], reason: 'confirm-failed' };
  }
}

/**
 * 把已解析的语法树包成**同步**确认函数（供同步的检查器 lib/checks/* 调用）。
 *
 * 为什么需要：检查器是同步的，而解析是异步的 —— 由编排层（async）**预解析**后，
 *   把同步闭包传下去，避免把整条检查链改成 async ✗。
 *
 * @param {object|null} tree parseText 的返回值
 * @returns {null|((line:number, col:number)=>boolean|null)} 返回 null 表示「无法判定」，
 *   调用方应回退到 token 级判定（行级 + 列级）✓
 */
export function makeSyncConfirmer(tree) {
  if (!tree || !tree.rootNode) return null;
  return (line, col) => {
    try {
      const l = Number(line);
      if (!Number.isFinite(l) || l < 1) return null;
      const c = Number(col);
      const column = Number.isFinite(c) && c > 0 ? c - 1 : 0;
      const node = tree.rootNode.descendantForPosition({ row: l - 1, column });
      if (!node) return null;
      return !isOpaqueNode(node);
    } catch {
      return null;
    }
  };
}

/** 清空全部缓存（测试与长驻进程内存回收用）。 */
export function resetTreeSitterCache() {  modPromise = null;
  initPromise = null;
  langCache.clear();
  parserCache.clear();
  treeCache.clear();
}
