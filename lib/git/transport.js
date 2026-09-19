/**
 * Git 执行层 · 推送通道
 *
 * 职责：通道选择（dispatchPush）、远端 head 查询、SSH 推送、API 推送、推送结果核对。
 *
 * 两个通道的本质差别（选通道前必须知道）：
 *   - SSH：`git push <ssh-url> HEAD:refs/heads/<branch>`，上传的是**本地提交对象本身**，
 *     推上去的 sha 与本地 HEAD 完全一致。
 *   - API：走 Git Data API（blob → tree → commit → ref）**在远端重建提交**，
 *     父提交/作者/时间戳都是新造的 → 远端 sha 必然与本地不同，本地与远端从此分叉。
 *   因此默认通道是 SSH（pushMethod 默认 'ssh'）；只有没有可用私钥时才回落 API。
 */

import { join } from 'node:path';
import { githubFetch, isBadCredentials, parseGithubOwnerRepo } from './api.js';
import { resolveSshKey, resolveSshKeys, resolveToken } from './credentials.js';
import { gitRaw, runGit, runGitAsync } from './exec.js';

/**
 * 推送后回传远端最近 count 次提交（SHA/标题/时间），供工具结果展示。
 * 复用 githubFetch（api.github.com）；失败返回 { ok:false }（不阻断主流程）。
 * @returns {{ok:boolean, owner?, repo?, branch?, heads?: {sha,title,date}[], error?}}
 */
export async function fetchRemoteHeads({ owner = '', repo = '', branch = '', token = '', count = 3 } = {}) {
  if (!owner || !repo) return { ok: false, error: '缺 owner/repo' };
  const query = `sha=${encodeURIComponent(branch || '')}&per_page=${Number(count) || 3}`;
  const commitsResp = await githubFetch(`/repos/${owner}/${repo}/commits?${query}`, { token, timeout: 20_000 });
  if (commitsResp.status !== 200 || !Array.isArray(commitsResp.json)) {
    return { ok: false, error: commitsResp.error || `commits ${commitsResp.status}`, heads: [] };
  }
  const heads = (commitsResp.json || []).map((c) => ({
    sha: (c?.sha || '').slice(0, 7),
    title: c?.commit?.message?.split('\n')[0] || '',
    date: c?.commit?.author?.date || '',
  })).filter((h) => h.sha);
  return { ok: true, owner, repo, branch, heads };
}

/* ───────────────────────── 推送：通道调度 + 两条通道实现 ───────────────────────── */

/**
 * 推送通道调度（单一决策点）。
 *
 * pushMethod 三档语义：
 *   - 'ssh'（默认）：SSH 优先。有可用私钥就走 SSH（推本地 HEAD，远端 sha == 本地 sha，
 *     本地与远端不分叉）；无密钥或 SSH 推送失败 → 回落 API 并如实标注 fallback 原因。
 *   - 'api'：API 优先（Git Data API 重建提交）；失败时回落 SSH。
 *   - 'auto'：探测优先——有私钥走 SSH，否则直接 API（不产生一次失败的尝试记录）。
 *
 * 为什么默认 ssh：API 通道会在远端重建 commit，推完远端 sha 与本地不同（本地 origin/master
 *   引用与实际远端对不上），需要额外 fetch 才能对齐；SSH 直接用本地对象，sha 天然一致。
 * @param {object} p { repoPath, branch?, token?, force?, pushMethod? }
 * @returns {Promise<{ok, pushed, method?, reason?, fallbackReason?, key?, ...}>}
 */
