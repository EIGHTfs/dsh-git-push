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

/** GET /api/git-push/account-status —— 离线读账号状态快照 + 凭据文件真源判断。 */
export function handleAccountStatus(ctx) {
  const { env } = ctx;
  const status = readAccountStatus({ workspaceRoot: env.workspaceRoot });
  const { fileHasToken, fileHasSsh } = readCredentialFlags(env);
  const snap = status;
  const ts = snap?.token || {};
  const ss = snap?.ssh || {};
  const statusObj = {
    ok: true,
    offline: true,
    loggedIn: !!(ts.valid || ss.valid),
    username: snap?.username || '',
    tokenConfigured: fileHasToken,
    sshConfigured: fileHasSsh,
    tokenStatus: toCredStatus(ts),
    sshStatus: toCredStatus(ss),
    checkedAt: snap?.checkedAt || '',
    apiQuota: snap?.apiQuota || null,
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
  const data = await fetchApiQuota({ workspaceRoot: env.workspaceRoot });
  apiQuotaCache = { at: Date.now(), data };
  if (!data.ok) return { status: 200, body: { ...data, cached: false, statusUpdated: false } };
  // 写回快照（统一收口 updateAccountStatusQuota，局部覆盖 apiQuota 一项）——account-status 是
  //   「离线读」：Token 行的配额后缀要在不打网络时也能显示，就必须把本次查到的配额落到
  //   account-status.json；状态文件不存在时由收口函数按空底稿创建（此前这里静默丢写）。
  // 收口结果**透传**给 UI：statusUpdated 驱动重读，写失败带 statusError 如实回报（不吞）。
  const wr = updateAccountStatusQuota({
    core: data.core, search: data.search, graphql: data.graphql, codeSearch: data.codeSearch,
    checkedAt: data.fetchedAt,
  }, { workspaceRoot: env.workspaceRoot });
  return {
    status: 200,
    body: {
      ...data, cached: false,
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
  const wr = writeAccountStatusFromResult(accountInfo, { workspaceRoot: env.workspaceRoot });
  return { status: 200, body: { ...accountInfo, statusUpdated: wr.statusUpdated === true, status: readAccountStatus({ workspaceRoot: env.workspaceRoot }) } };
}

/** POST /api/git-push/gen-ssh-key —— 生成 SSH 密钥对（公钥整行回传，私钥永不离开本机）。 */
export function handleGenSshKey(ctx) {
  const { body, env } = ctx;
  const r = generateSshKey(String(body.email || ''), { workspaceRoot: env.workspaceRoot, force: body.force === true });
  if (!r.ok) return { status: 400, body: { ok: false, code: 'SSH_KEY', error: r.error } };
  return { status: 200, body: { ok: true, email: r.email, privateKey: r.privateKey, pubFile: r.pubFile, pub: r.pub, note: '公钥已写入插件配置目录 *.pub，可复制粘贴到 GitHub → Settings → SSH and GPG keys' } };
}