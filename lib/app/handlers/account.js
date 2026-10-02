/**
 * HTTP 处理层 · 账号端点（account-status / account-check / gen-ssh-key）
 *
 * 从 http-handlers.js 的 handleHttp 拆分而来。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 */
import {
  readAccountStatus, writeAccountStatusFromResult, checkGithubAccount,
  formatGithubAccountBlock, generateSshKey, persistSshPub, resolveToken, readSshPub,
} from '../../git/index.js';

/** 把 account-status.json 的 ISO 时间格式化为本地可读时间。 */
function formatLastLoginAt(iso) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const date = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** GET /api/git-push/account-status —— 离线读账号状态快照 + 凭据文件真源判断。 */
export function handleAccountStatus(ctx) {
  const { env } = ctx;
  const status = readAccountStatus({ workspaceRoot: env.workspaceRoot });
  let fileHasToken = false;
  let fileHasSsh = false;
  try { fileHasToken = !!(resolveToken({ workspaceRoot: env.workspaceRoot }).token || '').trim(); } catch { /* 读失败按未配置 */ }
  try { fileHasSsh = !!readSshPub({ workspaceRoot: env.workspaceRoot })?.configured; } catch { /* 读失败按未配置 */ }
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
    tokenStatus: {
      valid: !!ts.valid, login: ts.login || '', checked: !!ts.checkedAt,
      checkedAt: ts.checkedAt || '', timeout: ts.timeout === true,
    },
    sshStatus: {
      valid: !!ss.valid, login: ss.login || '', checked: !!ss.checkedAt,
      checkedAt: ss.checkedAt || '', timeout: ss.timeout === true,
    },
    checkedAt: snap?.checkedAt || '',
    // API 通道配额（2026-10-02 功能：UI 显示）——上次在线校验存的 core 通道 rate limit；
    //   未校验/代理剥离响应头时 null，UI 显示「—」。
    apiQuota: snap?.apiQuota || null,
    block: snap ? (() => {
      const line = (label, configured, st) => {
        if (!configured) return `⏳ ${label}：未配置`;
        const who = st.login || '已配置';
        if (st.valid) {
          const when = formatLastLoginAt(st.checkedAt);
          return `✅ ${label}：${who}${when ? '｜校验于 ' + when : ''}`;
        }
        if (st.timeout) return `⏳ ${label}：${who}｜未测成（网络超时，可重试）`;
        if (st.checkedAt) {
          const when = formatLastLoginAt(st.checkedAt);
          return `❌ ${label}：${who}${when ? '｜失效于 ' + when : ''}`;
        }
        return `⏳ ${label}：${who}｜未校验`;
      };
      const hasAny = !!(ts.valid || ss.valid);
      const lines = [line('Token', fileHasToken, ts), line('SSH 公钥', fileHasSsh, ss)];
      if (fileHasToken && !ts.valid && ss.valid) lines.push('（推送走 SSH，Token 失效不影响推送）');
      const head = hasAny ? '✅ 凭据可用' : '⚠️ 凭据不可用：点「重新检测」在线校验';
      return `${head}\n${lines.join('\n')}`;
    })() : '（暂无登录记录，点击「重新检测」在线校验）',
  };
  return { status: 200, body: statusObj };
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