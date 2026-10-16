#!/usr/bin/env node
/**
 * dsh-git-push — FS 热点静态扫描（独立 CLI，咨询性，恒退出码 0）
 *
 * 用法：
 *   node scripts/scan-fs-hotspots.mjs [root] [--json] [--top N] [--include 子串] [--exclude 子串] [--include-tests]
 *
 * 判据（六类，与审计规则 performance/multi-file-scanners 同源 ✓）：
 *   ① stat 热点        按 stat 调用点数排序的文件
 *   ② 重复 stat        同一函数内同一表达式 stat ≥2 次
 *   ③ 重复 readdir     同一函数内同一表达式 readdir ≥2 次
 *   ④ 遍历入口         readdir + （自递归 或 已知 walker 名）
 *   ⑤ 逐文件扫描实现    同一函数内既有 readdir 又有 stat
 *   ⑥ 汇总             totals
 *
 * 【为什么不自己再写一遍判据】判据实现只在 lib/ast/fs-hotspots.js 一份 —— 审计规则
 *   （lib/checks/fs-scanner.js）与 CLI 都用它 ⇒ 不会出现「脚本说 9 个、规则说 7 个」的漂移 ✗
 *   （2026-10-16 由 bench-template 的 scan-fs-hotspots.mjs 交接而来：规则化 + 复用插件 tokenizer）
 * 【退出码恒 0】这是**咨询性报告**，不拦提交（要拦走审计规则 ✓）
 * dsh-skip-i18n: 用户可见文案硬编码为产品设计
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { scanFsHotspots, FS_WALKERS } from '../lib/ast/fs-hotspots.js';

/** 默认豁免目录（与审计规则口径一致：审计侧由 collector 跳过，这里显式列同一份）。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'release', '.trash', '.auto-update-tmp', 'cache-index', 'cache-gifs', '__pycache__']);
const TEST_DIRS = new Set(['test', 'tests']);
const EXTS = new Set(['.js', '.mjs', '.cjs']);

function parseArgs(argv) {
  const o = { root: process.cwd(), json: false, top: 10, include: '', exclude: '', includeTests: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--top') o.top = Number(argv[++i]) || 10;
    else if (a === '--include') o.include = String(argv[++i] || '');
    else if (a === '--exclude') o.exclude = String(argv[++i] || '');
    else if (a === '--include-tests') o.includeTests = true;
    else if (!a.startsWith('--')) o.root = a;
  }
  return o;
}

/** 递归收集待扫文件（跳过 SKIP_DIRS；test/tests 默认跳过，--include-tests 纳入 ✓）。 */
function collectFiles(dir, o, out = []) {
  let ents = [];
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // 权限/竞态：跳过该目录，不让整轮失败
  }
  for (const e of ents) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (!o.includeTests && TEST_DIRS.has(e.name)) continue;
      collectFiles(full, o, out);
    } else if (EXTS.has(extname(e.name))) {
      const rel = relative(o.root, full);
      if (o.include && !rel.includes(o.include)) continue;
      if (o.exclude && rel.includes(o.exclude)) continue;
      out.push(full);
    }
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const files = collectFiles(opts.root, opts);
const fileTexts = files.map((full) => {
  try {
    return { path: relative(opts.root, full), text: readFileSync(full, 'utf8') };
  } catch {
    return { path: relative(opts.root, full), text: '' };
  }
});
const agg = scanFsHotspots(fileTexts);

if (opts.json) {
  console.log(JSON.stringify({
    root: opts.root,
    includeTests: opts.includeTests,
    walkerNames: FS_WALKERS,
    totals: agg.totals,
    hot: agg.hot.slice(0, opts.top),
    scanners: agg.scanners,
    dupStats: agg.dupStats,
    dupReaddirs: agg.dupReaddirs,
    walkers: agg.walkers,
  }, null, 2));
} else {
  const t = agg.totals;
  console.log(`FS 热点扫描（${t.files} 文件 · stat ${t.stats} · readdir ${t.readdirs} · 重复 stat ${t.dupStats} · 重复 readdir ${t.dupReaddirs} · 遍历入口 ${t.walkerCalls} · 逐文件扫描实现 ${t.scanners}）`);
  console.log('\n① stat 热点（按 stat 调用点数）：');
  for (const h of agg.hot.slice(0, opts.top)) console.log(`  ${String(h.stats).padStart(3)} stat / ${String(h.readdirs).padStart(3)} readdir  ${h.file}`);
  console.log('\n④ 遍历入口（readdir + 自递归/已知 walker）：');
  if (!agg.walkers.length) console.log('  （无）');
  for (const w of agg.walkers) console.log(`  ${w.file}:${w.line}  ${w.fn}()  → ${w.calls}`);
  if (agg.dupStats.length || agg.dupReaddirs.length) {
    console.log('\n②③ 同函数内重复的 stat/readdir（可合并成一次）：');
    for (const d of [...agg.dupStats, ...agg.dupReaddirs]) console.log(`  ${d.file}:${d.line}  ${d.fn}()  ${d.expr}`);
  }
  console.log(`\n⑤ 逐文件扫描实现（readdir+stat 同函数，共 ${agg.scanners.length} 个；> 3 时审计规则 performance/multi-file-scanners 会报 notice）：`);
  for (const s of agg.scanners) console.log(`  ${s.file}:${s.line}  ${s.fn}()`);
}
process.exit(0); // 咨询性：恒 0（要拦提交走审计规则 ✓）
