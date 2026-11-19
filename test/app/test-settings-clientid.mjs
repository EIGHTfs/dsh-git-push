/**
 * 设置协议测试：Device Flow 的 OAuth clientId 写入通道（扁平键 githubAuthClientId）
 *
 * 为什么要专门一组用例：clientId 的真身是嵌套的 `githubAuth.clientId`，同块里还躺着
 *   mode / login / authorizedAt。走通用「整键覆盖」路径写它会**把同块其它字段一起抹掉**——
 *   症状是「只是改了个 clientId，界面却退回未授权，还得重走一遍授权」。
 *   本组把「键级合并」这条不变量钉死，同时锁住两条边界：
 *   ① 形态校验（非法值被拒，且磁盘上的旧值不受影响）
 *   ② clientId 不是密钥（明文回显 / 明文下发都不算泄漏，但 token 仍然不能出现）
 *
 * 隔离：DSH_HOME 指向临时目录（config.json 落在这里），绝不碰真实配置。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleHttp } from '../../lib/app/http-handlers.js';
import { ALLOWED_SETTING_KEYS } from '../../lib/app/handlers/settings.js';
import { applySettingsToCfg, writeGithubAuthClientId, isPlausibleOAuthClientId } from '../../lib/app/settings-bridge.js';
import { SECRET_CONFIG_FIELDS } from '../../lib/app/schema.js';

const WORKSPACE_ENV = { workspaceRoot: '' };
const LOOPBACK_ORIGIN = 'http://127.0.0.1';
const CLIENT_ID = 'Iv1.a1b2c3d4e5f6a7b8';
const CLIENT_ID_NEXT = 'Iv23liAbCdEfGh123456';
const LEGACY_HEX_CLIENT_ID = '0123456789abcdef0123';
const TOKEN = `ghp_${'T'.repeat(36)}`;
const AUTHORIZED_AT = '2026-11-19T02:30:00.000Z';
const PLATFORM_LOGIN = 'octocat';
/** 一份已授权过的 config.json：用来验证写入 clientId 时同块的其余字段不被冲掉。 */
const EXISTING_AUTH_BLOCK = {
  mode: 'device-flow',
  scope: 'repo,workflow',
  login: PLATFORM_LOGIN,
  authorizedAt: AUTHORIZED_AT,
};

let homeDir = '';
const previousDshHome = process.env.DSH_HOME;

function pluginDir() {
  return join(homeDir, 'git-push');
}

function configFilePath() {
  return join(pluginDir(), 'config.json');
}

function readConfigFile() {
  if (!existsSync(configFilePath())) return null;
  return JSON.parse(readFileSync(configFilePath(), 'utf8'));
}

function seedConfig(patch = {}) {
  mkdirSync(pluginDir(), { recursive: true });
  writeFileSync(configFilePath(), `${JSON.stringify({ githubAuth: { ...EXISTING_AUTH_BLOCK }, ...patch }, null, 2)}\n`);
}

function postSettings(body) {
  return handleHttp({ method: 'POST', url: '/api/git-push/settings-set', origin: LOOPBACK_ORIGIN, body }, WORKSPACE_ENV, {});
}

function getSettings() {
  return handleHttp({ method: 'GET', url: '/api/git-push/settings-get', origin: LOOPBACK_ORIGIN }, WORKSPACE_ENV, {});
}

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'dsh-gp-clientid-'));
  process.env.DSH_HOME = homeDir;
});

after(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  rmSync(homeDir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(pluginDir(), { recursive: true, force: true });
  // 目录由写入侧按需创建（与真实部署一致），这里只保证每个用例从「没有配置文件」开始。
  seedConfig();
});

/* ───────── 写入 ───────── */

