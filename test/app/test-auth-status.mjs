// 认证数据面：/account-status 暴露凭据来源三态（none / pat / device-flow），
// 并把「三种状态下 /status 与 /settings-get 都不含 token 明文」这条安全边界锁住。
//
// 为什么专门写这一组：来源是**新增的下发字段**，而本项目反复踩过「新增凭据相关字段顺着
//   响应体明文出门」的坑（redactConfig 只删顶层键那次）。所以每个状态都同时扫两条出口，
//   而不是只测 /account-status 自己。
//
// 隔离：每个用例一份独立 DSH_HOME —— config.json 与 account-status.json 都落在里面，
//   绝不碰真实凭据（曾有测试没隔离 DSH_HOME，把真 token 覆盖成假值）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleHttp } from '../../lib/app/http-handlers.js';
import { handleAccountStatus } from '../../lib/app/handlers/account.js';
import { handleAuthStatus } from '../../lib/app/handlers/auth.js';
import { buildAccountStatus, updateAccountStatusAuth } from '../../lib/git/account-status.js';

const TOKEN = 'ghp_' + 'B'.repeat(36);
const AUTHORIZED_AT = '2026-11-19T02:30:00.000Z';

// 一份形状完整的快照（含 token/ssh/apiQuota/username）：用来验证「局部覆盖不踩别的字段」。
function snapshotFixture(over = {}) {
  return {
    username: 'pat-user',
    loggedIn: true,
    token: { valid: true, login: 'pat-user', id: '42', checkedAt: '2026-11-18T10:00:00.000Z', detail: '', timeout: false },
    ssh: { valid: false, login: '', checkedAt: '', detail: '', timeout: false },
    apiQuota: { core: { limit: 5000, remaining: 4321, resetAt: '2026-11-19T03:00:00.000Z' } },
    checkedAt: '2026-11-18T10:00:00.000Z',
    ...over,
  };
}

function createSandbox() {
  const home = mkdtempSync(join(tmpdir(), 'dshgp-authstatus-'));
  const pluginDir = join(home, 'git-push');
  const workspace = join(home, 'workspace');
  mkdirSync(pluginDir, { recursive: true, mode: 0o700 });
  mkdirSync(workspace, { recursive: true });
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const sandbox = {
    workspace,
    configFile: join(pluginDir, 'config.json'),
    statusFile: join(pluginDir, 'account-status.json'),
    writeConfig(config) { writeFileSync(sandbox.configFile, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 }); },
    writeStatus(status) { writeFileSync(sandbox.statusFile, JSON.stringify(status, null, 2), { encoding: 'utf8', mode: 0o600 }); },
    readStatus() { return JSON.parse(readFileSync(sandbox.statusFile, 'utf8')); },
    dispose() {
      if (previousHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    },
  };
  return sandbox;
}

const getEndpoint = (sandbox, url, cfg = {}) => handleHttp(
  { method: 'GET', url },
  { workspaceRoot: sandbox.workspace },
  cfg,
);

// 安全口径：两条出口的响应体序列化后都不得含 token 明文（连 ghp_ 前缀片段都不行）。
async function assertNoTokenLeak(sandbox, cfg, label) {
  const statusRes = await getEndpoint(sandbox, '/api/git-push/status', cfg);
  const settingsRes = await getEndpoint(sandbox, '/api/git-push/settings-get', cfg);
  for (const [name, res] of [['status', statusRes], ['settings-get', settingsRes]]) {
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(TOKEN), `${label}：${name} 响应体不得出现 token 明文`);
    assert.ok(!text.includes('ghp_'), `${label}：${name} 响应体不得出现任何 ghp_ 片段`);
  }
  return { statusRes, settingsRes };
}

test('无 token：authMode=none，且读接口不创建 account-status 文件', async () => {
  const sandbox = createSandbox();
  try {
    const res = await getEndpoint(sandbox, '/api/git-push/account-status');
    assert.equal(res.status, 200);
    assert.equal(res.body.authMode, 'none');
    assert.equal(res.body.authLogin, '');
    assert.equal(res.body.authorizedAt, '');
    assert.equal(res.body.authHint, '', '无凭据时不出现迁移提示');
    assert.equal(res.body.tokenConfigured, false);
    // 读接口不得凭空造出一份「登录记录」（那会把「暂无登录记录」撑成「凭据不可用」）
    assert.equal(existsSync(sandbox.statusFile), false, 'GET /account-status 不应创建快照文件');
    assert.equal(res.body.statusUpdated, false);

    await assertNoTokenLeak(sandbox, {}, '无 token');
  } finally { sandbox.dispose(); }
});

