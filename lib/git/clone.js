/**
 * Git 执行层 · 克隆
 *
 * 职责：经 GitHub Git Data API 克隆（不依赖本地 git 凭据，SSH 不可用时的通道）。
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
// 循环内改用异步 I/O：逐文件 mkdir/write/chmod 若用同步版，大仓库（数千文件）
//   会反复阻塞事件循环——本函数已是 async（含 await api 调用），改异步无额外成本。
import { mkdir, writeFile, chmod, symlink } from 'node:fs/promises';
import { supportsMetadata } from '../fsx.js';
import { dirname, join, resolve } from 'node:path';
import { GH_API, githubFetch, parseGithubOwnerRepo } from './api.js';
import { resolveToken } from './credentials.js';
import { runGit } from './exec.js';

/* ───────────────────────── clone / 建仓 / 可见性 ───────────────────────── */

/**
 * 目标目录是否落在「既有 git 工作树」内部。
 *
 * 为什么必须拦：克隆末尾要 `git init` + `git add -A` + `git commit` 建初始提交。
 *   若目标目录位于某个既有仓库的工作树内（哪怕目标目录本身还不存在），
 *   `git init` 在 CIFS 上会因 chmod 失败而**静默留下未初始化的目录**，
 *   随后的 `git add/commit` 便会向上命中父仓库的 .git —— 把父仓库的
 *   全部内容作为一次提交写进父仓库历史（实测发生过，已重置）。
 *   故此处显式拒绝，而不是依赖 git init 是否成功。
 *
 * 判定用 `git rev-parse --show-toplevel`：在任意子目录（含尚不存在的路径）
 *   执行时，只要父链上有 .git 就会返回该仓库根。
 * @param {string} dir 待创建的目标目录（可以尚不存在）
 * @returns {string} 命中的既有仓库根；无则返回空串
 */
export function enclosingGitRoot(dir) {
  const target = resolve(dir);
  // 目标目录自身已是独立仓库（有自己的 .git）→ 交给「非空目录拒绝覆盖」处理，
  //   不属于「落在父仓库内」。注意必须在 resolve 后比较**目标自身**，
  //   而不是上溯后的祖先目录（早期实现把祖先误当目标，导致防护被自身短路）。
  if (existsSync(join(target, '.git'))) return '';
  // 从最近的已存在祖先开始探测（目标目录可能还不存在）
  let probe = target;
  while (probe && !existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return '';
    probe = parent;
  }
  const rc = runGit(['rev-parse', '--show-toplevel'], { cwd: probe });
  if (!rc.ok) return '';
  const root = String(rc.stdout || '').trim();
  // 上溯到的祖先位于某个仓库工作树内 → 该仓库就是会被误写的父仓库
  return root ? root : '';
}



/**
 * clone（只走 api.github.com Git Data API：git/trees + git/blobs，不直连 github.com）。
 * /tmp 中转建仓后整拷目标（兼容 CIFS 卷）。origin 写成 api.github.com/repos/o/r。
 * @returns {{ok, owner?, repo?, branch?, commitSha?, dest?, files?, error?}}
 */
