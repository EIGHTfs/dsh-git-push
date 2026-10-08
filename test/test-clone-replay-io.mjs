// clone-replay-io 单测：把「重放适配器实际会发出的 git 命令与文件动作」固化成断言。
//
// 为什么必须断言命令序列（而不是只看返回 ok）：接线层的失败模式是**参数与顺序悄悄错**——
//   例如 commit-tree 少一个 -p，合并提交就退化成普通提交（历史线变、sha 变 ⇒ 推不回），
//   而函数依然会「成功」返回。故这里断言的是**实际发出的命令文本**。
// 另外两类真实行为也在此覆盖：① 已有 origin 时不得再 remote add（会失败且可能覆盖）；
//   ② 标记文件在 .git 不存在时只回报错误、不抛异常（重放途中断电/清理后的容忍）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createReplayIo, REPLAY_MARKER_FILE } from '../lib/git/clone-replay-io.js';

/** 记录型假 runGit：按命令返回可预测的 stdout，未知命令回空。 */
function fakeGit({ hasOrigin = false, failAt = '' } = {}) {
  const seen = [];
  const runGit = (args) => {
    const line = args.join(' ');
    seen.push(line);
    if (failAt && line.startsWith(failAt)) return { ok: false, stdout: '', stderr: 'boom' };
    if (args[0] === 'write-tree') return { ok: true, stdout: 'TREE1', stderr: '' };
    if (args[0] === 'commit-tree') return { ok: true, stdout: 'SHA1', stderr: '' };
    if (args[0] === 'remote' && args[1] === 'get-url') return hasOrigin ? { ok: true, stdout: 'https://github.com/o/r.git', stderr: '' } : { ok: false, stdout: '', stderr: 'no such remote' };
    return { ok: true, stdout: '', stderr: '' };
  };
  return { seen, runGit };
}

const fakeApi = (json) => async () => ({ ok: true, status: 200, json });

test('prepare：先探测 origin，不存在才 add 真实 git URL；并显式写 core.fileMode=false', async () => {
  const { seen, runGit } = fakeGit({ hasOrigin: false });
  const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit } });
  const r = await io.prepare();
  assert.equal(r.ok, true);
  assert.equal(r.fileModeSet, true);
  assert.equal(r.originSet, true);
  assert.deepEqual(seen, [
    'init',
    'config core.fileMode false',
    'remote get-url origin',
    'remote add origin https://github.com/o/r.git',
  ]);
});

test('prepare：已有 origin 时不得再 remote add（避免失败或覆盖）', async () => {
  const { seen, runGit } = fakeGit({ hasOrigin: true });
  const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit } });
  await io.prepare();
  assert.equal(seen.some((l) => l.startsWith('remote add')), false);
});

test('fetchTreeEntries：转发 API 并交给 blobEntriesOf；树被截断时如实回 ok:false', async () => {
  const okIo = createReplayIo({
    repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master',
    deps: { githubFetch: fakeApi({ tree: [{ path: 'a', mode: '100644', type: 'blob', sha: 's', size: 1 }], truncated: false }) },
  });
  const ok = await okIo.fetchTreeEntries('T1');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.entries.map((e) => e.path), ['a']);

  const badIo = createReplayIo({
    repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master',
    deps: { githubFetch: fakeApi({ tree: [{ path: 'a', mode: '100644', type: 'blob', sha: 's' }], truncated: true }) },
  });
  const bad = await badIo.fetchTreeEntries('T1');
  assert.equal(bad.ok, false);                    // 截断的树绝不能当完整树用
  assert.match(bad.error, /截断|truncated/);
});

test('commit：命令序列为 add -A → write-tree → commit-tree（父按顺序逐个 -p）', async () => {
  const { seen, runGit } = fakeGit();
  const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit } });
  const r = await io.commit({ env: { GIT_AUTHOR_NAME: 'A' }, message: 'm', parentShas: ['p1', 'p2'] });
  assert.equal(r.ok, true);
  assert.equal(r.sha, 'SHA1');
  assert.deepEqual(seen, ['add -A', 'write-tree', 'commit-tree TREE1 -p p1 -p p2 -m m']);
});

