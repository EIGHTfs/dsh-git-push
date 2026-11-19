/**
 * 授权端点测试（Device Flow · HTTP 层四端点）
 *
 * 覆盖的是「HTTP 接线 + 配置落盘 + 凭据边界」，协议状态机本身由上游 auth-device 的测试负责。
 *
 * 三条硬约束在这里被钉死：
 *   ① **响应体永不出现 access_token**：四个端点逐个断言（评审记录的事故类型是「凭据进了
 *      会被序列化下发的结构」，只要有一条路径忘了就会出现）。
 *   ② **凭据只落 config.json 的 githubToken 键**（不是 githubAuth 里的新存储位）——
 *      授权成功后按文件内容断言，而不是只信响应字段。
 *   ③ **会话跨请求存活**：start 与 poll 是两次独立请求，device_code 只在服务端内存里。
 *
 * 隔离：DSH_HOME 指向临时目录（credentialsDir() / settingsFilePath() 都在调用时读它），
 *   绝不碰真实配置；上游 fetch 用假实现注入，全程零网络。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleHttp } from '../../lib/app/http-handlers.js';
import { BUILTIN_OAUTH_CLIENT_ID, resetDeviceFlowSession, setDeviceFlowUpstreamDeps } from '../../lib/app/handlers/auth.js';
import { clearGithubToken, persistGithubToken } from '../../lib/core/credentials.js';
import { updateJsonAtomic } from '../../lib/core/atomic-json.js';
import { redactConfig, SECRET_CONFIG_FIELDS } from '../../lib/app/schema.js';

const WORKSPACE_ENV = { workspaceRoot: '' };
const LOOPBACK_ORIGIN = 'http://127.0.0.1';

const DEVICE_CODE = 'device-code-must-never-leak';
const USER_CODE = 'ABCD-1234';
const VERIFICATION_URI = 'https://github.com/login/device';
const VERIFICATION_URI_COMPLETE = `${VERIFICATION_URI}?user_code=${USER_CODE}`;
const ACCESS_TOKEN = `gho_${'B'.repeat(36)}`;
const OAUTH_CLIENT_ID = 'Iv1.testclient0123456';
const PLATFORM_LOGIN = 'octocat';
const DEVICE_CODE_TTL_SECONDS = 900;
const POLL_INTERVAL_SECONDS = 5;
const DEVICE_CODE_TTL_MS = DEVICE_CODE_TTL_SECONDS * 1000;
const POLL_INTERVAL_MS = POLL_INTERVAL_SECONDS * 1000;
/** 推进时钟时用的步长：够跨过任何一轮节流窗口。 */
const CLOCK_ADVANCE_MS = POLL_INTERVAL_MS * 2;

let homeDir = '';
const previousDshHome = process.env.DSH_HOME;

function configFilePath() {
  return join(homeDir, 'git-push', 'config.json');
}

function readConfigFile() {
  const file = configFilePath();
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function jsonResponse(body, status = 200) {
  return { status, json: async () => body };
}

/**
 * 装一套假上游：记录每次出网请求，时钟可推进（避免真的等满 5 秒节流）。
 * @param {{pendingRounds?:number, loginStatus?:number}} [options]
 *   pendingRounds 先回几次 authorization_pending（模拟用户还没点授权）
 *   loginStatus    /user 的返回码（非 200 用来验证「查不到登录名也不影响授权成功」）
 */
function installFakeUpstream(options = {}) {
  const calls = [];
  const clock = { value: Date.now() };
  let remainingPendingRounds = Number(options.pendingRounds || 0);
  const loginStatus = options.loginStatus ?? 200;

  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: String(init.method || 'GET'), body: String(init.body || '') });
    if (target.endsWith('/login/device/code')) {
      return jsonResponse({
        device_code: DEVICE_CODE,
        user_code: USER_CODE,
        verification_uri: VERIFICATION_URI,
        verification_uri_complete: VERIFICATION_URI_COMPLETE,
        expires_in: DEVICE_CODE_TTL_SECONDS,
        interval: POLL_INTERVAL_SECONDS,
      });
    }
    if (target.endsWith('/login/oauth/access_token')) {
      if (remainingPendingRounds > 0) {
        remainingPendingRounds -= 1;
        return jsonResponse({ error: 'authorization_pending' });
      }
      return jsonResponse({ access_token: ACCESS_TOKEN, token_type: 'bearer', scope: 'repo,workflow' });
    }
    if (target.endsWith('/user')) {
      return jsonResponse(loginStatus === 200 ? { login: PLATFORM_LOGIN } : { message: 'boom' }, loginStatus);
    }
    throw new Error(`未预期的上游请求: ${target}`);
  };

  setDeviceFlowUpstreamDeps({ fetchImpl, now: () => clock.value, sleep: async () => {} });
  return { calls, clock };
}

