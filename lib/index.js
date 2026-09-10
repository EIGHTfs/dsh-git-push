/**
 * dsh-git-push 插件入口（DSH 接线，1.0.0）
 * dsh-skip-i18n: 插件为中文零依赖 CLI（无 i18n 框架需求），用户可见文案硬编码为产品设计
 *
 * 形态：`apply(ctx, config)` + `ctx.inject`（与 DSH 插件实证风格一致）。
 * 职责：把 v2 十大总入口接到 DSH 运行时——
 *   1) 工具注册：git_scan / git_commit_push / code_audit / git_clone / git_remote_create / git_set_visibility
 *   2) 上下文注入：systemPrompt section（lib/context）
 *   3) HTTP API：/api/git-push/*（lib/http 鉴权流水线 + 端点）
 *   4) 客户端插件：settings.section（lib/client/index.js）
 *
 * 本文件只做接线（薄适配层），业务全部在 lib/<入口>/：
 *   rule / audit / git / self / score / exempt / context / http / client / link-check。
 * 引擎可脱离 DSH 独立运行：`node cli.mjs <子命令>`。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { VERSION } from './self/index.js';
import { auditWithScope, auditFull } from './audit/index.js';
import { summarize } from './audit/index.js';
import { scoreQuality } from './score/index.js';
import { commitAndPush, cloneViaApi, ensureRemoteRepo, setVisibility } from './git/index.js';
import { scanRepos } from './git/index.js';
import { createEnvInjectionText } from './context/index.js';
import { routeRequest, checkOrigin, checkBodySize, checkWriteConfirm, readJsonBody } from './http/index.js';
import { defaultConfig, resolveConfig } from './client/index.js';
import { checkLinks, sumLinkPenalty } from './link-check/index.js';

/** git 工具共用参数错误文案（单处定义，多处复用）。 */
export const MSG_REPO_REQUIRED = 'repo 必填';

export const name = 'dsh-git-push';
export const GIT_PUSH_SETTINGS_NS = 'git-push';

/** 插件配置 schema（纯声明，DSH 侧读 name/config；不引第三方校验库）。 */
export const Config = {
  enabled: { type: 'boolean', default: true, description: '启用插件' },
  workspaceRoot: { type: 'string', default: '', description: '扫描根目录（空=DSH workspaceRoot）' },
  extraRepos: { type: 'string', default: '', description: '额外仓库路径（逗号分隔）' },
  auditEnabled: { type: 'boolean', default: false, description: '提交前审计（默认关）' },
  auditScanScope: { type: 'string', default: 'diff', description: 'diff | full' },
  pushPermitEnabled: { type: 'boolean', default: false, description: 'AI 回复推送许可（默认关）' },
  linkCheckEnabled: { type: 'boolean', default: false, description: '链接检查（默认关，需网络）' },
};

/** 工具清单（DSH 工具注册用：名 + 说明 + 参数 schema）。 */
export function listTools() {
  return [
    { name: 'git_scan', description: '扫描工作区全部 git 仓库（分支/remote/未提交变更/最近活动）',
      parameters: { root: 'string?', paths: 'string?', extraReposFile: 'string?' } },
    { name: 'git_commit_push', description: '一键提交并推送（提交前审计门禁，默认开）',
      parameters: { repo: 'string', message: 'string', push: 'boolean?', audit: 'boolean?', dryRun: 'boolean?' } },
    { name: 'code_audit', description: '审计指定仓库（L0 静态 + 质量评分）',
      parameters: { repo: 'string', scope: 'string?', llm: 'boolean?' } },
    { name: 'git_clone', description: '从 api.github.com 克隆仓库（Git Data API，不跟随 302）',
      parameters: { target: 'string', dest: 'string?', branch: 'string?' } },
    { name: 'git_remote_create', description: '按目录名创建远程仓库并设 origin（api.github.com）',
      parameters: { repo: 'string', visibility: 'string?', dryRun: 'boolean?' } },
    { name: 'git_set_visibility', description: '切换仓库公开/私有',
      parameters: { repo: 'string', visibility: 'string' } },
    { name: 'link_check', description: '检查文档链接有效性（只 warning）',
      parameters: { path: 'string?' } },
  ];
}

/**
 * 插件应用入口（DSH 调用）。
 * @param {object} ctx DSH 上下文（提供 inject / tools / http / log）
 * @param {object} [config] 插件配置
 */
export async function apply(ctx, config = {}) {
  const cfg = resolveConfig(config);
  const env = {
    version: VERSION,
    workspaceRoot: config.workspaceRoot || ctx?.workspaceRoot || '',
    extraRepos: String(config.extraRepos || '').split(',').map((s) => s.trim()).filter(Boolean),
  };

  // 1) 上下文注入
  if (ctx?.inject) {
    ctx.inject(['systemPrompt'], () => ({
      name: 'dsh-git-push-context',
      content: createEnvInjectionText({ cwd: env.workspaceRoot, projectRoot: env.workspaceRoot }),
    }));
  }

  // 2) 工具注册
  if (ctx?.tools?.define) {
    for (const tool of listTools()) {
      ctx.tools.define(tool.name, { description: tool.description, parameters: tool.parameters }, (args) => callTool(tool.name, args, env, cfg));
    }
  }

  // 3) HTTP API（鉴权流水线：Origin/CSRF → 写确认 → 413）
  if (ctx?.http?.route) {
    ctx.http.route('/api/git-push/*', (req) => handleHttp(req, env, cfg));
  }

  // 4) 客户端插件（设置侧边栏）
  if (ctx?.inject) {
    ctx.inject(['slots'], () => ({
      name: 'git-push-settings',
      slot: 'settings.section',
      namespace: GIT_PUSH_SETTINGS_NS,
      client: './client.js',
    }));
  }

  ctx?.log?.info?.(`dsh-git-push v${VERSION} 已接线（审计默认${cfg.auditEnabled ? '开' : '关'}）`);
  return { ok: true, version: VERSION };
}

