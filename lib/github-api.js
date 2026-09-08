// dsh-git-push v1.42.0 — GitHub REST / Git Data API 通道（fetch/推送/可见性/auto-tag/远端 heads）（自 core.js 按功能拆分，行为零变化）

import { runGit, gitRaw } from './git-core.js';
import { readPkgVersion } from './repo-scan.js';
import { credentialsDir, resolveSshKey } from './token-credentials.js';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';

// GitHub REST / Git Data API 唯一入口。「所有功能都默认api.github.com」
// AI 思路：集中常量，所有 fetch 拼这个 origin；禁止再写 github.com 当网络目标。
export const GH_API = 'https://api.github.com';

// 每次 git 命令的 -c 前缀：忽略属主（dubious ownership）+ 忽略可执行位。
// 「新功能gitpush插件会git config --global core.filemode false」
// AI 思路：CIFS 上 chmod 不持久，status 会刷一堆 mode change 100644=>100755；
// 属主噪声是「检测到可疑的仓库所有权」——cwd 精确匹配不够（软链/父目录），再加 *。
// 全局写一次给裸 git / 其它进程；这里再带 -c，插件自己的 spawn 不依赖 HOME 可写。

export const README_CHECK_HINT = [
  '【dsh-git-push 提交前提醒】调用 git_commit_push 前必须检查该仓库 README：',
  '功能表 / 版本记录 / 用法是否与本次改动一致。需要更新则先改 README 再提交',
  '（可用 git_gen_readme 按模板生成）。不要把过时 README 推进远端。',
].join('');

/**
 * 按仓库是否有 README 生成提交时回传的检查块。
 * @param {{ hasReadme?: boolean, repoName?: string }} [opts]
 */

export function buildReadmeCheckHint({ hasReadme = true, repoName = '' } = {}) {
  const name = repoName ? `（${repoName}）` : '';
  if (!hasReadme) {
    return {
      needed: true,
      hasReadme: false,
      hint: `仓库${name}没有 README。提交前先补 README（git_gen_readme 或按同级仓模板写），再 git_commit_push。`,
    };
  }
  return { needed: true, hasReadme: true, hint: README_CHECK_HINT };
}

/**
 * 执行 git，返回 { status, stdout, stderr }。
 * v1.40.0：SSH 私钥改从插件配置目录探测（credentialsDir，原同级仓探测废除）；
 * v1.40.0：加 try/catch + maxBuffer 16MB 兜底——git 缺失（ENOENT）/输出超限不再抛出或静默截断，
 * 返回 { status: null, error } 由调用方走既有错误路径。
 */

export function httpsUrlOf(originUrl) {
  const pr = parseGithubOwnerRepo(originUrl);
  return pr ? `${GH_API}/repos/${pr.owner}/${pr.repo}` : '';
}

/** 本地 origin 字符串 → api.github.com/repos/{owner}/{repo}（不发起网络请求） */

export function apiOriginOf(owner, repo) {
  return `${GH_API}/repos/${owner}/${repo}`;
}

/**
 * 从 origin / URL / owner/repo 解析 GitHub owner+repo。
 * 2026-09-02：同时认 api.github.com/repos/o/r（新默认 origin）和历史 github.com / SSH 写法
 * （只解析字符串，不访问 github.com）。
 * 【原代码】先 httpsUrlOf 归一成 https://github.com/<owner>/<repo> 再 match github.com/
 * 【改为】「所有功能都默认api.github.com」
 * 【思路】clone/create 后 origin 写成 api.github.com/repos/o/r，pushViaApi 必须能解析；
 * 存量仓库仍可能是 ssh://git@ssh.github.com:443/ 或 https://github.com/，解析兼容即可。
 */
/** SSH over HTTPS：本机 github.com:443 不通，ssh.github.com:443 通。 */

export function sshOriginOf(owner, repo) {
  return `ssh://git@ssh.github.com:443/${owner}/${repo}.git`;
}

/** API / 异常文案是否为 token 失效（401 / Bad credentials）。 */

