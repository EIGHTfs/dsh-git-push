/**
 * 装配层 · 仓库归属探测（供审计的隐私规则判断「是不是自己的仓库」）
 *
 * 为什么放在这里而不是 `lib/audit/`：
 *   判定归属需要「本机 GitHub 账号」+「仓库 remote」，两者都在 `lib/git/**`；而边界门禁
 *   （test-audit-git-boundary.mjs）禁止 `lib/audit/**` 依赖 git 层——审计要能脱离宿主独立使用。
 *   故探测放在装配层，结果以**字符串**注入审计（依赖倒置）；纯判定逻辑在
 *   `lib/audit/ownership.js`（零依赖、可单测）。
 *
 * 取数口径（都只读本地，不跑网络）：
 *   · 本机 login：账号状态快照（token/ssh 的 login 字段，由账号检查写入，见 account-status.js）；
 *   · 仓库 owner：`git remote -v` 的 fetch URL 解析（parseGithubUrl）。
 * 判不出（无快照 / 无 GitHub remote）一律返回 'unknown' ⇒ 上游按「照旧生效」处理。
 *
 * 已知局限：组织仓库的 owner 是组织名而非个人 login ⇒ 判为 'foreign'（隐私规则关闭）。
 *   方向是保守误伤（少报），不是漏报自家隐私；如需覆盖组织仓库，可在此扩展自有组织名单。
 */
import { listRemotes, parseGithubUrl } from '../git/remote-resolve.js';
import { readAccountStatus } from '../git/account-status.js';
import { classifyOwnership } from '../audit/ownership.js';

/** 同一仓库只探一次（remote 与账号快照都是磁盘读，逐文件审计时重复开销明显）。 */
const CACHE = new Map();

/** 本机 GitHub 登录名（小写；取不到返回空串）。 */
export function localLogin() {
  try {
    const st = readAccountStatus({});
    const login = String(st?.token?.login || '') || String(st?.ssh?.login || '');
    return login.trim().toLowerCase();
  } catch {
    return '';
  }
}

/** 仓库 GitHub owner（小写；无 GitHub remote 返回空串）。 */
export function remoteOwner(repoPath) {
  try {
    const map = listRemotes(repoPath || '') || {};
    for (const name of Object.keys(map)) {
      const url = (map[name] && (map[name].fetch || map[name].push)) || '';
      const parsed = parseGithubUrl(String(url || ''));
      if (parsed && parsed.owner) return String(parsed.owner).trim().toLowerCase();
    }
  } catch { /* 非 git 目录 / 无 remote → 空串 */ }
  return '';
}

/**
 * 探测仓库归属（带进程内缓存）。
 * @param {string} repoPath 仓库根目录
 * @returns {'own'|'foreign'|'unknown'}
 */
export function probeRepoOwnership(repoPath = '') {
  const key = String(repoPath || '');
  if (CACHE.has(key)) return CACHE.get(key);
  const verdict = classifyOwnership(localLogin(), remoteOwner(key));
  CACHE.set(key, verdict);
  return verdict;
}

/** 清空缓存（测试用 / 账号切换后）。 */
export function resetRepoOwnershipCache() {
  CACHE.clear();
}
