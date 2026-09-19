#!/usr/bin/env node
/**
 * dsh-git-push — 文件读写调用扫描器（2026-09-16；同日升级三标签能力）
 *
 * 用途：把项目代码里所有「读/写文件」的调用位置找出来，并尽力解析出读写的
 *   文件路径/文件名——用于核查「某配置写没写、某个文件被哪些地方读写」。
 *
 * 扫描对象：fs 相关调用（readFileSync/readFile/writeFileSync/writeFile/appendFileSync/
 *   renameSync/rename/mkdirSync/readdirSync/existsSync/statSync/unlinkSync/rmSync/
 *   copyFileSync/chmodSync/createWriteStream/createReadStream/openSync 等）。
 *
 * 路径解析策略（按优先级）：
 *   ① 静态字符串参数（'config.json'、join(a, 'x.json') 的可计算片段）
 *   ② 模板字符串（`${dir}/x.json`，插值部分标 <expr>）
 *   ③ 变量参数（溯源同文件内的 `const x = '…'` / `const x = join(…)` 赋值，
 *      能解析就展开，不能则标变量名 + 位置；解析不到标「(未解析)」但仍登记命中）
 *
 * ── 三标签（本次升级，每条命中都带）──
 *   ① **类型** type：sync / async —— 同步 I/O 落在异步路径会阻塞事件循环
 *      （由操作名是否带 Sync 后缀判定）
 *   ② **操作** kind：read / write / delete / rename —— 写类（write/delete/rename）
 *      涉及数据安全，风险更高，默认排前
 *   ③ **上下文**：是否在 async 函数内（inAsync）、是否在循环内（inLoop）、
 *      是否在请求处理路径上（inRequest）—— 决定这次 I/O 会不会卡住其他请求
 *   综合出 risk 等级：🔴 high（写/删 且 并发路径）· 🟠 medium（同步阻塞或写类）· · low
 *
 * 用法：
 *   node scripts/scan-file-io.mjs <文件|目录>…        # 扫指定路径（默认 lib/ scripts/ cli.mjs）
 *   node scripts/scan-file-io.mjs --summary           # 三标签汇总视图（类型/操作/上下文/风险 计数）
 *   node scripts/scan-file-io.mjs --report            # 风险报告：统计 + 改造优先级清单（文本表格）
 *   node scripts/scan-file-io.mjs --report --report-limit 50  # 清单最多 50 条
 *   node scripts/scan-file-io.mjs --json              # JSON 输出（含全部标签字段）
 *   node scripts/scan-file-io.mjs --write             # 只看写类操作（write/delete/rename）
 *   node scripts/scan-file-io.mjs --type sync         # 按类型过滤（sync / async，可逗号多值）
 *   node scripts/scan-file-io.mjs --kind delete,rename # 按操作过滤（read/write/delete/rename）
 *   node scripts/scan-file-io.mjs --risk high          # 只看高危
 *   node scripts/scan-file-io.mjs --op writeFileSync   # 按操作名过滤（可逗号多值）
 *
 * 输出（文本）：风险徽标 | 行号 | 操作 | 三标签串 | 路径参数（解析结果）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
// 2026-09-17：分级引擎改为复用 AST 层（四级标准），行级逻辑只保留路径解析
import { scanIoRiskAst, RISK_BADGE, RISK_LABEL, summarizeIoRisk, rankIoFixList } from '../lib/ast/io-risk.js';
import { join, extname, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ───────────────────────── 配置 ───────────────────────── */

/**
 * 要识别的文件操作。每个条目：
 *   op    —— 精确操作名（含 Sync 后缀与否决定 **类型标签**：sync/async）
 *   kind  —— **操作标签**：read | write | delete | rename | meta
 *   write —— 是否写类（数据安全风险高，供 --write 过滤与排序）
 */
