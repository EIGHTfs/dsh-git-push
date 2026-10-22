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
import { LIST_LIVE_BUDGET_MS } from '../lib/app/handlers/http-constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

test('预算必须小于前端 fetch 超时（否则服务端再准也会被前端先掐断）', () => {
  const constSrc = readFileSync(join(ROOT, 'lib/client-parts/const.js'), 'utf8');
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
