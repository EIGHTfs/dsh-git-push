/**
 * Git 执行层 · GitHub REST
 *
 * 职责：GitHub API 调用（githubFetch 统一带 token 与错误识别）、
 *   owner/repo 解析、坏凭据判定、仓库可见性探测。
 */

import { runGit } from './exec.js';

/* ───────────────────────── 网络：api.github.com 唯一通道 ───────────────────────── */

// API 基址统一收口到 endpoints.js（含快通道口径说明）；此处转出以保持既有引用不变。
// 注意：api.github.com **不走镜像**——API 通道是逐 blob、为断点续传设计的。
import { GH_API, withMirror, mirrorPrefix } from './endpoints.js';
export { GH_API };
const VIS_CHECK_TIMEOUT_MS = 30_000; // 仓库可见性探测超时

/**
 * 调 api.github.com（唯一网络出口；非该域名直接拒绝，不跟随 302）。
 * @returns {Promise<{status, json, text, error?}>}
 */
export async function githubFetch(path, { token = '', method = 'GET', body, timeout = 60_000, headers: extraHeaders } = {}) {
  const direct = /^https?:\/\//i.test(path) ? path : `${GH_API}${path.startsWith('/') ? path : `/${path}`}`;
  // 只读请求可走镜像（前缀拼接，请求模型不变 ⇒ 逐 blob 可续性不受影响）；
  //   两道限制：写请求（method 非 GET）原样直连；**带 token 的请求**（私仓）也一律直连
  //   —— 凭据绝不经过第三方镜像。
  const url = withMirror(direct, { method, noMirror: !!token });
  // 离线开关（单测/无外网环境网络隔离）——设 DSH_GIT_PUSH_OFFLINE=1 时
  //   所有 GitHub API 调用快速失败，测试不用真实网络（否则假 token 的 /user 会等满超时挂起）。
  if (process.env.DSH_GIT_PUSH_OFFLINE === '1') {
    return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: 'offline (DSH_GIT_PUSH_OFFLINE=1)' };
  }
  let host = '';
  try { host = new URL(url).hostname; } catch { return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `非法 URL: ${url}` }; }
  // 白名单放行两种 host：直连的 api.github.com，以及「镜像前缀 + api.github.com」。
  //   后者形如 https://gh-proxy.com/https://api.github.com/...，host 是镜像站——
  //   若不同步放宽这里，开了镜像后所有 API 调用会被**自己**拒掉（改一处必须同改消费方）。
  //   安全性由 withMirror 的双闸门保证：只有 GET 才会被改写成镜像 URL，
  //   故能走到这里的非 api.github.com 请求必然是只读的。
  const mp = mirrorPrefix();
  const mirrorOk = !!mp && url.startsWith(`${mp}${GH_API}/`);
  if (host !== 'api.github.com' && !mirrorOk) {
    return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `拒绝非 api.github.com 请求: ${host}` };
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-git-push',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(extraHeaders || {}),
  };
  // 单次尝试。注意：本模块用**返回值**表达 HTTP 错误（5xx 不会抛异常）⇒ 失败判据必须同时覆盖两类：
  //   抛出（网络/DNS/超时）与「返回 status 0 或 >=500」。
  const attempt = async (target) => {
    const resp = await fetch(target, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual', // 防 tarball 302 跳到 codeload.github.com
    });
    if (resp.status >= 300 && resp.status < 400) {
      return { status: resp.status, json: null, text: '', buffer: Buffer.alloc(0), error: `api.github.com 重定向（拒绝跟随）: ${resp.headers.get('location') || ''}` };
    }
    // 先读 arrayBuffer：JSON 接口 toString utf8；clone 二进制用 buffer / base64，避免 text() UTF-8 损坏
    const buffer = Buffer.from(await resp.arrayBuffer());
    const text = buffer.toString('utf8');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON（raw blob） */ }
    // rate limit 头透传（2026-10-02 功能：UI 显示 API 通道配额）——GitHub 每次响应带
    //   X-RateLimit-Limit/Remaining/Reset（core 通道）；取得到才返回，取不到不阻塞主流程。
    const rateLimit = {};
    for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
      const v = resp.headers.get(h);
      if (v != null) rateLimit[h.replace('x-ratelimit-', '')] = v;
    }
    return { status: resp.status, json, text, buffer, rateLimit: Object.keys(rateLimit).length ? rateLimit : undefined };
  };
  const fail = (e) => ({ status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: String(e?.message || e) });

  const first = await attempt(url).catch(fail);
  // 镜像回退（设计决策：默认走 gh-proxy，但**代理不可用时不能让整体失败**）⇒ 直连重试一次。
  //   回退条件 = 本次真的走了镜像，且失败属于「**代理这一跳**的问题」：
  //     网络/超时（status 0）、服务端故障（>=500）、以及**代理侧限流/拒绝**（403/429）。
  //     后者是镜像站共享出口 IP 的常见答复（真实事故：经镜像的 API 请求拿到 403，而直连同时是 200），
  //     并非仓库的真实答案；真实 403/404 会由直连再次给出，语义不会丢。
  //   不回退：其余 4xx（404/401 等）——那是远端给出的真实答案，换直连只会白跑一次。
  const mirrored = url !== direct;
  const proxySideFailure = first.status === 0 || first.status >= 500 || first.status === 403 || first.status === 429;
  if (!mirrored || !proxySideFailure) return first;
  const second = await attempt(direct).catch(fail);
  // 直连网络不可用（status 0）而镜像有明确 HTTP 码时，保留信息更丰富的那个（便于调用方看到真实状态）。
  return second.status === 0 && first.status !== 0 ? first : second;
}