const FS_OPS = [
  // 读
  { op: 'readFile', kind: 'read', write: false },
  { op: 'readFileSync', kind: 'read', write: false },
  { op: 'readdir', kind: 'read', write: false },
  { op: 'readdirSync', kind: 'read', write: false },
  { op: 'createReadStream', kind: 'read', write: false },
  // 写
  { op: 'writeFile', kind: 'write', write: true },
  { op: 'writeFileSync', kind: 'write', write: true },
  { op: 'appendFile', kind: 'write', write: true },
  { op: 'appendFileSync', kind: 'write', write: true },
  { op: 'createWriteStream', kind: 'write', write: true },
  { op: 'mkdir', kind: 'write', write: true },
  { op: 'mkdirSync', kind: 'write', write: true },
  { op: 'copyFile', kind: 'write', write: true },
  { op: 'copyFileSync', kind: 'write', write: true },
  { op: 'open', kind: 'write', write: true },
  { op: 'openSync', kind: 'write', write: true },
  { op: 'chmod', kind: 'write', write: true },
  { op: 'chmodSync', kind: 'write', write: true },
  // 删除
  { op: 'unlink', kind: 'delete', write: true },
  { op: 'unlinkSync', kind: 'delete', write: true },
  { op: 'rm', kind: 'delete', write: true },
  { op: 'rmSync', kind: 'delete', write: true },
  { op: 'rmdir', kind: 'delete', write: true },
  { op: 'rmdirSync', kind: 'delete', write: true },
  // 重命名
  { op: 'rename', kind: 'rename', write: true },
  { op: 'renameSync', kind: 'rename', write: true },
  // 元数据（读类，不写入）
  { op: 'existsSync', kind: 'read', write: false },
  { op: 'accessSync', kind: 'read', write: false },
  { op: 'stat', kind: 'read', write: false },
  { op: 'statSync', kind: 'read', write: false },
  { op: 'realpathSync', kind: 'read', write: false },
];

/** 写类操作标签集合（--write 过滤用）。 */
const WRITE_KINDS = new Set(['write', 'delete', 'rename']);

/**
 * 上下文标签：判断命中行处于什么结构里（决定这次 I/O 会不会卡住别的请求）。
 *   inAsync   —— 在 `async` 函数体内（同步 I/O 在这里直接阻塞事件循环）
 *   inLoop    —— 在 for/while/do/forEach/map 等循环体内（多次 I/O 放大阻塞）
 *   inRequest —— 在请求处理路径上（HTTP handler / 路由 / 回调参数名像 req/res）
 */
/** 函数签名判定用：控制流关键字前缀（这些不是函数定义）。 */
const CONTROL_KEYWORDS = /^\s*(?:if|for|while|switch|catch|do|else|return|await|throw|typeof|new|delete|void|in|of|case|default|try|finally|with|yield)\b/;

/**
 * 判断一行是否是**真正的函数签名**（函数声明/函数表达式/箭头函数/方法简写）。
 * 关键排除项（都踩过坑）：
 *   · 控制流关键字开头的行（`if (x) {` 曾被当成方法简写）
 *   · 普通 const 赋值里的括号表达式（`const owner = (a && b) || ''` 曾被当成箭头函数）
 */
function isFnSignature(s) {
  if (CONTROL_KEYWORDS.test(s)) return false;
  return /^\s*(?:export\s+)?(?:default\s+)?async\s+function\b/.test(s)
    || /^\s*(?:export\s+)?function\b/.test(s)
    || /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s+)?function\b/.test(s)
    || /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*=>/.test(s)
    || /^\s*(?:async\s+)?[\w$]+\s*\([^)]*\)\s*\{\s*$/.test(s);
}

/**
 * 剥离注释行，返回「只有代码」的行数组（用于上下文判定，避免说明文字里的
 * handle / route 之类字样被当代码——扫描器自身注释就踩过这个坑）。
 */
