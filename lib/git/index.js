/**
 * dsh-git-push-v2 git 总入口
 * token / sshkey / 提交 / 推送 / clone / 建仓 / 可见性 / 版本历史 / 重建历史。
 * 命名格式统一：一个功能一个根词，各层只做格式转换（外部 API 与函数名完全一致）。
 */
import { execFileSync } from 'node:child_process';

/** 统一 git 执行（数组参数，零注入面；stderr 保留供排障）。 */
export function runGit(args, { cwd = '', timeoutMs = 120_000 } = {}) {
  const base = ['-c', 'safe.directory=*', '-c', 'core.filemode=false'];
  try {
    const out = execFileSync('git', cwd ? [...base, '-C', cwd, ...args] : [...base, ...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: out.trim(), stderr: '' };
  } catch (e) {
    return { ok: false, stdout: '', stderr: String(e?.stderr || e?.message || e).trim() };
  }
}

/** token 解析（插件配置目录 github-token / 环境变量 / .git-push-token）。 */
export function resolveToken(opts = {}) {
  // 1.1.3 接入：扫描配置目录 env DSH_GIT_PUSH_TOKEN 项目 .git-push-token
  return { ok: false, error: 'resolveToken 待实现（1.1.3）' };
}

/** 提交（统一入口：预检 → add → commit → push）。 */
export function commitAndPush({ repoPath, message, push = true, dryRun = false } = {}) {
  // 1.1.3 接入
  return { ok: true, dryRun, steps: ['预检', 'commit', push ? 'push' : 'skip-push'] };
}

/** 推送（api.github.com Git Data API；token 401 回退 ssh.github.com:443）。 */
export function pushViaApi({ owner, repo, branch = 'master', token, files = [] } = {}) {
  // 1.1.3 接入
  return { ok: true, method: 'api', owner, repo, branch };
}

/** clone（只走 api.github.com Git Data API，不直连 github.com）。 */
export function cloneViaApi({ target, dest, token, branch = '' } = {}) {
  // 1.1.3 接入
  return { ok: true, target, dest };
}

/** 建仓。 */
export function ensureRemoteRepo({ repoPath, visibility = 'private', dryRun = false } = {}) {
  // 1.1.3 接入
  return { ok: true, repoPath, visibility, dryRun };
}

/** 可见性切换。 */
export function setVisibility({ owner, repo, visibility, token } = {}) {
  // 1.1.3 接入
  return { ok: true, owner, repo, visibility };
}