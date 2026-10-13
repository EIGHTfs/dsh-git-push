/**
 * GitHub 端点与镜像（快通道）—— **全插件唯一出处**。
 *
 * 为什么集中到这里：插件的 github 访问原本分散在多处各自写死 URL
 *   · api.js            —— API 基址 GH_API
 *   · clone-download.js —— blob API / contents API / raw.githubusercontent 三类 URL
 *   · wrapped-git.js    —— git 透传（走本地 git 协议）
 * 加"快通道"时若逐处改，必然出现口径漂移（有的走镜像、有的不走）。集中一次，处处复用。
 *
 * 快通道口径（`DSH_GIT_MIRROR_PREFIX`，**默认关**；第三方镜像会看到流量，必须显式开启）：
 *   ① **web / raw / codeload 类 github.com URL 走镜像** —— 国内镜像（如 gh-proxy.com）
 *      代理的正是这类；实测（群晖 193，2026-10-03）codeload 21KB/s → gh-proxy 12MB/s。
 *   ② **api.github.com 不走镜像** —— 镜像一般不代理 API；更重要的是 API 通道是
 *      **逐 blob 拉取、为断点续传而设计**的（每个 blob 独立请求、失败只重试那一个），
 *      改基址会破坏可续性与已下进度。故 API 基址保持直连，仅在此收口成单一常量。
 *   ③ git 协议类由 git 原生 `url.<base>.insteadOf` 实现，见 mirrorGitConfigEnv()。
 */

/** 默认镜像前缀：克隆等**只读**访问默认走 gh-proxy.com（可用环境变量覆盖或关闭）。 */
export const DEFAULT_MIRROR_PREFIX = 'https://gh-proxy.com/';
/** 显式关闭镜像的取值（环境变量设为其中之一即走直连）。 */
const MIRROR_OFF = new Set(['off', 'none', 'no', 'false', '0', '-']);

/**
 * 当前镜像前缀（确保以 / 结尾）。
 * 取值顺序：环境变量 DSH_GIT_MIRROR_PREFIX（设为 off/none/no/false/0/- 表示关闭）
 *   → 未设置时用 DEFAULT_MIRROR_PREFIX（默认 gh-proxy）。
 * 注意：默认开启**只影响只读请求** —— 写操作与带 token 的请求由 withMirror 的双闸门拦住。
 */
export function mirrorPrefix() {
  const raw = String(process.env.DSH_GIT_MIRROR_PREFIX ?? '').trim();
  if (MIRROR_OFF.has(raw.toLowerCase())) return '';
  const use = raw || DEFAULT_MIRROR_PREFIX;
  return use.endsWith('/') ? use : use + '/';
}

const MIRRORABLE = ['https://github.com/', 'https://raw.githubusercontent.com/', 'https://codeload.github.com/'];
// api.github.com **也是可镜像的**（实测 gh-proxy 代理该端点返回 HTTP 200），但只允许**读**：
//   本插件的 API 通道同时承载写（transport.js 走 Git Data API 推送 blob → tree → commit → ref），
//   写请求带 token，绝不能经第三方 ⇒ 故镜像策略按「HTTP 方法」而非「主机名」限定。
const MIRRORABLE_API = ['https://api.github.com/'];

/**
 * 按需把 github 的 web/raw/codeload（以及**只读请求**下的 api）URL 改走镜像；其余原样返回。
 *
 * 两道闸门（缺一不可）：
 *   · `mode === 'write'`（push 等写操作）—— 不镜像（git 层同理，见 mirrorGitConfigEnv）；
 *   · 非 GET 请求 —— 不镜像（API 写通道带 token）。
 * 为什么只做前缀拼接就够：镜像 URL 形如 https://gh-proxy.com/https://api.github.com/...，
 *   请求模型不变（仍是逐 blob 独立请求、失败只重试那一个），因此**不破坏断点续传与已下进度**。
 *
 * @param {string} url
 * @param {{method?:string, mode?:'read'|'write'}} [opts]
 * @returns {string}
 */
export function withMirror(url, { method = 'GET', mode = 'read', noMirror = false } = {}) {
  const base = mirrorPrefix();
  if (!base || typeof url !== 'string') return url;
  // noMirror：本次请求**带凭据**（token）⇒ 一律直连——凭据绝不经过第三方镜像。
  if (noMirror || mode === 'write' || String(method).toUpperCase() !== 'GET') return url;
  for (const p of MIRRORABLE.concat(MIRRORABLE_API)) {
    if (url.startsWith(p)) return base + url;   // 形如 https://gh-proxy.com/https://github.com/...
  }
  return url;
}

/**
 * 就地把 git 的 url.<mirror><github>.insteadOf 配置注入 env（git 透传/子进程用）。
 * 不设镜像时不动 env。返回同一 env 便于链式调用。
 *
 * **写操作绝不注入**（`mode: 'write'`）：insteadOf 是**全局 URL 重写**，一旦注入，
 *   同一条 git 命令链里的 push 也会被改走镜像（实测：注入点在 wrapped-git.js 的两条执行路径上，
 *   对 fetch/push 一视同仁），而镜像是否支持 receive-pack、是否会记录凭据都不可控 ⇒ 写操作直连。
 *
 * @param {object} env
 * @param {{mode?:'read'|'write'}} [opts]
 */
export function mirrorGitConfigEnv(env, { mode = 'read' } = {}) {
  if (mode === 'write') return env;
  const base = mirrorPrefix();
  if (base) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = `url.${base}https://github.com/.insteadOf`;
    env.GIT_CONFIG_VALUE_0 = 'https://github.com/';
  }
  return env;
}

/** API 基址（**不走镜像**，理由见文件头 ②）。 */
export const GH_API = 'https://api.github.com';
/** raw 基址（走镜像）。 */
export const GH_RAW = 'https://raw.githubusercontent.com';
/** web 基址（走镜像）。 */
export const GH_WEB = 'https://github.com';

/** blob API URL（逐 blob、可续；不走镜像）。 */
export function blobApiUrl(owner, repo, sha) {
  return `${GH_API}/repos/${owner}/${repo}/git/blobs/${sha}`;
}

/** contents API URL（不走镜像）。 */
export function contentsApiUrl(owner, repo, encodedPath, encodedRef) {
  return `${GH_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodedRef}`;
}

/** raw 文件 URL（走镜像）。 */
export function rawFileUrl(owner, repo, encodedRef, encodedPath) {
  return withMirror(`${GH_RAW}/${owner}/${repo}/${encodedRef}/${encodedPath}`);
}