function stripCommentLines(lines, uptoIdx) {
  const out = [];
  let inBlock = false;
  for (let i = 0; i <= uptoIdx; i++) {
    const raw = lines[i];
    if (inBlock) {
      const end = raw.indexOf('*/');
      if (end === -1) continue;
      inBlock = false;
      const rest = raw.slice(end + 2);
      if (rest.trim()) out.push(rest);
      continue;
    }
    const open = raw.indexOf('/*');
    if (open !== -1 && raw.indexOf('*/', open) === -1) {
      inBlock = true;
      const head = raw.slice(0, open);
      if (head.trim()) out.push(head);
      continue;
    }
    if (/^\s*\/\//.test(raw) || /^\s*\*/.test(raw)) continue;
    out.push(raw);
  }
  return out;
}

/** 从命中行向上扫描，判定是否处于 async 函数体 / 循环体内。 */
function scanEnclosure(lines, lineIdx) {
  let inAsync = false;
  let inLoop = false;
  for (let i = lineIdx; i >= 0; i--) {
    const code = stripLiterals(lines[i]);
    // 上行函数签名：async function / async (...) => / function ... { ... }
    if (i !== lineIdx && /^\s*(?:async\s+)?(?:function\b|\w+\s*\([^)]*\)\s*(?:=>)?\s*\{)/.test(code)) {
      if (/\basync\b/.test(code)) inAsync = true;
    }
    // 循环结构（含数组迭代方法）
    if (/^\s*(?:for|while|do)\b/.test(code) || /\.(?:forEach|map|filter|reduce|for\s+of)\s*\(/.test(code)) {
      inLoop = true;
    }
    // 到达顶层（文件级缩进 0 的结束括号）就先停
    if (/^\}\s*;?\s*$/.test(code) && i < lineIdx) break;
  }
  return { inAsync, inLoop };
}

/**
 * 判定是否处于**请求处理路径**：向上找最近的函数签名，在该函数体内找真实 HTTP 特征。
 *   不限固定窗口——大 handler 里 I/O 常离签名几十行，固定 30 行窗口够不到。
 *   特征必须具体（req.headers / req.method / res.writeHead / handleXxx( /
 *   createServer((req,res) / 成对 (req, res) 签名），孤立的 req/url 字样不算。
 */
function inRequestPath(lines, lineIdx) {
  const codeLines = stripCommentLines(lines, lineIdx);
  // 只保留最近一个函数体（从最后一个函数签名行到命中行），避免串到上一个函数
  let sigStart = 0;
  for (let i = codeLines.length - 1; i >= 0; i--) {
    if (isFnSignature(codeLines[i])) { sigStart = i; break; }
  }
  const signatureText = codeLines.slice(sigStart).join('\n');
  return /\b(?:req|request)\.(?:headers|method|url|body|on)\b/.test(signatureText)
    || /\bres\.(?:writeHead|write|end|setHeader|statusCode)\b/.test(signatureText)
    || /\b(?:handle|route|onRequest)[A-Za-z_$]*\s*\(/.test(signatureText)
    || /\bcreateServer\s*\(\s*(?:async\s*)?\(?\s*(?:req|request)\s*,/.test(signatureText)
    || /\(\s*(?:req|request)\s*,\s*(?:res|response)\s*\)/.test(signatureText);
}

/** 判定命中行所处上下文（三标签之③）。 */
function contextAt(lines, lineIdx) {
  const { inAsync, inLoop } = scanEnclosure(lines, lineIdx);
  return { inAsync, inLoop, inRequest: inRequestPath(lines, lineIdx) };
}

/** 类型标签：按操作名是否带 Sync 后缀判定（同步 I/O 会阻塞事件循环）。 */
function ioTypeOf(opName = '') {
  return /Sync$/.test(opName) ? 'sync' : 'async';
}

/** 递归时跳过的目录。 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.trash', 'dist', 'build', '.bak']);

/* ───────────────────────── 扫描 ───────────────────────── */

/** 收集指定文件/目录下的源码文件（.js/.mjs/.cjs/.ts，跳过 node_modules 等）。 */
function collectFiles(targets) {
  const out = [];
  const walk = (p) => {
    let st;
    try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) {
      let es;
      try { es = readdirSync(p, { withFileTypes: true }); } catch { return; }
      for (const en of es) {
        if (SKIP_DIRS.has(en.name)) continue;
        walk(join(p, en.name));
      }
    } else if (['.js', '.mjs', '.cjs', '.ts'].includes(extname(p))) {
      out.push(p);
    }
  };
  for (const t of targets) walk(resolve(t));
  return out;
}

/** 剔除代码中被字符串/注释/正则字面量包裹的部分，返回「可匹配」的代码片段。
 * 用于避免正则字面量（/mkdir\(/）、字符串、注释里的操作名被误识别为调用。 */
function stripLiterals(line) {
  let out = '';
  let i = 0;
  let quote = null; // ' " ` 
  let lineComment = false;
  let blockComment = false;
  let regexMode = false;
  while (i < line.length) {
    const char = line[i];
    const next = line[i + 1];
    if (lineComment) { i++; continue; }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; i += 2; continue; }
      i++; continue;
    }
    if (quote) {
      if (char === '\\') { i += 2; continue; }
      if (char === quote) quote = null;
      i++; continue;
    }
    if (regexMode) {
      if (char === '\\') { i += 2; continue; }
      if (char === '/') regexMode = false;
      i++; continue;
    }
    if (char === '/' && next === '/') { lineComment = true; i += 2; continue; }
    if (char === '/' && next === '*') { blockComment = true; i += 2; continue; }
    // 正则字面量判定：**必须看前一个非空字符**——只有表达式起始位置（行首、`(`、`,`、`=`、
    //   `:`、`[`、`!`、`&`、`|`、`?`、`{`、`;`、`return` 等之后）的 `/` 才是正则开头；
    //   标识符/数字/`)`/`]` 之后的 `/` 是**除号**。此前不加区分一律当正则，导致
    //   `readFile('/tmp/x')` 里的 `/tmp` 被当成正则开始，把整行剩余部分吞掉 → 漏报。
    if (char === '/' && /[A-Za-z0-9\\^$.|?*+()[\]{}]/.test(next || '')) {
      const prev = out.trimEnd().slice(-1);
      const regexAllowed = prev === '' || /[=(,:;[!&|?{}+\-*/%<>~^]/.test(prev) || /\b(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await)$/.test(out.trimEnd());
      if (regexAllowed) { regexMode = true; i++; continue; }
      // 否则视作除号，正常输出
      out += char;
      i++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; i++; continue; }
    out += char;
    i++;
  }
  return out;
}

/**
 * 扫描单个文件，返回命中列表。
 * @returns {Array<{file:string, line:number, op:string, path:string, raw:string}>}
 */
function scanFile(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const lines = text.split('\n');
  const hits = [];
  // 本文件的 AST 分级结果（四级标准，与审计一致）；解析失败则空数组，走行级兜底
  let astHits = [];
  try { astHits = scanIoRiskAst(text); } catch { astHits = []; }
  // 预收集本文件的变量赋值（路径类）：const x = 'str' / const x = join(...) 等
  const varMap = collectVarAssignments(lines);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = stripLiterals(line); // 剔除字符串/注释/正则字面量，防误识别
    if (/^\s*import\s|^\s*\/\/|^\s*\*/.test(line)) continue;
    for (const entry of FS_OPS) {
      // 词边界匹配，避免 readFile 命中 readFileSync / 自定义前缀名
      const callRe = new RegExp(`(?<![\\w$])${entry.op}\\s*\\(`);
      if (!callRe.test(code)) continue;
      // 参数提取失败**不丢弃命中**：字符串字面量已被 stripLiterals 剔除（防误识别），
      //   而路径往往正是字符串字面量——此前 `arg === null → continue` 会把
      //   `await readFile('/x')` 这类整条漏报。提取不到时路径标「(未解析)」照常登记。
      const arg = extractArg(code, entry.op, entry.op);
      const rawArg = arg === null ? '(未解析)' : arg;
      const resolved = arg === null ? '(未解析)' : resolvePathArg(arg, varMap, i);
      const lineCtx = contextAt(lines, i);
      // 2026-09-17：上下文与分级以 AST 为准（tokenizer + 花括号配对，比行级启发式准）；
      //   查不到该 (行号,操作名) 才退回行级结果
      const graded = riskOfByAst(astHits, i + 1, entry.op, entry, lineCtx);
      const ctx = graded.ctx;
      hits.push({
        file,
        line: i + 1,
        op: entry.op,
        // ── 三标签 ──
        type: ioTypeOf(entry.op),              // 类型：sync / async
        kind: entry.kind,                      // 操作：read / write / delete / rename / meta
        inAsync: ctx.inAsync,                  // 上下文：异步函数体内
        inLoop: ctx.inLoop,                    // 上下文：循环体内
        inRequest: ctx.inRequest,              // 上下文：请求处理路径
        inStartup: ctx.inStartup,              // 上下文：启动路径（新增，四级标准）
        risk: graded.risk,                     // 综合风险等级（四级，供排序/过滤）
        riskFromAst: graded.fromAst,           // 分级来源（AST / 行级兜底）
        path: resolved,
        raw: rawArg,
      });
    }
  }
  return hits;
}

/**
 * 综合风险评级（判读「这次 I/O 会不会卡住其他请求 / 会不会丢数据」）：
 *   high   —— 写/删/改名 且 在请求路径或循环里（并发下都可能被放大）
 *   medium —— 同步 I/O 落在 async 路径/循环里（阻塞事件循环），或写类操作
 *   low    —— 其余（普通读、异步读）
 */
/**
 * 旧行级启发式分级（3 级）——仅作 AST 不可用时的兜底。
 *   自 2026-09-17 起，常规路径改用 lib/ast/io-risk.js 的四级标准（与审计一致），
 *   本函数保留以免 AST 解析异常时整条命中丢失分级信息。
 */
function riskOfFallback(entry, ctx) {
  const writeish = WRITE_KINDS.has(entry.kind);
  const sync = ioTypeOf(entry.op) === 'sync';
  if (writeish && (ctx.inRequest || ctx.inLoop)) return 'high';
  if (sync && (ctx.inAsync || ctx.inLoop || ctx.inRequest)) return 'medium';
  if (writeish) return 'medium';
  return 'low';
}

/**
 * 按 (行号, 操作名) 从 AST 结果查分级。
 *   AST 层在循环/函数上下文判定上比行级启发式准确（tokenizer + 花括号配对），
 *   故以它为准；查不到（如宏/动态调用）才退回行级。
 *
 * @param {Array} astHits 本文件的 scanIoRiskAst 结果
 * @param {number} line 1-based 行号
 * @param {string} op 操作名（如 readFileSync）
 * @param {object} entry 行级命中项
 * @param {object} ctx 行级上下文
 */
function riskOfByAst(astHits, line, op, entry, ctx) {
  const hit = astHits.find((h) => h.line === line && h.call === op);
  if (!hit) return { risk: riskOfFallback(entry, ctx), ctx, fromAst: false };
  return {
    risk: hit.risk,
    ctx: {
      inAsync: hit.inAsync,
      inLoop: hit.inLoop,
      inRequest: hit.inRequest,
      inStartup: hit.inStartup,
    },
    fromAst: true,
  };
}

/** 预收集文件级变量赋值（只收字符串/join 类路径表达式）。 */
function collectVarAssignments(lines) {
  const map = new Map(); // 变量名 → { value, line }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // const NAME = '...' 或 const NAME = join('...', '...')
    const declMatch = line.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;?\s*$/);
    if (!declMatch) continue;
    const name = declMatch[1];
    const val = declMatch[2].trim();
    if (/^['"`]/.test(val) || /^join\s*\(/.test(val) || /^resolve\s*\(/.test(val)) {
      map.set(name, { value: val, line: i + 1 });
    }
  }
  return map;
}

/** 以匹配到的操作名为锚点，提取其括号内第一个参数（字符串/模板/变量）。 */
function extractArg(line, op, opName) {
  // 操作名可能带别名（readFileSync as rfs），但行内通常是 <opName>(…)
  const nameRe = new RegExp(`[A-Za-z_$][\\w$]*\\b`, 'g');
  let found = null;
  let foundIdx = -1;
  let nameMatch;
  while ((nameMatch = nameRe.exec(line)) !== null) {
    if (nameMatch[0] === opName) { found = nameMatch[0]; foundIdx = nameMatch.index; break; }
  }
  // 备选：行内只有该操作名出现且带括号（无别名场景退化）
  if (found === null) {
    const simple = line.match(new RegExp(`\\b${opName}\\s*\\(`));
    if (!simple) return null;
    foundIdx = simple.index + simple[0].indexOf('(');
  }
  const openIdx = line.indexOf('(', foundIdx);
  if (openIdx === -1) return null;
  const after = line.slice(openIdx + 1);
  const am = after.match(/^\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|([A-Za-z_$][\w$]*))/);
  if (!am) return null;
  if (am[1] !== undefined) return am[1];
  if (am[2] !== undefined) return am[2];
  if (am[3] !== undefined) return `\`${am[3]}\``;
  return am[4]; // 变量名
}

