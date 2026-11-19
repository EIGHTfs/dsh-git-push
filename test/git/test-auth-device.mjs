// lib/git/auth-device.js 的单测：注入假 fetch，覆盖 GitHub 的每一种返回 + 网络错误重试，
// 全程不碰网络、不碰磁盘、不真 sleep。
//
// 为什么断言这些而不是断言内部字段：Device Flow 的坑集中在**节奏**上——
//   slow_down 不真加间隔、过期不真停止、device_code 漏下发，三者都不会抛错，
//   只表现为「授权页点了 Authorize，界面还在转圈」。所以这里盯的是行为：
//   第几次请求、URL 长什么样、返回对象里有什么/没有什么、下一拍被要求等多久。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withMirror } from '../../lib/core/endpoints.js';
import {
  DEVICE_FLOW_STATE as STATE,
  createDeviceFlowSession,
  isTerminalDeviceFlowState,
  nextIntervalAfterSlowDown,
} from '../../lib/git/auth-device.js';

const CLIENT_ID = 'Iv1.demoClientId';
const DEVICE_CODE = 'device-code-abcdef0123456789';
const ACCESS_TOKEN = 'gho_demoAccessToken0123456789';

// GitHub 的 device flow 无论成败都回 200 + JSON（失败放在 error 字段里），
//   所以假响应默认 200；只有模拟中间层故障（5xx/网关）时才用别的状态码。
const jsonResponse = (body, status = 200) => ({ status, json: async () => body });

const deviceCodeResponse = (over = {}) => jsonResponse({
  device_code: DEVICE_CODE,
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  verification_uri_complete: 'https://github.com/login/device?user_code=WDJB-MJHT',
  expires_in: 900,
  interval: 5,
  ...over,
});

const tokenResponse = (over = {}) => jsonResponse({
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  scope: 'repo,workflow',
  ...over,
});

const errorResponse = (error) => jsonResponse({ error, error_description: `${error} (stub)` });

// 按序返回的假 fetch：第 n 次调用取 steps[n]（越界复用最后一个）。
//   steps 元素既可以是响应对象，也可以是 (url, options) => 响应 的函数（用来抛错模拟断网）。
function fakeFetchSequence(steps) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({
      url,
      method: options.method,
      headers: { ...(options.headers || {}) },
      fields: new URLSearchParams(String(options.body || '')),
    });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return typeof step === 'function' ? step(url, options) : step;
  };
  return { impl, calls };
}

// 注入时钟：时间由用例推进，sleep 只记录「被要求等多久」，不真等。
function createTestClock(startEpochMs = 1_700_000_000_000) {
  let currentEpochMs = startEpochMs;
  const sleepRequests = [];
  return {
    now: () => currentEpochMs,
    sleep: async (ms) => { sleepRequests.push(ms); },
    advanceTo(epochMs) { currentEpochMs = epochMs; },
    advanceBy(ms) { currentEpochMs += ms; },
    sleepRequests,
    get currentEpochMs() { return currentEpochMs; },
  };
}

const disconnected = () => { throw new Error('ECONNRESET'); };

function makeSession(clock, fake, over = {}) {
  return createDeviceFlowSession({ clientId: CLIENT_ID, fetchImpl: fake.impl, now: clock.now, sleep: clock.sleep, ...over });
}

test('申请设备码：form-urlencoded + Accept: application/json，返回 await_user 且不下发 device_code', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse()]);
  const started = await makeSession(clock, fake).start();

  const call = fake.calls[0];
  assert.equal(call.url, 'https://github.com/login/device/code');
  assert.equal(call.method, 'POST');
  // 缺 Accept: application/json 时 GitHub 回 form-urlencoded 文本，JSON 解析必错
  assert.equal(call.headers.Accept, 'application/json');
  assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(call.fields.get('client_id'), CLIENT_ID);
  assert.equal(call.fields.get('scope'), 'repo,workflow', '默认 scope 必须带 workflow，否则含 CI 配置的推送会被整推拒绝');

  assert.equal(started.state, STATE.AWAITING_USER);
  assert.equal(started.userCode, 'WDJB-MJHT');
  assert.equal(started.verificationUri, 'https://github.com/login/device');
  // 预填短码的地址要透出去，UI 才能做「一键打开授权页」
  assert.equal(started.verificationUriComplete, 'https://github.com/login/device?user_code=WDJB-MJHT');
  assert.equal(started.expiresInMs, 900 * 1000);
  assert.equal(started.intervalMs, 5 * 1000);
  assert.equal(started.nextPollAtEpochMs, clock.currentEpochMs + 5 * 1000);
  // 设备码等价于「进行中的一次性凭据」，任何对外对象都不能含它
  assert.equal('device_code' in started, false);
  assert.equal('deviceCode' in started, false);
  assert.ok(!JSON.stringify(started).includes(DEVICE_CODE), 'device_code 不得出现在对外对象里');
});

