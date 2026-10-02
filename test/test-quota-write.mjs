// 配额写快照「统一收口」回归：新装环境（无 account-status.json）也必须落盘并回 statusUpdated。
//
// 隔离方式：临时 DSH_HOME —— credentialsDir 在**调用时**读 process.env.DSH_HOME（优先级最高），
//   故整条写入链路落在临时目录，不污染真实插件数据目录（此前手工实测曾误写真实文件，故这里固化隔离）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 先设隔离 HOME，再动态 import 业务模块（双保险：即便模块在导入期解析目录也已是沙箱）
const SANDBOX = mkdtempSync(join(tmpdir(), 'dshgp-quota-'));
process.env.DSH_HOME = join(SANDBOX, '.dsh');

const { updateAccountStatusQuota, readAccountStatus, accountStatusFile } = await import('../lib/git/account-status.js');

// 配额样本：core 通道为主（Token 行后缀取 core.remaining）
const QUOTA = {
  core: { limit: 5000, remaining: 4321, resetAt: '2026-10-02T01:00:00Z' },
  checkedAt: '2026-10-02T00:00:00Z',
};

// 用例结束后删沙箱（避免临时目录堆积；写入的文件都在沙箱内）
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

// 用例 1：模拟「新装环境第一次查配额」——此前这里直接返回 ok:false 且调用方忽略返回值，
//   结果配额永远不落盘（用户看到的就是「查了但配置里没有」），故断言「必须真的落盘」。
test('配额收口：状态文件不存在时按空底稿创建并落盘（不再静默丢写）', () => {
  const file = accountStatusFile({});
  assert.equal(existsSync(file), false, '前置：隔离环境下状态文件应不存在');
  const wr = updateAccountStatusQuota(QUOTA, {});
  assert.equal(wr.ok, true, '写入必须成功（此前直接返回 ok:false 被调用方忽略）');
  assert.equal(wr.statusUpdated, true, '必须回 statusUpdated 供 UI 按标志重读');
  assert.equal(wr.created, true, '应标记本次为新建（此前不存在）');
  assert.equal(existsSync(file), true, '文件必须真的落盘');
  const back = readAccountStatus({});
  assert.equal(back?.apiQuota?.core?.remaining, 4321, '回读应拿到本次配额');
  assert.equal(back?.token?.valid, false, '空底稿的 token 应标未校验（不伪造「已失效」）');
});

test('配额收口：已存在的状态文件只覆盖 apiQuota（token/ssh 等字段保留）', () => {
  const wr = updateAccountStatusQuota({ ...QUOTA, core: { limit: 5000, remaining: 4000 } }, {});
  assert.equal(wr.created, false, '文件已存在 → created=false');
  const back = readAccountStatus({});
  assert.equal(back?.apiQuota?.core?.remaining, 4000, 'apiQuota 应被本次覆盖');
  assert.equal(back?.username, '', '其它字段保持不动');
});

test('配额收口：apiQuota=null 也如实落盘，且 ok/statusUpdated 一致', () => {
  const wr = updateAccountStatusQuota(null, {});
  assert.equal(wr.ok, true, 'null 配额不是失败');
  assert.equal(wr.statusUpdated, true, 'UI 仍需据此重读（后缀消失）');
  assert.equal(readAccountStatus({})?.apiQuota, null, 'null 要落盘，避免残留旧配额');
});