/** 尽力把参数解析为可读路径：静态串原样；模板串标 <expr>；变量溯源。 */
function resolvePathArg(arg, varMap, lineIdx) {
  if (arg.startsWith('`')) {
    // 模板字符串：去掉反引号，插值标 <expr>；join(…) 展开
    const inner = arg.slice(1, -1);
    const cleaned = inner.replace(/\$\{[^}]*\}/g, '<expr>');
    return `\`${cleaned}\``;
  }
  if (arg.startsWith("'") || arg.startsWith('"')) return arg.slice(1, -1);
  // 变量：溯源
  const v = varMap.get(arg);
  if (v) return `${v.value}  (L${v.line})`;
  return `${arg}  (变量未溯源)`;
}

/* ───────────────────────── 输出 ───────────────────────── */

/** 单条命中渲染成一行标签串（三标签 + 风险）。 */
function tagsOf(h) {
  const t = [h.type === 'sync' ? '同步' : '异步', h.kind];
  if (h.inAsync) t.push('async内');
  if (h.inLoop) t.push('循环内');
  if (h.inRequest) t.push('请求路径');
  return t.join('·');
}

/** 风险徽标。 */
function riskMark(risk) {
  return risk === 'high' ? '🔴' : risk === 'medium' ? '🟠' : '·';
}

