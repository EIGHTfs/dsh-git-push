/**
 * Git 执行层 · 账号校验
 *
 * 职责：校验 GitHub token 在线可用性与 SSH 公钥指纹，输出可读的账号状态块。
 */

import { join } from 'node:path';
import { githubFetch } from './api.js';
import { maskToken, readSshPub, resolveToken } from './credentials.js';

/**
 * 校验 GitHub 账号与凭据（checkGithubAccount：token 在线校验 / SSH 公钥指纹 / 绑定关系）。
 * 网络出口仅 api.github.com（githubFetch 硬闸）。
 * @param {object} [opts] { workspaceRoot, token }
 * @returns {Promise<object>} { ok, loggedIn, cookieSet, warnLevel, cred, detail, username?, ... }
 */
export async function checkGithubAccount({ workspaceRoot = '', token = '' } = {}) {
  const tok = token || resolveToken({ workspaceRoot }).token;
  const ssh = readSshPub({ workspaceRoot });
  const cred = {
    hasToken: !!tok,
    tokenMasked: tok ? maskToken(tok) : '',
    hasSshPub: ssh.configured,
    sshFingerprint: ssh.fingerprint,
  };
  if (!tok && !ssh.configured) {
    return { ok: true, loggedIn: false, cookieSet: false, warnLevel: 'err', cred, detail: '未配置 Token / SSH 公钥' };
  }
  if (!tok) {
    return {
      ok: true, loggedIn: false, cookieSet: true, warnLevel: 'warn', cred,
      detail: '已有 SSH 公钥，但无 Token，无法向 api.github.com 取用户信息（SSH 推送仍可能可用）',
    };
  }
  const res = await githubFetch('/user', { token: tok, timeout: 15_000 });
  if (res.status !== 200 || !res.json || !res.json.login) {
    const msg = res.json?.message || res.error || `HTTP ${res.status}`;
    return {
      ok: true, loggedIn: false, cookieSet: true, warnLevel: 'err', cred,
      detail: /Bad credentials|401/.test(String(msg)) ? 'Token 无效（Bad credentials）' : `检测失败: ${msg}`,
    };
  }
  const u = res.json;
  return {
    ok: true,
    loggedIn: true,
    cookieSet: true,
    warnLevel: 'ok',
    cred,
    username: u.login,
    userId: u.id,
    name: u.name || '',
    profileUrl: u.html_url || `https://github.com/${u.login}`,
    publicRepos: u.public_repos,
    plan: u.plan?.name || '',
  };
}

/** 账号检查结果格式化为可读块（formatGithubAccountBlock）。 */
export function formatGithubAccountBlock(r = {}) {
  const L = [];
  const cred = r.cred || {};
  if (!r.cookieSet) {
    L.push('❌ 未配置 Token / SSH 公钥（推送将走匿名失败）');
  } else if (r.loggedIn) {
    L.push(`✅ 已登录 GitHub：${r.username}${r.name ? `（${r.name}）` : ''}`);
    L.push(`- 公钥仓库数：${r.publicRepos ?? '?'}｜套餐：${r.plan || '?'}`);
    if (cred.hasToken) L.push(`- Token：${cred.tokenMasked || '已配置'}`);
    if (cred.hasSshPub) L.push(`- SSH 公钥：${cred.sshFingerprint || '已配置'}`);
  } else {
    L.push(`⚠️ 未登录：${r.detail || '凭据缺失'}`);
    if (cred.hasToken) L.push(`- Token：${cred.tokenMasked || '已配置'}`);
    if (cred.hasSshPub) L.push(`- SSH 公钥：${cred.sshFingerprint || '已配置'}`);
  }
  return L.join('\n');
}