test('authorization_pending：保持 awaiting_user，且每拍都按协议带上 grant_type 与 device_code', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse(), errorResponse('authorization_pending')]);
  const session = makeSession(clock, fake);

  const started = await session.start();
  clock.advanceTo(started.nextPollAtEpochMs);
  const polled = await session.poll();

  assert.equal(polled.state, STATE.AWAITING_USER);
  assert.equal(polled.ok, false, 'pending 只是进行中，不是成功');
  const fields = fake.calls[1].fields;
  assert.equal(fake.calls[1].url, 'https://github.com/login/oauth/access_token');
  assert.equal(fields.get('client_id'), CLIENT_ID);
  assert.equal(fields.get('device_code'), DEVICE_CODE);
  assert.equal(fields.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
  assert.ok(!JSON.stringify(polled).includes(DEVICE_CODE), '轮询结果同样不得含 device_code');
});

test('slow_down：interval 永久 +5s，且下一次轮询真的按新间隔节流', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([
    deviceCodeResponse(),
    errorResponse('slow_down'),
    errorResponse('authorization_pending'),
  ]);
  const session = makeSession(clock, fake);

  const started = await session.start();
  clock.advanceTo(started.nextPollAtEpochMs);
  const slowed = await session.poll();

  assert.equal(slowed.state, STATE.AWAITING_USER);
  assert.equal(slowed.intervalMs, 10 * 1000, 'slow_down 后间隔应为 5s + 5s');
  const firstPollAtEpochMs = started.nextPollAtEpochMs;
  assert.equal(slowed.nextPollAtEpochMs, firstPollAtEpochMs + 10 * 1000, '下一拍必须按新间隔推迟');

  // 关键断言：下一轮用的是**新**间隔——走到旧的 5s 点时不得发请求
  const callsAfterSlowDown = fake.calls.length;
  clock.advanceTo(firstPollAtEpochMs + 5 * 1000);
  const tooEarly = await session.poll();
  assert.equal(tooEarly.state, STATE.AWAITING_USER);
  assert.equal(tooEarly.throttled, true, '未到新间隔应只回节流标记');
  assert.equal(fake.calls.length, callsAfterSlowDown, '节流时不得请求上游');

  // 到了新间隔点才发请求，且间隔继续保持 10s（永久生效，不是只延一次）
  clock.advanceTo(slowed.nextPollAtEpochMs);
  const next = await session.poll();
  assert.equal(fake.calls.length, callsAfterSlowDown + 1);
  assert.equal(next.intervalMs, 10 * 1000, '间隔改动必须跨轮次保留');
  assert.equal(next.nextPollAtEpochMs, slowed.nextPollAtEpochMs + 10 * 1000);
});