function postJson(url, body = {}) {
  return handleHttp({ method: 'POST', url, origin: LOOPBACK_ORIGIN, body }, WORKSPACE_ENV, {});
}

function getJson(url) {
  return handleHttp({ method: 'GET', url, origin: LOOPBACK_ORIGIN }, WORKSPACE_ENV, {});
}

/** 断言一段响应体里既没有明文凭据、也没有设备码。 */
function assertNoCredentialLeak(body, label) {
  const text = JSON.stringify(body);
  assert.ok(!text.includes(ACCESS_TOKEN), `${label}：响应体不得出现 accessToken`);
  assert.ok(!text.includes('gho_'), `${label}：响应体不得出现任何 gho_ 前缀片段`);
  assert.ok(!text.includes(DEVICE_CODE), `${label}：响应体不得出现 device_code`);
  assert.ok(!Object.keys(body).includes('accessToken'), `${label}：响应体不得有 accessToken 字段`);
  assert.ok(!Object.keys(body).includes('access_token'), `${label}：响应体不得有 access_token 字段`);
}

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'dsh-gp-auth-'));
  process.env.DSH_HOME = homeDir;
});

after(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  rmSync(homeDir, { recursive: true, force: true });
});

beforeEach(() => {
  // 每个用例从「没有会话、没有配置文件」开始：会话是模块级单例，不清会串到下一个用例。
  resetDeviceFlowSession();
  setDeviceFlowUpstreamDeps({});
  rmSync(join(homeDir, 'git-push'), { recursive: true, force: true });
});

/* ───────── device/start ───────── */

test('device/start：不配 clientId 时回落到插件内置的公开客户端（开箱即用）', async () => {
  const upstream = installFakeUpstream();
  const response = await postJson('/api/git-push/auth/device/start');
  // 用户不必自建 OAuth App：未显式配置 clientId 时回落插件内置的公开客户端，
  //   所以正常流程里不该出现「缺 clientId」——否则「装上就能用」不成立。
  assert.equal(response.status, 200, '有内置客户端时不该报缺配置');
  assert.equal(response.body.ok, true);
  const deviceCodeCall = upstream.calls.find((call) => call.url.endsWith('/login/device/code'));
  assert.ok(deviceCodeCall, '应向上游申请设备码');
  assert.match(deviceCodeCall.body, new RegExp(`client_id=${BUILTIN_OAUTH_CLIENT_ID}`),
    '未显式配置时必须回落到内置公开客户端');
});

test('内置 client_id 不得为空（清空它等于把「缺配置」错误推回给所有用户）', () => {
  assert.match(String(BUILTIN_OAUTH_CLIENT_ID), /\S/, '内置客户端 ID 必须是非空字符串');
  // 显式配置优先于内置：见下一条「成功 → 返回短码」用例（它用 OAUTH_CLIENT_ID 覆盖并断言请求体）
});

test('device/start：成功 → 返回短码与授权地址，且响应体不含 device_code', async () => {
  const upstream = installFakeUpstream();
  const response = await postJson('/api/git-push/auth/device/start', { clientId: OAUTH_CLIENT_ID });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.state, 'awaiting_user');
  assert.equal(response.body.userCode, USER_CODE);
  assert.equal(response.body.verificationUri, VERIFICATION_URI);
  assert.equal(response.body.verificationUriComplete, VERIFICATION_URI_COMPLETE);
  assert.equal(response.body.expiresInMs, DEVICE_CODE_TTL_MS);
  assert.equal(response.body.intervalMs, POLL_INTERVAL_MS);
  assert.ok(response.body.nextPollAtEpochMs > 0, '应给出下一拍时间供前端排轮询');
  assert.equal(response.body.tokenGranted, false);
  assertNoCredentialLeak(response.body, 'device/start');
  const deviceCodeCall = upstream.calls.find((call) => call.url.endsWith('/login/device/code'));
  assert.ok(deviceCodeCall, '应向上游申请设备码');
  assert.match(deviceCodeCall.body, new RegExp(`client_id=${OAUTH_CLIENT_ID}`), '请求体应带 clientId');
  assert.match(deviceCodeCall.body, /scope=repo%2Cworkflow/, '默认 scope 应含 workflow（否则含 CI 配置的 push 会被整推拒绝）');
});

