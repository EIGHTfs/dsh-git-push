// dsh-git-push — 远端可见性解析（统一收口）
//
// 抽出原因：同一职责（可见性判定）此前在
//   push.js 与 commit-push.js 各写一份，违反「同一职责单一入口」的设计，故抽成独立模块。
//
// 为什么独立成模块：可见性判定有**多个消费方**，各自实现（`resolveToken` +
//   `detectRepoVisibility` 两处复制）会造成口径漂移（token 来源、探测失败兜底不一致）：
//   ① `lib/git/push.js`     —— 私有库敏感文件豁免（private → 只扫描报告、不写 .gitignore）
//   ② `lib/commit-push.js`  —— 审计门禁豁免（private → 审计只报告不拦截）
//   ③ 克隆 / ls-remote 探针 / 推送核验 —— 私有库**不走第三方镜像**（见 accessPlan）
//   统一走本入口后，各消费方拿到同一形状、同一兜底口径。
import { detectRepoVisibility, parseGithubOwnerRepo, githubFetch } from './api.js';
import { resolveToken } from './credentials.js';
import { runGit } from '../core/exec.js';

// 可见性缓存：按 repoPath 键化，默认 5 分钟——避免每次 git 操作都多打一次 API
const cache = new Map();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** 清空缓存（测试用，或凭据变化后强制重查）。 */
export function clearVisibilityCache() {
  cache.clear();
}

/** 读缓存（同步；未命中返回 'unknown'）。 */
export function cachedVisibility(repoPath = '') {
  const hit = cache.get(repoPath);
  return hit ? hit.value.visibility : 'unknown';
}

/**
 * 访问计划：把可见性翻译成「走哪条通道」。
 *   public                     → 可以走镜像（gh-proxy 加速）
 *   private / unknown / 其他    → 不走镜像，改 SSH（本机 ssh.github.com:443 可用）
 * 为什么 unknown 也当私有：镜像对私有库无意义（必然 404/认证失败），
 *   而「失败后才发现」正是过去克隆失败、探针失明、核验未完成的根因。
 * @returns {{visibility:string, useMirror:boolean, transport:'https'|'ssh'}}
 */
export function accessPlan(visibility = 'unknown') {
  if (visibility === 'public') return { visibility, useMirror: true, transport: 'https' };
  return { visibility, useMirror: false, transport: 'ssh' };
}

/** SSH 形态的仓库 URL（走 ssh.github.com:443，绕开本机不通的 github.com:443）。 */
export function sshGitUrl(owner = '', repo = '') {
  return `ssh://git@ssh.github.com:443/${owner}/${repo}.git`;
}

/** 从仓库路径解析 GitHub 坐标（解析不到返回 null）。 */
export function ownerRepoOf(repoPath = '') {
  try {
    const url = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout;
    return parseGithubOwnerRepo(url);
  } catch {
    return null;
  }
}

/**
 * 按 owner/repo 判断可见性（克隆场景用：目标目录还是空的，没有 origin 可解析）。
 * 与 resolveRepoVisibility 共用缓存（键前缀 gh: 区分）。
 * @returns {Promise<{visibility:'private'|'public'|'unknown', owner?:string, repo?:string, reason?:string, cached?:boolean}>}
 */
export async function resolveOwnerVisibility({ owner = '', repo = '', token = '', ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!owner || !repo) return { visibility: 'unknown', reason: '缺少 owner/repo' };
  const key = `gh:${owner}/${repo}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.value, cached: true };

  let tok = token;
  if (!tok) {
    try { tok = resolveToken({}).token; } catch { tok = ''; }
  }
  if (!tok) return { visibility: 'unknown', reason: '无可用 token' };
  try {
    const r = await githubFetch(`/repos/${owner}/${repo}`, { token: tok, timeout: 10_000 });
    if (r.status === 200) {
      const j = r.json || {};
      const value = { visibility: j.private ? 'private' : 'public', owner, repo };
      cache.set(key, { value, at: Date.now() });
      return value;
    }
    // 404：GitHub 对「私有但无权限」与「不存在」返回同一个码 ⇒ 按私有处理（不走镜像更安全）
    const value = { visibility: r.status === 404 ? 'private' : 'unknown', owner, repo, reason: `API ${r.status}` };
    if (r.status === 404) cache.set(key, { value, at: Date.now() });
    return value;
  } catch (e) {
    return { visibility: 'unknown', reason: String((e && e.message) || e) };
  }
}

// 解析仓库远端可见性（统一收口，带缓存）。
//
// 兜底口径：token 缺失 / 非 GitHub origin / API 失败 → 一律 `unknown`
//   （调用方对 unknown 按保守处理：push 不豁免、审计门禁仍拦截、不走镜像）。
// 边界：resolveToken 自身抛错也吞成「无 token」（探测失败不该中断调用方流程）。
//
// @param {string} repoPath 仓库绝对路径
// @param {string} [token] 显式 token（缺省按仓库解析：仓库 token 文件 → 插件配置）
// @param {{ttlMs?:number}} [opts] 缓存有效期
// @returns {Promise<{visibility: 'private'|'public'|'unknown', owner?: string, repo?: string, reason?: string, cached?: boolean}>}
export async function resolveRepoVisibility(repoPath, token = '', { ttlMs = DEFAULT_TTL_MS } = {}) {
  const hit = cache.get(repoPath);
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.value, cached: true };

  let tok = token;
  if (!tok) {
    try { tok = resolveToken({ repoPath }).token; } catch { tok = ''; }
  }
  if (!tok) return { visibility: 'unknown', reason: '无可用 token' };
  try {
    const r = await detectRepoVisibility({ repoPath, token: tok });
    // 只缓存确定结果：unknown 可能是临时网络失败，缓存它会让后续操作一直走 SSH
    if (r.visibility !== 'unknown') cache.set(repoPath, { value: r, at: Date.now() });
    return r;
  } catch (e) {
    return { visibility: 'unknown', reason: String((e && e.message) || e) };
  }
}