export function isBadCredentials(reason = '') {
  return /Bad credentials|credential|401\b/i.test(String(reason || ''));
}

/**
 * token 无效时走 ssh.github.com:443。用独立 known_hosts，不写 github.com。
 * runGit 已从 User 仓注入 GIT_SSH_COMMAND（id_rsa 优先，其次 id_ed25519）。
 */

export function pushViaSsh({ repoPath, branch, owner, repo, force = false }) {
  const { keyPath } = resolveSshKey();
  if (!keyPath) {
    return { ok: false, pushed: false, reason: '无 SSH 私钥（插件配置目录 git-push/id_rsa，其次 id_ed25519）' };
  }
  const sshUrl = sshOriginOf(owner, repo);
  const target = branch || runGit(['branch', '--show-current'], repoPath).stdout;
  if (!target) return { ok: false, pushed: false, reason: '无法确定目标分支' };
  const known = join('/tmp', `dsh-git-push-known-hosts-${process.pid}`);
  const sshCmd = `ssh -i "${keyPath}" -p 443 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${known}" -o BatchMode=yes`;
  const spec = `HEAD:refs/heads/${target}`;
  const args = force ? ['push', '--force', sshUrl, spec] : ['push', sshUrl, spec];
  const r = runGit(args, repoPath, { GIT_SSH_COMMAND: sshCmd });
  if (r.status === 0) {
    return { ok: true, pushed: true, method: 'ssh', owner, repo, branch: target, force: !!force };
  }
  const err = (r.stderr || r.stdout || 'ssh push 失败').slice(0, 240);
  return { ok: false, pushed: false, method: 'ssh', reason: err };
}

export function parseGithubOwnerRepo(originUrl) {
  const s = String(originUrl || '').trim();
  if (!s) return null;
  const patterns = [
    /api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s*$/i,
    /(?:git@|https?:\/\/)(?:[^@/\s]+@)?(?:ssh\.)?github\.com(?::443)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
    /^ssh:\/\/git@ssh\.github\.com:443\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
    /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
  }
  return null;
}

/** 调 api.github.com：默认不跟随 302（防 tarball 跳到 codeload.github.com）。 */

export async function githubFetch(path, { token = '', method = 'GET', body, timeout = 60_000, headers: extraHeaders } = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${GH_API}${path.startsWith('/') ? path : `/${path}`}`;
  // 硬闸：网络目标必须是 api.github.com。「所有功能都默认api.github.com」
  // AI 思路：即使调用方误传 github.com URL 也直接拒绝，避免静默打到被阻断域名。
  let host = '';
  try { host = new URL(url).hostname; } catch { return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `非法 URL: ${url}` }; }
  if (host !== 'api.github.com') {
    return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `拒绝非 api.github.com 请求: ${host}` };
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-git-push',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(extraHeaders || {}),
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
    // 2026-09-02：不跟随 302。实测 GET /repos/o/r/tarball/ref → Location: codeload.github.com
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    return { status: res.status, json: null, text: '', buffer: Buffer.alloc(0), error: `api.github.com 返回重定向（拒绝跟随非 API 域名）: ${loc}` };
  }
  // 先读 arrayBuffer：JSON 接口 toString utf8；clone 二进制用 buffer / base64，避免 text() UTF-8 损坏
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = buffer.toString('utf8');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON（raw blob） */ }
  return { status: res.status, json, text, buffer };
}

/**
 * 探测 GitHub 仓库可见性（2026-09-02「私有库可豁免敏感扫描」）。
 * 用 token 调 GET /repos/{owner}/{repo} 的 private 字段判断。
 * 无法解析 origin / 无 token / API 失败 → 返回 unknown（保守：不豁免，照常扫描）。
 * @returns {Promise<{visibility:'private'|'public'|'unknown', owner?:string, repo?:string, reason?:string}>}
 */

export async function detectRepoVisibility({ repoPath = '', token = '' } = {}) {
  try {
    const originUrl = repoPath ? runGit(['remote', 'get-url', 'origin'], repoPath).stdout : '';
    const pr = parseGithubOwnerRepo(originUrl);
    if (!pr) return { visibility: 'unknown', reason: '无 github origin' };
    // 2026-09-02：走 githubFetch（api.github.com，不跟随 302）
    // 【原代码】fetch(`https://api.github.com/repos/${pr.owner}/${pr.repo}`, { headers: H, ... })
    // 【改为】「所有功能都默认api.github.com」
    // 【思路】统一走 githubFetch，硬闸 hostname=api.github.com
    const res = await githubFetch(`/repos/${pr.owner}/${pr.repo}`, { token, timeout: 30_000 });
    if (res.status === 200) {
      const json = res.json || {};
      return { visibility: json.private ? 'private' : 'public', owner: pr.owner, repo: pr.repo, private: !!json.private };
    }
    return { visibility: 'unknown', reason: res.error || `GitHub API ${res.status}` };
  } catch (e) {
    return { visibility: 'unknown', reason: String(e?.message || e) };
  }
}