test('device/start：clientId 改了就重建会话（新 client_id 生效，旧设备码作废）', async () => {
  const upstream = installFakeUpstream();
  await postJson('/api/git-push/auth/device/start', { clientId: 'Iv1.firstclient' });
  await postJson('/api/git-push/auth/device/start', { clientId: 'Iv1.secondclient' });
  const clientIds = upstream.calls
    .filter((call) => call.url.endsWith('/login/device/code'))
    .map((call) => /client_id=([^&]+)/.exec(call.body)?.[1]);
  assert.deepEqual(clientIds, ['Iv1.firstclient', 'Iv1.secondclient'],
    '第二次 start 必须用新 clientId 重新申请设备码（沿用旧会话会一直 authorization_pending）');
});

/* ───────── device/poll ───────── */

test('写端点只接受 POST：GET 触发不执行副作用（防跨站 <img>/预取）', async () => {
  const upstream = installFakeUpstream();
  await postJson('/api/git-push/auth/device/start', { clientId: OAUTH_CLIENT_ID });
  const callsAfterStart = upstream.calls.length;

  const startViaGet = await getJson('/api/git-push/auth/device/start');
  assert.equal(startViaGet.status, 405);
  assert.equal(startViaGet.body.code, 'METHOD_NOT_ALLOWED');
  const pollViaGet = await getJson('/api/git-push/auth/device/poll');
  assert.equal(pollViaGet.status, 405);
  // revoke 先撞 http 前置的写确认门禁（GET 没有 body.confirm）⇒ 400 拒绝，同样不会执行；
  //   这里断言「被拒 + 凭据未动」即可，不锁死是哪一道闸先拦。
  const revokeViaGet = await getJson('/api/git-push/auth/revoke');
  assert.equal(revokeViaGet.body.ok, false, 'GET 不得撤销成功');
  assert.ok([400, 405].includes(revokeViaGet.status), `GET 撤销必须被拒（实际 ${revokeViaGet.status}）`);
  assert.equal(upstream.calls.length, callsAfterStart, 'GET 不该触达上游');

  // 进行中的会话不能被一次 GET 重置：短码还在，仍可正常轮询
  const status = await getJson('/api/git-push/auth/status');
  assert.equal(status.body.inProgress, true);
  assert.equal(status.body.userCode, USER_CODE);
});

test('device/poll：还没 start → 回 idle 而不是报错，且不发上游请求', async () => {
  const upstream = installFakeUpstream();
  const response = await postJson('/api/git-push/auth/device/poll');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.state, 'idle');
  assert.equal(response.body.tokenGranted, false);
  assert.match(String(response.body.reason), /start/, '应提示先调用 start');
  assert.equal(upstream.calls.length, 0, '无会话时不该打上游');
});

test('device/poll：未到下一拍 → 回 throttled 且不打上游（节流在服务端）', async () => {
  const upstream = installFakeUpstream();
  await postJson('/api/git-push/auth/device/start', { clientId: OAUTH_CLIENT_ID });
  const callsAfterStart = upstream.calls.length;
  const response = await postJson('/api/git-push/auth/device/poll');
  assert.equal(response.status, 200);
  assert.equal(response.body.throttled, true);
  assert.equal(response.body.tokenGranted, false);
  assert.equal(upstream.calls.length, callsAfterStart, '节流窗口内不该打上游');
});

test('device/poll：用户还没授权 → state 仍 awaiting_user，tokenGranted=false', async () => {
  const upstream = installFakeUpstream({ pendingRounds: 1 });
  await postJson('/api/git-push/auth/device/start', { clientId: OAUTH_CLIENT_ID });
  upstream.clock.value += CLOCK_ADVANCE_MS;
  const response = await postJson('/api/git-push/auth/device/poll');
  assert.equal(response.status, 200);
  assert.equal(response.body.state, 'awaiting_user');
  assert.equal(response.body.tokenGranted, false);
  assertNoCredentialLeak(response.body, 'device/poll（待授权）');
});

