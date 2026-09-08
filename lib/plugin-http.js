/**
 * dsh-git-push — HTTP API 路由（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * /git-push/viewer：提交历史查看器页面；/api/git-push/*：status/scan/audit/commit/sensitive/
 * gen-readme/rebuild/remote-create/permit/account-check/gen-ssh-key/rules/diff/commits/repos。
 * 非本插件路由返回 undefined 放行。
 */
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { scanRepos, genReadme, rebuildHistory, previewRebuildHistory, ensureRemoteRepo, credentialsDir, checkGithubAccount, formatGithubAccountBlock, generateSshKey, persistSshPub, scanSensitiveFiles } from './core.js';
import { getAuditRuleset } from './audit.js';
import { exportCommentWordingRules, fetchCommentWordingRules, parseCommentWordingRules, saveCommentWordingRulesFile } from './rules.js';
import { resolveViewerRepo, getCommitHistory, getCommitDiff, renderViewerPage } from './viewer.js';
import { readPermit, setPermit } from './permit.js';
import { __VERSION__ } from './plugin-config.js';

function runGitVersion() {
  try {
    return execSync('git --version', { encoding: 'utf8' }).trim();
  } catch {
    return 'git 不可用';
  }
}

/** 注册 HTTP API（webServer 服务存在时）。 */
export function registerHttpApi(ctx, env, { auditRepoPath, commitWithAudit }) {
  const { log, workspaceRoot, depth, extraRepos, extraReposFile, permitCommitMessage } = env;

  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx.get('webServer');
    if (!webServer) return;

    const respond = (res, body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body, null, 2));
    };
    const readJson = (req) => new Promise((resolveBody) => {
      // v1.40.0（A5）：请求体 5MB 上限——超限 413 拒绝，防恶意大 body 打爆内存
      let data = '';
      let over = false;
      req.on('data', (c) => {
        data += c;
        if (data.length > 5 * 1024 * 1024) {
          over = true;
          data = '';
          try { req.destroy(); } catch { /* 已断开 */ }
          resolveBody({ __httpError: '请求体超过 5MB 上限' });
        }
      });
      req.on('end', () => {
        if (over) return;
        try { resolveBody(JSON.parse(data || '{}')); } catch { resolveBody({}); }
      });
    });

    webServer.register({
      kind: 'exact',
      path: '/git-push/viewer',
      handler: (req, res) => {
        if ((req.method ?? 'GET') !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Method Not Allowed');
          return;
        }
        const page = renderViewerPage({
          workspaceRoot, depth, extraRepos, extraReposFile, version: __VERSION__,
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page);
      },
    });

    webServer.register({
      kind: 'prefix',
      path: '/api/git-push',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.local');
          const p = url.pathname;
          const m = req.method ?? 'GET';

          // v1.24.0 提交历史查看器（只读，整合 git-commits-viewer）：
          // repos → 扫描仓库；commits → 提交历史；diff → 单文件 diff。无任何写操作。
          if (p === '/api/git-push/repos' && m === 'GET') {
            const qRoot = url.searchParams.get('root');
            const qPaths = (url.searchParams.get('paths') || '').split(',').map((x) => x.trim()).filter(Boolean);
            const qFile = url.searchParams.get('extraReposFile');
            const repos = scanRepos({ root: qRoot || workspaceRoot, depth, extraRepos: [...extraRepos, ...qPaths], extraReposFile: qFile || extraReposFile });
            return respond(res, { ok: true, count: repos.length, root: qRoot || workspaceRoot, repos });
          }
          if (p === '/api/git-push/commits' && m === 'GET') {
            const repoParam = url.searchParams.get('repo');
            if (!repoParam) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径或名称）' } }, 400);
            const repoPath = resolveViewerRepo(repoParam, { root: workspaceRoot, depth, extraRepos, extraReposFile });
            if (!repoPath) return respond(res, { ok: false, error: { code: 'PARAM', message: '仓库不在扫描范围内: ' + repoParam } }, 404);
            const limit = Number(url.searchParams.get('limit')) || 100;
            const commits = getCommitHistory(repoPath, limit);
            return respond(res, { ok: true, repo: repoPath, count: commits.length, commits });
          }
          if (p === '/api/git-push/diff' && m === 'GET') {
            const repoParam = url.searchParams.get('repo');
            const commitId = url.searchParams.get('commit') || '';
            const filename = url.searchParams.get('file') || '';
            if (!repoParam || !commitId || !filename) {
              return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo/commit/file 参数' } }, 400);
            }
            const repoPath = resolveViewerRepo(repoParam, { root: workspaceRoot, depth, extraRepos, extraReposFile });
            if (!repoPath) return respond(res, { ok: false, error: { code: 'PARAM', message: '仓库不在扫描范围内: ' + repoParam } }, 404);
            const result = getCommitDiff(repoPath, commitId, filename);
            if (!result.ok) return respond(res, { ok: false, error: { code: 'GIT', message: result.error } }, 400);
            return respond(res, { ok: true, repo: repoPath, commit: commitId, file: filename, parsed: result.parsed });
          }

          if (p === '/api/git-push/permit/status' && m === 'GET') {
            const state = readPermit(workspaceRoot);
            return respond(res, {
              ok: true, plugin: 'dsh-git-push', version: __VERSION__,
              pushOnComplete: state.pushOnComplete,
              pushScope: state.pushScope,
              commitMessage: permitCommitMessage,
              lastAttempt: state.lastAttempt ?? null,
              lastAutoPush: state.lastAutoPush ?? null,
            });
          }
          if (p === '/api/git-push/permit/config' && m === 'POST') {
            const body = await readJson(req);
            if (typeof body.pushOnComplete !== 'boolean') {
              return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 pushOnComplete（boolean）' } }, 400);
            }
            const result = setPermit(workspaceRoot, body.pushOnComplete, { pushScope: body.pushScope });
            if (!result.ok) return respond(res, { ok: false, error: { code: 'IO', message: result.error } }, 500);
            return respond(res, { ok: true, pushOnComplete: result.state.pushOnComplete, pushScope: result.state.pushScope, note: '推送许可已更新' });
          }
          if (p === '/api/git-push/account-check' && (m === 'GET' || m === 'POST')) {
            const body = m === 'POST' ? await readJson(req) : {};
            const draft = String(body.githubToken || '').trim();
            const draftPub = String(body.sshPub || '').trim();
            if (draftPub) persistSshPub(draftPub, { workspaceRoot });
            const result = await checkGithubAccount({ workspaceRoot, token: draft });
            result.block = formatGithubAccountBlock(result);
            return respond(res, result);
          }
          // v1.29.0 需求①：按邮箱生成 SSH 密钥对（ssh-keygen -t rsa -b 4096 -C email）
          if (p === '/api/git-push/gen-ssh-key' && m === 'POST') {
            const body = await readJson(req);
            const email = String(body.email || '').trim();
            const force = body.force === true;
            const r = generateSshKey(email, { workspaceRoot, force });
            if (!r.ok) return respond(res, { ok: false, error: { code: 'SSH_KEY', message: r.error } }, 400);
            // 公钥整行回传（不回传私钥路径外的敏感内容；私钥永不离开本机）
            return respond(res, { ok: true, email: r.email, privateKey: r.privateKey, pubFile: r.pubFile, pub: r.pub, note: '公钥已写入插件配置目录 *.pub，可复制粘贴到 GitHub → Settings → SSH and GPG keys' });
          }
          if (p === '/api/git-push/status' && m === 'GET') {
            return respond(res, {
              ok: true, plugin: 'dsh-git-push', version: __VERSION__,
              workspaceRoot, extraRepos, extraReposFile: extraReposFile || '(未配置)', depth,
              audit: { auditEnabled: env.auditEnabled, blockOn: env.blockOn, llmAudit: env.llmAuditOn, llmAuditProvider: env.llmAuditProvider || '(未配置)', llmAuditModel: env.llmAuditModel || '(未配置)', exemptRepos: env.exemptRepos, hardcodeFullScan: env.hardcodeFullScan },
              ruleset: (() => { const r = getAuditRuleset(); return { name: r.meta.name, owner: r.meta.owner, version: r.meta.version, source: r.meta.source, loadErrors: r.errors?.length ? r.errors : undefined }; })(),
              commentWording: { enabled: env.commentWordingEnabled, source: env.commentWordingSource, count: env.commentWordingRules.length, rulesFile: env.commentWordingRulesFile || '(未配置)', error: env.commentWordingError || undefined },
              repoIndex: { enabled: env.repoIndexEnabled, tokenPath: env.repoIndexTokenPath || '(未配置)', syncTarget: env.repoIndexSyncTarget || `(自动: ${join(credentialsDir({ workspaceRoot }), 'dsh-repo-index.json')})`, injectFull: env.injectRepoIndexFull },
              git: runGitVersion(),
            });
          }
          if (p === '/api/git-push/rules' && m === 'GET') {
            const qTarget = url.searchParams.get('target') || '';
            if (qTarget === 'export') {
              const exported = exportCommentWordingRules(env.commentWordingRules);
              return respond(res, { ok: true, exported, source: env.commentWordingSource, count: env.commentWordingRules.length });
            }
            return respond(res, { ok: true, source: env.commentWordingSource, count: env.commentWordingRules.length, rules: env.commentWordingRules, enabled: env.commentWordingEnabled, error: env.commentWordingError || undefined });
          }
          if (p === '/api/git-push/rules' && m === 'POST') {
            const body = await readJson(req);
            const targetFile = String(body.targetFile || join(workspaceRoot, 'data', 'comment-wording-rules.json'));
            let parsed = null;
            let sourceDesc = '';
            if (typeof body.url === 'string' && body.url.trim()) {
              const fetched = await fetchCommentWordingRules(body.url.trim());
              if (!fetched.ok) return respond(res, { ok: false, error: `在线规则拉取失败: ${fetched.error}` });
              parsed = fetched.rules;
              sourceDesc = 'url(' + body.url.trim() + ')';
            } else if (typeof body.json === 'string' && body.json.trim()) {
              const r = parseCommentWordingRules(body.json);
              if (!r.ok) return respond(res, { ok: false, error: r.error });
              parsed = r.rules;
              sourceDesc = 'json';
            } else {
              return respond(res, { ok: false, error: '缺少 json 或 url' });
            }
            const saved = saveCommentWordingRulesFile(parsed, targetFile);
            if (!saved.ok) return respond(res, { ok: false, error: saved.error });
            env.commentWordingRules = parsed;
            env.commentWordingSource = 'import(' + sourceDesc + ')';
            env.commentWordingError = '';
            return respond(res, { ok: true, count: parsed.length, source: env.commentWordingSource, targetFile, rules: parsed });
          }
          if (p === '/api/git-push/scan' && m === 'GET') {
            // 自由配置：root 覆盖扫描根、paths 临时追加仓库（逗号分隔）、extraReposFile 指定配置文件（实时读取）
            const qRoot = url.searchParams.get('root');
            const qPaths = (url.searchParams.get('paths') || '').split(',').map((x) => x.trim()).filter(Boolean);
            const qFile = url.searchParams.get('extraReposFile');
            const repos = scanRepos({ root: qRoot || workspaceRoot, depth, extraRepos: [...extraRepos, ...qPaths], extraReposFile: qFile || extraReposFile });
            return respond(res, { ok: true, count: repos.length, root: qRoot || workspaceRoot, paths: qPaths, extraReposFile: qFile || extraReposFile, repos });
          }
          if (p === '/api/git-push/audit' && m === 'GET') {
            const repo = url.searchParams.get('repo');
            const forceLlm = url.searchParams.get('llm') === 'true';
            const qRuleset = url.searchParams.get('ruleset') || '';
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            const result = await auditRepoPath(repo, { forceLlm, ruleset: qRuleset || undefined });
            return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error } }, result.ok ? 200 : 400);
          }
          if (p === '/api/git-push/sensitive' && m === 'GET') {
            const repo = url.searchParams.get('repo');
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            const hits = scanSensitiveFiles(repo);
            return respond(res, { ok: true, count: hits.length, hits });
          }
          if (p === '/api/git-push/gen-readme' && m === 'GET') {
            const repo = url.searchParams.get('repo');
            const writePath = url.searchParams.get('write') || undefined;
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            const result = genReadme({ repoPath: repo, writePath, workspaceRoot });
            return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error } }, result.ok ? 200 : 400);
          }
          if (p === '/api/git-push/rebuild' && m === 'POST') {
            const body = await readJson(req);
            const { repo, mode, dryRun = false, dropFrom, dropTo, force = false } = body;
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            if (dryRun) {
              const result = previewRebuildHistory({ repoPath: repo, mode, dropFrom, dropTo });
              return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error } }, result.ok ? 200 : 400);
            }
            const result = await rebuildHistory({ repoPath: repo, mode, dryRun, dropFrom, dropTo, force, workspaceRoot });
            return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error } }, result.ok ? 200 : 400);
          }
          if (p === '/api/git-push/remote-create' && (m === 'POST' || m === 'GET')) {
            const body = m === 'POST' ? await readJson(req) : {};
            const repo = m === 'POST' ? (body.repo || url.searchParams.get('repo')) : url.searchParams.get('repo');
            const dryRun = m === 'POST' ? !!body.dryRun : url.searchParams.get('dryRun') === 'true';
            const visibility = m === 'POST' ? (body.visibility || 'private') : (url.searchParams.get('visibility') || 'private');
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            const result = await ensureRemoteRepo({ repoPath: repo, visibility, dryRun, workspaceRoot });
            return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: result.error }, result.ok ? 200 : 400);
          }
          if (p === '/api/git-push/commit' && m === 'POST') {
            const body = await readJson(req);
            const { repo, message, push = true, dryRun = false, audit, llmAudit: llm } = body;
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            const result = await commitWithAudit({ repo, message, push, dryRun, audit, llmAudit: llm, customIgnorePatterns: env.customIgnorePatterns });
            return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: result.blocked ? 'AUDIT' : 'GIT', message: result.error, step: result.step }, ...(result.blocked ? { findings: result.findings, summary: result.summary } : {}) }, result.ok ? 200 : 400);
          }
          return undefined; // 非本插件路由 → 放行
        } catch (e) {
          return respond(res, { ok: false, error: { code: 'INTERNAL', message: e.message } }, 500);
        }
      },
    });

    log.info('API 路由已注册: /api/git-push/{status,scan,audit,commit,sensitive,gen-readme,rebuild}');
  });
}