export async function dispatchPush({ repoPath = '', branch = '', token = '', force = false, pushMethod = 'ssh' } = {}) {
  const mode = String(pushMethod || 'ssh').toLowerCase();
  const hasKey = resolveSshKeys().length > 0;

  const trySsh = () => pushViaSsh({ repoPath, branch, force });
  const tryApi = () => pushViaApi({ repoPath, branch, token, force });

  if (mode === 'api') {
    const apiRes = await tryApi();
    if (apiRes.ok) return apiRes;
    const sshRes = trySsh();
    if (sshRes.ok) return sshRes;
    return { ok: false, pushed: false, method: 'api', reason: `API: ${apiRes.reason}；SSH: ${sshRes.reason}` };
  }

  if (mode === 'auto' && !hasKey) return tryApi();

  // 'ssh'（默认）与 'auto' 且存在密钥：SSH 优先
  const sshRes = trySsh();
  if (sshRes.ok) return sshRes;
  // 远端分叉时不回落 API：API 会在远端重建提交、再分一条叉，且以「推送成功」掩盖成因。
  //   此处如实报错，由调用方决定 force 强推还是先整合远端。
  if (isNonFastForward(sshRes.reason)) {
    const localHead = runGit(['rev-parse', 'HEAD'], { cwd: repoPath }).stdout;
    const cur = branch || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout || 'master';
    const cached = runGit(['rev-parse', `refs/remotes/origin/${cur}`], { cwd: repoPath }).stdout;
    const live = liveRemoteHead({ repoPath, branch: cur });
    const remoteHead = live.sha || cached || '';
    return {
      ok: false, pushed: false, method: 'ssh', diverged: true,
      localHead: localHead || '', remoteHead,
      reason: `远端已分叉（non-fast-forward）：本地 ${(localHead || '?').slice(0, 7)}`
        + ` 与远端 ${(remoteHead || '?').slice(0, 7)}`
        + (live.sha && cached && live.sha !== cached ? `（本地 origin/${cur} 缓存 ${(cached || '').slice(0, 7)} 已过期）` : '')
        + '。已阻止回落 API。请先 fetch 整合，或确认后 force。'
        + (sshRes.reason ? ` 原始：${sshRes.reason}` : ''),
    };
  }
  const apiRes = await tryApi();
  if (apiRes.ok) {
    apiRes.fallbackReason = `SSH 未成功（${sshRes.reason}）→ 回落 API（远端 sha 与本地不同）`;
    return apiRes;
  }
  return { ok: false, pushed: false, method: 'ssh', reason: `SSH: ${sshRes.reason}；API: ${apiRes.reason}` };
}

/**
 * 从 ssh/git 的 stderr 提取「真正的原因」。
 * 直接把 stderr 塞进结果，会把已知主机告警与 git 的「提示：」建议段一起带出来，
 * 前 120 字符常被告警占满、真正的失败原因（如 non-fast-forward）反被截掉。
 */
export function sshReason(stderr = '') {
  const raw = String(stderr || '');
  const lines = raw.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^Warning: Permanently added/.test(l))
    .filter((l) => !/^(提示：|hint:|remote:)/.test(l));
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return (text || raw.trim() || 'ssh push 失败').slice(-320);
}

/**
 * 判定是否为「远端分叉」（non-fast-forward）。
 * 用途是拦住 API 回落：分叉时回落 API 会在远端**再重建一个提交**，本地与远端又多分一条叉，
 * 每推一次多分一次，且成因被「推送成功」掩盖——正是默认走 SSH 要避免的情形。
 */
export function isNonFastForward(text = '') {
  return /non-fast-forward|fetch first|Updates were rejected|更新被拒绝|远程仓库包含您本地尚不存在的提交/i.test(String(text));
}

/**
 * 2026-09-19 优化：SSH 连接复用（ControlMaster）——列表逐仓探测时把 N 次 SSH 握手降到 1 次。
 *
 * 背景：liveRemoteHead 每次调用都新建 SSH 连接，而单次握手约 4~6s（实测 6.3s），
 *   真正的 ls-remote 只占其中一小部分。实测同一 ControlPath 下第二次起降到 ~1.6s
 *   （省约 74%），跨仓库同样有效（首个 4.1s、后续 1.5~1.9s）。
 *   列表里多仓串行时这是决定「是否超预算被熔断」的关键，故引入共享 ControlPath。
 *
 * 生命周期：用模块级单例 socket，惰性创建、进程退出时关闭；DSH_GIT_PUSH_NO_SSH_MUX=1
 *   可关闭复用（排查连接问题时用）。任何失败都退化为「不复用」，不影响功能正确性。
 */