/**
 * 切换 GitHub 仓库可见性（v1.16.0）：PATCH /repos/{owner}/{repo} {"private": bool}。
 * 支持 public ↔ private 双向切换；改 public 有敏感信息暴露风险，调用方需风险提示。
 * 无法解析 origin / 无 token / API 失败 → 返回 error。
 * @returns {Promise<{ok:boolean, owner?:string, repo?:string, visibility?:'private'|'public', from?:string, to?:string, reason?:string, error?:string}>}
 */

export async function setRepoVisibility({ repoPath = '', visibility = '', token = '' } = {}) {
  try {
    const target = (visibility || '').toLowerCase();
    if (!['public', 'private'].includes(target)) return { ok: false, error: 'visibility 必须为 public 或 private' };
    const originUrl = repoPath ? runGit(['remote', 'get-url', 'origin'], repoPath).stdout : '';
    const pr = parseGithubOwnerRepo(originUrl);
    if (!pr) return { ok: false, error: '无 github origin' };
    // 2026-09-02：PATCH 也走 githubFetch。「所有功能都默认api.github.com」
    // 【原代码】fetch(`https://api.github.com/repos/${pr.owner}/${pr.repo}`, { method:'PATCH', headers:H, body:... })
    const res = await githubFetch(`/repos/${pr.owner}/${pr.repo}`, {
      token, method: 'PATCH', body: { private: target === 'private' }, timeout: 30_000,
    });
    if (res.status === 200) {
      const json = res.json || {};
      return {
        ok: true,
        owner: pr.owner,
        repo: pr.repo,
        visibility: json.private ? 'private' : 'public',
        from: json.private ? 'private' : 'public',
        to: target,
        reason: 'OK',
      };
    }
    // 422 通常是 PATCH 失败详情（如 token 权限不足）
    const detail = res.json?.message || res.json?.errors?.[0]?.message || res.error || '';
    return { ok: false, owner: pr.owner, repo: pr.repo, reason: `GitHub API ${res.status}`, error: detail || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** 读取仓库 package.json 的 version（读不到返回 ''） */

export async function autoTagDSHProject({ repoPath = '', version = '', commitSha = '', owner = '', repo = '', token = '' } = {}) {
  try {
    const repoName = repo || basename(repoPath);
    if (!/^dsh-/i.test(repoName)) return { ok: false, skipped: 'not-dsh-prefix', reason: repoName };
    const tag = 'v' + (version || readPkgVersion(repoPath) || '').replace(/^v/i, '');
    if (!tag || tag === 'v') return { ok: false, skipped: 'no-version' };
    if (!commitSha) return { ok: false, skipped: 'no-commit-sha' };
    if (!token) return { ok: false, skipped: 'no-token' };
    const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
    const pr = parseGithubOwnerRepo(originUrl);
    const o = owner || pr?.owner || '';
    const r = repo || pr?.repo || '';
    if (!o || !r) return { ok: false, skipped: 'no-origin' };
    // 2026-09-02：打 tag 走 githubFetch。「所有功能都默认api.github.com」
    // 【原代码】fetch(`https://api.github.com/repos/${o}/${r}/git/ref/tags/${tag}`, ...) + POST /git/refs
    const exists = await githubFetch(`/repos/${o}/${r}/git/ref/tags/${tag}`, { token, timeout: 30_000 });
    if (exists.status === 200) return { ok: false, skipped: 'tag-exists', tag };
    const res = await githubFetch(`/repos/${o}/${r}/git/refs`, {
      token, method: 'POST', body: { ref: `refs/tags/${tag}`, sha: commitSha }, timeout: 30_000,
    });
    if (res.status === 201) return { ok: true, tag };
    if (res.status === 422) {
      if (/already exists/i.test(res.json?.message || '')) return { ok: false, skipped: 'tag-exists', tag };
      return { ok: false, skipped: '422', tag, error: res.json?.message || res.status };
    }
    return { ok: false, skipped: String(res.status), tag, error: res.error || ('GitHub API ' + res.status) };
  } catch (e) {
    return { ok: false, skipped: 'error', error: String(e?.message || e) };
  }
}

/** 读 git 对象原始字节（binary-safe，返回 Buffer）。maxBuffer 放宽到 128MB——spawnSync 默认 1MB，
 * 超过会 status:null 截断（实测 1.1MB 的 session .zstd 日志即触发）。
 * v1.40.0（A3）：加 try/catch 兜底，git 缺失（ENOENT）等异常返回结构化错误不抛。 */

function makeGithubApi(owner, repo, token) {
  // 2026-09-02：push 内部 fetch 改走 githubFetch。「所有功能都默认api.github.com」
  // 【原代码】fetch(GH + '/repos/' + owner + '/' + repo + path, { method, headers:H, body, ... })
  // 【思路】统一 githubFetch，redirect:manual + hostname 硬闸，杜绝 302 到 github.com/codeload
  return async function api(path, method = 'GET', body) {
    return githubFetch(`/repos/${owner}/${repo}${path}`, { token, method, body, timeout: 60_000 });
  };
}

/** 读取本地 HEAD sha 与扁平 tree 条目（path/mode/sha，仅 blob）；失败返回 { fail }。 */

function readLocalHeadEntries(repoPath) {
  // 本地 HEAD
  const headSha = runGit(['rev-parse', 'HEAD'], repoPath).stdout;
  if (!headSha) return { fail: { ok: false, pushed: false, reason: '本地无提交' } };

  // 本地 tree（扁平：path/mode/sha）
  // core.quotepath=false：中文/非 ASCII 文件名输出真实 UTF-8 路径（否则被转义成八进制+引号，远端 tree 会存错误路径）
  const lsOut = runGit(['-c', 'core.quotepath=false', 'ls-tree', '-r', 'HEAD'], repoPath).stdout;
  const entries = lsOut.split('\n').filter(Boolean).map((l) => {
    const m = l.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t(.*)$/);
    return m ? { mode: m[1], type: m[2], sha: m[3], path: m[4] } : null;
  }).filter((e) => e && e.type === 'blob');
  if (!entries.length) return { fail: { ok: false, pushed: false, reason: '本地 tree 为空' } };
  return { headSha, entries };
}

/** 解析目标分支与远端 HEAD（分支免疫 v1.12.2 + 两处内容级短路）；短路返回 { done }。 */

async function apiPushResolveBranch({ api, repoPath, branch, force, headSha, owner, repo }) {
  // 分支免疫（v1.12.2）：GitHub 默认分支可能是 master 或 main，杜绝因分支名不符而误建新分支。
  // 解析目标分支：请求字符串缺省 → 取本地当前分支；
  //   a) 请求的分支在远端已存在 → 用请求值（既有分支优先，正常更新）；
  //   b) 不存在但远端有 default_branch 且不同名 → 自动改用远端默认分支（防止误建错名新分支）；
  //   c) 同名或无 default_branch 信息 → 用请求值。
  let targetBranch = branch || runGit(['branch', '--show-current'], repoPath).stdout || '';
  if (!targetBranch) return { fail: { ok: false, pushed: false, reason: '无法确定目标分支' } };
  let branchAdjusted = null;
  const metaRes = await api(''); // GET /repos/{o}/{r} → default_branch
  const defaultBranch = metaRes.status === 200 ? (metaRes.json?.default_branch || null) : null;
  const hasBranchRef = (await api(`/git/ref/heads/${targetBranch}`)).status === 200;
  if (!hasBranchRef && defaultBranch && defaultBranch !== targetBranch) {
    branchAdjusted = { from: targetBranch, to: defaultBranch };
    targetBranch = defaultBranch;
  }
  // 远端 ref（首次推送 404）
  const refRes = await api(`/git/ref/heads/${targetBranch}`);
  const remoteHead = refRes.status === 200 ? refRes.json?.object?.sha : null;
  if (!force && remoteHead === headSha) return { done: { ok: true, pushed: false, reason: '无新提交可推送', owner, repo, branch: targetBranch, branchAdjusted } };
  // 内容级短路：API 通道每次推送会新建 API 侧 commit 对象（sha 与本地不同），
  // 因此用 tree sha 判断内容是否已一致——tree 相同即无新内容可推，避免重复 commit。
  // force=覆盖历史：即使 tree 相同也要换 commit（去掉旧 parent）。
  if (!force && remoteHead) {
    const localTree = runGit(['rev-parse', 'HEAD^{tree}'], repoPath).stdout;
    const rc = await api(`/git/commits/${remoteHead}`);
    const remoteTree = rc.json?.tree?.sha;
    if (localTree && remoteTree && localTree === remoteTree) {
      return { done: { ok: true, pushed: false, reason: '无新提交可推送', owner, repo, branch: targetBranch, branchAdjusted } };
    }
  }
  return { targetBranch, branchAdjusted, remoteHead };
}

/** 收集远端已有 blob sha、逐 blob 上传并建 tree；失败返回 { fail }，成功返回 { treeSha }。 */

async function apiPushBuildTree({ api, repoPath, entries, remoteHead }) {
  // 远端 tree（递归取已有 blob sha 用于复用，减少 API 调用）
  const remoteBlobShas = new Set();
  if (remoteHead) {
    const t = await api(`/git/trees/${remoteHead}?recursive=1`);
    if (t.status === 200 && t.json?.tree) {
      for (const e of t.json.tree) if (e.type === 'blob') remoteBlobShas.add(e.sha);
    }
  }

  // 逐 blob 上传（复用远端已有 sha）
  const treeEntries = [];
  for (const e of entries) {
    if (remoteBlobShas.has(e.sha)) {
      treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha });
      continue;
    }
    const raw = gitRaw(['cat-file', 'blob', e.sha], repoPath);
    // 【修复 v1.26.0】空文件（0 字节）blob 内容为空：!raw.stdout.length 会误判「读失败」，
    // 导致含空文件（如占位文件 862434889@qq.com）的仓库无法走 Git Data API 推送。
    // 判据只认 cat-file 退出码：0 = 成功（空内容是合法空 blob）；非 0 才是真失败。
    if (raw.status !== 0) return { fail: { ok: false, pushed: false, reason: `读 blob 失败: ${e.path}` } };
    const blobBuf = raw.stdout; // Buffer：空内容也是合法空 blob（GitHub API 接受 encoding=base64 的空串）
    const b = await api('/git/blobs', 'POST', { content: blobBuf.toString('base64'), encoding: 'base64' });
    if (b.status !== 201) return { fail: { ok: false, pushed: false, reason: `上传 blob 失败 ${e.path}: ${b.json?.message || b.status}` } };
    treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: b.json.sha });
  }

  // 建 tree
  const t = await api('/git/trees', 'POST', { tree: treeEntries });
  if (t.status !== 201) return { fail: { ok: false, pushed: false, reason: `建 tree 失败: ${t.json?.message || t.status}` } };
  return { treeSha: t.json.sha };
}

