/**
 * dsh-git-push — README 目录结构维护脚本（2026-09-14）
 *
 * 功能（三个子命令）：
 *   gen   —— 用 `git ls-files` 读「所有 git 未忽略文件」，生成目录结构文本
 *             （两层折叠：顶层目录全列、子目录只到一层、嵌套用 … 折叠），
 *             每项从 tree-doc.json 取一句话介绍；映射缺失的路径标（待注释）。
 *   check —— 解析 README 标记块（<!-- dshgp-tree:start/end -->）内现有树，
 *             与真实文件树对比，报告漂移（新增/删除/改注释），**不改文件**。
 *   apply —— 用新生成的树覆盖 README 标记块内容（显式执行才写盘）。
 *
 * 注释映射：<项目根>/tree-doc.json —— { "路径": "一句话介绍", ... }
 *   由 AI/人维护；gen 时合并；check 同时校验映射无孤儿路径（引用了不存在文件）。
 *
 * 用法：
 *   node scripts/tree-doc.mjs gen             # 生成树文本（stdout）
 *   node scripts/tree-doc.mjs gen --write     # 写入 tree-doc.json（骨架，待注释）
 *   node scripts/tree-doc.mjs check [--readme README.md]   # 检查漂移
 *   node scripts/tree-doc.mjs apply [--readme README.md]   # 覆盖 README 标记块
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAPPING_FILE = join(ROOT, 'tree-doc.json');
const MARK_START = '<!-- dshgp-tree:start -->';
const MARK_END = '<!-- dshgp-tree:end -->';
const DEFAULT_README = join(ROOT, 'README.md');
// 顶层展示目录（树只列这些分支；其余文件放根级）；未忽略清单里其余顶层路径自动归组
const TOP_DIRS = [
  'lib', 'scripts', 'assets', 'test', 'docs', 'skills',
  'client.js', 'cli.mjs', 'package.json', 'README.md', 'cordis.patch.yml',
];

/* ───────────────────────── git 未忽略文件清单 ───────────────────────── */

