/**
 * dsh-git-push — git 自动提交推送插件 v1.6.0（内置代码审计门禁 + dsh-repo-index 自动维护）
 *
 * 形态：apply 函数 + ctx.inject（同 dsh-skill-forge / dsh-ai-work-archive 实证风格）
 * 触发面：
 *   1. 工具 git_scan         —— 扫描 workspace 全部 git 仓库状态
 *   2. 工具 git_commit_push   —— 一键 commit + push（**推送前审计**，发现问题拦截；推送成功后自动维护 dsh-repo-index）
 *   3. 工具 code_audit        —— 手动审计指定仓库（L0 静态 + 可选 L1 LLM）
 *   4. HTTP API              —— status / scan / commit / audit
 *
 * 审计（v1.1.0 内置，源自 dsh-code-audit 实测验证）： *   L0 静态（零 token）：JS 语法 / JSON / YAML / 敏感信息硬编码 / 凭据入库 / npm 包文件入库 / 大文件 / debugger / console
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
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { scanRepos, readExtraReposFile, commitAndPush, getDiff, scanSensitiveFiles, ensureSensitiveIgnored, genReadme, rebuildHistory, previewRebuildHistory, listVersionCommits, resolveGitToken, ensureRemoteRepo, loadUserRequirements, cloneViaApi, detectRepoVisibility, setRepoVisibility, ensureUserRepoSibling, USER_REPO_NAME, ensureGlobalFilemodeFalse, persistGithubToken, persistSshPub, githubTokenStatus, formatRemoteHeadsTable, checkGithubAccount, formatGithubAccountBlock, collectRepoSkillDocs, formatRepoSkillInjection } from './core.js';
import { auditRepo } from './audit.js';
import { llmAudit } from './llm.js';
import { buildRepoIndex, syncRepoIndex, detectSkillsDir, parseManualVisibility } from './repo-index.js';

const __VERSION__ = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const name = 'dsh-git-push';

/** 设置页命名空间：设置 → 插件 → 插件配置 卡片 key，须与客户端 settings.plugin.item 一致。 */
export const GIT_PUSH_SETTINGS_NS = 'git-push';