test('成功：authorized + access_token 交给调用方，返回对象里没有 device_code', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse(), tokenResponse()]);
  const session = makeSession(clock, fake);

  const started = await session.start();
  clock.advanceTo(started.nextPollAtEpochMs);
  const granted = await session.poll();

  assert.equal(granted.state, STATE.AUTHORIZED);
  assert.equal(granted.ok, true);
  assert.equal(granted.accessToken, undefined, 'publicView 不得含 access_token（它会直接下发浏览器）');
  assert.equal(granted.tokenGranted, true, '只用一个布尔位表达「已拿到」');
  assert.ok(!JSON.stringify(granted).includes(ACCESS_TOKEN), '整个下发视图不得出现 token 明文');
  const credentials = session.takeAccessToken();
  assert.equal(credentials.accessToken, ACCESS_TOKEN, '凭据经 takeAccessToken 交给服务端调用方');
  assert.equal(credentials.tokenType, 'bearer');
  assert.equal(credentials.grantedScope, 'repo,workflow');
  assert.equal('device_code' in granted, false);
  assert.equal('deviceCode' in granted, false);
  assert.ok(!JSON.stringify(granted).includes(DEVICE_CODE), '成功后同样不得回吐 device_code');

  // 授权完成后本模块不再请求上游（token 已交给调用方去持久化）
  const callsAfterGrant = fake.calls.length;
  clock.advanceBy(60 * 1000);
  await session.poll();
  assert.equal(fake.calls.length, callsAfterGrant, 'authorized 是终态，不再轮询');
});

test('access_denied：denied，且终态之后不再发请求', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse(), errorResponse('access_denied')]);
  const session = makeSession(clock, fake);

  const started = await session.start();
  clock.advanceTo(started.nextPollAtEpochMs);
  const denied = await session.poll();

  assert.equal(denied.state, STATE.DENIED);
  assert.equal(denied.ok, false);
  assert.match(denied.reason, /拒绝/);

  const callsAfterDenied = fake.calls.length;
  clock.advanceBy(60 * 1000);
  const again = await session.poll();
  assert.equal(again.state, STATE.DENIED);
  assert.equal(fake.calls.length, callsAfterDenied, 'denied 是终态，不得继续打上游');
});

test('expired_token：expired 并清掉 device_code，后续不再请求', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse(), errorResponse('expired_token')]);
  const session = makeSession(clock, fake);

  const started = await session.start();
  clock.advanceTo(started.nextPollAtEpochMs);
  const expired = await session.poll();

  assert.equal(expired.state, STATE.EXPIRED);
  assert.match(expired.reason, /过期/);

  const callsAfterExpired = fake.calls.length;
  clock.advanceBy(60 * 1000);
  await session.poll();
  assert.equal(fake.calls.length, callsAfterExpired, 'expired 是终态，不得继续打上游');
});

test('expires_in 到点：即使上游从未回 expired_token 也判 expired 并停止轮询', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse()]);
  const session = makeSession(clock, fake);

  const started = await session.start();
  clock.advanceTo(started.expiresAtEpochMs); // 900s 到点
  const out = await session.poll();

  assert.equal(out.state, STATE.EXPIRED);
  assert.equal(fake.calls.length, 1, '到点后不得再请求上游（否则就是无限轮询）');

  clock.advanceBy(60 * 1000);
  await session.poll();
  assert.equal(fake.calls.length, 1, '过期后继续 poll 也不得发请求');
});

test('网络错误：重试 3 次（共 4 次请求）后判 failed，之后不再请求', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse(), disconnected]);
  const session = makeSession(clock, fake);

  const started = await session.start();
  clock.advanceTo(started.nextPollAtEpochMs);
  const failed = await session.poll();

  assert.equal(failed.state, STATE.FAILED);
  assert.match(failed.reason, /ECONNRESET/);
  assert.equal(fake.calls.length, 1 + 4, '首次 + 3 次重试，必须有次数上限');
  assert.deepEqual(clock.sleepRequests, [1000, 2000, 4000], '退避必须是 1s / 2s / 4s');

  const callsAfterFailed = fake.calls.length;
  clock.advanceBy(60 * 1000);
  await session.poll();
  assert.equal(fake.calls.length, callsAfterFailed, 'failed 是终态，不得无限重试');
});

test('网络错误：中途恢复则照常拿到 token（一次抖动不判死）', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse(), disconnected, tokenResponse()]);
  const session = makeSession(clock, fake);

  const started = await session.start();
  clock.advanceTo(started.nextPollAtEpochMs);
  const granted = await session.poll();

  assert.equal(granted.state, STATE.AUTHORIZED);
  assert.equal(granted.accessToken, undefined, '网络抖动恢复后同样不得把凭据放进下发视图');
  assert.equal(session.takeAccessToken().accessToken, ACCESS_TOKEN, '凭据仍能经 takeAccessToken 取到');
  assert.deepEqual(clock.sleepRequests, [1000], '只退避一次就成功');
});

