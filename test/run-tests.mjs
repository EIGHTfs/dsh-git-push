/**
 * 测试入口：清扫陈旧临时目录 → 按缓存跳过**未变更的纯本地测试** → `node --test` 其余 → 按文件更新缓存。
 *
 * 用法：
 *   node test/run-tests.mjs             默认：用缓存（未变更且上次通过的纯本地测试跳过）
 *   node test/run-tests.mjs --dry-run   只报告「本轮会跑哪些 / 跳过哪些 / 为什么」，不执行测试
 *   node test/run-tests.mjs --all       忽略缓存，全部真跑（发布/交付前门禁）
 *   node test/run-tests.mjs --no-cache  不读也不写缓存
 *   node test/run-tests.mjs --stats     打印每个文件「跑/跳过」的原因
 *   node test/run-tests.mjs --batch-size=40  分批执行（默认 40 文件/批；每批独立进程，堆内存批间释放）
 *   node test/run-tests.mjs --only=clone    只跑文件名含 clone 的测试
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
import { tmpdir } from 'node:os';
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

let allFiles = readdirSync(here)
  .filter((f) => f.startsWith('test-') && f.endsWith('.mjs'))
  .sort()
  .map((f) => join(here, f));
// --only=<子串>：只跑文件名含该子串的测试（调试单组用例不必全跑；仍走同一分批/缓存逻辑）
const onlyArg = argv.find((a) => a.startsWith('--only='));
if (onlyArg) {
  const needle = onlyArg.slice('--only='.length);
  allFiles = allFiles.filter((f) => f.includes(needle));
  log(`--only=${needle} → 命中 ${allFiles.length} 个文件`);
}

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
// 并发度：默认交给 node 决定；CI 建议 --concurrency=1 —— 多个测试会写同一仓库的
//   index/工作区（如 test-audit-bad-file 在 ROOT 里 git add 临时文件），全量并发时偶发互相干扰。
const concArg = argv.find((a) => a.startsWith('--concurrency='));
// ── 分批执行（2026-10-31）──
//   旧实现把全部文件交给**一个** `node --test` 子进程跑完：单进程堆跨 379 个文件只涨不还
//   （wasm 解析产物、临时缓冲、各测试闭包），在 8GB 机器上（DSH 宿主常驻 5GB+）把整机
//   推到 swap 抖动，其他会话实测被挤。分批 spawn 后**每批进程退出即归还堆**，峰值有界。
//   批与批**顺序**执行（不并行），保持 --concurrency 的互斥语义不变。
//   汇总：子进程的 `# tests/# pass/…` 行被拦截并在末尾按全量聚合重发，
//   输出格式与单进程一致（CI 与 grep 习惯不受影响）。
const batchSizeArg = argv.find((a) => a.startsWith('--batch-size='));
const BATCH_SIZE = Math.max(1, Number(batchSizeArg?.split('=')[1]) || 40);
const baseArgs = ['--test', ...(concArg ? [`--test-concurrency=${concArg.split('=')[1]}`] : [])];
const TAP_SUMMARY = /^# (tests|suites|pass|fail|cancelled|skipped|todo|comments|duration_ms|duplicates|failures)\b/;

function runBatch(files) {
  return new Promise((resolve) => {
    const agg = { status: 0, lines: '' };
    // 每批子进程加堆上限（默认 1GB，可用 DSH_TEST_HEAP_MB 覆盖）：批内单文件失控
    //   （如大 wasm 解析）时抛 OOM 中断的是该批而非整机——宿主 8GB 上常驻 5GB+，
    //   这是与其他并行会话共存的底线。
    const heapMb = Number(process.env.DSH_TEST_HEAP_MB) > 0 ? Number(process.env.DSH_TEST_HEAP_MB) : 1024;
    // 隔离运行期状态：clone 相关用例会走真实的下载器路径，镜像健康度（mirror-state.json）
    //   若指向真实配置目录，一次回归就会给生产镜像记上几十次「成功/失败」——测试污染真实状态。
    //   统一指到临时文件；用例自己需要控制时再用 DSH_GIT_MIRROR_STATE 覆盖。
    const stateFile = join(tmpdir(), `dshgp-test-mirror-state-${process.pid}.json`);
    const child = spawn(process.execPath, [`--max-old-space-size=${heapMb}`, ...baseArgs, ...files], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_GIT_MIRROR_STATE: process.env.DSH_GIT_MIRROR_STATE || stateFile },
    });
    let pending = '';
    const emit = (chunk) => {
      pending += String(chunk);
      const keep = [];
      for (const line of pending.split('\n')) {
        const nl = line.indexOf('\r');
        const full = nl === -1 ? line : line.slice(0, nl);
        if (TAP_SUMMARY.test(full)) agg.lines += full + '\n';
        else keep.push(line);
      }
      pending = keep.pop() ?? '';
      if (keep.length) process.stdout.write(keep.join('\n') + '\n');
    };
    child.stdout.on('data', emit);
    child.stderr.on('data', (d) => process.stderr.write(String(d)));
    child.on('close', (code) => { if (pending) process.stdout.write(pending); agg.status = typeof code === 'number' ? code : 1; resolve(agg); });
  });
}

let status = 0;
const failedBatchFiles = [];
const allNumbers = {};
const chunks = [];
for (let i = 0; i < plan.run.length; i += BATCH_SIZE) chunks.push(plan.run.slice(i, i + BATCH_SIZE));
for (let bi = 0; bi < chunks.length; bi++) {
  if (chunks.length > 1) log(`── 批次 ${bi + 1}/${chunks.length}（${chunks[bi].length} 个文件）──`);
  const { status: st, lines } = await runBatch(chunks[bi]);
  for (const m of lines.matchAll(/^# (\w+) (\d+)/gm)) allNumbers[m[1]] = (allNumbers[m[1]] || 0) + Number(m[2]);
  if (st !== 0) { status = st; failedBatchFiles.push(...chunks[bi]); }
}
// 聚合汇总用**裸行**输出（不带 [test] 前缀）——与单进程时代子进程透传的 TAP 行完全一致，
//   CI 与人工 `grep '^# tests'` 的习惯不受影响
for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
  if (allNumbers[key] !== undefined) console.log(`# ${key} ${allNumbers[key]}`);
}
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
    // 精确到**失败批次**的文件（分批后不再需要「本轮全剔」这种粗粒度）；
    //   其余跑过且通过的批次照常记录通过。无批次信息（单批全挂）时退化为全剔，保守不漏跑。
    const drop = failedBatchFiles.length ? new Set(failedBatchFiles) : new Set(plan.run);
    for (const abs of plan.run) {
      if (drop.has(abs)) delete results[abs];
      else results[abs] = { key: cacheKeyFor(importClosure(abs)), passed: true, at: new Date().toISOString() };
    }
    saveTestCache(root, { results });
    log(`本轮有失败 → 剔除失败批次 ${drop.size} 个文件缓存，其余 ${plan.run.length - drop.size} 个照常记通过`);
  }
}

sweepStaleTempDirs({ maxAgeMs: 30 * 60 * 1000, log });
log(`本轮耗时 ${elapsed}s（真跑 ${plan.run.length} 个文件 / 跳过 ${plan.skipped.length} 个）`);
process.exit(typeof status === 'number' ? status : 1);
