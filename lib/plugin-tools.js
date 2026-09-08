/**
 * dsh-git-push — agent 工具注册（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * git_scan / git_commit_push / code_audit / git_gen_readme / git_remote_create /
 * git_set_visibility / git_clone / git_rebuild_history / git_push_rules /
 * push_permit_status / push_permit_config。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { scanRepos, genReadme, rebuildHistory, previewRebuildHistory, ensureRemoteRepo, resolveValidGitToken, setRepoVisibility, cloneViaApi, formatRemoteHeadsTable, buildReadmeCheckHint } from './core.js';
import { exportCommentWordingRules, fetchCommentWordingRules, parseCommentWordingRules, saveCommentWordingRulesFile } from './rules.js';
import { readPermit, setPermit } from './permit.js';
import { textRender } from './plugin-config.js';

/** 注册全部 agent 工具（tools 服务存在时）。 */
export function registerAgentTools(ctx, env, { commitWithAudit, auditRepoPath }) {
  const { log, workspaceRoot, depth, extraRepos, extraReposFile, permitCommitMessage } = env;

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
      description: '对指定 git 仓库一键提交并推送：先审计（默认开，L0 静态检查语法/敏感信息/凭据/大文件/文档对话类措辞，发现严重问题拦截），再扫描敏感字段(cookie/device/username/password/token)自动加 .gitignore，再 git add -A → commit（message 必填）→ push origin <当前分支>。push 前自动 fetch 并检查 ahead/behind，远端领先时不推。repo 传仓库绝对路径（可用 git_scan 查）。audit=false 可关闭审计；llmAudit=true 追加 LLM 深度审查（需配置 llmAuditProvider/Model）。dryRun=true 只模拟不写入。调用前需逐条核对开发者特殊要求（随插件内置 EIGHTfs 清单，可用 <插件配置目录>/requirements.json 外挂），全部达标才传 requirementsConfirmed=true，否则拦截。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        message: { type: 'string', description: 'commit message（必填）' },
        push: { type: 'boolean', description: '是否推送，默认 true' },
        dryRun: { type: 'boolean', description: 'dry-run 只模拟，默认 false' },
        audit: { type: 'boolean', description: '提交前审计，默认 true' },
        llmAudit: { type: 'boolean', description: '追加 LLM 深度审查，默认 false' },
        requirementsConfirmed: { type: 'boolean', description: '已核对开发者特殊要求（v1.40.0 起随插件内置 EIGHTfs 清单，可用 <插件配置目录>/requirements.json 外挂）：全部达标时 true，false 会被拦截' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async (params) => {
        const result = await commitWithAudit({ ...params, customIgnorePatterns: env.customIgnorePatterns });
        const repoPath = params?.repo || '';
        const hasReadme = ['README.md', 'README.MD', 'Readme.md', 'readme.md'].some((n) => {
          try { return statSync(join(repoPath, n)).isFile(); } catch { return false; }
        });
        result.readmeCheck = buildReadmeCheckHint({ hasReadme, repoName: repoPath.split(/[\\/]/).filter(Boolean).pop() || '' });
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
      description: '对指定 git 仓库执行代码审计（默认 L0 静态检查：语法/JSON/YAML/敏感信息/凭据入库/二进制大文件/debugger 残留 + 代码质量维度：函数行数/静默catch/async同步阻塞/测试覆盖 + 0-100 评分与 A-D 等级，标准见 docs/code-quality-checklist.yaml）。规则来自可插拔规则包（缺省内置 EIGHTfs 包，可经 auditRuleset 配置整体替换第三方包）。llm=true 时追加 LLM 深度审查（需配置 llmAuditProvider/Model）。ruleset 可选本次审计临时换规则包（builtin | 本地规则包绝对路径 | http(s):// 在线包）。repo 传仓库绝对路径。返回问题清单（blocker 拦截级 / warning 提醒级）、quality 评分与是否通过，含 ruleset 来源溯源（name/owner/version/source）。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        llm: { type: 'boolean', description: '是否追加 LLM 深度审查，默认 false' },
        ruleset: { type: 'string', description: '可选：本次审计规则包（builtin | 本地规则包绝对路径 | http(s):// 在线包），缺省用配置 auditRuleset' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async ({ repo, llm, ruleset }) => {
        if (!repo) return JSON.stringify({ ok: false, error: '缺少 repo' }, null, 2);
        const result = await auditRepoPath(repo, { forceLlm: !!llm, ruleset: ruleset || undefined });
        return JSON.stringify(result, null, 2);
      },
    }));

    tools.register(defineTool({
      name: 'git_gen_readme',
      description: '对指定 git 仓库按模板生成 README。模板 = 插件 template/README.md（每人一份，可改章节，v1.40.0 起不再读同级仓）；缺省用插件内置默认骨架。占位符 {{name}} {{description}} {{version}} {{toc}} {{versionTable}}。repo 传仓库绝对路径。writePath 可选指定写入路径（只允许仓库内或插件配置目录），默认只返回内容不写文件。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        writePath: { type: 'string', description: '可选：写入路径（直接写 README.md 传路径）' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async ({ repo, writePath }) => {
        if (!repo) return JSON.stringify({ ok: false, error: '缺少 repo' }, null, 2);
        const result = genReadme({ repoPath: repo, writePath: writePath || undefined, workspaceRoot });
        return JSON.stringify(result, null, 2);
      },
    }));

    tools.register(defineTool({
      name: 'git_remote_create',
      description: '按项目文件夹创建远程仓库：对本地 git 仓库（repo 传仓库绝对路径）取目录名做仓库名，检查 GitHub 是否已存在同名仓库（走 api.github.com，owner 默认取配置 githubOwner，兜底 EIGHTfs），不存在则用 GitHub token 自动创建（visibility=private/public，默认 private），并设置 origin 为 https://api.github.com/repos/{owner}/{name}（不写 SSH/github.com）。dryRun=true 只探测预演不写 remote 不调创建 API。token 自动探测：插件配置目录 git-push/github-token / 项目内 .git-push-token。',
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
      description: '切换 GitHub 仓库公开/私有状态：对本地 git 仓库（repo 传仓库绝对路径）调 GitHub API PATCH /repos/{owner}/{repo} 的 private 字段，支持 public ↔ private 双向切换。改 public 有敏感信息暴露风险（公开后任何人可看仓库内容，先确认无凭据/隐私），改 private 安全。token 自动探测（优先插件配置目录 git-push/github-token）。成功后可用 git_scan 或 code_audit 确认。',
      parameters: {
        repo: { type: 'string', description: '本地 git 仓库绝对路径（项目文件夹）' },
        visibility: { type: 'string', description: 'public | private（必填，改公开前确认仓库无敏感信息）' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async ({ repo, visibility }) => {
        if (!repo) return JSON.stringify({ ok: false, error: '缺少 repo' }, null, 2);
        if (!visibility) return JSON.stringify({ ok: false, error: '缺少 visibility（public/private）' }, null, 2);
        const tokenInfo = await resolveValidGitToken({ repoPath: repo, workspaceRoot });
        const token = tokenInfo.token;
        if (!token) return JSON.stringify({ ok: false, error: '未找到 GitHub token（resolveValidGitToken 探测失败）' }, null, 2);
        const result = await setRepoVisibility({ repoPath: repo, visibility, token });
        // 风险提示：公开 = 内容对外可见
        if (result.ok && result.visibility === 'public') {
          result.warning = '⚠️ 仓库已公开——内容对所有人可见，请确认无凭据/隐私后再公开。如要转回私有可再调 git_set_visibility visibility=private。';
        }
        return JSON.stringify(result, null, 2);
      },
    }));

    // v1.17.0 远端 clone：只走 api.github.com Git Data API（git/trees + git/blobs），不下 tarball
    // 「修复此插件，使所有功能都默认api.github.com」
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
        const { token } = await resolveValidGitToken({ workspaceRoot });
        const result = await cloneViaApi({ target, dest: dest || '', branch: branch || '', token, workspaceRoot });
        return JSON.stringify(result, null, 2);
      },
    }));

    tools.register(defineTool({
      name: 'git_rebuild_history',
      description: '重建 git 仓库历史。squash-bugfixes=补丁并入主版本；drop-versions=删版本区间；fresh=当前文件树作为唯一提交（不改 package.json 版本号）。破坏性操作前打 backup tag。force=true 才覆盖远端（须用户同意）。dryRun=true 只预览。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        mode: { type: 'string', description: 'squash-bugfixes（推荐）| drop-versions | fresh' },
        dryRun: { type: 'boolean', description: 'true=只预览不执行，默认 false' },
        dropFrom: { type: 'string', description: 'drop-versions 模式：起始版本号（如 3.0.0）' },
        dropTo: { type: 'string', description: 'drop-versions 模式：结束版本号（如 3.5.0）' },
        force: { type: 'boolean', description: 'true=覆盖远端当前分支（须用户同意 force push）；默认 false 只改本地' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async (params) => {
        if (!params.repo) return JSON.stringify({ ok: false, error: '缺少 repo' }, null, 2);
        if (params.dryRun) {
          const result = previewRebuildHistory({ repoPath: params.repo, mode: params.mode, dropFrom: params.dropFrom, dropTo: params.dropTo });
          return JSON.stringify(result, null, 2);
        }
        const result = await rebuildHistory({ repoPath: params.repo, mode: params.mode, dryRun: false, dropFrom: params.dropFrom, dropTo: params.dropTo, force: !!params.force, workspaceRoot });
        return JSON.stringify(result, null, 2);
      },
    }));

    // v1.26.0 comment-wording 规则管理：show（当前生效规则）/ export（导出 JSON 文本）/
    // import（JSON 文本或在线 URL → 写本地规则文件并即时生效）。
    // 设置 → 插件 → git-push 也可直接配置：commentWordingCustom（JSON 文本，最高优先）、
    // commentWordingRulesFile（规则文件地址，本地路径或 http(s) URL，在线导入填地址即可）。
    tools.register(defineTool({
      name: 'git_push_rules',
      description: '管理 dsh-git-push 的 comment-wording 审计规则（代码注释措辞规则）。action=show 返回当前生效规则；action=export 返回可导入的 JSON 文本；action=import 接收 json（规则 JSON 文本）或 url（在线规则地址），写入规则文件并即时生效，传入 targetFile 可自定义写入路径。规则来源优先级：设置 commentWordingCustom（JSON）> commentWordingRulesFile（本地路径或 URL）> 内置默认。',
      parameters: {
        action: { type: 'string', description: 'show（默认，当前规则）| export | import' },
        json: { type: 'string', description: 'action=import 时：规则 JSON 文本' },
        url: { type: 'string', description: 'action=import 时：在线规则地址（http/https 文件）' },
        targetFile: { type: 'string', description: 'action=import 时：写入的规则文件路径（默认 workspaceRoot/data/comment-wording-rules.json）' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async (params) => {
        const action = params.action || 'show';
        if (action === 'export') {
          return JSON.stringify({ ok: true, source: env.commentWordingSource, count: env.commentWordingRules.length, exported: exportCommentWordingRules(env.commentWordingRules), hint: 'exported 可直接粘贴到设置 commentWordingCustom，或存文件后填到 commentWordingRulesFile' }, null, 2);
        }
        if (action === 'import') {
          const body = (params && params.json) || '';
          const url = (params && params.url) || '';
          const targetFile = (params && params.targetFile) || join(workspaceRoot, 'data', 'comment-wording-rules.json');
          if (!body.trim() && !url.trim()) return JSON.stringify({ ok: false, error: 'import 需要 json 或 url' }, null, 2);
          let parsed = null;
          let sourceDesc = '';
          if (url.trim()) {
            const fetched = await fetchCommentWordingRules(url.trim());
            if (!fetched.ok) return JSON.stringify({ ok: false, error: '在线规则拉取失败: ' + fetched.error }, null, 2);
            parsed = fetched.rules;
            sourceDesc = 'url(' + url.trim() + ')';
          } else {
            const r = parseCommentWordingRules(body);
            if (!r.ok) return JSON.stringify({ ok: false, error: r.error }, null, 2);
            parsed = r.rules;
            sourceDesc = 'json';
          }
          const saved = saveCommentWordingRulesFile(parsed, targetFile);
          if (!saved.ok) return JSON.stringify({ ok: false, error: saved.error }, null, 2);
          env.commentWordingRules = parsed;
          env.commentWordingSource = 'import(' + sourceDesc + ')';
          env.commentWordingError = '';
          return JSON.stringify({ ok: true, count: parsed.length, source: env.commentWordingSource, targetFile, note: '已即时生效，重启不丢（规则文件持久化）' }, null, 2);
        }
        return JSON.stringify({ ok: true, source: env.commentWordingSource, count: env.commentWordingRules.length, rules: env.commentWordingRules, enabled: env.commentWordingEnabled, error: env.commentWordingError || undefined }, null, 2);
      },
    }));

    // v1.24.0 推送许可（整合 dsh-task-completion）：AI 回复含 ✅ 且许可开启 → 回合结束自动 commit+push
    // （走 commitWithAudit 带审计门禁；默认关闭）。工具名与旧 dsh-task-completion 一致，可平滑替代。
    tools.register(defineTool({
      name: 'push_permit_status',
      description: '查询「AI 回复推送许可」开关状态与最近一次自动检测/推送记录。许可开启时，AI 回复含 ✅ 任务完成 会在回合结束后自动 commit+push（默认关闭，关闭时只记录检测结果绝不自动推）。',
      parameters: {},
      output: { schema: { type: 'string' }, render: textRender },
      execute: async () => {
        const state = readPermit(workspaceRoot);
        return JSON.stringify({
          pushOnComplete: state.pushOnComplete,
          pushScope: state.pushScope,
          commitMessage: permitCommitMessage,
          lastAttempt: state.lastAttempt ?? null,
          lastAutoPush: state.lastAutoPush ?? null,
        }, null, 2);
      },
    }));

    tools.register(defineTool({
      name: 'push_permit_config',
      description: '设置「AI 回复推送许可」开关：enabled=true 开启（AI 回复含 ✅ 任务完成 后自动 commit+push，走审计门禁），enabled=false 关闭（默认）。pushScope 可选 all（默认，全部有变更仓库）/ session（仅会话 cwd 所在仓库）。返回最新状态。',
      parameters: {
        enabled: { type: 'boolean', description: '是否开启推送许可' },
        pushScope: { type: 'string', description: '可选：all | session（默认保持当前值）' },
      },
      output: { schema: { type: 'string' }, render: textRender },
      execute: async ({ enabled, pushScope }) => {
        if (typeof enabled !== 'boolean') return JSON.stringify({ ok: false, error: '缺少 enabled（boolean）' }, null, 2);
        const scope = pushScope === 'session' ? 'session' : (pushScope === 'all' ? 'all' : undefined);
        const result = setPermit(workspaceRoot, enabled, scope ? { pushScope: scope } : {});
        if (!result.ok) return JSON.stringify({ ok: false, error: result.error }, null, 2);
        return JSON.stringify({ ok: true, pushOnComplete: result.state.pushOnComplete, pushScope: result.state.pushScope }, null, 2);
      },
    }));

    log.info('工具已注册: git_scan / git_commit_push / code_audit / git_gen_readme / git_rebuild_history / git_remote_create / git_set_visibility / git_clone / push_permit_status / push_permit_config');
  });
}
