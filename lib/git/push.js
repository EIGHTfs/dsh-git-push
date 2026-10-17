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
import { loadRequirements } from './config.js';
import { resolveSshKeys, resolveToken } from './credentials.js';
import { runGit } from './exec.js';
import { buildWrappedGitEnv } from './wrapped-git.js';
import { buildCommitMessage } from './commit-message.js';
// 推送失败诊断：把「原文事实」与「推断」分开，避免把探针失败误读成「仓库不存在/推送未落地」
import { classifyPushFailure } from './push-diagnose.js';
import { ensureGitignore } from './ignore.js';
import { scanSensitiveFiles } from './sensitive.js';
import { ensureRepoIdentity } from './identity.js';
import { buildLegacyIdentityHint, legacyIdentityReport, wrongIdentityEmails } from './identity-rewrite.js';
import { readAccountStatus } from './account-status.js';

/**
 * 解析本仓库该用的提交身份，并在「仓库未配身份」时把**账号身份**写进仓库局部配置。
 *
 * 策略：仓库已配 → 尊重；未配 → 用登录的 GitHub 账号身份
 *   （`EIGHTfs <38984640+EIGHTfs@users.noreply.github.com>`）并 `git config --local` 落盘 ——
 *   这样 AI 手敲 git / 插件提交 / 用户提交都带同一身份，不用每次传 -c，也不会再有 DSH Agent 提交。
 * 只写仓库局部配置（该仓库 .git/config，不入库、不动全局）。
 *
 * @param {string} repoPath 仓库路径
 * @returns {{name:string,email:string,source:string,complete:boolean,written:string[],label:string}}
 *   complete=true：仓库配置已齐（可直接 commit）；false：需在 commit 上补 `-c user.name/email`
 */
function resolveRepoIdentity(repoPath) {
  const st = readAccountStatus();
  const account = st?.token?.valid
    ? { login: st.token.login || st.username || '', id: st.token.id || '' }
    : null;
  return ensureRepoIdentity(repoPath, { runGit, account });
}
import { fetchRemoteHeads, dispatchPush, liveRemoteHead } from './transport.js';
// 推送后「远端 sha 硬校验」用（假成功防线：远端空仓/未落地时必须判失败，见 enhanceAfterPushSuccess）
import { githubFetch } from './api.js';
import { resolveRepoVisibility, cachedVisibility } from './visibility.js';

/**
 * 统一提交推送：预检 → 敏感文件 .gitignore → add → commit → push。
 * @param {{repoPath, message, push, dryRun, token, customIgnorePatterns}} opts
 *   message：字符串（原样透传）｜数组（元素为字符串，或 {what,type?,scope?,why?,verify?,refs?}）｜
 *            {subject?, items:[...]}（显式标题）——仅 what 必填，由 lib/git/commit-message.js 组装
 *   customIgnorePatterns：逗号/换行分隔的 gitignore pattern，追加进 .gitignore（幂等）
 * @returns {{ok, steps: string[], commitSha?, pushed?, push?, remoteHeads?, error?}}
 */
