// dsh-git-push v1.42.0 — 一键提交推送（commitAndPush 调度器与各步骤）（自 core.js 按功能拆分，行为零变化）

import { runGit } from './git-core.js';
import { isBadCredentials, pushViaSsh, parseGithubOwnerRepo, detectRepoVisibility, autoTagDSHProject, pushViaApi, ensureAuxSshRemote, fetchRemoteHeads } from './github-api.js';
import { readPkgVersion } from './repo-scan.js';
import { ensureNpmIgnored, ensureCustomIgnored, scanSensitiveFiles, ensureSensitiveIgnored } from './ignore-scan.js';
import { resolveGitToken, resolveValidGitToken } from './token-credentials.js';
import { loadRequirements } from './workspace-context.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function commitPushPreflight({ repoPath, message, requirementsConfirmed }) {
  if (!repoPath) return { ret: { ok: false, error: '缺少 repoPath' } };
  if (!existsSync(join(repoPath, '.git'))) {
    return { ret: { ok: false, error: `不是 git 仓库: ${repoPath}` } };
  }
  if (!message || !message.trim()) {
    return { ret: { ok: false, error: 'commit message 不能为空' } };
  }

  let resultStepsHint = '';
  // 开发者要求门禁（v1.10.0 引入 / v1.40.0 改随插件内置）：要求清单不再依赖同级仓，AI 需逐条核对达标
  const userReqs = loadRequirements();
  if (userReqs.found && userReqs.items?.length) {
    if (!requirementsConfirmed) {
      return {
        ret: {
          ok: false,
          blocked: true,
          code: 'USER_REQUIREMENTS',
          error: '开发者特殊要求未核对：AI 需先逐条核对要求全部达标，再带 requirementsConfirmed:true 重新调用',
          requirements: userReqs,
          repo: repoPath,
        },
      };
    }
    resultStepsHint = `已核对用户要求(${userReqs.items.length}条)`;
  }
  const branch = runGit(['branch', '--show-current'], repoPath).stdout || '(detached)';
  if (branch === '(detached)') {
    return { ret: { ok: false, error: 'HEAD 处于 detached 状态，请先 checkout 分支' } };
  }
  return { branch, resultStepsHint };
}

/** 屏蔽 npm 下载产物（2026-08-20）：确保 .gitignore 覆盖 node_modules / lock 文件。 */

function commitPushEnsureNpmIgnore({ repoPath, dryRun, result }) {
  const ignoreResult = dryRun ? { ok: true, added: [], skipped: 'dry-run' } : ensureNpmIgnored(repoPath);
  if (!ignoreResult.ok) {
    return { ret: { ok: false, step: 'ensureNpmIgnored', error: ignoreResult.error, repo: repoPath } };
  }
  if (ignoreResult.added?.length) {
    result.steps.push(`npm-ignore(+${ignoreResult.added.length}条)`);
  }
  return {};
}

/** 自定义忽略 pattern（2026-09-07 用户需求④）：设置里配置的 *.bak* 等，提交时自动写 .gitignore。 */

function commitPushEnsureCustomIgnore({ repoPath, dryRun, customIgnorePatterns, result }) {
  const customIgnoreResult = dryRun ? { ok: true, added: [], skipped: 'dry-run' } : ensureCustomIgnored(repoPath, customIgnorePatterns);
  if (!customIgnoreResult.ok) {
    return { ret: { ok: false, step: 'ensureCustomIgnored', error: customIgnoreResult.error, repo: repoPath } };
  }
  if (customIgnoreResult.added?.length) {
    result.steps.push(`custom-ignore(+${customIgnoreResult.added.length}条)`);
  }
  return {};
}

/** 敏感字段扫描 + 自动 .gitignore（2026-09-01，含 2026-09-02 私有库豁免）。 */

