/**
 * dsh-git-push — git 自动提交推送插件 v1.3.0（内置代码审计门禁 + dsh-repo-index 自动维护）
 *
 * 形态：apply 函数 + ctx.inject（同 dsh-skill-forge / dsh-ai-work-archive 实证风格）
 * 触发面：
 *   1. 工具 git_scan         —— 扫描 workspace 全部 git 仓库状态
 *   2. 工具 git_commit_push   —— 一键 commit + push（**推送前审计**，发现问题拦截；推送成功后自动维护 dsh-repo-index）
 *   3. 工具 code_audit        —— 手动审计指定仓库（L0 静态 + 可选 L1 LLM）
 *   4. HTTP API              —— status / scan / commit / audit
 *
 * 审计（v1.1.0 内置，源自 dsh-code-audit 实测验证）：
 *   L0 静态（零 token）：JS 语法 / JSON / YAML / 敏感信息硬编码 / 凭据入库 / npm 包文件入库 / 大文件 / debugger / console
 *   L1 LLM 审查（默认关）：diff 喂便宜模型（如 agnes-2.5-flash / deepseek-chat）找逻辑/安全问题
 *   拦截策略 blockOn：'blocker'（默认，仅严重问题拦截）/ 'any'（严格，任何问题拦截）
 *
 * dsh-repo-index 维护（v1.3.0 新增）：
 *   git_commit_push 推送成功后自动重新生成 dsh-repo-index.md（源码索引 skill）：
 *   仓库清单来自 git remote，「对应 skill」列来自各项目 package.json dsh.skills + skills/*.md，
 *   可见性来自 GitHub API（token）。权威源 = 插件项目 skills/dsh-repo-index.md，
 *   同步副本 = 运行实例用户级 skills 目录（config repoIndexSyncTarget 可指定）。
 *
 * 配置（cordis.patch.yml config）：
 *   enabled / workspaceRoot / extraRepos / depth
 *   auditEnabled(默认 true) / blockOn(默认 'blocker') / llmAudit(默认 false)
 *   llmAuditProvider / llmAuditModel（如 'free' / 'agnes-2.5-flash'）/ maxDiffBytes
 *   repoIndexEnabled(默认 true) / repoIndexTokenPath / repoIndexSyncTarget / repoIndexLocalOnly
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepos, commitAndPush, getDiff } from './core.js';
import { auditRepo } from './audit.js';
import { llmAudit } from './llm.js';
import { buildRepoIndex, syncRepoIndex, detectSkillsDir, parseManualVisibility } from './repo-index.js';

export const name = 'dsh-git-push';

/**
 * 工具输出渲染：dsh-tools（rc.6 起）契约要求 defineTool 的 output.render 必填——
 * 缺省时包装函数调用 undefined 会抛 `userRender is not a function`（工具执行正常但结果无法回显）。
 * 必须返回内容块数组（block.content 落盘校验要求数组，纯字符串会损坏会话日志，见 dsh-session-manager 同款注释）。
 */