export async function commitAndPush({ repoPath = '', message = '', messageItems = null, push = true, dryRun = false, token = '', customIgnorePatterns = '', requirementsConfirmed = false, force = false, pushMethod = 'ssh', pushGate = false, pushConfirmed = false, paths = '', remote = '' } = {}) {
  const steps = [];
  if (!repoPath || !existsSync(join(repoPath, '.git'))) return { ok: false, steps: ['预检'], error: `非 git 仓库: ${repoPath || '(空)'}` };
  // message 支持三种形态（字符串 / 数组 / {subject,items}）：在预检处**单点**组装成规范提交信息，
  //   后续流程（add / commit -m / 回执）只用 built.message —— 避免多处各自解析导致行为分叉。
  //   字符串形态原样透传（既有调用方行为不变）；数组/对象形态由 lib/git/commit-message.js 组装。
  // message（字符串）与 messageItems（数组）合并：字符串作**标题**、数组作要点与正文 ✓
  //   为什么数组不走 message 本身：宿主在进插件前按工具 schema 校验参数，而它只认标量类型
  //   （anyOf / 类型数组都被读成 string ✗）⇒ 非字符串根本到不了插件 ✓（见 command-registry 注释）
  const msgInput = Array.isArray(messageItems) && messageItems.length
    ? { subject: String(message || '').trim(), items: messageItems }
    : message;
  const built = buildCommitMessage(msgInput);
  if (!built.ok) return { ok: false, steps: ['预检'], error: built.error };
  const commitMessage = built.message;
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
  // ⚠ 必须区分「git 调用失败」与「真的是游离 HEAD」：此前只看 stdout，git 因 PATH 缺 git /
  //   不信任目录等原因失败时空 stdout 会被误报成 detached HEAD，把排查带偏（2026-10-03 实测）。
  const cur = runGit(['branch', '--show-current'], { cwd: repoPath });
  if (!cur.ok) return { ok: false, steps: ['预检'], error: `git 调用失败：${cur.stderr}` };
  const curBranch = cur.stdout;
  if (!curBranch) return { ok: false, steps: ['预检'], error: 'HEAD 处于 detached 状态，请先 checkout 分支' };
  if (dryRun) return { ok: true, dryRun: true, steps: ['预检', 'commit', push ? 'push' : 'skip-push'] };
  // ── 「零改动就不写 .gitignore、不提交」（前置判定）──
  //   为什么必须前置：仓库没有 .gitignore 时，ensureGitignore 会**新建/追加** .gitignore，
  //   于是「本来干净的仓」被自己写脏 ⇒ 凭空多出一个只含 .gitignore 的提交 ✗
  //   （修复前实测：steps = ["敏感文件 .gitignore", ".gitignore(+2条)", "add", "commit"]，
  //     用户只调了一次「推一下」，远端就多了一个提交）。
  //   用 paths 精确 add 时只按这些路径判定（否则会被别处的改动误判）。
  const pathList = String(paths || '').split(',').map((x) => x.trim()).filter(Boolean);
  const preStatus = runGit(['status', '--porcelain', ...(pathList.length ? ['--', ...pathList] : [])], { cwd: repoPath });
  let cleanSkipCommit = false;
  if (preStatus.ok && !preStatus.stdout.trim()) {
    cleanSkipCommit = true;
    steps.push('clean-worktree');
    if (!push) {
      // 文案口径：工作区没有改动是**正常成功路径**（不是失败）——明确写出来，
      //   否则 AI 会以为「没东西可提交 ⇒ 这次调用会报错」，宁可绕开插件自己手敲 git。
      return { ok: true, steps, committed: false, message: '无变更：工作区无改动，无需提交（正常，不是错误）', push: { pushed: false, reason: '无变更（正常，非错误）' } };
    }
    // 工作区干净但本地领先远端（已手动 commit 未 push）时不能直接跳过——
    // pushViaApi 用本地 HEAD 推送，领先提交照常可推；仅当「无变更 && 无领先」才真正跳过。
    const ahead = curBranch ? runGit(['rev-list', '--count', `origin/${curBranch}..HEAD`], { cwd: repoPath }) : { ok: false };
    const aheadCount = ahead.ok ? Number(ahead.stdout || 0) : 0;
    if (ahead.ok && aheadCount > 0) steps.push('clean-领先跳过 commit，直接推');
  }
  // 有改动才写 .gitignore / add / commit
  if (!cleanSkipCommit) {
  steps.push('敏感文件 .gitignore');
  // 私有库豁免：GitHub 可见性 = private → 只扫描报告不写 .gitignore、不解除跟踪
  // （私有库敏感字段入库风险由仓库自身可见性兜底）；探测失败/非 GitHub origin 保守不豁免。
  // 可见性判定**统一走 lib/git/visibility.js**（与审计门禁同一收口，避免两处口径漂移）。
  const vis = await resolveRepoVisibility(repoPath, token);
  const privateExempt = vis.visibility === 'private';
  const visReason = privateExempt ? `private(${vis.owner}/${vis.repo})` : '';
  const gi = privateExempt
    ? { added: 0, files: (await scanSensitiveFiles(repoPath)).map((h) => h.path), baseline: 0, custom: 0, tracked: [], unstaged: [], skipped: 'private-repo-exempt' }
    : await ensureGitignore(repoPath, { customIgnorePatterns });
 // 敏感文件只报告不动作（既定行为：扫描到不改动 git 忽略，由仓库方自行处理）
  if (gi.files.length) steps.push(`sensitive-scan(${gi.files.length}文件, 只报告)`);
  else if (gi?.added > 0) steps.push(`.gitignore(+${gi.added}条)`);
  if (privateExempt) steps.push(`private-exempt(${visReason})`);
  steps.push('add');
  // 支持**精确 add 路径**（paths 逗号分隔，相对 repoPath）——只在有他人未提交
  //   改动 / 不想全量暂存时用：`git add <path...>` 只暂存指定文件，替代默认 `git add -A`
  //   （add -A 会把无关文件一并扫入提交，bench-template 等共享工作区场景实测踩坑）。
  const add = pathList.length
    ? runGit(['add', ...pathList], { cwd: repoPath })
    : runGit(['add', '-A'], { cwd: repoPath });
  if (!add.ok) return { ok: false, steps, error: `git add 失败: ${add.stderr}` };
    const status = runGit(['status', '--porcelain'], { cwd: repoPath });
    // 二次判定：若改动**只**来自被 .gitignore 覆盖的敏感文件（add 后已无可提交内容），
    //   同样按「零改动」处理——绝不因为自动写 .gitignore 而凭空产生提交。
    if (!status.stdout.trim()) {
      cleanSkipCommit = true;
      steps.push('clean-worktree');
      if (!push) {
        return { ok: true, steps, committed: false, message: '无变更：工作区无改动，无需提交（正常，不是错误）', push: { pushed: false, reason: '无变更（正常，非错误）' } };
      }
    }
  }
  // 提交身份：仓库已配则用；未配则用登录账号身份并写入仓库局部配置（见 resolveRepoIdentity）。
  const identity = resolveRepoIdentity(repoPath);
  // 提交时顺带提醒「以前」：该仓库历史里还有多少条非规范身份提交（只报告，绝不改历史）
  const legacyIdentity = (() => {
    try {
      const st = readAccountStatus();
      const account = st?.token?.valid ? { login: st.token.login || st.username || '' } : null;
      const rep = legacyIdentityReport(repoPath, { runGit, wrongEmails: wrongIdentityEmails({ account }) });
      return { count: rep.count, emails: rep.emails, hint: buildLegacyIdentityHint(rep, identity) };
    } catch {
      return null; // 提醒是附加信息，算不出来不影响提交
    }
  })();
  steps.push('commit');
  if (!cleanSkipCommit) {
    // 身份写盘失败等极端情况才退回命令行 -c（双保险，避免 "Author identity unknown"）
    const identityArgs = identity.complete
      ? []
      : ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`];
    const commit = runGit([...identityArgs, 'commit', '-m', commitMessage], { cwd: repoPath });
    if (!commit.ok) {
      if (/nothing to commit|no changes added/i.test(commit.stderr)) {
        // 同上：git 自己回「nothing to commit」也只是「没东西可提交」，属于成功跳过
        return { ok: true, steps, committed: false, message: '无变更：工作区无改动，无需提交（正常，不是错误）', push: { pushed: false, reason: '无变更（正常，非错误）' } };
      }
      return { ok: false, steps, error: `git commit 失败: ${commit.stderr}` };
    }
  }
  const commitSha = runGit(['rev-parse', 'HEAD'], { cwd: repoPath }).stdout;
  if (!push) return { ok: true, steps: [...steps, 'skip-push'], commitSha, pushed: false, committed: !cleanSkipCommit, identity, legacyIdentity };
  // 推送门禁（类似会话指挥家写操作拦截）——开启后 push 必须带 pushConfirmed:true
  //   （显式放行标记），否则**拦截推送步骤**（commit 已落本地，push 被挡、不产生远端变更）。
  if (pushGate && !pushConfirmed) {
    return {
      ok: false,
      blocked: true,
      code: 'PUSH_GATE',
      steps: [...steps, 'push-gate'],
      commitSha,
      error: '推送门禁已开启：push 需显式放行（带 pushConfirmed:true 重新调用，可沿用本次 commit，不重复提交）。',
      pushGate: true,
      push: { pushed: false, reason: 'push-gate' },
      identity,
      legacyIdentity,
    };
  }
  steps.push('push');
  // 通道由 dispatchPush 单点决策（默认 SSH：推本地 HEAD、远端 sha 与本地一致；无密钥才回落 API）。
  //   ⚠️ dispatchPush 是 async：必须 await（旧 bug：同步调用导致 pr.ok 恒 undefined，推送从未成功）
  const pr = await dispatchPush({ repoPath, token, force, pushMethod, remote });
  if (pr.ok) {
    // D24：pr.pushed=false（内容级短路「远端已是最新」）→ 如实 pushed:false（commitPushDoPush 语义）
    // committed 必须如实带上：cleanSkipCommit 时本次**没有产生新提交**。
    //   此前这条路径缺 committed 字段，job 输出就兜底成「已提交，未推送」——与实际相反 ✗（实测复现）
    if (!pr.pushed) return { ok: true, steps, commitSha, committed: !cleanSkipCommit, pushed: false, push: pr, identity, legacyIdentity };
    // 推送后增强对两条通道一视同仁：remote-tracking ref + aux remote + autoTag + remote heads。
    //   原先只有 API 分支做这些，SSH 分支只拉 heads → 走 SSH 时本地 origin/<branch> 引用不更新，
    //   下次 ahead/behind 判断就会错位。
    steps.push(`pushed-via-${pr.method || 'unknown'}`);
    const enhanced = await enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha, remote });
    // 假成功防线（用户实测事故）：远端为空仓时推送动作不报错，但提交根本没上去。
    //   verified===false 表示「API 查到了远端分支，但 sha 与本地提交不一致 / 查不到该分支」
    //   ⇒ 必须返回 ok:false，让调用方与用户看到真实状态，而不是「commit+push done」。
    //   verified===null（校验自身失败，如网络/权限）不算失败，但把原因带在 push.verifyError 里。
    if (enhanced.push?.verified === false) {
      steps.push('push-verify-failed');
      return {
        ok: false, steps, commitSha, pushed: false,
        error: `推送未落地：${enhanced.push.verifyError || '远端 sha 与本地不一致'}`,
        push: enhanced.push,
      };
    }
    // committed 如实带上：cleanSkipCommit 时推的是**此前已提交的领先内容**，本次没有新提交
    return { ok: true, steps, commitSha, committed: !cleanSkipCommit, pushed: true, push: enhanced.push, autoTag: enhanced.autoTag, ...(enhanced.heads ? { remoteHeads: enhanced.heads } : {}), identity, legacyIdentity };
  }
  // 失败回执附结构化诊断（分类 + 置信度 + 下一步）
  const dg = pr.diagnosis || classifyPushFailure(String(pr.reason || ''), { method: pr.method });
  return {
    ok: false, steps, commitSha,
    error: `推送失败（${pr.method || '通道'}）：${pr.reason}｜诊断 ${dg.code}（${dg.confidence === 'low' ? '推断，置信度低' : '依据充分'}）：${dg.inference}｜下一步：${dg.nextSteps[0] || ''}`,
    diagnosis: dg,
    identity, legacyIdentity,
  };
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
async function enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha, remote = '' }) {
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
  // 核验用 token：调用方没显式传时从插件凭据兜底。
  //   为什么必须有：pushViaSsh 成功时 pr.token 为空，若这里直接用 token（默认 ''），
  //   后面的 API 核验会以空 token 请求 → 404/401 → 明明推成功了却报「未能核验远端」。
  const verifyToken = String(token || '').trim() || resolveToken({ workspaceRoot: repoPath }).token;
  // 统一前置判断：先确定仓库可见性并填缓存——后续 ls-remote 探针据此决定要不要试 origin(https)：
  //   私有库经 https/镜像必然失败，试它只会把「未核验」的原因带偏。
  try { await resolveRepoVisibility(repoPath, verifyToken); } catch { /* 判定失败按 unknown 处理 */ }
  let autoTag = null;
  try {
    autoTag = await autoTagDSHProject({ repoPath, version: readPkgVersion(repoPath), commitSha: pr.commitSha, owner: pr.owner, repo: pr.repo, token: pr.token || verifyToken });
  } catch (e) {
    autoTag = { ok: false, skipped: 'auto-tag-error', error: String(e?.message || e) };
  }
  const heads = await fetchRemoteHeads({ owner: pr.owner, repo: pr.repo, branch: pr.branch, token: pr.token || verifyToken }).catch(() => null);
  // 推送成功后的**硬校验**：远端该分支的 sha 必须等于本次提交 sha。
  //   事故（用户实测）：远端仓库为空（API 409 Conflict）时插件仍回「commit+push done」——
  //   成功判定只看「推送动作有没有报错」，没看「远端到底有没有这个提交」，属**假成功**。
  //   这里用 API 查远端 branch 的真实 sha：查不到（空仓/404）或与本地不一致 ⇒ 明确判失败，
  //   并把远端实际状态带回，避免用户以为已入库。
  let verified = null;
  let verifyError = '';
  const pushedSha = String(pr.commitSha || commitSha || '');
  // 独立复核通道：`git ls-remote`（走凭据、不经 API 限流与缓存）。
  //   为什么必须有：判「未落地」是**否定性结论**，而 API 探针会因限流/鉴权/分支名差异给出 403/404——
  //   实测两次误报（一次 403、一次 404），现场推送其实都已成功。否定性结论必须两条通道一致才可下。
  /**
   * 独立复核探针：`git ls-remote`（走凭据、不经 API 限流与缓存）。
   *
   * ⚠️ 必须返回**三态**，不能把「探针失败」与「成功但为空」都压成空串 ——
   *   旧实现正是如此，于是「两路都查不到」被当成「两路一致认定未落地」✗。
   *   用户实测误报原文：「推送未落地：远端查不到分支 main——两条通道一致：API HTTP 404，
   *   ls-remote 无该分支；远端可能是空仓库」——而真实成因是**凭据/权限**，不是「未落地」✗。
   *
   *   · ok=false            ⇒ 探针**失明**（无凭据 / 网络 / 权限）⇒ 不构成任何结论
   *   · ok=true, sha=''     ⇒ 探针**确实读到仓库**且远端**没有该分支** ⇒ 可作否定证据（空仓/新分支未建）
   *   · ok=true, sha=<sha>  ⇒ 远端该分支的真实 sha（可正可负比对）
   */
  const lsRemoteProbe = () => {
    try {
      // 通道 1：SSH（与推送同源）。推送走 ssh:443 时核验也必须走同一条——
      //   origin 常是 https 而本机 https 通道不通，只跑 origin 会让探针永远「失明」，
      //   于是明明推送成功却报「未能核验远端」（实测就是这个现象）。
      const ssh = liveRemoteHead({ repoPath, branch: branchRef, remote });
      if (ssh.ok && ssh.sha) return { ok: true, sha: ssh.sha, via: ssh.via };
      // 通道 2：origin（https + 凭据 env）。私有库跳过——镜像/直连都看不到私有库，试了只会多一条失败。
      if (cachedVisibility(repoPath) === 'private') return { ok: false, sha: '', err: '私有库跳过 origin(https) 通道（统一前置判断）' };
      // ⚠️ 必须带**凭据 env**：私有库上不带凭据的 ls-remote 会静默返回空（HTTPS 下等同 404）——
      //   那会让「第二路证据」失明。故这一路必须复用插件自己的凭据装配（SSH 私钥 / HTTPS askpass）：
      //   exec.js 的 runGit 是裸 git，只有 wrapped-git.js 的 buildWrappedGitEnv 会注入凭据。
      const out = runGit(['ls-remote', 'origin', branchRef], { cwd: repoPath, env: buildWrappedGitEnv({ workspaceRoot: repoPath }) });
      if (!out || out.ok !== true) {
        return { ok: false, sha: '', err: String(out?.stderr || 'ls-remote 调用失败').trim().slice(0, 200) };
      }
      const line = String(out.stdout || '').split('\n').find((l) => l.trim());
      return { ok: true, sha: line ? line.trim().split(/\s+/)[0] : '' };
    } catch (e) {
      return { ok: false, sha: '', err: String(e?.message || e).slice(0, 200) };
    }
  };
  /** 兼容旧调用点：只取 sha（空串 = 没取到；**不区分**「失败」与「取到但为空」） */
  const lsRemoteSha = () => lsRemoteProbe().sha;
  try {
    const br = await githubFetch(`/repos/${pr.owner}/${pr.repo}/branches/${encodeURIComponent(branchRef)}`,
      { token: pr.token || verifyToken, method: 'GET' });
    const remoteSha = String(br?.json?.commit?.sha || '');
    // 比对对象是**本次推送所报的 sha**（pr.commitSha）：API 通道会在远端新建提交对象，
    //   其 sha 与本地 HEAD 本来就不同（设计如此，见 fetchRemoteBranchRef 注释），
    //   拿本地 HEAD 比对会永远失败。SSH 通道下 pr.commitSha 即本地提交 sha。
    if (remoteSha && (!pushedSha || remoteSha === pushedSha)) {
      verified = true;
    } else if (remoteSha) {
      // API 说「远端有这个分支、但 sha 与本次不符」——**不能据此判失败**：
      //   实测 GitHub 分支接口会返回**滞后值**（推送已成功、ls-remote 已更新，API 仍回上一版 sha ⇒ 假失败）。
      //   故任何"失败"结论都必须两路一致：先 ls-remote 复核，再决定。
      const gitSha = lsRemoteSha();
      if (gitSha && pushedSha && gitSha === pushedSha) {
        verified = true;
        pushSlot.verifyNote = `API 分支接口返回滞后 sha ${remoteSha.slice(0, 7)}，ls-remote 复核为 ${gitSha.slice(0, 7)}（与本次一致）——判定为已落地`;
      } else if (gitSha) {
        verified = false;
        verifyError = `远端 ${branchRef} 的 sha：API ${remoteSha.slice(0, 7)} / ls-remote ${gitSha.slice(0, 7)}，两者均 ≠ 本次推送的 ${pushedSha.slice(0, 7)}——推送未落地（两路都取到具体 sha，证据充分）`;
      } else {
        // 只有 API 一路有值、ls-remote 没取到 ⇒ **不足以**下否定结论（API 分支接口实测会返回滞后 sha）
        verified = null;
        verifyError = `未能核验远端 ${branchRef}：API 报 sha ${remoteSha.slice(0, 7)}（≠ 本次 ${pushedSha.slice(0, 7)}），但 ls-remote 探针未取到（可能无凭据/网络/限流，或索引延迟）——**不据此判「未落地」**`;
      }
    } else {
      // API 没给 sha：**不据此判失败**（403/404 都可能是探针问题）⇒ 用 ls-remote 三态探针复核。
      const probe = lsRemoteProbe();
      const gitSha = probe.sha;
      if (gitSha && (!pushedSha || gitSha === pushedSha)) {
        verified = true;
      } else if (gitSha) {
        verified = false;
        verifyError = `远端 ${branchRef} 的 sha ${gitSha.slice(0, 7)} ≠ 本次推送的 ${pushedSha.slice(0, 7)}——推送未落地（API HTTP ${br?.status}；ls-remote 取到具体 sha，证据充分）`;
      } else if (probe.ok) {
        // 探针**成功返回且为空** ⇒ 确实读到仓库、远端没有该分支 ⇒ 这是**可用的否定证据**（空仓/新分支未建）
        verified = false;
        verifyError = `远端没有分支 ${branchRef}——推送未落地（ls-remote 带凭据成功返回为空；API HTTP ${br?.status}）`;
      } else {
        // 关键修复：探针**本身失败**（无凭据/网络/权限）⇒ 只能报「未核验」，**不许**判「未落地」
        //   （用户实测误报：旧实现把这里判成失败，输出「远端查不到分支 main（两条通道一致…远端可能是空仓库）」）
        verified = null;
        const dg = classifyPushFailure(String(probe.err || ''), { httpStatus: br?.status });
        verifyError = `未能核验远端 ${branchRef}：API HTTP ${br?.status}，ls-remote 探针失败（分类 ${dg.code}：${dg.inference}）——推送动作未报错，但结果未经核对；**这不构成「未落地」的证据**｜下一步：${dg.nextSteps[0] || ''}`;
      }
    }
  } catch (e) {
    // API 抛异常：仍以 ls-remote 复核，避免把「探针坏了」当成「没推上去」
    const gitSha = lsRemoteSha();
    if (gitSha && (!pushedSha || gitSha === pushedSha)) {
      verified = true;
      pushSlot.verifyNote = `API 校验异常（${String(e?.message || e).slice(0, 60)}），已用 ls-remote 复核为一致`;
    } else if (gitSha) {
      verified = false;
      verifyError = `远端 ${branchRef} 的 sha ${gitSha.slice(0, 7)} ≠ 本次推送的 ${pushedSha.slice(0, 7)}——推送未落地`;
    } else if (lsRemoteProbe().ok) {
      // 探针成功返回且为空 ⇒ 确实没有该分支 ⇒ 可用作否定证据
      verified = false;
      verifyError = `远端没有分支 ${branchRef}——推送未落地（ls-remote 带凭据成功返回为空；API 异常：${String(e?.message || e).slice(0, 60)}）`;
    } else {
      // 探针也失明 ⇒ 只报未核验（**不判失败**）
      verifyError = `未能核验远端 ${branchRef}：API 异常（${String(e?.message || e).slice(0, 60)}）且 ls-remote 探针失败——推送动作已完成，但结果未经核对；**不据此判「未落地」**`;
    }
  }
  pushSlot.verified = verified;
  if (verifyError) pushSlot.verifyError = verifyError;
  return { push: pushSlot, autoTag, heads };
}

/* ───────────────────────── 提交推送 ───────────────────────── */

/** README 检查提示（提交前核对 README 是否同步）。 */
export function readmeCheckHint(repoPath) {
  const hasReadme = ['README.md', 'readme.md', 'README', 'readme'].some((n) => existsSync(join(repoPath, n)));
  return hasReadme
    ? { needed: true, hasReadme: true, hint: '提交前核对 README：功能表/版本记录/用法与本次改动一致，过时先改 README 再提交' }
    : { needed: true, hasReadme: false, hint: '仓库无 README，提交前先补（可用脚本 `node scripts/readme-gen.mjs <repo> [--write README.md]` 生成，或按 docs/ 文档模板写）' };
}

/**
 * 手动推送当前分支（账号卡片「本地仓库领先 → 手动 push」入口）。
 * 前置校验：是 git 仓库 + 工作树干净（changed=0）+ 有上游跟踪 + 领先远端（ahead>0），
 *   全过才调 dispatchPush（走配置的推送通道，默认 ssh）。
 * @param {{repoPath?:string, pushMethod?:string}} opts
 * @returns {{ok:boolean, branch?, ahead?, behind?, changed?, pushed?, push?, error?}}
 */
export async function pushCurrentBranch({ repoPath = '', pushMethod = 'ssh', remote = '' } = {}) {
  if (!repoPath || !existsSync(join(repoPath, '.git'))) return { ok: false, error: `非 git 仓库: ${repoPath || '(空)'}` };
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath }).stdout.trim() || '';
  const status = runGit(['status', '--porcelain'], { cwd: repoPath }).stdout;
  const changed = status ? status.split('\n').filter(Boolean).length : 0;
  const up = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: repoPath });
  const upstream = up.ok && up.stdout.trim() ? up.stdout.trim() : '';
  // 指定 remote 时以它为基准（多 remote / fork 场景）；否则沿用 origin
  const originUrl = runGit(['remote', 'get-url', remote || 'origin'], { cwd: repoPath }).stdout.trim();
  // 放宽「必须已 -u 建立上游」——无 @{u} 但有远端同样可推
  //   （dispatchPush 走 `git push <远端> HEAD:refs/heads/<分支>`，不依赖上游跟踪）。
  //   领先比较基准 = @{u}，否则 origin/<当前分支>；本地无该 ref（未 fetch 过）时
  //   ls-remote 一次性对比远端同名分支（单仓库单次网络）；远端无同名分支 = 首次推送创建。
  const base = upstream || (originUrl ? `origin/${branch}` : '');
  let ahead = 0, behind = 0, remoteMissing = false, compareFailed = false;
  // 优先 live ls-remote：origin 是 https 时本地 fetch 常失败，origin/<branch> 缓存过期
  //   会把「远端已前走」显示成「领先 N」，点 push 才报分叉。
  const live = originUrl ? liveRemoteHead({ repoPath, branch, remote }) : { ok: false, sha: '' };
  if (live.ok && live.sha) {
    const rcLive = runGit(['rev-list', '--left-right', '--count', `HEAD...${live.sha}`], { cwd: repoPath });
    if (rcLive.ok) {
      const parts = (rcLive.stdout || '').trim().split(/\s+/).map(Number);
      ahead = Number(parts[0]) || 0;
      behind = Number(parts[1]) || 0;
    } else {
      // 远端 sha 本地没有 → 远端有本地未知提交（缓存过期 / 未 fetch）
      return {
        ok: false, ahead, behind, changed,
        error: `远端已有本地没有的提交 ${(live.sha || '').slice(0, 7)}（本地 origin/${branch} 缓存过期）。请先 fetch 整合再推，或确认后 force。`,
      };
    }
  } else if (base) {
    const rc = runGit(['rev-list', '--left-right', '--count', `HEAD...${base}`], { cwd: repoPath });
    if (rc.ok) {
      const parts = (rc.stdout || '').trim().split(/\s+/).map(Number);
      ahead = Number(parts[0]) || 0;
      behind = Number(parts[1]) || 0;
    } else {
      compareFailed = true;
    }
  } else compareFailed = true;
  if (live.ok && !live.sha) remoteMissing = true;
  // 修正：「工作树未提交改动」不再是 push 的拦截条件——git push 推的是**已提交**
  //   内容，工作树脏不脏不影响本次推送（新改动仍留在本地，下次提交再推）。原实现
  //   `if (changed > 0) return 先提交再推送` 把「有领先提交但工作树也脏」的仓库拦死；
  //   真正决定可推与否的是下方 ahead>0（有未推送的提交）。
  if (!originUrl) return { ok: false, ahead, behind, changed, error: '仓库无远端 origin，无法推送' };
  if (compareFailed) return { ok: false, ahead, behind, changed, error: '无法确认远端状态（本地未 fetch 且 ls-remote 失败）——请先 git fetch 或检查网络' };
  if (ahead <= 0) return { ok: false, ahead, behind, changed, error: '当前分支未领先远端（没有可推送的新提交）' };
  if (behind > 0) return { ok: false, ahead, behind, changed, error: `本地与远端分叉（本地领先 ${ahead}，远端领先 ${behind}）——先 pull 合并远端提交再推送` };
  const push = await dispatchPush({ repoPath, branch, pushMethod, remote });
  return { ok: push.ok === true, branch, ahead, behind, changed, pushed: push.pushed, push, error: push.error || push.reason };
}