let _sshMuxCtlPath = '';
function sshMuxCtlPath() {
  if (process.env.DSH_GIT_PUSH_NO_SSH_MUX === '1') return '';
  if (_sshMuxCtlPath) return _sshMuxCtlPath;
  // 2026-09-19：ControlPath **不含 pid**——含 pid 时每个进程（含插件每次重载）各建一个
  //   socket，既无法跨调用复用、又会在 reload 后残留 /tmp 垃圾。实测稳定路径可跨进程复用
  //   （进程 A 3.8s 建立 → 进程 B/C 分别 1.45s/1.97s），且 DSH 里 repos-local 由同一长驻
  //   进程处理，命中率很高。用 uid 隔离多用户，避免 /tmp 权限冲突。
  const uid = (() => { try { return process.getuid ? process.getuid() : 'x'; } catch { return 'x'; } })();
  _sshMuxCtlPath = join('/tmp', `dsh-git-push-mux-${uid}`);
  // 2026-09-19：**不注册 exit 清理**。ControlPath 稳定后是「全机共享」的连接池，
  //   在退出时 `ssh -O exit` 会把其他进程/会话正在复用的连接一并掐断（且 -O exit 对
  //   共享 socket 是全局语义）。ControlPersist=60 已保证空闲连接 60s 后自行回收，
  //   无需手工清理——这也避免了 /tmp 残留。
  return _sshMuxCtlPath;
}

/** 组装 ls-remote 用的 GIT_SSH_COMMAND（含 ControlMaster 复用参数）。 */
function buildLsRemoteSshCmd(keyPath, known, { mux = true } = {}) {
  const base = `ssh -i "${keyPath}" -p 443 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${known}" -o BatchMode=yes -o ConnectTimeout=5`;
  const ctl = mux ? sshMuxCtlPath() : '';
  if (!ctl) return base;
  // 复用：首个连接成为 master 并在 ControlPersist 内保活，后续直接走已有 socket
  return `${base} -o ControlMaster=auto -o ControlPath="${ctl}" -o ControlPersist=60`;
}

/**
 * 用插件 SSH 密钥 live ls-remote 远端分支 HEAD（不依赖过期的 origin/<branch> 缓存）。
 * origin 是 https 时本地 fetch 常失败，账号卡片会把「远端已前走」显示成「领先 N」。
 * @returns {{ok:boolean, sha:string, via?:string}}
 */
export function liveRemoteHead({ repoPath = '', branch = '' } = {}) {
  // 2026-09-16：离线开关（单测/无外网）——直接失败，不触发 SSH/网络 ls-remote（防挂起）
  if (process.env.DSH_GIT_PUSH_OFFLINE === '1') return { ok: false, sha: '', via: 'offline' };
  const origin = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout;
  const pr = parseGithubOwnerRepo(origin);
  const target = branch || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout;
  if (!pr || !target) return { ok: false, sha: '' };
  const sshUrl = `ssh://git@ssh.github.com:443/${pr.owner}/${pr.repo}.git`;
  const known = join('/tmp', `dsh-git-push-known-hosts-${process.pid}`);
  // 2026-09-16 修复：ls-remote 必须**短超时**——此前用 runGit 默认 120s，本地列表逐仓 SSH
  //   探测时一旦网络慢/不通，多仓叠加会把「读列表」卡死数分钟（打开面板像死机）。
  //   现在 SSH ConnectTimeout=5 + git 侧 8s、最多试 2 个 key，保证列表秒级返回。
  const LS_TIMEOUT = 8_000;
  let tried = 0;
  for (const { keyPath, kind } of resolveSshKeys()) {
    if (tried >= 2) break; // 最多试 2 个 key，避免多 key 串行放大耗时
    tried += 1;
    const sshCmd = buildLsRemoteSshCmd(keyPath, known);
    const r = runGit(['ls-remote', sshUrl, `refs/heads/${target}`], { cwd: repoPath, env: { GIT_SSH_COMMAND: sshCmd }, timeoutMs: LS_TIMEOUT });
    if (r.ok) {
      const sha = (r.stdout || '').trim().split(/\s+/)[0] || '';
      if (sha) return { ok: true, sha, via: kind };
    }
  }
  const lr = runGit(['ls-remote', 'origin', `refs/heads/${target}`], { cwd: repoPath, timeoutMs: LS_TIMEOUT });
  if (lr.ok) {
    const sha = (lr.stdout || '').trim().split(/\s+/)[0] || '';
    if (sha) return { ok: true, sha, via: 'origin' };
  }
  return { ok: false, sha: '' };
}

