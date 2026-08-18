/**
 * dsh-git-push — git 自动提交推送插件 v1.2.0（内置代码审计门禁，源自 dsh-code-audit 验证）
 *
 * 形态：apply 函数 + ctx.inject（同 dsh-skill-forge / dsh-ai-work-archive 实证风格）
 * 触发面：
 *   1. 工具 git_scan         —— 扫描 workspace 全部 git 仓库状态
 *   2. 工具 git_commit_push   —— 一键 commit + push（**推送前审计**，发现问题拦截）
 *   3. 工具 code_audit        —— 手动审计指定仓库（L0 静态 + 可选 L1 LLM）
 *   4. HTTP API              —— status / scan / commit / audit
 *
 * 审计（v1.1.0 内置，源自 dsh-code-audit 实测验证）：
 *   L0 静态（零 token）：JS 语法 / JSON / YAML / 敏感信息硬编码 / 凭据入库 / npm 包文件入库 / 大文件 / debugger / console
 *   L1 LLM 审查（默认关）：diff 喂便宜模型（如 agnes-2.5-flash / deepseek-chat）找逻辑/安全问题
 *   拦截策略 blockOn：'blocker'（默认，仅严重问题拦截）/ 'any'（严格，任何问题拦截）
 *
 * 配置（cordis.patch.yml config）：
 *   enabled / workspaceRoot / extraRepos / depth
 *   auditEnabled(默认 true) / blockOn(默认 'blocker') / llmAudit(默认 false)
 *   llmAuditProvider / llmAuditModel（如 'free' / 'agnes-2.5-flash'）/ maxDiffBytes
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { execSync } from 'node:child_process';
import { scanRepos, commitAndPush, getDiff } from './core.js';
import { auditRepo } from './audit.js';
import { llmAudit } from './llm.js';

export const name = 'dsh-git-push';

export async function apply(ctx, config = {}) {
  const enabled = config.enabled !== false;
  const workspaceRoot = config.workspaceRoot || process.cwd();
  const extraRepos = Array.isArray(config.extraRepos) ? config.extraRepos : [];
  const depth = Number(config.depth) || 3;
  const auditEnabled = config.auditEnabled !== false;
  const blockOn = config.blockOn === 'any' ? 'any' : 'blocker'; // 默认仅拦截严重问题
  const llmAuditOn = config.llmAudit === true;
  const llmAuditProvider = typeof config.llmAuditProvider === 'string' ? config.llmAuditProvider : '';
  const llmAuditModel = typeof config.llmAuditModel === 'string' ? config.llmAuditModel : '';
  const maxDiffBytes = Number(config.maxDiffBytes) || 6000;
  const log = ctx.logger('git-push');

  if (!enabled) {
    log.info('已禁用（config.enabled=false）');
    return;
  }
  log.info(`启动: workspaceRoot=${workspaceRoot} auditEnabled=${auditEnabled} blockOn=${blockOn} llmAudit=${llmAuditOn}`);

  /** 对单个仓库执行审计（L0 必跑 + L1 按开关/参数），返回审计结果。 */
  async function auditRepoPath(repoPath, { forceLlm = false } = {}) {
    const result = auditRepo(repoPath, { blockOn });
    if (!result.ok) return result;
    const withLlm = llmAuditOn || forceLlm;
    if (withLlm && result.findings.filter((f) => f.level === 'blocker').length === 0) {
      const llm = ctx.get?.('llm');
      const diff = getDiff(repoPath);
      const route = llmAuditProvider && llmAuditModel ? { provider: llmAuditProvider, model: llmAuditModel } : null;
      result.llmRoute = route ? `${route.provider}/${route.model}` : null;
      result.llmAvailable = !!llm;
      const llmRes = await llmAudit({
        llm, diff: diff.ok ? diff.diff : '', route,
        maxDiffBytes, sessionId: 'git-push', purpose: 'git-push-audit',
      });
      if (!llmRes.ok) {
        result.llmError = llmRes.error;
      } else if (llmRes.findings.length > 0) {
        result.findings.push(...llmRes.findings);
        result.summary = {
          blocker: result.findings.filter((x) => x.level === 'blocker').length,
          warning: result.findings.filter((x) => x.level === 'warning').length,
          total: result.findings.length,
        };
        result.blocked = blockOn === 'any' ? result.findings.length > 0 : result.summary.blocker > 0;
        result.passed = !result.blocked;
      }
    }
    return result;
  }

  /** 带审计门禁的提交推送：审计未通过（blockOn 命中）→ 拦截不提交。 */
  async function commitWithAudit({ repo, message, push, dryRun, audit, llmAudit: llm }) {
    const wantAudit = audit !== false && auditEnabled;
    if (wantAudit && !dryRun) {
      const auditResult = await auditRepoPath(repo, { forceLlm: !!llm });
      if (auditResult.blocked) {
        return { ok: false, blocked: true, error: `审计未通过，拦截提交（${auditResult.summary.total} 个问题，blockOn=${blockOn}）`, findings: auditResult.findings, summary: auditResult.summary };
      }
      const auditOk = { ok: true, audited: true, blocked: false, findings: auditResult.findings, summary: auditResult.summary, ...(auditResult.llmError ? { llmError: auditResult.llmError } : {}), ...(auditResult.llmRoute ? { llmRoute: auditResult.llmRoute } : {}) };
      const result = commitAndPush({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun });
      return { ...result, audit: auditOk };
    }
    const result = commitAndPush({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun });
    return { ...result, audit: { ok: true, audited: false, note: '审计已关闭或 dryRun' } };
  }

  /* ------------------------------ HTTP API ------------------------------ */

  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx.get('webServer');
    if (!webServer) return;

    const respond = (res, body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body, null, 2));
    };
    const readJson = (req) => new Promise((resolveBody) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        try { resolveBody(JSON.parse(data || '{}')); } catch { resolveBody({}); }
      });
    });

    webServer.register({
      kind: 'prefix',
      path: '/api/git-push',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.local');
          const p = url.pathname;
          const m = req.method ?? 'GET';

          if (p === '/api/git-push/status' && m === 'GET') {
            return respond(res, {
              ok: true, plugin: 'dsh-git-push', version: '1.2.0',
              workspaceRoot, extraRepos, depth,
              audit: { auditEnabled, blockOn, llmAudit: llmAuditOn, llmAuditProvider: llmAuditProvider || '(未配置)', llmAuditModel: llmAuditModel || '(未配置)' },
              git: runGitVersion(),
            });
          }
          if (p === '/api/git-push/scan' && m === 'GET') {
            const repos = scanRepos({ root: workspaceRoot, depth, extraRepos });
            return respond(res, { ok: true, count: repos.length, repos });
          }
          if (p === '/api/git-push/audit' && m === 'GET') {
            const repo = url.searchParams.get('repo');
            const forceLlm = url.searchParams.get('llm') === 'true';
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            const result = await auditRepoPath(repo, { forceLlm });
            return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error } }, result.ok ? 200 : 400);
          }
          if (p === '/api/git-push/commit' && m === 'POST') {
            const body = await readJson(req);
            const { repo, message, push = true, dryRun = false, audit, llmAudit: llm } = body;
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            const result = await commitWithAudit({ repo, message, push, dryRun, audit, llmAudit: llm });
            return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: result.blocked ? 'AUDIT' : 'GIT', message: result.error, step: result.step }, ...(result.blocked ? { findings: result.findings, summary: result.summary } : {}) }, result.ok ? 200 : 400);
          }
          return undefined; // 非本插件路由 → 放行
        } catch (e) {
          return respond(res, { ok: false, error: { code: 'INTERNAL', message: e.message } }, 500);
        }
      },
    });

    log.info('API 路由已注册: /api/git-push/{status,scan,audit,commit}');
  });

  /* ------------------------------ agent 工具 ------------------------------ */

  ctx.inject(['tools'], (tctx) => {
    const tools = tctx.get('tools');
    if (!tools) return;

    tools.register(defineTool({
      name: 'git_scan',
      description: '扫描 DSH workspace 下所有 git 仓库，返回每个仓库的分支/remote/未提交变更数/最近活动。用于查看哪些仓库有未提交或未推送的改动。',
      parameters: {},
      output: { schema: { type: 'string' } },
      execute: async () => {
        const repos = scanRepos({ root: workspaceRoot, depth, extraRepos });
        return JSON.stringify({ count: repos.length, repos }, null, 2);
      },
    }));

    tools.register(defineTool({
      name: 'git_commit_push',
      description: '对指定 git 仓库一键提交并推送：先审计（默认开，L0 静态检查语法/敏感信息/凭据/大文件，发现严重问题拦截），再 git add -A → commit（message 必填）→ push origin <当前分支>。push 前自动 fetch 并检查 ahead/behind，远端领先时不推。repo 传仓库绝对路径（可用 git_scan 查）。audit=false 可关闭审计；llmAudit=true 追加 LLM 深度审查（需配置 llmAuditProvider/Model）。dryRun=true 只模拟不写入。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        message: { type: 'string', description: 'commit message（必填）' },
        push: { type: 'boolean', description: '是否推送，默认 true' },
        dryRun: { type: 'boolean', description: 'dry-run 只模拟，默认 false' },
        audit: { type: 'boolean', description: '提交前审计，默认 true' },
        llmAudit: { type: 'boolean', description: '追加 LLM 深度审查，默认 false' },
      },
      output: { schema: { type: 'string' } },
      execute: async (params) => {
        const result = await commitWithAudit(params);
        return JSON.stringify(result, null, 2);
      },
    }));

    tools.register(defineTool({
      name: 'code_audit',
      description: '对指定 git 仓库执行代码审计（默认 L0 静态检查：语法/JSON/YAML/敏感信息/凭据入库/二进制大文件/debugger 残留）。llm=true 时追加 LLM 深度审查（需配置 llmAuditProvider/Model）。repo 传仓库绝对路径。返回问题清单（blocker 拦截级 / warning 提醒级）与是否通过。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        llm: { type: 'boolean', description: '是否追加 LLM 深度审查，默认 false' },
      },
      output: { schema: { type: 'string' } },
      execute: async ({ repo, llm }) => {
        if (!repo) return JSON.stringify({ ok: false, error: '缺少 repo' }, null, 2);
        const result = await auditRepoPath(repo, { forceLlm: !!llm });
        return JSON.stringify(result, null, 2);
      },
    }));

    log.info('工具已注册: git_scan / git_commit_push / code_audit');
  });
}

function runGitVersion() {
  try {
    return execSync('git --version', { encoding: 'utf8' }).trim();
  } catch {
    return 'git 不可用';
  }
}
