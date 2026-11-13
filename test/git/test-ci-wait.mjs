/**
 * CI 等待（推送后确认构建真绿了）测试。
 *
 * 背景：推送成功 ≠ CI 通过。实测事故：一次推送成功、CI 在同一 SHA 上挂了
 *   （某个测试假设了 CIFS 特性，在 ext4 runner 上必然失败），只看推送结果完全发现不了。
 *
 * 判据要点（本测试锁死）：
 *   · 按 **head_sha** 查 run，不查"最新一次"——否则并发提交会拿到别人的结果；
 *   · 多 workflow：任一失败即 failure；
 *   · 刚推上去 run 可能还没创建，给 grace 期再判「没有 CI」；
 *   · 超时单独给 timeout（不算失败也不算通过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeRuns, waitForCi } from '../../lib/git/ci.js';

const run = (over = {}) => ({ name: 'ci', status: 'completed', conclusion: 'success', url: 'u', ...over });

test('summarizeRuns：全绿 / 有失败 / 仍在跑 / 空', () => {
  assert.equal(summarizeRuns([run(), run({ name: 'b' })]).conclusion, 'success');
  assert.equal(summarizeRuns([run(), run({ conclusion: 'failure' })]).conclusion, 'failure');
  assert.equal(summarizeRuns([run({ status: 'in_progress', conclusion: '' })]).conclusion, 'pending');
  assert.equal(summarizeRuns([]).conclusion, 'none');
});

test('summarizeRuns：neutral/skipped 不算红', () => {
  assert.equal(summarizeRuns([run({ conclusion: 'neutral' }), run({ conclusion: 'skipped' })]).conclusion, 'success');
});

test('summarizeRuns：cancelled / timed_out 算失败并列出', () => {
  const s = summarizeRuns([run({ conclusion: 'cancelled', name: 'x' }), run({ conclusion: 'timed_out', name: 'y' })]);
  assert.equal(s.conclusion, 'failure');
  assert.deepEqual(s.failingRuns.map((r) => r.name).sort(), ['x', 'y']);
});

/** 造一个按序返回的假 fetch（每次调用取下一个响应）。 */
function fakeFetch(sequence) {
  let i = 0;
  const calls = [];
  const impl = async (path) => {
    calls.push(path);
    const body = sequence[Math.min(i, sequence.length - 1)];
    i += 1;
    return { status: 200, json: { workflow_runs: body } };
  };
  return { impl, calls };
}

const noSleep = async () => {};
let clock = 0;
const fakeNow = () => clock;

test('waitForCi：按 head_sha 查询，且 pending → success 会继续轮询', async () => {
  clock = 0;
  const f = fakeFetch([
    [run({ status: 'in_progress', conclusion: '' })],
    [run()],
  ]);
  const r = await waitForCi({ owner: 'o', repo: 'r', sha: 'abc123', fetchImpl: f.impl, sleep: noSleep, now: fakeNow, pollMs: 1, graceMs: 10, timeoutMs: 1000 });
  assert.equal(r.conclusion, 'success');
  assert.equal(r.ok, true);
  assert.ok(f.calls[0].includes('head_sha=abc123'), `URL 必须带 head_sha：${f.calls[0]}`);
});

test('waitForCi：失败立即返回 failure 并带 URL', async () => {
  clock = 0;
  const f = fakeFetch([[run({ conclusion: 'failure', name: 'test', url: 'https://x/run/1' })]]);
  const r = await waitForCi({ owner: 'o', repo: 'r', sha: 's', fetchImpl: f.impl, sleep: noSleep, now: fakeNow });
  assert.equal(r.ok, false);
  assert.equal(r.conclusion, 'failure');
  assert.equal(r.url, 'https://x/run/1');
});

test('waitForCi：一直没 run → 超过 grace 判「没有 CI」（不算失败）', async () => {
  clock = 0;
  const f = fakeFetch([[]]);
  const r = await waitForCi({ owner: 'o', repo: 'r', sha: 's', fetchImpl: f.impl, sleep: async () => { clock += 100; }, now: fakeNow, graceMs: 250, pollMs: 100, timeoutMs: 5000 });
  assert.equal(r.conclusion, 'none');
  assert.equal(r.ok, true, '没有 CI 不应判成失败');
});

test('waitForCi：一直 pending → 超时给 timeout', async () => {
  clock = 0;
  const f = fakeFetch([[run({ status: 'queued', conclusion: '' })]]);
  const r = await waitForCi({ owner: 'o', repo: 'r', sha: 's', fetchImpl: f.impl, sleep: async () => { clock += 400; }, now: fakeNow, graceMs: 100, pollMs: 400, timeoutMs: 800 });
  assert.equal(r.conclusion, 'timeout');
  assert.equal(r.timedOut, true);
  assert.equal(r.ok, false);
});

test('waitForCi：缺 owner/repo 时明确报错，不发请求', async () => {
  let called = 0;
  const r = await waitForCi({ owner: '', repo: '', sha: 's', fetchImpl: async () => { called += 1; return { status: 200, json: {} }; } });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /owner\/repo/);
  assert.equal(called, 0);
});
