/**
 * Git 执行层 · 提交推送编排
 *
 * 职责：commitAndPush 总流程（敏感扫描 → .gitignore → add/commit → 推送到选定通道
 *   → 推送后增强），以及推送成功后的收尾（打标签、跟踪引用更新）。
 * 具体通道实现在 transport.js，本模块只做编排与前置检查。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { autoTagDSHProject, ensureAuxSshRemote, readPkgVersion, updateRemoteTrackingRef } from './post-push.js';
import { detectRepoVisibility } from './api.js';
import { loadRequirements } from './config.js';
import { resolveToken } from './credentials.js';
import { runGit } from './exec.js';
import { ensureGitignore } from './ignore.js';
import { scanSensitiveFiles } from './sensitive.js';
import { fetchRemoteHeads, pushViaApi, pushViaSsh } from './transport.js';

/**
 * 统一提交推送：预检 → 敏感文件 .gitignore → add → commit → push。
 * @param {{repoPath, message, push, dryRun, token, customIgnorePatterns}} opts
 *   customIgnorePatterns：逗号/换行分隔的 gitignore pattern，追加进 .gitignore（幂等）
 * @returns {{ok, steps: string[], commitSha?, pushed?, push?, remoteHeads?, error?}}
 */
export async function commitAndPush({ repoPath = '', message = '', push = true, dryRun = false, token = '', customIgnorePatterns = '', requirementsConfirmed = false, force = false } = {}) {
  const steps = [];
  if (!repoPath || !existsSync(join(repoPath, '.git'))) return { ok: false, steps: ['预检'], error: `非 git 仓库: ${repoPath || '(空)'}` };
  if (!String(message || '').trim()) return { ok: false, steps: ['预检'], error: 'commit message 必填' };
  // D13 开发者要求门禁（commitPushPreflight 语义）：要求清单存在且未核对 → 拦截。
  // 清单来源：credentialsDir()/requirements.json（外挂）→ PLUGIN_ROOT/lib/user-requirements.json（内置）。
  const userReqs = loadRequirements();
  if (userReqs.found && userReqs.items?.length && !requirementsConfirmed) {
    return {
      ok: false,
      blocked: true,
      code: 'USER_REQUIREMENTS',
      steps: ['预检'],
      error: '开发者特殊要求未核对：AI 需先逐条核对要求全部达标，再带 requirementsConfirmed:true 重新调用',
      requirements: userReqs,
      repo: repoPath,
    };
  }
  // D14 detached HEAD 防护（commitPushPreflight 语义）：HEAD 处于 detached 状态时拒绝提交，
  // 避免在无分支的游离 HEAD 上 commit 后无法推送（v1: 'HEAD 处于 detached 状态，请先 checkout 分支'）
  const curBranch = runGit(['branch', '--show-current'], { cwd: repoPath }).stdout;
  if (!curBranch) return { ok: false, steps: ['预检'], error: 'HEAD 处于 detached 状态，请先 checkout 分支' };
  if (dryRun) return { ok: true, dryRun: true, steps: ['预检', 'commit', push ? 'push' : 'skip-push'] };
  steps.push('敏感文件 .gitignore');
  // 私有库豁免：GitHub 可见性 = private → 只扫描报告不写 .gitignore、不解除跟踪
  // （私有库敏感字段入库风险由仓库自身可见性兜底）；探测失败/非 GitHub origin 保守不豁免。
  let privateExempt = false;
  let visReason = '';
  const tok0 = token || resolveToken({ repoPath }).token;
  if (tok0) {
    try {
      const vis = await detectRepoVisibility({ repoPath, token: tok0 });
      if (vis.visibility === 'private') { privateExempt = true; visReason = `private(${vis.owner}/${vis.repo})`; }
    } catch { /* 探测失败保守不豁免 */ }
  }
  const gi = privateExempt
    ? { added: 0, files: scanSensitiveFiles(repoPath).map((h) => h.path), baseline: 0, custom: 0, tracked: [], unstaged: [], skipped: 'private-repo-exempt' }
    : ensureGitignore(repoPath, { customIgnorePatterns });
  // 敏感文件只报告不动作（2026-09-12 用户指令：扫描到不改动 git 忽略，由仓库方自行处理）
  if (gi.files.length) steps.push(`sensitive-scan(${gi.files.length}文件, 只报告)`);
  else if (gi?.added > 0) steps.push(`.gitignore(+${gi.added}条)`);
  if (privateExempt) steps.push(`private-exempt(${visReason})`);
  steps.push('add');
  const add = runGit(['add', '-A'], { cwd: repoPath });
  if (!add.ok) return { ok: false, steps, error: `git add 失败: ${add.stderr}` };
  const status = runGit(['status', '--porcelain'], { cwd: repoPath });
  // 工作区干净但本地领先远端（已手动 commit 未 push）时不能直接跳过——
  // pushViaApi 用本地 HEAD 推送，领先提交照常可推；仅当「无变更 && 无领先」才真正跳过。
  // 有领先时：跳过 commit 阶段（committed 保持 false），但继续走下方 push 块。
  // D24 无变更语义：工作区干净且 !push → 成功跳过（ok:true，非错误）；
  // 工作区干净且 push → 跳过 commit 阶段，push 块由 pushViaApi 内容级短路兜底「无新提交可推送」。
  let cleanSkipCommit = false;
  if (!status.stdout.trim()) {
    cleanSkipCommit = true;
    steps.push('clean-worktree');
    if (!push) {
      return { ok: true, steps, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } };
    }
    const ahead = curBranch ? runGit(['rev-list', '--count', `origin/${curBranch}..HEAD`], { cwd: repoPath }) : { ok: false };
    const aheadCount = ahead.ok ? Number(ahead.stdout || 0) : 0;
    if (ahead.ok && aheadCount > 0) steps.push('clean-领先跳过 commit，直接推');
  }
  steps.push('commit');
  if (!cleanSkipCommit) {
    // identity 兜底：仓库无局部 user 配置时用通用身份，避免 "Author identity unknown"
    const identity = runGit(['config', 'user.name'], { cwd: repoPath }).stdout
      ? []
      : ['-c', 'user.name=DSH Agent', '-c', 'user.email=agent@dsh.local'];
    const commit = runGit([...identity, 'commit', '-m', message], { cwd: repoPath });
    if (!commit.ok) {
      if (/nothing to commit|no changes added/i.test(commit.stderr)) {
        return { ok: true, steps, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } };
      }
      return { ok: false, steps, error: `git commit 失败: ${commit.stderr}` };
    }
  }
  const commitSha = runGit(['rev-parse', 'HEAD'], { cwd: repoPath }).stdout;
  if (!push) return { ok: true, steps: [...steps, 'skip-push'], commitSha, pushed: false, committed: !cleanSkipCommit };
  steps.push('push');
  // ⚠️ pushViaApi 是 async：必须 await（旧 bug：同步调用导致 pr.ok 恒 undefined，API 推送从未成功）
  const pr = await pushViaApi({ repoPath, token, force });
  if (pr.ok) {
    // D24：pr.pushed=false（内容级短路「无新提交可推送」）→ 如实 pushed:false（commitPushDoPush 语义）
    if (!pr.pushed) return { ok: true, steps, commitSha, pushed: false, push: pr };
    // D15（commitPushAfterApiSuccess）拆出的独立函数：remote-ref + aux remote + autoTag + heads
    const enhanced = await enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha });
    return { ok: true, steps, commitSha, pushed: true, push: enhanced.push, autoTag: enhanced.autoTag, ...(enhanced.heads ? { remoteHeads: enhanced.heads } : {}) };
  }
  const ssh = pushViaSsh({ repoPath, force });
  if (ssh.ok) {
    const heads = await fetchRemoteHeads({ owner: ssh.owner, repo: ssh.repo, branch: ssh.branch, token }).catch(() => null);
    return { ok: true, steps, commitSha, pushed: true, push: ssh, ...(heads ? { remoteHeads: heads } : {}) };
  }
  return { ok: false, steps, commitSha, error: `推送失败（API: ${pr.reason}；SSH: ${ssh.reason}）` };
}

