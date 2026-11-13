/**
 * test-clone-history.mjs —— 同族测试合并（test-clone-history.mjs · test-clone-history-mode.mjs · test-clone-history-defaults.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { resolveBranchHead, cloneWithHistory } from '../../lib/git/clone-history-mode.js';
import { DEFAULT_HISTORY_DEPTH, fetchCommitChain, topoSort, planReplay, gitDateOf, commitEnvOf } from '../../lib/git/clone-history.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-clone-history.mjs ──
{
  // clone-history 单测：提交链拉取、拓扑定序、重放计划、日期与环境变量换算。
  //
  // 为什么这些用例值得存在：真实历史模式（history）要重建远端提交链，
  //   而「父先于子」「合并提交多父」「时区偏移保留」三件事任一错，
  //   重建出来的 sha 就与远端不同 ⇒ 祖先关系断裂 ⇒ 推不回远端（本能力的存在意义即为此）。
  //   这些是纯函数，apiGet 注入后可完全离线断言，故在此覆盖：
  //     ① 拓扑序与输入顺序无关（GitHub 返回顺序不可信）② depth 截断标记
  //     ③ 合并提交识别与父序号 ④ 时区偏移逐个保留 ⑤ 失败路径如实回报 ⑥ 环境变量回退


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

  test('[clone-history] fetchCommitChain：合并链按拓扑序返回（父先于子）', async () => {
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

  test('[clone-history] topoSort：输入顺序被打乱也保持父先于子', () => {
    const a = C('a', []);
    const b = C('b', ['a']);
    const c = C('c', ['b']);
    const out = topoSort([c, a, b]).map((x) => x.sha);
    assert.deepEqual(out, ['a', 'b', 'c']);
  });

  test('[clone-history] topoSort：链外的父（depth 截断处）视为已满足，且不丢提交', () => {
    const b = C('b', ['a-missing']);       // a 不在本批（被 depth 截断）
    const out = topoSort([b]).map((x) => x.sha);
    assert.deepEqual(out, ['b']);
  });

  test('[clone-history] fetchCommitChain：depth 截断时置 truncated 且不超过条数上限', async () => {
    const a = C('a', []);
    const b = C('b', ['a']);
    const c = C('c', ['b']);
    const { apiGet } = stubApi([a, b, c]);
    const r = await fetchCommitChain({ owner: 'o', repo: 'r', head: 'c', depth: 2, apiGet });
    assert.equal(r.ok, true);
    assert.equal(r.commits.length, 2);
    assert.equal(r.truncated, true);
  });

  test('[clone-history] fetchCommitChain：取提交失败时如实回报状态码与短 sha', async () => {
    const { apiGet } = stubApi([]);        // 全部 404
    const r = await fetchCommitChain({ owner: 'o', repo: 'r', head: 'deadbeef', apiGet });
    assert.equal(r.ok, false);
    assert.match(r.error, /deadbee/);
    assert.match(r.error, /404/);
  });

  test('[clone-history] fetchCommitChain：缺 apiGet / 缺 owner 等入参时返回错误而不是抛异常', async () => {
    const r1 = await fetchCommitChain({ owner: 'o', repo: 'r', head: 'a' });
    assert.equal(r1.ok, false);
    assert.match(r1.error, /apiGet/);
    const r2 = await fetchCommitChain({ owner: '', repo: 'r', head: 'a', apiGet: async () => ({}) });
    assert.equal(r2.ok, false);
    assert.match(r2.error, /owner\/repo\/head/);
  });

  test('[clone-history] planReplay：标出合并提交与父序号，根提交父序号为空', () => {
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

  test('[clone-history] gitDateOf：保留时区偏移（sha 保真必需），并给出正确的 epoch', () => {
    assert.equal(gitDateOf('2026-09-13T12:00:00+08:00'), '1789300800 +0800');
    assert.equal(gitDateOf('2026-09-13T13:00:00Z'), '1789304400 +0000');
    assert.equal(gitDateOf('2026-09-13T14:00:00-05:00'), '1789308000 -0500');
    assert.equal(gitDateOf('2026-09-13T12:00:00.123+08:00'), '1789300800 +0800');   // 毫秒忽略，偏移保留
    assert.equal(gitDateOf('not-a-date'), '0 +0000');                                // 异常输入不抛
    assert.equal(gitDateOf(''), '0 +0000');
  });

  test('[clone-history] commitEnvOf：作者与提交者字段齐全；提交者缺失时回退到作者', () => {
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

  test('[clone-history] DEFAULT_HISTORY_DEPTH：默认深度是有限正整数（大仓可控）', () => {
    assert.equal(Number.isInteger(DEFAULT_HISTORY_DEPTH), true);
    assert.equal(DEFAULT_HISTORY_DEPTH > 0, true);
    assert.equal(DEFAULT_HISTORY_DEPTH <= 200, true);
  });
}

// ── 原 test-clone-history-mode.mjs ──
{
  // clone-history-mode 单测：真实历史模式的编排（拉链 → 准备 → 重放 → 收尾）。
  //
  // 为什么值得覆盖：这一层是「用户按下『带历史克隆』」到「本地出现可推送的真实历史」之间唯一的编排点，
  //   任一环节漏调（例如忘了 prepare 就重放、或重放完没有 finish 把引用挂上）
  //   都会表现为「克隆成功但分支上没有历史」——函数却不报错。故此处断言编排顺序与最终引用。


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

  test('[clone-history-mode] resolveBranchHead：正常取 sha；非 200 时回报失败', async () => {
    const ok = await resolveBranchHead({ owner: 'o', repo: 'r', branch: 'master', deps: { githubFetch: fakeApi() } });
    assert.equal(ok.ok, true);
    assert.equal(ok.sha, 'c');

    const bad = await resolveBranchHead({ owner: 'o', repo: 'r', branch: 'master', deps: { githubFetch: fakeApi({ refStatus: 404 }) } });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /取分支 HEAD/);
  });

  test('[clone-history-mode] cloneWithHistory：完整流水线（拉链 → 准备 → 重放 → 收尾），引用指向重放结果', async () => {
    const { seen, runGit } = fakeGit();
    const refs = [];                       // 记录每次下载用的 ref，用于断言「按提交 sha 下载」
    const r = await cloneWithHistory({
      owner: 'o', repo: 'r', branch: 'master', repoPath: '/x', gitDir: '/x/.git',
      deps: {
        githubFetch: fakeApi({ headSha: 'b', trees: TREES, commits: COMMITS }),
        runGit,
        chmodOk: true, // 假 git 不需要真目录；固定走标准 init 分支（chmod 能力与断言无关）
        downloadBlobs: async (o2) => { refs.push(o2.branch); return { files: o2.blobs.length, failed: [], modePreserved: true }; },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    assert.equal(r.replayed, 2);
    assert.equal(r.headSha, 'LOCAL2');
    // 关键判据：下载 ref 必须是**正在重放的远端提交 sha**，而不是分支名——
    //   否则会拿到 HEAD 版本（长度不符 + 中间提交被写成 HEAD 的样子，sha 保真失效）
    assert.deepEqual(refs, ['a', 'b']);
    // 编排顺序：init/config/remote → 下载 → 提交 → 收尾挂引用
    assert.equal(seen[0], 'init -q');
    assert.equal(seen[1], 'config core.fileMode false');
    assert.equal(seen.includes('add -A -f'), true);   // -f：重建远端树时不遵守 .gitignore
    assert.deepEqual(seen.slice(-3), [
      'update-ref refs/heads/master LOCAL2',
      'update-ref refs/remotes/origin/master LOCAL2',
      'branch --set-upstream-to=origin/master master',
    ]);
  });

  test('[clone-history-mode] cloneWithHistory：取分支失败时立即返回，不碰仓库', async () => {
    const { seen, runGit } = fakeGit();
    const r = await cloneWithHistory({
      owner: 'o', repo: 'r', branch: 'master', repoPath: '/x', gitDir: '/x/.git',
      deps: { githubFetch: fakeApi({ refStatus: 404 }), runGit },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /取分支 HEAD/);
    assert.deepEqual(seen, []);                       // 未发生任何 git 动作
  });

  test('[clone-history-mode] cloneWithHistory：下载失败时中断并如实回报已重放条数', async () => {
    const { runGit } = fakeGit();
    let call = 0;
    const r = await cloneWithHistory({
      owner: 'o', repo: 'r', branch: 'master', repoPath: '/x', gitDir: '/x/.git',
      deps: {
        githubFetch: fakeApi({ headSha: 'b', trees: TREES, commits: COMMITS }),
        runGit,
        chmodOk: true, // 假 git 不需要真目录；固定走标准 init 分支（chmod 能力与断言无关）
        downloadBlobs: async () => { call += 1; return call === 2 ? { files: 0, failed: [{ path: 'f2', reason: 'HTTP 500' }], modePreserved: true } : { files: 1, failed: [], modePreserved: true }; },
      },
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /下载失败/);
    assert.equal(r.replayed, 1);
    assert.equal(r.count, 2);
  });

  test('[clone-history-mode] cloneWithHistory：depth 截断信息透传（大仓可控）', async () => {
    const r = await cloneWithHistory({
      owner: 'o', repo: 'r', branch: 'master', repoPath: '/x', gitDir: '/x/.git', depth: 1,
      deps: {
        githubFetch: fakeApi({ headSha: 'b', trees: TREES, commits: COMMITS }),
        runGit: fakeGit().runGit,
        chmodOk: true,
        downloadBlobs: async (o2) => ({ files: o2.blobs.length, failed: [], modePreserved: true }),
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    assert.equal(r.truncated, true);
  });
}

// ── 原 test-clone-history-defaults.mjs ──
{
  // 三入口「克隆默认带历史」一致性守卫（源码级断言，不联网、不启动宿主）
  //
  // 为什么需要：默认值反转后，「前端/工具/CLI 是否都带历史」只由三处独立代码维持 ——
  //   谁改了其中一处，另外两处不会红、界面也不会报错，行为却已经分叉。
  //   本用例把三处默认钉在一起，任何单点改动都会立刻暴露。
  //
  // 说明：这里读源码做断言（而非跑整条克隆链），因为克隆链要联网且耗时；
  //   源码级断言足以挡住「单点改成默认关」这类真实回归，行为本身另由真仓库 e2e 覆盖。

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

  test('[clone-history-defaults] agent 工具入口：未传 history 时按 true 处理，且显式关闭仍生效', () => {
    const s = read('lib/app/tool-call.js');
    assert.match(s, /args\.history === undefined \? true/, '工具入口的 history 默认应为 true');
    assert.match(s, /'false'/, '工具入口应仍支持显式传 false/0 关闭（退回整树快照）');
  });

  test('[clone-history-defaults] HTTP/侧边栏入口：请求体未带 history 时按 true 处理，且显式关闭仍生效', () => {
    const s = read('lib/app/handlers/clone.js');
    assert.match(s, /body\?\.history === undefined \? true/, 'HTTP 入口的 history 默认应为 true');
    assert.match(s, /'false'/, 'HTTP 入口应仍支持显式传 false/0 关闭');
  });

  test('[clone-history-defaults] CLI/工具 schema：history 参数声明默认 true，并说明可传 false 退回快照', () => {
    const s = read('lib/app/command-registry.js');
    assert.match(s, /flag: 'history', type: 'boolean', default: true/, 'schema 里 history 的默认应为 true');
    assert.match(s, /传 false 退回整树快照/, 'schema 的说明应写明可退回整树快照');
  });

  test('[clone-history-defaults] 底层 cloneViaApi 保持显式默认（入口层才反转默认，内核不动）', () => {
    const s = read('lib/git/clone.js');
    assert.match(s, /history = false/, 'cloneViaApi 的 history 默认应仍为 false（由入口层显式传值）');
  });

  test('[clone-history-defaults] 三入口一致：两处入口 + schema 都在讲「默认带历史」', () => {
    const a = read('lib/app/tool-call.js');
    const b = read('lib/app/handlers/clone.js');
    const c = read('lib/app/command-registry.js');
    assert.match(a, /真实历史/, '工具入口应注释说明默认带真实历史');
    assert.match(b, /真实历史/, 'HTTP 入口应注释说明默认带真实历史');
    assert.match(c, /真实历史/, 'schema 说明应含「真实历史」字样');
  });
}
