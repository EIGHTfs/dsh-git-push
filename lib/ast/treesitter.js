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
 * 来源：**npm 依赖**——`web-tree-sitter@0.25.10`（运行时 + 它的 tree-sitter.wasm）与
 *   `tree-sitter-wasms@0.1.13`（各语言预编译 grammar，MIT）。仓库内不再保存任何 vendored 副本。
 *   两者**必须精确锁版**：实测 web-tree-sitter@0.27.1 与本套语法 ABI 不兼容
 *   （在 getDylinkMetadata 处报空消息错误）⇒ 升版会让 AST 全线静默降级。
 *   解析顺序（三级）：`DSH_GIT_PUSH_TS_ASSETS` env 覆盖 → npm 包目录 → 两者都拿不到即返回「不可用」，
 *   由调用方回退 token 级判定。
 *
 * 语言口径（既定口径）：**加载哪些语言 = lib/audit-rules/ 里存在哪些语言规则包**
 *   （**空占位包也算**：cpp/go/php/rust/swift）。语法文件不存在时该语言自动走回退 ✓。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/** env 覆盖的外部目录：内含 tree-sitter.js / tree-sitter.wasm / tree-sitter-<lang>.wasm。
 *  **回退路径测试**把它指向不存在的目录即可（测试不碰真实依赖 ✗）；运维也可用它把资产指到别处。
 *  在模块加载时求值，测试需用子进程改 env ✓ */
export const ASSETS_DIR = process.env.DSH_GIT_PUSH_TS_ASSETS || '';

/** 包目录（解析失败为空串 ⇒ 上层按「不可用」回退）。 */
let runtimeDir = null;
let grammarsDir = null;

/**
 * 定位两个依赖包目录。
 *
 * 用 `import.meta.resolve` 而不是 `require.resolve`：本模块是 ESM，且 require 需要 createRequire 垫片。
 *   web-tree-sitter 有 exports 字段，`resolve('web-tree-sitter')` 拿到的是 **ESM 入口**
 *   tree-sitter.js（实测），取其 dirname 即包目录，`tree-sitter.wasm` 就在同级 ✓；
 *   `web-tree-sitter/package.json` 反而**不在 exports 白名单里**（ERR_PACKAGE_PATH_NOT_EXPORTED）⇒
 *   想拿包目录只能由入口路径回溯，不要改成解析 package.json。
 *   tree-sitter-wasms 无 exports 字段 ⇒ 子路径可自由解析（这里解析一个必然存在的语法作为锚）。
 * @returns {{runtimeDir: string, grammarsDir: string}}
 */
function resolveDirs() {
  if (runtimeDir !== null && grammarsDir !== null) return { runtimeDir, grammarsDir };
  const pick = (spec) => {
    try { return dirname(fileURLToPath(import.meta.resolve(spec))); } catch { return ''; }
  };
  if (runtimeDir === null) runtimeDir = pick('web-tree-sitter');
  if (grammarsDir === null) grammarsDir = pick('tree-sitter-wasms/out/tree-sitter-javascript.wasm');
  // env 覆盖优先：指向一个「runtime 与语法同级」的目录（回退实验与运维换源都走这里）
  if (ASSETS_DIR) { runtimeDir = ASSETS_DIR; grammarsDir = ASSETS_DIR; }
  return { runtimeDir, grammarsDir };
}