test('仅手工 PAT（配置里没有 githubAuth）：兜底判为 pat，带迁移提示，且登录名回落快照用户名', async () => {
  const sandbox = createSandbox();
  try {
    const config = { githubToken: TOKEN, sshPub: 'ssh-ed25519 AAAAdemo' };
    sandbox.writeConfig(config);
    sandbox.writeStatus(snapshotFixture());

    const res = await getEndpoint(sandbox, '/api/git-push/account-status', config);
    // 关键兜底：配置里没有任何 githubAuth 块时，凭「有没有 token」推出 pat（不能判成 none）
    assert.equal(res.body.authMode, 'pat');
    assert.equal(res.body.tokenConfigured, true);
    assert.equal(res.body.authLogin, 'pat-user', 'PAT 的展示登录名回落账号快照里的用户名');
    assert.equal(res.body.authorizedAt, '');
    assert.match(res.body.authHint, /GitHub 授权/, 'PAT 态必须给出「可改用 GitHub 授权」的提示');
    assert.equal(res.body.statusUpdated, true, '快照缺来源时应被局部补齐');

    // 局部覆盖：只补 auth 三项，token/ssh/apiQuota/username 原样保留
    const snapshot = sandbox.readStatus();
    assert.equal(snapshot.authMode, 'pat');
    assert.equal(snapshot.authLogin, 'pat-user');
    assert.deepEqual(snapshot.token, snapshotFixture().token, 'token 校验结论不得被来源写入踩掉');
    assert.deepEqual(snapshot.ssh, snapshotFixture().ssh);
    assert.deepEqual(snapshot.apiQuota, snapshotFixture().apiQuota);
    assert.equal(snapshot.username, 'pat-user');

    // 稳态：第二次读不该再落盘（否则每次刷新都写一次账）
    const again = await getEndpoint(sandbox, '/api/git-push/account-status', config);
    assert.equal(again.body.authMode, 'pat');
    assert.equal(again.body.statusUpdated, false, '来源未变时不应重复写盘');

    const { settingsRes } = await assertNoTokenLeak(sandbox, config, 'PAT 模式');
    assert.equal(settingsRes.body.settings.tokenConfigured, true, '下发通道给布尔位，供界面渲染「已配置」');
  } finally { sandbox.dispose(); }
});

test('device-flow：来源与登录名取自 githubAuth，且嵌套凭据字段也被清洗', async () => {
  const sandbox = createSandbox();
  try {
    const config = {
      githubToken: TOKEN,
      githubAuth: {
        mode: 'device-flow',
        clientId: 'Iv1.demoClientId',
        scope: 'repo,workflow',
        login: 'octocat',
        authorizedAt: AUTHORIZED_AT,
        // 防御性用例：即便有人（或将来某个版本）往元数据块里塞了凭据，也不能随响应体出门
        token: TOKEN,
      },
    };
    sandbox.writeConfig(config);
    sandbox.writeStatus(snapshotFixture());

    const res = await getEndpoint(sandbox, '/api/git-push/account-status', config);
    assert.equal(res.body.authMode, 'device-flow');
    assert.equal(res.body.authLogin, 'octocat', '登录名来自 githubAuth.login');
    assert.equal(res.body.authorizedAt, AUTHORIZED_AT);
    assert.equal(res.body.authHint, '', 'device-flow 已是目标态，不再给迁移提示');

    const snapshot = sandbox.readStatus();
    assert.equal(snapshot.authMode, 'device-flow');
    assert.equal(snapshot.authLogin, 'octocat');
    assert.equal(snapshot.authorizedAt, AUTHORIZED_AT);
    assert.deepEqual(snapshot.token, snapshotFixture().token);

    const { statusRes, settingsRes } = await assertNoTokenLeak(sandbox, config, 'device-flow 模式');
    // githubAuth 里那个 token 字段必须被 redactConfig 按名字剔掉（不光靠顶层键删除）
    assert.equal(statusRes.body.config.githubAuth.token, undefined, 'config.githubAuth 不得带凭据字段');
    assert.equal(settingsRes.body.settings.githubAuth.token, undefined, 'settings.githubAuth 同样不得带凭据字段');
    assert.equal(settingsRes.body.settings.githubAuth.mode, 'device-flow', '元数据本身照常下发');
  } finally { sandbox.dispose(); }
});

