// 工具层端到端测试（学习第 2 条：借外部项目 dsh-normify 的「stub ctx + 驱动真工具」测法）。
//
// 为什么单独一层：我们此前的测试多停在「模块/handler 层」——直接 import 某个函数断言。
//   但真正被宿主暴露、被 AI 调用的是**工具**（callTool 入口），它有自己的一层契约：
//   参数形状、返回值形状、错误路径是否优雅（返回 {ok:false,error} 而不是抛异常）。
//   本文件用最小 env/cfg 直接驱动真工具，覆盖「读类工具」的端到端行为。
//
// 隔离：全部在临时目录里造 fixture（临时 git 仓库 / md / js），不触碰真实工作区。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { callTool } from '../lib/app/tool-call.js';
import { defaultConfig } from '../lib/client/index.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'dshgp-tools-e2e-'));
const cfg = defaultConfig();
const env = { workspaceRoot: SANDBOX };

after(() => rmSync(SANDBOX, { recursive: true, force: true }));

/** 造一个真实 git 仓库（工具会真的跑 git 命令，不 mock）。 */
function makeRepo(name) {
  const dir = join(SANDBOX, name);
  mkdirSync(dir, { recursive: true });
  execSync('git init -q && git config user.email t@t.local && git config user.name t && echo x > a.txt && git add -A && git commit -qm init',
    { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('工具层：git_scan 返回仓库清单与计数（真实扫描临时仓库）', async () => {
  const repo = makeRepo('repo-scan');
  const r = await callTool('git_scan', { root: SANDBOX }, env, cfg);
  assert.equal(r.ok, true, `git_scan 应成功：${JSON.stringify(r).slice(0, 200)}`);
  assert.equal(typeof r.count, 'number');
  assert.ok(Array.isArray(r.repos), 'repos 应为数组');
  assert.ok(r.repos.some((x) => x.path === repo || String(x.path).includes('repo-scan')),
    `扫描结果应包含刚造的仓库（实得 ${JSON.stringify(r.repos.map((x) => x.name))}）`);
});

test('工具层：git_cred_env 只回路径与命令串，不回明文凭据', async () => {
  const r = await callTool('git_cred_env', {}, env, cfg);
  assert.equal(r.ok, true, `git_cred_env 应成功：${JSON.stringify(r).slice(0, 200)}`);
  assert.ok(Array.isArray(r.provided), 'provided 应为数组');
  // 契约：返回的是 envPrefix（含路径/命令），不能出现 token 明文形态
  const text = JSON.stringify(r);
  assert.ok(!/gh[pousr]_[A-Za-z0-9]{20,}/.test(text), 'git_cred_env 不得回传 token 明文');
});

test('工具层：code_audit 能对临时仓库出结果（含 summary 与 quality）', async () => {
  const repo = makeRepo('repo-audit');
  const r = await callTool('code_audit', { repo, scope: 'full' }, env, cfg);
  // 审计可能因仓库极小而无文件可审（emptyResult），但**不得抛异常**，且形状必须是审计结果
  assert.equal(r.ok, true, `code_audit 应优雅返回：${JSON.stringify(r).slice(0, 200)}`);
  assert.ok(r.summary && typeof r.summary.blocker === 'number', '应带 summary.blocker');
  assert.ok('quality' in r, '应带 quality 字段（无文件时可为空结果）');
});

test('工具层：io_scan 返回分级结果（items + byRisk）', async () => {
  const repo = makeRepo('repo-io');
  writeFileSync(join(repo, 'a.js'), "const fs = require('fs');\nfs.readFileSync('x');\n");
  const r = await callTool('io_scan', { repo }, env, cfg);
  assert.equal(r.ok, true, `io_scan 应成功：${JSON.stringify(r).slice(0, 200)}`);
  // 真实形状（实测）：{ ok, root, total, sync, byRisk, items }
  assert.ok(Array.isArray(r.items), `io_scan 应返回 items 数组（实得 keys: ${Object.keys(r).join(',')}）`);
  assert.equal(typeof r.total, 'number', '应带 total');
  assert.ok(r.byRisk && typeof r.byRisk === 'object', '应带 byRisk 分级统计');
  assert.ok(r.items.some((x) => x.call || x.line), 'items 每项应含调用名或行号');
});

test('工具层：错误路径优雅（缺参不抛异常，返回 ok:false + error）', async () => {
  // 这些工具缺必填参数时应返回 {ok:false, error} 而不是 throw
  for (const [name, args] of [
    ['git_commit_push', {}],      // 缺 repo/message
    ['git_remote_create', {}],    // 缺 repo
    ['git_clone', {}],            // 缺 target
  ]) {
    const r = await callTool(name, args, env, cfg);
    assert.equal(r.ok, false, `${name} 缺参应返回 ok:false，实得 ${JSON.stringify(r).slice(0, 120)}`);
    assert.ok(r.error, `${name} 应给出 error 说明`);
  }
});
