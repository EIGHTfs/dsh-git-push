/**
 * HTTP 处理层 · GitHub 授权端点（Device Flow）
 *
 * 四个端点：device/start（申请设备码）· device/poll（轮询换 token）·
 *   auth/status（读当前授权态）· auth/revoke（清本地凭据）。
 *
 * 两件事决定了本文件长这个形状：
 *
 * ① **会话必须是进程内单例**。start 与之后的 poll 是两次独立 HTTP 请求，而 device_code
 *    只活在上游 auth-device 的闭包里（对外仅给展示字段）——不跨请求持有会话实例，poll
 *    就永远拿不到设备码可换。单机单实例够用；多标签页并发由会话内部的 inflightPoll 兜住。
 *
 * ② **凭据只能有一个出口**。响应体一律取 publicView / snapshot（不含 token、不含 device_code）；
 *    takeAccessToken() 的结果只喂给 persistGithubToken() → config.json 的 githubToken 键。
 *    全插件 token 读取只有一个入口 resolveToken()、20+ 处消费点都只认那个键，所以这里
 *    绝不另开存储位：省下的是一次改动，代价是二十处读不到（静默故障）。
 */

import { request as httpsRequest } from 'node:https';

import {
  DEFAULT_SCOPE, DEVICE_FLOW_STATE, createDeviceFlowSession,
} from '../../git/auth-device.js';
import { clearGithubToken, persistGithubToken, resolveToken } from '../../core/credentials.js';
import { updateJsonAtomic } from '../../core/atomic-json.js';
import { GH_API } from '../../core/endpoints.js';
import { readAccountStatus } from '../../git/index.js';
import { readSettings, settingsFilePath } from '../settings-bridge.js';
import { rejectNonPostMethod } from '../../http/index.js';

/* ───────── 常量 ───────── */

/** 凭据来源三态（与 schema 里 githubAuth.mode 的取值同口径）。 */
const AUTH_MODE_NONE = 'none';
const AUTH_MODE_PAT = 'pat';
const AUTH_MODE_DEVICE_FLOW = 'device-flow';

/** 取登录名的路径与超时：登录名纯展示用，超时宁短不拖。 */
const GITHUB_PROFILE_PATH = '/user';
const GITHUB_PROFILE_TIMEOUT_MS = 8_000;

/** 请求 GitHub 时的 UA（GitHub 对无 UA 的请求可能回 403）。 */
const GITHUB_USER_AGENT = 'dsh-git-push';

/**
 * 插件内置的 OAuth App client_id（Device Flow 公开客户端）。
 *
 * 为什么可以内置：client_id **不是密钥**。Device Flow 没有 client_secret，而且这个值
 *   本来就会出现在授权页 URL（`github.com/login/device?user_code=…` 对应 App 的授权页）里，
 *   属于公开标识。gh CLI 等公开客户端也都是内置的。
 *
 * 为什么必须内置：让每个用户自己去建一个 OAuth App 是纯手续成本，也是「装上就能用」的
 *   最大障碍——本插件的用户多数只想把代码推上去，不该先学怎么注册 OAuth App。
 *
 * 为什么仍保留配置覆盖（它是 resolveClientId 里**最低**优先级）：
 *   · 内置 App 若被 GitHub 撤销，换新值发版即可，用户不必改配置；
 *   · 某些组织禁用第三方 OAuth App，此时用户可填自己组织的 App 顶上。
 */
export const BUILTIN_OAUTH_CLIENT_ID = 'Ov23lif56UrtoBgipIjB';

/**
 * 缺 clientId 的指引文案。
 * 为什么要把「怎么配」写进错误里：GitHub 对空 client_id 只回 404，界面上会变成
 *   「网络/服务器异常」，把真正的「还没建 OAuth App」盖掉（上游 auth-device 也有一条同样的前置拦截）。
 */
const MISSING_CLIENT_ID_REASON = '缺 clientId：插件内置的公开客户端不可用，'
  + '可在 config.json 的 githubAuth.clientId 填自己的 OAuth App ID 顶上（或随请求体传 clientId）';