/**
 * 文本输出（按风险降序，高危在前）。
 * @param {Array} hits 命中
 * @param {object} opts { writeOnly, riskOnly, summary }
 */
function printText(hits, { writeOnly = false, riskOnly = '', summary = false } = {}) {
  let filtered = writeOnly ? hits.filter((h) => WRITE_KINDS.has(h.kind)) : hits;
  if (riskOnly) filtered = filtered.filter((h) => h.risk === riskOnly);
  if (!filtered.length) { console.log('（未命中任何文件操作）'); return; }

  // 汇总视图：按 类型/操作/风险 计数（复用 CLI 同款 summarize）
  if (summary) {
    summarize(filtered);
    return;
  }

  // 按文件分组；组内按行号
  const byFile = new Map();
  for (const entry of filtered) {
    if (!byFile.has(entry.file)) byFile.set(entry.file, []);
    byFile.get(entry.file).push(entry);
  }
  for (const [file, hs] of [...byFile.entries()].sort()) {
    console.log(`\n── ${file} (${hs.length}) ──`);
    for (const entry of hs.sort((a, b) => a.line - b.line)) {
      console.log(`  ${riskMark(entry.risk)} L${String(entry.line).padEnd(4)} ${entry.op.padEnd(14)} ${tagsOf(entry)}`);
      console.log(`       ${entry.path}`);
    }
  }
  console.log(`\n合计 ${filtered.length} 处文件操作（🔴high=写/删且并发路径 · 🟠medium=同步阻塞或写类 · ·low=普通读）`);
}

