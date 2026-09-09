/**
 * dsh-git-push — HTTP API 路由（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * /api/git-push/*：status/scan/audit/commit/sensitive/gen-readme/rebuild/remote-create/
 * permit/account-check/gen-ssh-key/rules。
 * 非本插件路由返回 undefined 放行。
 *
 * v1.60.0 重构：registerHttpApi 路由分发压回 <100 行，每个路由处理逻辑抽成独立具名
 * handler（handleCommit/...），每个 handler 经 deps 显式接收运行期共享依赖
 * （env 同一对象引用 + respond/readJson + auditRepoPath/commitWithAudit/fullScan），
 * 环境字段从 env 引用读取保持设置页 watch 即时生效语义，路由/方法/参数/响应格式零变化。
 */
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { scanRepos, genReadme, rebuildHistory, previewRebuildHistory, ensureRemoteRepo, credentialsDir, checkGithubAccount, formatGithubAccountBlock, generateSshKey, persistSshPub, scanSensitiveFiles } from './core.js';
import { getAuditRuleset } from './audit.js';
import { exportCommentWordingRules, fetchCommentWordingRules, parseCommentWordingRules, saveCommentWordingRulesFile } from './rules.js';
import { readPermit, setPermit } from './permit.js';
import { __VERSION__ } from './plugin-config.js';

function runGitVersion() {
  try {
    return execSync('git --version', { encoding: 'utf8' }).trim();
  } catch {
    return 'git 不可用';
  }
}

/**
 * 公共响应/请求体工具（构造一次，随 deps 传递）：
 * respond(res, body, status) 写 JSON；readJson(req) 读请求体（5MB 上限，超限 413 语义）。
 */
function buildHttpTools() {
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
  return { respond, readJson };
}

/** GET /api/git-push/permit/status — 推送许可状态。 */
function handlePermitStatus(req, res, deps) {
  const { respond, env } = deps;
  const state = readPermit(env.workspaceRoot);
  return respond(res, {
    ok: true, plugin: 'dsh-git-push', version: __VERSION__,
    pushOnComplete: state.pushOnComplete,
    pushScope: state.pushScope,
    commitMessage: env.permitCommitMessage,
    lastAttempt: state.lastAttempt ?? null,
    lastAutoPush: state.lastAutoPush ?? null,
  });
}

/** POST /api/git-push/permit/config — 更新推送许可。 */
async function handlePermitConfig(req, res, m, deps) {
  const { respond, readJson, env } = deps;
  const body = await readJson(req);
  if (typeof body.pushOnComplete !== 'boolean') {
    return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 pushOnComplete（boolean）' } }, 400);
  }
  const result = setPermit(env.workspaceRoot, body.pushOnComplete, { pushScope: body.pushScope });
  if (!result.ok) return respond(res, { ok: false, error: { code: 'IO', message: result.error } }, 500);
  return respond(res, { ok: true, pushOnComplete: result.state.pushOnComplete, pushScope: result.state.pushScope, note: '推送许可已更新' });
}

/** GET|POST /api/git-push/account-check — GitHub 账号连通性检查。 */
async function handleAccountCheck(req, res, m, deps) {
  const { respond, readJson, env } = deps;
  const body = m === 'POST' ? await readJson(req) : {};
  const draft = String(body.githubToken || '').trim();
  const draftPub = String(body.sshPub || '').trim();
  if (draftPub) persistSshPub(draftPub, { workspaceRoot: env.workspaceRoot });
  const result = await checkGithubAccount({ workspaceRoot: env.workspaceRoot, token: draft });
  result.block = formatGithubAccountBlock(result);
  return respond(res, result);
}

/** POST /api/git-push/gen-ssh-key — 按邮箱生成 SSH 密钥对（v1.29.0 需求①）。 */
async function handleGenSshKey(req, res, m, deps) {
  const { respond, readJson, env } = deps;
  const body = await readJson(req);
  const email = String(body.email || '').trim();
  const force = body.force === true;
  const r = generateSshKey(email, { workspaceRoot: env.workspaceRoot, force });
  if (!r.ok) return respond(res, { ok: false, error: { code: 'SSH_KEY', message: r.error } }, 400);
  // 公钥整行回传（不回传私钥路径外的敏感内容；私钥永不离开本机）
  return respond(res, { ok: true, email: r.email, privateKey: r.privateKey, pubFile: r.pubFile, pub: r.pub, note: '公钥已写入插件配置目录 *.pub，可复制粘贴到 GitHub → Settings → SSH and GPG keys' });
}

