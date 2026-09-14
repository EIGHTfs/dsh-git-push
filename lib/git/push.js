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
import { resolveSshKeys, resolveToken } from './credentials.js';
import { runGit } from './exec.js';
import { ensureGitignore } from './ignore.js';
import { scanSensitiveFiles } from './sensitive.js';
import { fetchRemoteHeads, dispatchPush } from './transport.js';

/**
 * 统一提交推送：预检 → 敏感文件 .gitignore → add → commit → push。
 * @param {{repoPath, message, push, dryRun, token, customIgnorePatterns}} opts
 *   customIgnorePatterns：逗号/换行分隔的 gitignore pattern，追加进 .gitignore（幂等）
 * @returns {{ok, steps: string[], commitSha?, pushed?, push?, remoteHeads?, error?}}
 */
export async function commitAndPush({ repoPath = '', message = '', push = true, dryRun = false, token = '', customIgnorePatterns = '', requirementsConfirmed = false, force = false, pushMethod = 'ssh' } = {}) {
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
  // 通道由 dispatchPush 单点决策（默认 SSH：推本地 HEAD、远端 sha 与本地一致；无密钥才回落 API）。
  //   ⚠️ dispatchPush 是 async：必须 await（旧 bug：同步调用导致 pr.ok 恒 undefined，推送从未成功）
  const pr = await dispatchPush({ repoPath, token, force, pushMethod });
  if (pr.ok) {
    // D24：pr.pushed=false（内容级短路「无新提交可推送」）→ 如实 pushed:false（commitPushDoPush 语义）
    if (!pr.pushed) return { ok: true, steps, commitSha, pushed: false, push: pr };
    // 推送后增强对两条通道一视同仁：remote-tracking ref + aux remote + autoTag + remote heads。
    //   原先只有 API 分支做这些，SSH 分支只拉 heads → 走 SSH 时本地 origin/<branch> 引用不更新，
    //   下次 ahead/behind 判断就会错位。
    steps.push(`pushed-via-${pr.method || 'unknown'}`);
    const enhanced = await enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha });
    return { ok: true, steps, commitSha, pushed: true, push: enhanced.push, autoTag: enhanced.autoTag, ...(enhanced.heads ? { remoteHeads: enhanced.heads } : {}) };
  }
  return { ok: false, steps, commitSha, error: `推送失败（${pr.method || '通道'}）：${pr.reason}` };
}

/**
 * 把远端的提交对象取回本地，并让 refs/remotes/origin/<branch> 指向**远端真实 sha**。
 *
 * 为什么需要：API 通道在远端新建的提交，本地没有该对象，`update-ref` 直接写远端 sha 会报
 *   `nonexistent object`，于是旧实现改写成「本地 HEAD sha 代理」——推送内容虽等价，但一旦本地
 *   与远端已经分叉，这个代理会让 `git status` / ahead-behind 谎报 0/0，把分叉的仓库显示成同步。
 *   先 fetch 把对象取回，引用才是真的；取不到时由调用方退回代理写法并如实标注。
 * fetch 用 `+` 前缀更新 remote-tracking 引用：远端跟踪引用的语义就是「镜像远端」，
 *   分叉时也必须能更新（否则 fetch 本身会因非快进而被拒）。
 * @returns {Promise<string>} 远端真实 sha（失败返回 ''）
 */
