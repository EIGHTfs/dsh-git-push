// 设置侧边栏「读改写」回归：真 handler（handleHttp）+ 隔离 DSH_HOME 的读-写-读闭环。
//
// 为什么这么测：设置侧边栏的数据与写入全走 HTTP（settings-get / settings-set / account-status），
//   不走 client scope 快照（反代访问时 scope 恒 memory 的陷阱，见 lib/client.js 注释）。
//   所以「前端能不能读对、写完能不能读回来」必须用**真 handler**闭环验证，而不是 mock。
// 隔离：临时 DSH_HOME（credentialsDir / 设置落盘都在它下面），测后清理，不污染真实配置。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SANDBOX = mkdtempSync(join(tmpdir(), 'dshgp-rw-'));
process.env.DSH_HOME = join(SANDBOX, '.dsh');

const { handleHttp } = await import('../lib/app/http-handlers.js');
const { defaultConfig } = await import('../lib/client/index.js');

const cfg = { ...defaultConfig() };
const env = { workspaceRoot: SANDBOX, cfg };
// 真请求形状：handleHttp 读 req.url / req.method / req.origin / req.headers / req.body（见 http-handlers.js:75）
//   —— 写方法必须带同源 Origin（防 CSRF，缺了会被 403 NO_ORIGIN 拒绝），这里模拟真浏览器请求。
const ORIGIN = 'http://127.0.0.1:30801';
const call = (method, url, body) => handleHttp({ method, url, origin: ORIGIN, headers: { host: '127.0.0.1:30801' }, body }, env, cfg);

after(() => rmSync(SANDBOX, { recursive: true, force: true }));

test('设置项：读 → 写 → 回读（读改写闭环）', async () => {
  const r1 = await call('GET', '/api/git-push/settings-get');
  assert.equal(r1.status, 200, '读设置应 200');
  assert.ok(r1.body.settings && typeof r1.body.settings === 'object', '返回应带 settings 对象');

  const next = r1.body.settings.pushGate !== true; // 与当前相反，确保「写」有可观察变化
  const r2 = await call('POST', '/api/git-push/settings-set', { key: 'pushGate', value: next });
  assert.equal(r2.status, 200, `写设置应 200（实得 ${JSON.stringify(r2.body).slice(0, 120)}）`);

  const r3 = await call('GET', '/api/git-push/settings-get');
  assert.equal(r3.body.settings.pushGate, next, '回读应等于刚写入的值（读改写闭环）');
});

test('规则槽位：读 → 改 disabled 列表 → 回读（读改写闭环）', async () => {
  const r1 = await call('GET', '/api/git-push/rule-slots');
  assert.equal(r1.status, 200, '读槽位应 200');
  const slots = r1.body.slots;
  // 真形状：slots 是对象 { discovered: [...], ... }（见 handlers/meta.js），不是数组
  const discovered = Array.isArray(slots?.discovered) ? slots.discovered : [];
  assert.ok(discovered.length > 0, '应有已发现的槽位列表（slots.discovered）');

  const name = discovered[0];
  const r2 = await call('POST', '/api/git-push/settings-set', { key: 'auditDisabledSlots', value: [name] });
  assert.equal(r2.status, 200, '写 disabled 列表应 200');

  const r3 = await call('GET', '/api/git-push/settings-get');
  const disabled = r3.body.settings.auditDisabledSlots || [];
  assert.ok(Array.isArray(disabled) && disabled.includes(name), `回读的禁用列表应含 ${name}`);
});

test('账号快照：读 → 写（校验结果落盘）→ 回读（读改写闭环，不打网络）', async () => {
  const r1 = await call('GET', '/api/git-push/account-status');
  assert.equal(r1.status, 200, '读账号状态应 200（离线读）');

  // 走真实落盘入口（与推送顺带校验同一条路径），不触发网络
  const { writeAccountStatusFromResult } = await import('../lib/git/account-status.js');
  const wr = writeAccountStatusFromResult({
    username: 'RW-TEST', loggedIn: true,
    tokenStatus: { valid: true, login: 'RW-TEST', checked: true },
    sshStatus: { valid: false, login: '', checked: false },
  }, {});
  assert.equal(wr.ok, true, '写快照应成功');

  const r2 = await call('GET', '/api/git-push/account-status');
  assert.equal(r2.status, 200, '回读应 200');
  assert.equal(r2.body.username, 'RW-TEST', '回读应看到刚写入的登录名');
  // 断言快照字段（不查 block：沙箱里没有真实 token 文件，block 会如实显示「未配置」）
  assert.equal(r2.body.tokenStatus?.login, 'RW-TEST', '回读的 token 登录名应是刚写入的');
  assert.equal(r2.body.tokenStatus?.valid, true, '回读的 token 有效性应是刚写入的');
});
