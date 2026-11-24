/**
 * dsh-git-push — 推送成功后增强（D15 拆出的小模块）
 *
 * Git Data API（api.github.com）推送成功后，本地 git 无法自动感知远端状态，
 * 本模块补齐三件事：
 *   1) updateRemoteTrackingRef — 用本地 HEAD sha 内容等价代理写入 refs/remotes/origin/<branch>
 *      （API 在远端新建的 commit sha 本地无对象，update-ref 报 nonexistent object；
 *        推送内容与本地 HEAD tree 完全等价，故用本地 HEAD sha 代理，git log origin/<branch> 可看远端内容）
 *   2) ensureAuxSshRemote — 确保辅助 SSH remote（github-ssh → ssh://git@ssh.github.com:443/owner/repo.git）
 *      存在，支持标准 git fetch/pull
 *   3) autoTagDSHProject — dsh- 前缀项目推送成功后自动打 v<version> tag（便于官方发现）
 *
 * 全部失败不阻断推送成功（结果记入 result.push.remoteRef / .auxRemote / result.autoTag）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { runGit, githubFetch, parseGithubOwnerRepo } from './index.js';
import { createTagRefViaApi } from './tag.js';

/**
 * GitHub API 调用的可替换实现（单测注入用）。
 *
 * 为什么需要它：原先直接调 `githubFetch`，而那个函数只认 `api.github.com`、
 *   没有可注入的替身 —— 于是「tag 已存在 / 创建成功 / 422 名称冲突」这些分支
 *   在单测里**根本走不到**（要么靠真网络，要么用全局离线开关，而后者会让所有请求一律失败）。
 * 抽成可替换变量后，测试能精确喂出每种响应，生产路径的默认值完全不变。
 */
let fetchImpl = githubFetch;

/** 仅测试使用：注入假的 githubFetch（传非函数则恢复默认）。 */
export function setPostPushFetchDeps(impl) {
  fetchImpl = typeof impl === 'function' ? impl : githubFetch;
}

/** 读仓库 package.json version（无 package.json / 解析失败 → ''）。 */
export function readPkgVersion(repoPath) {
  try {
    const pkgPath = join(repoPath, 'package.json');
    if (!existsSync(pkgPath)) return '';
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return String(pkg.version || '').trim();
  } catch { return ''; }
}

/**
 * 维护 remote-tracking ref：update-ref refs/remotes/origin/<branch> = <refTarget>。
 * @returns {string} 人类可读结果（成功= ref 摘要；失败= 错误说明），不抛异常
 */
export function updateRemoteTrackingRef(repoPath, branchRef, refTarget) {
  try {
    const upd = runGit(['update-ref', `refs/remotes/origin/${branchRef}`, refTarget], { cwd: repoPath });
    return upd.ok
      ? `refs/remotes/origin/${branchRef} = ${String(refTarget).slice(0, 7)}`
      : `update-ref 失败: ${(upd.stderr || '').trim().slice(0, 120)}`;
  } catch (e) {
    return `update-ref 异常: ${e?.message || e}`;
  }
}

/**
 * 确保辅助 SSH remote（github-ssh）存在。同名但指向不同 URL 时不覆盖（用户可能自设过），仅记录。
 * 结果写入 result.push.auxRemote（v1 语义）。
 */
export function ensureAuxSshRemote(repoPath, owner, repo, result = {}) {
  const AUX = 'github-ssh';
  if (!owner || !repo) return;
  const pushSlot = result.push ?? (result.push = {});
  const url = `ssh://git@ssh.github.com:443/${owner}/${repo}.git`;
  const existing = runGit(['remote', 'get-url', AUX], { cwd: repoPath });
  if (existing.ok && existing.stdout.trim()) {
    pushSlot.auxRemote = existing.stdout.trim() !== url
      ? `${AUX} 已存在（${existing.stdout.trim()}）`
      : `${AUX} 已就绪`;
    return;
  }
  const addResult = runGit(['remote', 'add', AUX, url], { cwd: repoPath });
  pushSlot.auxRemote = addResult.ok
    ? `${AUX} → ${url}`
    : `${AUX} 添加失败: ${(addResult.stderr || '').trim().slice(0, 120)}`;
}

/**
 * dsh- 前缀项目自动打 tag（起全部走 api.github.com）：
 * 打 v<version> tag 到 commitSha。repo 名非 dsh- 前缀 / 无版本 / 无 sha / 无 token / 无 origin → 跳过。
 * @returns {Promise<{ok, skipped?, tag?, reason?, error?}>}
 */
export async function autoTagDSHProject({ repoPath = '', version = '', commitSha = '', owner = '', repo = '', token = '' } = {}) {
  try {
    const repoName = repo || basename(repoPath);
    if (!/^dsh-/i.test(repoName)) return { ok: false, skipped: 'not-dsh-prefix', reason: repoName };
    const tag = 'v' + (version || readPkgVersion(repoPath) || '').replace(/^v/i, '');
    if (!tag || tag === 'v') return { ok: false, skipped: 'no-version' };
    if (!commitSha) return { ok: false, skipped: 'no-commit-sha' };
    if (!token) return { ok: false, skipped: 'no-token' };
    const originUrl = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout;
    const parsed = parseGithubOwnerRepo(originUrl);
    const ownerName = owner || parsed?.owner || '';
    const repoName2 = repo || parsed?.repo || '';
    if (!ownerName || !repoName2) return { ok: false, skipped: 'no-origin' };
    // API 超时（毫秒）：tag 存在性探测 + 创建共用
    const tagTimeoutMs = 30_000;
    // 与「手动打 tag」（lib/git/tag.js）共用同一份实现：否则「自动打的」与「手动打的」
    //   迟早走成两套判定，出现「同一个 tag 自动能打、手动报已存在」这种难查的分歧。
    // 注入点通过包装转交：post-push 单测替换的是本模块的 fetchImpl，而 tag 模块有自己的默认值。
    return await createTagRefViaApi({
      owner: ownerName,
      repo: repoName2,
      tag,
      sha: commitSha,
      token,
      fetchImpl: (path, options = {}) => fetchImpl(path, { ...options, timeout: options.timeout ?? tagTimeoutMs }),
    });
  } catch (e) {
    return { ok: false, skipped: 'error', error: String(e?.message || e) };
  }
}