/** 扩展名 → 语法名（grammar）。没有映射的扩展名一律走回退 ✓。 */
export const EXT_TO_GRAMMAR = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python',
  // ── 规则包早已存在、此前一直无语法树（走 token 级回退）的语言 ──
  // 语法名以 tree-sitter-wasms@0.1.13 的 out/ 里**实际存在的文件名**为准（逐个核对过，不凭记忆写）。
  // C# 的内部名带下划线：写成 csharp 会去找不存在的 wasm ⇒ 静默回退，规则表现成「看起来接不通」。
  cs: 'c_sharp',
  c: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  // .h 归属取 cpp 而非 c：C 与 C++ 共用该扩展名，cpp 语法是 C 的超集。
  //   交给 c 语法时，合法 C++ 头文件会解析出 ERROR ⇒ 整棵树作废退回 token 级（等于白接）；
  //   反过来把纯 C 头交给 cpp 语法不会报错（C 是子集）。
  h: 'cpp',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  php: 'php', phtml: 'php',
  rs: 'rust',
  swift: 'swift',
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
    const { runtimeDir: rd } = resolveDirs();
    if (!rd) return false;
    // env 覆盖模式下 runtime 是目录里的 tree-sitter.js；npm 模式下入口由 exports 决定
    //   （tree-sitter.js / tree-sitter.mjs 都可能），故只校验「能拿到 ESM 入口 + 同级 wasm」。
    return existsSync(join(rd, 'tree-sitter.wasm'));
  } catch { return false; }
}

/** 当前资产里实际可用的语法名列表（按目录里存在的 wasm 推断）。 */
export function availableGrammars() {
  try {
    const { grammarsDir: gd } = resolveDirs();
    if (!gd) return [];
    return readdirSync(gd)
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
    // 两种布局：
    //   · npm 依赖 → 裸 specifier，让 ESM loader 按包的 exports 取 ESM 入口（0.25.10 → ./tree-sitter.js）；
    //   · vendored / env 覆盖目录 → 目录里就有 tree-sitter.js，必须按文件路径加载，
    //     否则在「只拷了插件目录、没装 dependencies」的部署端会 import 失败（实测过：语法读得到、runtime 拿不到）。
    const { runtimeDir: rd } = resolveDirs();
    const vendoredRuntime = rd ? join(rd, 'tree-sitter.js') : '';
    modPromise = vendoredRuntime && existsSync(vendoredRuntime)
      ? import(pathToFileURL(vendoredRuntime).href)
      : import('web-tree-sitter');
  }
  return modPromise;
}

/** 初始化一次（定位运行时 wasm）。失败返回 null（调用方回退）。 */
async function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      const { Parser } = await loadModule();
      // locateFile：告诉运行时去哪里取 web-tree-sitter.wasm（默认会按 URL 猜，容器里不可靠）。
      //   目录来自 resolveDirs()（npm 包目录或 env 覆盖目录）——不能写死 ASSETS_DIR：
      //   无 env 覆盖时它是空串，join('', f) 会退化成相对路径 ⇒ ENOENT（改这行时踩过）。
      const { runtimeDir: rd } = resolveDirs();
      await Parser.init({ locateFile: (f) => (rd ? join(rd, f) : f) });
      return true;
    })().catch(() => null);
  }
  return initPromise;
}

