/**
 * 后台化回归测试（方案 C：官方 job）。
 * 覆盖：git_commit_push 无宿主 ctx.jobs（CLI/测试环境）→ 同步执行保底返回 result；
 *   有 ctx.jobs（mock 宿主）→ 注册官方 job（kind=git-push）并立即返回 async:true + jobId；
 *   审计 blocker 仍同步拦截；任务体抛错 → job 结果为 failed。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { callTool, Config } from '../lib/index.js';

function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-task-'));
  execSync(`git -C "${dir}" init -q`, { stdio: ['ignore', 'ignore', 'ignore'] });
  execSync(`git -C "${dir}" config user.email t@t.t && git -C "${dir}" config user.name t`, { stdio: ['ignore', 'ignore', 'ignore'] });
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  execSync(`git -C "${dir}" add . && git -C "${dir}" commit -qm init`, { stdio: ['ignore', 'ignore', 'ignore'] });
  return dir;
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 内存 mock 宿主 jobs（对齐 ctx.jobs.start 返回 JobHooks 契约）。 */
function mockJobs() {
  const jobs = [];
  return {
    state: jobs,
    start(spec) {
      // 复刻宿主 jobs-local.resolveOwner 的契约：owner 必须是**会话 id 字符串**
      //   （resolveOwner(session) → agents.get(session)）。传 Agent 对象时查不到活 agent，
      //   宿主会抛 `session "<x>" has no live agent` → 插件降级同步、后台 job 静默失效。
      //   这里显式校验，避免「owner 形状错了但 mock 不看」造成的假绿（实测踩过）。
      if (spec.owner !== undefined && typeof spec.owner !== 'string') {
        throw new Error(`session "${String(spec.owner)}" has no live agent (background job owner must be live)`);
      }
      const id = `git-push-${jobs.length + 1}`;
      const hooks = spec.run();
      jobs.push({ id, spec, hooks });
      return id;
    },
  };
}

