/**
 * dsh-git-push — README 目录结构维护脚本（2026-09-14，2026-09-15 索引自动同步化）
 *
 * 功能（四个子命令）：
 *   gen   —— 用 `git ls-files` 读「所有 git 未忽略文件」，生成目录结构文本
 *             （两层折叠：顶层目录全列、子目录只到一层、嵌套用 … 折叠），
 *             每项从 tree-doc.json 取一句话介绍；映射缺失的路径标（待注释）。
 *   check —— 解析 README 标记块（<!-- dshgp-tree:start/end -->）内现有树，
 *             与真实文件树对比，报告漂移（新增/删除/改注释），**不改文件**。
 *   apply —— 用新生成的树覆盖 README 标记块内容（显式执行才写盘）。
 *   sync  —— **索引自动同步（2026-09-15）**：对齐 tree-doc.json 的键集合与真实
 *             文件集——新增文件自动补键（描述=（待注释），等人/AI 补一句介绍）；
 *             删除文件自动删键（描述连带删除）。不再需要手动增删键，只补描述。
 *
 * 注释映射：<项目根>/tree-doc.json —— { "路径": "一句话介绍", ... }
 *   键集合（哪些文件被索引）= 脚本自动维护（sync/gen --write）；
 *   值（一句话介绍）= 人/AI 手动补：新增文件键值为（待注释），补描述后 git 提交。
 *
 * 用法：
 *   node scripts/tree-doc.mjs sync                # 索引自动同步（增删键），打印变更统计
 *   node scripts/tree-doc.mjs gen                 # 生成树文本（stdout）
 *   node scripts/tree-doc.mjs gen --write         # 索引同步 + 补（待注释）后写 tree-doc.json
 *   node scripts/tree-doc.mjs gen --all --write   # 强制全量追加（等价 sync，显式语义）
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
    return out.split('\n').map((l) => l.trim()).filter(Boolean).filter((p) => {
      // 缺陷修复 2026-09-15：--cached 会把「已跟踪但工作区已删」的文件也列出
      //   （如 mv 进 .trash 的旧文件仍留在索引），导致 check 误报「真实存在但未列」。
      //   目录树描述的是工作区现状，只保留工作区实际存在的文件。
      try { return statSync(join(root, p)).isFile(); } catch { return false; }
    });
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

/**
 * 索引自动同步（2026-09-15）：对齐 tree-doc.json 键集合与真实文件集。
 *   - 新增文件（git 未忽略、工作区存在）不在索引 → 自动补键，值=（待注释），等人补描述
 *   - 索引里有但文件已删 → 自动删键（描述连带删除），不再产生孤儿
 *   - 目录键（目录级注释合法）自动补齐：真实文件的所有父目录（无尾斜杠，与现有键一致）
 * @param {{write?: boolean, files?: string[], map?: object}} [opts] 测试可注入
 * @returns {{added: string[], removed: string[], map: object}}
 */