async function commitPushEnsureSensitiveIgnore({ repoPath, dryRun, workspaceRoot, result }) {
  // 敏感字段扫描 + 自动 .gitignore（2026-09-01）：扫 cookie/device/username/password/token-secret，
  // 命中文件自动加进 .gitignore（已跟踪的 git rm --cached 解除跟踪）。dryRun 只扫描不写入。
  // 2026-09-02 私有库豁免（）：GitHub 可见性 = private → 只扫描报告不写 .gitignore、
  // 不解除跟踪（私有库敏感字段入库风险由仓库自身可见性兜底）；探测失败/非 GitHub origin 保守不豁免。
  let sensResult;
  if (dryRun) {
    sensResult = { ok: true, added: [], hits: scanSensitiveFiles(repoPath), tracked: [], unstaged: [], skipped: 'dry-run' };
  } else {
    let skipWrite = false;
    let visReason = '';
    try {
      const tokenInfo = resolveGitToken({ repoPath, workspaceRoot });
      const vis = await detectRepoVisibility({ repoPath, token: tokenInfo?.token || '' });
      if (vis.visibility === 'private') { skipWrite = true; visReason = `private(${vis.owner}/${vis.repo})`; }
    } catch { /* 探测失败保守不豁免 */ }
    sensResult = ensureSensitiveIgnored(repoPath, { skipWrite });
    if (skipWrite) result.sensitiveExempted = { reason: '私有库豁免（private-repo-exempt）', visibility: visReason };
  }
  if (!sensResult.ok) {
    return { ret: { ok: false, step: 'ensureSensitiveIgnored', error: sensResult.error, repo: repoPath } };
  }
  // 2026-09-12 用户指令「扫描到不动git忽略」：敏感文件只报告（steps/sensitive），不再自动写 .gitignore
  if (sensResult.hits?.length) {
    result.steps.push(`sensitive-scan(${sensResult.hits.length}文件, 只报告)`);
    result.sensitive = sensResult;
  }
  return {};
}

/** git add -A → 变更检查（dry-run / 无变更短路返回 { ret }）→ commit（干净工作区且领先时跳过）。 */

function commitPushAddCheckCommit({ repoPath, dryRun, push, message, result }) {
  // add
  if (!dryRun) {
    const add = runGit(['add', '-A'], repoPath);
    if (add.status !== 0) return { ret: { ok: false, step: 'git add', error: add.stderr } };
  }
  result.steps.push('add');

  // 变更检查
  const porcelain = dryRun ? '' : runGit(['status', '--porcelain'], repoPath).stdout;
  // v1.18.1 fix：工作区干净但本地领先远端（已手动 commit 未 push）时，不能直接跳过——
  // pushViaApi 用本地 HEAD 推送，领先提交照常可推。仅当「无变更 && 无领先」才真正跳过。
  // 有领先时：跳过 commit 阶段（committed 保持 false），但继续走下方 push 块。
  let cleanSkipCommit = false;
  if (!dryRun && !porcelain.trim()) {
    cleanSkipCommit = true;
    if (!push) {
      return { ret: { ...result, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } } };
    }
  }
  if (dryRun) {
    return { ret: { ...result, message: `(dry-run) 将提交: ${message}`, dryRunChanges: porcelain ? porcelain.split('\n').filter(Boolean).length : 0, push: { pushed: false, reason: 'dry-run 不推送' } } };
  }

  // commit（工作区干净但领先远端时跳过——HEAD 已有未推送提交，无需新建；committed=false 如实反映未新提交）
  if (!cleanSkipCommit) {
    // commit（仓库无局部 user 配置时用通用身份，避免 "Author identity unknown"）
    const identity = runGit(['config', 'user.name'], repoPath).stdout
      ? []
      : ['-c', 'user.name=DSH Agent', '-c', 'user.email=agent@dsh.local'];
    const commit = runGit([...identity, 'commit', '-m', message], repoPath);
    if (commit.status !== 0) {
      if (/nothing to commit|no changes added/.test(commit.stderr)) {
        return { ret: { ...result, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } } };
      }
      return { ret: { ok: false, step: 'git commit', error: commit.stderr } };
    }
    result.committed = true;
    result.commitId = runGit(['rev-parse', '--short', 'HEAD'], repoPath).stdout;
    result.steps.push('commit');
  } else {
    result.steps.push('skip-commit(clean-worktree)');
  }
  return {};
}

