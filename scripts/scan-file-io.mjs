#!/usr/bin/env node
/**
 * dsh-git-push — 文件读写调用扫描器（2026-09-16）
 *
 * 用途：把项目代码里所有「读/写文件」的调用位置找出来，并尽力解析出读写的
 *   文件路径/文件名——用于核查「某配置写没写、某个文件被哪些地方读写」。
 *
 * 扫描对象：fs 相关调用（readFileSync/writeFileSync/appendFileSync/renameSync/
 *   mkdirSync/readdirSync/existsSync/statSync/unlinkSync/rmSync/copyFileSync/
 *   createWriteStream/createReadStream/openSync 等），以及 node:fs 导入名别名
 *   （如 `import { readFileSync as rf }` 会用 rf(…) 解析）。
 *
 * 路径解析策略（按优先级）：
 *   ① 静态字符串参数（'config.json'、join(a, 'x.json') 的可计算片段）
 *   ② 模板字符串（`${dir}/x.json`，插值部分标 <expr>）
 *   ③ 变量参数（溯源同文件内的 `const x = '…'` / `const x = join(…)` 赋值，
 *      能解析就展开，不能则标变量名 + 位置）
 *
 * 用法：
 *   node scripts/scan-file-io.mjs <文件|目录>…          # 扫指定路径（默认项目根 lib/ scripts/ cli.mjs client.js）
 *   node scripts/scan-file-io.mjs --json                 # JSON 输出（机器可读）
 *   node scripts/scan-file-io.mjs --write                # 只列写操作（读操作也列，但写突出）
 *   node scripts/scan-file-io.mjs --op writeFileSync     # 只看指定操作（可多次）
 *
 * 输出（文本）：文件:行号 | 操作 | 路径参数（解析结果）| 原始参数
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ───────────────────────── 配置 ───────────────────────── */

/** 要识别的文件操作（正则键 → 显示名）。覆盖 node:fs 常用读写/元数据操作。 */
const FS_OPS = [
  [/readFileSync|readFile/, 'read'],
  [/writeFileSync|writeFile/, 'write'],
  [/appendFileSync|appendFile/, 'append'],
  [/renameSync|rename/, 'rename'],
  [/copyFileSync|copyFile/, 'copy'],
  [/unlinkSync|unlink/, 'unlink'],
  [/rmSync|rm/, 'rm'],
  [/mkdirSync|mkdir/, 'mkdir'],
  [/readdirSync|readdir/, 'readdir'],
  [/existsSync|exists/, 'exists'],
  [/statSync|stat/, 'stat'],
  [/createWriteStream/, 'write-stream'],
  [/createReadStream/, 'read-stream'],
  [/openSync|open/, 'open'],
];

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
    const c = line[i];
    const next = line[i + 1];
    if (lineComment) { i++; continue; }
    if (blockComment) {
      if (c === '*' && next === '/') { blockComment = false; i += 2; continue; }
      i++; continue;
    }
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (regexMode) {
      if (c === '\\') { i += 2; continue; }
      if (c === '/') regexMode = false;
      i++; continue;
    }
    if (c === '/' && next === '/') { lineComment = true; i += 2; continue; }
    if (c === '/' && next === '*') { blockComment = true; i += 2; continue; }
    if (c === '/' && /[A-Za-z0-9\\^$.|?*+()\[\]{}]/.test(next || '')) { regexMode = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; i++; continue; }
    out += c;
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
  // 预收集本文件的变量赋值（路径类）：const x = 'str' / const x = join(...) 等
  const varMap = collectVarAssignments(lines);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = stripLiterals(line); // 剔除字符串/注释/正则字面量，防误识别
    if (/^\s*import\s|^\s*\/\/|^\s*\*/.test(line)) continue;
    for (const [re, op] of FS_OPS) {
      const m = code.match(re);
      if (!m) continue;
      const arg = extractArg(code, op, m[0]);
      if (arg === null) continue;
      const resolved = resolvePathArg(arg, varMap, i);
      hits.push({ file, line: i + 1, op, path: resolved, raw: arg });
    }
  }
  return hits;
}

/** 预收集文件级变量赋值（只收字符串/join 类路径表达式）。 */
function collectVarAssignments(lines) {
  const map = new Map(); // 变量名 → { value, line }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // const NAME = '...' 或 const NAME = join('...', '...')
    const m = line.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;?\s*$/);
    if (!m) continue;
    const name = m[1];
    const val = m[2].trim();
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
  let m;
  while ((m = nameRe.exec(line)) !== null) {
    if (m[0] === opName) { found = m[0]; foundIdx = m.index; break; }
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

/** 文本输出。 */
function printText(hits, { writeOnly = false } = {}) {
  const filtered = writeOnly ? hits.filter((h) => ['write', 'append', 'rename', 'copy', 'unlink', 'rm', 'mkdir', 'write-stream'].includes(h.op)) : hits;
  if (!filtered.length) { console.log('（未命中任何文件操作）'); return; }
  // 按文件分组
  const byFile = new Map();
  for (const h of filtered) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  for (const [file, hs] of [...byFile.entries()].sort()) {
    console.log(`\n── ${file} (${hs.length}) ──`);
    for (const h of hs) {
      const mark = ['write', 'append', 'rename', 'copy', 'unlink', 'rm', 'mkdir', 'write-stream'].includes(h.op) ? '✍' : '📖';
      console.log(`  ${mark} L${String(h.line).padEnd(4)} ${h.op.padEnd(12)} ${h.path}`);
      console.log(`       原参: ${h.raw}`);
    }
  }
  console.log(`\n合计 ${filtered.length} 处文件操作`);
}

/** JSON 输出。 */
function printJson(hits) {
  console.log(JSON.stringify(hits, null, 2));
}

/* ───────────────────────── 主流程 ───────────────────────── */

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const writeOnly = args.includes('--write');
  const opFilter = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--op') opFilter.push(args[++i]);
  const targets = args.filter((a) => !a.startsWith('--'));
  const root = dirname(fileURLToPath(import.meta.url));
  const defaults = targets.length ? targets : [
    join(root, '..', 'lib'),
    join(root, '..', 'scripts'),
    join(root, '..', 'cli.mjs'),
    join(root, '..', 'client.js'),
  ];
  const files = collectFiles(defaults);
  let hits = [];
  for (const f of files) hits = hits.concat(scanFile(f));
  if (opFilter.length) hits = hits.filter((h) => opFilter.some((o) => h.op.includes(o)));
  if (json) printJson(hits);
  else printText(hits, { writeOnly });
}

main();