export const Config = z.object({
  githubToken: z.string().role('secret'),
  sshPub: z.string(),
  tokenConfigured: z.boolean().default(false),
});

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
  const extraReposFile = typeof config.extraReposFile === 'string' ? config.extraReposFile : '';
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

  // 设置 → 插件 → 插件配置：填写 GitHub token，落到同级仓 github-token（不进 settings.yaml 明文）
  // 用户原话：「插件配置填写凭据，入口在设置里面」
  ctx.inject(['settings'], (settingsCtx) => {
    const tok = githubTokenStatus({ workspaceRoot });
    const entry = { githubToken: '', sshPub: '', tokenConfigured: tok.configured };
    const scope = settingsCtx.settings.register(GIT_PUSH_SETTINGS_NS, Config, { base: entry });
    scope.watch(async (next) => {
      const raw = String(next?.githubToken || '').trim();
      const pub = String(next?.sshPub || '').trim();
      let wrote = false;
      if (raw) {
        const saved = persistGithubToken(raw, { workspaceRoot });
        if (!saved.ok) log.warn(`GitHub token 写入失败: ${saved.error}`);
        else { log.info(`GitHub token 已写入 ${saved.source}`); wrote = true; }
      }
      if (pub) {
        const savedPub = persistSshPub(pub, { workspaceRoot });
        if (!savedPub.ok) log.warn(`SSH 公钥写入失败: ${savedPub.error}`);
        else { log.info(`SSH 公钥已写入 ${savedPub.source}`); wrote = true; }
      }
      if (!wrote) return;
      try {
        await scope.replace({ tokenConfigured: tok.configured || !!raw, sshPub: '' });
      } catch (e) {
        log.warn(`清掉 settings 里的凭据明文失败: ${e?.message || e}`);
      }
    });
  });

  if (!enabled) {
    log.info('已禁用（config.enabled=false）');
    return;
  }
  log.info(`启动: workspaceRoot=${workspaceRoot} auditEnabled=${auditEnabled} blockOn=${blockOn} llmAudit=${llmAuditOn} repoIndex=${repoIndexEnabled}`);

  // 强制读取两仓 skill：agent/pre-step 注入正文（方案 A，不改 packages/ 框架）。
  // 用户原话：「按照 dsh-skill-mandatory.md 写代码」「不通过 skill 文件软强制」
  // 每个 agent 只注入一次，避免每步重复烧 token。
  const injectedAgents = new WeakSet();
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    if (signal?.aborted) return decision;
    if (injectedAgents.has(agent)) return decision;
    const files = collectRepoSkillDocs({ workspaceRoot });
    const text = formatRepoSkillInjection(files);
    injectedAgents.add(agent);
    if (!text) return decision;
    log.info(`已注入两仓 skill ${files.length} 篇`);
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'instructions' },
        }),
      ],
    };
  });

  // v1.18.4：启动时 git config --global core.filemode false
  // 用户原话：「新功能gitpush插件会git config --global core.filemode false」
  // AI 思路：CIFS 可执行位噪声；全局写一次给裸 git；失败不阻断启动（runGit 仍带 -c）。
  try {
    const fm = ensureGlobalFilemodeFalse();
    if (fm.ok) log.info('已设置 git config --global core.filemode false');
    else log.warn(`git config --global core.filemode false 失败: ${fm.stderr || fm.status}`);
  } catch (e) {
    log.warn(`git config --global core.filemode false 异常: ${e?.message || e}`);
  }

  // v1.18.0：启动时确保同级仓 dsh-git-push-User 存在（api.github.com clone，不进插件目录）
  // 用户原话：「干脆不要存插件目录了，就从github获取仓库到同一层级吧」
  // 【原代码】凭据/要求清单放插件 User/<username>/，安装拷贝会清空
  try {
    const sibling = await ensureUserRepoSibling({ workspaceRoot });
    if (sibling.ok && sibling.cloned) log.info(`同级仓 ${USER_REPO_NAME} 已 clone → ${sibling.dest}`);
    else if (sibling.ok) log.info(`同级仓 ${USER_REPO_NAME}: ${sibling.skipped || 'ok'} → ${sibling.dest || ''}`);
    else log.warn(`同级仓 ${USER_REPO_NAME} 未就绪: ${sibling.error || 'unknown'}`);
  } catch (e) {
    log.warn(`同级仓 ${USER_REPO_NAME} 探测失败: ${e?.message || e}`);
  }

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
        workspaceRoot, depth, extraRepos, extraReposFile,
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
    // 2026-09-02 私有库豁免（用户要求）：GitHub 可见性 = private → 审计算法同样跳过敏感内容规则
    // （secret / 凭据文件 / 对话措辞），语法/二进制/npm 等硬规则照常。
    let effectiveExemptRepos = exemptRepos;
    try {
      const tokenInfo = resolveGitToken({ repoPath });
      const vis = await detectRepoVisibility({ repoPath, token: tokenInfo?.token || '' });
      if (vis.visibility === 'private') effectiveExemptRepos = [...exemptRepos, repoPath];
    } catch { /* 探测失败保守不豁免 */ }
    const result = auditRepo(repoPath, { blockOn, exemptRepos: effectiveExemptRepos });
    if (result.exempted) result.privateExempted = true;
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

  /**
   * 提交前 README 预览（2026-08-20 用户要求）：把仓库 README 发到会话，逐级回退——
   *   1. 插件直接渲染 md（image-preview render md=true，README 直渲成图）
   *   2. 图（image-preview render 文本模式）
   *   3. 纯文本（返回 README 内容，由调用方展示）
   * 返回 { mode, content?, imageUrl?, file?, error? }——mode ∈ md-image|text-image|text|none
   */
  async function previewReadme(repoPath) {
    const candidates = ['README.md', 'README.MD', 'Readme.md', 'readme.md'];
    let readmePath = null;
    for (const name of candidates) {
      const p = join(repoPath, name);
      try { if (statSync(p).isFile()) { readmePath = p; break; } } catch { /* 不存在 */ }
    }
    if (!readmePath) return { mode: 'none', error: '仓库无 README' };
    let text = '';
    try { text = readFileSync(readmePath, 'utf8').slice(0, 20000); } catch (e) { return { mode: 'none', error: `读 README 失败: ${e.message}` }; }
    if (!text.trim()) return { mode: 'none', error: 'README 为空' };

    // 三级回退：md 直渲 → 图 → 文本
    // 1) image-preview render（md=true 直渲；不可用时降级纯文本渲染）
    try {
      const base = selfHost(); // 本实例地址
      const renderRes = await fetch(`${base}/api/image-preview/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title: 'README 预览（提交前）', md: true, absUrl: true, outPath: `gitpush-readme-${Date.now()}.png` }),
        signal: AbortSignal.timeout(15000),
      });
      if (renderRes.ok) {
        const data = await renderRes.json();
        if (data?.ok && data.absUrl) return { mode: 'md-image', imageUrl: data.absUrl, file: data.file };
      }
      // 2) 纯文本渲染（md 直渲失败则用普通文本渲染）
      const renderRes2 = await fetch(`${base}/api/image-preview/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 8000), title: 'README 预览（提交前）', md: false, absUrl: true, outPath: `gitpush-readme-${Date.now()}.png` }),
        signal: AbortSignal.timeout(15000),
      });
      if (renderRes2.ok) {
        const data = await renderRes2.json();
        if (data?.ok && data.absUrl) return { mode: 'text-image', imageUrl: data.absUrl, file: data.file };
      }
    } catch { /* image-preview 不可用，降级文本 */ }
    // 3) 纯文本
    return { mode: 'text', content: text.slice(0, 4000) };
  }

  /** 本实例 HTTP 基地址（image-preview 同实例调用）。 */
  function selfHost() {
    const port = process.env.DSH_PORT || process.env.TEST_DSH_PORT || 3081;
    return `http://127.0.0.1:${port}`;
  }

  /** 带审计门禁的提交推送：审计未通过（blockOn 命中）→ 拦截不提交。推送成功后自动维护 dsh-repo-index。 */
  async function commitWithAudit({ repo, message, push, dryRun, audit, llmAudit: llm, showReadme = true, requirementsConfirmed = false }) {
    // 2026-08-20：提交前 README 预览（默认开，showReadme=false 可关）——把仓库 README 发到会话
    let readmePreview = null;
    if (showReadme && !dryRun) {
      try { readmePreview = await previewReadme(repo); } catch (e) { readmePreview = { mode: 'none', error: String(e?.message ?? e) }; }
    }
    const wantAudit = audit !== false && auditEnabled;
    if (wantAudit && !dryRun) {
      const auditResult = await auditRepoPath(repo, { forceLlm: !!llm });
      if (auditResult.blocked) {
        return { ok: false, blocked: true, error: `审计未通过，拦截提交（${auditResult.summary.total} 个问题，blockOn=${blockOn}）`, findings: auditResult.findings, summary: auditResult.summary, ...(readmePreview ? { readmePreview } : {}) };
      }
      const auditOk = { ok: true, audited: true, blocked: false, findings: auditResult.findings, summary: auditResult.summary, ...(auditResult.llmError ? { llmError: auditResult.llmError } : {}), ...(auditResult.llmRoute ? { llmRoute: auditResult.llmRoute } : {}) };
      const result = await commitAndPush({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun, requirementsConfirmed });
      if (result.ok && result.push?.pushed) result.repoIndex = await maintainRepoIndex();
      return { ...result, audit: auditOk, ...(readmePreview ? { readmePreview } : {}) };
    }
    const result = await commitAndPush({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun, requirementsConfirmed });
    if (result.ok && result.push?.pushed) result.repoIndex = await maintainRepoIndex();
    return { ...result, audit: { ok: true, audited: false, note: '审计已关闭或 dryRun' }, ...(readmePreview ? { readmePreview } : {}) };
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

          if (p === '/api/git-push/account-check' && (m === 'GET' || m === 'POST')) {
            const body = m === 'POST' ? await readJson(req) : {};
            const draft = String(body.githubToken || '').trim();
            const draftPub = String(body.sshPub || '').trim();
            if (draftPub) persistSshPub(draftPub, { workspaceRoot });
            const result = await checkGithubAccount({ workspaceRoot, token: draft });
            result.block = formatGithubAccountBlock(result);
            return respond(res, result);
          }
          if (p === '/api/git-push/status' && m === 'GET') {
            return respond(res, {
              ok: true, plugin: 'dsh-git-push', version: __VERSION__,
              workspaceRoot, extraRepos, extraReposFile: extraReposFile || '(未配置)', depth,
              audit: { auditEnabled, blockOn, llmAudit: llmAuditOn, llmAuditProvider: llmAuditProvider || '(未配置)', llmAuditModel: llmAuditModel || '(未配置)', exemptRepos },
              repoIndex: { enabled: repoIndexEnabled, tokenPath: repoIndexTokenPath || '(未配置)', syncTarget: repoIndexSyncTarget || `(探测: ${join(detectSkillsDir(), 'dsh-repo-index.md')})` },
              git: runGitVersion(),
            });
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
            if (!repo) return respond(res, { ok: false, error: { code: 'PARAM', message: '缺少 repo（仓库路径）' } }, 400);
            const result = await auditRepoPath(repo, { forceLlm });
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
            const result = genReadme({ repoPath: repo, writePath });
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
            const result = rebuildHistory({ repoPath: repo, mode, dryRun, dropFrom, dropTo, force });
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
            const result = await commitWithAudit({ repo, message, push, dryRun, audit, llmAudit: llm });
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

  /* ------------------------------ agent 工具 ------------------------------ */

  ctx.inject(['tools'], (tctx) => {
    const tools = tctx.get('tools');
    if (!tools) return;

    tools.register(defineTool({
      name: 'git_scan',
      description: '扫描 DSH workspace 下所有 git 仓库，返回每个仓库的分支/remote/未提交变更数/最近活动。用于查看哪些仓库有未提交或未推送的改动。支持自由配置：root 传扫描根目录（默认 workspaceRoot，传了则以它为准）、paths 传额外仓库绝对路径（逗号分隔，临时指定，无需改配置）、extraReposFile 传配置文件路径（每行一个仓库绝对路径，# 开头为注释，运行时实时读取即时生效）。',
      parameters: {
        root: { type: 'string', description: '扫描根目录（默认 workspaceRoot，传了则以它为准）' },
        paths: { type: 'string', description: '额外仓库绝对路径，逗号分隔（临时指定，无需改配置）' },
        extraReposFile: { type: 'string', description: 'extraRepos 配置文件路径（每行一个仓库绝对路径，# 开头为注释，实时读取生效）' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async ({ root, paths, extraReposFile: file }) => {
        const scanRoot = root || workspaceRoot;
        const pathList = (paths || '').split(',').map((x) => x.trim()).filter(Boolean);
        const repos = scanRepos({ root: scanRoot, depth, extraRepos: [...extraRepos, ...pathList], extraReposFile: file || extraReposFile });
        return JSON.stringify({ count: repos.length, root: scanRoot, paths: pathList, extraReposFile: file || extraReposFile, repos }, null, 2);
      },
    }));

    tools.register(defineTool({
      name: 'git_commit_push',
      description: '对指定 git 仓库一键提交并推送：先审计（默认开，L0 静态检查语法/敏感信息/凭据/大文件/文档对话类措辞，发现严重问题拦截），再扫描敏感字段(cookie/device/username/password/token)自动加 .gitignore，再 git add -A → commit（message 必填）→ push origin <当前分支>。push 前自动 fetch 并检查 ahead/behind，远端领先时不推。repo 传仓库绝对路径（可用 git_scan 查）。audit=false 可关闭审计；llmAudit=true 追加 LLM 深度审查（需配置 llmAuditProvider/Model）。dryRun=true 只模拟不写入。调用时若同级仓 dsh-git-push-User 存在开发者特殊要求清单，需先逐条核对达标并传 requirementsConfirmed=true，否则拦截。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        message: { type: 'string', description: 'commit message（必填）' },
        push: { type: 'boolean', description: '是否推送，默认 true' },
        dryRun: { type: 'boolean', description: 'dry-run 只模拟，默认 false' },
        audit: { type: 'boolean', description: '提交前审计，默认 true' },
        llmAudit: { type: 'boolean', description: '追加 LLM 深度审查，默认 false' },
        requirementsConfirmed: { type: 'boolean', description: '已核对同级仓 dsh-git-push-User 开发者特殊要求（v1.18.0）：存在要求清单时必须 true，false 会被拦截' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async (params) => {
        const result = await commitWithAudit(params);
        const heads = result?.remoteHeads?.heads;
        if (Array.isArray(heads) && heads.length) {
          result.remoteHeadsText = formatRemoteHeadsTable(heads, {
            owner: result.remoteHeads.owner,
            repo: result.remoteHeads.repo,
          });
        }
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

    tools.register(defineTool({
      name: 'git_gen_readme',
      description: '对指定 git 仓库规范化生成 README 骨架：一句话概括 + 架构设计 + 文件目录结构及作用 + 启动脚本 + API 总览（带跳转目录 TOC）+ 版本列表 + 注意事项 + 开发计划/疑难杂症。自动填充项目名/描述/版本号/版本记录表/TOC，其余章节为 INSERT 插入点（内容填充由 skill 实现）。repo 传仓库绝对路径。writePath 可选指定写入路径，默认只返回内容不写文件。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        writePath: { type: 'string', description: '可选：写入路径（直接写 README.md 传路径）' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async ({ repo, writePath }) => {
        if (!repo) return JSON.stringify({ ok: false, error: '缺少 repo' }, null, 2);
        const result = genReadme({ repoPath: repo, writePath: writePath || undefined });
        return JSON.stringify(result, null, 2);
      },
    }));

    tools.register(defineTool({
      name: 'git_remote_create',
      description: '按项目文件夹创建远程仓库：对本地 git 仓库（repo 传仓库绝对路径）取目录名做仓库名，检查 GitHub 是否已存在同名仓库（走 api.github.com，owner=EIGHTfs），不存在则用 GitHub token 自动创建（visibility=private/public，默认 private），并设置 origin 为 https://api.github.com/repos/{owner}/{name}（不写 SSH/github.com）。dryRun=true 只探测预演不写 remote 不调创建 API。token 自动探测：项目内 .git-push-token / 同级仓 dsh-git-push-User/github-token。',
      parameters: {
        repo: { type: 'string', description: '本地 git 仓库绝对路径（项目文件夹）' },
        visibility: { type: 'string', description: 'public | private（默认 private）' },
        dryRun: { type: 'boolean', description: 'true=只探测预演不创建不设置，默认 false' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async ({ repo, visibility, dryRun }) => {
        if (!repo) return JSON.stringify({ ok: false, error: '缺少 repo' }, null, 2);
        const result = await ensureRemoteRepo({ repoPath: repo, visibility: visibility || 'private', dryRun: !!dryRun, workspaceRoot });
        return JSON.stringify(result, null, 2);
      },
    }));

    // v1.16.0 切换仓库可见性：PATCH /repos/{owner}/{repo} {"private": bool}
    tools.register(defineTool({
      name: 'git_set_visibility',
      description: '切换 GitHub 仓库公开/私有状态：对本地 git 仓库（repo 传仓库绝对路径）调 GitHub API PATCH /repos/{owner}/{repo} 的 private 字段，支持 public ↔ private 双向切换。改 public 有敏感信息暴露风险（公开后任何人可看仓库内容，先确认无凭据/隐私），改 private 安全。token 自动探测（优先同级仓 dsh-git-push-User/github-token）。成功后可用 git_scan 或 code_audit 确认。',
      parameters: {
        repo: { type: 'string', description: '本地 git 仓库绝对路径（项目文件夹）' },
        visibility: { type: 'string', description: 'public | private（必填，改公开前确认仓库无敏感信息）' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async ({ repo, visibility }) => {
        if (!repo) return JSON.stringify({ ok: false, error: '缺少 repo' }, null, 2);
        if (!visibility) return JSON.stringify({ ok: false, error: '缺少 visibility（public/private）' }, null, 2);
        const token = resolveGitToken({ repoPath: repo, workspaceRoot }).token;
        if (!token) return JSON.stringify({ ok: false, error: '未找到 GitHub token（resolveGitToken 探测失败）' }, null, 2);
        const result = await setRepoVisibility({ repoPath: repo, visibility, token });
        // 风险提示：公开 = 内容对外可见
        if (result.ok && result.visibility === 'public') {
          result.warning = '⚠️ 仓库已公开——内容对所有人可见，请确认无凭据/隐私后再公开。如要转回私有可再调 git_set_visibility visibility=private。';
        }
        return JSON.stringify(result, null, 2);
      },
    }));

    // v1.17.0 远端 clone：只走 api.github.com Git Data API（git/trees + git/blobs），不下 tarball
    // 用户原话：「修复此插件，使所有功能都默认api.github.com」
    tools.register(defineTool({
      name: 'git_clone',
      description: '从 GitHub 远端 clone 仓库到本地（只走 api.github.com Git Data API：git/trees + git/blobs，不跟随 tarball 302、不直连 github.com/codeload；自动探测远端默认分支 master/main）。target 传 owner/repo 或完整 URL（https://github.com/o/r.git / git@github.com:o/r.git / ssh://git@ssh.github.com:443/o/r.git / https://api.github.com/repos/o/r，URL 只解析不访问）。dest 传目标目录绝对路径（缺省放 workspaceRoot），已存在非空目录会拒绝防覆盖。branch 可选指定分支。在 /tmp 中转建仓后整拷回目标，兼容 CIFS 卷。',
      parameters: {
        target: { type: 'string', description: '远端 target：owner/repo 或完整 URL（必填）' },
        dest: { type: 'string', description: '目标目录绝对路径（缺省放 workspaceRoot）' },
        branch: { type: 'string', description: '可选指定分支（缺省用远端默认分支）' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async ({ target, dest, branch }) => {
        if (!target) return JSON.stringify({ ok: false, error: '缺少 target（owner/repo 或 URL）' }, null, 2);
        const { token } = resolveGitToken({ workspaceRoot });
        const result = await cloneViaApi({ target, dest: dest || '', branch: branch || '', token, workspaceRoot });
        return JSON.stringify(result, null, 2);
      },
    }));

    tools.register(defineTool({
      name: 'git_rebuild_history',
      description: '重建 git 仓库历史，三种模式：squash-bugfixes（补丁版本并入主版本，只保留主版本提交点）/ drop-versions（删除指定版本区间）/ fresh（完全重建，当前文件树作为 1.0.0 初始提交）。所有破坏性操作前自动打 backup-<timestamp> tag。dryRun=true 可预览影响范围不执行。repo 传仓库绝对路径。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        mode: { type: 'string', description: 'squash-bugfixes（推荐）| drop-versions | fresh' },
        dryRun: { type: 'boolean', description: 'true=只预览不执行，默认 false' },
        dropFrom: { type: 'string', description: 'drop-versions 模式：起始版本号（如 3.0.0）' },
        dropTo: { type: 'string', description: 'drop-versions 模式：结束版本号（如 3.5.0）' },
        force: { type: 'boolean', description: '强制推送（已远端推送的仓库需同意 force push）' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async (params) => {
        if (!params.repo) return JSON.stringify({ ok: false, error: '缺少 repo' }, null, 2);
        if (params.dryRun) {
          const result = previewRebuildHistory({ repoPath: params.repo, mode: params.mode, dropFrom: params.dropFrom, dropTo: params.dropTo });
          return JSON.stringify(result, null, 2);
        }
        const result = rebuildHistory({ repoPath: params.repo, mode: params.mode, dryRun: false, dropFrom: params.dropFrom, dropTo: params.dropTo, force: !!params.force });
        return JSON.stringify(result, null, 2);
      },
    }));

    log.info('工具已注册: git_scan / git_commit_push / code_audit / git_gen_readme / git_rebuild_history / git_remote_create / git_set_visibility / git_clone');
  });
}

function runGitVersion() {
  try {
    return execSync('git --version', { encoding: 'utf8' }).trim();
  } catch {
    return 'git 不可用';
  }
}
