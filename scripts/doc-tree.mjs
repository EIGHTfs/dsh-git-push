/**
 * dsh-git-push — README 目录结构维护脚本(索引自动同步化)
 *
 * 功能（四个子命令）：
 *   gen   —— 用 `git ls-files` 读「所有 git 未忽略文件」，生成目录结构文本
 *             （两层折叠：顶层目录全列、子目录只到一层、嵌套用 … 折叠），
 *             每项从 tree-doc.json 取一句话介绍；映射缺失的路径标（待注释）。
 *   check —— 解析 README 标记块（<!-- dshgp-tree:start/end -->）内现有树，
 *             与真实文件树对比，报告漂移（新增/删除/改注释），**不改文件**。
 *   apply —— 用新生成的树覆盖 README 标记块内容（显式执行才写盘）。
 * sync —— **索引自动同步**：对齐 tree-doc.json 的键集合与真实
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
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAPPING_FILE = join(ROOT, 'tree-doc.json');
const MARK_START = '<!-- dshgp-tree:start -->';
const MARK_END = '<!-- dshgp-tree:end -->';
const DEFAULT_README = join(ROOT, 'README.md');
/** 树标记块（宿主 md 识别用）。 */

/**
 * 自动探测「目录树宿主 md」（分体式文档支持）：
 *   · `--readme` 显式指定 → 直接用（向后兼容）。
 *   · 缺省：优先 README.md；README 无标记块时，扫描根下全部 .md
 *     （docs/ 优先），找第一个含 dshgp-tree 标记块的文件作为宿主——
 *     即「版本/文件树/函数列表等文档放 docs/、README 只引用」格局下，
 *     tree-doc 自动写到 docs/ 里真正承载树的那个 md，不再死认 README.md。
 *   · 都无标记块 → 回退 README.md（apply 仍会报「无标记块」提示先插标记）。
 * @param {string} root 项目根
 * @param {string} [explicit] --readme 显式路径（空=自动探测）
 * @returns {string} 宿主 md 绝对路径
 */
/** 收集根下全部 .md（排除 .git/node_modules/.dsh 等），含 docs/ 子目录，深度 ≤4。 */
function collectMdFiles(root) {
  const SKIP_DIRS = new Set(['.git', '.dsh', 'node_modules', 'dist', 'build', '.trash']);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name.endsWith('.md')) out.push(full);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * 探测含指定标记块的「文档宿主 md」（公共函数，tree-doc/版本表/函数列表三类文档复用）。
 * 优先 README.md；README 无该标记块时，扫描根下全部 .md 找第一个含该标记块的文件。
 * 标记块形如 `<!-- <marker>:start --> … <!-- <marker>:end -->`（marker 如 'dshgp-tree'）。
 * @param {string} root 项目根
 * @param {string} marker 标记块名（缺省 dshgp-tree）
 * @returns {string} 宿主 md 绝对路径（找不到含块 md 时回退 README.md）
 */
export function findMarkedHostMd(root, marker = 'dshgp-tree') {
  const readme = join(root, 'README.md');
  try {
    if (existsSync(readme) && findBlock(readFileSync(readme, 'utf8'), marker)) return readme;
  } catch { /* 不可读则继续探测 */ }
  for (const f of collectMdFiles(root)) {
    try { if (findBlock(readFileSync(f, 'utf8'), marker)) return f; } catch { /* 忽略坏文件 */ }
  }
  return readme;
}

/** 解析「树宿主 md」——README 不再写死为唯一宿主：自动探测含 dshgp-tree 标记块的 md（分体式文档下宿主可随文档拆分迁移，脚本零改动）。 */
export function resolveTargetMd(root, explicit = '', marker = 'dshgp-tree') {
  if (explicit) return explicit;
  return findMarkedHostMd(root, marker);
}
const TOP_DIRS = [
  'lib', 'scripts', 'assets', 'test', 'docs', 'skills',
  'cli.mjs', 'package.json', 'README.md', 'cordis.patch.yml',
];

/* ───────────────────────── git 未忽略文件清单 ───────────────────────── */

function gitLsFiles(root = ROOT) {
  try {
    // 已跟踪 + 未跟踪但未忽略（新文件/待提交都算「未忽略文件」，README 目录树应含它们）
    const out = execFileSync('git', ['-c', 'core.quotepath=false', '-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return out.split('\n').map((l) => l.trim()).filter(Boolean).filter((p) => {
      // 缺陷修复：--cached 会把「已跟踪但工作区已删」的文件也列出（应只取真实存在的文件）
      //   （如 mv 进 .trash 的旧文件仍留在索引），导致 check 误报「真实存在但未列」。
      //   目录树描述的是工作区现状，只保留工作区实际存在的文件。
      try { return statSync(join(root, p)).isFile(); } catch { return false; }
    });
  } catch {
    return [];
  }
}