/** JSON 输出（含全部标签字段）。 */
function printJson(hits) {
  console.log(JSON.stringify(hits, null, 2));
}

/* ───────────────────────── 主流程 ───────────────────────── */

/**
 * 主流程（可被 CLI 复用）。
 * @param {string[]} argv 参数（不含 node/脚本名）
 */
export function main(argv = process.argv.slice(2)) {
  const args = argv;
  const json = args.includes('--json');
  const writeOnly = args.includes('--write');
  const summary = args.includes('--summary');
  const report = args.includes('--report');
  let riskOnly = '';
  const opFilter = [];
  const kindFilter = [];
  const typeFilter = [];
  // 多值支持：--kind delete,rename 或 --kind delete --kind rename 均可
  const splitMulti = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  // 记录「被 flag 消费掉的位置」，供 targets 精确排除——此前用黑名单正则排除单值，
  //   `--kind delete,rename` 这种逗号多值整体不匹配黑名单，被当成路径去扫（结果空）。
  const consumed = new Set();
  const takeValue = (i) => { consumed.add(i + 1); return args[i + 1]; };
  let reportLimit = 20;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--op') opFilter.push(...splitMulti(takeValue(i)));
    else if (args[i] === '--kind') kindFilter.push(...splitMulti(takeValue(i)));
    else if (args[i] === '--type') typeFilter.push(...splitMulti(takeValue(i)));
    else if (args[i] === '--risk') riskOnly = takeValue(i);
    else if (args[i] === '--report-limit') reportLimit = Number(takeValue(i)) || 20;
  }
  const targets = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
  const root = dirname(fileURLToPath(import.meta.url));
  const defaults = targets.length ? targets : [
    join(root, '..', 'lib'),
    join(root, '..', 'scripts'),
    join(root, '..', 'cli.mjs'),
    join(root, '..', 'lib', 'client.js'),
  ];
  const files = collectFiles(defaults);
  let hits = [];
  for (const f of files) hits = hits.concat(scanFile(f));
  if (opFilter.length) hits = hits.filter((h) => opFilter.some((o) => h.op.includes(o)));
  if (kindFilter.length) hits = hits.filter((h) => kindFilter.includes(h.kind));
  if (typeFilter.length) hits = hits.filter((h) => typeFilter.includes(h.type));
  // 高危优先（同风险按文件/行号稳定排序）
  hits.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return (rank[a.risk] - rank[b.risk]) || a.file.localeCompare(b.file) || a.line - b.line;
  });
  if (json) printJson(hits);
  else if (report) printReport(hits, { limit: reportLimit });
  else printText(hits, { writeOnly, riskOnly, summary });
  return hits;
}

