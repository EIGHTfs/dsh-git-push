// clone-replay 单测：树条目解析、按提交算差异、续跑标记判定。
//
// 为什么这些用例值得存在：真实历史重放要靠它们决定「下哪些文件、删哪些、从哪继续」——
//   ① 若把 truncated 的树当完整树用 ⇒ 漏文件 ⇒ 重放出的 tree 与远端不同 ⇒ sha 不同 ⇒ 推不回；
//   ② 若把「只改了可执行位」的文件当未变 ⇒ 权限与远端不符 ⇒ 同样 sha 不同；
//   ③ 若在远端 force push 后沿用旧标记 ⇒ 整条链重放出错；
//   ④ 若「目录变文件」时先下后删 ⇒ 下载落到旧文件名的父目录上直接失败。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  blobEntriesOf, planTreeDiff, replayMarkerPath, canResumeFrom, replayHistory,
  initArgs, setRemoteArgs, configFileModeArgs, addAllArgs, writeTreeArgs, commitTreeArgs,
  updateRefArgs, setUpstreamArgs, revParseArgs, remoteTrackingRef, localBranchRef, markerJson,
} from '../lib/git/clone-replay.js';

const E = (path, sha, mode = '100644', size = 10) => ({ path, sha, mode, size });

test('blobEntriesOf：只取 blob、按路径排序、size 归一为数字', () => {
  const r = blobEntriesOf({
    tree: [
      { path: 'src/b.js', mode: '100644', type: 'blob', sha: 'b', size: 2 },
      { path: 'src', mode: '040000', type: 'tree', sha: 'dir' },
      { path: 'a.js', mode: '100755', type: 'blob', sha: 'a', size: '3' },
    ],
    truncated: false,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map((e) => e.path), ['a.js', 'src/b.js']);
  assert.equal(r.entries[0].size, 3);
  assert.equal(r.entries[0].mode, '100755');
});

test('blobEntriesOf：truncated 的树必须判为不可用（否则漏文件 ⇒ sha 不同）', () => {
  const r = blobEntriesOf({ tree: [{ path: 'a', mode: '100644', type: 'blob', sha: 'a' }], truncated: true });
  assert.equal(r.ok, false);
  assert.equal(r.truncated, true);
  assert.match(r.error, /截断|truncated/);
  assert.equal(r.entries.length, 1);          // 仍返回已拿到的条目，供调用方诊断
});

test('blobEntriesOf：返回体缺 tree 数组时如实报错，不抛异常', () => {
  assert.equal(blobEntriesOf({}).ok, false);
  assert.equal(blobEntriesOf(null).ok, false);
  assert.match(blobEntriesOf({}).error, /tree/);
});

test('planTreeDiff：首次提交（父为空）全部下载', () => {
  const d = planTreeDiff([], [E('a', '1'), E('b', '2')]);
  assert.deepEqual(d.download.map((e) => e.path), ['a', 'b']);
  assert.deepEqual(d.keep, []);
  assert.deepEqual(d.remove, []);
});

test('planTreeDiff：区分新增/内容变/权限变/未变/删除', () => {
  const prev = [E('same', 's'), E('changed', '1'), E('mode', 'm', '100644'), E('gone', 'g')];
  const cur = [E('same', 's'), E('changed', '2'), E('mode', 'm', '100755'), E('added', 'n')];
  const d = planTreeDiff(prev, cur);
  assert.deepEqual(d.download.map((e) => e.path), ['added', 'changed', 'mode']);
  assert.deepEqual(d.keep.map((e) => e.path), ['same']);
  assert.deepEqual(d.remove, ['gone']);
});

test('planTreeDiff：目录变文件 / 文件变目录 → 旧路径删除 + 新路径新增', () => {
  const asDir = planTreeDiff([E('x', '1')], [E('x/y', '2')]);
  assert.deepEqual(asDir.remove, ['x']);
  assert.deepEqual(asDir.download.map((e) => e.path), ['x/y']);

  const asFile = planTreeDiff([E('x/y', '2')], [E('x', '1')]);
  assert.deepEqual(asFile.remove, ['x/y']);
  assert.deepEqual(asFile.download.map((e) => e.path), ['x']);
});

test('planTreeDiff：入参非数组时不抛异常（防御式）', () => {
  const d = planTreeDiff(undefined, [E('a', '1')]);
  assert.equal(d.download.length, 1);
  const d2 = planTreeDiff([E('a', '1')], undefined);
  assert.deepEqual(d2.remove, ['a']);
});

test('replayMarkerPath：标记落在 .git 内，且容忍末尾斜杠', () => {
  assert.equal(replayMarkerPath('/repo/.git').path, '/repo/.git/dsh-clone-history.json');
  assert.equal(replayMarkerPath('/repo/.git/').path, '/repo/.git/dsh-clone-history.json');
});

test('canResumeFrom：无标记/分支不一致/sha 不在链上 都不可续跑', () => {
  assert.equal(canResumeFrom(null, { branch: 'master', shas: ['a'] }).resume, false);
  assert.match(canResumeFrom(null, { branch: 'master' }).reason, /无标记/);

  const marker = { branch: 'master', replayedSha: 'b' };
  assert.equal(canResumeFrom(marker, { branch: 'dev', shas: ['b'] }).resume, false);
  assert.match(canResumeFrom(marker, { branch: 'dev', shas: ['b'] }).reason, /分支/);

  // 远端 force push / 分支重建后，旧 sha 不在链上 ⇒ 不能沿用（否则重放出错历史）
  assert.equal(canResumeFrom(marker, { branch: 'master', shas: ['a', 'c'] }).resume, false);
  assert.match(canResumeFrom(marker, { branch: 'master', shas: ['a'] }).reason, /force push|不在当前链上/);

  const ok = canResumeFrom(marker, { branch: 'master', shas: new Set(['a', 'b']) });
  assert.equal(ok.resume, true);
  assert.equal(ok.fromSha, 'b');
});

// ───────────────────────── replayHistory：编排（io 注入，离线） ─────────────────────────
// 为什么用假 io：编排的正确性（顺序、父映射、续跑点、失败处不回退标记）不依赖真 git/网络；
//   真跑 git 的那层由执行适配器承担，接线下轮做。

/** 造提交对象（字段形状与 /git/commits 一致）。 */
const C = (sha, parents, tree, msg) => ({
  sha, parents, tree, message: msg,
  author: { name: 'A', email: 'a@x', date: '2026-09-13T12:00:00Z' },
  committer: { name: 'A', email: 'a@x', date: '2026-09-13T12:00:00Z' },
});

/** 假 io：记录调用；failDownloadAt 指定第几次下载失败（从 1 数）。 */
function fakeIo({ trees = {}, failDownloadAt = -1, marker = null } = {}) {
  const calls = { commit: [], download: [], remove: [], marker: [], fetch: [] };
  let dl = 0;
  return {
    calls,
    io: {
      readMarker: async () => marker,
      writeMarker: async (m) => { calls.marker.push(m); return { ok: true }; },
      fetchTreeEntries: async (treeSha) => { calls.fetch.push(treeSha); return { ok: true, entries: trees[treeSha] || [], error: '' }; },
      applyDownload: async (entries) => {
        dl += 1;
        calls.download.push(entries.map((e) => e.path));
        return dl === failDownloadAt ? { ok: false, error: '网络抖动' } : { ok: true };
      },
      applyRemove: async (paths) => { calls.remove.push(paths); return { ok: true }; },
      commit: async (c) => { calls.commit.push(c); return { ok: true, sha: `local-${calls.commit.length}` }; },
    },
  };
}

const CHAIN = [C('a', [], 'ta', 'A'), C('b', ['a'], 'tb', 'B'), C('c', ['b', 'a'], 'tc', 'C')];
const TREES = { ta: [E('f1', 's1')], tb: [E('f1', 's1'), E('f2', 's2')], tc: [E('f1', 's1'), E('f2', 's2b')] };

test('replayHistory：线性+合并链按序重建，父映射到本地 sha', async () => {
  const { io, calls } = fakeIo({ trees: TREES });
  const r = await replayHistory({ commits: CHAIN, branch: 'master', io });
  assert.equal(r.ok, true);
  assert.equal(r.replayed, 3);
  assert.equal(r.headSha, 'local-3');
  assert.deepEqual(calls.commit.map((c) => c.parentShas), [[], ['local-1'], ['local-2', 'local-1']]);   // 合并提交两父都传
  assert.deepEqual(calls.download, [['f1'], ['f2'], ['f2']]);                                          // 只下变化文件
  assert.deepEqual(calls.marker.map((m) => m.replayedSha), ['a', 'b', 'c']);                            // 每步写标记
  assert.equal(calls.commit[0].env.GIT_AUTHOR_NAME, 'A');                                              // 环境变量已回填
});

test('replayHistory：删除先于下载，且删除名单正确', async () => {
  const trees = { ta: [E('keep', 's'), E('gone', 'g')], tb: [E('keep', 's'), E('new', 'n')] };
  const { io, calls } = fakeIo({ trees });
  const chain = [C('a', [], 'ta', 'A'), C('b', ['a'], 'tb', 'B')];
  const r = await replayHistory({ commits: chain, branch: 'master', io });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.remove, [['gone']]);
  assert.deepEqual(calls.download, [['gone', 'keep'], ['new']]);   // planTreeDiff 按路径排序，故 gone 在 keep 前
});