/** SSH 回退：ssh.github.com:443（token 401 时）。force=true 时 --force（覆盖远端历史）。 */
export function pushViaSsh({ repoPath = '', branch = '', force = false }) {
  const keys = resolveSshKeys();
  if (!keys.length) return { ok: false, pushed: false, reason: '无 SSH 私钥（配置目录 id_rsa/id_ed25519/id_ecdsa）' };
  const origin = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout;
  const pr = parseGithubOwnerRepo(origin);
  if (!pr) return { ok: false, pushed: false, reason: '无法解析 origin owner/repo' };
  const target = branch || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout;
  if (!target) return { ok: false, pushed: false, reason: '无法确定目标分支' };
  const sshUrl = `ssh://git@ssh.github.com:443/${pr.owner}/${pr.repo}.git`;
  const known = join('/tmp', `dsh-git-push-known-hosts-${process.pid}`);
  // 逐个试探测到的密钥：配置目录里可能同时存在多把，其中未登记到 GitHub 的那把会
  //   报 Permission denied (publickey)，这里换下一把继续，避免「有可用密钥却推不动」。
  const tried = [];
  for (const { keyPath, kind } of keys) {
    const sshCmd = `ssh -i "${keyPath}" -p 443 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${known}" -o BatchMode=yes`;
    const pushArgs = ['push', ...(force ? ['--force'] : []), sshUrl, `HEAD:refs/heads/${target}`];
    const r = runGit(pushArgs, { cwd: repoPath, env: { GIT_SSH_COMMAND: sshCmd } });
    if (r.ok) {
      return { ok: true, pushed: true, method: 'ssh', force, key: kind, owner: pr.owner, repo: pr.repo, branch: target };
    }
    tried.push(`${kind}: ${sshReason(r.stderr)}`);
  }
  return { ok: false, pushed: false, method: 'ssh', reason: tried.join(' ｜ ').slice(-700) };
}

/** token 401/坏凭据 → SSH 回退；回退也失败则返回统一失败对象。 */
async function sshFallback(repoPath, branch) {
  const fb = await pushViaSsh({ repoPath, branch });
  return fb.ok ? fb : { ok: false, pushed: false, method: 'ssh-fallback', reason: `token 失效（API 401）→ SSH 回退失败: ${fb.reason}` };
}

/** 判定 GitHub 返回是否「凭据不可用」（401 / Bad credentials），是则走 SSH 回退。 */
async function apiOrFallback(api, repoPath, branch, res) {
  if (isBadCredentials(res.error || `HTTP ${res.status}`) || res.status === 401) {
    return sshFallback(repoPath, branch);
  }
  return null; // 正常结果（含 404 等非凭据错误），由调用方继续处理
}

/**
 * 推送（api.github.com Git Data API：blob → tree → commit → ref）。
 * token 401 → pushViaSsh 回退。
 * @returns {{ok, pushed, method?, commitSha?, reason?, branchAdjusted?}}
 */
