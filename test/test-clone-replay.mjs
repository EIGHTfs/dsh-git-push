// clone-replay 单测：树条目解析、按提交算差异、续跑标记判定。
//
// 为什么这些用例值得存在：真实历史重放要靠它们决定「下哪些文件、删哪些、从哪继续」——
//   ① 若把 truncated 的树当完整树用 ⇒ 漏文件 ⇒ 重放出的 tree 与远端不同 ⇒ sha 不同 ⇒ 推不回；
//   ② 若把「只改了可执行位」的文件当未变 ⇒ 权限与远端不符 ⇒ 同样 sha 不同；
//   ③ 若在远端 force push 后沿用旧标记 ⇒ 整条链重放出错；
//   ④ 若「目录变文件」时先下后删 ⇒ 下载落到旧文件名的父目录上直接失败。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blobEntriesOf, planTreeDiff, replayMarkerPath, canResumeFrom } from '../lib/git/clone-replay.js';

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
