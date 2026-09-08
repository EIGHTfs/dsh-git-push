// dsh-git-push v1.42.0 — 远端仓库创建（ensureRemoteRepo）与 clone（自 core.js 按功能拆分，行为零变化）

import { gitCFlags, runGit } from './git-core.js';
import { apiOriginOf, parseGithubOwnerRepo, githubFetch, pushViaApi } from './github-api.js';
import { resolveGitToken } from './token-credentials.js';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** 步骤1：确保 origin 指向 api.github.com（2026-09-02 起 origin 不再写 SSH 443）。 */
function ensureRemoteRepoOrigin({ repoPath, owner, name, dryRun, apiOrigin, steps }) {
  // 1. 现有 origin（2026-09-02：新 origin 写成 api.github.com/repos/o/r，不再写 SSH 443）
  // 「所有功能都默认api.github.com」
  // 【原代码】runGit(['remote','add','origin', `ssh://git@ssh.github.com:443/${owner}/${name}.git`], repoPath)
  // 【思路】origin 只给 parseGithubOwnerRepo / pushViaApi 解析用，不发起 git 协议；写成 API URL 才和默认通道一致
  const origin = runGit(['remote', 'get-url', 'origin'], repoPath).stdout || '';
  if (origin) {
    steps.push(`已有 origin: ${origin}`);
  } else if (!dryRun) {
    runGit(['remote', 'add', 'origin', apiOrigin], repoPath);
    steps.push(`已设置 origin → ${apiOrigin}`);
  } else {
    steps.push(`将设置 origin → ${apiOrigin}`);
  }
  return origin;
}

/** 步骤2：查询 GitHub 上同名仓库是否已存在（githubFetch，不跟随 302）；失败返回 { ret }。 */
async function ensureRemoteRepoCheckExists({ owner, name, token }) {
  // 2. 检查 GitHub 是否已存在（githubFetch，不跟随 302）
  try {
    const res = await githubFetch(`/repos/${owner}/${encodeURIComponent(name)}`, { token, timeout: 10_000 });
    if (res.status === 200) return { exists: true };
    if (res.status === 404) return { exists: false };
    return { ret: { ok: false, error: { code: 'GH_QUERY', message: res.error || `查询远程仓库失败 HTTP ${res.status}` } } };
  } catch (e) {
    return { ret: { ok: false, error: { code: 'GH_NET', message: `GitHub API 请求失败: ${String(e?.message || e).slice(0, 100)}` } } };
  }
}

/** 步骤3：不存在时创建远程仓库；失败返回 { ret }。 */
async function ensureRemoteRepoCreate({ owner, name, visibility, description, token, dryRun, steps }) {
  // 3. 创建（不存在时）
  let created = false;
  if (dryRun) {
    steps.push(`将创建远程仓库 ${owner}/${name}（${visibility}）`);
  } else {
    try {
      const res = await githubFetch('/user/repos', {
        token, method: 'POST', timeout: 20_000,
        body: {
          name,
          description: description || `由 dsh-git-push 自动创建（项目 ${name}）`,
          private: visibility !== 'public',
          auto_init: false,
        },
      });
      if (res.status < 200 || res.status >= 300) {
        return { ret: { ok: false, error: { code: 'GH_CREATE', message: `创建远程仓库失败 HTTP ${res.status}: ${(res.text || res.error || '').slice(0, 160)}` } } };
      }
      created = true;
      steps.push(`已创建远程仓库 ${owner}/${name}（${visibility}）`);
    } catch (e) {
      return { ret: { ok: false, error: { code: 'GH_NET', message: `创建请求失败: ${String(e?.message || e).slice(0, 100)}` } } };
    }
  }
  return { created };
}

export async function ensureRemoteRepo({
  repoPath = '',
  owner = 'EIGHTfs',
  visibility = 'private',
  tokenPath = '',
  workspaceRoot = '',
  dryRun = false,
  description = '',
} = {}) {
  if (!repoPath || !existsSync(repoPath) || !existsSync(join(repoPath, '.git'))) {
    return { ok: false, error: { code: 'NOT_GIT', message: '指定路径不是 git 仓库（无 .git）' } };
  }
  const name = basename(repoPath);
  const steps = [];
  const { token, source } = resolveGitToken({ tokenPath, repoPath, workspaceRoot });
  if (!token) {
    return { ok: false, error: { code: 'NO_TOKEN', message: '未找到可读 GitHub token（尝试 tokenPath / 项目 .git-push-token / workspaceRoot data/sensitive）' } };
  }

  const apiOrigin = apiOriginOf(owner, name);
  const origin = ensureRemoteRepoOrigin({ repoPath, owner, name, dryRun, apiOrigin, steps });

  const chk = await ensureRemoteRepoCheckExists({ owner, name, token });
  if (chk.ret) return chk.ret;
  const { exists } = chk;
  const existingUrl = exists ? apiOrigin : '';

  let created = false;
  if (exists) {
    steps.push(`远程已存在: ${existingUrl || `${owner}/${name}`}`);
  } else {
    const made = await ensureRemoteRepoCreate({ owner, name, visibility, description, token, dryRun, steps });
    if (made.ret) return made.ret;
    created = made.created;
  }

  return {
    ok: true,
    name,
    owner,
    exists,
    created,
    origin: apiOrigin,
    remoteWasSet: !origin && !dryRun,
    steps,
    tokenSource: source,
    ...(dryRun ? { dryRun: true } : {}),
  };
}


