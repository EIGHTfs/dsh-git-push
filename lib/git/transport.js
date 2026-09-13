/**
 * Git 执行层 · 推送通道
 *
 * 职责：远端 head 查询、SSH 推送、API 推送（无 SSH 环境下的回退通道，
 *   经 Git Data API 上传 blob 并重建 tree/commit）、推送结果核对。
 */

import { join } from 'node:path';
import { githubFetch, isBadCredentials, parseGithubOwnerRepo } from './api.js';
import { resolveSshKey, resolveToken } from './credentials.js';
import { gitRaw, runGit } from './exec.js';

/**
 * 推送后回传远端最近 count 次提交（SHA/标题/时间），供工具结果展示。
 * 复用 githubFetch（api.github.com）；失败返回 { ok:false }（不阻断主流程）。
 * @returns {{ok:boolean, owner?, repo?, branch?, heads?: {sha,title,date}[], error?}}
 */
export async function fetchRemoteHeads({ owner = '', repo = '', branch = '', token = '', count = 3 } = {}) {
  if (!owner || !repo) return { ok: false, error: '缺 owner/repo' };
  const q = `sha=${encodeURIComponent(branch || '')}&per_page=${Number(count) || 3}`;
  const res = await githubFetch(`/repos/${owner}/${repo}/commits?${q}`, { token, timeout: 20_000 });
  if (res.status !== 200 || !Array.isArray(res.json)) {
    return { ok: false, error: res.error || `commits ${res.status}`, heads: [] };
  }
  const heads = (res.json || []).map((c) => ({
    sha: (c?.sha || '').slice(0, 7),
    title: c?.commit?.message?.split('\n')[0] || '',
    date: c?.commit?.author?.date || '',
  })).filter((h) => h.sha);
  return { ok: true, owner, repo, branch, heads };
}

/* ───────────────────────── 推送：API 主通道 + SSH 回退 ───────────────────────── */

/** SSH 回退：ssh.github.com:443（token 401 时）。force=true 时 --force（覆盖远端历史）。 */
export function pushViaSsh({ repoPath = '', branch = '', force = false }) {
  const { keyPath } = resolveSshKey();
  if (!keyPath) return { ok: false, pushed: false, reason: '无 SSH 私钥（配置目录 id_rsa/id_ed25519/id_ecdsa）' };
  const origin = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout;
  const pr = parseGithubOwnerRepo(origin);
  if (!pr) return { ok: false, pushed: false, reason: '无法解析 origin owner/repo' };
  const target = branch || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout;
  if (!target) return { ok: false, pushed: false, reason: '无法确定目标分支' };
  const sshUrl = `ssh://git@ssh.github.com:443/${pr.owner}/${pr.repo}.git`;
  const known = join('/tmp', `dsh-git-push-known-hosts-${process.pid}`);
  const sshCmd = `ssh -i "${keyPath}" -p 443 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${known}" -o BatchMode=yes`;
  const pushArgs = ['push', ...(force ? ['--force'] : []), sshUrl, `HEAD:refs/heads/${target}`];
  const r = runGit(pushArgs, { cwd: repoPath, env: { GIT_SSH_COMMAND: sshCmd } });
  if (r.ok) return { ok: true, pushed: true, method: 'ssh', force, owner: pr.owner, repo: pr.repo, branch: target };
  return { ok: false, pushed: false, method: 'ssh', reason: (r.stderr || 'ssh push 失败').slice(0, 240) };
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
    const m = l.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t(.*)$/);
    return m && m[2] === 'blob' ? { mode: m[1], type: m[2], sha: m[3], path: m[4] } : null;
  }).filter(Boolean);
  if (!entries.length) return { ok: false, pushed: false, reason: '本地 tree 为空' };

  // 分支解析：远端 default_branch 优先（防误建错名分支）
  let targetBranch = branch || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout || 'master';
  let branchAdjusted = null;
  const meta = await api('');
  if (isBadCredentials(meta.error || `HTTP ${meta.status}`) || meta.status === 401) {
    const fb = pushViaSsh({ repoPath, branch: targetBranch });
    return fb.ok ? fb : { ok: false, pushed: false, method: 'ssh-fallback', reason: `token 失效（API 401）→ SSH 回退失败: ${fb.reason}` };
  }
  const refRes = await api(`/git/ref/heads/${targetBranch}`);
  if (isBadCredentials(refRes.error || `HTTP ${refRes.status}`) || refRes.status === 401) {
    const fb = pushViaSsh({ repoPath, branch: targetBranch });
    return fb.ok ? fb : { ok: false, pushed: false, method: 'ssh-fallback', reason: `token 失效（API 401）→ SSH 回退失败: ${fb.reason}` };
  }
  // 分支免疫：仅当「请求分支在远端不存在」且「远端有不同名 default_branch」时才改用
  // 默认分支——防误建错名新分支；请求分支已存在则保持请求值（v2 旧实现无条件切 default，会误切已有分支）
  const hasRequestedRef = refRes.status === 200;
  if (!hasRequestedRef && !branchAdjusted && meta.status === 200 && meta.json?.default_branch && meta.json.default_branch !== targetBranch) {
    branchAdjusted = { from: targetBranch, to: meta.json.default_branch };
    targetBranch = meta.json.default_branch;
  }
  const refRes2 = branchAdjusted ? await api(`/git/ref/heads/${targetBranch}`) : refRes;
  if (branchAdjusted && (isBadCredentials(refRes2.error || `HTTP ${refRes2.status}`) || refRes2.status === 401)) {
    const fb = pushViaSsh({ repoPath, branch: targetBranch });
    return fb.ok ? fb : { ok: false, pushed: false, method: 'ssh-fallback', reason: `token 失效（API 401）→ SSH 回退失败: ${fb.reason}` };
  }
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
  const c = await api('/git/commits', 'POST', { message: msg, tree: treeBuilt.treeSha, ...(!force && remoteHead ? { parents: [remoteHead] } : {}) });
  if (c.status !== 201) return { ok: false, pushed: false, reason: `建 commit 失败: ${c.json?.message || c.status}` };

  // 更新 ref（有则 PATCH，无则 POST 创建）
  if (remoteHead) {
    const r = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: !!force });
    if (r.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r.json?.message || r.status}` };
  } else {
    const r = await api('/git/refs', 'POST', { ref: `refs/heads/${targetBranch}`, sha: c.json.sha });
    if (r.status !== 201) {
      if (r.status === 422) {
        const r2 = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: !!force });
        if (r2.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r2.json?.message || r2.status}` };
      } else {
        return { ok: false, pushed: false, reason: `创建 ref 失败: ${r.json?.message || r.status}` };
      }
    }
  }
  return { ok: true, pushed: true, method: 'api', commitSha: c.json.sha, owner, repo, branch: targetBranch, branchAdjusted };
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