test('replayHistory：续跑——标记指向链上提交时，从它的下一个开始且基线取它的树', async () => {
  const { io, calls } = fakeIo({ trees: TREES, marker: { branch: 'master', replayedSha: 'b' } });
  const r = await replayHistory({ commits: CHAIN, branch: 'master', io });
  assert.equal(r.ok, true);
  assert.equal(r.resumedFrom, 'b');
  assert.equal(r.replayed, 1);
  assert.deepEqual(calls.fetch, ['tb', 'tc']);        // 第一个是续跑基线
  assert.deepEqual(calls.marker.map((m) => m.replayedSha), ['c']);
});

test('replayHistory：下载失败时中断、且标记不回退（续跑从最后完整处继续）', async () => {
  const { io, calls } = fakeIo({ trees: TREES, failDownloadAt: 2 });
  const r = await replayHistory({ commits: CHAIN, branch: 'master', io });
  assert.equal(r.ok, false);
  assert.match(r.error, /下载失败（b）/);
  assert.equal(r.replayed, 1);
  assert.equal(r.headSha, 'local-1');
  assert.deepEqual(calls.marker.map((m) => m.replayedSha), ['a']);   // 失败处不写标记
});

test('replayHistory：父被 depth 截断（不在链上）时不传该父，避免引用不存在的对象', async () => {
  const trees = { tb: [E('f', 's')] };
  const { io, calls } = fakeIo({ trees });
  const r = await replayHistory({ commits: [C('b', ['a-missing'], 'tb', 'B')], branch: 'master', io });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.commit[0].parentShas, []);
});