/* ------------------------------ 插件根目录与本地凭据（v1.40.0：同级仓 dsh-git-push-User 全模块废除） ------------------------------ */

/** 插件根目录（运行时定位到实际装载副本；源码仓与 node_modules 装载副本都适用） */

/** clone 步骤1：解析 target 为 owner/repo（支持 owner/repo、.git 后缀、完整 URL）；失败返回 { ret }。 */
function cloneResolveTarget({ target }) {
  const t = (target || '').trim();
  let pr = parseGithubOwnerRepo(t);
  if (!pr) {
    const m = t.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (m) pr = { owner: m[1], repo: m[2] };
  }
  if (!pr) return { ret: { ok: false, error: `无法解析 target 为 owner/repo: ${t || '(空)'}` } };
  return { owner: pr.owner, repo: pr.repo };
}

/** clone 步骤2：默认分支探测 + 递归 tree（留在 api.github.com，不走 tarball/codeload）；失败返回 { ret }。 */
async function cloneFetchTree({ owner, repo, branch, token }) {
  // 1. 默认分支探测（分支免疫：GitHub 默认分支可能是 master 或 main）
  let defaultBranch = '';
  const metaRes = await githubFetch(`/repos/${owner}/${repo}`, { token, timeout: 30_000 });
  if (metaRes.status === 200) defaultBranch = metaRes.json?.default_branch || '';
  const branchName = branch || defaultBranch || 'master';

  // 2. 递归 tree（留在 api.github.com，不走 tarball/codeload）
  const treeRes = await githubFetch(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branchName)}?recursive=1`, { token, timeout: 60_000 });
  if (treeRes.status !== 200 || !Array.isArray(treeRes.json?.tree)) {
    return { ret: { ok: false, error: `读 git/trees 失败 HTTP ${treeRes.status}: ${(treeRes.error || treeRes.text || '').slice(0, 160)}` } };
  }
  const blobs = treeRes.json.tree.filter((e) => e && e.type === 'blob');
  return { defaultBranch, branchName, blobs };
}

/** clone 步骤3：逐 blob 下载（JSON+base64，二进制安全，symlink/可执行位保真）；失败返回 { ret }。 */
async function cloneDownloadBlobs({ gitDir, owner, repo, blobs, token }) {
  // 4. 逐 blob 下载：GET /git/blobs/{sha} 返回 JSON+base64（留在 api.github.com，二进制安全）
  // 【原代码】Accept: raw 再 latin1 回写——text() 会按 UTF-8 损坏二进制；改 base64 与 pushViaApi 对称
  for (const e of blobs) {
    const filePath = join(gitDir, e.path);
    mkdirSync(dirname(filePath), { recursive: true });
    const blob = await githubFetch(`/repos/${owner}/${repo}/git/blobs/${e.sha}`, { token, timeout: 60_000 });
    if (blob.status !== 200) return { ret: { ok: false, error: `读 blob 失败 ${e.path}: HTTP ${blob.status}` } };
    const encoding = blob.json?.encoding;
    let buf;
    if (encoding === 'base64' && typeof blob.json?.content === 'string') {
      buf = Buffer.from(blob.json.content.replace(/\n/g, ''), 'base64');
    } else if (blob.buffer?.length) {
      buf = blob.buffer;
    } else {
      return { ret: { ok: false, error: `blob 无内容 ${e.path}` } };
    }
    if (e.mode === '120000') {
      try { symlinkSync(buf.toString('utf8'), filePath); } catch (err) { return { ret: { ok: false, error: `写 symlink 失败 ${e.path}: ${err.message}` } }; }
      continue;
    }
    writeFileSync(filePath, buf);
    if (e.mode === '100755') {
      try { chmodSync(filePath, 0o755); } catch { /* 忽略 */ }
    }
  }
  return {};
}

/** clone 步骤4：本地 commit（identity 用 owner，与远端一致）+ origin 写成 API URL；失败返回 { ret }。 */
function cloneCommitAndOrigin({ gitDir, owner, repo, branchName }) {
  // 5. 本地 commit（identity 用 owner，与远端一致）
  const add = runGit(['add', '-A'], gitDir);
  if (add.status !== 0) return { ret: { ok: false, error: `git add 失败: ${add.stderr}` } };
  const cm = runGit(
    ['-c', `user.name=${owner}`, '-c', `user.email=${owner}@users.noreply.github.com`, 'commit', '-m', `clone of ${owner}/${repo} @ ${branchName} (api.github.com Git Data API)`, '--allow-empty'],
    gitDir
  );
  if (cm.status !== 0) return { ret: { ok: false, error: `git commit 失败: ${cm.stderr}` } };
  const commitSha = runGit(['rev-parse', 'HEAD'], gitDir).stdout;

  // 6. origin 写成 api.github.com/repos/o/r（pushViaApi / parseGithubOwnerRepo 可解析）
  // 【原代码】runGit(['remote','add','origin', `https://github.com/${owner}/${repo}.git`], gitDir)
  runGit(['remote', 'add', 'origin', apiOriginOf(owner, repo)], gitDir);
  return { commitSha };
}