/** GET /api/git-push/status — 全量运行状态俯瞰。 */
function handleStatus(req, res, deps) {
  const { respond, env } = deps;
  return respond(res, {
    ok: true, plugin: 'dsh-git-push', version: __VERSION__,
    workspaceRoot: env.workspaceRoot, extraRepos: env.extraRepos, extraReposFile: env.extraReposFile || '(未配置)', depth: env.depth,
    audit: { auditEnabled: env.auditEnabled, blockOn: env.blockOn, llmAudit: env.llmAuditOn, llmAuditProvider: env.llmAuditProvider || '(未配置)', llmAuditModel: env.llmAuditModel || '(未配置)', exemptRepos: env.exemptRepos, hardcodeFullScan: env.hardcodeFullScan },
    ruleset: (() => { const r = getAuditRuleset(); return { name: r.meta.name, owner: r.meta.owner, version: r.meta.version, source: r.meta.source, loadErrors: r.errors?.length ? r.errors : undefined }; })(),
    commentWording: { enabled: env.commentWordingEnabled, source: env.commentWordingSource, count: env.commentWordingRules.length, rulesFile: env.commentWordingRulesFile || '(未配置)', error: env.commentWordingError || undefined },
    repoIndex: { enabled: env.repoIndexEnabled, tokenPath: env.repoIndexTokenPath || '(未配置)', syncTarget: env.repoIndexSyncTarget || `(自动: ${join(credentialsDir({ workspaceRoot: env.workspaceRoot }), 'dsh-repo-index.json')})`, injectFull: env.injectRepoIndexFull },
    git: runGitVersion(),
  });
}

/** GET /api/git-push/rules — 读取 comment-wording 规则（含 export）。 */
function handleRulesGet(req, res, url, deps) {
  const { respond, env } = deps;
  const qTarget = url.searchParams.get('target') || '';
  if (qTarget === 'export') {
    const exported = exportCommentWordingRules(env.commentWordingRules);
    return respond(res, { ok: true, exported, source: env.commentWordingSource, count: env.commentWordingRules.length });
  }
  return respond(res, { ok: true, source: env.commentWordingSource, count: env.commentWordingRules.length, rules: env.commentWordingRules, enabled: env.commentWordingEnabled, error: env.commentWordingError || undefined });
}

/** POST /api/git-push/rules — 导入 comment-wording 规则（url/json → 落盘 → 写回 env 即时生效）。 */
async function handleRulesPost(req, res, m, deps) {
  const { respond, readJson, env } = deps;
  const body = await readJson(req);
  const targetFile = String(body.targetFile || join(env.workspaceRoot, 'data', 'comment-wording-rules.json'));
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

/** GET /api/git-push/scan — 扫描仓库（自由 root/paths/extraReposFile 覆盖）。 */
function handleScan(req, res, url, deps) {
  const { respond, env } = deps;
  // 自由配置：root 覆盖扫描根、paths 临时追加仓库（逗号分隔）、extraReposFile 指定配置文件（实时读取）
  const qRoot = url.searchParams.get('root');
  const qPaths = (url.searchParams.get('paths') || '').split(',').map((x) => x.trim()).filter(Boolean);
  const qFile = url.searchParams.get('extraReposFile');
  const repos = scanRepos({ root: qRoot || env.workspaceRoot, depth: env.depth, extraRepos: [...env.extraRepos, ...qPaths], extraReposFile: qFile || env.extraReposFile });
  return respond(res, { ok: true, count: repos.length, root: qRoot || env.workspaceRoot, paths: qPaths, extraReposFile: qFile || env.extraReposFile, repos });
}

/** GET /api/git-push/audit — 代码审计。 */
async function handleAudit(req, res, url, deps) {
  const { respond, auditRepoPath } = deps;
  const repo = url.searchParams.get('repo');
  const forceLlm = url.searchParams.get('llm') === 'true';
  const qRuleset = url.searchParams.get('ruleset') || '';
  if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
  const result = await auditRepoPath(repo, { forceLlm, ruleset: qRuleset || undefined });
  return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error } }, result.ok ? 200 : 400);
}

/** GET /api/git-push/full-scan — 全仓 AI 对话残留注释扫描（v1.43.0 附属能力）。 */
async function handleFullScan(req, res, url, deps) {
  const { respond, fullScan } = deps;
  const repo = url.searchParams.get('repo');
  const qRuleset = url.searchParams.get('ruleset') || '';
  if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
  if (typeof fullScan !== 'function') return respond(res, { ok: false, error: { code: 'UNAVAILABLE', message: 'fullScan 服务未就绪' } }, 503);
  const result = await fullScan(repo, { ruleset: qRuleset || undefined });
  return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'SCAN', message: result.error } }, result.ok ? 200 : 400);
}

/** GET /api/git-push/sensitive — 敏感文件扫描。 */
function handleSensitive(req, res, url, deps) {
  const { respond } = deps;
  const repo = url.searchParams.get('repo');
  if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
  const hits = scanSensitiveFiles(repo);
  return respond(res, { ok: true, count: hits.length, hits });
}

/** GET /api/git-push/gen-readme — 按模板生成 README。 */
function handleGenReadme(req, res, url, deps) {
  const { respond, env } = deps;
  const repo = url.searchParams.get('repo');
  const writePath = url.searchParams.get('write') || undefined;
  if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
  const result = genReadme({ repoPath: repo, writePath, workspaceRoot: env.workspaceRoot });
  return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error } }, result.ok ? 200 : 400);
}