/* ───────────────────────── 注释映射读写 ───────────────────────── */

function loadMapping(root = ROOT) {
  const mappingFile = join(root, 'tree-doc.json');
  if (!existsSync(mappingFile)) return {};
  try { return JSON.parse(readFileSync(mappingFile, 'utf8')); } catch { return {}; }
}

function writeMapping(map, root = ROOT) {
  writeFileSync(join(root, 'tree-doc.json'), JSON.stringify(map, null, 2) + '\n', 'utf8');
}

/**
 * 工作区未提交变动文件：git status --porcelain → {path: {status, mtime, note}}。
 * M/A/D + 文件 mtime——**面向开发者/AI 的元数据**：提示「该文件变动了，tree-doc 注释可能需更新」。
 * 与 tree-doc.json 的 `_meta.worktree` 配合；apply 到 README 只同步原描述，不含本信息。
 * @returns {Object<string, {status: string, mtime: string, note: string}>}
 */
function gitWorktreeChanges(root = ROOT) {
  try {
    const out = execFileSync(
      'git', ['-c', 'core.quotepath=false', '-C', root, 'status', '--porcelain'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );
    const res = {};
    for (const raw of out.split('\n')) {
      if (!raw.trim()) continue;
      // status --porcelain：前 2 字符 = 状态两列（index/worktree），第 3 字符 = 空格。
      //   不能 trim 整行再 slice（trim 掉前导空格会错位，实测路径首字符被吃）。
      const cell = raw.slice(0, 2);
      const code = cell === '??' ? 'A' : (cell[0] !== ' ' ? cell[0] : (cell[1] !== ' ' ? cell[1] : '')); // ?? 未跟踪=新增
      const path = raw.slice(3).replace(/^"|"$/g, '').trim();
      if (!path || path === 'tree-doc.json') continue; // 排除映射文件自身
      if (!/^[MAD]$/.test(code)) continue; // 只记 M/A/D（R/C/忽略项不算「需更新注释」的变动）
      let mtime = '';
      try { mtime = statSync(join(root, path)).mtime.toISOString(); } catch { /* 已删文件拿不到 mtime */ }
      res[path] = { status: code, mtime, note: '注释可能需更新' };
    }
    return res;
  } catch { return {}; }
}

/**
 * 索引自动同步：对齐 tree-doc.json 键集合与真实文件集。
 *   - 新增文件（git 未忽略、工作区存在）不在索引 → 自动补键，值=（待注释），等人补描述
 *   - 索引里有但文件已删 → 自动删键（描述连带删除），不再产生孤儿
 *   - 目录键（目录级注释合法）自动补齐：真实文件的所有父目录（无尾斜杠，与现有键一致）
 * @param {{write?: boolean, files?: string[], map?: object}} [opts] 测试可注入
 * @returns {{added: string[], removed: string[], map: object}}
 */
export function syncIndex({ write = true, files = gitLsFiles(), map = loadMapping(), root = ROOT } = {}) {
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
  // 删除孤儿键（文件或目录已不存在；`_meta` 元数据键保留）
  for (const k of Object.keys(next)) {
    if (k === '_meta') continue;
    if (realFiles.has(k) || realDirs.has(k)) continue;
    removed.push(k);
    delete next[k];
  }
  // 补新增键（文件 + 目录），保持插入顺序稳定（先目录后文件：树父在前）
  // 逐个 add 而不是 new Set([...realDirs, ...realFiles])：避免为去重多复制两个数组一遍
  //   （性能规则 performance/memory-bomb「展开多个大数组会一次性创建新数组」；插入顺序不变）
  const want = new Set(realDirs);
  for (const f of realFiles) want.add(f);
  for (const p of want) {
    if (p in next) continue;
    next[p] = '（待注释）';
    added.push(p);
  }
  // 工作区变动文件记录进 `_meta.worktree`（mtime + 状态）——面向开发者/AI 的
  //   提示「注释可能需更新」；apply 到 README 只同步原描述（buildTreeText 只查 map[path]），
  //   `_meta` 不进 README。工作区干净时清空该段（避免陈旧提示）。
  const wt = gitWorktreeChanges(root);
  const wtKeys = Object.keys(wt);
  const metaChanged = wtKeys.length
    ? JSON.stringify(next._meta?.worktree || null) !== JSON.stringify(wt)
    : Boolean(next._meta?.worktree);
  if (wtKeys.length) next._meta = { ...(next._meta || {}), worktree: wt };
  else if (next._meta?.worktree) delete next._meta.worktree;
  if (next._meta && Object.keys(next._meta).length === 0) delete next._meta;
  if (write && (added.length || removed.length || metaChanged)) writeMapping(next, root);
  return { added, removed, map: next, worktreeChanges: wt };
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
export function buildTreeText(files = gitLsFiles(), map = loadMapping(), rootLabel = basename(ROOT)) {
  const { groups, groupNames, rootFiles } = buildGroups(files);
  const out = ['```text', rootLabel + '/'];
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

/** 找文本内的标记块（marker 如 'dshgp-tree'；块 = <!-- <marker>:start --> … <!-- <marker>:end -->）。 */
function findBlock(text, marker = 'dshgp-tree') {
  const sMark = `<!-- ${marker}:start -->`;
  const eMark = `<!-- ${marker}:end -->`;
  const s = text.indexOf(sMark);
  const e = text.indexOf(eMark);
  if (s === -1 || e === -1 || e <= s) return null;
  return { start: s, end: e, content: text.slice(s + sMark.length, e) };
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

export function checkDrift({ readmePath = DEFAULT_README, root = ROOT } = {}) {
  const text = readReadme(readmePath);
  const block = findBlock(text);
  const real = buildTreeText(gitLsFiles(root), loadMapping(root), basename(root));
  const map = loadMapping(root);
  // 真实树内已解析条目（路径集合）
  const realPaths = new Set(gitLsFiles(root));
  const issues = [];
  if (!block) {
    issues.push({ type: 'no-block', msg: `${basename(readmePath)} 没有目录结构标记块（${MARK_START} … ${MARK_END}）；可 apply 前先插入标记，或把树写到带标记的 docs/ md（自动探测）` });
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
    // 修：树根节点豁免原硬编码本插件名（dsh-git-push）——扫描其它仓库（如
    // dsh-theme-mediascape）时根节点 <repoName>/ 被误判 stale。改为动态豁免当前 git 根目录名。
    const repoRoot = basename(root);
    if (!name || name === repoRoot || name === repoRoot + '/') continue;
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
  const isRealDir = (p) => { try { return statSync(join(root, p.replace(/\/$/, ''))).isDirectory(); } catch { return false; } };
  // 工具自产生成物不追漂移——tree-doc/functions 自产（README 树与索引的
  //   增删由工具维护，不属手写树内容）：docs/函数/*（apply 生成/删除常态）、
  //   functions-index.json（analyze 产物）。_meta 见 orphan 判定。
  const isToolGenerated = (p) => p === 'functions-index.json' || p === '_meta'
    || p.startsWith('docs/函数/') || p.includes('_archived/');
  // missing：真实文件不在树上（被折叠的设计除外；工具生成物豁免）
  const missing = [];
  for (const p of realPaths) {
    const folded = foldedDirs.some((d) => p.startsWith(d));
    if (!folded && !seen.has(p) && !isRealDir(p) && !isToolGenerated(p)) missing.push(p);
  }
  // stale：树上列出但真实不存在（文件或目录；工具生成物豁免）
  const stale = [];
  for (const s of seen) {
    if (isToolGenerated(s)) continue;
    if (s.endsWith('/')) { if (!isRealDir(s)) stale.push(s); }
    else if (!realSet.has(s)) stale.push(s);
  }
  // 注释映射孤儿：路径既不是 git 文件，也不是真实目录（目录级注释合法）；`_meta`/生成物键跳过
  const orphans = [];
  for (const p of Object.keys(map)) {
    if (isToolGenerated(p)) continue; // _meta 元数据 + docs/函数/ 等工具产物不算孤儿
    const full = join(root, p);
    let realDir = false;
    try { realDir = statSync(full).isDirectory(); } catch { /* 路径不存在：不算真实目录 */ }
    if (!realSet.has(p) && !realDir) orphans.push(p);
  }
  const drift = missing.length > 0 || stale.length > 0 || orphans.length > 0;
  if (missing.length) issues.push({ type: 'missing', msg: `真实存在但 README 未列（新增未更新）: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? `…(+${missing.length - 12})` : ''}` });
  if (stale.length) issues.push({ type: 'stale', msg: `README 列出但真实不存在（已删除）: ${stale.join(', ')}` });
  if (orphans.length) issues.push({ type: 'orphan', msg: `tree-doc.json 映射了不存在的路径（运行 tree-doc.mjs sync 自动清理）: ${orphans.slice(0, 8).join(', ')}${orphans.length > 8 ? `…(+${orphans.length - 8})` : ''}` });
  return { ok: !drift, drift, issues, realTree: real, worktreeChanges: gitWorktreeChanges(root) };
}

/* ───────────────────────── CLI ───────────────────────── */
// 仅直接运行时执行（测试 import 本文件不应触发 CLI）
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  // `--root <路径>` 支持外调其他项目——其他仓库可直接用本脚本维护自己的
  //   README 目录树（`node <dsh-git-push>/scripts/tree-doc.mjs check --root <其他项目根>`）。
  //   缺省 = 自身项目（向后兼容）；显式 `--readme` 优先于 root 推导的 README 路径。
  const rootIdx = args.indexOf('--root');
  const rootArg = rootIdx !== -1 && args[rootIdx + 1] ? resolve(args[rootIdx + 1]) : ROOT;
  // README 不再写死——自动探测宿主 md（README 无标记块时找 docs/ 里带标记块的）
  const readmeIdx = args.indexOf('--readme');
  const readmeExplicit = readmeIdx !== -1 && args[readmeIdx + 1] ? resolve(args[readmeIdx + 1]) : '';
  const readmePath = readmeExplicit || resolveTargetMd(rootArg);
  const forceAll = args.includes('--all');
  const filesOf = (r) => gitLsFiles(r);
  const mapOf = (r) => loadMapping(r);

  switch (cmd) {
    case 'sync': {
      // 索引自动同步：新增补（待注释）、删除自动删键（描述连带删）
      const files = filesOf(rootArg);
      const { added, removed, map } = syncIndex({ write: !args.includes('--dry'), files, map: mapOf(rootArg), root: rootArg });
      const dirs = new Set();
      for (const f of files) {
        let dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : null;
        while (dir) { dirs.add(dir + '/'); const i = dir.lastIndexOf('/'); dir = i === -1 ? null : dir.slice(0, i); }
      }
      const tree = buildTreeText(files, map, basename(rootArg));
      if (added.length) console.log(`✅ 新增索引键 ${added.length} 个（值=（待注释），请补描述）:\n  ${added.join('\n  ')}`);
      if (removed.length) console.log(`🗑  删除索引键 ${removed.length} 个（文件已删，描述连带删除）:\n  ${removed.join('\n  ')}`);
      if (!added.length && !removed.length) console.log('✅ 索引已同步（无新增/删除）');
      if (args.includes('--write-tree')) writeFileSync(readmePath, applyBlock(readReadme(readmePath), tree), 'utf8');
      console.log(`（tree-doc.json 现有 ${Object.keys(map).length} 键；gen 输出见 tree-doc.mjs gen）`);
      break;
    }
    case 'gen': {
      const files = filesOf(rootArg);
      if (args.includes('--write')) {
        // 索引同步 + 补（待注释）（与 sync 同一逻辑——--all 为显式全量语义：显式声明时连已同步键也重写，默认只补缺）
        const { added, removed } = syncIndex({ write: true, files, map: mapOf(rootArg), root: rootArg });
        if (forceAll) console.log('--all：已强制全量追加索引');
        console.log(`tree-doc.json 已同步（新增 ${added.length} / 删除 ${removed.length}；${added.length ? '待注释键请补描述' : ''}）`);
      } else {
        console.log(buildTreeText(files, mapOf(rootArg), basename(rootArg)));
      }
      break;
    }
    case 'check': {
      const r = checkDrift({ readmePath, root: rootArg });
      if (r.ok) { console.log(`✅ 目录结构与 README 一致（无漂移）${rootArg !== ROOT ? ` @ ${rootArg}` : ''}`); process.exit(0); }
      console.log('❌ 存在漂移：');
      for (const i of r.issues) console.log('  -', i.msg);
      if (r.realTree) console.log('\n═══ 最新树（可用 apply 覆盖）═══\n' + r.realTree);
      process.exit(1);
    }
    case 'apply': {
      // apply 前先同步索引，保证树用最新映射（描述缺失处标（待注释））
      if (args.includes('--sync') || forceAll) syncIndex({ write: true, files: filesOf(rootArg), map: mapOf(rootArg), root: rootArg });
      const tree = buildTreeText(filesOf(rootArg), mapOf(rootArg), basename(rootArg));
      const text = readReadme(readmePath);
      const updated = applyBlock(text, tree);
      writeFileSync(readmePath, updated, 'utf8');
      console.log(`✅ 已覆盖目录结构块: ${readmePath}`);
      if (!readmePath.endsWith('README.md')) console.log('  ℹ️ 宿主为非 README md——确保 README 以链接引用它（分体式文档，见插件 skill「文档组织」节）');
      break;
    }
    default:
      console.log('用法: node scripts/tree-doc.mjs <sync|gen|check|apply> [--root <项目根>] [--readme <路径>] [--write] [--all] [--dry]');
      process.exit(1);
  }
}