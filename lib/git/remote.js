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

/* ───────── 远端仓库常量 ───────── */
const USER_CHECK_TIMEOUT_MS = 15_000; // 建仓前 /user 校验超时

/** 建仓（POST /user/repos）并设置 origin。dryRun 只探测不创建。 */
export async function ensureRemoteRepo({ repoPath = '', owner = '', visibility = 'private', dryRun = false, token = '' } = {}) {
  const name = basename(repoPath || '');
  if (!name) return { ok: false, error: '缺仓库路径' };
  // 仓库名必须是 ASCII——前置拦截并**明确报错**，不做静默变形。
  //   事故（用户实测）：项目文件夹名含中文（「逆向-malang」）时，名字在 URL 构造/参数传递中
  //   被拆掉，残余片段被当成选项式 token（`--malang`），建出来的远端名与预期完全不符，
  //   而且因为「创建成功」返回 ok，用户直到查远端才发现。GitHub 仓库名本身也只允许
  //   ASCII（字母/数字/`.`/`_`/`-`），所以这里直接拒绝并给出改名示例，让用户改名后重试。
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return {
      ok: false,
      code: 'NON_ASCII_REPO_NAME',
      error: `仓库名「${name}」含非 ASCII 字符——GitHub 仓库名只支持 ASCII（字母/数字/./_/-）。`
        + '请把项目文件夹改成 ASCII 名后重试（例：逆向-malang → malang-reverse）。'
        + '插件不自动改名，避免建出与预期不符的远端仓库。',
    };
  }
  const vis = (visibility || 'private').toLowerCase() === 'public' ? 'public' : 'private';
  const tok = token || resolveToken({ repoPath }).token;
  if (!tok && !dryRun) return { ok: false, error: '无 token（插件 config.json 的 githubToken 键，或环境变量 DSH_GIT_PUSH_TOKEN）' };
  // owner 缺省取 token 对应用户（GET /user）——保证 owner≠库名时同名检测与 origin 均正确
  let ownerName = owner || '';
  if (!ownerName) {
    const me = await githubFetch('/user', { token: tok, timeout: USER_CHECK_TIMEOUT_MS });
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
  const url = String(remoteUrl || '').trim();
  let match = url.match(/api\.github\.com\/repos\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (match) return { owner: match[1], repo: match[2] };
  match = url.match(/([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/);
  if (match && match[1] !== 'repos') return { owner: match[1], repo: match[2] };
  return { owner: '', repo: '' };
}

/** 可见性切换（PATCH /repos/{owner}/{repo} {"private": bool}）。repoPath 提供时从本地仓库 origin 解析 owner/repo。 */
export async function setVisibility({ owner = '', repo = '', visibility = '', token = '', repoPath = '' } = {}) {
  const target = (visibility || '').toLowerCase();
  if (!['public', 'private'].includes(target)) return { ok: false, error: 'visibility 必须为 public 或 private' };
  // bugfix：git_set_visibility 工具传 repoPath（本地仓库路径）——从 origin remote 解析 owner/repo
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
