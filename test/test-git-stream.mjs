/**
 * 流式 git 执行（runGitStream）与 fetch 停摆判据的回归测试。
 *
 * 背景：runGit 是 execFileSync + 死超时（默认 120s），大仓库 `git fetch` 要跑十几分钟
 *   但一直在正常下载，固定超时必然半途而废（实测 6.9GB / 7374 文件的仓库报 ETIMEDOUT）。
 *   runGitStream 改成「只判有没有进展」：只要有输出就把看门狗往后推，
 *   连续 stallLimit 完全无输出才结束进程；已下载对象留在 .git 里，重试即续传。
 *
 * 本文件锁四件事：
 *   ① 正常命令：ok + stdout + ms，且 stalled=false；
 *   ② 真失败（git 自己报错）：ok=false 且 **stalled=false** —— 不能把仓库/网络错误说成停摆；
 *   ③ 进度回调抛错不能影响执行（回调来自调用方，抛错会变成 data 事件的未捕获异常，
 *      常驻宿主进程会被一个进度回调带走）；
 *   ④ 消费方文案分流：stalled ⇒ 「停摆/可重试续传」，否则 ⇒ 「失败」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runGitStream } from '../lib/core/exec.js';
import { cloneWithGitFetch } from '../lib/git/clone-history-mode.js';

test('runGitStream：正常命令 → ok，stalled=false，带耗时与 stdout', async () => {
  const r = await runGitStream(['--version']);
  assert.equal(r.ok, true, `git --version 应成功：${r.stderr}`);
  assert.equal(r.stalled, false);
  assert.match(r.stdout, /git version/i);
  assert.ok(r.ms >= 0, 'ms 应为非负数');
});

test('runGitStream：git 自身报错 → ok=false 且 stalled=false（不能误报成停摆）', async () => {
  const r = await runGitStream(['rev-parse', '--verify', 'definitely-not-a-ref-xyz']);
  assert.equal(r.ok, false);
  assert.equal(r.stalled, false, '这是 git 报错，不是停摆');
  assert.ok(r.stderr.length > 0, '失败时必须带回 stderr 供排错');
});

test('runGitStream：进度回调抛错不影响执行（不得把宿主进程带走）', async () => {
  const r = await runGitStream(['--version'], {
    onProgress: () => { throw new Error('回调故意抛错'); },
  });
  assert.equal(r.ok, true, '回调异常必须被吞掉，命令本身照常成功');
  assert.match(r.stdout, /git version/i);
});

test('runGitStream：进度回调按行收到 stderr 输出', async () => {
  const lines = [];
  // 让 git 往 stderr 写内容：--version 走 stdout，故用一条会告警的命令
  const r = await runGitStream(['rev-parse', '--verify', 'no-such-ref'], {
    onProgress: (l) => lines.push(l),
  });
  assert.equal(r.ok, false);
  assert.ok(lines.length > 0, '失败信息应以进度行形式回调，便于上层实时展示');
});

test('runGitStream：stallLimit 环境变量可放宽阈值（不影响正常命令）', async () => {
  process.env.DSH_GIT_FETCH_STALL_MS = '1000';
  try {
    const r = await runGitStream(['--version']);
    assert.equal(r.ok, true, '阈值只影响停摆判定，不应影响正常执行');
  } finally { delete process.env.DSH_GIT_FETCH_STALL_MS; }
});

/** 在临时目录跑 cloneWithGitFetch，deps 全注入（不碰网络、不依赖真实 git 权限）。 */
async function runFetchCase(streamResult) {
  const dir = mkdtempSync(join(tmpdir(), 'gitstream-'));
  try {
    return await cloneWithGitFetch({
      owner: 'octocat', repo: 'Hello-World', branch: 'main', repoPath: dir,
      depth: 1,
      deps: {
        visibility: 'public',          // 跳过网络可见性探测
        chmodOk: false,                // 强制走手工 .git 降级，避开 CIFS/chmod 差异
        sshKeyPath: '',
        runGit: () => ({ ok: true, stdout: 'deadbeef', stderr: '' }),
        runGitStream: async () => streamResult,
      },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('cloneWithGitFetch：fetch 停摆 → 文案说明可重试续传，且 steps 标记 stalled', async () => {
  const r = await runFetchCase({ ok: false, stalled: true, stderr: '连续 300s 无任何进展', ms: 300100 });
  assert.equal(r.ok, false);
  assert.match(r.error, /停摆/, `应为停摆文案，实际：${r.error}`);
  assert.match(r.error, /续传/, '必须告诉调用方可重试续传（已下载部分不丢）');
  const step = r.steps.find((s) => s.stalled === true);
  assert.ok(step, 'steps 里该记录 stalled=true，便于事后判定是停摆而非仓库错误');
  assert.equal(step.ms, 300100, 'steps 应记录耗时');
});

test('cloneWithGitFetch：停摆但上游 stderr 为空 → 消费方仍给出续传提示', async () => {
  // 上游换了实现/文案时，这条保证「已下载部分不丢」不会从提示里消失
  const r = await runFetchCase({ ok: false, stalled: true, stderr: '', ms: 300000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /停摆/);
  assert.match(r.error, /续传/, 'stderr 为空时也必须带续传提示');
});

test('cloneWithGitFetch：fetch 真失败 → 仍走「失败」文案（不能混成停摆）', async () => {
  const r = await runFetchCase({ ok: false, stalled: false, stderr: 'Could not resolve host', ms: 1200 });
  assert.equal(r.ok, false);
  assert.match(r.error, /git fetch 失败/);
  assert.doesNotMatch(r.error, /停摆/, '真网络/仓库错误不能报成停摆');
});

test('cloneWithGitFetch：fetch 成功 → 不新增失败分支，steps 记录 lastProgress', async () => {
  const r = await runFetchCase({ ok: true, stdout: '', stderr: '', stalled: false, ms: 8000 });
  // 成功时后续要读 rev-parse 的 sha（runGit mock 给 deadbeef），应拿到 headSha
  assert.equal(r.ok, true, `fetch 成功后应继续建分支，实际错误：${r.error}`);
  assert.equal(r.headSha, 'deadbeef');
  const step = r.steps.find((s) => String(s.cmd || '').includes('fetch'));
  assert.ok(step && step.ok, 'steps 应记录 fetch 成功');
});