test('撤销后（mode=none、无 token）：快照里的旧来源被纠正为 none，且不残留登录名', async () => {
  const sandbox = createSandbox();
  try {
    const config = { githubAuth: { mode: 'none', login: '', authorizedAt: '', clientId: 'Iv1.demoClientId' } };
    sandbox.writeConfig(config);
    sandbox.writeStatus(snapshotFixture({ authMode: 'device-flow', authLogin: 'octocat', authorizedAt: AUTHORIZED_AT }));

    const res = await getEndpoint(sandbox, '/api/git-push/account-status', config);
    assert.equal(res.body.authMode, 'none');
    assert.equal(res.body.authLogin, '');
    assert.equal(res.body.authorizedAt, '');
    assert.equal(res.body.statusUpdated, true, '旧来源应被纠正并落盘');

    const snapshot = sandbox.readStatus();
    assert.equal(snapshot.authMode, 'none');
    assert.equal(snapshot.authLogin, '');
    // 校验结论与配额仍不动（撤销凭据不等于清账号探测历史，UI 还要显示「上次校验」）
    assert.deepEqual(snapshot.token, snapshotFixture().token);
    assert.deepEqual(snapshot.apiQuota, snapshotFixture().apiQuota);
  } finally { sandbox.dispose(); }
});

test('三态与 /auth/status 同源（防两处判定漂移）', async () => {
  const sandbox = createSandbox();
  try {
    const cases = [
      { label: 'none', config: {}, expected: 'none' },
      { label: 'pat', config: { githubToken: TOKEN }, expected: 'pat' },
      { label: 'device-flow', config: { githubToken: TOKEN, githubAuth: { mode: 'device-flow', login: 'octocat' } }, expected: 'device-flow' },
    ];
    for (const item of cases) {
      sandbox.writeConfig(item.config);
      const ctx = { env: { workspaceRoot: sandbox.workspace }, cfg: item.config, body: {}, query: {} };
      const fromAccount = handleAccountStatus(ctx).body;
      const fromAuth = handleAuthStatus(ctx).body;
      assert.equal(fromAccount.authMode, item.expected, `${item.label}：/account-status 三态判定`);
      assert.equal(fromAccount.authMode, fromAuth.mode, `${item.label}：两条出口必须给出同一个来源`);
      assert.equal(fromAccount.authLogin, fromAuth.login, `${item.label}：登录名也必须一致`);
    }
  } finally { sandbox.dispose(); }
});

test('buildAccountStatus：来源三元组随校验结论一起入快照，缺参时为空串（不伪造来源）', () => {
  const withAuth = buildAccountStatus({ username: 'octocat', loggedIn: true, tokenStatus: { valid: true, login: 'octocat', checked: true } }, {
    authMode: 'device-flow', authLogin: 'octocat', authorizedAt: AUTHORIZED_AT,
  });
  assert.equal(withAuth.authMode, 'device-flow');
  assert.equal(withAuth.authLogin, 'octocat');
  assert.equal(withAuth.authorizedAt, AUTHORIZED_AT);
  assert.equal(withAuth.token.valid, true, '来源入快照不得影响校验结论');

  // 调用方没给来源时留空串——宁可显示「未知来源」，也不要凭空断言是 pat
  const withoutAuth = buildAccountStatus({ username: 'octocat', tokenStatus: { valid: true } });
  assert.equal(withoutAuth.authMode, '');
  assert.equal(withoutAuth.authLogin, '');
  assert.equal(withoutAuth.authorizedAt, '');
});

test('updateAccountStatusAuth：只覆盖 auth 三项，其它字段逐字节保留', () => {
  const sandbox = createSandbox();
  try {
    const before = snapshotFixture({ authMode: 'pat', authLogin: 'pat-user', authorizedAt: '' });
    sandbox.writeStatus(before);

    const written = updateAccountStatusAuth({ authMode: 'device-flow', authLogin: 'octocat', authorizedAt: AUTHORIZED_AT }, { workspaceRoot: sandbox.workspace });
    assert.equal(written.ok, true);
    assert.equal(written.statusUpdated, true);
    assert.equal(written.created, false);

    const after = sandbox.readStatus();
    assert.equal(after.authMode, 'device-flow');
    assert.equal(after.authLogin, 'octocat');
    assert.equal(after.authorizedAt, AUTHORIZED_AT);
    assert.deepEqual(after.token, before.token);
    assert.deepEqual(after.ssh, before.ssh);
    assert.deepEqual(after.apiQuota, before.apiQuota);
    assert.equal(after.username, before.username);
    assert.equal(after.checkedAt, before.checkedAt);
  } finally { sandbox.dispose(); }
});