async function fetchRemoteBranchRef(repoPath, branch, owner, repo) {
  if (!owner || !repo || !branch) return '';
  const keys = resolveSshKeys();
  if (!keys.length) return '';
  const known = join('/tmp', `dsh-git-push-known-hosts-${process.pid}`);
  const url = `ssh://git@ssh.github.com:443/${owner}/${repo}.git`;
  for (const { keyPath } of keys) {
    const sshCmd = `ssh -i "${keyPath}" -p 443 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${known}" -o BatchMode=yes`;
    const r = runGit(['fetch', '--no-tags', url, `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
      { cwd: repoPath, env: { GIT_SSH_COMMAND: sshCmd } });
    if (r.ok) return runGit(['rev-parse', `refs/remotes/origin/${branch}`], { cwd: repoPath }).stdout;
  }
  return '';
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
  let refTarget = localHead || pr.commitSha;
  let refNote = '';
  // SSH 通道推的就是本地对象，localHead 即远端 sha；API 通道要先取回真实对象再写引用。
  if (pr.method === 'api') {
    try {
      const realSha = await fetchRemoteBranchRef(repoPath, branchRef, pr.owner, pr.repo);
      if (realSha) refTarget = realSha;
      else refNote = `（代理 sha：远端提交本地无对象且取回失败，远端实际 ${String(pr.commitSha || '').slice(0, 7)}）`;
    } catch (e) {
      refNote = `（代理 sha：取回远端对象异常 ${String(e?.message || e).slice(0, 60)}）`;
    }
  }
  pushSlot.remoteRef = updateRemoteTrackingRef(repoPath, branchRef, refTarget) + refNote;
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

/**
 * 手动推送当前分支（账号卡片「本地仓库领先 → 手动 push」入口）。
 * 前置校验：是 git 仓库 + 工作树干净（changed=0）+ 有上游跟踪 + 领先远端（ahead>0），
 *   全过才调 dispatchPush（走配置的推送通道，默认 ssh）。
 * @param {{repoPath?:string, pushMethod?:string}} opts
 * @returns {{ok:boolean, branch?, ahead?, behind?, changed?, pushed?, push?, error?}}
 */
export async function pushCurrentBranch({ repoPath = '', pushMethod = 'ssh' } = {}) {
  if (!repoPath || !existsSync(join(repoPath, '.git'))) return { ok: false, error: `非 git 仓库: ${repoPath || '(空)'}` };
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath }).stdout.trim() || '';
  const status = runGit(['status', '--porcelain'], { cwd: repoPath }).stdout;
  const changed = status ? status.split('\n').filter(Boolean).length : 0;
  const up = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: repoPath });
  const upstream = up.ok && up.stdout.trim() ? up.stdout.trim() : '';
  const originUrl = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout.trim();
  // 2026-09-14：放宽「必须已 -u 建立上游」——无 @{u} 但有远端同样可推
  //   （dispatchPush 走 `git push <远端> HEAD:refs/heads/<分支>`，不依赖上游跟踪）。
  //   领先比较基准 = @{u}，否则 origin/<当前分支>；本地无该 ref（未 fetch 过）时
  //   ls-remote 一次性对比远端同名分支（单仓库单次网络）；远端无同名分支 = 首次推送创建。
  const base = upstream || (originUrl ? `origin/${branch}` : '');
  let ahead = 0, behind = 0, remoteMissing = false, compareFailed = false;
  if (base) {
    const rc = runGit(['rev-list', '--left-right', '--count', `HEAD...${base}`], { cwd: repoPath });
    if (rc.ok) {
      const parts = (rc.stdout || '').trim().split(/\s+/).map(Number);
      ahead = Number(parts[0]) || 0;
      behind = Number(parts[1]) || 0;
    } else {
      const lr = runGit(['ls-remote', 'origin', `refs/heads/${branch}`], { cwd: repoPath });
      if (lr.ok) {
        const sha = (lr.stdout || '').trim().split(/\s+/)[0] || '';
        if (sha) {
          const rc2 = runGit(['rev-list', '--left-right', '--count', `HEAD...${sha}`], { cwd: repoPath });
          if (rc2.ok) {
            const parts = (rc2.stdout || '').trim().split(/\s+/).map(Number);
            ahead = Number(parts[0]) || 0;
            behind = Number(parts[1]) || 0;
          } else compareFailed = true; // 与远端无共同祖先（历史无关），保守不推
        } else remoteMissing = true; // 远端无同名分支 → 首次推送（创建）
      } else compareFailed = true; // ls-remote 失败（离线/权限）
    }
  } else compareFailed = true;
  if (changed > 0) return { ok: false, ahead, behind, changed, error: `工作树有 ${changed} 处未提交改动——先提交再推送` };
  if (!originUrl) return { ok: false, ahead, behind, changed, error: '仓库无远端 origin，无法推送' };
  if (compareFailed) return { ok: false, ahead, behind, changed, error: '无法确认远端状态（本地未 fetch 且 ls-remote 失败）——请先 git fetch 或检查网络' };
  if (ahead <= 0) return { ok: false, ahead, behind, changed, error: '当前分支未领先远端（没有可推送的新提交）' };
  if (behind > 0) return { ok: false, ahead, behind, changed, error: `本地与远端分叉（本地领先 ${ahead}，远端领先 ${behind}）——先 pull 合并远端提交再推送` };
  const push = await dispatchPush({ repoPath, branch, pushMethod });
  return { ok: push.ok === true, branch, ahead, behind, changed, pushed: push.pushed, push, error: push.error };
}
