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
 *     authMode,            // 凭据来源：none | pat | device-flow（见 updateAccountStatusAuth）
 *     authLogin,           // 来源对应的登录名（device-flow 用授权得到的 login）
 *     authorizedAt,        // 授权时间 ISO（仅 device-flow 有值）
 *     checkedAt,           // 本次探测时间 ISO
 *   }
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, chmodSync, renameSync, mkdirSync } from 'node:fs';
import { checkGithubAccount } from './account.js';
import { credentialsDir } from './credentials.js';
// 直接取 core 实现（git/atomic-json.js 只是兼容壳）：语义是「读-改-写一步」，
//   正是局部覆盖（只动 auth 三项）需要的东西。
import { updateJsonAtomic } from '../core/atomic-json.js';

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
 * @param {{authMode?:string, authLogin?:string, authorizedAt?:string}} [auth]
 *   凭据来源三元组（来源/登录名/授权时间）。单独作为参数传进来，而不是从 result 里取：
 *   checkGithubAccount 只回答「这枚凭据现在有效吗」，它不该知道凭据是手填还是授权来的
 *   （那是配置侧的事实，由调用方解析后交下来，避免数据层回头去读配置）。
 */
export function buildAccountStatus(result = {}, auth = {}) {
  const now = new Date().toISOString();
  const ts = result.tokenStatus || {};
  const ss = result.sshStatus || {};
  return {
    username: result.username || '',
    loggedIn: !!result.loggedIn,
    // timeout 标志：本次校验因网络超时未测成（凭据未必无效），供 UI 文案区分，不误导为「已失效」
    // id：账号数字 id（拼 GitHub noreply 提交邮箱用，见 lib/git/identity.js）
    token: { valid: !!ts.valid, login: ts.login || '', id: String(ts.id || ''), checkedAt: ts.checked ? now : '', detail: ts.detail || '', timeout: ts.timeout === true },
    ssh: { valid: !!ss.valid, login: ss.login || '', checkedAt: ss.checked ? now : '', detail: ss.detail || '', timeout: ss.timeout === true },
    // 凭据来源快照：让「离线读 account-status.json」的人也能看出这枚 token 是怎么来的
    //   （UI 的来源徽标、以及不经过 HTTP 的外部排查）。
    authMode: String(auth.authMode || ''),
    authLogin: String(auth.authLogin || ''),
    authorizedAt: String(auth.authorizedAt || ''),
    // API 通道配额（UI 显示用）——checkGithubAccount 从 /user 响应头提取；
    //   无响应头（代理剥离）时留空，UI 显示「—」。
    apiQuota: result.apiQuota || null,
    checkedAt: now,
  };
}

/**
 * 用已有的 checkGithubAccount 结果直接写 account-status.json（不重复网络探测）。
 * @param {object} result checkGithubAccount 的返回值
 */
/**
 * 统一写入口：由 checkGithubAccount 结果聚合账号状态并写 account-status.json。
 * 收口：返回 `statusUpdated` 标志——调用方（HTTP/tool）透传给 UI，
 *   UI 账号信息据此重新读取 account-status（refreshAccount 离线读回）。
 * @param {object} result checkGithubAccount 的返回值
 * @param {{workspaceRoot?: string, auth?: object}} [opts] auth 透传给 buildAccountStatus
 * @returns {{ok:boolean, statusUpdated:boolean, file?:string, error?:string}}
 */
export function writeAccountStatusFromResult(result, { workspaceRoot = '', auth = {} } = {}) {
  const res = writeAccountStatus(buildAccountStatus(result, auth), { workspaceRoot });
  return { ...res, statusUpdated: res.ok === true };
}