function textRender(args, value) {
  return [{ type: 'text', text: String(value) }];
}

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
  const repoIndexEnabled = config.repoIndexEnabled !== false;
  const repoIndexTokenPath = typeof config.repoIndexTokenPath === 'string' ? config.repoIndexTokenPath : '';
  const repoIndexSyncTarget = typeof config.repoIndexSyncTarget === 'string' ? config.repoIndexSyncTarget : '';
  const repoIndexLocalOnly = Array.isArray(config.repoIndexLocalOnly) ? config.repoIndexLocalOnly : [];
  const exemptRepos = Array.isArray(config.exemptRepos) ? config.exemptRepos.map((x) => String(x)) : [];
  const log = ctx.logger('git-push');

  if (!enabled) {
    log.info('已禁用（config.enabled=false）');
    return;
  }
  log.info(`启动: workspaceRoot=${workspaceRoot} auditEnabled=${auditEnabled} blockOn=${blockOn} llmAudit=${llmAuditOn} repoIndex=${repoIndexEnabled}`);

  /** dsh-repo-index 权威源路径（插件项目 skills/，随 git 版本管理） */
  const repoIndexSourcePath = fileURLToPath(new URL('../skills/dsh-repo-index.md', import.meta.url));

  /** 维护 dsh-repo-index：生成索引 → 写权威源 + 同步生效副本。push 成功后由 commitWithAudit 调用。 */
  async function maintainRepoIndex() {
    if (!repoIndexEnabled) return { ok: false, skipped: 'repoIndexEnabled=false' };
    try {
      // 手工可见性基线：从现有生效副本（或权威源）解析，GitHub API 查不到时回退
      let existing = '';
      const syncTarget = repoIndexSyncTarget || join(detectSkillsDir(), 'dsh-repo-index.md');
      for (const p of [syncTarget, repoIndexSourcePath]) {
        try { if (existsSync(p)) { existing = readFileSync(p, 'utf8'); break; } } catch { /* 跳过 */ }
      }
      const manualVisibility = parseManualVisibility(existing);
      const content = await buildRepoIndex({
        workspaceRoot, depth, extraRepos,
        tokenPath: repoIndexTokenPath,
        manualVisibility,
        localOnlyExtra: repoIndexLocalOnly,
      });
      const res = syncRepoIndex({ content, sourcePath: repoIndexSourcePath, syncTarget });
      log.info(`dsh-repo-index 已更新: ${res.written.join(', ') || '无写入'}`);
      return { ok: true, ...res, syncTarget };
    } catch (error) {
      log.warn(`dsh-repo-index 维护失败: ${String(error?.message ?? error)}`);
      return { ok: false, error: String(error?.message ?? error) };
    }
  }

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

  /** 带审计门禁的提交推送：审计未通过（blockOn 命中）→ 拦截不提交。推送成功后自动维护 dsh-repo-index。 */
  async function commitWithAudit({ repo, message, push, dryRun, audit, llmAudit: llm }) {
    const wantAudit = audit !== false && auditEnabled;
    if (wantAudit && !dryRun) {
      const auditResult = await auditRepoPath(repo, { forceLlm: !!llm });
      if (auditResult.blocked) {
        return { ok: false, blocked: true, error: `审计未通过，拦截提交（${auditResult.summary.total} 个问题，blockOn=${blockOn}）`, findings: auditResult.findings, summary: auditResult.summary };
      }
      const auditOk = { ok: true, audited: true, blocked: false, findings: auditResult.findings, summary: auditResult.summary, ...(auditResult.llmError ? { llmError: auditResult.llmError } : {}), ...(auditResult.llmRoute ? { llmRoute: auditResult.llmRoute } : {}) };
      const result = commitAndPush({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun });
      if (result.ok && result.push?.pushed) result.repoIndex = await maintainRepoIndex();
      return { ...result, audit: auditOk };
    }
    const result = commitAndPush({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun });
    if (result.ok && result.push?.pushed) result.repoIndex = await maintainRepoIndex();
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
              ok: true, plugin: 'dsh-git-push', version: '1.4.1',
              workspaceRoot, extraRepos, depth,
              audit: { auditEnabled, blockOn, llmAudit: llmAuditOn, llmAuditProvider: llmAuditProvider || '(未配置)', llmAuditModel: llmAuditModel || '(未配置)' },
              repoIndex: { enabled: repoIndexEnabled, tokenPath: repoIndexTokenPath || '(未配置)', syncTarget: repoIndexSyncTarget || `(探测: ${join(detectSkillsDir(), 'dsh-repo-index.md')})` },
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
      output: { schema: { type: 'string' }, render: textRender },
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
      output: { schema: { type: 'string' }, render: textRender },
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
      output: { schema: { type: 'string' }, render: textRender },
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