export async function pushViaApi({ repoPath = '', branch = '', token = '', force = false } = {}) {
  const origin = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout;
  const pr = parseGithubOwnerRepo(origin);
  if (!pr) return { ok: false, pushed: false, reason: `无法从 origin 解析 owner/repo（${origin || '无 origin'}）` };
  const { owner, repo } = pr;
  const tok = token || resolveToken({ repoPath }).token;
  const api = (path, method = 'GET', body) => githubFetch(`/repos/${owner}/${repo}${path}`, { token: tok, method, body });

  const headSha = runGit(['rev-parse', 'HEAD'], { cwd: repoPath }).stdout;
  if (!headSha) return { ok: false, pushed: false, reason: '本地无提交' };
  const lsOut = runGit(['ls-tree', '-r', 'HEAD'], { cwd: repoPath }).stdout;
  const entries = lsOut.split('\n').filter(Boolean).map((l) => {
    const match = l.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t(.*)$/);
    return match && match[2] === 'blob' ? { mode: match[1], type: match[2], sha: match[3], path: match[4] } : null;
  }).filter(Boolean);
  if (!entries.length) return { ok: false, pushed: false, reason: '本地 tree 为空' };

  // 分支解析：远端 default_branch 优先（防误建错名分支）
  let targetBranch = branch || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout || 'master';
  let branchAdjusted = null;
  const meta = await api('');
  const fb1 = await apiOrFallback(api, repoPath, targetBranch, meta);
  if (fb1) return fb1;
  const refRes = await api(`/git/ref/heads/${targetBranch}`);
  const fb2 = await apiOrFallback(api, repoPath, targetBranch, refRes);
  if (fb2) return fb2;
  // 分支免疫：仅当「请求分支在远端不存在」且「远端有不同名 default_branch」时才改用
  // 默认分支——防误建错名新分支；请求分支已存在则保持请求值（v2 旧实现无条件切 default，会误切已有分支）
  const hasRequestedRef = refRes.status === 200;
  if (!hasRequestedRef && !branchAdjusted && meta.status === 200 && meta.json?.default_branch && meta.json.default_branch !== targetBranch) {
    branchAdjusted = { from: targetBranch, to: meta.json.default_branch };
    targetBranch = meta.json.default_branch;
  }
  const refRes2 = branchAdjusted ? await api(`/git/ref/heads/${targetBranch}`) : refRes;
  const fb3 = branchAdjusted ? await apiOrFallback(api, repoPath, targetBranch, refRes2) : null;
  if (fb3) return fb3;
  const remoteHead = refRes2.status === 200 ? refRes2.json?.object?.sha : null;

  // 内容级短路：远端 HEAD==本地 HEAD 或 tree sha 相同 → 无新内容可推，不建冗余 commit。
  // force=覆盖历史：即使 tree 相同也要换 commit（去掉旧 parent）。
  if (!force) {
    if (remoteHead === headSha) {
      return { ok: true, pushed: false, reason: '无新提交可推送', owner, repo, branch: targetBranch, branchAdjusted };
    }
    if (remoteHead) {
      const localTree = runGit(['rev-parse', 'HEAD^{tree}'], { cwd: repoPath }).stdout;
      const rc = await api(`/git/commits/${remoteHead}`);
      const remoteTree = rc.json?.tree?.sha;
      if (localTree && remoteTree && localTree === remoteTree) {
        return { ok: true, pushed: false, reason: '无新提交可推送', owner, repo, branch: targetBranch, branchAdjusted };
      }
    }
  }

  // 远端已有 blob sha（复用，减少 API 调用）
  const remoteBlobShas = new Set();
  if (remoteHead) {
    const t = await api(`/git/trees/${remoteHead}?recursive=1`);
    if (t.status === 200 && Array.isArray(t.json?.tree)) {
      for (const e of t.json.tree) if (e.type === 'blob') remoteBlobShas.add(e.sha);
    }
  }
  const treeBuilt = await uploadBlobsAndBuildTree({ repoPath, entries, remoteBlobShas, api });
  if (!treeBuilt.ok) return treeBuilt.fail;

  // 建 commit（parent=远端 HEAD；force 不挂 parent）
  const msg = runGit(['log', '-1', '--format=%s'], { cwd: repoPath }).stdout || 'chore: push via api';
  const commit = await api('/git/commits', 'POST', { message: msg, tree: treeBuilt.treeSha, ...(!force && remoteHead ? { parents: [remoteHead] } : {}) });
  if (commit.status !== 201) return { ok: false, pushed: false, reason: `建 commit 失败: ${commit.json?.message || commit.status}` };

  // 更新 ref（有则 PATCH，无则 POST 创建）
  if (remoteHead) {
    const r = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: commit.json.sha, force: !!force });
    if (r.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r.json?.message || r.status}` };
  } else {
    const r = await api('/git/refs', 'POST', { ref: `refs/heads/${targetBranch}`, sha: commit.json.sha });
    if (r.status !== 201) {
      if (r.status === 422) {
        const r2 = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: commit.json.sha, force: !!force });
        if (r2.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r2.json?.message || r2.status}` };
      } else {
        return { ok: false, pushed: false, reason: `创建 ref 失败: ${r.json?.message || r.status}` };
      }
    }
  }
  return { ok: true, pushed: true, method: 'api', commitSha: commit.json.sha, owner, repo, branch: targetBranch, branchAdjusted };
}