/** 供 CLI 复用：扫描 + 按标签过滤，返回命中数组（不打印）。 */
export function scanFileIo(opts = {}) {
  const { targets = [], opFilter = [], kindFilter = [], typeFilter = [], riskOnly = '', writeOnly = false } = opts;
  const root = dirname(fileURLToPath(import.meta.url));
  const dirs = targets.length ? targets : [
    join(root, '..', 'lib'), join(root, '..', 'scripts'),
    join(root, '..', 'cli.mjs'), join(root, '..', 'lib', 'client.js'),
  ];
  const files = collectFiles(dirs);
  let hits = [];
  for (const f of files) hits = hits.concat(scanFile(f));
  if (writeOnly) hits = hits.filter((h) => WRITE_KINDS.has(h.kind));
  if (opFilter.length) hits = hits.filter((h) => opFilter.some((o) => h.op.includes(o)));
  if (kindFilter.length) hits = hits.filter((h) => kindFilter.includes(h.kind));
  if (typeFilter.length) hits = hits.filter((h) => typeFilter.includes(h.type));
  if (riskOnly) hits = hits.filter((h) => h.risk === riskOnly);
  hits.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return (rank[a.risk] - rank[b.risk]) || a.file.localeCompare(b.file) || a.line - b.line;
  });
  return hits;
}

/** 供 CLI 复用：打印三标签汇总。 */
export function summarize(hits) {
  const count = (key) => {
    const counter = new Map();
    for (const entry of hits) counter.set(entry[key], (counter.get(entry[key]) || 0) + 1);
    return [...counter.entries()].sort((a, b) => b[1] - a[1]);
  };
  console.log(`合计 ${hits.length} 处文件操作\n`);
  console.log('【类型】' + count('type').map(([k, v]) => `${k === 'sync' ? '同步' : '异步'} ${v}`).join('  '));
  console.log('【操作】' + count('kind').map(([k, v]) => `${k} ${v}`).join('  '));
  console.log('【上下文】异步函数内 ' + hits.filter((h) => h.inAsync).length
    + '  循环内 ' + hits.filter((h) => h.inLoop).length
    + '  请求路径 ' + hits.filter((h) => h.inRequest).length
    + '  启动路径 ' + hits.filter((h) => h.inStartup).length);
  // 四级风险（2026-09-17 起与审计 robustness/io-risk 同一标准）
  console.log('【风险】' + ['high', 'medium', 'low', 'safe']
    .map((r) => `${RISK_BADGE[r]}${RISK_LABEL[r]} ${hits.filter((h) => h.risk === r).length}`)
    .join('  '));
}

