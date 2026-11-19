/**
 * HTTP 处理层 · 账号端点（account-status / account-check / gen-ssh-key）
 *
 * 从 http-handlers.js 的 handleHttp 拆分而来。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 */
import {
  readAccountStatus, writeAccountStatusFromResult, checkGithubAccount,
  formatGithubAccountBlock, generateSshKey, persistSshPub, resolveToken, readSshPub, fetchApiQuota,
  updateAccountStatusQuota,
} from '../../git/index.js';
// 局部覆盖用的写入口直接取自 account-status 模块：git/index.js 是显式具名再导出，
//   新函数不经那里也能用（同 meta.js 直接取 readAccountStatus 的做法）。
import { updateAccountStatusAuth } from '../../git/account-status.js';
import { handleAuthStatus } from './auth.js';

/**
 * 「手工 PAT」的迁移提示文案。
 * 只作为 status 的一个可读字段下发，不读取、不校验、不修改任何凭据：
 * 接口只负责说明「还有更省事的走法」，绝不自动迁移（换凭据这种不可逆动作不替调用方做）。
 */
const PAT_MIGRATION_HINT = '当前为手工 PAT：可改用 GitHub 授权（浏览器输一次短码，之后不必再手填 token）';

/**
 * 把当前来源同步进快照，并产出要透传给 UI 的回执字段。
 *
 * 为什么抽成函数：判定 + 写盘 + 失败回落共四处分支，摊在 handler 里会把
 *   handleAccountStatus 的圈复杂度推过阈值（响应组装与来源同步是两件事，
 *   混在一个函数里谁也读不清）。这里只做「需要就写、如实回执」。
 * @returns {{statusUpdated:boolean, statusError?:string}}
 */
function syncAuthFields(snap, auth, env) {
  if (!authMetaChanged(snap, auth)) return { statusUpdated: false };
  const written = updateAccountStatusAuth(
    { authMode: auth.authMode, authLogin: auth.authLogin, authorizedAt: auth.authorizedAt },
    { workspaceRoot: env.workspaceRoot },
  );
  if (written.ok) return { statusUpdated: written.statusUpdated === true };
  return { statusUpdated: false, statusError: String(written.error || '写入 account-status 失败') };
}

/**
 * 解析凭据来源三元组（来源 / 登录名 / 授权时间）+ 迁移提示。
 *
 * 为什么复用 auth 端点的实现而不是在这里再写一遍：三态判定有一条最容易漏的兜底——
 *   「配置里没有 githubAuth 时，按 resolveToken() 是否存在推出 pat / none」。写成两份，
 *   两个接口迟早会对同一枚凭据给出互相矛盾的回答（一个说 pat、一个说 device-flow），
 *   而这种不一致只会被当成界面 bug，排查时两处代码看起来都对。
 *   代价是两个 handler 之间多一条依赖，收益是判定只有一处、改一处两处同步。
 * @returns {{authMode:string, authLogin:string, authorizedAt:string, authHint:string}}
 */
function resolveAuthFields(ctx) {
  const body = handleAuthStatus(ctx)?.body || {};
  const authMode = String(body.mode || 'none');
  return {
    authMode,
    authLogin: String(body.login || ''),
    authorizedAt: String(body.authorizedAt || ''),
    // 迁移提示只给「手工 PAT」这一态：device-flow 已是目标态、none 根本没有凭据可迁。
    authHint: authMode === 'pat' ? PAT_MIGRATION_HINT : '',
  };
}

/**
 * 快照里的来源三项是否与当前不一致（不一致才需要局部覆盖落盘）。
 * 无快照时返回 false：读接口不创建文件，否则「暂无登录记录」会被撑成「凭据不可用」。
 */
function authMetaChanged(snap, auth) {
  if (!snap) return false;
  return String(snap.authMode || '') !== auth.authMode
    || String(snap.authLogin || '') !== auth.authLogin
    || String(snap.authorizedAt || '') !== auth.authorizedAt;
}

/** 把 account-status.json 的 ISO 时间格式化为本地可读时间。 */
function formatLastLoginAt(iso) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const date = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** 凭据文件真源判断（区分「未配置」与「未校验」）：读 token 文件与 SSH 公钥配置，读失败按未配置。 */
function readCredentialFlags(env) {
  let fileHasToken = false;
  let fileHasSsh = false;
  try { fileHasToken = !!(resolveToken({ workspaceRoot: env.workspaceRoot }).token || '').trim(); } catch { /* 读失败按未配置 */ }
  try { fileHasSsh = !!readSshPub({ workspaceRoot: env.workspaceRoot })?.configured; } catch { /* 读失败按未配置 */ }
  return { fileHasToken, fileHasSsh };
}

