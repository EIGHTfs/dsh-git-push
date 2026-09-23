/**
 * Git 执行层 · 远端仓库管理
 *
 * 职责：远端仓库创建（不存在则建，默认 private）与可见性切换。
 */

import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { GH_API, githubFetch } from './api.js';
import { resolveToken } from './credentials.js';
import { runGit } from './exec.js';

/** 建仓（POST /user/repos）并设置 origin。dryRun 只探测不创建。 */
export async function ensureRemoteRepo({ repoPath = '', owner = '', visibility = 'private', dryRun = false, token = '' } = {}) {
  const name = basename(repoPath || '');
  if (!name) return { ok: false, error: '缺仓库路径' };
  const vis = (visibility || 'private').toLowerCase() === 'public' ? 'public' : 'private';
  const tok = token || resolveToken({ repoPath }).token;
  if (!tok && !dryRun) return { ok: false, error: '无 token（插件 config.json 的 githubToken 键，或环境变量 DSH_GIT_PUSH_TOKEN）' };
  // owner 缺省取 token 对应用户（GET /user）——保证 owner≠库名时同名检测与 origin 均正确
  let ownerName = owner || '';
  if (!ownerName) {
    const me = await githubFetch('/user', { token: tok, timeout: 15_000 });
    if (me.status === 200 && me.json?.login) ownerName = me.json.login;
    else if (dryRun) ownerName = name; // dry-run 无 token：占位 owner 继续模拟，不阻断
    else return { ok: false, error: '无法确定 owner（传 owner 参数或提供有效 token）' };
  }
  const exists = await githubFetch(`/repos/${ownerName}/${name}`, { token: tok });
  if (exists.status === 200) {
    return { ok: true, exists: true, owner: ownerName, name, visibility: vis, reason: '已存在同名仓库' };
  }
  if (dryRun) return { ok: true, dryRun: true, wouldCreate: true, owner: ownerName, name, visibility: vis };
  const created = await githubFetch('/user/repos', { token: tok, method: 'POST', body: { name, private: vis === 'private' } });
  if (created.status !== 201) return { ok: false, error: created.json?.message || created.error || `创建失败: HTTP ${created.status}` };
  if (repoPath && existsSync(join(repoPath, '.git'))) {
    const origin = `${GH_API}/repos/${ownerName}/${name}`;
    const cur = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath });
    if (!cur.ok) runGit(['remote', 'add', 'origin', origin], { cwd: repoPath });
  }
  return { ok: true, created: true, owner: ownerName, name, visibility: vis, origin: `${GH_API}/repos/${ownerName}/${name}` };
}

/** 从本地仓库 origin remote 解析 owner/repo（支持 api.github.com/repos/、github.com、ssh:// 三格式）。 */
export function parseOwnerRepoFromRemote(remoteUrl) {
  const u = String(remoteUrl || '').trim();
  let m = u.match(/api\.github\.com\/repos\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  m = u.match(/([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/);
  if (m && m[1] !== 'repos') return { owner: m[1], repo: m[2] };
  return { owner: '', repo: '' };
}

/** 可见性切换（PATCH /repos/{owner}/{repo} {"private": bool}）。repoPath 提供时从本地仓库 origin 解析 owner/repo。 */
export async function setVisibility({ owner = '', repo = '', visibility = '', token = '', repoPath = '' } = {}) {
  const target = (visibility || '').toLowerCase();
  if (!['public', 'private'].includes(target)) return { ok: false, error: 'visibility 必须为 public 或 private' };
  // 2026-09-23 bugfix：git_set_visibility 工具传 repoPath（本地仓库路径）——从 origin remote 解析 owner/repo
  if ((!owner || !repo) && repoPath) {
    const cur = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath });
    const parsed = parseOwnerRepoFromRemote(cur.stdout || cur.stderr || '');
    owner = owner || parsed.owner;
    repo = repo || parsed.repo;
  }
  if (!owner || !repo) return { ok: false, error: '缺 owner/repo' };
  const tok = token || resolveToken({}).token;
  if (!tok) return { ok: false, error: '无 token' };
  const visRes = await githubFetch(`/repos/${owner}/${repo}`, { token: tok, method: 'PATCH', body: { private: target === 'private' } });
  if (visRes.status !== 200) return { ok: false, error: visRes.json?.message || visRes.error || `HTTP ${visRes.status}` };
  return { ok: true, owner, repo, visibility: visRes.json?.private ? 'private' : 'public', to: target };
}