export async function cloneViaApi({ target = '', dest = '', token = '', branch = '' } = {}) {
  const pr = parseGithubOwnerRepo(target);
  if (!pr) return { ok: false, error: `无法解析 target（${target}）：需要 owner/repo 或 github URL` };
  const { owner, repo } = pr;
  const tok = token || resolveToken({ tokenPath: process.env.DSH_GIT_PUSH_TOKEN ? undefined : '', repoPath: '' }).token;
  const api = (path, method = 'GET', body) => githubFetch(`/repos/${owner}/${repo}${path}`, { token: tok, method, body });
  const meta = await api('');
  if (meta.status !== 200) return { ok: false, error: meta.error || `仓库查询失败: HTTP ${meta.status}` };
  const useBranch = branch || meta.json?.default_branch || 'master';
  const treeRes = await api(`/git/trees/${useBranch}?recursive=1`);
  if (treeRes.status !== 200) return { ok: false, error: treeRes.error || `tree 拉取失败: HTTP ${treeRes.status}` };
  const commitSha = treeRes.json?.sha || '';
  const targetDir = dest || join(process.cwd(), repo);
  // 拒绝克隆到既有仓库的工作树内：末尾的 git init/add/commit 会命中父仓库，
  //   把父仓库内容作为一次提交写进其历史（实测事故根因，见 enclosingGitRoot 注释）。
  const hostRoot = enclosingGitRoot(targetDir);
  if (hostRoot) {
    return {
      ok: false,
      error: `目标目录位于既有 git 仓库内（${hostRoot}）——拒绝克隆：`
        + `后续 git init/add/commit 会写入该仓库历史。请改用仓库外的目录。`,
      hostRepo: hostRoot,
    };
  }
  // 非空目录拒绝覆盖（防误覆盖已有内容）
  try {
    if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
      return { ok: false, error: `目标目录已存在且非空: ${targetDir}` };
    }
    mkdirSync(targetDir, { recursive: true });
  } catch (e) { return { ok: false, error: `创建目录失败: ${e?.message || e}` }; }
  // CIFS 挂载（nounix）上 chmod 必然 EPERM：可执行位保真做不到。
  //   探测一次写进结果，让调用方知道「克隆成功但可执行位未保真」，而非静默退化。
  const metaOk = supportsMetadata(targetDir);
  let modePreserved = true;
  let files = 0;
  for (const treeEntry of treeRes.json?.tree || []) {
    if (treeEntry.type !== 'blob') continue;
    const rel = String(treeEntry.path || '');
    if (!rel) continue;
    const out = join(targetDir, rel);
    // symlink 保真（mode 120000）：blob 内容即链接目标
    if (treeEntry.mode === '120000') {
      const linkRes = await api(`/git/blobs/${treeEntry.sha}`, 'GET');
      if (linkRes.status !== 200) continue;
      try {
        await mkdir(dirname(out), { recursive: true });
        await symlink(String(linkRes.json?.content ?? linkRes.text ?? ''), out);
        files++;
      } catch { /* symlink 写失败跳过 */ }
      continue;
    }
    try { await mkdir(dirname(out), { recursive: true }); } catch { /* 忽略 */ }
    const blob = await api(`/git/blobs/${treeEntry.sha}`, 'GET');
    if (blob.status !== 200) continue;
    try {
      // 二进制：base64 解码；文本：原文（api.github.com blob Accept 默认返回 content+encoding）
      const isBase64 = blob.json?.encoding === 'base64';
      await writeFile(out, isBase64 ? Buffer.from(blob.json.content, 'base64') : String(blob.text ?? ''));
      // 可执行位保真（mode 100755）
      if (treeEntry.mode === '100755') { try { await chmod(out, 0o755); } catch { modePreserved = false; } }
      files++;
    } catch { /* 写失败跳过该文件 */ }
  }
  // 转成 git 仓库并设 origin
  for (const args of [
    ['init', '-q'], ['add', '-A'], ['-c', 'user.email=v2-clone@local', '-c', 'user.name=v2-clone', 'commit', '-q', '-m', `clone from ${owner}/${repo}@${useBranch}`],
  ]) {
    runGit(args, { cwd: targetDir });
  }
  runGit(['remote', 'add', 'origin', `${GH_API}/repos/${owner}/${repo}`], { cwd: targetDir });
  return {
    ok: true, owner, repo, branch: useBranch, commitSha, dest: targetDir, files, method: 'api',
    // 目标文件系统不支持元数据（CIFS）时，可执行位保真会降级；
    //   显式回传实际状态，避免调用方以为权限已按 mode 100755 设好。
    modePreserved: metaOk && modePreserved,
    metadataSupported: metaOk,
  };
}
