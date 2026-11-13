/**
 * test-clone-replay.mjs —— 同族测试合并（test-clone-replay.mjs · test-clone-replay-io.mjs · test-clone-parts-keep.mjs · test-clone-token.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { downloadBlobs, PARTS_DIR } from '../../lib/git/clone-download.js';
import { createReplayIo, REPLAY_MARKER_FILE } from '../../lib/git/clone-replay-io.js';
import { blobEntriesOf, planTreeDiff, replayMarkerPath, canResumeFrom, replayHistory, initArgs, setRemoteArgs, configFileModeArgs, addAllArgs, writeTreeArgs, commitTreeArgs, updateRefArgs, setUpstreamArgs, revParseArgs, remoteTrackingRef, localBranchRef, markerJson } from '../../lib/git/clone-replay.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-clone-replay.mjs ──
{
  // clone-replay 单测：树条目解析、按提交算差异、续跑标记判定。
  //
  // 为什么这些用例值得存在：真实历史重放要靠它们决定「下哪些文件、删哪些、从哪继续」——
  //   ① 若把 truncated 的树当完整树用 ⇒ 漏文件 ⇒ 重放出的 tree 与远端不同 ⇒ sha 不同 ⇒ 推不回；
  //   ② 若把「只改了可执行位」的文件当未变 ⇒ 权限与远端不符 ⇒ 同样 sha 不同；
  //   ③ 若在远端 force push 后沿用旧标记 ⇒ 整条链重放出错；
  //   ④ 若「目录变文件」时先下后删 ⇒ 下载落到旧文件名的父目录上直接失败。


  const E = (path, sha, mode = '100644', size = 10) => ({ path, sha, mode, size });

  test('[clone-replay] blobEntriesOf：只取 blob、按路径排序、size 归一为数字', () => {
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

  test('[clone-replay] blobEntriesOf：truncated 的树必须判为不可用（否则漏文件 ⇒ sha 不同）', () => {
    const r = blobEntriesOf({ tree: [{ path: 'a', mode: '100644', type: 'blob', sha: 'a' }], truncated: true });
    assert.equal(r.ok, false);
    assert.equal(r.truncated, true);
    assert.match(r.error, /截断|truncated/);
    assert.equal(r.entries.length, 1);          // 仍返回已拿到的条目，供调用方诊断
  });

  test('[clone-replay] blobEntriesOf：返回体缺 tree 数组时如实报错，不抛异常', () => {
    assert.equal(blobEntriesOf({}).ok, false);
    assert.equal(blobEntriesOf(null).ok, false);
    assert.match(blobEntriesOf({}).error, /tree/);
  });

  test('[clone-replay] planTreeDiff：首次提交（父为空）全部下载', () => {
    const d = planTreeDiff([], [E('a', '1'), E('b', '2')]);
    assert.deepEqual(d.download.map((e) => e.path), ['a', 'b']);
    assert.deepEqual(d.keep, []);
    assert.deepEqual(d.remove, []);
  });

  test('[clone-replay] planTreeDiff：区分新增/内容变/权限变/未变/删除', () => {
    const prev = [E('same', 's'), E('changed', '1'), E('mode', 'm', '100644'), E('gone', 'g')];
    const cur = [E('same', 's'), E('changed', '2'), E('mode', 'm', '100755'), E('added', 'n')];
    const d = planTreeDiff(prev, cur);
    assert.deepEqual(d.download.map((e) => e.path), ['added', 'changed', 'mode']);
    assert.deepEqual(d.keep.map((e) => e.path), ['same']);
    assert.deepEqual(d.remove, ['gone']);
  });

  test('[clone-replay] planTreeDiff：目录变文件 / 文件变目录 → 旧路径删除 + 新路径新增', () => {
    const asDir = planTreeDiff([E('x', '1')], [E('x/y', '2')]);
    assert.deepEqual(asDir.remove, ['x']);
    assert.deepEqual(asDir.download.map((e) => e.path), ['x/y']);

    const asFile = planTreeDiff([E('x/y', '2')], [E('x', '1')]);
    assert.deepEqual(asFile.remove, ['x/y']);
    assert.deepEqual(asFile.download.map((e) => e.path), ['x']);
  });

  test('[clone-replay] planTreeDiff：入参非数组时不抛异常（防御式）', () => {
    const d = planTreeDiff(undefined, [E('a', '1')]);
    assert.equal(d.download.length, 1);
    const d2 = planTreeDiff([E('a', '1')], undefined);
    assert.deepEqual(d2.remove, ['a']);
  });

  test('[clone-replay] replayMarkerPath：标记落在 .git 内，且容忍末尾斜杠', () => {
    assert.equal(replayMarkerPath('/repo/.git').path, '/repo/.git/dsh-clone-history.json');
    assert.equal(replayMarkerPath('/repo/.git/').path, '/repo/.git/dsh-clone-history.json');
  });

  test('[clone-replay] canResumeFrom：无标记/分支不一致/sha 不在链上 都不可续跑', () => {
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

  test('[clone-replay] replayHistory：线性+合并链按序重建，父映射到本地 sha', async () => {
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

  test('[clone-replay] replayHistory：删除先于下载，且删除名单正确', async () => {
    const trees = { ta: [E('keep', 's'), E('gone', 'g')], tb: [E('keep', 's'), E('new', 'n')] };
    const { io, calls } = fakeIo({ trees });
    const chain = [C('a', [], 'ta', 'A'), C('b', ['a'], 'tb', 'B')];
    const r = await replayHistory({ commits: chain, branch: 'master', io });
    assert.equal(r.ok, true);
    assert.deepEqual(calls.remove, [['gone']]);
    assert.deepEqual(calls.download, [['gone', 'keep'], ['new']]);   // planTreeDiff 按路径排序，故 gone 在 keep 前
  });

  test('[clone-replay] replayHistory：续跑——标记指向链上提交时，从它的下一个开始且基线取它的树', async () => {
    const { io, calls } = fakeIo({ trees: TREES, marker: { branch: 'master', replayedSha: 'b' } });
    const r = await replayHistory({ commits: CHAIN, branch: 'master', io });
    assert.equal(r.ok, true);
    assert.equal(r.resumedFrom, 'b');
    assert.equal(r.replayed, 1);
    assert.deepEqual(calls.fetch, ['tb', 'tc']);        // 第一个是续跑基线
    assert.deepEqual(calls.marker.map((m) => m.replayedSha), ['c']);
  });

  test('[clone-replay] replayHistory：下载失败时中断、且标记不回退（续跑从最后完整处继续）', async () => {
    const { io, calls } = fakeIo({ trees: TREES, failDownloadAt: 2 });
    const r = await replayHistory({ commits: CHAIN, branch: 'master', io });
    assert.equal(r.ok, false);
    assert.match(r.error, /下载失败（b）/);
    assert.equal(r.replayed, 1);
    assert.equal(r.headSha, 'local-1');
    assert.deepEqual(calls.marker.map((m) => m.replayedSha), ['a']);   // 失败处不写标记
  });

  test('[clone-replay] replayHistory：父被 depth 截断（不在链上）时不传该父，避免引用不存在的对象', async () => {
    const trees = { tb: [E('f', 's')] };
    const { io, calls } = fakeIo({ trees });
    const r = await replayHistory({ commits: [C('b', ['a-missing'], 'tb', 'B')], branch: 'master', io });
    assert.equal(r.ok, true);
    assert.deepEqual(calls.commit[0].parentShas, []);
  });

  test('[clone-replay] replayHistory：缺 io / 空链 返回错误而不抛异常', async () => {
    assert.equal((await replayHistory({ commits: CHAIN, branch: 'master' })).ok, false);
    assert.equal((await replayHistory({ commits: [], branch: 'master', io: fakeIo().io })).ok, false);
  });

  // ─────────────────── git 命令参数构造（契约即参数数组） ───────────────────
  // 为什么逐条断言参数数组：接线层最容易写错的就是命令与参数顺序（少一个 -p、ref 名、配置键大小写），
  //   把它们固化成契约后，接线层只负责「把这些参数交给 runGit」，不再有解释空间。

  test('[clone-replay] git 参数构造：init / remote / config / add / write-tree', () => {
    assert.deepEqual(initArgs(), ['init']);
    assert.deepEqual(setRemoteArgs('origin', 'https://github.com/o/r.git'), ['remote', 'add', 'origin', 'https://github.com/o/r.git']);
    assert.deepEqual(configFileModeArgs(), ['config', 'core.fileMode', 'false']);
    assert.deepEqual(configFileModeArgs(true), ['config', 'core.fileMode', 'true']);
    assert.deepEqual(addAllArgs(), ['add', '-A', '-f']);   // -f：重建远端树时不得遵守 .gitignore（否则漏文件 ⇒ tree/sha 不同）
    assert.deepEqual(writeTreeArgs(), ['write-tree']);
  });

  test('[clone-replay] git 参数构造：commit-tree 保留父顺序、多父（合并提交）原样给出', () => {
    assert.deepEqual(commitTreeArgs({ tree: 't1' }), ['commit-tree', 't1', '-m', '']);
    assert.deepEqual(commitTreeArgs({ tree: 't2', parents: ['p1'], message: 'msg' }), ['commit-tree', 't2', '-p', 'p1', '-m', 'msg']);
    assert.deepEqual(
      commitTreeArgs({ tree: 't3', parents: ['p1', 'p2'], message: 'merge' }),
      ['commit-tree', 't3', '-p', 'p1', '-p', 'p2', '-m', 'merge'],
    );
  });

  test('[clone-replay] git 参数构造：update-ref / set-upstream / rev-parse / 引用名', () => {
    assert.deepEqual(updateRefArgs('refs/heads/master', 'abc'), ['update-ref', 'refs/heads/master', 'abc']);
    assert.deepEqual(updateRefArgs('refs/heads/master', 'abc', { oldValue: 'def' }), ['update-ref', 'refs/heads/master', 'abc', 'def']);
    assert.deepEqual(setUpstreamArgs('master'), ['branch', '--set-upstream-to=origin/master', 'master']);
    assert.deepEqual(setUpstreamArgs('dev', 'upstream'), ['branch', '--set-upstream-to=upstream/dev', 'dev']);
    assert.deepEqual(revParseArgs('HEAD'), ['rev-parse', 'HEAD']);
    assert.equal(remoteTrackingRef('origin', 'master'), 'refs/remotes/origin/master');
    assert.equal(localBranchRef('master'), 'refs/heads/master');
  });

  test('[clone-replay] markerJson：可解析回原值，且带 ISO 时间', () => {
    const s = markerJson({ branch: 'master', replayedSha: 'a1b2c3' });
    const o = JSON.parse(s);
    assert.equal(o.branch, 'master');
    assert.equal(o.replayedSha, 'a1b2c3');
    assert.match(o.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(JSON.parse(markerJson({ branch: 'm', replayedSha: 'x', at: 'FIXED' })).at, 'FIXED');
  });
}

// ── 原 test-clone-replay-io.mjs ──
{
  // clone-replay-io 单测：把「重放适配器实际会发出的 git 命令与文件动作」固化成断言。
  //
  // 为什么必须断言命令序列（而不是只看返回 ok）：接线层的失败模式是**参数与顺序悄悄错**——
  //   例如 commit-tree 少一个 -p，合并提交就退化成普通提交（历史线变、sha 变 ⇒ 推不回），
  //   而函数依然会「成功」返回。故这里断言的是**实际发出的命令文本**。
  // 另外两类真实行为也在此覆盖：① 已有 origin 时不得再 remote add（会失败且可能覆盖）；
  //   ② 标记文件在 .git 不存在时只回报错误、不抛异常（重放途中断电/清理后的容忍）。


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

  test('[clone-replay-io] prepare：先探测 origin，不存在才 add 真实 git URL；并显式写 core.fileMode=false', async () => {
    const { seen, runGit } = fakeGit({ hasOrigin: false });
    const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit, chmodOk: true } });
    const r = await io.prepare();
    assert.equal(r.ok, true);
    assert.equal(r.fileModeSet, true);
    assert.equal(r.originSet, true);
    assert.deepEqual(seen, [
      'init -q',
      'config core.fileMode false',
      'remote get-url origin',
      'remote add origin https://github.com/o/r.git',
    ]);
  });

  test('[clone-replay-io] prepare：已有 origin 时不得再 remote add（避免失败或覆盖）', async () => {
    const { seen, runGit } = fakeGit({ hasOrigin: true });
    const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit, chmodOk: true } });
    await io.prepare();
    assert.equal(seen.some((l) => l.startsWith('remote add')), false);
  });

  test('[clone-replay-io] fetchTreeEntries：转发 API 并交给 blobEntriesOf；树被截断时如实回 ok:false', async () => {
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

  test('[clone-replay-io] commit：命令序列为 add -A → write-tree → commit-tree（父按顺序逐个 -p）', async () => {
    const { seen, runGit } = fakeGit();
    const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit, chmodOk: true } });
    const r = await io.commit({ env: { GIT_AUTHOR_NAME: 'A' }, message: 'm', parentShas: ['p1', 'p2'] });
    assert.equal(r.ok, true);
    assert.equal(r.sha, 'SHA1');
    assert.deepEqual(seen, ['add -A -f', 'write-tree', 'commit-tree TREE1 -p p1 -p p2 -m m']);
  });

  test('[clone-replay-io] commit：write-tree 失败时如实报错，不发 commit-tree', async () => {
    const { seen, runGit } = fakeGit({ failAt: 'write-tree' });
    const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit, chmodOk: true } });
    const r = await io.commit({ message: 'm' });
    assert.equal(r.ok, false);
    assert.match(r.error, /write-tree/);
    assert.equal(seen.some((l) => l.startsWith('commit-tree')), false);
  });

  test('[clone-replay-io] applyDownload：有失败文件时回报 ok:false 并带上首个失败原因', async () => {
    const io = createReplayIo({
      repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master',
      deps: { downloadBlobs: async () => ({ files: 1, failed: [{ path: 'a/b.bin', reason: 'HTTP 404' }], modePreserved: true }) },
    });
    const r = await io.applyDownload([{ path: 'a/b.bin', sha: 's', size: 1 }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /a\/b\.bin/);
    assert.match(r.error, /HTTP 404/);
  });

  test('[clone-replay-io] applyRemove：真实删除文件与目录（目录变文件的情形）', async () => {
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

  test('[clone-replay-io] 标记读写：真实 .git 目录下写入后可读回；损坏 JSON 当无标记；.git 不存在只报错不抛', async () => {
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

  test('[clone-replay-io] finish：把分支与远端跟踪引用指到重放结果并设上游；分支引用失败则 ok:false', async () => {
    const { seen, runGit } = fakeGit();
    const io = createReplayIo({ repoPath: '/x', gitDir: '/x/.git', owner: 'o', repo: 'r', branch: 'master', deps: { runGit, chmodOk: true } });
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
}

// ── 原 test-clone-parts-keep.mjs ──
{
  // 分片保留回归：一轮下载**有失败项时**必须保留 .dsh-parts（下一轮才能 Range 续传）。
  //
  // 事故背景：clone-download 原先「成功与否都清」分片目录，而 clone.js 明确靠 .dsh-parts
  //   跨轮续传大文件——两处设计冲突，导致大文件每轮从 0 重来、永远下不完。
  //   实测：1.1GB 大 PNG（6~23MB/个）连跑两轮，失败项 105 → 78 几乎不变，且 .part 每轮归零。


  // 打桩全局 fetch：'bad.png' 只回 5 字节（声明 size=10）→ 长度校验失败、留下半截 .part；
  //   其余文件按声明长度返回 → 成功。两个通道（api/raw）都被同一桩接管，故失败是确定性的。
  //   返回的字节流固定为 'x'*n（与 blobSha 同源），成功文件的 sha 校验因此真实可过——
  //   桩必须与真实校验规则自洽，否则测的就不是「保留/清理」而是「校验必挂」。
  function stubFetch() {
    const orig = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      const fname = decodeURIComponent(u.split('/').pop().split('?')[0]);
      // 内容含文件名首字符 ⇒ 不同 path 得到不同 git sha ⇒ 分片文件名 <sha>.part 不会互相撞车
      const body = fname.includes('bad') ? 'x'.repeat(5) : fname[0] + 'x'.repeat(9);
      return new Response(body, { status: 200 });
    };
    return () => { globalThis.fetch = orig; };
  }

  // git blob 对象哈希（header 的 \0 按 latin1 单字节，与 clone-download 的增量哈希同口径）
  function blobSha(content, size) {
    return createHash('sha1')
      .update(`blob ${size}\u0000`, 'latin1')
      .update(content, 'utf8')
      .digest('hex');
  }
  const blob = (path, size) => ({ path, size, sha: blobSha(path[0] + 'x'.repeat(9), 10), mode: '100644' });

  test('[clone-parts-keep] 有失败项 → 保留 .dsh-parts 与半截分片（跨轮续传的前提）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshgp-parts-keep-'));
    const restore = stubFetch();
    try {
      const r = await downloadBlobs({
        blobs: [blob('ok.png', 10), blob('bad.png', 10)],
        targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
      });
      assert.equal(r.files, 1, '应有 1 个文件成功');
      assert.equal(r.failed.length, 1, '应有 1 个文件失败');
      const partsDir = join(dir, PARTS_DIR);
      assert.equal(existsSync(partsDir), true, '有失败项时必须保留 .dsh-parts（否则大文件永远从 0 重来）');
      const parts = readdirSync(partsDir).filter((n) => n.endsWith('.part'));
      assert.equal(parts.length, 1, '失败项的 .part 必须留在分片目录里，供下轮 Range 续传');
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[clone-parts-keep] 全部成功 → 清理 .dsh-parts（不留空目录残留）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshgp-parts-clean-'));
    const restore = stubFetch();
    try {
      const r = await downloadBlobs({
        blobs: [blob('a.png', 10), blob('b.png', 10)],
        targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 2,
      });
      assert.equal(r.failed.length, 0, '不应有失败项');
      assert.equal(r.files, 2, '两个文件都应成功');
      assert.equal(existsSync(join(dir, PARTS_DIR)), false, '全部成功应清掉分片目录');
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// ── 原 test-clone-token.mjs ──
{
  // git_clone 工具必须带 token 走认证 API 通道（实测发现此前漏传）。
  //
  // 事故：lib/app/tool-call.js 的 clone 执行体写成 `cloneViaApi({ target, dest, branch })`——
  //   **完全没传 token** ⇒ 工具路径的克隆走匿名 api.github.com：
  //   ① 私有库直接失败 ② 公开库吃匿名限流（60 次/小时）③ 体积上限也没传，与 HTTP 路径默认值不一致。
  //   而 HTTP 路径（handlers/clone.js）与预览路径都带了 token ⇒ 同一功能两条路径行为不同。

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  test('[clone-token] 结构契约：clone 工具执行体必须传 token + 统一体积上限', () => {
    const src = readFileSync(join(ROOT, 'lib/app/tool-call.js'), 'utf8');
    const start = src.indexOf('async function callCloneJob');
    const end = src.indexOf('async function callCommitPush');
    assert.ok(start !== -1 && end > start, '应能定位 callCloneJob 函数体');
    const fn = src.slice(start, end);
    assert.match(fn, /cloneViaApi\(\{/, '应调用 cloneViaApi');
    assert.match(fn, /token:\s*resolveToken\(/, '必须按仓库解析 token 并传入（否则走匿名 API）');
    assert.match(fn, /maxFileMB:\s*resolveMaxCloneFileMB\(/, '体积上限也要统一解析（与 HTTP 路径同口径）');
    // 调用点必须把 env/cfg 传下去，否则函数内部解析不到 token
    assert.match(src, /callCloneJob\(\{[^}]*\},\s*jobs,\s*exec,\s*log,\s*env,\s*cfg\)/,
      '调用点必须传 env/cfg（否则 token 解析不到）');
  });

  test('[clone-token] 结构契约：HTTP clone 路径同样带 token（两条路径同口径，防单边回退）', () => {
    const http = readFileSync(join(ROOT, 'lib/app/handlers/clone.js'), 'utf8');
    assert.match(http, /token:\s*resolveToken\(/, 'HTTP clone 必须带 token');
  });
}