/** 会话缺失时的说明（进程重启 / 尚未点开始授权，poll 早于 start 抵达）。 */
const NO_SESSION_REASON = '尚未开始授权：先调用 auth/device/start';

/* ───────── 进程内单例会话 ───────── */

let activeSession = null;
/** 当前会话绑定的 clientId 与 scope：配置变了就重建会话（见 ensureSession）。 */
let activeClientId = '';
let activeScope = '';
/** 本轮授权是否已落盘：避免重复 poll 反复写盘 + 反复查 GitHub /user。 */
let grantCommitted = false;

/**
 * 上游依赖注入点（测试与自检用）。
 * 生产路径全部取默认值：fetch 惰性取 globalThis.fetch，时钟取 Date.now()，sleep 取 setTimeout。
 * 抽成可替换的原因是授权链路**天然要打两次网络 + 等 5 秒节流**，不注入就没法在单测里
 * 跑「授权成功」这条主路径（否则要么真连 GitHub、要么真等满 5 秒）。
 */
let upstreamDeps = { fetchImpl: null, now: null, sleep: null };

/** 替换上游依赖（未给的项保持原值；传 null 恢复默认）。 */
export function setDeviceFlowUpstreamDeps(deps = {}) {
  upstreamDeps = {
    fetchImpl: deps.fetchImpl ?? upstreamDeps.fetchImpl,
    now: deps.now ?? upstreamDeps.now,
    sleep: deps.sleep ?? upstreamDeps.sleep,
  };
}

/**
 * 丢弃当前会话（auth/revoke 与测试用）。
 * 为什么要显式丢弃：撤销后若还留着进行中的会话，后续 poll 可能把一个刚被撤掉的
 *   设备码继续换出 token 写回去——用户看到「撤销成功」但凭据又回来了。
 */
export function resetDeviceFlowSession() {
  activeSession = null;
  activeClientId = '';
  activeScope = '';
  grantCommitted = false;
}

/** 取上游 fetch：注入优先，否则惰性取全局（不在模块加载时抓快照——宿主可能在晚于本模块初始化时才备好全局 fetch）。 */
/**
 * 上游请求：github.com 走「官方 IP 直连」，失败自动回退。
 *
 * 为什么必须做：本机 DNS 会把 github.com 解析到一个 HTTPS 走不通的地址（实测解析到
 *   57.155.223.240，请求 10 秒超时、curl 返回 000），而用官方 IP 直连 3.4 秒就正常回了
 *   设备码。Device Flow 的两个端点都只在 github.com 上（api.github.com 没有 device flow），
 *   所以不做这一步，本机的授权永远起不来，界面上表现为「申请授权失败：signal timed out」。
 *
 * 安全边界（重要）：**只用 IP 建 TCP 连接，SNI 与证书校验仍是 github.com**
 *   （https.request 的 servername 选项）。这不是「跳过证书校验」，只是换了个地址去连同一个
 *   域名——中间人依然无法冒充，因为证书必须匹配 github.com。
 *
 * 行为保证：
 *   · 只对 **github.com 本体**生效；api.github.com 等其它域名照常走 DNS（那些本来就通）；
 *   · 候选 IP 全失败时**回退直连**，网络正常的环境里行为与改动前一致；
 *   · 记住上次成功的 IP，避免每个请求都从头试（只有第一次可能多花一两秒）。
 * 候选地址可用 `DSH_GIT_PUSH_GITHUB_IP` 覆盖——官方 IP 会变，留个后门比写死更稳。
 */
const GITHUB_OFFICIAL_IPS = ['140.82.112.3', '20.27.177.113', '140.82.113.3'];
const UPSTREAM_REQUEST_TIMEOUT_MS = 10_000;
/** 上次成功建连的 IP：优先复用。空串表示还没有成功记录。 */
let preferredGithubIp = '';

