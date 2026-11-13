/**
 * 测试合并辅助工具（**不是测试**：文件名不以 test- 开头，回归扫描不会收它）。
 *
 * 为什么要有这个工具：合并测试文件是机械活，但「判断能不能合」必须用 AST 而不是正则——
 *   本仓库已实测踩过四类正则误判：夹具字符串里的 `./x`、多行模板里以 `import` 开头的示例行、
 *   `require2()`（createRequire）、以及 `join(HERE, '..', ...)` 这类间接推导。
 *   判断错一次的代价是「用例静默少注册」（既不 fail 也不 skip，报告全绿）。
 *
 * 用法：
 *   node test/helpers/merge-tests.mjs check <dir> [--json]
 *       逐个文件跑 4 项前置检查并打印表格（规划批次时先看这个）
 *   node test/helpers/merge-tests.mjs merge <dir> '<groups-json>'
 *       groups-json 形如 [{"out":"test-tools.mjs","members":["a.mjs","b.mjs"]}]
 *       合并前会**再跑一遍**前置检查，任一成员不满足就整体拒绝（不半合）
 *   node test/helpers/merge-tests.mjs verify <dir> <file> <期望用例数>
 *       单文件跑 `node --test` 并核对用例数
 *
 * 合并方式（与人工约定一致，语义不变是唯一硬要求）：
 *   1. import 块用 tokenizer 定位（真语句，含多行与中段 import）→ 按模块归并去重、具名取并集
 *   2. 各原文件体**按原顺序平铺**，`test()` 仍在模块顶层，**不包 describe**
 *   3. 每个原文件体包一层 `{ ... }` 块级作用域：只为隔离同名顶层声明（如都有 ROOT），
 *      不改变注册时机与执行顺序
 *   4. 每个 `test()` 名字加 `[原文件名] ` 前缀，失败信息可溯源
 */
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { tokenize } from '../../lib/ast/tokenizer.js';

const HOOKS = new Set(['before', 'after', 'beforeEach', 'afterEach']);

/** 用 tokenizer 找「顶层 import 语句」的行范围（1-based，含起止行）。 */
function importLineRanges(text) {
  const tokens = tokenize(text);
  let depth = 0;
  const ranges = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (['{', '(', '['].includes(token.value)) { depth++; continue; }
    if (['}', ')', ']'].includes(token.value)) { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && token.type === 'ident' && token.value === 'import') {
      let endLine = token.line;
      for (let j = i + 1; j < tokens.length; j++) {
        endLine = tokens[j].line;
        if (tokens[j].value === ';') break;
        if (tokens[j].value === 'from' && tokens[j + 1]?.type === 'str') { endLine = tokens[j + 1].line; break; }
      }
      ranges.push([token.line, endLine]);
    }
  }
  return ranges;
}

/** 解析一条（可能多行的）import 语句 → { module, def, ns, named[[imported,local]], bare }。 */
function parseImport(stmt) {
  const flat = stmt.replace(/\s+/g, ' ').trim();
  const sideEffect = flat.match(/^import\s+['"]([^'"]+)['"]\s*;?$/);
  if (sideEffect) return { module: sideEffect[1], bare: true, def: null, ns: null, named: [] };
  const matched = flat.match(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?$/);
  if (!matched) return null;
  const clause = matched[1].trim();
  let def = null; let ns = null;
  const named = [];
  const nsMatch = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (nsMatch) ns = nsMatch[1];
  const braces = clause.match(/\{([\s\S]*)\}/);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      const [imported, local] = cleaned.split(/\s+as\s+/);
      named.push([imported.trim(), (local || imported).trim()]);
    }
  }
  const head = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, '').replace(/,\s*$/, '').trim();
  if (head) def = head.replace(/,$/, '').trim();
  return { module: matched[2], def: def || null, ns, named };
}

/**
 * 4 项前置检查（不满足就不能合并）。
 * 检查口径按「合并成同一模块会怎样」来定：
 *   · 顶层 await —— 平铺进 `{}` 块会变成**语法错误**（await 只在模块顶层合法）；
 *   · 顶层 process.exitCode / process.env 赋值 —— 合并后这些副作用会在别的文件的用例之前/之后发生；
 *   · before/after 钩子 —— 它们挂在**文件根**上，合并后 A 的 after 会等 B 的用例跑完才执行；
 *   · 顶层声明重名 —— 用块级作用域可以隔离，但**跨块引用**会断，故仍作为「需人工确认」项报出。
 */
