/**
 * Git 执行层 · 云端仓库列表（账号卡片「云端」面板）
 *
 * 用 GitHub token 列账号名下仓库（GET /user/repos），供手动 clone。
 * 网络出口仅 api.github.com（githubFetch 硬闸）。
 */

import { githubFetch } from './api.js';
import { resolveToken } from './credentials.js';

/**
 * 列账号名下 GitHub 仓库（按最近更新排序，含协作仓库）。
 * @param {object} [opts] { token, perPage=100 }
 * @returns {Promise<{ok:boolean, loggedIn?:boolean, count?:number, repos?:Array, error?}>}
 *   repos[i] = { fullName, name, private, defaultBranch, pushedAt, description, cloneUrl }
 */
export async function listCloudRepos({ token = '', perPage = 100 } = {}) {
  const tok = token || resolveToken({}).token;
  if (!tok) return { ok: false, loggedIn: false, error: '未配置 GitHub Token（请到「设置」选项卡填写后重试）' };
  const resp = await githubFetch(
    `/user/repos?per_page=${Number(perPage) || 100}&sort=updated&affiliation=owner,collaborator`,
    { token: tok, timeout: 20_000 },
  );
  if (resp.status !== 200 || !Array.isArray(resp.json)) {
    const msg = resp.json?.message || resp.error || `HTTP ${resp.status}`;
    return {
      ok: false,
      loggedIn: true,
      error: /Bad credentials|401/.test(String(msg)) ? 'Token 无效（Bad credentials）' : `拉取仓库列表失败: ${msg}`,
    };
  }
  const repos = resp.json.map((r) => ({
    fullName: r.full_name || '',
    name: r.name || '',
    private: !!r.private,
    defaultBranch: r.default_branch || '',
    pushedAt: r.pushed_at || '',
    description: String(r.description || '').slice(0, 120),
    cloneUrl: r.clone_url || '',
  }));
  return { ok: true, loggedIn: true, count: repos.length, repos };
}