test('写入 githubAuthClientId → 嵌套 githubAuth.clientId 生效，且 mode/login/authorizedAt 不被冲掉', async () => {
  const response = await postSettings({ key: 'githubAuthClientId', value: CLIENT_ID });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);

  const saved = readConfigFile();
  assert.equal(saved.githubAuth?.clientId, CLIENT_ID, '扁平键必须翻译成嵌套 githubAuth.clientId');
  assert.equal(saved.githubAuth?.mode, 'device-flow', '同块的 mode 不得被抹掉');
  assert.equal(saved.githubAuth?.login, PLATFORM_LOGIN, '同块的 login 不得被抹掉');
  assert.equal(saved.githubAuth?.authorizedAt, AUTHORIZED_AT, '同块的 authorizedAt 不得被抹掉');
  assert.equal(saved.githubAuth?.scope, 'repo,workflow', '同块的 scope 不得被抹掉');
  assert.equal(saved.githubAuthClientId, undefined, '不得在 config.json 顶层留下扁平键（两处真相会漂移）');
});

test('clientId 非密钥：明文回显（trim 后），且不进 SECRET_CONFIG_FIELDS', async () => {
  const response = await postSettings({ key: 'githubAuthClientId', value: `  ${CLIENT_ID}  ` });
  assert.equal(response.status, 200);
  assert.equal(response.body.value, CLIENT_ID, '应明文回显 trim 后的值，供输入框回填');
  assert.ok(!SECRET_CONFIG_FIELDS.includes('githubAuthClientId'), 'clientId 是公开客户端标识，不该被当成密钥删掉');
  assert.equal(readConfigFile()?.githubAuth?.clientId, CLIENT_ID, '落盘值同样要 trim');
});

test('旧式 20 位十六进制 clientId 也能写入（校验不能过严）', async () => {
  const response = await postSettings({ key: 'githubAuthClientId', value: LEGACY_HEX_CLIENT_ID });
  assert.equal(response.status, 200);
  assert.equal(readConfigFile()?.githubAuth?.clientId, LEGACY_HEX_CLIENT_ID);
});

test('连续两次写入不同 clientId：后写入覆盖前值，其余字段保持', async () => {
  await postSettings({ key: 'githubAuthClientId', value: CLIENT_ID });
  const second = await postSettings({ key: 'githubAuthClientId', value: CLIENT_ID_NEXT });
  assert.equal(second.status, 200);
  const saved = readConfigFile();
  assert.equal(saved.githubAuth?.clientId, CLIENT_ID_NEXT);
  assert.equal(saved.githubAuth?.mode, 'device-flow');
});

/* ───────── 清空 ───────── */

test('清空（空串）→ clientId 变空串，同块元数据仍保留', async () => {
  await postSettings({ key: 'githubAuthClientId', value: CLIENT_ID });
  const cleared = await postSettings({ key: 'githubAuthClientId', value: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.ok, true);
  assert.equal(cleared.body.value, '', '清空后回显空串');
  const saved = readConfigFile();
  assert.equal(saved.githubAuth?.clientId, '', '空串允许：它是「用户主动撤销 clientId」的合法动作');
  assert.equal(saved.githubAuth?.mode, 'device-flow', '清空 clientId 不等于清授权来源');
  assert.equal(saved.githubAuth?.login, PLATFORM_LOGIN);
});

/* ───────── 拒绝 ───────── */

test('非法值 → 400 + 可读错误，且磁盘上的旧值不被改动', async () => {
  await postSettings({ key: 'githubAuthClientId', value: CLIENT_ID });
  const invalidValues = ['has space in it', '../../etc/passwd', '短', `x${'y'.repeat(200)}`, '中文客户端ID'];
  for (const invalidValue of invalidValues) {
    const response = await postSettings({ key: 'githubAuthClientId', value: invalidValue });
    assert.equal(response.status, 400, `非法值应被拒: ${invalidValue.slice(0, 20)}`);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.code, 'BAD_CLIENT_ID');
    assert.match(String(response.body.error), /clientId/, '错误文本要指出是哪个字段不对');
    assert.equal(readConfigFile()?.githubAuth?.clientId, CLIENT_ID, '被拒时不得动磁盘上的旧值');
  }
});