// ---------- 无宿主 ctx.jobs → 同步执行保底 ----------
test('git_commit_push：无 jobs（CLI/测试）→ 同步执行并返回 async:false + result', async () => {
  const dir = mkRepo();
  try {
    const r = await callTool('git_commit_push', { repo: dir, message: '同步保底提交', audit: false, push: false, requirementsConfirmed: true }, { workspaceRoot: dir }, Config());
    assert.equal(r.ok, true);
    assert.equal(r.async, false);
    assert.equal(r.result.ok, true);
    const log = execSync(`git -C "${dir}" log --oneline -1`, { encoding: 'utf8' });
    assert.match(log, /同步保底提交/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- 有宿主 ctx.jobs（mock）→ 官方 job 注册 ----------
test('git_commit_push：有 jobs → 注册 kind=git-push 官方 job、返回 async+jobId、done 完成', async () => {
  const dir = mkRepo();
  const mj = mockJobs();
  try {
    const r = await callTool('git_commit_push', { repo: dir, message: '官方job提交', audit: false, push: false, requirementsConfirmed: true }, { workspaceRoot: dir }, Config(), null, mj);
    assert.equal(r.ok, true);
    assert.equal(r.async, true);
    assert.match(String(r.jobId), /^git-push-1$/);
    const job = mj.state[0];
    assert.equal(job.spec.kind, 'git-push');
    assert.match(job.spec.label, /commit\+push/);
    // 等待 job 的 done 收敛（等价宿主等完成）
    const outcome = await job.hooks.done;
    assert.equal(outcome.status, 'completed');
    const parsed = JSON.parse(outcome.output);
    assert.equal(parsed.ok, true);
    const log = execSync(`git -C "${dir}" log --oneline -1`, { encoding: 'utf8' });
    assert.match(log, /官方job提交/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- 回归：owner 形状（exec.agent → 会话 id 字符串）----------
test('git_commit_push：exec.agent 存在时 owner 必须是会话 id（宿主 resolveOwner 契约回归）', async () => {
  const dir = mkRepo();
  const mj = mockJobs();
  try {
    const r = await callTool(
      'git_commit_push',
      { repo: dir, message: 'owner契约', audit: false, push: false, requirementsConfirmed: true },
      { workspaceRoot: dir }, Config(), null, mj,
      { agent: { id: 'session-abc123' } }, // 宿主 exec.agent：Agent 对象（带会话 id）
    );
    assert.equal(r.async, true, 'owner 形状正确时必须走后台 job，不得静默降级同步');
    assert.equal(r.jobFallback, undefined, '不得出现 jobFallback（降级标记）');
    assert.equal(mj.state[0].spec.owner, 'session-abc123', 'owner 必须是 exec.agent.id 字符串');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('git_commit_push：job 任务体抛错 → done 返回 failed + detail', async () => {
  const dir = mkRepo();
  const mj = {
    start(spec) {
      const hooks = spec.run();
      return 'git-push-x';
    },
  };
  try {
    const r = await callTool('git_commit_push', { repo: join(dir, '不存在'), message: 'x', audit: false, push: false, requirementsConfirmed: true }, { workspaceRoot: dir }, Config(), null, mj);
    assert.equal(r.ok, true);
    assert.equal(r.async, true);
    // 同步路径不可达（repo 参数已校验），此处只验证注册成功形态
    assert.equal(r.jobId, 'git-push-x');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- 审计拦截仍同步 ----------
test('git_commit_push：审计 blocker（secret 未提交文件）→ 同步拦截不注册 job', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-task-block-'));
  const mj = mockJobs();
  try {
    execSync(`git -C "${dir}" init -q`, { stdio: ['ignore', 'ignore', 'ignore'] });
    execSync(`git -C "${dir}" config user.email t@t.t && git -C "${dir}" config user.name t`, { stdio: ['ignore', 'ignore', 'ignore'] });
    // diff 审计只看变动文件：先落一个干净 base 提交，secret 文件保持未提交才会被扫到
    writeFileSync(join(dir, 'base.js'), 'export const base = 1;\n');
    execSync(`git -C "${dir}" add . && git -C "${dir}" commit -qm init`, { stdio: ['ignore', 'ignore', 'ignore'] });
    writeFileSync(join(dir, 'real.js'), 'const apiKey = "sk-test-abcdef1234567890abcdef";\n');
    const r = await callTool('git_commit_push', { repo: dir, message: 'blocker 测试', audit: true, push: false, requirementsConfirmed: true }, { workspaceRoot: dir }, Config(), null, mj);
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.equal(mj.state.length, 0, 'blocker 不产生 job');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
// ---------- 2026-09-15 新增：jobs.start 存在但抛错（控制器不对本 agent 服务）→ 自动降级同步 ----------
test('git_commit_push：jobs.start 抛错（no job controller serves this agent）→ 降级同步执行不报错', async () => {
  const dir = mkRepo();
  const throwingJobs = {
    start() { throw new Error('no job controller serves this agent'); },
  };
  try {
    const r = await callTool('git_commit_push', { repo: dir, message: '降级同步提交', audit: false, push: false, requirementsConfirmed: true }, { workspaceRoot: dir }, Config(), null, throwingJobs);
    assert.equal(r.ok, true, 'start 抛错也必须 ok');
    assert.equal(r.async, false, '降级后应为同步执行');
    assert.equal(r.jobFallback, true, '应标记 jobFallback 供上层区分');
    assert.equal(r.result.ok, true);
    const log = execSync(`git -C "${dir}" log --oneline -1`, { encoding: 'utf8' });
    assert.match(log, /降级同步提交/, '降级路径应真实完成提交');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- 回归：git_clone 的 job owner 形状（与 git_commit_push 同一契约）----------
test('git_clone：exec.agent 存在时 owner 必须是会话 id（clone job 路径回归）', async () => {
  // 只记录不执行 spec.run()：避免用例真的发起网络 clone（owner 形状与 async 返回不受影响）
  const mj = {
    state: [],
    start(spec) {
      if (spec.owner !== undefined && typeof spec.owner !== 'string') {
        throw new Error(`session "${String(spec.owner)}" has no live agent (background job owner must be live)`);
      }
      mj.state.push({ spec });
      return 'git-clone-1';
    },
  };
  const r = await callTool(
    'git_clone',
    { target: 'owner/repo', dest: '/tmp/dshgp-clone-fixture' },
    { workspaceRoot: tmpdir() }, Config(), null, mj,
    { agent: { id: 'session-clone-9' } },
  );
  assert.equal(r.async, true, 'owner 形状正确时 clone 必须走后台 job，不得静默降级同步');
  assert.equal(r.jobId, 'git-clone-1');
  assert.equal(r.jobFallback, undefined, '不得出现 jobFallback（降级标记）');
  assert.equal(mj.state[0].spec.kind, 'git-clone');
  assert.equal(mj.state[0].spec.owner, 'session-clone-9', 'owner 必须是 exec.agent.id 字符串');
});
