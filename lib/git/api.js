/**
 * Git 执行层 · GitHub REST
 *
 * 职责：GitHub API 调用（githubFetch 统一带 token 与错误识别）、
 *   owner/repo 解析、坏凭据判定、仓库可见性探测。
 */

import { runGit } from './exec.js';

/* ───────────────────────── 网络：api.github.com 唯一通道 ───────────────────────── */

export const GH_API = 'https://api.github.com';

/**
 * 调 api.github.com（唯一网络出口；非该域名直接拒绝，不跟随 302）。
 * @returns {Promise<{status, json, text, error?}>}
 */
export async function githubFetch(path, { token = '', method = 'GET', body, timeout = 60_000, headers: extraHeaders } = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${GH_API}${path.startsWith('/') ? path : `/${path}`}`;
  // 2026-09-16：离线开关（单测/无外网环境网络隔离）——设 DSH_GIT_PUSH_OFFLINE=1 时
  //   所有 GitHub API 调用快速失败，测试不用真实网络（否则假 token 的 /user 会等满超时挂起）。
  if (process.env.DSH_GIT_PUSH_OFFLINE === '1') {
    return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: 'offline (DSH_GIT_PUSH_OFFLINE=1)' };
  }
  let host = '';
  try { host = new URL(url).hostname; } catch { return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `非法 URL: ${url}` }; }
  if (host !== 'api.github.com') {
    return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `拒绝非 api.github.com 请求: ${host}` };
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-git-push',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(extraHeaders || {}),
  };
  try {
    const res = await fetch(url, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual', // 防 tarball 302 跳到 codeload.github.com
    });
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, json: null, text: '', buffer: Buffer.alloc(0), error: `api.github.com 重定向（拒绝跟随）: ${res.headers.get('location') || ''}` };
    }
    // 先读 arrayBuffer：JSON 接口 toString utf8；clone 二进制用 buffer / base64，避免 text() UTF-8 损坏
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = buffer.toString('utf8');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON（raw blob） */ }
    return { status: res.status, json, text, buffer };
  } catch (e) {
    return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: String(e?.message || e) };
  }
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
    const m = s.match(re);
    if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
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
    const res = await githubFetch(`/repos/${pr.owner}/${pr.repo}`, { token, timeout: 30_000 });
    if (res.status === 200) {
      const json = res.json || {};
      return { visibility: json.private ? 'private' : 'public', owner: pr.owner, repo: pr.repo, private: !!json.private };
    }
    return { visibility: 'unknown', reason: res.error || `GitHub API ${res.status}` };
  } catch (e) {
    return { visibility: 'unknown', reason: String(e?.message || e) };
  }
}