/**
 * API 推送成功后的增强（D15）：更新 remote-tracking ref +
 * 确保辅助 SSH remote + dsh- 项目自动打 tag + 拉取远端 heads。三者失败不阻断推送成功，
 * 结果记入 push.remoteRef / push.auxRemote / autoTag。
 * @returns {Promise<{push, autoTag, heads?}>}
 */
async function enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha }) {
  const pushSlot = pr;
  const branchRef = pr.branch;
  const localHead = runGit(['rev-parse', 'HEAD'], { cwd: repoPath }).stdout;
  const refTarget = localHead || pr.commitSha;
  pushSlot.remoteRef = updateRemoteTrackingRef(repoPath, branchRef, refTarget);
  try {
    ensureAuxSshRemote(repoPath, pr.owner, pr.repo, { push: pushSlot });
  } catch (e) {
    pushSlot.auxRemote = `ensure-aux-remote 异常: ${e?.message || e}`;
  }
  let autoTag = null;
  try {
    autoTag = await autoTagDSHProject({ repoPath, version: readPkgVersion(repoPath), commitSha: pr.commitSha, owner: pr.owner, repo: pr.repo, token: pr.token || token });
  } catch (e) {
    autoTag = { ok: false, skipped: 'auto-tag-error', error: String(e?.message || e) };
  }
  const heads = await fetchRemoteHeads({ owner: pr.owner, repo: pr.repo, branch: pr.branch, token: pr.token || token }).catch(() => null);
  return { push: pushSlot, autoTag, heads };
}

/* ───────────────────────── 提交推送 ───────────────────────── */

/** README 检查提示（提交前核对 README 是否同步）。 */
export function readmeCheckHint(repoPath) {
  const hasReadme = ['README.md', 'readme.md', 'README', 'readme'].some((n) => existsSync(join(repoPath, n)));
  return hasReadme
    ? { needed: true, hasReadme: true, hint: '提交前核对 README：功能表/版本记录/用法与本次改动一致，过时先改 README 再提交' }
    : { needed: true, hasReadme: false, hint: '仓库无 README，提交前先补（git_gen_readme 或按模板写）' };
}
