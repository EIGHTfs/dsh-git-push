// clone-history-mode 单测：真实历史模式的编排（拉链 → 准备 → 重放 → 收尾）。
//
// 为什么值得覆盖：这一层是「用户按下『带历史克隆』」到「本地出现可推送的真实历史」之间唯一的编排点，
//   任一环节漏调（例如忘了 prepare 就重放、或重放完没有 finish 把引用挂上）
//   都会表现为「克隆成功但分支上没有历史」——函数却不报错。故此处断言编排顺序与最终引用。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveBranchHead, cloneWithHistory } from '../lib/git/clone-history-mode.js';

const C = (sha, parents, tree, msg) => ({
  sha, parents, message: msg,
  tree: { sha: tree },        // 真实 /git/commits/{sha} 的 tree 是**对象**（{sha,url}），不是字符串
  author: { name: 'A', email: 'a@x', date: '2026-09-13T12:00:00Z' },
  committer: { name: 'A', email: 'a@x', date: '2026-09-13T12:00:00Z' },
});
const E = (path, sha) => ({ path, mode: '100644', type: 'blob', sha, size: 1 });

/** 假 GitHub API：按路径分流 refs / commits / trees。 */
function fakeApi({ headSha = 'c', trees = {}, commits = {}, refStatus = 200 } = {}) {
  return async (path) => {
    if (path.includes('/git/refs/heads/')) {
      return refStatus === 200 ? { ok: true, status: 200, json: { object: { sha: headSha } } } : { ok: false, status: refStatus, json: null };
    }
    const sha = String(path).split('/').pop().split('?')[0];   // 注意：trees 路径带 ?recursive=1，末段须先去查询串
    if (path.includes('/git/commits/')) return commits[sha] ? { ok: true, status: 200, json: commits[sha] } : { ok: false, status: 404, json: null };
    if (path.includes('/git/trees/')) return { ok: true, status: 200, json: { tree: trees[sha] || [], truncated: false } };
    return { ok: false, status: 500, json: null };
  };
}

/** 记录型假 runGit。 */
function fakeGit() {
  const seen = [];
  let n = 0;
  const runGit = (args) => {
    seen.push(args.join(' '));
    if (args[0] === 'write-tree') return { ok: true, stdout: 'T1', stderr: '' };
    if (args[0] === 'commit-tree') { n += 1; return { ok: true, stdout: `LOCAL${n}`, stderr: '' }; }
    if (args[0] === 'remote' && args[1] === 'get-url') return { ok: false, stdout: '', stderr: 'none' };
    return { ok: true, stdout: '', stderr: '' };
  };
  return { seen, runGit };
}

const COMMITS = { a: C('a', [], 'ta', 'A'), b: C('b', ['a'], 'tb', 'B') };
const TREES = { ta: [E('f1', 's1')], tb: [E('f1', 's1'), E('f2', 's2')] };

test('resolveBranchHead：正常取 sha；非 200 时回报失败', async () => {
  const ok = await resolveBranchHead({ owner: 'o', repo: 'r', branch: 'master', deps: { githubFetch: fakeApi() } });
  assert.equal(ok.ok, true);
  assert.equal(ok.sha, 'c');

  const bad = await resolveBranchHead({ owner: 'o', repo: 'r', branch: 'master', deps: { githubFetch: fakeApi({ refStatus: 404 }) } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /取分支 HEAD/);
});

test('cloneWithHistory：完整流水线（拉链 → 准备 → 重放 → 收尾），引用指向重放结果', async () => {
  const { seen, runGit } = fakeGit();
  const r = await cloneWithHistory({
    owner: 'o', repo: 'r', branch: 'master', repoPath: '/x', gitDir: '/x/.git',
    deps: {
      githubFetch: fakeApi({ headSha: 'b', trees: TREES, commits: COMMITS }),
      runGit,
      downloadBlobs: async (o2) => ({ files: o2.blobs.length, failed: [], modePreserved: true }),
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.replayed, 2);
  assert.equal(r.headSha, 'LOCAL2');
  // 编排顺序：init/config/remote → 下载 → 提交 → 收尾挂引用
  assert.equal(seen[0], 'init');
  assert.equal(seen[1], 'config core.fileMode false');
  assert.equal(seen.includes('add -A'), true);
  assert.deepEqual(seen.slice(-3), [
    'update-ref refs/heads/master LOCAL2',
    'update-ref refs/remotes/origin/master LOCAL2',
    'branch --set-upstream-to=origin/master master',
  ]);
});

test('cloneWithHistory：取分支失败时立即返回，不碰仓库', async () => {
  const { seen, runGit } = fakeGit();
  const r = await cloneWithHistory({
    owner: 'o', repo: 'r', branch: 'master', repoPath: '/x', gitDir: '/x/.git',
    deps: { githubFetch: fakeApi({ refStatus: 404 }), runGit },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /取分支 HEAD/);
  assert.deepEqual(seen, []);                       // 未发生任何 git 动作
});

test('cloneWithHistory：下载失败时中断并如实回报已重放条数', async () => {
  const { runGit } = fakeGit();
  let call = 0;
  const r = await cloneWithHistory({
    owner: 'o', repo: 'r', branch: 'master', repoPath: '/x', gitDir: '/x/.git',
    deps: {
      githubFetch: fakeApi({ headSha: 'b', trees: TREES, commits: COMMITS }),
      runGit,
      downloadBlobs: async () => { call += 1; return call === 2 ? { files: 0, failed: [{ path: 'f2', reason: 'HTTP 500' }], modePreserved: true } : { files: 1, failed: [], modePreserved: true }; },
    },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /下载失败/);
  assert.equal(r.replayed, 1);
  assert.equal(r.count, 2);
});

test('cloneWithHistory：depth 截断信息透传（大仓可控）', async () => {
  const r = await cloneWithHistory({
    owner: 'o', repo: 'r', branch: 'master', repoPath: '/x', gitDir: '/x/.git', depth: 1,
    deps: {
      githubFetch: fakeApi({ headSha: 'b', trees: TREES, commits: COMMITS }),
      runGit: fakeGit().runGit,
      downloadBlobs: async (o2) => ({ files: o2.blobs.length, failed: [], modePreserved: true }),
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.truncated, true);
});
