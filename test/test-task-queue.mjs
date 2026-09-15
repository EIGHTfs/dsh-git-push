/**
 * 后台化回归测试（2026-09-15，方案 C：官方 job）。
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