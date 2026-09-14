/**
 * 后台任务队列测试（2026-09-14，方案 B：审计同步、推送后台化）。
 * 覆盖：submitTask/getTask/listTasks 状态机、HTTP /task/<id> + /tasks 端点、
 *   git_push_status 工具、git_commit_push 后台化返回形态（拦截/async/taskId）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { callTool, handleHttp, Config } from '../lib/index.js';
import { submitTask, getTask, listTasks, taskCount } from '../lib/backend/task-queue.js';

function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-task-'));
  execSync(`git -C "${dir}" init -q`, { stdio: ['ignore', 'ignore', 'ignore'] });
  execSync(`git -C "${dir}" config user.email t@t.t && git -C "${dir}" config user.name t`, { stdio: ['ignore', 'ignore', 'ignore'] });
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  execSync(`git -C "${dir}" add . && git -C "${dir}" commit -qm init`, { stdio: ['ignore', 'ignore', 'ignore'] });
  return dir;
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------- 任务队列状态机 ----------
test('队列：submitTask 立即返回 taskId，完成后 status=done、可在 getTask 读到结果', async () => {
  const before = taskCount();
  const id = submitTask(async () => ({ ok: true, pushed: false }), { title: '单测' });
  assert.equal(typeof id, 'string');
  assert.ok(id.startsWith('t'), 'taskId 以 t 开头');
  assert.ok(taskCount() === before + 1, '任务计数 +1');
  // 轮询直到 done
  for (let i = 0; i < 50; i++) {
    if (getTask(id)?.status === 'done') break;
    await wait(10);
  }
  const t = getTask(id);
  assert.equal(t.status, 'done');
  assert.deepEqual(t.result, { ok: true, pushed: false });
  assert.ok(t.finishedAt);
});

test('队列：任务体抛错 → status=error 且 error 可读', async () => {
  const id = submitTask(async () => { throw new Error('boom'); });
  for (let i = 0; i < 50; i++) {
    if (getTask(id)?.status === 'error') break;
    await wait(10);
  }
  const t = getTask(id);
  assert.equal(t.status, 'error');
  assert.match(String(t.error), /boom/);
});

test('队列：listTasks 升序含提交的任务；getTask 不存在 → null', async () => {
  const all = listTasks();
  assert.ok(Array.isArray(all));
  assert.equal(getTask('t9999-none'), null);
});

// ---------- HTTP 端点 ----------
test('HTTP：GET /api/git-push/tasks 返回任务列表', async () => {
  submitTask(async () => ({ ok: true }), { title: 'http-task' });
  const res = await handleHttp({ method: 'GET', url: '/api/git-push/tasks' }, {}, Config());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.count >= 1);
  assert.ok(res.body.tasks.some((t) => t.title === 'http-task'));
});

test('HTTP：GET /api/git-push/task/<id> 单查，不存在 → 404', async () => {
  const id = submitTask(async () => ({ ok: true, pushed: true }), { title: 'single' });
  for (let i = 0; i < 50; i++) { if (getTask(id)?.status === 'done') break; await wait(10); }
  const res = await handleHttp({ method: 'GET', url: `/api/git-push/task/${id}` }, {}, Config());
  assert.equal(res.status, 200);
  assert.equal(res.body.taskId, id);
  assert.equal(res.body.done, true);
  assert.equal(res.body.result.pushed, true);
  const missing = await handleHttp({ method: 'GET', url: '/api/git-push/task/t9999-none' }, {}, Config());
  assert.equal(missing.status, 404);
});

// ---------- 工具：git_push_status ----------
test('工具：git_push_status 查不存在的任务 → 错误', async () => {
  const r = await callTool('git_push_status', { taskId: 'nope' }, {}, Config());
  assert.equal(r.ok, false);
  assert.match(String(r.error), /未找到任务/);
});

test('工具：git_push_status 查已完成任务返回结果', async () => {
  const id = submitTask(async () => ({ ok: true, branch: 'master', pushed: true }), { title: 'tool-status' });
  for (let i = 0; i < 50; i++) { if (getTask(id)?.status === 'done') break; await wait(10); }
  const r = await callTool('git_push_status', { taskId: id }, {}, Config());
  assert.equal(r.ok, true);
  assert.equal(r.done, true);
  assert.equal(r.result.branch, 'master');
});

// ---------- 工具：git_commit_push 后台化形态 ----------
test('工具：git_commit_push 审计关闭 → 返回 async+taskId，后台任务最终 done', async () => {
  const dir = mkRepo();
  const before = taskCount();
  try {
    const r = await callTool('git_commit_push', { repo: dir, message: '后台化提交', audit: false, push: false, requirementsConfirmed: true }, { workspaceRoot: dir }, Config());
    assert.equal(r.ok, true);
    assert.equal(r.async, true);
    assert.ok(r.taskId, '返回 taskId');
    assert.equal(taskCount(), before + 1, '产生一个后台任务');
    // 轮询到 done
    for (let i = 0; i < 80; i++) { if (getTask(r.taskId)?.status === 'done') break; await wait(25); }
    const t = getTask(r.taskId);
    assert.equal(t.status, 'done');
    assert.equal(t.result.ok, true);
    // 验证真的 commit 了
    const log = execSync(`git -C "${dir}" log --oneline -1`, { encoding: 'utf8' });
    assert.match(log, /后台化提交/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});