/** 建 commit 并更新远端 ref（有则 PATCH，无则 POST 创建，POST 422 已存在 → 改 PATCH）。 */

async function apiPushCommitAndRef({ api, repoPath, treeSha, force, remoteHead, targetBranch, owner, repo, branchAdjusted }) {
  // 建 commit。force=覆盖历史：不挂远端 parent（orphan）。普通推送 parent=远端 HEAD。
  const msg = runGit(['log', '-1', '--format=%s'], repoPath).stdout || 'chore: push via api';
  const commitBody = { message: msg, tree: treeSha, ...(!force && remoteHead ? { parents: [remoteHead] } : {}) };
  const c = await api('/git/commits', 'POST', commitBody);
  if (c.status !== 201) return { ok: false, pushed: false, reason: `建 commit 失败: ${c.json?.message || c.status}` };

  // 更新 ref（有则 PATCH，无则 POST 创建；POST 遇已存在 → 改 PATCH）
  // force=true：非快进也允许（重建历史覆盖远端）。
  if (remoteHead) {
    const r = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: !!force });
    if (r.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r.json?.message || r.status}` };
  } else {
    const r = await api('/git/refs', 'POST', { ref: `refs/heads/${targetBranch}`, sha: c.json.sha });
    if (r.status === 201) {
      return { ok: true, pushed: true, commitSha: c.json.sha, owner, repo, branch: targetBranch, branchAdjusted, force: !!force };
    }
    if (r.status === 422 && /already exists/i.test(r.json?.message || '')) {
      const r2 = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: !!force });
      if (r2.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r2.json?.message || r2.status}` };
    } else {
      return { ok: false, pushed: false, reason: `创建 ref 失败: ${r.json?.message || r.status}` };
    }
  }
  return { ok: true, pushed: true, commitSha: c.json.sha, owner, repo, branch: targetBranch, branchAdjusted, force: !!force };
}