export function syncIndex({ write = true, files = gitLsFiles(), map = loadMapping() } = {}) {
  const added = [];
  const removed = [];
  const next = { ...map };
  // 真实存在路径：文件 + 父目录链（目录键无尾斜杠，与 tree-doc.json 现有键一致）
  const realFiles = new Set(files);
  const realDirs = new Set();
  for (const f of files) {
    let dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : null;
    while (dir) {
      realDirs.add(dir);
      const i = dir.lastIndexOf('/');
      dir = i === -1 ? null : dir.slice(0, i);
    }
  }
  // 删除孤儿键（文件或目录已不存在）
  for (const k of Object.keys(next)) {
    if (realFiles.has(k) || realDirs.has(k)) continue;
    removed.push(k);
    delete next[k];
  }
  // 补新增键（文件 + 目录），保持插入顺序稳定（先目录后文件：树父在前）
  const want = new Set([...realDirs, ...realFiles]);
  for (const p of want) {
    if (p in next) continue;
    next[p] = '（待注释）';
    added.push(p);
  }
  if (write && (added.length || removed.length)) writeMapping(next);
  return { added, removed, map: next };
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
  for (const entry of direct.sort()) lines.push(`│   ├── ${basename(entry)} — ${note(entry)}`);
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
  for (const groupName of groupNames) {
    out.push(`├── ${groupName}/ — ${map[groupName] || '（待注释）'}`);
    out.push(...groupLines(groupName, groups.get(groupName), map));
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
    const lineText = line.replace(/^(\s*)(?:│   )*(?:├──|└──)\s*/, '').trim();
    if (!lineText || lineText.startsWith('```')) continue; // 跳过代码围栏行
    if (lineText.startsWith('…')) {
      // 折叠行：当前目录链即折叠点（其下更深文件除外）
      if (stack.length) foldedDirs.push(stack.join('/') + '/');
      continue;
    }
    // 按「—」切出名字段（trim 后破折号后无空格，split(' — ') 会失效）
    const name = lineText.split('—')[0].trim();
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
    try { realDir = statSync(full).isDirectory(); } catch { /* 路径不存在：不算真实目录 */ }
    if (!realSet.has(p) && !realDir) orphans.push(p);
  }
  const drift = missing.length > 0 || stale.length > 0 || orphans.length > 0;
  if (missing.length) issues.push({ type: 'missing', msg: `真实存在但 README 未列（新增未更新）: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? `…(+${missing.length - 12})` : ''}` });
  if (stale.length) issues.push({ type: 'stale', msg: `README 列出但真实不存在（已删除）: ${stale.join(', ')}` });
  if (orphans.length) issues.push({ type: 'orphan', msg: `tree-doc.json 映射了不存在的路径（运行 tree-doc.mjs sync 自动清理）: ${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? `…(+${orphans.length - 8})` : ''}` });
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
  const forceAll = args.includes('--all');

  switch (cmd) {
    case 'sync': {
      // 索引自动同步：新增补（待注释）、删除自动删键（描述连带删）
      const { added, removed, map } = syncIndex({ write: !args.includes('--dry') });
      const dirs = new Set();
      for (const f of gitLsFiles()) {
        let dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : null;
        while (dir) { dirs.add(dir + '/'); const i = dir.lastIndexOf('/'); dir = i === -1 ? null : dir.slice(0, i); }
      }
      const tree = buildTreeText(gitLsFiles(), map);
      if (added.length) console.log(`✅ 新增索引键 ${added.length} 个（值=（待注释），请补描述）:\n  ${added.join('\n  ')}`);
      if (removed.length) console.log(`🗑  删除索引键 ${removed.length} 个（文件已删，描述连带删除）:\n  ${removed.join('\n  ')}`);
      if (!added.length && !removed.length) console.log('✅ 索引已同步（无新增/删除）');
      if (args.includes('--write-tree')) writeFileSync(DEFAULT_README, applyBlock(readReadme(DEFAULT_README), tree), 'utf8');
      console.log(`（tree-doc.json 现有 ${Object.keys(map).length} 键；gen 输出见 tree-doc.mjs gen）`);
      break;
    }
    case 'gen': {
      const files = gitLsFiles();
      if (args.includes('--write')) {
        // 索引同步 + 补（待注释）（2026-09-15：与 sync 同一逻辑，--all 为显式全量语义）
        const { added, removed } = syncIndex({ write: true, files });
        if (forceAll) console.log('--all：已强制全量追加索引');
        console.log(`tree-doc.json 已同步（新增 ${added.length} / 删除 ${removed.length}；${added.length ? '待注释键请补描述' : ''}）`);
      } else {
        console.log(buildTreeText(files, loadMapping()));
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
      // apply 前先同步索引，保证树用最新映射（描述缺失处标（待注释））
      if (args.includes('--sync') || forceAll) syncIndex({ write: true });
      const tree = buildTreeText();
      const text = readReadme(readmePath);
      const updated = applyBlock(text, tree);
      writeFileSync(readmePath, updated, 'utf8');
      console.log(`✅ 已覆盖 README 目录结构块: ${readmePath}`);
      break;
    }
    default:
      console.log('用法: node scripts/tree-doc.mjs <sync|gen|check|apply> [--readme <路径>] [--write] [--all] [--dry]');
      process.exit(1);
  }
}