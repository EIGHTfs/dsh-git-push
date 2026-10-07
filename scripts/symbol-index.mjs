/**
 * 跨文件符号索引 CLI —— 把 lib/ast/symbol-index.js 的能力做成可直接跑的命令。
 *
 * 用途：不用起插件/服务，直接对一个仓库出「符号索引 + 跨文件调用边 + 未使用导出候选 + 覆盖率」。
 *   覆盖率 = 连边数 / 可解析调用数（成员调用 `x.y()` 已排除并单独计数），是判断静态分析
 *   「到底解析到了多少」的置信度指标——只看命中数会被「其实没解析到」误导。
 *
 * 用法（在插件仓库根目录执行）：
 *   node scripts/symbol-index.mjs <仓库目录> [--json] [--unused] [--top N] [--ext .js,.mjs]
 * 例：
 *   node scripts/symbol-index.mjs ../dsh-git-push --unused
 *   node scripts/symbol-index.mjs ../dsh-codegraph --ext .ts --json > /tmp/idx.json
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { buildSymbolIndex, indexSummary, unusedExportCandidates } from '../lib/ast/symbol-index.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.codegraph', 'dist', 'build', '__pycache__', '.archify']);
const DEFAULT_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];

/** 递归收集源码文件（相对路径，正斜杠）。 */
function collectFiles(root, exts, dir = root, out = []) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st = null;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) collectFiles(root, exts, full, out);
    else if (exts.some((x) => name.endsWith(x))) out.push(relative(root, full).replace(/\\/g, '/'));
  }
  return out;
}

/** 解析命令行参数。 */
function parseArgs(argv) {
  const args = { exts: DEFAULT_EXTS, json: false, unused: false, top: 8 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--unused') args.unused = true;
    else if (a === '--top') args.top = Number(argv[++i] || 8);
    else if (a === '--ext') args.exts = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--')) throw new Error(`未知参数: ${a}`);
    else positional.push(a);
  }
  args.root = positional[0];
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.root) {
  console.error('用法: node scripts/symbol-index.mjs <仓库目录> [--json] [--unused] [--top N] [--ext .js,.mjs]');
  process.exit(2);
}
const root = resolve(args.root);
const files = collectFiles(root, args.exts);
const index = buildSymbolIndex(files, { readFile: (rel) => readFileSync(join(root, rel), 'utf8') });
const unused = unusedExportCandidates(index);

if (args.json) {
  console.log(JSON.stringify({
    root, stats: index.stats, summary: indexSummary(index),
    edges: index.edges, unresolved: index.unresolved, unusedExports: unused,
  }, null, 2));
} else {
  console.log(`仓库: ${root}`);
  console.log(indexSummary(index));
  console.log(`排除的成员调用: ${index.stats.skippedMemberCalls}（x.y() 这类不经符号索引解析）`);
  const byReason = {};
  for (const u of index.unresolved) byReason[u.reason] = (byReason[u.reason] || 0) + 1;
  console.log(`未解析构成: ${JSON.stringify(byReason)}`);
  const top = index.edges.filter((e) => e.via === 'import').slice(0, args.top);
  if (top.length) {
    console.log(`跨文件调用边（前 ${top.length} 条）:`);
    for (const e of top) console.log(`  ${e.from}:${e.line}  →  ${e.to}`);
  }
  if (args.unused) {
    console.log(`未使用导出候选（${unused.length} 个，动态访问/外部引用无法静态判定，仅作线索）:`);
    for (const u of unused.slice(0, args.top * 3)) console.log(`  ${u.file}:${u.line}  ${u.name}`);
  }
}