/** 把快照里的 token/ssh 子对象映射成响应字段（valid/checked/timeout 归一为布尔与字符串）。 */
function toCredStatus(st = {}) {
  return {
    valid: !!st.valid,
    login: st.login || '',
    checked: !!st.checkedAt,
    checkedAt: st.checkedAt || '',
    timeout: st.timeout === true,
  };
}

/**
 * 渲染凭据块（Token / SSH 明细行 + 结论行）。
 *
 * 为什么单独成函数：这段原本是 handleAccountStatus 里的内联 IIFE（含 line() 闭包与
 *   配额后缀判定），把该 handler 的圈复杂度推到 28（阈值 10，自审 max-cyclomatic-complexity
 *   高风险）。提出来后：① handler 只做「读快照 + 组装响应」② 渲染规则可单独阅读与复用
 *   （设置侧边栏 / 命令输出若要用同一形态，直接调本函数）。
 *
 * 形态约定：Token/SSH 明细行**原样保留**（登录名与校验时间各列一遍，不重复展示）；
 *   Token 行尾追加实时配额后缀「（配额剩余 N/h）」——N 取 core 通道剩余额度（按小时限额），
 *   无配额数据时不加后缀（既不打网络、也没有历史记录时保持简洁）。
 *
 * @param {object} snap account-status.json 快照（含 token/ssh/apiQuota）
 * @param {{fileHasToken:boolean, fileHasSsh:boolean}} flags 凭据文件真源判断（区分「未配置」与「未校验」）
 * @returns {string} 多行凭据块文本
 */
function renderCredentialBlock(snap, { fileHasToken, fileHasSsh }) {
  const ts = snap?.token || {};
  const ss = snap?.ssh || {};
  const quotaSuffix = (() => {
    const core = snap?.apiQuota?.core;
    const remaining = core && Number(core.remaining);
    return Number.isFinite(remaining) && remaining >= 0 ? `（配额剩余${remaining}/h）` : '';
  })();
  const line = (label, configured, st, suffix = '') => {
    if (!configured) return `⏳ ${label}：未配置`;
    const who = st.login || '已配置';
    if (st.valid) {
      const when = formatLastLoginAt(st.checkedAt);
      return `✅ ${label}：${who}${when ? '｜校验于 ' + when : ''}${suffix ? ' ' + suffix : ''}`;
    }
    if (st.timeout) return `⏳ ${label}：${who}｜未测成（网络超时，可重试）`;
    if (st.checkedAt) {
      const when = formatLastLoginAt(st.checkedAt);
      return `❌ ${label}：${who}${when ? '｜失效于 ' + when : ''}`;
    }
    return `⏳ ${label}：${who}｜未校验`;
  };
  const hasAny = !!(ts.valid || ss.valid);
  const lines = [line('Token', fileHasToken, ts, quotaSuffix), line('SSH 公钥', fileHasSsh, ss)];
  if (fileHasToken && !ts.valid && ss.valid) lines.push('（推送走 SSH，Token 失效不影响推送）');
  const head = hasAny ? '✅ 凭据可用' : '⚠️ 凭据不可用：点「重新检测」在线校验';
  return `${head}\n${lines.join('\n')}`;
}

/** GET /api/git-push/account-status —— 离线读账号状态快照 + 凭据文件真源判断 + 凭据来源。 */
export function handleAccountStatus(ctx) {
  const { env } = ctx;
  const status = readAccountStatus({ workspaceRoot: env.workspaceRoot });
  const { fileHasToken, fileHasSsh } = readCredentialFlags(env);
  const snap = status;
  const ts = snap?.token || {};
  const ss = snap?.ssh || {};
  const auth = resolveAuthFields(ctx);
  // 快照自愈：来源变化（手填 PAT / 走完授权 / 撤销）与「最近一次校验」是两个独立时机，
  //   文件里可能还留着旧来源。只在三项确实不一致时局部覆盖，让「离线读 account-status.json」
  //   也能看到来源（UI 徽标、不经 HTTP 的外部排查都用得上）；稳态下这次判断不落盘。
  const authSync = syncAuthFields(snap, auth, env);
  const statusObj = {
    ok: true,
    offline: true,
    loggedIn: !!(ts.valid || ss.valid),
    username: snap?.username || '',
    tokenConfigured: fileHasToken,
    sshConfigured: fileHasSsh,
    // 凭据来源三态：让「这枚 token 是手填的还是授权来的」可被 API 读到（与 /auth/status 同源）
    authMode: auth.authMode,
    authLogin: auth.authLogin,
    authorizedAt: auth.authorizedAt,
    authHint: auth.authHint,
    tokenStatus: toCredStatus(ts),
    sshStatus: toCredStatus(ss),
    checkedAt: snap?.checkedAt || '',
    apiQuota: snap?.apiQuota || null,
    // 回写结果如实透传（UI 据此决定是否重读快照；写失败不吞，带 statusError）
    statusUpdated: authSync.statusUpdated === true,
    ...(authSync.statusError ? { statusError: authSync.statusError } : {}),
    block: snap ? renderCredentialBlock(snap, { fileHasToken, fileHasSsh }) : '（暂无登录记录，点击「重新检测」在线校验）',
  };
  return { status: 200, body: statusObj };
}

