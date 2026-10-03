// 账号校验时机回归：**提交/推送成功时顺带校验并刷新 account-status.json**。
//
// 设计原文（lib/git/account-status.js 头部）：
//   「写入时机：每次推送/提交验证账号时刷新；设置侧边栏打开时读取」
// 现场背景：界面「校验于 2026-10-02 22:15」长期不动，被怀疑改坏——实测结论是**符合设计**：
//   此后没有成功的推送（本地提交未推送 + 工作区被清空），而页面打开只做**离线读**、不触发在线校验。
//   本测试锁两件事：① 由校验结果写快照会刷新 checkedAt ② 推送成功路径确实接了这次刷新。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// 隔离：临时 DSH_HOME（credentialsDir 调用时读该 env），不污染真实插件数据目录
const SANDBOX = mkdtempSync(join(tmpdir(), 'dshgp-acct-refresh-'));
process.env.DSH_HOME = join(SANDBOX, '.dsh');

const { writeAccountStatusFromResult, readAccountStatus } = await import('../lib/git/account-status.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

after(() => rmSync(SANDBOX, { recursive: true, force: true }));

test('账号快照写入：由校验结果写盘会刷新 checkedAt（推送顺带校验的落点）', () => {
  const before = readAccountStatus({});
  assert.equal(before, null, '前置：隔离环境应无快照');

  const fakeInfo = {
    username: 'EIGHTfs', loggedIn: true,
    tokenStatus: { valid: true, login: 'EIGHTfs', checked: true },
    sshStatus: { valid: true, login: 'EIGHTfs', checked: true },
    apiQuota: null,
  };
  const wr = writeAccountStatusFromResult(fakeInfo, {});
  assert.equal(wr.ok, true, '写入应成功');
  assert.equal(wr.statusUpdated, true, '应回 statusUpdated 供 UI 重读');

  const snap = readAccountStatus({});
  assert.ok(snap, '回读应拿到快照');
  assert.ok(snap.token.checkedAt, 'token.checkedAt 必须有值（界面「校验于」的来源）');
  const ageMs = Date.now() - Date.parse(snap.token.checkedAt);
  assert.ok(Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 60_000,
    `checkedAt 应是刚刚（实得 ${snap.token.checkedAt}）`);
  assert.equal(snap.token.valid, true);
  assert.equal(snap.username, 'EIGHTfs');
});

test('结构契约：推送成功路径必须接账号刷新（设计：推送顺带校验）', () => {
  const src = readFileSync(join(ROOT, 'lib/app/tool-call.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function pushWithPostSteps'), src.indexOf('/** 构造宿主后台 job spec'));
  assert.match(fn, /refreshAccountStatus\(/, 'pushWithPostSteps 内必须调用 refreshAccountStatus');
  assert.match(fn, /推送成功/, '应有说明「推送成功顺带刷新」的注释，防未来被摘掉');

  const handlers = readFileSync(join(ROOT, 'lib/app/handlers/repo-actions.js'), 'utf8');
  assert.match(handlers, /refreshAccountStatus\(/, '侧边栏推送入口同样要接账号刷新');
});