/** API 推送成功后：记录结果 + 维护 remote-tracking ref（v1.29.0）+ 确保辅助 SSH remote + auto-tag。 */

async function commitPushAfterApiSuccess({ repoPath, branch, apiPushed, tokenInfo, result }) {
  result.push = { pushed: true, pushedTo: `api.github.com/${apiPushed.owner}/${apiPushed.repo}`, ahead: null, method: 'api', commitSha: apiPushed.commitSha };
  // v1.29.0：推送成功后维护本地 remote-tracking ref（Git Data API 推送不会自动更新
  // refs/remotes/origin/*）。origin 是 api.github.com REST 端点（git fetch 必 403）。
  // 注意：Git Data API 在远端新建的 commit sha 与本地 HEAD 不同（本地无此对象，update-ref
  // 会报 nonexistent object）——推送内容与本地 HEAD tree 完全等价，故用本地 HEAD sha 写入
  // origin ref（内容等价代理），git log origin/<branch> 可看远端最新内容。
  try {
    const branchRef = apiPushed.branch || branch;
    const localHead = runGit(['rev-parse', 'HEAD'], repoPath).stdout;
    const refTarget = localHead || apiPushed.commitSha;
    const upd = runGit(['update-ref', `refs/remotes/origin/${branchRef}`, refTarget], repoPath);
    result.push.remoteRef = upd.status === 0
      ? `refs/remotes/origin/${branchRef} = ${refTarget.slice(0, 7)}`
      : `update-ref 失败: ${(upd.stderr || '').trim().slice(0, 120)}`;
  } catch (e) {
    result.push.remoteRef = `update-ref 异常: ${e?.message || e}`;
  }
  // v1.29.0：确保辅助 SSH remote 存在（支持标准 git fetch/pull；本机 ssh.github.com:443 通）
  try {
    ensureAuxSshRemote(repoPath, apiPushed.owner, apiPushed.repo, result);
  } catch (e) {
    result.push.auxRemote = `ensure-aux-remote 异常: ${e?.message || e}`;
  }
  try {
    result.autoTag = await autoTagDSHProject({ repoPath, version: readPkgVersion(repoPath), commitSha: apiPushed.commitSha, owner: apiPushed.owner, repo: apiPushed.repo, token: tokenInfo.token });
  } catch (e) {
    result.autoTag = { ok: false, skipped: 'auto-tag-error', error: String(e?.message || e) };
  }
}

/** API 推送失败分支：api ok 未推送如实记录；token 无效/缺失时 SSH 回退（v1.18.3）。 */

function commitPushApiFailFallback({ repoPath, branch, apiPushed, tokenInfo, pr, result }) {
  const apiReason = apiPushed?.reason || 'api.github.com 推送失败';
  const needSsh = !tokenInfo.token || isBadCredentials(apiReason);
  if (needSsh) {
    const sshPushed = pushViaSsh({ repoPath, branch, owner: pr.owner, repo: pr.repo, force: result.force === true });
    if (sshPushed.ok && sshPushed.pushed) {
      result.push = {
        pushed: true,
        pushedTo: `ssh.github.com:443/${pr.owner}/${pr.repo}`,
        method: 'ssh',
        fallbackFrom: 'api',
        apiReason,
      };
    } else {
      result.push = {
        pushed: false,
        reason: `API 失败（${apiReason}）；SSH 回退失败（${sshPushed.reason || '未知'}）`,
        method: 'ssh',
      };
    }
  } else {
    result.push = { pushed: false, reason: apiReason, method: 'api' };
  }
}

/** push 阶段调度：默认 api.github.com Git Data API，token 无效/缺失回退 SSH（v1.18.3）。 */

