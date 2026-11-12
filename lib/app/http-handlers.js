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
  handleRuleSlots, handleRuleDetail, handleAudit, handleToggleRule, handleExemptHint,
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
import {
  handleWorkspacePathsGet, handleWorkspacePathsSet,
} from './handlers/workspace-paths.js';
import {
  handleNpmAccount, handleNpmCheck, handleNpmOwned, handleNpmPackages, handleNpmInstall, handleNpmPublish,
} from './handlers/npm.js';
import { appendHttpRejectLog } from './settings-bridge.js';
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
    {
      method: req?.method, url: req?.url, origin: req?.headers?.origin, headers: req?.headers, body,
      // TCP 对端地址：无 Origin 判据以它定论（Host 头可伪造、且转发链路可能丢 Host）
      remoteAddress: req?.socket?.remoteAddress || '',
    },
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

/** POST JSON 体：接受对象，**也接受 JSON 字符串**（内部调用传的是字符串）。 */
function readBody(req) {
  const raw = req && req['body'];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  // 内部调用（git_api 工具 / CLI）把 body 以 **JSON 字符串** 传入（tool-call.js 里
  //   `body: bodyText`）；原先一律当空对象 ⇒ **所有 POST 端点的 body 被静默丢弃** ✗
  //   （实测 2026-10-15：workspace-paths 的 POST 经工具/CLI 调用时 body 恒为空，
  //    而浏览器路径走 adaptHttpHandler 的 readJsonBody ⇒ 正常 ✓ ⇒ 两条路径行为分叉）
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
    } catch { return {}; }
  }
  return {};
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
  // content-type 一并传入：桌面端（dsh-app://）转发**显式剥离 Origin**（桌面壳
  //   forwardWebRequest 里 headers.delete('origin')），只补 cookie。若不把 Content-Type
  //   传进来，设置页的所有保存/开关/按钮在桌面版恒 403，而 GET 免校验照常——
  //   表现为「页面能打开、保存永不生效」，且拒绝发生在 handler 之前连日志都不留。
  //   放行判据见 checkOrigin：无 Origin 时要求 JSON CT + 回环 Host 同时成立。
  // remoteAddress 一并传入：无 Origin 时的「是否本机」判定**以 TCP 对端地址为准**
  //   —— Host 头可被客户端伪造（`Host: 127.0.0.1`），socket 地址不可伪造。
  const remoteAddress = req.remoteAddress || req.socket?.remoteAddress || '';
  const originCheck = checkOrigin(method, req.origin, undefined, req.headers?.host, req.headers?.['content-type'], remoteAddress);
  if (!originCheck.ok) {
    // 拒绝留痕：403 发生在任何 handler 之前，不写这条日志就完全静默——
    //   用户只看到「保存失败」，排查者也没有任何线索（外部 issue 正是这么卡住的）。
    appendHttpRejectLog({
      method, url: req.url, origin: req.origin, host: req.headers?.host,
      code: originCheck.code, status: originCheck.status,
    }, env);
    return { status: originCheck.status, body: { ok: false, ...originCheck } };
  }
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
    // 豁免标记查询（只读）：供外部工具推导「该写哪个 dsh-skip-*」，避免复制标记注册表
    case '/api/git-push/exempt-hint': return handleExemptHint(ctx);
    case '/api/git-push/account-status': return handleAccountStatus(ctx);
    case '/api/git-push/npm-account': return await handleNpmAccount(ctx);
    case '/api/git-push/npm-check': return await handleNpmCheck(ctx);
    case '/api/git-push/npm-owned': return await handleNpmOwned(ctx);
    case '/api/git-push/npm-packages': return handleNpmPackages(ctx);
    case '/api/git-push/npm-install': return handleNpmInstall(ctx);
    case '/api/git-push/npm-publish': return await handleNpmPublish(ctx);
    case '/api/git-push/account-check': return await handleAccountCheck(ctx);
    case '/api/git-push/api-quota': return await handleApiQuota(ctx);
    case '/api/git-push/gen-ssh-key': return handleGenSshKey(ctx);
    case '/api/git-push/settings-get': return handleSettingsGet(ctx);
    case '/api/git-push/settings-set': return await handleSettingsSet(ctx);
    // AI 自设工作区路径：同一路径按 HTTP 方法分发（GET 读清单 / POST 写清单）
    case '/api/git-push/workspace-paths':
      return method === 'POST' ? handleWorkspacePathsSet(ctx) : handleWorkspacePathsGet(ctx);
    default:
      return { status: 404, body: { ok: false, code: 'NOT_FOUND', message: `无此端点: ${method} ${path}` } };
  }
}
