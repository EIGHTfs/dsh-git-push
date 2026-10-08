// clone-history 单测：提交链拉取、拓扑定序、重放计划、日期与环境变量换算。
//
// 为什么这些用例值得存在：真实历史模式（history）要重建远端提交链，
//   而「父先于子」「合并提交多父」「时区偏移保留」三件事任一错，
//   重建出来的 sha 就与远端不同 ⇒ 祖先关系断裂 ⇒ 推不回远端（本能力的存在意义即为此）。
//   这些是纯函数，apiGet 注入后可完全离线断言，故在此覆盖：
//     ① 拓扑序与输入顺序无关（GitHub 返回顺序不可信）② depth 截断标记
//     ③ 合并提交识别与父序号 ④ 时区偏移逐个保留 ⑤ 失败路径如实回报 ⑥ 环境变量回退
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_HISTORY_DEPTH, fetchCommitChain, topoSort, planReplay, gitDateOf, commitEnvOf,
} from '../lib/git/clone-history.js';

/** 造一条含合并提交的提交对象（字段形状与 /git/commits/{sha} 返回一致）。 */
const C = (sha, parents, extra = {}) => ({
  sha,
  parents,
  tree: { sha: `tree-${sha}` },   // 真实 /git/commits/{sha} 的 tree 是对象（tree.sha），写字符串会让映射静默取到空串
  message: `msg-${sha}`,
  author: { name: `A-${sha}`, email: `${sha}@example.com`, date: '2026-09-13T12:00:00+08:00' },
  committer: { name: `K-${sha}`, email: `k-${sha}@example.com`, date: '2026-09-13T12:00:00+08:00' },
  ...extra,
});

/** 用固定链条造 apiGet 桩：按 sha 取，未知 sha 回 404。 */
function stubApi(chain) {
  const bySha = new Map(chain.map((c) => [c.sha, c]));
  return {
    bySha,
    apiGet: async (path) => {
      const sha = String(path).split('/').pop();
      const hit = bySha.get(sha);
      return hit ? { ok: true, status: 200, json: hit } : { ok: false, status: 404, json: null };
    },
  };
}

test('fetchCommitChain：合并链按拓扑序返回（父先于子）', async () => {
  const a = C('a', []);
  const b = C('b', ['a']);
  const c = C('c', ['b', 'a']);          // 合并提交：两父
  const { apiGet } = stubApi([a, b, c]);
  const r = await fetchCommitChain({ owner: 'o', repo: 'r', head: 'c', apiGet });
  assert.equal(r.ok, true);
  assert.deepEqual(r.commits.map((x) => x.sha), ['a', 'b', 'c']);
  assert.equal(r.commits[0].tree, 'tree-a');   // 树 sha 必须从 tree.sha 映射出来（写错形状会静默变空串）
  assert.equal(r.truncated, false);
});

test('topoSort：输入顺序被打乱也保持父先于子', () => {
  const a = C('a', []);
  const b = C('b', ['a']);
  const c = C('c', ['b']);
  const out = topoSort([c, a, b]).map((x) => x.sha);
  assert.deepEqual(out, ['a', 'b', 'c']);
});

test('topoSort：链外的父（depth 截断处）视为已满足，且不丢提交', () => {
  const b = C('b', ['a-missing']);       // a 不在本批（被 depth 截断）
  const out = topoSort([b]).map((x) => x.sha);
  assert.deepEqual(out, ['b']);
});

test('fetchCommitChain：depth 截断时置 truncated 且不超过条数上限', async () => {
  const a = C('a', []);
  const b = C('b', ['a']);
  const c = C('c', ['b']);
  const { apiGet } = stubApi([a, b, c]);
  const r = await fetchCommitChain({ owner: 'o', repo: 'r', head: 'c', depth: 2, apiGet });
  assert.equal(r.ok, true);
  assert.equal(r.commits.length, 2);
  assert.equal(r.truncated, true);
});

test('fetchCommitChain：取提交失败时如实回报状态码与短 sha', async () => {
  const { apiGet } = stubApi([]);        // 全部 404
  const r = await fetchCommitChain({ owner: 'o', repo: 'r', head: 'deadbeef', apiGet });
  assert.equal(r.ok, false);
  assert.match(r.error, /deadbee/);
  assert.match(r.error, /404/);
});

test('fetchCommitChain：缺 apiGet / 缺 owner 等入参时返回错误而不是抛异常', async () => {
  const r1 = await fetchCommitChain({ owner: 'o', repo: 'r', head: 'a' });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /apiGet/);
  const r2 = await fetchCommitChain({ owner: '', repo: 'r', head: 'a', apiGet: async () => ({}) });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /owner\/repo\/head/);
});

test('planReplay：标出合并提交与父序号，根提交父序号为空', () => {
  const a = C('a', []);
  const b = C('b', ['a']);
  const c = C('c', ['b', 'a']);
  const plan = planReplay([a, b, c]);
  assert.deepEqual(plan.map((p) => [p.commit.sha, p.isMerge, p.parentIndexes]), [
    ['a', false, []],
    ['b', false, [0]],
    ['c', true, [1, 0]],
  ]);
});

test('gitDateOf：保留时区偏移（sha 保真必需），并给出正确的 epoch', () => {
  assert.equal(gitDateOf('2026-09-13T12:00:00+08:00'), '1789300800 +0800');
  assert.equal(gitDateOf('2026-09-13T13:00:00Z'), '1789304400 +0000');
  assert.equal(gitDateOf('2026-09-13T14:00:00-05:00'), '1789308000 -0500');
  assert.equal(gitDateOf('2026-09-13T12:00:00.123+08:00'), '1789300800 +0800');   // 毫秒忽略，偏移保留
  assert.equal(gitDateOf('not-a-date'), '0 +0000');                                // 异常输入不抛
  assert.equal(gitDateOf(''), '0 +0000');
});

test('commitEnvOf：作者与提交者字段齐全；提交者缺失时回退到作者', () => {
  const full = commitEnvOf(C('a', []));
  assert.deepEqual(Object.keys(full).sort(), [
    'GIT_AUTHOR_DATE', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_NAME',
    'GIT_COMMITTER_DATE', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_NAME',
  ]);
  assert.equal(full.GIT_AUTHOR_NAME, 'A-a');
  assert.equal(full.GIT_COMMITTER_NAME, 'K-a');
  assert.equal(full.GIT_AUTHOR_DATE, '1789300800 +0800');

  const noCommitter = commitEnvOf({ author: { name: 'X', email: 'x@y', date: '2026-09-13T13:00:00Z' } });
  assert.equal(noCommitter.GIT_COMMITTER_NAME, 'X');
  assert.equal(noCommitter.GIT_COMMITTER_EMAIL, 'x@y');
  assert.equal(noCommitter.GIT_COMMITTER_DATE, '1789304400 +0000');
});

test('DEFAULT_HISTORY_DEPTH：默认深度是有限正整数（大仓可控）', () => {
  assert.equal(Number.isInteger(DEFAULT_HISTORY_DEPTH), true);
  assert.equal(DEFAULT_HISTORY_DEPTH > 0, true);
  assert.equal(DEFAULT_HISTORY_DEPTH <= 200, true);
});