async function commitPushDoPush({ repoPath, branch, push, workspaceRoot, result, force = false }) {
  // push：默认 api.github.com Git Data API。
  // v1.18.3：token 无效（401 / Bad credentials）或无 token 时回退 ssh.github.com:443。
  // 禁止 git push github.com / HTTPS。「token无效应该能用其他方法啊」
  result.push = { pushed: false, reason: 'push=false' };
  result.force = force === true;
  let tokenInfo = { token: '', source: '' };
  let pr = null;
  if (push) {
    const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
    // v1.36.2：push 路径改用异步真校验（跳过失效 token，避免双副本场景 Bad credentials）
    tokenInfo = await resolveValidGitToken({ repoPath, workspaceRoot });
    pr = parseGithubOwnerRepo(originUrl);
    if (!originUrl || !pr) {
      result.push = { pushed: false, reason: '无 origin，无法推送' };
    } else {
      let apiPushed = null;
      if (tokenInfo.token) {
        try {
          apiPushed = await pushViaApi({ repoPath, branch, token: tokenInfo.token, force: force === true });
        } catch (e) {
          apiPushed = { ok: false, pushed: false, reason: 'API 推送异常: ' + (e?.message || e) };
        }
      } else {
        apiPushed = { ok: false, pushed: false, reason: '无 GitHub token' };
      }
      if (apiPushed?.ok && apiPushed.pushed) {
        await commitPushAfterApiSuccess({ repoPath, branch, apiPushed, tokenInfo, result });
      } else if (apiPushed?.ok && !apiPushed.pushed) {
        result.push = { pushed: false, reason: apiPushed.reason || '无新提交可推送', method: 'api' };
      } else {
        commitPushApiFailFallback({ repoPath, branch, apiPushed, tokenInfo, pr, result });
      }
    }
  }
  return { tokenInfo, pr };
}

/** 推送成功后拉取远端 heads（供返回结果展示远端最新状态）。 */

async function commitPushFetchRemoteHeads({ result, pr, branch, tokenInfo }) {
  if (result.push?.pushed && pr) {
    try {
      result.remoteHeads = await fetchRemoteHeads({
        owner: pr.owner,
        repo: pr.repo,
        branch,
        token: tokenInfo?.token || '',
      });
    } catch (e) {
      result.remoteHeads = { ok: false, error: String(e?.message || e), heads: [] };
    }
  }
}

export async function commitAndPush({ repoPath, message, push = true, dryRun = false, requirementsConfirmed = false, workspaceRoot = '', customIgnorePatterns = '', force = false } = {}) {
  const pre = commitPushPreflight({ repoPath, message, requirementsConfirmed });
  if (pre.ret) return pre.ret;
  const result = { ok: true, repo: repoPath, branch: pre.branch, dryRun, committed: false, steps: [] };

  const r1 = commitPushEnsureNpmIgnore({ repoPath, dryRun, result });
  if (r1.ret) return r1.ret;
  const r2 = commitPushEnsureCustomIgnore({ repoPath, dryRun, customIgnorePatterns, result });
  if (r2.ret) return r2.ret;
  const r3 = await commitPushEnsureSensitiveIgnore({ repoPath, dryRun, workspaceRoot, result });
  if (r3.ret) return r3.ret;

  const staged = commitPushAddCheckCommit({ repoPath, dryRun, push, message, result });
  if (staged.ret) return staged.ret;

  const pushed = await commitPushDoPush({ repoPath, branch: pre.branch, push, workspaceRoot, result, force: force === true });
  await commitPushFetchRemoteHeads({ result, pr: pushed.pr, branch: pre.branch, tokenInfo: pushed.tokenInfo });
  if (pre.resultStepsHint) result.steps.unshift(pre.resultStepsHint);
  return result;
}

/**
 * 把 GitHub commits API 数组收成「短 SHA / 标题 / 时间」三条。
 * 「每次推送远端把远端库最新的3次推送heard，标题，推送时间也发给用户」
 */

export async function commitMany({ repos, message, push = true, dryRun = false, workspaceRoot = '' }) {
  const results = [];
  for (const repoPath of repos) {
    results.push({ repo: repoPath, ...(await commitAndPush({ repoPath, message, push, dryRun, workspaceRoot })) });
  }
  return results;
}

/* ------------------------------ 重建历史（v1.8.0） ------------------------------ */
