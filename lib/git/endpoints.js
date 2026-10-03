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

/** 归一化镜像前缀（确保以 / 结尾）；未设置返回空串。 */
export function mirrorPrefix() {
  const raw = String(process.env.DSH_GIT_MIRROR_PREFIX || '').trim();
  if (!raw) return '';
  return raw.endsWith('/') ? raw : raw + '/';
}

const MIRRORABLE = ['https://github.com/', 'https://raw.githubusercontent.com/', 'https://codeload.github.com/'];

/**
 * 按需把 github 的 web/raw/codeload URL 改走镜像；其余（含 api.github.com）原样返回。
 * @param {string} url
 * @returns {string}
 */
export function withMirror(url) {
  const base = mirrorPrefix();
  if (!base || typeof url !== 'string') return url;
  for (const p of MIRRORABLE) {
    if (url.startsWith(p)) return base + url;   // 形如 https://gh-proxy.com/https://github.com/...
  }
  return url;
}

/**
 * 就地把 git 的 url.<mirror><github>.insteadOf 配置注入 env（git 透传/子进程用）。
 * 不设镜像时不动 env。返回同一 env 便于链式调用。
 */
export function mirrorGitConfigEnv(env) {
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