/**
 * 局部覆盖快照里的「凭据来源」三项（authMode/authLogin/authorizedAt），其余字段一概不动。
 *
 * 为什么单独成函数：来源会独立于校验时机变化（手填 PAT、走完授权、撤销），而 token/ssh 的
 *   校验结果只应该在真正探测时刷新。若用 buildAccountStatus 整份重写，会把上次的
 *   token/ssh 结论一起清成「未校验」——UI 上表现为「只是切了个来源，凭据却显示未检测」。
 *
 * 与 updateAccountStatusQuota 同一约定：走 updateJsonAtomic 做读-改-写（同文件两个写者
 *   互不覆盖），并回 statusUpdated 供 UI 决定是否重读；created 表示本次新建了文件。
 * @param {{authMode?:string, authLogin?:string, authorizedAt?:string}} auth
 * @param {{workspaceRoot?: string}} [opts]
 * @returns {{ok:boolean, statusUpdated:boolean, created:boolean, file?:string, error?:string}}
 */
export function updateAccountStatusAuth(auth = {}, { workspaceRoot = '' } = {}) {
  const file = accountStatusFile({ workspaceRoot });
  const created = readAccountStatus({ workspaceRoot }) === null;
  const updated = updateJsonAtomic(file, (current) => ({
    ...current,
    authMode: String(auth.authMode || ''),
    authLogin: String(auth.authLogin || ''),
    authorizedAt: String(auth.authorizedAt || ''),
  }));
  return { ...updated, statusUpdated: updated.ok === true, created };
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
    // 沿用快照里已记录的来源：这条路径只回答「凭据现在有效吗」，没有能力判断来源
    //   （那要看配置里的 githubAuth）。不沿用就会把已记下的 device-flow/pat 擦成空串，
    //   表现为「推一次代码，界面上的来源徽标就没了」。
    const existing = readAccountStatus({ workspaceRoot }) || {};
    const status = buildAccountStatus(accountInfo, {
      authMode: existing.authMode,
      authLogin: existing.authLogin,
      authorizedAt: existing.authorizedAt,
    });
    writeAccountStatus(status, { workspaceRoot });
    return { ok: true, status, result: accountInfo };
  } catch { /* 探测失败则只返回本轮半成品，不落盘 */ }
}
// 局部更新 account-status.json 的 apiQuota 字段（保留 token/ssh 等其它字段不动）。
//
// 为什么单独一个函数：配额刷新（GET /rate_limit）与账号校验（account-check）是**两个独立时机**——
//   查看配额时不该重建整份状态（会覆盖掉上次的 token/ssh 校验结果），只覆盖 apiQuota 一项即可。
//
// 收口要求（与 writeAccountStatusFromResult 同一约定）：
//   ① 返回 `statusUpdated` 标志 —— HTTP 层透传给 UI，UI 据此重读快照（不是无条件拉）；
//   ② **状态文件不存在时按空底稿创建** —— 此前直接返回 {ok:false}，调用方又忽略返回值，
//      于是新装环境「查了配额但配置里没有」（配额永远不落盘）；创建后 Token 行的配额后缀
//      在离线读时也能显示。
//
// @param {object|null} apiQuota 配额对象（{ core:{limit,remaining,resetAt}, search, graphql, codeSearch, checkedAt }）
// @param {{workspaceRoot?: string}} [opts]
// @returns {{ok:boolean, statusUpdated:boolean, created:boolean, file?:string, error?:string}}
//   created=true 表示本次是新建状态文件（此前不存在）
export function updateAccountStatusQuota(apiQuota, { workspaceRoot = '' } = {}) {
  const cur = readAccountStatus({ workspaceRoot });
  const created = cur === null;
  // 空底稿：字段与 buildAccountStatus 对齐（token/ssh 标未校验，不伪造「已失效」）
  const next = cur || {
    username: '', loggedIn: false,
    token: { valid: false, login: '', checkedAt: '', detail: '', timeout: false },
    ssh: { valid: false, login: '', checkedAt: '', detail: '', timeout: false },
    checkedAt: '',
  };
  next.apiQuota = apiQuota || null;
  const res = writeAccountStatus(next, { workspaceRoot });
  return { ...res, statusUpdated: res.ok === true, created };
}
