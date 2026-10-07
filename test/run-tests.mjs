/**
 * 测试入口：先清扫陈旧的测试临时目录，再跑 node --test test/test-*.mjs。
 *
 * 【为什么需要】`npm test` 之前直接跑 `node --test`：一旦有测试进程被 timeout/kill 掉，
 *   `process.on('exit')` 钩子也不会执行（SIGKILL 无法拦），一次性目录就留在 /tmp。
 *   这里在整轮开始/结束各扫一次（只清「够旧」的，避免误删并发运行的其它测试进程正在用的目录）。
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sweepStaleTempDirs } from './helpers/tmp-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.startsWith('test-') && f.endsWith('.mjs'))
  .sort()
  .map((f) => join(here, f));

const log = (m) => console.log(`[test] ${m}`);
// 开工先收上一轮残留（>60 分钟）；收工再收本轮可能的残留（>30 分钟）
sweepStaleTempDirs({ maxAgeMs: 60 * 60 * 1000, log });
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
sweepStaleTempDirs({ maxAgeMs: 30 * 60 * 1000, log });
process.exit(typeof r.status === 'number' ? r.status : 1);