export async function pushViaApi({ repoPath, branch, token, force = false }) {
  const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
  const pr = parseGithubOwnerRepo(originUrl);
  if (!pr) return { ok: false, pushed: false, reason: `无法从 origin 解析 owner/repo（${originUrl || '无 origin'}）` };
  const { owner, repo } = pr;
  const api = makeGithubApi(owner, repo, token);
  const local = readLocalHeadEntries(repoPath);
  if (local.fail) return local.fail;
  const br = await apiPushResolveBranch({ api, repoPath, branch, force, headSha: local.headSha, owner, repo });
  if (br.fail) return br.fail;
  if (br.done) return br.done;
  const tree = await apiPushBuildTree({ api, repoPath, entries: local.entries, remoteHead: br.remoteHead });
  if (tree.fail) return tree.fail;
  return apiPushCommitAndRef({ api, repoPath, treeSha: tree.treeSha, force, remoteHead: br.remoteHead, targetBranch: br.targetBranch, owner, repo, branchAdjusted: br.branchAdjusted });
}

/**
 * v1.29.0：确保仓库有辅助 SSH remote（名字固定 github-ssh），支持标准 git fetch/pull。
 * origin 被插件设为 api.github.com REST 端点（git fetch 必 403），标准 git 工具链读不到远端；
 * 辅助 remote 用 ssh://git@ssh.github.com:443/<owner>/<repo>.git（本机实测 ssh.github.com:443 通，
 * github.com:22 不通）。插件推送仍走 API，不改动 origin；只补一个可 fetch 的 SSH remote。
 * 幂等：已存在同名 remote 不重复加。
 */