test('device/poll：授权成功 → 凭据写进 githubToken 键 + 元数据落 githubAuth，响应体无 token', async () => {
  const upstream = installFakeUpstream();
  await postJson('/api/git-push/auth/device/start', { clientId: OAUTH_CLIENT_ID });
  upstream.clock.value += CLOCK_ADVANCE_MS;
  const response = await postJson('/api/git-push/auth/device/poll');

  assert.equal(response.status, 200);
  assert.equal(response.body.state, 'authorized');
  assert.equal(response.body.ok, true);
  assert.equal(response.body.tokenGranted, true, '只报告「拿到了」，不回传凭据本身');
  assertNoCredentialLeak(response.body, 'device/poll（授权成功）');

  const saved = readConfigFile();
  assert.ok(saved, '授权成功必须落盘');
  assert.equal(saved.githubToken, ACCESS_TOKEN, '凭据只能写顶层 githubToken 键（20+ 处消费点只认它）');
  assert.equal(saved.githubAuth?.mode, 'device-flow');
  assert.equal(saved.githubAuth?.login, PLATFORM_LOGIN);
  assert.equal(saved.githubAuth?.clientId, OAUTH_CLIENT_ID);
  assert.match(String(saved.githubAuth?.authorizedAt), /^\d{4}-\d{2}-\d{2}T/, 'authorizedAt 应是 ISO 时间');
  assert.equal(saved.githubAuth?.token, undefined, 'githubAuth 里绝不能出现 token（新开存储位就是静默故障）');
  assert.ok(!JSON.stringify(saved.githubAuth).includes(ACCESS_TOKEN), 'githubAuth 整块不得含凭据');
});

test('device/poll：重复 poll 不重复写盘、不重复查登录名', async () => {
  const upstream = installFakeUpstream();
  await postJson('/api/git-push/auth/device/start', { clientId: OAUTH_CLIENT_ID });
  upstream.clock.value += CLOCK_ADVANCE_MS;
  await postJson('/api/git-push/auth/device/poll');
  const callsAfterFirstPoll = upstream.calls.length;
  const profileCalls = () => upstream.calls.filter((call) => call.url.endsWith('/user')).length;
  assert.equal(profileCalls(), 1, '首次落盘应查一次登录名');

  upstream.clock.value += CLOCK_ADVANCE_MS;
  const second = await postJson('/api/git-push/auth/device/poll');
  assert.equal(second.body.state, 'authorized', '终态保持 authorized');
  assert.equal(second.body.tokenGranted, true);
  assert.equal(upstream.calls.length, callsAfterFirstPoll, '已落盘的授权不该再打上游（含 /user）');
  assert.equal(profileCalls(), 1, '登录名只查一次');
  assertNoCredentialLeak(second.body, 'device/poll（重复）');
});

test('device/poll：查不到登录名也要落成授权成功（展示字段不能拖垮主流程）', async () => {
  const upstream = installFakeUpstream({ loginStatus: 500 });
  await postJson('/api/git-push/auth/device/start', { clientId: OAUTH_CLIENT_ID });
  upstream.clock.value += CLOCK_ADVANCE_MS;
  const response = await postJson('/api/git-push/auth/device/poll');
  assert.equal(response.status, 200);
  assert.equal(response.body.state, 'authorized');
  const saved = readConfigFile();
  assert.equal(saved.githubToken, ACCESS_TOKEN);
  assert.equal(saved.githubAuth?.login, '', '查不到登录名时留空，不编造');
});

/* ───────── auth/status ───────── */

test('auth/status：三态（none / pat / device-flow）各自正确', async () => {
  installFakeUpstream();

  const none = await getJson('/api/git-push/auth/status');
  assert.equal(none.status, 200);
  assert.equal(none.body.mode, 'none');
  assert.equal(none.body.login, '');
  assert.equal(none.body.authorizedAt, '');
  assert.equal(none.body.inProgress, false);

  const written = persistGithubToken(ACCESS_TOKEN, { workspaceRoot: '' });
  assert.equal(written.ok, true, '前置：直接写一份 PAT 造 pat 态');

  const pat = await getJson('/api/git-push/auth/status');
  assert.equal(pat.body.mode, 'pat', '有 token 但来源未标记 device-flow ⇒ pat');
  assertNoCredentialLeak(pat.body, 'auth/status（pat）');

  // device-flow 态由授权链路产生（awaiting 时 inProgress=true，成功后 mode 变 device-flow）
  await postJson('/api/git-push/auth/device/start', { clientId: OAUTH_CLIENT_ID });
  const inProgress = await getJson('/api/git-push/auth/status');
  assert.equal(inProgress.body.inProgress, true, '等用户授权期间应报告 inProgress');
  assert.equal(inProgress.body.userCode, USER_CODE, '刷新页面后要能续上短码');
  assertNoCredentialLeak(inProgress.body, 'auth/status（进行中）');
});

/* ───────── auth/revoke ───────── */

