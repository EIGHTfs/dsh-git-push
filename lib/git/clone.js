/**
 * Git 执行层 · 克隆
 *
 * 职责：经 GitHub Git Data API 克隆（不依赖本地 git 凭据，SSH 不可用时的通道）。
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GH_API, githubFetch, parseGithubOwnerRepo } from './api.js';
import { resolveToken } from './credentials.js';
import { runGit } from './exec.js';

/* ───────────────────────── clone / 建仓 / 可见性 ───────────────────────── */

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
  // 非空目录拒绝覆盖（防误覆盖已有内容）
  try {
    if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
      return { ok: false, error: `目标目录已存在且非空: ${targetDir}` };
    }
    mkdirSync(targetDir, { recursive: true });
  } catch (e) { return { ok: false, error: `创建目录失败: ${e?.message || e}` }; }
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
        mkdirSync(dirname(out), { recursive: true });
        symlinkSync(String(linkRes.json?.content ?? linkRes.text ?? ''), out);
        files++;
      } catch { /* symlink 写失败跳过 */ }
      continue;
    }
    try { mkdirSync(dirname(out), { recursive: true }); } catch { /* 忽略 */ }
    const blob = await api(`/git/blobs/${treeEntry.sha}`, 'GET');
    if (blob.status !== 200) continue;
    try {
      // 二进制：base64 解码；文本：原文（api.github.com blob Accept 默认返回 content+encoding）
      const isBase64 = blob.json?.encoding === 'base64';
      writeFileSync(out, isBase64 ? Buffer.from(blob.json.content, 'base64') : String(blob.text ?? ''));
      // 可执行位保真（mode 100755）
      if (treeEntry.mode === '100755') { try { chmodSync(out, 0o755); } catch { /* 忽略 */ } }
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
  return { ok: true, owner, repo, branch: useBranch, commitSha, dest: targetDir, files, method: 'api' };
}