export function ensureAuxSshRemote(repoPath, owner, repo, result = {}) {
  const AUX = 'github-ssh';
  if (!owner || !repo) return;
  const pushSlot = result.push ?? (result.push = {});
  const url = `ssh://git@ssh.github.com:443/${owner}/${repo}.git`;
  const cur = runGit(['remote', 'get-url', AUX], repoPath);
  if (cur.status === 0 && cur.stdout.trim()) {
    if (cur.stdout.trim() !== url) {
      // 同名但指向不同 URL：不覆盖（用户可能自设过），仅记录
      pushSlot.auxRemote = `${AUX} 已存在（${cur.stdout.trim()}）`;
    } else {
      pushSlot.auxRemote = `${AUX} 已就绪`;
    }
    return;
  }
  const add = runGit(['remote', 'add', AUX, url], repoPath);
  pushSlot.auxRemote = add.status === 0
    ? `${AUX} → ${url}`
    : `${AUX} 添加失败: ${(add.stderr || '').trim().slice(0, 120)}`;
}

/**
 * 递归查找 root 下最多 depth 层的 .git 目录（排除 node_modules、.dsh）。
 * v1.40.0：execSync shell 拼接改 spawnSync 数组参数——root/depth 来自配置与 HTTP 参数，
 * 含引号/元字符时旧写法是命令注入面；数组参数零 shell，无注入。
 */

