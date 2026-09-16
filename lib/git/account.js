/**
 * Git 执行层 · 账号校验
 *
 * 职责：校验 GitHub token 在线可用性与 SSH 登录信息（在线 ssh -T），输出可读的账号状态块。
 * 2026-09-16：token 与 SSH **分别**做有效性判断——token 在线校验 /user；SSH 用 id_rsa
 *   直连 ssh.github.com:443 执行 ssh -T，解析返回的 "Hi <login>!" 拿登录名（SSH 也能取登录信息）。
 *   凭据文件 account-status.json 由调用方（HTTP / 工具）负责写入/读取，本模块只做实时探测。
 */

import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { githubFetch } from './api.js';
import { maskToken, readSshPub, resolveToken, resolveSshKeys } from './credentials.js';

/**
 * SSH 在线校验：用插件管理的首个私钥直连 ssh.github.com:443 执行 ssh -T。
 * 返回 { valid, login?, detail }——登录名取 "Hi <login>!"（GitHub 对 git 用户返回该问候）。
 * @param {object} [opts] { workspaceRoot }
 */
export function testSshAuth({ workspaceRoot = '' } = {}) {
  const keys = resolveSshKeys({ workspaceRoot });
  if (!keys.length) return { valid: false, checked: false, login: '', detail: '未找到 SSH 私钥（id_rsa/id_ed25519/id_ecdsa）' };
  for (const { keyPath } of keys) {
    const known = join('/tmp', `dsh-git-push-known-hosts-${process.pid}`);
    // git@ssh.github.com 只接受 git 用户；-T 禁止伪终端，GitHub 返回 "Hi <login>! You've successfully authenticated"
    // 注：spawnSync args 直接作为 argv（不经 shell），keyPath 含空格无需引号——引号反而让 ssh 把
    //   带引号的字符串当文件名；与 push.js 用 shell 字符串 GIT_SSH_COMMAND 不同。
    const r = spawnSync('ssh', ['-i', keyPath, '-p', '443',
      '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${known}`, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
      '-T', 'git@ssh.github.com'], { encoding: 'utf8', timeout: 20_000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const match = out.match(/Hi\s+([A-Za-z0-9._-]+)!/);
    if (match) return { valid: true, checked: true, login: match[1], detail: out.trim() };
    // 权限拒绝 / 超时 / 网络失败 → 无效
    if (!match) {
      const detail = (out || (r.error?.message) || `exit ${r.status}`).trim().slice(0, 120);
      return { valid: false, checked: true, login: '', detail };
    }
  }
  return { valid: false, checked: true, login: '', detail: 'SSH 认证失败' };
}

/**
 * 校验 GitHub 账号与凭据：token 与 SSH **分别**判定有效性。
 * 网络出口：token → api.github.com（githubFetch 硬闸）；SSH → ssh.github.com:443（-T 直连）。
 * @param {object} [opts] { workspaceRoot, token, checkSsh }
 * @returns {Promise<object>} { ok, loggedIn, cookieSet, warnLevel, cred, detail, username?, tokenStatus?, sshStatus?, ... }
 */
export async function checkGithubAccount({ workspaceRoot = '', token = '', checkSsh = true } = {}) {
  const tok = token || resolveToken({ workspaceRoot }).token;
  const ssh = readSshPub({ workspaceRoot });
  const cred = {
    hasToken: !!tok,
    tokenMasked: tok ? maskToken(tok) : '',
    hasSshPub: ssh.configured,
    sshFingerprint: ssh.fingerprint,
  };

  // token 有效性：在线 /user（成功时保存完整用户档案，供成功分支返回 仓库数/套餐/名字 等）
  let tokenStatus = { valid: false, checked: false, detail: '' };
  let userProfile = null; // token 有效的 /user 响应 { login, public_repos, plan, html_url, ... }
  if (tok) {
    const userResp = await githubFetch('/user', { token: tok, timeout: 15_000 });
    const ok = Boolean(userResp.status === 200 && userResp.json?.login);
    tokenStatus = { valid: ok, checked: true, login: ok ? userResp.json.login : '', detail: ok ? '' : (userResp.json?.message || userResp.error || `HTTP ${userResp.status}`) };
    if (ok) userProfile = userResp.json;
  }

  // SSH 有效性：在线 ssh -T（需真有私钥；无私钥仅 .pub 时跳过在线校验，仅记「已配置未验证」）
  let sshStatus = { valid: false, checked: false, login: '', detail: '' };
  if (ssh.configured && checkSsh) {
    const s = testSshAuth({ workspaceRoot });
    // testSshAuth 无私有 key 时返回 checked:false（仅 .pub 时不做在线探测）
    sshStatus = { valid: s.valid, checked: !!s.checked, login: s.login || '', detail: s.detail || (s.valid ? '' : 'SSH 认证失败') };
  }
  // 兜底：SSH 不联网校验时，只看是否配置公钥
  if (ssh.configured && !checkSsh) sshStatus = { valid: false, checked: false, login: '', detail: '（未做在线校验）' };

  // 综合登录态：token 有效 或 SSH 有效，两者任一成立即视为已登录（username 取有效者）
  const tokenValid = tokenStatus.valid;
  const sshValid = sshStatus.valid;
  const username = tokenValid && tokenStatus.login ? tokenStatus.login : (sshValid ? sshStatus.login : '');

  if (!tok && !ssh.configured) {
    return { ok: true, loggedIn: false, cookieSet: false, warnLevel: 'err', cred, detail: '未配置 Token / SSH 公钥', tokenStatus, sshStatus };
  }
  if (!tokenValid && !sshValid) {
    const msgs = [];
    if (tok) msgs.push(/Bad credentials|401/.test(tokenStatus.detail) ? 'Token 无效（Bad credentials）' : `Token 检测失败: ${tokenStatus.detail}`);
    if (ssh.configured && sshStatus.checked && !sshValid) msgs.push('SSH 认证失败');
    // 仅配置 SSH 公钥/私钥、无 token，且 SSH 未做在线验证（无法确认有效）→ 保持 warn
    //   （SSH 推送仍可能可用），而不是硬 err；有 token 时才按 token 判定 err。
    if (!tok && ssh.configured && !sshStatus.checked) {
      return {
        ok: true, loggedIn: false, cookieSet: true, warnLevel: 'warn', cred,
        detail: '已有 SSH 公钥，但无 Token，无法向 api.github.com 取用户信息（SSH 推送仍可能可用）',
        tokenStatus, sshStatus,
      };
    }
    return {
      ok: true, loggedIn: false, cookieSet: true, warnLevel: 'err', cred,
      detail: msgs.length ? msgs.join('；') : '凭据均无效',
      tokenStatus, sshStatus,
    };
  }
  return {
    ok: true,
    loggedIn: true,
    cookieSet: true,
    warnLevel: 'ok',
    cred,
    username,
    // 2026-09-16 补回 token 有效的 /user 档案字段（仓库数/套餐/名字/主页）——
    //   此前成功分支只回 username，前端「公钥仓库数/套餐」恒显示 ?
    userId: userProfile?.id,
    name: userProfile?.name || '',
    profileUrl: userProfile?.html_url || (userProfile ? `https://github.com/${userProfile.login}` : ''),
    publicRepos: userProfile?.public_repos,
    plan: userProfile?.plan?.name || userProfile?.plan || '',
    tokenStatus,
    sshStatus,
  };
}

/** 账号检查结果格式化为可读块（formatGithubAccountBlock）。 */
export function formatGithubAccountBlock(r = {}) {
  const L = [];
  const cred = r.cred || {};
  const t = r.tokenStatus || {};
  const s = r.sshStatus || {};
  const mark = (item) => (item.valid ? '✅' : (item.checked ? '❌' : '⏳'));
  if (!r.cookieSet) {
    L.push('❌ 未配置 Token / SSH 公钥（推送将走匿名失败）');
  } else if (r.loggedIn) {
    L.push(`✅ 已登录 GitHub：${r.username}${r.name ? `（${r.name}）` : ''}`);
    L.push(`- 公钥仓库数：${r.publicRepos ?? '?'}｜套餐：${r.plan || '?'}`);
    if (cred.hasToken) L.push(`${mark(t)} Token：${cred.tokenMasked || '已配置'}${t.checked && t.login ? `（${t.login}）` : ''}${t.detail && !t.valid ? `｜${t.detail}` : ''}`);
    if (cred.hasSshPub) L.push(`${mark(s)} SSH 公钥：${cred.sshFingerprint || '已配置'}${s.checked && s.login ? `（${s.login}）` : ''}${s.detail && !s.valid ? `｜${s.detail}` : ''}`);
  } else {
    L.push(`⚠️ 未登录：${r.detail || '凭据缺失'}`);
    if (cred.hasToken) L.push(`${mark(t)} Token：${cred.tokenMasked || '已配置'}${t.checked && t.login ? `（${t.login}）` : ''}${t.detail && !t.valid ? `｜${t.detail}` : ''}`);
    if (cred.hasSshPub) L.push(`${mark(s)} SSH 公钥：${cred.sshFingerprint || '已配置'}${s.detail && !s.valid ? `｜${s.detail}` : ''}`);
  }
  return L.join('\n');
}