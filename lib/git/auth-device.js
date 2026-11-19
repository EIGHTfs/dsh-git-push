// GitHub OAuth Device Flow（设备码授权）· 纯逻辑核心：申请设备码 + 轮询换 token。
//
// 为什么单独切这一个文件：整条授权链路里**只有这里带状态**——
//   idle → awaiting_user → authorized / denied / expired / failed，
//   且 slow_down 会改变轮询节奏。协议分支多、写错不报错（只表现为「一直等不到授权」），
//   所以做成依赖可注入的纯逻辑，才能用假 fetch 把 GitHub 的每种返回都跑一遍。
//
// 依赖只有 ../core/endpoints.js（GitHub web 基址 + 镜像闸门）。fetch / 时钟 / sleep 全部由
//   调用方注入：不取全局 fetch、不读配置文件、不落盘，单测因此不碰网络与磁盘。
//   唯一的间接读发生在 authEndpointUrl() 里的 withMirror，但 noMirror 分支在拼前缀之前
//   返回，结果与环境无关。
//
// 三条硬约束（违反任一条都是静默故障）：
//   ① device_code 只活在本模块的闭包里，任何对外返回对象都不含它——
//      它等价于「授权进行中的一次性凭据」，下发到浏览器就等于公开；
//   ② 不写 token：拿到 access_token 后原样交回调用方，由调用方走
//      lib/core/credentials.js 的 persistGithubToken() 写入 config.json 的 githubToken 键
//      （全插件 20+ 处读取点只认那个键，另开存储位会让它们一处都读不到）；
//   ③ 认证请求显式 noMirror：理由见 authEndpointUrl() 上方注释。

import { GH_WEB, withMirror } from '../core/endpoints.js';

// 状态机六态（对外以字符串出现，调用方按它分支；顺序即生命周期顺序）。
export const DEVICE_FLOW_STATE = Object.freeze({
  IDLE: 'idle',
  AWAITING_USER: 'awaiting_user',
  AUTHORIZED: 'authorized',
  DENIED: 'denied',
  EXPIRED: 'expired',
  FAILED: 'failed',
});

// 默认权限范围必须带 workflow：只给 repo 时，推送里一旦含 .github/workflows/*，GitHub 会
//   **拒绝整个 push**（refusing to allow an OAuth App to create or update workflow …），
//   报错文本读起来像「凭据失效」。workflow 只影响改 CI 配置，对单机单用户是合理范围。
export const DEFAULT_SCOPE = 'repo,workflow';

// 两条端点路径（拼在 GH_WEB 之后，不写死完整域名，避免与镜像/基址口径漂移）。
const DEVICE_CODE_PATH = '/login/device/code';
const ACCESS_TOKEN_PATH = '/login/oauth/access_token';

// RFC 8628 规定的 grant_type 固定值；写错会被当成未知授权类型。
const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

// GitHub 在 **200 响应体**里用 error 字段表达失败（不是 HTTP 状态码），这是四个已知取值。
const DEVICE_FLOW_ERROR = Object.freeze({
  AUTHORIZATION_PENDING: 'authorization_pending',
  SLOW_DOWN: 'slow_down',
  ACCESS_DENIED: 'access_denied',
  EXPIRED_TOKEN: 'expired_token',
});

const MS_PER_SECOND = 1000;

// slow_down 时轮询间隔**永久** +5s（协议明文规定，不是只延一拍）。
//   只延一次的话下一拍依旧太快，GitHub 会继续回 slow_down——越轮越慢、永远追不上。
const SLOW_DOWN_STEP_MS = 5 * MS_PER_SECOND;

// 设备码有效期兜底 900s：GitHub 固定返回 expires_in=900，仅当响应缺该字段时使用。
const FALLBACK_DEVICE_CODE_TTL_MS = 900 * MS_PER_SECOND;

// 轮询间隔兜底 5s：同上，仅当响应缺 interval 时使用。
const FALLBACK_POLL_INTERVAL_MS = 5 * MS_PER_SECOND;