export function extractRemoteHeads(json, count = 3) {
  if (!Array.isArray(json)) return [];
  return json.slice(0, count).map((c) => {
    const msg = String(c?.commit?.message || '');
    const title = msg.split(/\r?\n/)[0].trim();
    const time = c?.commit?.committer?.date || c?.commit?.author?.date || '';
    const shaFull = String(c?.sha || '');
    return { sha: shaFull.slice(0, 7), shaFull, title, time };
  });
}

/** 远端最近 3 次：Markdown 表格（「回复用表格形式」）。 */

export function formatRemoteHeadsTable(heads, { owner = '', repo = '' } = {}) {
  const list = Array.isArray(heads) ? heads : [];
  const title = owner && repo ? `远端最近 ${list.length || 3} 次（${owner}/${repo}）` : `远端最近 ${list.length || 3} 次`;
  const rows = list.length
    ? list.map((h, i) => `| ${i + 1} | \`${h.sha || ''}\` | ${(h.title || '').replace(/\|/g, '\\|')} | ${h.time || ''} |`)
    : ['| — | — | （无） | — |'];
  return [`**${title}**`, '', '| # | SHA | 标题 | 时间 |', '|---|-----|------|------|', ...rows].join('\n');
}

/**
 * 读远端当前分支最新 N 次提交（默认 3）。走 api.github.com，不跟随 302。
 */

export async function fetchRemoteHeads({ owner, repo, branch, token = '', count = 3 } = {}) {
  if (!owner || !repo) return { ok: false, error: '缺 owner/repo', heads: [] };
  const q = `sha=${encodeURIComponent(branch || '')}&per_page=${Number(count) || 3}`;
  const res = await githubFetch(`/repos/${owner}/${repo}/commits?${q}`, { token, timeout: 20_000 });
  if (res.status !== 200 || !Array.isArray(res.json)) {
    return { ok: false, error: res.error || `commits ${res.status}`, heads: [] };
  }
  return { ok: true, owner, repo, branch, heads: extractRemoteHeads(res.json, count) };
}

/**
 * 把设置页填的 GitHub token 写到同级仓 github-token（git 忽略本机文件）。
 * 不把 token 写进返回值。
 */

export function ownerFromRemote(remote = '') {
  // 2026-09-02：复用 parseGithubOwnerRepo，同时认 api.github.com/repos/o/r 与历史 github.com/SSH
  // 【原代码】remote.match(/(?:github\.com[:/]|git@)([\w.-]+)\/([\w.-]+)(?:\.git)?$/)
  // 【改为】「所有功能都默认api.github.com」
  const pr = parseGithubOwnerRepo(remote);
  return pr ? pr.owner : '';
}

/**
 * v1.40.0：插件配置目录——token / SSH 密钥 / 公钥 / requirements 等本机私有数据统一收敛在此。
 * 解析顺序：DSH_HOME/git-push → HOME/.dsh/git-push → <workspaceRoot>/../.dsh/git-push → cwd/.dsh/git-push。
 * 取代原同级仓 dsh-git-push-User（v1.40.0 废除）。目录在 git 仓库内时由 .gitignore 拦截入库。
 */
