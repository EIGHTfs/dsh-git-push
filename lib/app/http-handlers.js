/**
 * 插件入口层 · HTTP 处理
 *
 * handleHttp（路由分发）、listRuleSlots（规则包列表端点）、
 *   adaptHttpHandler（把 handler 适配成宿主 HTTP 形态）。
 * 与工具调用分开：HTTP 走 host 的路由与状态码，工具走结构化返回。
 */

import { checkOrigin, checkBodySize, checkWriteConfirm, readJsonBody } from '../http/index.js';
import { defaultConfig } from '../client/index.js';
import {
  handleStatus, handleScan, handleBrowse, handleTools, handleToolProbes,
  handleRuleSlots, handleRuleDetail, handleAudit, handleToggleRule,
} from './handlers/meta.js';
import {
  handleReposLocal, handleReposLocalScan, handleReposLocalScanWait, handleReposLocalRefresh, handleReposCloud,
} from './handlers/repos.js';
import {
  handleRepoVisibility, handleRepoPush, handleRepoCommit,
} from './handlers/repo-actions.js';
import {
  handleRepoClone, handleCloneLogs, handleCloneAbort, handleClonePreview, handleCloneProgress,
} from './handlers/clone.js';
import {
  handleAccountStatus, handleAccountCheck, handleGenSshKey, handleApiQuota,
} from './handlers/account.js';
import {
  handleSettingsGet, handleSettingsSet,
} from './handlers/settings.js';
/** 规则槽位清单对外导出（实现迁至 handlers/meta.js）。 */
export { listRuleSlots } from './handlers/meta.js';

/**
 * HTTP 适配：DSH webServer 原生 (req, res) ↔ v2 纯函数 handleHttp({status, body})。
 * 返回 undefined 表示「非本插件路由 → 放行」（与旧版 handler 语义一致）。
 */
export async function adaptHttpHandler(req, res, env, cfg) {
  let body;
  if (String(req?.method || 'GET').toUpperCase() === 'POST') {
    // readJsonBody 是 callback 风格（非 Promise）：包一层 Promise 等待完成
    body = await new Promise((resolve) => readJsonBody(req, resolve));
  }
  const httpResult = await handleHttp(
    { method: req?.method, url: req?.url, origin: req?.headers?.origin, headers: req?.headers, body },
    env,
    cfg,
  );
  if (!httpResult) return undefined;
  try {
    res.writeHead(httpResult.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(httpResult.body, null, 2));
  } catch { /* 响应已开始或连接已断：忽略 */ }
  return httpResult;
}

/** POST JSON 体：只接受非数组对象，其它一律当空对象。 */
function readBody(req) {
  const raw = req && req['body'];
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

/** 统一构造 handler 上下文（各 handler 签名 handleXxx(ctx)）。 */
function buildCtx(req, method, env, cfg, query, body, path) {
  return { req, method, env, cfg, query, body, path };
}

/**
 * HTTP 端点分发（鉴权前置：Origin/CSRF → 413 → 写确认 → switch 路由）。
 * 各端点实现已拆到 lib/app/handlers/ 模块（meta/repos/repo-actions/clone/account/settings）。
 * @param {object} req { method, url, origin, headers, body? }
 * @param {object} env
 * @param {object} cfg
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleHttp(req = {}, env = {}, cfg = defaultConfig()) {
  const method = String(req.method || 'GET').toUpperCase();
  const originCheck = checkOrigin(method, req.origin, undefined, req.headers?.host);
  if (!originCheck.ok) return { status: originCheck.status, body: { ok: false, ...originCheck } };
  const sizeCheck = checkBodySize(Number(req.headers?.['content-length']) || 0);
  if (!sizeCheck.ok) return { status: sizeCheck.status, body: { ok: false, ...sizeCheck } };
  const path = String(req.url || '/').split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(String(req.url || '/').split('?')[1] || ''));
  const body = readBody(req);
  const writeConfirmOps = ['/api/git-push/rebuild', '/api/git-push/rollback', '/api/git-push/repo-push', '/api/git-push/repo-commit', '/api/git-push/repo-clone', '/api/git-push/repo-visibility'];
  if (writeConfirmOps.includes(path)) {
    const confirm = checkWriteConfirm(body);
    if (!confirm.ok) return { status: confirm.status, body: { ok: false, ...confirm } };
  }
  const ctx = buildCtx(req, method, env, cfg, query, body, path);
  switch (path) {
    case '/api/git-push/status': return await handleStatus(ctx);
    case '/api/git-push/scan': return handleScan(ctx);
    case '/api/git-push/browse': return handleBrowse(ctx);
    case '/api/git-push/repos-local': return await handleReposLocal(ctx);
    case '/api/git-push/repos-local-scan': return handleReposLocalScan(ctx);
    case '/api/git-push/repos-local-scan-wait': return await handleReposLocalScanWait(ctx);
    case '/api/git-push/repos-local-refresh': return await handleReposLocalRefresh(ctx);
    case '/api/git-push/repos-cloud': return await handleReposCloud(ctx);
    case '/api/git-push/repo-visibility': return await handleRepoVisibility(ctx);
    case '/api/git-push/repo-push': return await handleRepoPush(ctx);
    case '/api/git-push/repo-commit': return await handleRepoCommit(ctx);
    case '/api/git-push/repo-clone': return await handleRepoClone(ctx);
    case '/api/git-push/clone-logs': return handleCloneLogs(ctx);
    case '/api/git-push/clone-abort': return handleCloneAbort(ctx);
    case '/api/git-push/clone-preview': return await handleClonePreview(ctx);
    case '/api/git-push/clone-progress': return handleCloneProgress(ctx);
    case '/api/git-push/tools': return handleTools(ctx);
    case '/api/git-push/tool-probes': return handleToolProbes(ctx);
    case '/api/git-push/rule-slots': return handleRuleSlots(ctx);
    case '/api/git-push/rule-detail': return handleRuleDetail(ctx);
    case '/api/git-push/audit': return await handleAudit(ctx);
    case '/api/git-push/toggle-rule': return handleToggleRule(ctx);
    case '/api/git-push/account-status': return handleAccountStatus(ctx);
    case '/api/git-push/account-check': return await handleAccountCheck(ctx);
    case '/api/git-push/api-quota': return await handleApiQuota(ctx);
    case '/api/git-push/gen-ssh-key': return handleGenSshKey(ctx);
    case '/api/git-push/settings-get': return handleSettingsGet(ctx);
    case '/api/git-push/settings-set': return await handleSettingsSet(ctx);
    default:
      return { status: 404, body: { ok: false, code: 'NOT_FOUND', message: `无此端点: ${method} ${path}` } };
  }
}