// 网络失败的重试：首次之外再试 3 次，退避 1s / 2s / 4s（最坏多等 7s）。
//   必须有上限——无上限重试会让一次登录在网络抖动时永远停不下来，
//   而界面只会显示「等待授权中」，把「网络不通」伪装成「还没点授权」。
const NETWORK_RETRY_LIMIT = 3;
const NETWORK_RETRY_BASE_DELAY_MS = 1 * MS_PER_SECOND;
const NETWORK_RETRY_BACKOFF_FACTOR = 2;

const TERMINAL_STATES = new Set([
  DEVICE_FLOW_STATE.AUTHORIZED,
  DEVICE_FLOW_STATE.DENIED,
  DEVICE_FLOW_STATE.EXPIRED,
  DEVICE_FLOW_STATE.FAILED,
]);

// GitHub 的秒级字段换算成毫秒；缺字段/非法值退回兜底（0 秒有效期会让首次轮询直接判过期）。
function secondsToMs(seconds, fallbackMs) {
  const numericSeconds = Number(seconds);
  return Number.isFinite(numericSeconds) && numericSeconds > 0 ? numericSeconds * MS_PER_SECOND : fallbackMs;
}

function errorMessageOf(error) {
  const text = String((error && error.message) || error || '').trim();
  return text || '未知网络错误';
}

// 认证端点的 URL——一律显式 noMirror。withMirror 默认把 https://github.com/ 前缀改写成
//   第三方镜像；设备码请求带 client_id、换 token 带 device_code 并回 access_token，
//   任一条经镜像中继都等于把 OAuth 凭据交给第三方。
// 为什么不只靠方法闸门：这两条都是 POST，会被「非 GET 不镜像」天然拦住，但那是隐式的——
//   将来有人为复用把它改成 GET，闸门就放行了。noMirror + mode:'write' 钉死在调用点上。
// 附带收益：noMirror 在拼前缀之前返回，故无论镜像配置怎么变，认证请求始终直连。
function authEndpointUrl(pathname) {
  return withMirror(`${GH_WEB}${pathname}`, { method: 'POST', mode: 'write', noMirror: true });
}

// 终态判定（对外暴露，让上层决定「要不要继续轮询」「要不要显示重试按钮」）。
export function isTerminalDeviceFlowState(state) {
  return TERMINAL_STATES.has(String(state || ''));
}

// slow_down 的间隔演进：每次 +5s，且改动对后续所有轮次生效。
//   抽成纯函数，便于单测单独锁死这条最容易写错的协议细节。
export function nextIntervalAfterSlowDown(intervalMs) {
  const current = Number(intervalMs) > 0 ? Number(intervalMs) : FALLBACK_POLL_INTERVAL_MS;
  return current + SLOW_DOWN_STEP_MS;
}