/** clone 步骤5：整拷回 dest（非空目录拒绝覆盖）；失败返回 { ret }。 */
function cloneCopyToDest({ gitDir, repo, dest, workspaceRoot }) {
  // 7. 整拷回 dest（预先校验非空目录，防误覆盖）
  // 2026-09-07 修改：硬编码审计新增后，clone 默认 dest 不再写死本机工作区。
  // 【原代码】dest 缺省时 join(workspaceRoot 或 NAS 工作区绝对路径, repo)
  // 【改为】workspaceRoot → cwd → HOME/工作区 → /tmp（最后兜底，避免空路径覆盖未知目录）。
  // 【触发】gitpush 增加审计硬编码功能，测试就用插件本身
  // 【思路】调用方通常传 dest 或 workspaceRoot；缺两者时用进程 cwd，再退 HOME，绝不锚定某台 NAS。
  const destRoot = workspaceRoot
    || process.cwd()
    || (process.env.HOME && join(process.env.HOME, '工作区'))
    || '/tmp';
  const destPath = dest || join(destRoot, repo);
  if (existsSync(destPath) && readdirSync(destPath).length > 0) {
    return { ret: { ok: false, error: `目标目录已存在且非空: ${destPath}` } };
  }
  mkdirSync(destPath, { recursive: true });
  const cp2 = spawnSync('cp', ['-a', gitDir + '/.', destPath + '/'], { encoding: 'utf8', timeout: 120_000 });
  if (cp2.status !== 0) return { ret: { ok: false, error: `拷贝到目标失败: ${cp2.stderr || cp2.status}` } };
  return { destPath };
}

export async function cloneViaApi({ target, dest = '', branch = '', token = '', workspaceRoot = '' } = {}) {
  if (!token) return { ok: false, error: '缺少 GitHub token（可用 resolveGitToken 多源探测）' };
  const resolved = cloneResolveTarget({ target });
  if (resolved.ret) return resolved.ret;
  const { owner, repo } = resolved;

  const fetched = await cloneFetchTree({ owner, repo, branch, token });
  if (fetched.ret) return fetched.ret;
  const { defaultBranch, branchName, blobs } = fetched;

  // 3. /tmp 中转建仓（CIFS git init chmod EPERM，必须 /tmp 可写卷）
  const tmpRoot = mkdtempSync(join('/tmp', 'dsh-clone-'));
  try {
    const gitDir = join(tmpRoot, 'repo');
    const ini = spawnSync('git', [...gitCFlags(gitDir), 'init', gitDir], { encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'ignore'] });
    if (ini.status !== 0) return { ok: false, error: `git init 失败: ${ini.stderr || ini.status}` };
    const sr = spawnSync('git', [...gitCFlags(gitDir), 'symbolic-ref', 'HEAD', `refs/heads/${branchName}`], { cwd: gitDir, encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'ignore'] });
    if (sr.status !== 0) return { ok: false, error: `设置分支 ${branchName} 失败: ${sr.stderr || sr.status}` };

    const dl = await cloneDownloadBlobs({ gitDir, owner, repo, blobs, token });
    if (dl.ret) return dl.ret;

    const committed = cloneCommitAndOrigin({ gitDir, owner, repo, branchName });
    if (committed.ret) return committed.ret;
    const { commitSha } = committed;

    const copied = cloneCopyToDest({ gitDir, repo, dest, workspaceRoot });
    if (copied.ret) return copied.ret;
    const { destPath } = copied;

    return {
      ok: true, owner, repo, branch: branchName, commitSha, dest: destPath,
      method: 'api', defaultBranch: defaultBranch || branchName, files: blobs.length, origin: apiOriginOf(owner, repo),
    };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