/** 取（并缓存）某语言的 Parser；不可用返回 null。 */
async function getParser(grammar) {
  const { grammarsDir: gd } = resolveDirs();
  if (!grammar || !gd || !existsSync(join(gd, `tree-sitter-${grammar}.wasm`))) return null;
  if (parserCache.has(grammar)) return parserCache.get(grammar);
  try {
    if (!(await ensureInit())) return null;
    const { Parser, Language } = await loadModule();
    let lang = langCache.get(grammar);
    if (!lang) {
      // 传**字节**而不是路径：0.27.x 的 load(路径) 会静默失败（Node 分支虽会 readFile，但 dylink 不兼容）；
      //   字节是唯一被实测验证可用的入口（0.25.10 ✓）
      lang = await Language.load(readFileSync(join(gd, `tree-sitter-${grammar}.wasm`)));
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
  const fn = (line, col) => {
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
  // 附带原始语法树：供「有树走树」的语义精筛（如凭据 credentialLinesFromTree）直接消费——
  //   列级 opaque 确认与树级语义确认走同一棵预解析树，不重复解析（性能纪律）。
  fn.tree = tree;
  return fn;
}

/**
 * 用语法树提取「凭据标识符被直接赋字符串/字节字面量」的行（方向 E1「有树走树」）。
 *
 * 为什么用树而不是 token：token 级看不出「赋值」的语法结构——
 *   `def _icon(token="text.secondary")` 的参数默认值、`token="前缀:"+uuid` 的复合右值、
 *   `x="a" if c else "b"` 的三元分支，在 token 流里都是 `ident = str`，只能一律当硬编码
 *   （外部 Python 仓库实测：这一类全是误报）。语法树上它们分别是
 *   default_parameter / assignment_pattern（不是赋值语句）、binary_operator（右值非字面量）、
 *   conditional_expression（右值非字面量），一眼排除。
 *
 * 判定语汇（凭据名识别、值是否有意义）由调用方 credential.js 以谓词传入：
 *   本模块不 import credential.js，避免反向依赖成环，也保证「什么算凭据」只有一份定义。
 *
 * @param {object} tree parseText 的返回值（无根节点/异常一律返回 null，调用方回退）
 * @param {(name:string, raw:string)=>boolean} credHit 「名字+值」组合判据（credential.js
 *   的 isHardcodedCredentialValue——强弱分级与值置信度只有一份定义）
 * @returns {null|Set<number>} 命中行号集合；null = 树不可用，调用方必须回退 token 级
 */
export function credentialLinesFromTree(tree, credHit) {
  if (!tree || !tree.rootNode || typeof credHit !== 'function') return null;
  const out = new Set();
  // 属性/成员访问左值（cfg.apikey、this.token、obj["secret"]）在各语言的节点名。
  const ATTRIBUTE_LHS = /^(attribute|member_expression|subscript|subscript_expression)$/;
  // 字符串/字节字面量节点的类型名（各语言命名差异：string / string_literal /
  //   interpreted_string_literal(bytes/f-string) / raw_string_literal / character_literal）。
  //   刻意不含 string_concat——`"a" + "b"` 的拼接值不是「直接字面量」，属复合右值。
  const LIT = /^(string|string_literal|interpreted_string_literal|raw_string_literal|character_literal)$/;
  // 字面量节点是否为「纯字面量」：f-string/插值串（children 含 interpolation /
  //   template_substitution / interpolation_expression）里值来自变量，不算硬编码内容。
  const isPlainLiteral = (node) => {
    if (!node || !LIT.test(node.type)) return false;
    for (const c of node.children || []) {
      if (/interpolation|substitution|expansion/i.test(String(c.type || ''))) return false;
    }
    return true;
  };
  // 遍历：收集「左值是凭据名、右值是单个字面量」的直接赋值行。
  const walk = (node) => {
    try {
      // ① 真赋值语句（Python assignment / JS·TS assignment_expression）：left=identifier，right=字面量
      //   参数默认值（default_parameter/assignment_pattern）不在此类，天然排除。
      if (node.type === 'assignment' || node.type === 'assignment_expression') {
        const lhs = node.childForFieldName('left');
        const rhs = node.childForFieldName('right');
        // 左值名：裸标识符直接取；属性赋值（cfg.apikey = "…" / this.token = "…"）取末段——
        //   回退路径（token 级，`.` 允许跨越）对这类同样会报，树路径必须同等覆盖，否则改树反而漏报。
        const name = lhs
          ? (lhs.type === 'identifier' || lhs.type === 'variable_declarator'
            ? String(lhs.text)
            : String(lhs.text).split(/[.\[\]]/).pop().replace(/^['"]|['"]$/g, ''))
          : '';
        const lhsOk = lhs && (lhs.type === 'identifier' || ATTRIBUTE_LHS.test(lhs.type));
        if (lhsOk && isPlainLiteral(rhs) && credHit(name, rhs.text)) {
          out.add(node.startPosition.row + 1);
        }
      }
      // ② 变量声明初始化（const token = "…"）：variable_declarator name=identifier value=字面量
      else if (node.type === 'variable_declarator' || node.type === 'init_declarator') {
        const nm = node.childForFieldName('name');
        const val = node.childForFieldName('value');
        if (nm && nm.type === 'identifier' && isPlainLiteral(val) && credHit(String(nm.text), val.text)) {
          out.add(node.startPosition.row + 1);
        }
      }
      // ③ 对象字段（{ token: "…" } / { apiKey: "…" }）：pair，键名命中凭据词 + 值是字面量。
      //   f-string/插值字符串的值节点是 string 类型但含 interpolation 子节点——见 ③ 下的插值判定。
      else if (node.type === 'pair' || node.type === 'property_assignment' || node.type === 'object_element') {
        const keyNode = node.childForFieldName('key') || node.namedChildren[0];
        const valNode = node.childForFieldName('value') || node.namedChildren[1];
        const keyText = keyNode ? String(keyNode.text).replace(/^['"]|['"]$/g, '') : '';
        if (keyNode && isPlainLiteral(valNode) && credHit(keyText, valNode.text)) {
          out.add(node.startPosition.row + 1);
        }
      }
      for (const child of node.namedChildren) walk(child);
    } catch {
      // 单节点异常不打断整树：已收集的命中照常返回（部分成功优于全失败）。
    }
  };
  try {
    walk(tree.rootNode);
    return out;
  } catch {
    return null;
  }
}

/**
 * 用语法树收集「函数/方法定义名过短」的命中（方向 E 迁移第二条，short-func-name 树化）。
 *
 * 为什么必须用树（实测漏报）：token 级只认「function 关键字后的 ident」，
 *   于是 `class A { gh() {} }`、`const o = { ef() {} }` 这类**方法定义**完全查不到——
 *   它们同样是「名字猜不出含义」的缺陷，却静默放行。
 *   想在 token 级补齐只能靠「标识符 + ( 」近似，那会把 `ab(1)` 调用、`{ ef: ... }` 属性
 *   全卷进来（误报换漏报，不划算）。语法树上它们是独立节点：
 *   function_declaration / generator_function_declaration / function_expression /
 *   method_definition / method_signature，且都带 name 字段；
 *   arrow_function、if_statement 无 name 字段 ⇒ 天然不误伤。
 *
 * @param {object} tree parseText 返回值
 * @param {(name:string)=>boolean} isShort 名字判定（长度阈值 + 公认缩写白名单，由 naming.js 传入——判据只有一份）
 * @returns {null|Array<{line:number, name:string}>} null = 树不可用，调用方回退 token 级
 */
export function shortFunctionNamesFromTree(tree, isShort) {
  if (!tree || !tree.rootNode || typeof isShort !== 'function') return null;
  const DECL = new Set([
    'function_declaration', 'generator_function_declaration', 'function_expression',
    'method_definition', 'method_signature',
  ]);
  const out = [];
  const walk = (node) => {
    try {
      if (DECL.has(node.type)) {
        // 访问器（get ab() / set cd(v)）跳过：它的 name 是**属性名**而非「做某事的函数名」，
        //   且 get x / set x 配对是极常见惯例（框架存取器、计算属性）——按「函数名过短」报属语义错位。
        //   刻意显式排除而非依赖初筛侥幸挡住：初筛放宽后这里不能变成误报源。
        //   实测节点形态：method_definition 的 children[0].type 为 get/set（普通方法是 property_identifier）。
        const lead = node.children && node.children[0];
        const isAccessor = lead && /^(get|set)$/.test(String(lead.type));
        const nm = node.childForFieldName('name');
        // 仅裸标识符/属性名才算「定义名」；computed（[x](){}）等形态跳过，避免取到表达式文本
        if (!isAccessor && nm && /^(identifier|property_identifier|private_property_identifier)$/.test(String(nm.type))) {
          const name = String(nm.text);
          if (isShort(name)) out.push({ line: nm.startPosition.row + 1, name });
        }
      }
      for (const c of node.namedChildren) walk(c);
    } catch { /* 单节点异常不打断整树 */ }
  };
  try {
    walk(tree.rootNode);
    return out;
  } catch {
    return null;
  }
}

/** 清空全部缓存（测试与长驻进程内存回收用）。 */
export function resetTreeSitterCache() {  modPromise = null;
  initPromise = null;
  langCache.clear();
  parserCache.clear();
  treeCache.clear();
}