test('认证端点显式不走镜像：即使镜像前缀已开启，请求仍直连 github.com', async () => {
  const previousPrefix = process.env.DSH_GIT_MIRROR_PREFIX;
  process.env.DSH_GIT_MIRROR_PREFIX = 'https://mirror.example/';
  try {
    // 对照组：镜像开着时，普通 GET 确实会被改写成镜像地址——说明下面的直连断言不是空转
    const wouldRewrite = withMirror('https://github.com/login/device/code') !== 'https://github.com/login/device/code';
    assert.equal(wouldRewrite, true, '对照组失败：镜像未生效，本条断言失去意义');

    const clock = createTestClock();
    const fake = fakeFetchSequence([deviceCodeResponse()]);
    await makeSession(clock, fake).start();
    assert.equal(fake.calls[0].url, 'https://github.com/login/device/code', '认证请求绝不能经第三方镜像');
  } finally {
    if (previousPrefix === undefined) delete process.env.DSH_GIT_MIRROR_PREFIX;
    else process.env.DSH_GIT_MIRROR_PREFIX = previousPrefix;
  }
});

test('缺 clientId / 未注入 fetchImpl：直接 failed，且不发任何请求', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse()]);

  const noClientId = await makeSession(clock, fake, { clientId: '' }).start();
  assert.equal(noClientId.state, STATE.FAILED);
  assert.match(noClientId.reason, /clientId/);

  const noFetch = await createDeviceFlowSession({ clientId: CLIENT_ID, now: clock.now, sleep: clock.sleep }).start();
  assert.equal(noFetch.state, STATE.FAILED);
  assert.match(noFetch.reason, /fetchImpl/);

  assert.equal(fake.calls.length, 0, '前置条件不满足时不得请求上游');
});

test('未 start 就 poll：保持 idle 且不发请求（调用顺序错不错乱都能兜住）', async () => {
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse()]);
  const out = await makeSession(clock, fake).poll();

  assert.equal(out.state, STATE.IDLE);
  assert.equal(out.ok, false);
  assert.equal(fake.calls.length, 0);
});

test('纯函数：nextIntervalAfterSlowDown 每次 +5s；终态判定只认四个终态', () => {
  assert.equal(nextIntervalAfterSlowDown(5 * 1000), 10 * 1000);
  assert.equal(nextIntervalAfterSlowDown(10 * 1000), 15 * 1000);
  assert.equal(nextIntervalAfterSlowDown(0), 10 * 1000, '缺 interval 时按兜底 5s 起算');

  for (const state of ['authorized', 'denied', 'expired', 'failed']) {
    assert.equal(isTerminalDeviceFlowState(state), true, `${state} 应为终态`);
  }
  for (const state of ['idle', 'awaiting_user', '']) {
    assert.equal(isTerminalDeviceFlowState(state), false, `${state} 不应为终态`);
  }
});

test('安全边界：authorized 之后 snapshot() 也不含 token 明文（凭据只走 takeAccessToken）', async () => {
  // 为什么要单独锁这一条：snapshot() 是「状态查询」类端点最省事的取值方式，
  //   最容易被直接塞进 HTTP 响应。它与 poll() 共用同一个下发视图，
  //   一旦有人图省事把凭据塞回 publicView，两条出口会一起漏——所以两条出口都要有断言。
  const clock = createTestClock();
  const fake = fakeFetchSequence([deviceCodeResponse(), tokenResponse()]);
  const session = makeSession(clock, fake);

  const started = await session.start();
  clock.advanceTo(started.nextPollAtEpochMs);
  await session.poll();

  const snapshot = session.snapshot();
  assert.equal(snapshot.state, STATE.AUTHORIZED);
  assert.equal(snapshot.tokenGranted, true, '用布尔位表达「已授权」，不含凭据内容');
  assert.equal(snapshot.accessToken, undefined, 'snapshot 不得含 access_token');
  assert.ok(!JSON.stringify(snapshot).includes(ACCESS_TOKEN), 'snapshot 序列化后不得出现 token 明文');
  assert.equal(session.takeAccessToken().accessToken, ACCESS_TOKEN, '凭据仍可从服务端专用入口取到');
});