/** 配额查询缓存：{ at, data }——60 秒内复用，避免前端刷新反复打 GitHub。 */
let apiQuotaCache = null;
const API_QUOTA_TTL_MS = 60_000;

/**
 * GET /api/git-push/api-quota —— 实时查 token 的 GitHub API 配额（core/search/graphql/code_search）。
 *   /rate_limit 端点**不消耗配额**；60 秒进程内缓存；?refresh=1 强制刷新。
 */
export async function handleApiQuota(ctx) {
  const { env, query } = ctx;
  const force = String(query?.refresh || '') === '1';
  if (!force && apiQuotaCache && Date.now() - apiQuotaCache.at < API_QUOTA_TTL_MS) {
    // 命中缓存：本轮没有新的落盘动作，statusUpdated 恒 false（快照早在首次查询时已写）
    return { status: 200, body: { ...apiQuotaCache.data, cached: true, statusUpdated: false } };
  }
  const quotaData = await fetchApiQuota({ workspaceRoot: env.workspaceRoot });
  apiQuotaCache = { at: Date.now(), data: quotaData };
  if (!quotaData.ok) return { status: 200, body: { ...quotaData, cached: false, statusUpdated: false } };
  // 写回快照（统一收口 updateAccountStatusQuota，局部覆盖 apiQuota 一项）——account-status 是
  //   「离线读」：Token 行的配额后缀要在不打网络时也能显示，就必须把本次查到的配额落到
  //   account-status.json；状态文件不存在时由收口函数按空底稿创建（此前这里静默丢写）。
  // 收口结果**透传**给 UI：statusUpdated 驱动重读，写失败带 statusError 如实回报（不吞）。
  const wr = updateAccountStatusQuota({
    core: quotaData.core, search: quotaData.search, graphql: quotaData.graphql, codeSearch: quotaData.codeSearch,
    checkedAt: quotaData.fetchedAt,
  }, { workspaceRoot: env.workspaceRoot });
  return {
    status: 200,
    body: {
      ...quotaData, cached: false,
      statusUpdated: wr.statusUpdated === true,
      statusCreated: wr.created === true,
      ...(wr.ok ? {} : { statusError: String(wr.error || '写入 account-status 失败') }),
    },
  };
}

/** POST /api/git-push/account-check —— 在线校验账号（token/ssh），写 account-status.json。 */
export async function handleAccountCheck(ctx) {
  const { body, env, cfg } = ctx;
  const pub = String(body.sshPub || cfg.sshPub || '');
  if (pub) persistSshPub(pub, { workspaceRoot: env.workspaceRoot });
  const tok = String(body.githubToken || cfg.githubToken || '');
  const accountInfo = await checkGithubAccount({ workspaceRoot: env.workspaceRoot, token: tok, checkSsh: body.checkSsh !== false });
  accountInfo.block = formatGithubAccountBlock(accountInfo);
  // 顺手把「凭据来源」一起落进快照：校验本就是刷新快照的时机，来源与校验结论同一次写入，
  //   省得离线读时出现「token 有结论、来源字段还是上一轮的」这种半新半旧状态。
  const wr = writeAccountStatusFromResult(accountInfo, { workspaceRoot: env.workspaceRoot, auth: resolveAuthFields(ctx) });
  return { status: 200, body: { ...accountInfo, statusUpdated: wr.statusUpdated === true, status: readAccountStatus({ workspaceRoot: env.workspaceRoot }) } };
}

/** POST /api/git-push/gen-ssh-key —— 生成 SSH 密钥对（公钥整行回传，私钥永不离开本机）。 */
export function handleGenSshKey(ctx) {
  const { body, env } = ctx;
  const r = generateSshKey(String(body.email || ''), { workspaceRoot: env.workspaceRoot, force: body.force === true });
  if (!r.ok) return { status: 400, body: { ok: false, code: 'SSH_KEY', error: r.error } };
  return { status: 200, body: { ok: true, email: r.email, privateKey: r.privateKey, pubFile: r.pubFile, pub: r.pub, note: '公钥已写入插件配置目录 *.pub，可复制粘贴到 GitHub → Settings → SSH and GPG keys' } };
}