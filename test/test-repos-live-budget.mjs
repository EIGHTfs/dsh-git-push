/**
 * 本地仓库列表的远端探测预算回归。
 *
 * 现象：打开设置页 → Git 提交推送 → 本地仓库列表经常报
 *   「❌ 读取失败: signal timed out」（前端 fetch 30s 超时）。
 *
 * 根因：`applyLiveRemote` 的预算判据写错了单位——
 *   调用方传入的 `deadline` 是**绝对时间戳**（`Date.now() + LIST_LIVE_BUDGET_MS`），
 *   而判据写成 `Date.now() > probeStart + deadline`，等于把上限推到
 *   「现在 + 现在 + 15s」≈ 几十天后，判据**恒为 false**，15s 预算从未生效。
 *   于是所有仓库都要串完 SSH 探测（每个最多 8s×2 把密钥，并发只有 4），
 *   26 个仓库叠加后轻易突破前端 30s 超时。
 *
 * 本测试直接断言判据函数的行为（不是比对源码文本），并额外守住
 * 「预算 < 前端超时」这个不变量——否则即使判据正确，两者顺序反了照样超时。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isProbeOverBudget } from '../lib/app/handlers/repos.js';
import { LIST_LIVE_BUDGET_MS, SCAN_WAIT_TIMEOUT_MS } from '../lib/app/handlers/http-constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 分片目录以 build-client.mjs 的 PARTS_DIR 为唯一来源（按侧分目录后不再硬编码路径）
import { PARTS_DIR } from '../scripts/build-client.mjs';

test('isProbeOverBudget：绝对时间戳语义（未到点为 false，过了为 true）', () => {
  const now = 1_000_000;
  assert.equal(isProbeOverBudget(now + 15_000, now), false, '还剩 15s 时不应判定超预算');
  assert.equal(isProbeOverBudget(now - 1, now), true, '已过期 1ms 应判定超预算');
  assert.equal(isProbeOverBudget(now, now), false, '恰好等于上限不算超（用 > 而非 >=）');
});

test('isProbeOverBudget：非法 deadline 一律不超预算（不能把参数缺失当成超时）', () => {
  assert.equal(isProbeOverBudget(undefined, 1), false);
  assert.equal(isProbeOverBudget(null, 1), false);
  assert.equal(isProbeOverBudget(NaN, 1), false);
  assert.equal(isProbeOverBudget(Infinity, 1), false, 'Infinity 非有限数 ⇒ 视为无预算上限');
});

test('回归：代码里不得再出现「起点 + 绝对 deadline」的错误组合', () => {
  // 这类单位混用不会报错、也不改变任何返回值类型，只能靠静态判据守住。
  // 注意先剥掉注释：函数文档里会引用旧写法作反面说明，那是文字不是代码。
  const raw = readFileSync(join(ROOT, 'lib/app/handlers/repos.js'), 'utf8');
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')  // 块注释
    .replace(/^\s*\/\/.*$/gm, '');        // 行注释
  assert.ok(!/probeStart\s*\+\s*deadline/.test(code), '不得把绝对 deadline 再加一次起点（判据会恒为 false）');
  assert.ok(code.includes('isProbeOverBudget(deadline)'), '循环里应使用 isProbeOverBudget(deadline) 判预算');
});

test('长轮询三层超时关系：服务端挂起 < 单请求超时 ≤ 默认 fetch 超时', () => {
  // 现象（2026-11-13 实测）：DSH 启动后第一次打开「本地」页报 `读取失败: signal timed out`。
  // 根因：服务端扫描长轮询单次挂起 SCAN_WAIT_TIMEOUT_MS = 60s，而前端默认 fetch 超时 30s
  //   ⇒ 客户端必然先 abort，长轮询变成假失败（服务端还在正常等待，前端已经判死）。
  // 既有测试只守住了 LIST_LIVE_BUDGET_MS，漏了这一条 —— 本用例补上，任一层漂移就红。
  const constSrc = readFileSync(join(PARTS_DIR, 'const.js'), 'utf8');
  const readMs = (name) => {
    const m = constSrc.match(new RegExp(name + '\\s*=\\s*([\\d_]+)'));
    assert.ok(m, `应能读到前端常量 ${name}`);
    return Number(String(m[1]).replace(/_/g, ''));
  };
  const fetchTimeout = readMs('dshgp_FETCH_TIMEOUT_MS');
  const waitFetch = readMs('dshgp_SCAN_WAIT_FETCH_MS');
  assert.ok(SCAN_WAIT_TIMEOUT_MS < waitFetch,
    `服务端长轮询挂起 ${SCAN_WAIT_TIMEOUT_MS}ms 必须小于前端单请求超时 ${waitFetch}ms（否则客户端先 abort）`);
  assert.ok(waitFetch <= fetchTimeout,
    `长轮询单请求超时 ${waitFetch}ms 不应超过默认 fetch 超时 ${fetchTimeout}ms`);
  // 余量：服务端挂起只用掉单请求超时的 80% 以内，避免边界抖动
  assert.ok(SCAN_WAIT_TIMEOUT_MS <= waitFetch * 0.8,
    `服务端挂起 ${SCAN_WAIT_TIMEOUT_MS}ms 应 ≤ 单请求超时的 80%（${Math.round(waitFetch * 0.8)}ms）`);
});

test('预算必须小于前端 fetch 超时（否则服务端再准也会被前端先掐断）', () => {
  const constSrc = readFileSync(join(PARTS_DIR, 'const.js'), 'utf8');
  // 源码里数字用下划线分组（30_000），取值时要去掉分隔符
  const m = constSrc.match(/dshgp_FETCH_TIMEOUT_MS\s*=\s*([\d_]+)/);
  assert.ok(m, '应能读到前端 fetch 超时常量');
  const fetchTimeout = Number(String(m[1]).replace(/_/g, ''));
  assert.ok(LIST_LIVE_BUDGET_MS < fetchTimeout,
    `远端探测预算 ${LIST_LIVE_BUDGET_MS}ms 必须小于前端超时 ${fetchTimeout}ms（留出序列化与传输余量）`);
  // 留足余量：预算只用掉前端超时的 80% 以内，避免边界抖动
  assert.ok(LIST_LIVE_BUDGET_MS <= fetchTimeout * 0.8,
    `预算 ${LIST_LIVE_BUDGET_MS}ms 应 ≤ 前端超时的 80%（${Math.round(fetchTimeout * 0.8)}ms）`);
});

test('预算传播：单次探测不会穿透整表预算（budgetMs=1 应快速失败返回）', async () => {
  // 真因复盘：整表预算只在「每次探测前」检查一次，单次探测内部若有一步不带超时的
  //   git 调用（cold start 首次 SSH / CIFS 大目录 stat），整个请求就会穿透预算 ——
  //   实测症状是「DSH 启动后首开本地页 → 前端 30s fetch 先 abort → signal timed out」。
  //   修法是把剩余预算摊到每一步（stepTimeout），本用例验它真的生效。
  const { liveRemoteHeadAsync } = await import('../lib/git/transport.js');
  const t0 = Date.now();
  const result = await liveRemoteHeadAsync({ repoPath: ROOT, budgetMs: 1 });
  const elapsed = Date.now() - t0;
  assert.equal(result.ok, false, '预算耗尽应如实返回失败（不是拿到结果）');
  assert.ok(elapsed < 3000, `预算 1ms 时必须快速返回，实际耗时 ${elapsed}ms`);
});

test('源码契约：liveRemoteHeadAsync 内每处 git 调用都带 timeoutMs', () => {
  // 只验行为还不够——将来有人新增一句不带 timeoutMs 的 git 调用，预算又会被穿透。
  //   用源码契约钉死：该函数体内所有 runGitAsync 调用必须显式带 timeoutMs。
  const src = readFileSync(join(ROOT, 'lib/git/transport.js'), 'utf8');
  const start = src.indexOf('export async function liveRemoteHeadAsync');
  assert.ok(start >= 0, '应能找到 liveRemoteHeadAsync');
  const fnBody = src.slice(start, src.indexOf('\n}', start) >= 0 ? src.indexOf('\n}', start) : undefined);
  const calls = fnBody.match(/runGitAsync\(\[[^\]]*\][^)]*\)/g) || [];
  assert.ok(calls.length >= 3, `应至少有 3 处 runGitAsync 调用，实际 ${calls.length}`);
  for (const call of calls) {
    assert.ok(/timeoutMs/.test(call), `每处 git 调用都必须带 timeoutMs（否则单次调用会穿透预算）：${call.slice(0, 90)}`);
  }
});
