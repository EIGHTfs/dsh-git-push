/**
 * 测试入口：清扫陈旧临时目录 → 按缓存跳过**未变更的纯本地测试** → `node --test` 其余 → 按文件更新缓存。
 *
 * 用法：
 *   node test/run-tests.mjs             默认：用缓存（未变更且上次通过的纯本地测试跳过）
 *   node test/run-tests.mjs --dry-run   只报告「本轮会跑哪些 / 跳过哪些 / 为什么」，不执行测试
 *   node test/run-tests.mjs --all       忽略缓存，全部真跑（发布/交付前门禁）
 *   node test/run-tests.mjs --no-cache  不读也不写缓存
 *   node test/run-tests.mjs --stats     打印每个文件「跑/跳过」的原因
 *
 * 安全模型（详见 test/helpers/test-cache.mjs）：
 *   · 缓存键 = 测试文件 + 其**传递依赖闭包**内容 + node 版本 → 依赖一变必重跑；
 *   · 依赖活宿主/网络的测试（本机端口、/api/ 路由、fetch 等）**一律不缓存**，每次真跑；
 *   · **按文件失效**：只有失败的那些文件被剔除（下次必重跑），其余照旧命中
 *     —— 不让「一个文件的失败」把上百个文件的缓存全废掉；
 *   · 兜底：若整轮失败但**无法从 TAP 归属到具体文件**，则清空整份缓存（宁可全重跑，不可漏跑）。
 */
import { spawn } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sweepStaleTempDirs } from './helpers/tmp-dir.mjs';
import {
  CACHE_DIR, CACHE_FILE, cacheKeyFor, importClosure, loadTestCache, planTestRun, saveTestCache,
} from './helpers/test-cache.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const argv = process.argv.slice(2);
const useCache = !argv.includes('--all') && !argv.includes('--no-cache');
const writeCache = !argv.includes('--no-cache');
const wantStats = argv.includes('--stats');
const log = (m) => console.log(`[test] ${m}`);

const allFiles = readdirSync(here)
  .filter((f) => f.startsWith('test-') && f.endsWith('.mjs'))
  .sort()
  .map((f) => join(here, f));

// 开工先收上一轮残留（>60 分钟）；收工再收本轮可能的残留（>30 分钟）
sweepStaleTempDirs({ maxAgeMs: 60 * 60 * 1000, log });

const cache = useCache ? loadTestCache(root) : { results: {} };
const plan = useCache ? planTestRun(allFiles, cache) : { run: allFiles, skipped: [], reasons: {} };
if (useCache) {
  log(`缓存命中 ${plan.skipped.length}/${allFiles.length} 个测试文件 → 跳过；其余 ${plan.run.length} 个真跑（全量请用 --all）`);
}
if (wantStats) {
  for (const abs of allFiles) log(`  ${plan.reasons[abs] || '—'}  ${abs.slice(root.length + 1)}`);
}
// --dry-run：只报告计划，不跑测试、不动缓存（用于确认「会跳过什么」，避免黑盒）
if (argv.includes('--dry-run')) {
  const byReason = {};
  for (const abs of allFiles) {
    const key = String(plan.reasons[abs] || '—').replace(/（.*/, '');
    byReason[key] = (byReason[key] || 0) + 1;
  }
  log(`[dry-run] 会真跑 ${plan.run.length} 个 / 跳过 ${plan.skipped.length} 个（共 ${allFiles.length}）`);
  log(`[dry-run] 原因分布：${JSON.stringify(byReason)}`);
  log(`[dry-run] 将真跑：${plan.run.map((p) => p.slice(root.length + 1)).join(', ') || '（无）'}`);
  log('[dry-run] 未执行任何测试、未改动缓存');
  process.exit(0);
}

const started = Date.now();
// 流式透传（长跑要能看到进度）
const child = spawn(process.execPath, ['--test', ...plan.run], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => process.stdout.write(String(d)));
child.stderr.on('data', (d) => process.stderr.write(String(d)));
const status = await new Promise((res) => child.on('close', (code) => res(code)));
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

/**
 * 缓存更新规则（**按文件失效**，不搞「一处失败全清」）：
 *   · 通过 → 记录「本轮跑过的文件」的键（下次可跳过）；
 *   · 失败 → 只剔除**本轮真跑过的**那些文件的缓存条目（它们才可能失败），
 *     被跳过的文件保持命中（它们的内容与依赖都没变、上次也通过）。
 *   注：Node 的 TAP 没有文件级块头，无法把失败精确归属到单个文件；但「失败必在跑过的集合里」
 *   这一条足以保证不漏跑 —— 代价只是同一轮跑过的其它文件下次也重跑一遍。
 */
if (writeCache) {
  const results = { ...(useCache ? cache.results : {}) };
  if (status === 0) {
    for (const abs of plan.run) results[abs] = { key: cacheKeyFor(importClosure(abs)), passed: true, at: new Date().toISOString() };
    for (const abs of plan.skipped) if (results[abs]) results[abs].passed = true;
    saveTestCache(root, { results });
    log(`缓存已更新：本轮通过 ${plan.run.length} 个文件（跳过 ${plan.skipped.length} 个保持不变）`);
  } else {
    for (const abs of plan.run) delete results[abs];
    saveTestCache(root, { results });
    log(`本轮有失败 → 已剔除「真跑过的」${plan.run.length} 个文件缓存（被跳过的 ${plan.skipped.length} 个仍命中，下次只重跑这些）`);
  }
}

sweepStaleTempDirs({ maxAgeMs: 30 * 60 * 1000, log });
log(`本轮耗时 ${elapsed}s（真跑 ${plan.run.length} 个文件 / 跳过 ${plan.skipped.length} 个）`);
process.exit(typeof status === 'number' ? status : 1);
