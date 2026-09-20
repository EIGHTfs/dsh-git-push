/**
 * Git 执行层 · 账号状态文件
 *
 * 职责：将账号登录信息 / 凭据有效性（token、SSH 各自 ✅❌）持久化到插件配置目录
 *   account-status.json。写入时机：每次推送/提交验证账号时刷新；设置侧边栏打开时读取。
 *
 * 文件内容：
 *   {
 *     username,            // 综合有效登录名
 *     loggedIn,            // token 或 ssh 任一有效
 *     token:  { valid, login, checkedAt, detail? },
 *     ssh:    { valid, login, checkedAt, detail? },
 *     checkedAt,           // 本次探测时间 ISO
 *   }
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, chmodSync, renameSync, mkdirSync } from 'node:fs';
import { checkGithubAccount } from './account.js';
import { credentialsDir } from './credentials.js';

const STATUS_FILE = 'account-status.json';

/** 账号状态文件路径（配置目录 credentialsDir()/account-status.json）。 */
export function accountStatusFile({ workspaceRoot = '' } = {}) {
  return join(credentialsDir({ workspaceRoot }), STATUS_FILE);
}

/**
 * 读账号状态文件。无文件/损坏 → null。
 * @returns {object|null} { username, loggedIn, token, ssh, checkedAt }
 */
export function readAccountStatus({ workspaceRoot = '' } = {}) {
  const p = accountStatusFile({ workspaceRoot });
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch { return null; }
}

/**
 * 写入账号状态文件（0600，原子写）。失败返回 { ok:false, error }，不抛。
 */
export function writeAccountStatus(status, { workspaceRoot = '' } = {}) {
  try {
    const dir = credentialsDir({ workspaceRoot });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = join(dir, STATUS_FILE);
    const tmpPath = `${p}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(status, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(tmpPath, 0o600); } catch { /* CIFS 可能改不了 mode */ }
    renameSync(tmpPath, p);
    return { ok: true, file: p };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * 由 checkGithubAccount 的结果聚合账号状态对象（token/ssh 有效性快照）。
 * @param {object} result checkGithubAccount 的返回值
 */
export function buildAccountStatus(result = {}) {
  const now = new Date().toISOString();
  const ts = result.tokenStatus || {};
  const ss = result.sshStatus || {};
  return {
    username: result.username || '',
    loggedIn: !!result.loggedIn,
    // timeout 标志：本次校验因网络超时未测成（凭据未必无效），供 UI 文案区分，不误导为「已失效」
    token: { valid: !!ts.valid, login: ts.login || '', checkedAt: ts.checked ? now : '', detail: ts.detail || '', timeout: ts.timeout === true },
    ssh: { valid: !!ss.valid, login: ss.login || '', checkedAt: ss.checked ? now : '', detail: ss.detail || '', timeout: ss.timeout === true },
    checkedAt: now,
  };
}

/**
 * 用已有的 checkGithubAccount 结果直接写 account-status.json（不重复网络探测）。
 * @param {object} result checkGithubAccount 的返回值
 */
/**
 * 统一写入口：由 checkGithubAccount 结果聚合账号状态并写 account-status.json。
 * 2026-09-20 收口：返回 `statusUpdated` 标志——调用方（HTTP/tool）透传给 UI，
 *   UI 账号信息据此重新读取 account-status（refreshAccount 离线读回）。
 * @param {object} result checkGithubAccount 的返回值
 * @param {{workspaceRoot?: string}} [opts]
 * @returns {{ok:boolean, statusUpdated:boolean, file?:string, error?:string}}
 */
export function writeAccountStatusFromResult(result, { workspaceRoot = '' } = {}) {
  const w = writeAccountStatus(buildAccountStatus(result), { workspaceRoot });
  return { ...w, statusUpdated: w.ok === true };
}

/**
 * 探测并刷新账号状态：跑 checkGithubAccount（token 在线 /user + SSH 在线 ssh -T），
 * 聚合为状态对象并写 account-status.json。网络耗时约 1~4s。
 * @param {object} [opts] { workspaceRoot, token }
 * @returns {Promise<{ok:boolean, status?:object, result?:object}>}
 */
export async function refreshAccountStatus({ workspaceRoot = '', token = '' } = {}) {
  try {
    const accountInfo = await checkGithubAccount({ workspaceRoot, token });
    const status = buildAccountStatus(accountInfo);
    writeAccountStatus(status, { workspaceRoot });
    return { ok: true, status, result: accountInfo };
  } catch { /* 探测失败则只返回本轮半成品，不落盘 */ }
}