/** POST /api/git-push/rebuild — 重建 git 历史（dryRun 预览 / 实际执行）。 */
async function handleRebuild(req, res, m, deps) {
  const { respond, readJson, env } = deps;
  const body = await readJson(req);
  const { repo, mode, dryRun = false, dropFrom, dropTo, force = false } = body;
  if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
  if (dryRun) {
    const result = previewRebuildHistory({ repoPath: repo, mode, dropFrom, dropTo });
    return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error } }, result.ok ? 200 : 400);
  }
  const result = await rebuildHistory({ repoPath: repo, mode, dryRun, dropFrom, dropTo, force, workspaceRoot: env.workspaceRoot });
  return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: 'GIT', message: result.error } }, result.ok ? 200 : 400);
}

/** GET|POST /api/git-push/remote-create — 按项目文件夹创建远程仓库。 */
async function handleRemoteCreate(req, res, m, url, deps) {
  const { respond, readJson, env } = deps;
  const body = m === 'POST' ? await readJson(req) : {};
  const repo = m === 'POST' ? (body.repo || url.searchParams.get('repo')) : url.searchParams.get('repo');
  const dryRun = m === 'POST' ? !!body.dryRun : url.searchParams.get('dryRun') === 'true';
  const visibility = m === 'POST' ? (body.visibility || 'private') : (url.searchParams.get('visibility') || 'private');
  if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
  const result = await ensureRemoteRepo({ repoPath: repo, visibility, dryRun, workspaceRoot: env.workspaceRoot });
  return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: result.error }, result.ok ? 200 : 400);
}

/** POST /api/git-push/commit — 提交并推送（走审计门禁）。 */
async function handleCommit(req, res, m, deps) {
  const { respond, readJson, env, commitWithAudit } = deps;
  const body = await readJson(req);
  const { repo, message, push = true, dryRun = false, audit, llmAudit: llm } = body;
  if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
  const result = await commitWithAudit({ repo, message, push, dryRun, audit, llmAudit: llm, customIgnorePatterns: env.customIgnorePatterns });
  return respond(res, result.ok ? { ok: true, ...result } : { ok: false, error: { code: result.blocked ? 'AUDIT' : 'GIT', message: result.error, step: result.step }, ...(result.blocked ? { findings: result.findings, summary: result.summary } : {}) }, result.ok ? 200 : 400);
}

/** 注册 HTTP API（webServer 服务存在时）。 */
export function registerHttpApi(ctx, env, { auditRepoPath, commitWithAudit, fullScan }) {
  const { log } = env;
  const { respond, readJson } = buildHttpTools();
  const deps = { env, respond, readJson, auditRepoPath, commitWithAudit, fullScan };

  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx.get('webServer');
    if (!webServer) return;

    webServer.register({
      kind: 'prefix',
      path: '/api/git-push',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.local');
          const p = url.pathname;
          const m = req.method ?? 'GET';

          if (p === '/api/git-push/permit/status' && m === 'GET') return handlePermitStatus(req, res, deps);
          if (p === '/api/git-push/permit/config' && m === 'POST') return handlePermitConfig(req, res, m, deps);
          if (p === '/api/git-push/account-check' && (m === 'GET' || m === 'POST')) return handleAccountCheck(req, res, m, deps);
          // v1.29.0 需求①：按邮箱生成 SSH 密钥对（ssh-keygen -t rsa -b 4096 -C email）
          if (p === '/api/git-push/gen-ssh-key' && m === 'POST') return handleGenSshKey(req, res, m, deps);
          if (p === '/api/git-push/status' && m === 'GET') return handleStatus(req, res, deps);
          if (p === '/api/git-push/rules' && m === 'GET') return handleRulesGet(req, res, url, deps);
          if (p === '/api/git-push/rules' && m === 'POST') return handleRulesPost(req, res, m, deps);
          if (p === '/api/git-push/scan' && m === 'GET') return handleScan(req, res, url, deps);
          if (p === '/api/git-push/audit' && m === 'GET') return handleAudit(req, res, url, deps);
          // v1.43.0：全仓 AI 对话残留注释扫描（附属能力）——GET /api/git-push/full-scan?repo=&ruleset=
          if (p === '/api/git-push/full-scan' && m === 'GET') return handleFullScan(req, res, url, deps);
          if (p === '/api/git-push/sensitive' && m === 'GET') return handleSensitive(req, res, url, deps);
          if (p === '/api/git-push/gen-readme' && m === 'GET') return handleGenReadme(req, res, url, deps);
          if (p === '/api/git-push/rebuild' && m === 'POST') return handleRebuild(req, res, m, deps);
          if (p === '/api/git-push/remote-create' && (m === 'POST' || m === 'GET')) return handleRemoteCreate(req, res, m, url, deps);
          if (p === '/api/git-push/commit' && m === 'POST') return handleCommit(req, res, m, deps);

          return undefined; // 非本插件路由 → 放行
        } catch (e) {
          return respond(res, { ok: false, error: { code: 'INTERNAL', message: e.message } }, 500);
        }
      },
    });

    log.info('API 路由已注册: /api/git-push/{status,scan,audit,commit,sensitive,gen-readme,rebuild}');
  });
}