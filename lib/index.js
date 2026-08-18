/**
 * dsh-git-push — git 自动提交推送插件（纯服务端，无 client bundle）
 *
 * 形态：apply 函数 + ctx.inject（同 dsh-skill-forge / dsh-ai-work-archive 实证风格）
 * 触发面：
 *   1. 工具 git_scan       —— agent 推理中调用，扫描 workspace 全部 git 仓库状态
 *   2. 工具 git_commit_push —— agent 推理中调用，一键 commit + push（自动识别分支、push 前检查）
 *   3. HTTP API            —— curl 可验证：status / scan / commit
 *
 * 配置（cordis.patch.yml config）：
 *   enabled:      true|false
 *   workspaceRoot: 扫描根目录（默认 process.cwd()）
 *   extraRepos:    额外仓库绝对路径数组（find 范围外的，如只读卷）
 *   depth:         find 深度（默认 3）
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { execSync } from 'node:child_process';
import { scanRepos, commitAndPush } from './core.js';

export const name = 'dsh-git-push';

export async function apply(ctx, config = {}) {
  const enabled = config.enabled !== false;
  const workspaceRoot = config.workspaceRoot || process.cwd();
  const extraRepos = Array.isArray(config.extraRepos) ? config.extraRepos : [];
  const depth = Number(config.depth) || 3;
  const log = ctx.logger('git-push');

  if (!enabled) {
    log.info('已禁用（config.enabled=false）');
    return;
  }
  log.info(`启动: workspaceRoot=${workspaceRoot} extraRepos=${extraRepos.length} depth=${depth}`);

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
              ok: true, plugin: 'dsh-git-push', workspaceRoot, extraRepos, depth,
              git: runGitVersion(),
            });
          }
          if (p === '/api/git-push/scan' && m === 'GET') {
            const repos = scanRepos({ root: workspaceRoot, depth, extraRepos });
            return respond(res, { ok: true, count: repos.length, repos });
          }
          if (p === '/api/git-push/commit' && m === 'POST') {
            const body = await readJson(req);
            const { repo, message, push = true, dryRun = false } = body;
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            const result = commitAndPush({ repoPath: repo, message, push, dryRun });
            return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error, step: result.step } }, result.ok ? 200 : 400);
          }
          return undefined; // 非本插件路由 → 放行
        } catch (e) {
          return respond(res, { ok: false, error: { code: 'INTERNAL', message: e.message } }, 500);
        }
      },
    });

    log.info('API 路由已注册: /api/git-push/{status,scan,commit}');
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
      description: '对指定 git 仓库一键提交并推送：git add -A → commit（message 必填）→ push origin <当前分支>。push 前自动 fetch 并检查 ahead/behind，远端领先时不推。repo 传仓库绝对路径（可用 git_scan 查）。dryRun=true 只模拟不写入。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        message: { type: 'string', description: 'commit message（必填）' },
        push: { type: 'boolean', description: '是否推送，默认 true' },
        dryRun: { type: 'boolean', description: 'dry-run 只模拟，默认 false' },
      },
      output: { schema: { type: 'string' } },
      execute: async ({ repo, message, push, dryRun }) => {
        const result = commitAndPush({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun });
        return JSON.stringify(result, null, 2);
      },
    }));

    log.info('工具已注册: git_scan / git_commit_push');
  });
}

function runGitVersion() {
  try {
    return execSync('git --version', { encoding: 'utf8' }).trim();
  } catch {
    return 'git 不可用';
  }
}