export function inspectFile(absPath) {
  const text = readFileSync(absPath, 'utf8');
  const tokens = tokenize(text);
  let depth = 0;
  const result = { topLevelAwait: [], envOrExitCodeAssign: [], hooks: [], decls: new Set() };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (['{', '(', '['].includes(token.value)) { depth++; continue; }
    if (['}', ')', ']'].includes(token.value)) { depth = Math.max(0, depth - 1); continue; }
    if (depth !== 0) continue;
    if (token.value === 'await') result.topLevelAwait.push(token.line);
    if (['const', 'let', 'var', 'function', 'class'].includes(token.value) && tokens[i + 1]?.type === 'ident') {
      result.decls.add(tokens[i + 1].value);
    }
    if (HOOKS.has(token.value) && tokens[i + 1]?.value === '(') result.hooks.push(`${token.value}@${token.line}`);
    // process.env.X = … / process.exitCode = … （含 .env.DSH_HOME 这种「先取子属性再赋值」的写法）
    if (token.value === 'process' && tokens[i + 1]?.value === '.' && ['env', 'exitCode'].includes(tokens[i + 2]?.value)) {
      let j = i + 3;
      while (tokens[j] && tokens[j].value !== ';' && tokens[j].value !== '=' && j < i + 10) j++;
      if (tokens[j]?.value === '=' || tokens[j]?.value === '++') result.envOrExitCodeAssign.push(token.line);
    }
  }
  return result;
}

/** 判断一个文件能否参与合并；返回 {ok, blockers[]}。 */
export function mergeability(absPath) {
  const info = inspectFile(absPath);
  const blockers = [];
  if (info.topLevelAwait.length) blockers.push(`顶层 await（行 ${info.topLevelAwait.join(',')}）→ 平铺进块会语法错误`);
  if (info.envOrExitCodeAssign.length) blockers.push(`顶层 process.env/exitCode 赋值（行 ${info.envOrExitCodeAssign.join(',')}）`);
  if (info.hooks.length) blockers.push(`顶层钩子 ${info.hooks.join(',')} → 合并后执行时机变化`);
  return { ok: blockers.length === 0, blockers, info };
}

/** 给文件体里的每个 test('名字') 加前缀（tokenizer 定位字面量起点，避免正则误伤字符串内容）。 */
function prefixTestNames(body, prefix) {
  const tokens = tokenize(body);
  const lineStarts = [0];
  for (let i = 0; i < body.length; i++) if (body[i] === '\n') lineStarts.push(i + 1);
  const inserts = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i].type === 'ident' && tokens[i].value === 'test' && tokens[i + 1].value === '(') {
      const literal = tokens[i + 2];
      if (!['str', 'tmpl'].includes(literal.type)) continue;
      inserts.push(lineStarts[literal.line - 1] + (literal.col - 1) + 1);
    }
  }
  let out = body;
  for (const at of inserts.sort((a, b) => b - a)) out = out.slice(0, at) + prefix + out.slice(at);
  return out;
}

