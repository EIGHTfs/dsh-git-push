/**
 * 双副本同步脚本（1.0.0）
 *
 * 源 = 本仓库（工作区/dsh-git-push-v2，即 dsh-git-push 本体）
 * 目标 = DSH 插件目录（.dsh/profiles/<profile>/node_modules/dsh-git-push）
 *
 * 默认 **dryRun**（只打印将要同步的差异，不写入）；`--write` 才真同步。
 * 同步内容：lib/**  skills/**  cli.mjs  package.json  cordis.patch.yml  README.md
 * 排除：.git  node_modules  docs/WORKBOARD*（开发看板不随插件发布）test/**
 *
 * 用法：
 *   node scripts/sync-plugin.mjs                    # dry-run（默认）
 *   node scripts/sync-plugin.mjs --write            # 真同步
 *   node scripts/sync-plugin.mjs --target <目录>    # 指定目标（默认自动探测）
 */
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 随插件发布的顶层条目。 */
export const SYNC_ENTRIES = ['lib', 'skills', 'cli.mjs', 'package.json', 'cordis.patch.yml', 'README.md'];

/** 同步时排除的路径片段。 */
export const SYNC_EXCLUDE = ['.git', 'node_modules', 'WORKBOARD', 'test', '.tmp'];

/**
 * 递归列出源目录下应同步的文件（相对路径）。
 * @param {string} root 源根
 * @returns {string[]} 相对路径列表
 */
export function listSyncFiles(root = SOURCE_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (SYNC_EXCLUDE.some((x) => rel.split('/').includes(x) || rel.includes(x))) continue;
      if (entry.isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  for (const item of SYNC_ENTRIES) {
    const full = join(root, item);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) walk(full);
    else out.push(item);
  }
  return out.sort();
}

/**
 * 探测 DSH 插件目录（DSH_HOME/.dsh/profiles/PROFILE/node_modules/插件名）。
 * @param {string} [home] DSH_HOME（默认从环境变量推断）
 * @param {string} [pluginName]
 * @returns {string[]} 命中的目标目录（可能多个 profile）
 */
export function detectTargets(home = process.env.DSH_HOME || '', pluginName = 'dsh-git-push') {
  const hits = [];
  if (!home) return hits;
  const profiles = join(home, '.dsh', 'profiles');
  if (!existsSync(profiles)) return hits;
  for (const profile of readdirSync(profiles, { withFileTypes: true })) {
    if (!profile.isDirectory()) continue;
    const target = join(profiles, profile.name, 'node_modules', pluginName);
    if (existsSync(target)) hits.push(target);
  }
  return hits;
}

/**
 * 同步（dry-run 或真写入）。
 * @param {object} p { source, target, write }
 * @returns {{ok: boolean, written: number, skipped: number, files: string[], error?: string}}
 */
export function syncPlugin({ source = SOURCE_ROOT, target = '', write = false } = {}) {
  if (!target) return { ok: false, written: 0, skipped: 0, files: [], error: '未指定目标目录（用 --target 或配置 DSH_HOME）' };
  const files = listSyncFiles(source);
  let written = 0;
  let skipped = 0;
  for (const rel of files) {
    const from = join(source, rel);
    const to = join(target, rel);
    // 内容不同才写（幂等）
    const same = existsSync(to) && readFileSync(to, 'utf8') === readFileSync(from, 'utf8');
    if (same) { skipped++; continue; }
    if (write) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
    written++;
  }
  return { ok: true, written, skipped, files };
}

/** CLI 入口。 */
export function main(argv = process.argv.slice(2)) {
  const write = argv.includes('--write');
  const ti = argv.indexOf('--target');
  const target = ti >= 0 ? argv[ti + 1] : (detectTargets()[0] || '');
  const r = syncPlugin({ target, write });
  if (!r.ok) {
    console.log(`同步未执行：${r.error}`);
    console.log(`可用目标（自动探测）：${detectTargets().join(' | ') || '(无)'}`);
    return 1;
  }
  console.log(`双副本同步${write ? '' : '（dry-run，加 --write 才写）'}`);
  console.log(`  源：${SOURCE_ROOT}`);
  console.log(`  目标：${target}`);
  console.log(`  待写 ${r.written} 个文件，已一致 ${r.skipped} 个`);
  for (const f of r.files.slice(0, 10)) console.log(`    - ${f}`);
  if (r.files.length > 10) console.log(`    … 共 ${r.files.length} 个`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