/** 用指定 IP 建连、但 SNI/Host 仍为原域名（证书按域名校验，安全性不降级）。 */
function requestViaIp(hostIp, targetUrl, init = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const req = httpsRequest({
      host: hostIp,
      port: Number(target.port) || 443,
      path: `${target.pathname}${target.search}`,
      method: init.method || 'GET',
      servername: target.hostname,
      headers: { ...(init.headers || {}), host: target.hostname },
      timeout: UPSTREAM_REQUEST_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        // 只实现本模块真正用到的两个成员（status / json），刻意不假装是完整 Response，
        // 免得后来人以为这里支持 stream / headers.get。
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: async () => JSON.parse(text),
          text: async () => text,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('上游请求超时')));
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

/** 候选 IP 顺序：环境变量覆盖 → 上次成功的 → 内置清单（去重）。 */
function githubIpCandidates() {
  const fromEnv = String(process.env.DSH_GIT_PUSH_GITHUB_IP || '').trim();
  return [fromEnv, preferredGithubIp, ...GITHUB_OFFICIAL_IPS]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

async function githubPinnedFetch(url, init = {}) {
  const target = new URL(url);
  // 只接管 github.com 本体：其它域名（含 api.github.com）本来能通，不该被牵连
  if (target.hostname !== 'github.com') return globalThis.fetch(url, init);
  let lastError = null;
  for (const ip of githubIpCandidates()) {
    try {
      const response = await requestViaIp(ip, url, init);
      preferredGithubIp = ip;
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  // 候选全失败：回退直连。这样「偶尔 IP 变了」不会被放大成硬故障，
  //   而真网络正常的环境里本来就走得通这条路。
  try {
    return await globalThis.fetch(url, init);
  } catch (error) {
    throw lastError || error;
  }
}

function resolveUpstreamFetch() {
  if (typeof upstreamDeps.fetchImpl === 'function') return upstreamDeps.fetchImpl;
  return githubPinnedFetch;
}

/* ───────── 配置读取（clientId / scope 的真源） ───────── */

/** 读 config.json 的 githubAuth 元数据块（不存在/坏 JSON 按空块）。 */
function readGithubAuthMeta(env) {
  let settings = null;
  try { settings = readSettings(env || {}); } catch { settings = null; }
  const block = settings && typeof settings.githubAuth === 'object' && settings.githubAuth !== null
    ? settings.githubAuth
    : {};
  return block;
}

/**
 * 解析生效的 clientId：请求体 → 宿主内存 cfg → config.json → 内置公开客户端。
 * 请求体优先是为了让「换一个 OAuth App 试试」不必先改盘；cfg 优先于磁盘是因为宿主内存值
 *   才是运行期真值（刚保存尚未落盘/落盘失败的场景下，磁盘可能还是旧值）。
 * 内置值放**最后**：任何显式配置都必须压过它，否则「用自己组织的 App 顶上」就无从谈起。
 */
function resolveClientId(ctx) {
  const fromBody = String(ctx?.body?.clientId || '').trim();
  if (fromBody) return fromBody;
  const fromCfg = String(ctx?.cfg?.githubAuth?.clientId || '').trim();
  if (fromCfg) return fromCfg;
  const fromDisk = String(readGithubAuthMeta(ctx?.env).clientId || '').trim();
  if (fromDisk) return fromDisk;
  return BUILTIN_OAUTH_CLIENT_ID;
}

/** 解析生效的 scope：请求体 → cfg → config.json → 默认 repo,workflow。 */
function resolveScope(ctx) {
  const fromBody = String(ctx?.body?.scope || '').trim();
  if (fromBody) return fromBody;
  const fromCfg = String(ctx?.cfg?.githubAuth?.scope || '').trim();
  if (fromCfg) return fromCfg;
  const fromFile = String(readGithubAuthMeta(ctx?.env).scope || '').trim();
  return fromFile || DEFAULT_SCOPE;
}

/* ───────── 会话单例 ───────── */

function buildSessionOptions(clientId, scope) {
  const options = { clientId, scope, fetchImpl: resolveUpstreamFetch() };
  // 只在注入时才覆盖时钟/sleep：传 undefined 会让 auth-device 的默认值失效。
  if (typeof upstreamDeps.now === 'function') options.now = upstreamDeps.now;
  if (typeof upstreamDeps.sleep === 'function') options.sleep = upstreamDeps.sleep;
  return options;
}

/**
 * 取当前会话（必要时重建）。
 * 为什么「配置变了必须重建」：device_code 与 client_id 是绑定的。沿用旧会话去轮询，
 *   上游只会一直回 authorization_pending——表现为「明明点了授权，页面一直转」，
 *   而任何日志里都看不到「clientId 变了」这条线索。
 */
function ensureSession(clientId, scope) {
  if (activeSession && activeClientId === clientId && activeScope === scope) return activeSession;
  activeClientId = clientId;
  activeScope = scope;
  grantCommitted = false;
  activeSession = createDeviceFlowSession(buildSessionOptions(clientId, scope));
  return activeSession;
}

/* ───────── 元数据写入 ───────── */

/**
 * 写 githubAuth 元数据块（**键级合并**，原子读改写）。
 * 为什么不做整键覆盖：用户可能手填了 scope、或将来加了别的子键，整块覆盖会把它们一起抹掉
 *   （与 writePreCommitEnabled 对 preCommit.enabled 的处理同因）。
 * @returns {{ok:boolean, error?:string}}
 */
function writeGithubAuthMetadata(patch, env) {
  const file = settingsFilePath(env || {});
  const updated = updateJsonAtomic(file, (current) => {
    const block = current && typeof current.githubAuth === 'object' && current.githubAuth !== null
      ? current.githubAuth
      : {};
    return { ...current, githubAuth: { ...block, ...patch } };
  });
  return updated.ok ? { ok: true } : { ok: false, error: updated.error || '配置写入失败' };
}

/* ───────── 登录名查询（展示用） ───────── */

/**
 * 用刚拿到的 access token 查一次 GitHub 登录名。
 * 单独打一次 /user 的原因：GitHub 的换 token 响应里只有 access_token / scope / token_type，
 *   没有 login，而「这个 token 是谁的」正是 githubAuth.login 要展示的信息。
 * 失败一律返回空串：登录名纯展示，不能因为它让一次已成功的授权半途失败。
 * 走注入的 fetch（而非 git/api.js 的 githubFetch）是为了保持单测零网络，且此请求必须
 *   noMirror 直连——带凭据的请求绝不经过第三方镜像。
 */
async function fetchGithubLogin(accessToken) {
  const token = String(accessToken || '');
  if (!token) return '';
  try {
    const response = await resolveUpstreamFetch()(`${GH_API}${GITHUB_PROFILE_PATH}`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': GITHUB_USER_AGENT,
      },
      signal: AbortSignal.timeout(GITHUB_PROFILE_TIMEOUT_MS),
    });
    if (!response || Number(response.status) !== 200) return '';
    const profile = await response.json();
    return String((profile && profile.login) || '');
  } catch {
    return '';
  }
}

/* ───────── 授权落盘 ───────── */

/**
 * 把授权结果落到唯一真源：先写 githubToken 键，再写来源元数据。
 * 顺序不能反：token 写失败时 mode 还停在旧值，用户看得到「授权成功」的提示但推送仍用旧凭据；
 *   反过来先写 mode 再失败，界面会显示「已是 device-flow」却根本没有 token 可用。
 * @returns {Promise<{ok:boolean, error?:string, code?:string}>}
 */
async function commitGrantedAuthorization({ grant, ctx, clientId, scope }) {
  const env = ctx?.env || {};
  const persisted = persistGithubToken(grant.accessToken, { workspaceRoot: env.workspaceRoot });
  if (!persisted.ok) {
    return { ok: false, code: 'TOKEN_PERSIST_FAILED', error: `授权成功但凭据落盘失败：${persisted.error || '未知错误'}` };
  }
  // 真实时钟写授权时间（不取注入的 now：注入的时钟是测试用来推进节流的假时间，
  //   写进用户可见的 authorizedAt 里会是一个编造的时间）。
  const login = await fetchGithubLogin(grant.accessToken);
  const metaWrite = writeGithubAuthMetadata({
    mode: AUTH_MODE_DEVICE_FLOW,
    clientId,
    scope: String(grant.grantedScope || scope || ''),
    login,
    authorizedAt: new Date().toISOString(),
  }, env);
  if (!metaWrite.ok) {
    // token 已经写进去了，只能如实报告「凭据可用但来源标记没写成」——不把它当整体失败，
    //   否则用户被提示「授权失败」却又发现推送能用，比含糊更糟。
    return { ok: true, warning: `凭据已保存，但授权元数据写入失败：${metaWrite.error || '未知错误'}` };
  }
  return { ok: true };
}

/* ───────── 端点实现 ───────── */

/**
 * 写端点的方法闸门由路由层（http-handlers.js 的 POST_ONLY_OPS 表）统一施加，
 * handler 内再拦一道是为了「绕过路由直调 handler」的场景（测试/内部调用）。
 * 两处用的是**同一个函数**，判定不会漂移。
 */
function methodGateOf(ctx) {
  return rejectNonPostMethod(ctx?.method);
}

/** 未开始授权时的空视图：字段与 auth-device 的 publicView 对齐，前端只需一套渲染逻辑。 */
function idleView(reason) {
  return {
    ok: false,
    state: DEVICE_FLOW_STATE.IDLE,
    reason,
    userCode: '',
    verificationUri: '',
    verificationUriComplete: '',
    expiresInMs: 0,
    expiresAtEpochMs: 0,
    intervalMs: 0,
    nextPollAtEpochMs: 0,
    throttled: false,
    tokenGranted: false,
  };
}

/**
 * POST /api/git-push/auth/device/start —— 申请设备码，返回短码与授权地址。
 * 响应只含展示字段：device_code 留在会话闭包里（它等价于「授权进行中的一次性凭据」）。
 */
export async function handleAuthDeviceStart(ctx) {
  const methodRejection = methodGateOf(ctx);
  if (methodRejection) return methodRejection;
  const clientId = resolveClientId(ctx);
  if (!clientId) {
    return {
      status: 400,
      body: {
        ...idleView(MISSING_CLIENT_ID_REASON),
        code: 'MISSING_CLIENT_ID',
        state: DEVICE_FLOW_STATE.FAILED,
      },
    };
  }
  const scope = resolveScope(ctx);
  const session = ensureSession(clientId, scope);
  // 新一轮授权开始：上一轮的落盘标记作废，否则这次的 authorized 会被当成「已提交」跳过。
  grantCommitted = false;
  const view = await session.start();
  // 上游失败（网络/GitHub 拒绝）不是请求格式问题 ⇒ 200 + ok:false + reason（与 account-check 同风格），
  //   前端据 reason 渲染；用 5xx 会让前端把业务失败误当网络异常。
  return { status: 200, body: view };
}

/**
 * POST /api/git-push/auth/device/poll —— 轮询一次。
 * 节流与幂等都在会话内部（未到 nextPollAt 回 throttled、并发请求共享一次上游）。
 */
export async function handleAuthDevicePoll(ctx) {
  const methodRejection = methodGateOf(ctx);
  if (methodRejection) return methodRejection;
  const session = activeSession;
  if (!session) return { status: 200, body: idleView(NO_SESSION_REASON) };
  const view = await session.poll();
  if (view.state !== DEVICE_FLOW_STATE.AUTHORIZED || view.tokenGranted !== true) {
    return { status: 200, body: view };
  }
  // 落盘只做一次：后续 poll 仍回同一份视图（tokenGranted=true），但不再写盘、不再查登录名。
  if (grantCommitted) return { status: 200, body: view };
  const committed = await commitGrantedAuthorization({
    // takeAccessToken 是本模块唯一允许接触明文凭据的入口；它只被这里使用，值不进响应体。
    grant: session.takeAccessToken(),
    ctx,
    clientId: activeClientId,
    scope: activeScope,
  });
  if (!committed.ok) {
    return {
      status: 500,
      body: { ...view, ok: false, code: committed.code || 'AUTH_PERSIST_FAILED', reason: committed.error || '凭据落盘失败' },
    };
  }
  grantCommitted = true;
  return { status: 200, body: committed.warning ? { ...view, warning: committed.warning } : view };
}

/** 按凭据文件与元数据推出三态来源（token 存在性只问 resolveToken，不碰明文输出）。 */
function resolveAuthMode(tokenConfigured, metaMode) {
  if (!tokenConfigured) return AUTH_MODE_NONE;
  return String(metaMode || '') === AUTH_MODE_DEVICE_FLOW ? AUTH_MODE_DEVICE_FLOW : AUTH_MODE_PAT;
}

/** 展示用登录名：授权元数据优先，手工 token 回落到账号状态快照里的用户名。 */
function resolveDisplayLogin(mode, meta, env) {
  const fromMeta = String(meta.login || '').trim();
  if (fromMeta) return fromMeta;
  if (mode !== AUTH_MODE_PAT) return '';
  try {
    const snapshot = readAccountStatus({ workspaceRoot: env?.workspaceRoot });
    return String((snapshot && snapshot.username) || '').trim();
  } catch {
    return '';
  }
}

/**
 * GET /api/git-push/auth/status —— 当前授权态（来源 / 登录名 / 授权时间 / 是否正在等用户授权）。
 * 只回白名单字段：会话快照里还有短码等展示项，但它们属于「进行中」，由 inProgress 分支单独给，
 *   避免把整个快照摊开（快照的字段集将来变大时，摊开等于默认把所有新字段都下发）。
 */
export function handleAuthStatus(ctx) {
  const env = ctx?.env || {};
  const meta = readGithubAuthMeta(env);
  const tokenConfigured = !!String(resolveToken({ workspaceRoot: env.workspaceRoot }).token || '');
  const mode = resolveAuthMode(tokenConfigured, meta.mode);
  const sessionView = activeSession ? activeSession.snapshot() : null;
  // 只有「等用户去授权页点确认」才算进行中：终态（authorized/denied/expired/failed）都不该让
  //   前端继续轮询——继续轮只会空转，也让界面迟迟不落到结果态。
  const inProgress = !!sessionView && sessionView.state === DEVICE_FLOW_STATE.AWAITING_USER;
  const body = {
    ok: true,
    mode,
    login: resolveDisplayLogin(mode, meta, env),
    authorizedAt: String(meta.authorizedAt || ''),
    inProgress,
  };
  if (inProgress) {
    // 进行中的展示字段回填：页面刷新/换标签后不用等 start 的响应就能把倒计时与短码续上。
    body.userCode = sessionView.userCode;
    body.verificationUri = sessionView.verificationUri;
    body.verificationUriComplete = sessionView.verificationUriComplete;
    body.expiresAtEpochMs = sessionView.expiresAtEpochMs;
    body.nextPollAtEpochMs = sessionView.nextPollAtEpochMs;
    body.intervalMs = sessionView.intervalMs;
  }
  return { status: 200, body };
}

/**
 * POST /api/git-push/auth/revoke —— 撤销本地凭据（销毁 session）。
 *
 * 为什么不调 GitHub 的撤销接口：公开客户端（Device Flow）手里没有 client_secret，
 *   无法调用 token 撤销端点；本端点只保证「本插件不再持有这份凭据」，
 *   要真正吊销 token 需用户到 GitHub → Settings → Applications 里操作。
 */
export async function handleAuthRevoke(ctx) {
  const methodRejection = methodGateOf(ctx);
  if (methodRejection) return methodRejection;
  const env = ctx?.env || {};
  const cleared = clearGithubToken({ workspaceRoot: env.workspaceRoot });
  if (!cleared.ok) {
    return { status: 500, body: { ok: false, code: 'REVOKE_FAILED', error: `清空凭据失败：${cleared.error || '未知错误'}` } };
  }
  // 元数据只清「与这份凭据绑定」的三项，clientId / scope 保留——用户下次授权不必重填。
  const metaWrite = writeGithubAuthMetadata({ mode: AUTH_MODE_NONE, login: '', authorizedAt: '' }, env);
  // 会话一并作废：留着的设备码还能换出 token，会把刚清掉的凭据写回来。
  resetDeviceFlowSession();
  if (!metaWrite.ok) {
    return { status: 500, body: { ok: false, code: 'REVOKE_METADATA_FAILED', error: `凭据已清空，但授权元数据清理失败：${metaWrite.error || '未知错误'}` } };
  }
  // 回执带上撤销后的状态，前端不必再多打一次 status。
  return { status: 200, body: { ...handleAuthStatus(ctx).body, revoked: true } };
}