/**
 * --report：统计 + 改造优先级清单（文本表格）。
 *   与 --summary（用户视角的计数概览）不同，本视图面向「下一步改哪个」：
 *     ① 统计块：同步/异步占比、四级风险分布、I/O 密集文件排行
 *     ② 优先级清单：高风险项按 风险 > 写类 > 同步 排序，给出行号、上下文与理由
 *   数据来源：AST 层 summarizeIoRisk / rankIoFixList（与审计同一标准）。
 *
 * @param {Array} hits 全部命中
 * @param {{limit?:number}} opts limit=清单最多条数（默认 20）
 */
function printReport(hits, opts = {}) {
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 20;
  const sum = summarizeIoRisk(hits);

  const bar = '─'.repeat(72);
  console.log(bar);
  console.log('  I/O 风险报告（四级标准，与审计 robustness/io-risk 一致）');
  console.log(bar);
  console.log(`  总调用 ${sum.total} 处` + (sum.total
    ? `（同步 ${sum.sync} / 异步 ${sum.total - sum.sync}，同步占比 ${Math.round(sum.sync / sum.total * 100)}%）`
    : ''));
  if (sum.total === 0) {
    console.log('  未发现文件 I/O 调用。');
    console.log(bar);
    return;
  }

  // 风险分布
  console.log('');
  console.log('  【风险分布】');
  for (const r of ['high', 'medium', 'low', 'safe']) {
    const n = sum.byRisk[r] || 0;
    const pct = Math.round(n / sum.total * 100);
    const filled = Math.round(pct / 100 * 24);
    console.log(`    ${RISK_BADGE[r]} ${RISK_LABEL[r].padEnd(2)} ${String(n).padStart(4)} 处  ${'█'.repeat(filled)}${'░'.repeat(24 - filled)}  ${pct}%`);
  }

  // 操作类别分布
  console.log('');
  console.log('  【操作类别】');
  const kindLabel = { read: '读取', write: '写入', delete: '删除', rename: '改名', meta: '元信息' };
  console.log('    ' + Object.entries(sum.byKind)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${kindLabel[k] || k} ${v}`)
    .join('   '));

  // I/O 密集文件排行
  if (sum.byFile && sum.byFile.length) {
    console.log('');
    console.log('  【I/O 密集文件 TOP' + Math.min(10, sum.byFile.length) + '】（改造收益从高到低）');
    sum.byFile.slice(0, 10).forEach(({ file, count }, i) => {
      console.log(`    ${String(i + 1).padStart(2)}. ${String(count).padStart(3)} 处  ${file}`);
    });
  }

  // 优先级清单
  const ranked = rankIoFixList(hits).filter((h) => h.risk === 'high' || h.risk === 'medium');
  console.log('');
  console.log('  【改造优先级清单】（高风险在前；风险 > 写类 > 同步）');
  if (!ranked.length) {
    console.log('    ✓ 无高风险/中风险项');
  } else {
    for (const entry of ranked.slice(0, limit)) {
      const ctxs = [];
      if (entry.inAsync) ctxs.push('异步路径');
      if (entry.inLoop) ctxs.push('循环内');
      if (entry.inRequest) ctxs.push('请求路径');
      if (entry.inStartup) ctxs.push('启动路径');
      const callName = entry.call || entry.op || '(未知调用)';
      console.log(`    ${String(entry.rank).padStart(3)}. ${RISK_BADGE[entry.risk]}${RISK_LABEL[entry.risk]}  ${entry.file}:${entry.line}`);
      console.log(`         ${callName}  ·  ${entry.kind}  ·  ${ctxs.join('+') || '—'}`);
      if (entry.reason) console.log(`         ${entry.reason}`);
      console.log(`         路径: ${entry.path || '(未解析)'}`);
    }
    if (ranked.length > limit) {
      console.log(`    … 另有 ${ranked.length - limit} 项，用 --report-limit <n> 调整`);
    }
  }

  // 验证提醒
  console.log('');
  console.log('  【改造后验证】');
  console.log('    · 同步改异步后：跑一遍受影响路径的测试，确认无时序变化');
  console.log('    · 循环内改并发：确认并发上限（避免 fd 耗尽），保留原顺序语义');
  console.log('    · 写/删类改造：先确认有备份或 git 历史（可恢复）');
  console.log(bar);
}

// 直接运行时入口（被 import 时不执行）
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('scan-file-io.mjs')) {
  main();
}