function gitLsFiles(root = ROOT) {
  try {
    // 已跟踪 + 未跟踪但未忽略（新文件/待提交都算「未忽略文件」，README 目录树应含它们）
    const out = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/* ───────────────────────── 注释映射读写 ───────────────────────── */

function loadMapping() {
  if (!existsSync(MAPPING_FILE)) return {};
  try { return JSON.parse(readFileSync(MAPPING_FILE, 'utf8')); } catch { return {}; }
}

function writeMapping(map) {
  writeFileSync(MAPPING_FILE, JSON.stringify(map, null, 2) + '\n', 'utf8');
}

/* ───────────────────────── 两层树构建 ───────────────────────── */

/** 顶层归类：返回 { groups: [{name, entries:[路径]}], rootFiles: [路径] } */
function buildGroups(files) {
  const groups = new Map(); // 顶层目录名 → 其下文件路径列表
  const rootFiles = [];
  const known = new Set(TOP_DIRS);
  for (const f of files) {
    const top = f.split('/')[0];
    if (!f.includes('/')) rootFiles.push(f); // 根级文件
    else {
      if (!groups.has(top)) groups.set(top, []);
      groups.get(top).push(f);
    }
  }
  // 未在 TOP_DIRS 的顶层目录也归组（放后面）
  const groupNames = [...groups.keys()];
  const order = [...TOP_DIRS.filter((k) => groups.has(k)), ...groupNames.filter((n) => !TOP_DIRS.includes(n))];
  return { groups, groupNames: order, rootFiles: [...new Set(rootFiles)] };
}

/** 目录组 → 两层折叠文本行（子目录只到一层，更深用 …） */
function groupLines(name, paths, map, prefix = '') {
  const lines = [];
  // 该组下第一层：直接文件 vs 子目录
  const direct = [];
  const subdirs = new Map(); // 子目录名 → 其下文件
  for (const p of paths) {
    const rest = p.slice(name.length + 1); // 去掉顶层
    if (!rest.includes('/')) direct.push(p);
    else {
      const sub = rest.split('/')[0];
      if (!subdirs.has(sub)) subdirs.set(sub, []);
      subdirs.get(sub).push(p);
    }
  }
  const note = (p) => (map[p] ? map[p] : '（待注释）');
  for (const d of direct.sort()) lines.push(`│   ├── ${basename(d)} — ${note(d)}`);
  for (const [sub, items] of [...subdirs.entries()].sort()) {
    const subPath = `${name}/${sub}`;
    // 第二层直接文件；更深折叠
    const second = items.map((p) => p.slice(subPath.length + 1)).filter((r) => !r.includes('/')).sort();
    const deeper = items.filter((p) => p.slice(subPath.length + 1).includes('/')).length;
    lines.push(`│   ├── ${sub}/ — ${map[subPath] || (second.length ? '' : '（待注释）')}`);
    for (const s of second) lines.push(`│   │   ├── ${s} — ${note(`${subPath}/${s}`)}`);
    if (deeper) lines.push(`│   │   └── …（${deeper} 个更深文件）`);
  }
  return lines;
}

/** 生成完整树文本（顶层分组 + 根文件，两层折叠） */
export function buildTreeText(files = gitLsFiles(), map = loadMapping()) {
  const { groups, groupNames, rootFiles } = buildGroups(files);
  const out = ['```text', 'dsh-git-push/'];
  for (const g of groupNames) {
    out.push(`├── ${g}/ — ${map[g] || '（待注释）'}`);
    out.push(...groupLines(g, groups.get(g), map));
  }
  for (const rf of [...rootFiles].sort()) {
    out.push(`├── ${rf} — ${map[rf] || '（待注释）'}`);
  }
  out.push('```');
  return out.join('\n');
}

/* ───────────────────────── README 标记块读写 ───────────────────────── */

function findBlock(text) {
  const s = text.indexOf(MARK_START);
  const e = text.indexOf(MARK_END);
  if (s === -1 || e === -1 || e <= s) return null;
  return { start: s, end: e, content: text.slice(s + MARK_START.length, e) };
}

function readReadme(path) {
  if (!existsSync(path)) throw new Error(`README 不存在: ${path}`);
  return readFileSync(path, 'utf8');
}

function applyBlock(text, newTree) {
  const block = findBlock(text);
  if (!block) throw new Error('README 未找到标记块（<!-- dshgp-tree:start --> … <!-- dshgp-tree:end -->），先插入标记再 apply');
  return text.slice(0, block.start) + MARK_START + '\n' + newTree + '\n' + MARK_END + text.slice(block.end + MARK_END.length);
}

/* ───────────────────────── check：漂移对比 ───────────────────────── */

export function checkDrift({ readmePath = DEFAULT_README } = {}) {
  const text = readReadme(readmePath);
  const block = findBlock(text);
  const real = buildTreeText();
  const map = loadMapping();
  // 真实树内已解析条目（路径集合）
  const realPaths = new Set(gitLsFiles());
  const issues = [];
  if (!block) {
    issues.push({ type: 'no-block', msg: `README 没有目录结构标记块（${MARK_START} … ${MARK_END}）` });
    return { ok: false, drift: true, issues, realTree: real };
  }
  // 现有块内容 → 提取完整相对路径（按缩进深度拼层级），目录带尾斜杠
  const inBlock = block.content;
  const seen = new Set();
  const foldedDirs = []; // 折叠点目录（… N 个更深文件 → 该目录下更深文件不逐项核对）
  let stack = [];
  for (const line of inBlock.split('\n')) {
    // 缩进深度 = 前缀 `│   ` 的个数（顶层=0）
    const depth = (line.match(/│   /g) || []).length;
    const m = line.replace(/^(\s*)(?:│   )*(?:├──|└──)\s*/, '').trim();
    if (!m || m.startsWith('```')) continue; // 跳过代码围栏行
    if (m.startsWith('…')) {
      // 折叠行：当前目录链即折叠点（其下更深文件除外）
      if (stack.length) foldedDirs.push(stack.join('/') + '/');
      continue;
    }
    // 按「—」切出名字段（trim 后破折号后无空格，split(' — ') 会失效）
    const name = m.split('—')[0].trim();
    if (!name || name === 'dsh-git-push' || name === 'dsh-git-push/') continue;
    stack = stack.slice(0, depth); // 回退到当前深度
    if (name.endsWith('/')) {
      const dir = name.slice(0, -1);
      seen.add([...stack, dir].join('/') + '/');
      stack = [...stack, dir];
    } else {
      seen.add([...stack, name].join('/'));
    }
  }
  // 真实路径集合（git 未忽略文件 + 真实目录）
  const realSet = new Set();
  for (const p of realPaths) realSet.add(p);
  const isRealDir = (p) => { try { return statSync(join(ROOT, p.replace(/\/$/, ''))).isDirectory(); } catch { return false; } };
  // missing：真实文件不在树上（被折叠的设计除外）
  const missing = [];
  for (const p of realPaths) {
    const folded = foldedDirs.some((d) => p.startsWith(d));
    if (!folded && !seen.has(p) && !isRealDir(p)) missing.push(p);
  }
  // stale：树上列出但真实不存在（文件或目录）
  const stale = [];
  for (const s of seen) {
    if (s.endsWith('/')) { if (!isRealDir(s)) stale.push(s); }
    else if (!realSet.has(s)) stale.push(s);
  }
  // 注释映射孤儿：路径既不是 git 文件，也不是真实目录（目录级注释合法）
  const orphans = [];
  for (const p of Object.keys(map)) {
    const full = join(ROOT, p);
    let realDir = false;
    try { realDir = statSync(full).isDirectory(); } catch { /* 不存在 */ }
    if (!realSet.has(p) && !realDir) orphans.push(p);
  }
  const drift = missing.length > 0 || stale.length > 0 || orphans.length > 0;
  if (missing.length) issues.push({ type: 'missing', msg: `真实存在但 README 未列（新增未更新）: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? `…(+${missing.length - 12})` : ''}` });
  if (stale.length) issues.push({ type: 'stale', msg: `README 列出但真实不存在（已删除）: ${stale.join(', ')}` });
  if (orphans.length) issues.push({ type: 'orphan', msg: `tree-doc.json 映射了不存在的路径: ${orphans.join(', ')}` });
  return { ok: !drift, drift, issues, realTree: real };
}

/* ───────────────────────── CLI ───────────────────────── */
// 仅直接运行时执行（测试 import 本文件不应触发 CLI）
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const readmeIdx = args.indexOf('--readme');
  const readmePath = readmeIdx !== -1 ? resolve(args[readmeIdx + 1] || DEFAULT_README) : DEFAULT_README;

  switch (cmd) {
    case 'gen': {
      const map = loadMapping();
      const files = gitLsFiles();
      if (args.includes('--write')) {
        // 骨架：给无注释路径补（待注释）占位
        const skeleton = {};
        for (const p of files) if (!(p in map)) skeleton[p] = '（待注释）';
        writeMapping({ ...map, ...skeleton });
        console.log(`tree-doc.json 骨架已写（${Object.keys(skeleton).length} 个待注释路径）`);
      } else {
        console.log(buildTreeText(files, map));
      }
      break;
    }
    case 'check': {
      const r = checkDrift({ readmePath });
      if (r.ok) { console.log('✅ 目录结构与 README 一致（无漂移）'); process.exit(0); }
      console.log('❌ 存在漂移：');
      for (const i of r.issues) console.log('  -', i.msg);
      if (r.realTree) console.log('\n═══ 最新树（可用 apply 覆盖）═══\n' + r.realTree);
      process.exit(1);
    }
    case 'apply': {
      const tree = buildTreeText();
      const text = readReadme(readmePath);
      const updated = applyBlock(text, tree);
    writeFileSync(readmePath, updated, 'utf8');
    console.log(`✅ 已覆盖 README 目录结构块: ${readmePath}`);
    break;
  }
  default:
    console.log('用法: node scripts/tree-doc.mjs <gen|check|apply> [--readme <路径>] [--write]');
    process.exit(1);
}
}