test('白名单没被放宽：整块 githubAuth 与未知键仍被拒（防「顺手加宽越权面」）', async () => {
  const block = await postSettings({ key: 'githubAuth', value: { clientId: CLIENT_ID } });
  assert.equal(block.status, 400, '只能走扁平键，不能整块覆盖 githubAuth');
  assert.equal(readConfigFile()?.githubAuth?.clientId, undefined);
  const unknown = await postSettings({ key: 'githubAuthMode', value: 'device-flow' });
  assert.equal(unknown.status, 400);
  assert.ok(ALLOWED_SETTING_KEYS.includes('githubAuthClientId'), '扁平键应在白名单里');
  assert.ok(!ALLOWED_SETTING_KEYS.includes('githubAuth'), '嵌套块名不该进白名单');
});

/* ───────── 出口安全 ───────── */

test('写入 clientId 后 /settings-get：clientId 明文可见，token 仍不出门', async () => {
  seedConfig({ githubToken: TOKEN });
  await postSettings({ key: 'githubAuthClientId', value: CLIENT_ID });

  const response = await getSettings();
  assert.equal(response.status, 200);
  const text = JSON.stringify(response.body);
  assert.ok(!text.includes(TOKEN), 'settings-get 不得出现 token 明文');
  assert.ok(!text.includes('ghp_'), 'settings-get 不得出现任何 ghp_ 片段');
  assert.equal(response.body.settings?.githubAuth?.clientId, CLIENT_ID, 'clientId 非密钥，应明文下发供输入框回填');
  assert.equal(response.body.settings?.githubToken, undefined);
  assert.equal(response.body.settings?.tokenConfigured, true, '仍要给出「已配置」布尔位');
});

/* ───────── 运行期 cfg 回读（模拟重启） ───────── */

test('applySettingsToCfg：扁平键与整块两路都能把 clientId 读回运行期 cfg', () => {
  const afterFlatWrite = { preCommit: { enabled: true }, githubAuth: { mode: 'device-flow', login: PLATFORM_LOGIN } };
  applySettingsToCfg(afterFlatWrite, { githubAuthClientId: ` ${CLIENT_ID} ` });
  assert.equal(afterFlatWrite.githubAuth.clientId, CLIENT_ID, '扁平键（settings-set 路径）应写进嵌套块');
  assert.equal(afterFlatWrite.githubAuth.mode, 'device-flow', '合并不得冲掉同块字段');
  assert.equal(afterFlatWrite.githubAuthClientId, undefined, 'cfg 里不该出现扁平键（两处真相）');

  const afterRestart = {};
  applySettingsToCfg(afterRestart, { githubAuth: { ...EXISTING_AUTH_BLOCK, clientId: CLIENT_ID_NEXT } });
  assert.equal(afterRestart.githubAuth.clientId, CLIENT_ID_NEXT, '启动读整份 config.json 的路径应还原嵌套值');
  assert.equal(afterRestart.githubAuth.login, PLATFORM_LOGIN);

  // 单键写入优先于文件里的旧嵌套值（用户刚做的动作赢）
  const mixed = { githubAuth: { clientId: CLIENT_ID } };
  applySettingsToCfg(mixed, { githubAuth: { clientId: CLIENT_ID }, githubAuthClientId: CLIENT_ID_NEXT });
  assert.equal(mixed.githubAuth.clientId, CLIENT_ID_NEXT);
});

test('非 HTTP 入口（settings-bridge 直调）同样走形态校验', async () => {
  assert.equal(isPlausibleOAuthClientId(CLIENT_ID), true);
  assert.equal(isPlausibleOAuthClientId(''), false, '空串由「清空」语义处理，不算合法形态');
  const rejected = await writeGithubAuthClientId('bad value with spaces', WORKSPACE_ENV);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'BAD_CLIENT_ID');
  assert.equal(readConfigFile()?.githubAuth?.clientId, undefined, '直调入口也必须先校验再落盘');

  const accepted = await writeGithubAuthClientId(CLIENT_ID, WORKSPACE_ENV);
  assert.equal(accepted.ok, true);
  assert.equal(readConfigFile()?.githubAuth?.clientId, CLIENT_ID);
});