/** 从 origin / URL / owner-repo 解析 GitHub owner+repo（只解析字符串，不访问 github.com）。 */
export function parseGithubOwnerRepo(originUrl) {
  const s = String(originUrl || '').trim();
  if (!s) return null;
  const patterns = [
    /api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s*$/i,
    /(?:git@|https?:\/\/)(?:[^@/\s]+@)?(?:ssh\.)?github\.com(?::443)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
    /^ssh:\/\/git@ssh\.github\.com:443\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
    /^([\w.-]+)\/([\w.-]+?)$/,
  ];
  for (const re of patterns) {
    const match = s.match(re);
    if (match) return { owner: match[1], repo: match[2].replace(/\.git$/i, '') };
  }
  return null;
}

/** token 失效判定（401 / Bad credentials）。 */
export function isBadCredentials(reason = '') {
  return /Bad credentials|credential|401\b/i.test(String(reason || ''));
}

/**
 * 探测 GitHub 仓库可见性（GET /repos/{owner}/{repo}，走 api.github.com 不跟随 302）。
 * 用于私有库豁免：private 仓库敏感字段入库风险由可见性兜底，自动 .gitignore 只扫描不写。
 * @returns {{visibility:'private'|'public'|'unknown', owner?, repo?, private?, reason?}}
 */
export async function detectRepoVisibility({ repoPath = '', token = '' } = {}) {
  try {
    const originUrl = repoPath ? runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout : '';
    const pr = parseGithubOwnerRepo(originUrl);
    if (!pr) return { visibility: 'unknown', reason: '无 github origin' };
    const visRes = await githubFetch(`/repos/${pr.owner}/${pr.repo}`, { token, timeout: VIS_CHECK_TIMEOUT_MS });
    if (visRes.status === 200) {
      const json = visRes.json || {};
      return { visibility: json.private ? 'private' : 'public', owner: pr.owner, repo: pr.repo, private: !!json.private };
    }
    return { visibility: 'unknown', reason: visRes.error || `GitHub API ${visRes.status}` };
  } catch (e) {
    return { visibility: 'unknown', reason: String(e?.message || e) };
  }
}