test('replayHistory：缺 io / 空链 返回错误而不抛异常', async () => {
  assert.equal((await replayHistory({ commits: CHAIN, branch: 'master' })).ok, false);
  assert.equal((await replayHistory({ commits: [], branch: 'master', io: fakeIo().io })).ok, false);
});

// ─────────────────── git 命令参数构造（契约即参数数组） ───────────────────
// 为什么逐条断言参数数组：接线层最容易写错的就是命令与参数顺序（少一个 -p、ref 名、配置键大小写），
//   把它们固化成契约后，接线层只负责「把这些参数交给 runGit」，不再有解释空间。

test('git 参数构造：init / remote / config / add / write-tree', () => {
  assert.deepEqual(initArgs(), ['init']);
  assert.deepEqual(setRemoteArgs('origin', 'https://github.com/o/r.git'), ['remote', 'add', 'origin', 'https://github.com/o/r.git']);
  assert.deepEqual(configFileModeArgs(), ['config', 'core.fileMode', 'false']);
  assert.deepEqual(configFileModeArgs(true), ['config', 'core.fileMode', 'true']);
  assert.deepEqual(addAllArgs(), ['add', '-A', '-f']);   // -f：重建远端树时不得遵守 .gitignore（否则漏文件 ⇒ tree/sha 不同）
  assert.deepEqual(writeTreeArgs(), ['write-tree']);
});

test('git 参数构造：commit-tree 保留父顺序、多父（合并提交）原样给出', () => {
  assert.deepEqual(commitTreeArgs({ tree: 't1' }), ['commit-tree', 't1', '-m', '']);
  assert.deepEqual(commitTreeArgs({ tree: 't2', parents: ['p1'], message: 'msg' }), ['commit-tree', 't2', '-p', 'p1', '-m', 'msg']);
  assert.deepEqual(
    commitTreeArgs({ tree: 't3', parents: ['p1', 'p2'], message: 'merge' }),
    ['commit-tree', 't3', '-p', 'p1', '-p', 'p2', '-m', 'merge'],
  );
});

test('git 参数构造：update-ref / set-upstream / rev-parse / 引用名', () => {
  assert.deepEqual(updateRefArgs('refs/heads/master', 'abc'), ['update-ref', 'refs/heads/master', 'abc']);
  assert.deepEqual(updateRefArgs('refs/heads/master', 'abc', { oldValue: 'def' }), ['update-ref', 'refs/heads/master', 'abc', 'def']);
  assert.deepEqual(setUpstreamArgs('master'), ['branch', '--set-upstream-to=origin/master', 'master']);
  assert.deepEqual(setUpstreamArgs('dev', 'upstream'), ['branch', '--set-upstream-to=upstream/dev', 'dev']);
  assert.deepEqual(revParseArgs('HEAD'), ['rev-parse', 'HEAD']);
  assert.equal(remoteTrackingRef('origin', 'master'), 'refs/remotes/origin/master');
  assert.equal(localBranchRef('master'), 'refs/heads/master');
});

test('markerJson：可解析回原值，且带 ISO 时间', () => {
  const s = markerJson({ branch: 'master', replayedSha: 'a1b2c3' });
  const o = JSON.parse(s);
  assert.equal(o.branch, 'master');
  assert.equal(o.replayedSha, 'a1b2c3');
  assert.match(o.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.parse(markerJson({ branch: 'm', replayedSha: 'x', at: 'FIXED' })).at, 'FIXED');
});