test('auth/revoke：无 confirm → 400（写操作门禁）；带 confirm → 清 token 且状态回 none', async () => {
  installFakeUpstream();
  assert.equal(persistGithubToken(ACCESS_TOKEN, { workspaceRoot: '' }).ok, true);

  const rejected = await postJson('/api/git-push/auth/revoke');
  assert.equal(rejected.status, 400, '撤销是不可逆的凭据清除，必须要求 confirm:true');
  assert.equal(rejected.body.code, 'NEED_CONFIRM');
  assert.equal(readConfigFile()?.githubToken, ACCESS_TOKEN, '被拒时不得动凭据');

  const response = await postJson('/api/git-push/auth/revoke', { confirm: true });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.revoked, true);
  assert.equal(response.body.mode, 'none', '回执直接带撤销后的状态，前端不必再打 status');
  assertNoCredentialLeak(response.body, 'auth/revoke');

  const saved = readConfigFile();
  assert.equal(saved.githubToken, undefined, 'githubToken 键必须被删掉');
  assert.equal(saved.githubAuth?.mode, 'none', '来源标记一并清掉');
  assert.equal(saved.githubAuth?.login, '');
  assert.equal(saved.githubAuth?.authorizedAt, '');

  const after = await getJson('/api/git-push/auth/status');
  assert.equal(after.body.mode, 'none');
});

test('auth/revoke：撤销后旧会话作废——后续 poll 不会把凭据写回来', async () => {
  const upstream = installFakeUpstream({ pendingRounds: 1 });
  await postJson('/api/git-push/auth/device/start', { clientId: OAUTH_CLIENT_ID });
  await postJson('/api/git-push/auth/revoke', { confirm: true });

  upstream.clock.value += CLOCK_ADVANCE_MS;
  const polled = await postJson('/api/git-push/auth/device/poll');
  assert.equal(polled.body.state, 'idle', '撤销后会话已销毁，poll 应回 idle');
  assert.equal(readConfigFile()?.githubToken, undefined, '被撤掉的凭据不得被迟到的 poll 写回');
});

/* ───────── 配置与凭据工具 ───────── */

test('schema：githubAuth 只放元数据，redactConfig 仍会拦掉疑似凭据的子字段', () => {
  assert.ok(!SECRET_CONFIG_FIELDS.includes('githubAuth'), 'githubAuth 是元数据块，不该整块当密钥删');
  const redacted = redactConfig({
    githubToken: ACCESS_TOKEN,
    githubAuth: { mode: 'device-flow', login: PLATFORM_LOGIN, token: ACCESS_TOKEN, accessToken: ACCESS_TOKEN },
  });
  assert.equal(redacted.githubToken, undefined);
  assert.equal(redacted.githubAuth?.mode, 'device-flow', '元数据照常下发');
  assert.equal(redacted.githubAuth?.login, PLATFORM_LOGIN);
  assert.equal(redacted.githubAuth?.token, undefined, '疑似凭据的子字段必须被剔除（redactConfig 只删顶层键，这正是事故成因）');
  assert.equal(redacted.githubAuth?.accessToken, undefined);
  assert.ok(!JSON.stringify(redacted).includes(ACCESS_TOKEN), '下发副本里不得残留任何凭据痕迹');
});

test('clearGithubToken：只删 githubToken，其它键（含 githubAuth / npmToken）原样保留', () => {
  const written = persistGithubToken(ACCESS_TOKEN, { workspaceRoot: '' });
  assert.equal(written.ok, true);
  updateJsonAtomic(configFilePath(), (current) => ({
    ...current,
    npmToken: 'npm-plain-token',
    sshPub: 'ssh-ed25519 AAAAdemo',
    githubAuth: { mode: 'device-flow', clientId: OAUTH_CLIENT_ID },
  }));

  const cleared = clearGithubToken({ workspaceRoot: '' });
  assert.equal(cleared.ok, true);
  const saved = readConfigFile();
  assert.equal(saved.githubToken, undefined);
  assert.equal(saved.npmToken, 'npm-plain-token', '同文件的其它凭据不得被连带删除');
  assert.equal(saved.sshPub, 'ssh-ed25519 AAAAdemo');
  assert.equal(saved.githubAuth?.clientId, OAUTH_CLIENT_ID, 'clientId 保留，用户下次授权不必重填');
});

test('clearGithubToken：配置文件不存在时视为成功且不创建空文件', () => {
  const cleared = clearGithubToken({ workspaceRoot: '' });
  assert.equal(cleared.ok, true);
  assert.equal(existsSync(configFilePath()), false, '本来没有配置就不该写出一个空对象（读侧会误判「配置过」）');
});