/**
 * 逐 blob 上传（远端已有 sha 直接复用）+ 建 tree（拆分自 pushViaApi，控制单函数行数）。
 * @returns {{ok:true, treeSha: string} | {ok:false, fail: object}}
 */
async function uploadBlobsAndBuildTree({ repoPath, entries, remoteBlobShas, api }) {
  const fail = (reason) => ({ ok: false, fail: { ok: false, pushed: false, reason } });
  const treeEntries = [];
  for (const e of entries) {
    if (remoteBlobShas.has(e.sha)) { treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha }); continue; }
    // 【修复 2026-09-11】读 blob 必须走 gitRaw（buffer 通道）：runGit 的 utf8+trim
    // 会丢末尾换行/损坏非 UTF-8 字节 → 上传 blob sha 与本地不一致（实测 17/109 文件损坏）。
    // 判据只认 status：0 = 成功（空内容是合法空 blob）；非 0 才是真失败（gitRaw 语义）。
    const raw = gitRaw(['cat-file', 'blob', e.sha], { cwd: repoPath });
    if (raw.status !== 0) return fail(`读 blob 失败: ${e.path}`);
    const b = await api('/git/blobs', 'POST', { content: raw.stdout.toString('base64'), encoding: 'base64' });
    if (b.status !== 201) return fail(`上传 blob 失败 ${e.path}: ${b.json?.message || b.status}`);
    treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: b.json.sha });
  }
  const t = await api('/git/trees', 'POST', { tree: treeEntries });
  if (t.status !== 201) return fail(`建 tree 失败: ${t.json?.message || t.status}`);
  return { ok: true, treeSha: t.json.sha };
}

/**
 * liveRemoteHead 的**异步版**：语义与返回值完全一致，改用 runGitAsync 以便真正并发。
 *
 * 2026-09-19 新增：列表逐仓探测时，同步版 runGit 会阻塞事件循环，Promise worker 无法并行
 *   （实测 6 仓仍要 13s）。本函数让各仓的 git 子进程真正并行等待，配合 SSH 连接复用
 *   （ControlMaster）把 N 仓总耗时压到接近单仓。
 * @returns {Promise<{ok:boolean, sha:string, via?:string}>}
 */
export async function liveRemoteHeadAsync({ repoPath = '', branch = '' } = {}) {
  if (process.env.DSH_GIT_PUSH_OFFLINE === '1') return { ok: false, sha: '', via: 'offline' };
  const origin = (await runGitAsync(['remote', 'get-url', 'origin'], { cwd: repoPath })).stdout;
  const pr = parseGithubOwnerRepo(origin);
  const target = branch || (await runGitAsync(['branch', '--show-current'], { cwd: repoPath })).stdout;
  if (!pr || !target) return { ok: false, sha: '' };
  const sshUrl = `ssh://git@ssh.github.com:443/${pr.owner}/${pr.repo}.git`;
  const known = join('/tmp', `dsh-git-push-known-hosts-${process.pid}`);
  const LS_TIMEOUT = 8_000;
  let tried = 0;
  for (const { keyPath, kind } of resolveSshKeys()) {
    if (tried >= 2) break; // 最多试 2 个 key，避免多 key 串行放大耗时
    tried += 1;
    const sshCmd = buildLsRemoteSshCmd(keyPath, known);
    const r = await runGitAsync(['ls-remote', sshUrl, `refs/heads/${target}`], { cwd: repoPath, env: { GIT_SSH_COMMAND: sshCmd }, timeoutMs: LS_TIMEOUT });
    if (r.ok) {
      const sha = (r.stdout || '').trim().split(/\s+/)[0] || '';
      if (sha) return { ok: true, sha, via: kind };
    }
  }
  const lr = await runGitAsync(['ls-remote', 'origin', `refs/heads/${target}`], { cwd: repoPath, timeoutMs: LS_TIMEOUT });
  if (lr.ok) {
    const sha = (lr.stdout || '').trim().split(/\s+/)[0] || '';
    if (sha) return { ok: true, sha, via: 'origin' };
  }
  return { ok: false, sha: '' };
}