// 建一个授权会话：start() 申请设备码，poll() 轮询换 token，snapshot() 同步读当前状态。
//
// 为什么用「会话对象」而不是一对散函数：device_code 必须留在模块内部（不能出现在任何返回值里），
//   而 expires_in / interval 是**跨轮次演进**的状态。会话把这两件事收进闭包，
//   调用方只拿到可安全下发的展示字段。
//
// @param {{clientId?:string, scope?:string, fetchImpl?:Function,
//          now?:Function, sleep?:Function}} options
//   clientId  OAuth App 的公开客户端 ID（Device Flow 不需要 client_secret）
//   scope     权限范围，缺省 DEFAULT_SCOPE
//   fetchImpl 注入的 fetch（形如全局 fetch；本模块不自己取全局对象）
//   now       毫秒时钟，注入后可在单测里推进时间
//   sleep     等待函数，注入后可在单测里免等
// @returns {{start:Function, poll:Function, snapshot:Function}}
export function createDeviceFlowSession({
  clientId = '',
  scope = DEFAULT_SCOPE,
  fetchImpl,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const oauthClientId = String(clientId || '').trim();
  const requestedScope = String(scope || '').trim() || DEFAULT_SCOPE;

  let currentState = DEVICE_FLOW_STATE.IDLE;
  let failureReason = '';
  // 只在本闭包里流转的两样东西：进行中的设备码、正在飞的那次轮询。
  //   inflightPoll 让「同一时刻的多次 poll」共享一次上游请求（多标签页同时轮询的兜底，
  //   否则并发请求会把 GitHub 的 slow_down 顶上来）。
  let deviceCode = '';
  let inflightPoll = null;
  // 会话代次：每次重新开始（或首次开始）自增。在飞的请求落地时若代次已变，
  //   说明它的结果属于上一轮设备码——必须丢弃，否则「点了重新开始」会被旧响应
  //   改回 expired/denied，表现为「刚重开就说超时」。
  let sessionGeneration = 0;

  let userCode = '';
  let verificationUri = '';
  let verificationUriComplete = '';
  let expiresInMs = 0;
  let expiresAtEpochMs = 0;
  let pollIntervalMs = 0;
  let nextPollAtEpochMs = 0;
  let grantedToken = '';
  let grantedScope = '';
  let tokenType = '';

  // 白名单式构造对外视图：**device_code 与 access_token 都不在里面**。
  //   这个对象会被 HTTP 层直接下发给浏览器，所以只能装「展示用」字段。
  //   凭据一律走下面的 takeAccessToken() 由服务端自己取——同类事故的教训是：
  //   只要让凭据出现在「会被序列化下发」的结构里，就会有一条路径把它送出去
  //   （评审里 B4′ 那条：redactConfig 只删顶层键，嵌套凭据就明文出门了）。
  //   tokenGranted 只表达「拿到了」，供界面渲染成功态，不含任何凭据内容。
  function publicView(extra = {}) {
    return {
      ok: false,
      state: currentState,
      reason: failureReason,
      userCode,
      verificationUri,
      verificationUriComplete,
      expiresInMs,
      expiresAtEpochMs,
      intervalMs: pollIntervalMs,
      nextPollAtEpochMs,
      throttled: false,
      tokenGranted: !!grantedToken,
      ...extra,
    };
  }

  // 重新开始 = 旧设备码与旧节流一起作废：留着会让上一轮的 device_code 继续被轮询。
  function resetIssuedState() {
    sessionGeneration += 1;
    deviceCode = '';
    inflightPoll = null;
    userCode = '';
    verificationUri = '';
    verificationUriComplete = '';
    expiresInMs = 0;
    expiresAtEpochMs = 0;
    pollIntervalMs = 0;
    nextPollAtEpochMs = 0;
    grantedToken = '';
    grantedScope = '';
    tokenType = '';
    failureReason = '';
  }

  // 单次 HTTP 请求。JSON 解析失败与 HTTP 非 2xx 都按「可重试的临时故障」抛出去，
  //   交给 requestWithRetry 决定退避；协议层失败（error 字段）是 200 正常响应，不在这里处理。
  async function postForm(pathname, formFields) {
    const response = await fetchImpl(authEndpointUrl(pathname), {
      method: 'POST',
      headers: {
        // 不带 Accept: application/json 时 GitHub 回 form-urlencoded 文本，按 JSON 解析必错
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'dsh-git-push',
      },
      body: new URLSearchParams(formFields).toString(),
    });
    const status = Number((response && response.status) || 0);
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status || 'unknown'}`);
    return await response.json();
  }

  async function requestWithRetry(pathname, formFields) {
    let lastError = '';
    for (let attempt = 1; attempt <= NETWORK_RETRY_LIMIT + 1; attempt += 1) {
      try {
        return { ok: true, body: await postForm(pathname, formFields) };
      } catch (error) {
        lastError = errorMessageOf(error);
        if (attempt > NETWORK_RETRY_LIMIT) break;
        await sleep(NETWORK_RETRY_BASE_DELAY_MS * NETWORK_RETRY_BACKOFF_FACTOR ** (attempt - 1));
      }
    }
    return { ok: false, error: lastError };
  }

  // 把失败统一成「置状态 + 记原因 + 回快照」三步，避免每个失败分支各写三行再各自漂移。
  function failWith(reason) {
    currentState = DEVICE_FLOW_STATE.FAILED;
    failureReason = reason;
    return publicView();
  }

  // 把设备码响应记进闭包状态；缺 device_code 视为失败（没有它无法轮询，留着只会空转）。
  function recordIssuedDeviceCode(issuedBody) {
    deviceCode = String(issuedBody.device_code || '');
    if (!deviceCode) return false;
    userCode = String(issuedBody.user_code || '');
    verificationUri = String(issuedBody.verification_uri || `${GH_WEB}/login/device`);
    // 预填短码的地址：界面据此做「一键打开授权页」；手抄路径保留给另一台设备上操作的场景。
    verificationUriComplete = String(issuedBody.verification_uri_complete || '');
    expiresInMs = secondsToMs(issuedBody.expires_in, FALLBACK_DEVICE_CODE_TTL_MS);
    pollIntervalMs = secondsToMs(issuedBody.interval, FALLBACK_POLL_INTERVAL_MS);
    const issuedAtEpochMs = now();
    expiresAtEpochMs = issuedAtEpochMs + expiresInMs;
    nextPollAtEpochMs = issuedAtEpochMs + pollIntervalMs;
    return true;
  }

  // 申请设备码：拿到 device_code（只入闭包）+ 给界面看的短码与授权地址。
  async function start() {
    // 缺 clientId 时**先**拦下：GitHub 对空 client_id 只回一个 404，界面上会变成
    //   「网络/服务器异常」，掩盖真正的「还没配 OAuth App」。
    if (!oauthClientId) {
      resetIssuedState();
      return failWith('缺 clientId：需要在 OAuth App 里开启 Device Flow 并把客户端 ID 填进配置');
    }
    if (typeof fetchImpl !== 'function') {
      resetIssuedState();
      return failWith('未注入 fetchImpl：本模块不取全局 fetch');
    }
    resetIssuedState();
    // 请求在飞时状态仍是 idle：此间若有 poll 进来，回 idle 快照而不是发一个没有设备码的请求。
    currentState = DEVICE_FLOW_STATE.IDLE;
    const generationAtStart = sessionGeneration;
    const issued = await requestWithRetry(DEVICE_CODE_PATH, {
      client_id: oauthClientId,
      scope: requestedScope,
    });
    // 连按两次「重新开始」时后一次已重置状态，先返回的那份设备码必须丢弃——
    //   否则界面显示的短码与闭包里留存的设备码不一致，在那串码上授权永远换不到 token。
    if (generationAtStart !== sessionGeneration) return publicView();
    if (!issued.ok) return failWith(`申请设备码失败：${issued.error}`);
    if (!recordIssuedDeviceCode(issued.body || {})) return failWith('申请设备码失败：响应里没有 device_code');
    currentState = DEVICE_FLOW_STATE.AWAITING_USER;
    return publicView({ ok: true });
  }

  // 一次轮询：终止态回快照、未到 nextPollAt 只回节流标记，只有够点的那一路打上游。
  async function poll() {
    if (isTerminalDeviceFlowState(currentState)) return publicView();
    if (currentState !== DEVICE_FLOW_STATE.AWAITING_USER || !deviceCode) return publicView();
    // expires_in 是硬上限：到点必须停并清掉设备码，否则会无限轮询下去等一个永远不会来的 token。
    if (now() >= expiresAtEpochMs) {
      currentState = DEVICE_FLOW_STATE.EXPIRED;
      failureReason = '授权超时：设备码已过期，请重新开始授权';
      deviceCode = '';
      return publicView();
    }
    // 节流放服务端（不交前端定时器）：多窗口/多标签同时 poll 也只打一次上游。
    if (now() < nextPollAtEpochMs) return publicView({ throttled: true });
    if (inflightPoll) return inflightPoll;
    inflightPoll = runPollRequest(sessionGeneration);
    try {
      return await inflightPoll;
    } finally {
      inflightPoll = null;
    }
  }

  async function runPollRequest(generationAtPoll) {
    const polledAtEpochMs = now();
    const polled = await requestWithRetry(ACCESS_TOKEN_PATH, {
      client_id: oauthClientId,
      device_code: deviceCode,
      grant_type: DEVICE_CODE_GRANT_TYPE,
    });
    // 结果属于上一轮设备码（期间重新开始过）：直接丢弃，一段状态都不改。
    if (generationAtPoll !== sessionGeneration) return publicView();
    // 下一拍从**请求发起时刻**起算（不是响应时刻）：慢网络下用响应时刻会把周期越拖越长。
    nextPollAtEpochMs = polledAtEpochMs + pollIntervalMs;
    if (!polled.ok) {
      currentState = DEVICE_FLOW_STATE.FAILED;
      failureReason = `网络异常：${polled.error}`;
      deviceCode = '';
      return publicView();
    }
    return applyPollBody(polled.body || {}, polledAtEpochMs);
  }

  // 按响应体里的 error / access_token 推进状态机。
  function applyPollBody(polledBody, polledAtEpochMs) {
    const errorCode = String(polledBody.error || '');
    if (errorCode === DEVICE_FLOW_ERROR.AUTHORIZATION_PENDING) {
      return publicView();
    }
    if (errorCode === DEVICE_FLOW_ERROR.SLOW_DOWN) {
      // 永久 +5s，并把新的间隔写进返回状态，供下一次轮询继续用（只延一次会一直慢半拍）。
      pollIntervalMs = nextIntervalAfterSlowDown(pollIntervalMs);
      nextPollAtEpochMs = polledAtEpochMs + pollIntervalMs;
      return publicView();
    }
    if (errorCode === DEVICE_FLOW_ERROR.ACCESS_DENIED) {
      currentState = DEVICE_FLOW_STATE.DENIED;
      failureReason = '授权被拒绝：授权页上没有点 Authorize';
      deviceCode = '';
      return publicView();
    }
    if (errorCode === DEVICE_FLOW_ERROR.EXPIRED_TOKEN) {
      currentState = DEVICE_FLOW_STATE.EXPIRED;
      failureReason = '授权超时：设备码已过期，请重新开始授权';
      deviceCode = '';
      return publicView();
    }
    const token = String(polledBody.access_token || '');
    if (token) {
      // token 形如 gho_…（OAuth access token）。本模块不校验前缀、不落盘：
      //   持久化归调用方（persistGithubToken 写 config.json 的 githubToken 键）。
      //   注意现有校验正则 ^(gh[pous]_|github_pat_) 的字符类含 o，gho_ 能过——
      //   将来收紧前缀白名单时别把它排除掉，否则 Device Flow 会整体失效。
      grantedToken = token;
      grantedScope = String(polledBody.scope || '');
      tokenType = String(polledBody.token_type || '');
      currentState = DEVICE_FLOW_STATE.AUTHORIZED;
      deviceCode = '';
      return publicView({ ok: true });
    }
    // 既无 token 也无已知 error：如实判失败，不假装「还在等」（否则界面空转到倒计时结束才报超时）。
    currentState = DEVICE_FLOW_STATE.FAILED;
    failureReason = `未识别的授权响应：${errorCode || '缺少 access_token'}`;
    deviceCode = '';
    return publicView();
  }

  return {
    start,
    poll,
    // 同步读当前状态（渲染、状态查询端点用；不含 device_code 与 access_token，也不触发任何请求）。
    snapshot: () => publicView(),
    // 读取授权得到的凭据——**只给服务端内部调用方**（如 HTTP handler 落盘后即用即弃）。
    //   与 publicView 分开是硬边界：凡是「可能被序列化下发」的结构都不许带凭据，
    //   调用方拿到后应立刻交给 persistGithubToken() 写入 config.json 的 githubToken 键，
    //   不得原样塞进任何 HTTP 响应或日志。
    //   语义是「读」而不是「消费」：重复调用返回同一份，落盘失败时可以直接重试；
    //   清空统一由 resetIssuedState() 负责（只在重新开始授权时清）。不在这里取走即清，
    //   否则调用方第二次取值会拿到 undefined，变成一种很难查的静默失败。
    takeAccessToken: () => ({ accessToken: grantedToken, tokenType, grantedScope }),
  };
}