/**
 * 工具调用分发（薄适配：参数 → 总入口函数）。
 * @param {string} toolName
 * @param {object} args
 * @param {object} env { workspaceRoot, extraRepos }
 * @param {object} cfg 插件配置
 * @returns {Promise<object>}
 */
export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig()) {
  switch (toolName) {
    case 'git_scan': {
      const root = args.root || env.workspaceRoot;
      const repos = scanRepos(root, { extraRepos: env.extraRepos });
      return { ok: true, root, count: repos.length, repos };
    }
    case 'git_commit_push': {
      const repo = args.repo;
      if (!repo) return { ok: false, error: MSG_REPO_REQUIRED };
      const audit = args.audit ?? cfg.auditEnabled;
      let auditResult = null;
      if (audit) {
        const res = auditWithScope(repo, { scope: cfg.auditScanScope || 'diff' });
        auditResult = { summary: res.summary, quality: scoreQuality(res.findings) };
        if (res.summary.blocker > 0) {
          return { ok: false, blocked: true, error: `审计拦截：${res.summary.blocker} 个 blocker`, audit: auditResult };
        }
      }
      const r = commitAndPush({ repoPath: repo, message: args.message, push: args.push !== false, dryRun: args.dryRun === true });
      return { ok: r.ok !== false, ...r, audit: auditResult };
    }
    case 'code_audit': {
      const repo = args.repo;
      if (!repo) return { ok: false, error: MSG_REPO_REQUIRED };
      const res = args.scope === 'full' || !existsSync(join(repo, '.git')) ? auditFull(repo) : auditWithScope(repo, { scope: 'diff' });
      return { ok: true, scope: res.scope, summary: summarize(res.findings), quality: scoreQuality(res.findings), findings: res.findings };
    }
    case 'git_clone': {
      if (!args.target) return { ok: false, error: 'target 必填' };
      return cloneViaApi({ target: args.target, dest: args.dest, branch: args.branch });
    }
    case 'git_remote_create':
      if (!args.repo) return { ok: false, error: MSG_REPO_REQUIRED };
      return ensureRemoteRepo({ repoPath: args.repo, visibility: args.visibility || 'private', dryRun: args.dryRun === true });
    case 'git_set_visibility':
      if (!args.repo || !args.visibility) return { ok: false, error: 'repo 与 visibility 必填' };
      return setVisibility({ repoPath: args.repo, visibility: args.visibility });
    case 'link_check': {
      const path = args.path || env.workspaceRoot;
      const res = await checkLinks({ file: path, text: readTextSafe(path) });
      return { ok: true, count: res.length, penalty: sumLinkPenalty(res), findings: res };
    }
    default:
      return { ok: false, error: `未知工具: ${toolName}` };
  }
}

/** 读文件（失败返回空串，link_check 用）。 */
function readTextSafe(path = '') {
  try {
    return readFileSync(path, 'utf8');
  } catch { return ''; }
}

/**
 * HTTP 端点分发（鉴权前置：Origin/CSRF → 413 → 写确认）。
 * @param {object} req { method, url, origin, headers, body? }
 * @param {object} env
 * @param {object} cfg
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleHttp(req = {}, env = {}, cfg = defaultConfig()) {
  const method = String(req.method || 'GET').toUpperCase();
  const originCheck = checkOrigin(method, req.origin);
  if (!originCheck.ok) return { status: originCheck.status, body: { ok: false, ...originCheck } };
  const sizeCheck = checkBodySize(Number(req.headers?.['content-length']) || 0);
  if (!sizeCheck.ok) return { status: sizeCheck.status, body: { ok: false, ...sizeCheck } };
  const path = String(req.url || '/').split('?')[0];
  const writeConfirmOps = ['/api/git-push/rebuild', '/api/git-push/rollback'];
  if (writeConfirmOps.includes(path)) {
    const confirm = checkWriteConfirm(req.body || {});
    if (!confirm.ok) return { status: confirm.status, body: { ok: false, ...confirm } };
  }
  switch (path) {
    case '/api/git-push/status':
      return { status: 200, body: { ok: true, plugin: name, version: VERSION, workspaceRoot: env.workspaceRoot, config: cfg } };
    case '/api/git-push/scan':
      return { status: 200, body: { ok: true, repos: scanRepos(env.workspaceRoot || '.', { extraRepos: env.extraRepos }) } };
    case '/api/git-push/tools':
      return { status: 200, body: { ok: true, tools: listTools() } };
    default:
      return { status: 404, body: { ok: false, code: 'NOT_FOUND', message: `无此端点: ${method} ${path}` } };
  }
}

export { routeRequest, readJsonBody };