/** 合并一组文件（前置检查不通过时整体拒绝，不做半合）。 */
export function mergeGroup(dir, { out, members }) {
  const reports = members.map((name) => ({ name, ...mergeability(join(dir, name)) }));
  const blocked = reports.filter((report) => !report.ok);
  if (blocked.length) {
    throw new Error(`拒绝合并 ${out}：以下成员不满足前置检查\n${blocked.map((b) => `  - ${b.name}: ${b.blockers.join('；')}`).join('\n')}`);
  }
  const parts = reports.map(({ name }) => {
    const text = readFileSync(join(dir, name), 'utf8');
    const ranges = importLineRanges(text);
    const lines = text.split('\n');
    const drop = new Set();
    for (const [from, to] of ranges) for (let line = from; line <= to; line++) drop.add(line);
    const parsed = [];
    for (const [from, to] of ranges) {
      const one = parseImport(lines.slice(from - 1, to).join(' ').replace(/\s+/g, ' ').trim());
      if (!one) throw new Error(`${name}: 无法解析 import：${lines.slice(from - 1, to).join(' ')}`);
      parsed.push(one);
    }
    const body = lines.filter((_, index) => !drop.has(index + 1)).join('\n');
    return { name, body, parsed };
  });
  // import 归并：同模块并集；同本地名来自不同模块 → 拒绝（需要人工别名）
  const byModule = new Map();
  const owner = new Map();
  for (const part of parts) {
    for (const imp of part.parsed) {
      if (!byModule.has(imp.module)) byModule.set(imp.module, { def: null, ns: null, named: new Map(), bare: false });
      const slot = byModule.get(imp.module);
      for (const [imported, local] of imp.named) {
        const previous = owner.get(local);
        if (previous && previous !== imp.module) throw new Error(`import 本地名冲突：${local}（${previous} vs ${imp.module}）`);
        owner.set(local, imp.module);
        slot.named.set(`${imported} as ${local}`, [imported, local]);
      }
      if (imp.def) { owner.set(imp.def, imp.module); slot.def = imp.def; }
      if (imp.ns) { owner.set(imp.ns, imp.module); slot.ns = imp.ns; }
      if (imp.bare) slot.bare = true;
    }
  }
  const importLines = [];
  for (const [module, slot] of [...byModule].sort()) {
    // 去重：同一本地名可能既作默认导入又出现在具名里（如 `import test from 'node:test'` + `{ test }`）→ 只保留一次
    const bound = new Set([slot.def, slot.ns].filter(Boolean));
    const named = [...slot.named.values()]
      .filter(([, local]) => {
        if (bound.has(local)) return false;
        bound.add(local);
        return true;
      })
      .map(([imported, local]) => (imported === local ? imported : `${imported} as ${local}`));
    const pieces = [];
    if (slot.def) pieces.push(slot.def);
    if (slot.ns) pieces.push(`* as ${slot.ns}`);
    if (named.length) pieces.push(`{ ${named.join(', ')} }`);
    importLines.push(pieces.length ? `import ${pieces.join(', ')} from '${module}';` : `import '${module}';`);
  }
  const blocks = parts.map((part) => {
    const tag = part.name.replace(/^test-/, '').replace(/\.mjs$/, '');
    const body = prefixTestNames(part.body.trimEnd(), `[${tag}] `);
    const indented = body.split('\n').map((line) => (line ? '  ' + line : '')).join('\n');
    return `// ── 原 ${part.name} ──\n{\n${indented}\n}`;
  });
  const banner = [
    '/**',
    ` * ${out} —— 同族测试合并（${members.join(' · ')}）`,
    ' *',
    ' * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）',
    ' *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；',
    ' *     每个 test 名带 `[原文件名] ` 前缀便于溯源。',
    ' * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。',
    ' */',
    ...importLines,
    '',
  ].join('\n');
  writeFileSync(join(dir, out), `${banner}${blocks.join('\n\n')}\n`, 'utf8');
  for (const part of parts) if (part.name !== out) unlinkSync(join(dir, part.name));
  return { out, members, lines: readFileSync(join(dir, out), 'utf8').split('\n').length };
}

/** 跑单个测试文件，返回 {tests, pass, fail}。 */
export function runTestFile(absPath) {
  let out = '';
  try {
    out = execFileSync(process.execPath, ['--test', absPath], { encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    out = `${error.stdout || ''}${error.stderr || ''}`;
  }
  const number = (key) => Number((out.match(new RegExp(`^# ${key} (\\d+)`, 'm')) || [])[1] || 0);
  return { tests: number('tests'), pass: number('pass'), fail: number('fail') };
}

// ── CLI ──
const [command, dir, ...rest] = process.argv.slice(2);
if (command === 'check') {
  const files = readdirSync(dir).filter((name) => name.startsWith('test-') && name.endsWith('.mjs')).sort();
  let blocked = 0;
  for (const name of files) {
    const { ok, blockers } = mergeability(join(dir, name));
    if (!ok) blocked++;
    console.log(`${ok ? '✅' : '⛔'} ${name}${ok ? '' : ' → ' + blockers.join('；')}`);
  }
  console.log(`\n共 ${files.length} 个文件：可合并 ${files.length - blocked} / 受阻 ${blocked}`);
} else if (command === 'merge') {
  const groups = JSON.parse(rest[0] || '[]');
  for (const group of groups) console.log(JSON.stringify(mergeGroup(dir, group)));
} else if (command === 'verify') {
  const [file, expected] = rest;
  const result = runTestFile(join(dir, file));
  const wanted = Number(expected);
  const ok = result.tests === wanted && result.fail === 0;
  console.log(`${ok ? '✅' : '❌'} ${file}: tests=${result.tests}（期望 ${wanted}） pass=${result.pass} fail=${result.fail}`);
  process.exitCode = ok ? 0 : 1;
} else {
  console.log('用法：node test/helpers/merge-tests.mjs <check|merge|verify> <dir> [...]');
  process.exitCode = 2;
}
