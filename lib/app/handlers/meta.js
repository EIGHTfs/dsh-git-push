/**
 * HTTP 处理层 · git/共享元信息与只读端点（status/scan/browse/tools/tool-probes）
 *
 * 审计侧（rule-slots / rule-detail / audit / toggle-rule / exempt-hint）已搬到 handlers/audit.js，
 *   与 /api/git-audit 前缀同构——本文件不再 import 任何审计实现。
 *
 * 从 http-handlers.js 的 handleHttp 巨型 switch 拆分而来。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 */
import { VERSION } from '../../self/index.js';
import { scanRepos, browseDir } from '../../git/index.js';
import { collectToolPaths } from '../../context/index.js';
import { redactConfig } from '../schema.js';
import { listTools } from '../tools.js';
import { name } from '../constants.js';
import { readAccountStatus } from '../../git/account-status.js';
import { identityHintText, resolveCommitIdentity } from '../../git/identity.js';

/**
 * 当前提交身份（未配身份的仓库会用到的那个）：登录账号可用 → 账号身份；
 * 否则兜底 DSH Agent。供 UI 与 AI 查询「到底该用什么身份」。
 */
function currentCommitIdentity() {
  const st = readAccountStatus();
  const account = st?.token?.valid
    ? { login: st.token.login || st.username || '', id: st.token.id || '' }
    : null;
  const id = resolveCommitIdentity({ account });
  return {
    name: id.name,
    email: id.email,
    source: id.source,
    label: `${id.name} <${id.email}>`,
    hint: identityHintText(id),
    account: account ? { login: account.login, id: account.id || '' } : null,
  };
}

/** GET /api/git-push/status —— 插件信息 + 脱敏配置（token/ssh 打码）+ 当前提交身份。 */
export function handleStatus(ctx) {
  const { env, cfg } = ctx;
  return {
    status: 200,
    body: {
      ok: true,
      plugin: name,
      version: VERSION,
      workspaceRoot: env.workspaceRoot,
      config: redactConfig(cfg),
      // 提交身份：让 AI/UI 明确「未配身份的仓库会用哪个身份提交」，免得自己猜
      commitIdentity: currentCommitIdentity(),
    },
  };
}

/** GET /api/git-push/scan —— 本地仓库扫描清单。 */
export function handleScan(ctx) {
  const { env } = ctx;
  return { status: 200, body: { ok: true, repos: scanRepos(env.workspaceRoot || '.', { extraRepos: env.extraRepos }) } };
}

/** GET /api/git-push/browse —— 目录浏览（路径选择器）。 */
export function handleBrowse(ctx) {
  const { query, env } = ctx;
  const r = browseDir(String(query.path || ''), { root: env.workspaceRoot });
  return { status: r.ok ? 200 : 400, body: r.ok ? { ok: true, path: r.path, parent: r.parent, dirs: r.dirs } : { ok: false, error: r.error } };
}

/** GET /api/git-push/tools —— 插件自身工具定义清单（agent 工具）。 */
export function handleTools(ctx = {}) {
  // 传 cfg：函数形态的 params 按当前配置求值（未启用的预处理参数不出现在清单里）
  return { status: 200, body: { ok: true, tools: listTools(ctx.cfg) } };
}

/** GET /api/git-push/tool-probes —— 本机各工具实测路径/版本（真实探测）。 */
export function handleToolProbes() {
  return { status: 200, body: { ok: true, probes: collectToolPaths(null) } };
}