test('commit：write-tree 失败时如实报错，不发 commit-tree', async () => {
  const { seen, runGit } = fakeGit({ failAt: 'write-tree' });
  const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit } });
  const r = await io.commit({ message: 'm' });
  assert.equal(r.ok, false);
  assert.match(r.error, /write-tree/);
  assert.equal(seen.some((l) => l.startsWith('commit-tree')), false);
});

test('applyDownload：有失败文件时回报 ok:false 并带上首个失败原因', async () => {
  const io = createReplayIo({
    repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master',
    deps: { downloadBlobs: async () => ({ files: 1, failed: [{ path: 'a/b.bin', reason: 'HTTP 404' }], modePreserved: true }) },
  });
  const r = await io.applyDownload([{ path: 'a/b.bin', sha: 's', size: 1 }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /a\/b\.bin/);
  assert.match(r.error, /HTTP 404/);
});

test('applyRemove：真实删除文件与目录（目录变文件的情形）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-rm-'));
  try {
    writeFileSync(join(dir, 'f.txt'), 'x', 'utf8');
    mkdirSync(join(dir, 'sub/deep'), { recursive: true });
    writeFileSync(join(dir, 'sub/deep/g.txt'), 'y', 'utf8');
    const io = createReplayIo({ repoPath: dir, gitDir: join(dir, '.git'), owner: 'o', repo: 'r', branch: 'master', deps: {} });
    const r = await io.applyRemove(['f.txt', 'sub']);
    assert.equal(r.ok, true);
    assert.equal(existsSync(join(dir, 'f.txt')), false);
    assert.equal(existsSync(join(dir, 'sub')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('标记读写：真实 .git 目录下写入后可读回；损坏 JSON 当无标记；.git 不存在只报错不抛', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-mk-'));
  try {
    const gitDir = join(dir, '.git');
    mkdirSync(gitDir, { recursive: true });
    const io = createReplayIo({ repoPath: dir, gitDir, owner: 'o', repo: 'r', branch: 'master', deps: {} });
    assert.equal(await io.readMarker(), null);
    assert.equal((await io.writeMarker({ branch: 'master', replayedSha: 'abc' })).ok, true);
    const m = await io.readMarker();
    assert.equal(m.branch, 'master');
    assert.equal(m.replayedSha, 'abc');
    assert.equal(existsSync(join(gitDir, REPLAY_MARKER_FILE)), true);

    writeFileSync(join(gitDir, REPLAY_MARKER_FILE), '{ 坏 JSON', 'utf8');
    assert.equal(await io.readMarker(), null);      // 坏标记必须当「无标记」，绝不能影响重放

    const noGit = createReplayIo({ repoPath: dir, gitDir: join(dir, 'nope/.git'), owner: 'o', repo: 'r', branch: 'master', deps: {} });
    const w = await noGit.writeMarker({ branch: 'master', replayedSha: 'x' });
    assert.equal(w.ok, false);
    assert.ok(typeof w.error === 'string' && w.error.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finish：把分支与远端跟踪引用指到重放结果并设上游；分支引用失败则 ok:false', async () => {
  const { seen, runGit } = fakeGit();
  const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit } });
  const r = await io.finish({ headSha: 'SHA1' });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, [
    'update-ref refs/heads/master SHA1',
    'update-ref refs/remotes/origin/master SHA1',
    'branch --set-upstream-to=origin/master master',
  ]);

  const bad = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit: fakeGit({ failAt: 'update-ref' }).runGit } });
  const rb = await bad.finish({ headSha: 'SHA1' });
  assert.equal(rb.ok, false);
  assert.match(rb.error, /分支引用/);
});
