/**
 * dsh-git-push — git 自动提交推送插件 v1.32.0（内置代码审计门禁 + dsh-repo-index 自动维护）
 *
 * 形态：apply 函数 + ctx.inject（同 dsh-skill-forge / dsh-ai-work-archive 实证风格）
 * 触发面：
 *   1. 工具 git_scan         —— 扫描 workspace 全部 git 仓库状态
 *   2. 工具 git_commit_push   —— 一键 commit + push（**推送前审计**，发现问题拦截；推送成功后自动维护 dsh-repo-index）
 *   3. 工具 code_audit        —— 手动审计指定仓库（L0 静态 + 可选 L1 LLM）
 *   4. HTTP API              —— status / scan / commit / audit
 *
 * 审计（v1.1.0 内置）： *   L0 静态（零 token）：JS 语法 / JSON / YAML / 敏感信息硬编码 / 本机路径与局域网 IP 硬编码 / 凭据入库 / npm 包文件入库 / 大文件 / debugger / console
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
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { scanRepos, readExtraReposFile, commitAndPush, getDiff, scanSensitiveFiles, ensureSensitiveIgnored, genReadme, rebuildHistory, previewRebuildHistory, listVersionCommits, resolveGitToken, ensureRemoteRepo, loadUserRequirements, cloneViaApi, detectRepoVisibility, setRepoVisibility, ensureUserRepoSibling, USER_REPO_NAME, ensureGlobalFilemodeFalse, ensureGlobalSafeDirectoryStar, persistGithubToken, persistSshPub, githubTokenStatus, formatRemoteHeadsTable, checkGithubAccount, formatGithubAccountBlock, collectRepoSkillDocs, formatRepoSkillInjection, collectRepoSkillDirs, formatRepoSkillDirsInjection, buildDeviceUserInjection, runGit, resolveUserDir, hasFileHeaderExempt, collectFunctionManual, generateSshKey, ensureAuxSshRemote, buildReadmeCheckHint } from './core.js';
import { auditRepo, cleanCommentWording } from './audit.js';
import { loadCommentWordingRulesSync, fetchCommentWordingRules, parseCommentWordingRules, exportCommentWordingRules, saveCommentWordingRulesFile, DEFAULT_COMMENT_WORDING_PATTERNS } from './rules.js';
import { buildEnvInjection, buildEnvInjectionWithTools, ensureToolsIndexFile, collectToolPaths, DEFAULT_TOOL_PROBES } from './env-inject.js';
import { llmAudit } from './llm.js';
import { buildRepoIndex, syncRepoIndex, detectSkillsDir, parseManualVisibility } from './repo-index.js';
import { getCommitHistory, getCommitDiff, resolveViewerRepo, renderViewerPage } from './viewer.js';
import { extractLastAssistantText, shouldAutoPush, readPermit, writePermit, setPermit } from './permit.js';

const __VERSION__ = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const name = 'dsh-git-push';

/** 设置页命名空间：设置 → 插件 → 插件配置 卡片 key，须与客户端 settings.plugin.item 一致。 */
export const GIT_PUSH_SETTINGS_NS = 'git-push';

export const Config = z.object({
  githubToken: z.string().role('secret'),
  sshPub: z.string(),
  tokenConfigured: z.boolean().default(false),
  commentWordingEnabled: z.boolean().default(true),
  commentWordingCustom: z.string().default(''),
  commentWordingRulesFile: z.string().default(''),
  commentWordingRulesUrl: z.string().default(''),
  // v1.26.0 环境注入：agent/pre-step 注入「工作目录映射 + 工具安装路径」+ 同步 tools-index.md
  envInjectionEnabled: z.boolean().default(true),
  envInjectionTools: z.string().default(''), // 逗号分隔自定义工具名；空=用内置清单
  // v1.28.0 注入模式开关：injectFullSkill=true → pre-step 注入两仓 skill 全文（collectRepoSkillDocs，
  // 即 v1.23.x 时期行为）；false（默认）→ 只注入 skill 目录+文件清单，正文由 AI 按需读取。
  injectFullSkill: z.boolean().default(false),
  // v1.28.0 自定义忽略 pattern（逗号/换行分隔，如 *.bak*）：提交时自动追加到目标仓库 .gitignore
  customIgnorePatterns: z.string().default(''),
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
  const pushScopeCfg = config.pushScope === 'session' ? 'session' : 'all'; // v1.24.0 推送许可 scope
  const permitCommitMessage = typeof config.commitMessage === 'string' && config.commitMessage.trim()
    ? config.commitMessage.trim() : 'chore(ai): 任务完成自动提交';
  // v1.28.0 自定义忽略 pattern（逗号/换行分隔，如 *.bak*）：提交时自动追加到目标仓库 .gitignore
  // v1.30.0：改为 let —— 设置页改动经 settings scope.watch 同步覆盖（见下方 settings 注册处），运行期即时生效
  let customIgnorePatterns = typeof config.customIgnorePatterns === 'string' ? config.customIgnorePatterns.trim() : '';
  const log = ctx.logger('git-push');

  // 2026-09-06：comment-wording 规则配置化（设置 → 插件 → git-push 可自定义）
  // 规则来源优先级：commentWordingCustom（设置里直接填 JSON 文本）
  //   > commentWordingRulesFile（规则文件地址：本地路径或 http(s) URL，在线导入填地址即可）
  //   > 内置默认。启动时解析一次存内存（URL 场景 await fetch，失败回退内置并告警）。
  const commentWordingEnabled = config.commentWordingEnabled !== false;
  const commentWordingCustom = typeof config.commentWordingCustom === 'string' ? config.commentWordingCustom : '';
  const commentWordingRulesFile = typeof config.commentWordingRulesFile === 'string' ? config.commentWordingRulesFile : '';
  let commentWordingRules = [...DEFAULT_COMMENT_WORDING_PATTERNS];
  let commentWordingSource = 'builtin';
  let commentWordingError = '';
  if (commentWordingEnabled) {
    const customRes = loadCommentWordingRulesSync({ custom: commentWordingCustom });
    if (customRes.source === 'custom') {
      commentWordingRules = customRes.rules;
      commentWordingSource = 'custom';
    } else if (commentWordingRulesFile.trim()) {
      const fp = commentWordingRulesFile.trim();
      if (/^https?:\/\//i.test(fp)) {
        const fetched = await fetchCommentWordingRules(fp);
        if (fetched.ok) {
          commentWordingRules = fetched.rules;
          commentWordingSource = `url(${fp})`;
        } else {
          commentWordingError = `在线规则加载失败(${fetched.error || '未知'}): ${fp}`;
          log.warn(commentWordingError);
        }
      } else {
        const fileRes = loadCommentWordingRulesSync({ rulesFile: fp });
        if (fileRes.source === 'file') {
          commentWordingRules = fileRes.rules;
          commentWordingSource = `file(${fp})`;
        } else {
          commentWordingError = `规则文件不可读或格式非法: ${fp}`;
          log.warn(commentWordingError);
        }
      }
    }
  }

  // 设置 → 插件 → 插件配置：填写 GitHub token，落到同级仓 github-token（不进 settings.yaml 明文）
  // 「插件配置填写凭据，入口在设置里面」
  ctx.inject(['settings'], (settingsCtx) => {
    const tok = githubTokenStatus({ workspaceRoot });
    const entry = { githubToken: '', sshPub: '', tokenConfigured: tok.configured, commentWordingEnabled: true, commentWordingCustom: '', commentWordingRulesFile: '', commentWordingRulesUrl: '', envInjectionEnabled: true, envInjectionTools: '', injectFullSkill: false, customIgnorePatterns: '' };
    const scope = settingsCtx.settings.register(GIT_PUSH_SETTINGS_NS, Config, { base: entry });
    scope.watch(async (next) => {
      // v1.30.0：设置页改动 → 同步覆盖运行期变量（injectFullSkill / customIgnorePatterns 即时生效，
      // 不再只有 token/sshPub 落盘；注意 next 是完整快照，可能不含未改字段，用 typeof 判断）
      if (next && typeof next.injectFullSkill === 'boolean') {
        injectFullSkill = next.injectFullSkill;
        log.info(`injectFullSkill 设置已更新 → ${injectFullSkill}（设置页即时生效）`);
      }
      if (next && typeof next.customIgnorePatterns === 'string') {
        customIgnorePatterns = next.customIgnorePatterns.trim();
        log.info(`customIgnorePatterns 设置已更新 → ${customIgnorePatterns || '(空)'}`);
      }
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

  // ══════════════════════════════════════════════════════════════════════
  // 【上下文注入入口】本插件的全部上下文注入都在这里：
  //   查找线索：搜「上下文注入」「pre-step」「systemPrompt」「collectRepoSkillDocs / collectRepoSkillDirs」
  //   注入通道（两条，用途不同）：
  //     A) systemPrompt.section（系统提示词，每步组装生效，不受设置影响）：
  //        A1) 插件功能目录精简注入（v1.32.0，强制）——不再塞整份说明书；
  //            完整说明书是 skill dsh-git-push-functions，按需加载。
  //        A2) 环境注入（v1.28.1，由 pre-step 迁移）——工作目录映射 + 工具安装路径
  //            （注入用户环境和工具目录用系统提示词，其他保持不变）；60s 缓存防每步探测，
  //            缓存过期时同步 tools-index.md 到同级仓。
  //        A3) 提交前 README 检查（v1.32.0）——每次调用 git_commit_push 前核对 README。
  //     B) agent/pre-step 钩子（user 消息，仅首次注入，避免每步重复烧 token）：
  //        1) 两仓 skill 注入（dsh-git-push/skills + 同级仓 dsh-git-push-User 的 .md）
  //           · 配置 injectFullSkill=true（设置 → 插件 → 插件配置 勾选「注入全部 skill 内容」）
  //             → 注入全部 skill 正文（collectRepoSkillDocs + formatRepoSkillInjection，
  //               即 v1.23.x 时期行为，2026-09-07 恢复为可选开关）
  //           · 默认（false）→ 只注入 skill 目录 + 文件清单（collectRepoSkillDirs + formatRepoSkillDirsInjection），
  //             正文由 AI 按需读取，省 token
  //        2) 设备/用户 json 脱敏注入（v1.27.0）：只注入账号/站点清单，不注入密码明文
  //   实现参考：ai-work-archive/开发者文档/dsh-skill-mandatory.md 方案 A（插件注入，不改框架）。
  // ══════════════════════════════════════════════════════════════════════
  const injectedAgents = new WeakSet();
  const envInjectionOn = config.envInjectionEnabled !== false;
  let injectFullSkill = config.injectFullSkill === true; // 设置页开关：注入全部 skill 正文（v1.30.0 起 let，设置页改动经 scope.watch 同步覆盖）
  // A) 系统提示词通道（systemPrompt.section）——每步组装都生效，强制注入，不受设置影响：
  //    A1) 插件功能目录精简注入（v1.32.0）：collectFunctionManual() 返回短目录，不塞全文。
  //    A2) 环境注入（v1.28.1，由 pre-step 迁移）：工作目录映射 + 工具安装路径
  //        （注入用户环境和工具目录用系统提示词，其他保持不变）。
  //        text 函数带 60s 缓存：systemPrompt 每步组装都会调用，避免每步重新 spawnSync 探测；
  //        缓存过期时重新探测并同步 tools-index.md 到同级仓。
  ctx.inject(['systemPrompt'], (sctx) => {
    try {
      sctx.get('systemPrompt').section({
        name: 'dsh-git-push-functions',
        order: 990,
        text: () => collectFunctionManual(),
      });
    } catch (e) {
      log.warn(`功能说明书 systemPrompt 注入失败: ${e?.message || e}`);
    }
    try {
      sctx.get('systemPrompt').section({
        name: 'dsh-git-push-readme-check',
        order: 991,
        text: () => [
          '【dsh-git-push 提交前提醒】每次调用 git_commit_push 前必须检查该仓库 README：',
          '功能表 / 版本记录 / 用法是否与本次改动一致。需要更新则先改 README 再提交',
          '（可用 git_gen_readme 按模板生成）。不要把过时 README 推进远端。',
        ].join(''),
      });
    } catch (e) {
      log.warn(`README 检查注入 systemPrompt 失败: ${e?.message || e}`);
    }
  });
  let envCache = { key: '', at: 0, dirsText: '', toolsText: '' };
  const getEnvInjectionText = () => {
    const key = workspaceRoot;
    const now = Date.now();
    if (envCache.key === key && now - envCache.at < 60_000 && envCache.dirsText) {
      return [envCache.dirsText, envCache.toolsText].filter(Boolean).join('\n\n');
    }
    try {
      const customNames = (config.envInjectionTools || '').split(',').map((s) => s.trim()).filter(Boolean);
      const env = customNames.length
        ? buildEnvInjectionWithTools(customNames, { workspaceRoot })
        : buildEnvInjection({ workspaceRoot, probeTools: true });
      envCache = { key, at: now, dirsText: env.dirsText, toolsText: env.toolsText };
      try {
        const saved = ensureToolsIndexFile({ workspaceRoot, tools: env.tools });
        if (saved.ok) log.info(`tools-index.md 已同步 → ${saved.file}`);
        else log.warn(`tools-index.md 写入失败: ${saved.error}`);
      } catch (e) {
        log.warn(`tools-index.md 写入异常: ${e?.message || e}`);
      }
      return [env.dirsText, env.toolsText].filter(Boolean).join('\n\n');
    } catch (e) {
      log.warn(`环境注入失败: ${e?.message || e}`);
      return '';
    }
  };
  if (envInjectionOn) {
    ctx.inject(['systemPrompt'], (sctx) => {
      try {
        return sctx.get('systemPrompt').section({
          name: 'dsh-git-push-env',
          order: 980,
          text: () => getEnvInjectionText(),
        });
      } catch (e) {
        log.warn(`环境注入 systemPrompt 失败: ${e?.message || e}`);
      }
    });
  }
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    if (signal?.aborted) return decision;
    if (injectedAgents.has(agent)) return decision;
    injectedAgents.add(agent);
    const blocks = [];
    // 1) 两仓 skill 注入：按 injectFullSkill 开关选择「全文注入」或「目录清单注入」。
    //    「其实我只想注入skill目录」→ 默认只列清单；2026-09-07恢复全文注入为可选。
    if (injectFullSkill) {
      const docs = collectRepoSkillDocs({ workspaceRoot });
      const text = formatRepoSkillInjection(docs);
      if (text) {
        blocks.push(text);
        log.info(`已注入两仓 skill 全文 ${docs.length} 篇（injectFullSkill=true）`);
      }
    } else {
      const dirs = collectRepoSkillDirs({ workspaceRoot });
      const text = formatRepoSkillDirsInjection(dirs);
      if (text) {
        blocks.push(text);
        log.info(`已注入两仓 skill 目录 ${dirs.length} 个（injectFullSkill=false，只列清单）`);
      }
    }
    // 2) 环境注入已迁移到 systemPrompt.section（见上方 A2）——工作目录映射 + 工具路径每步组装生效
    // 3) 设备/用户 json 脱敏注入（v1.27.0；随 envInjection 开关，保持 pre-step 不变）
    if (envInjectionOn) {
      try {
        const dev = buildDeviceUserInjection({ workspaceRoot });
        if (dev) blocks.push(dev);
      } catch (e) {
        log.warn(`设备/用户 json 注入失败: ${e?.message || e}`);
      }
    }
    if (!blocks.length) return decision;
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: blocks.join('\n\n') }],
          source: { kind: 'plugin', plugin: name, form: 'instructions' },
        }),
      ],
    };
  });

  // v1.18.4：启动时 git config --global core.filemode false
  // 「新功能gitpush插件会git config --global core.filemode false」
  // AI 思路：CIFS 可执行位噪声；全局写一次给裸 git；失败不阻断启动（runGit 仍带 -c）。
  try {
    const fm = ensureGlobalFilemodeFalse();
    if (fm.ok) log.info('已设置 git config --global core.filemode false');
    else log.warn(`git config --global core.filemode false 失败: ${fm.stderr || fm.status}`);
  } catch (e) {
    log.warn(`git config --global core.filemode false 异常: ${e?.message || e}`);
  }
  try {
    const sd = ensureGlobalSafeDirectoryStar();
    if (sd.ok && sd.skipped) log.info('git config --global safe.directory=* 已存在');
    else if (sd.ok) log.info('已设置 git config --global --add safe.directory=*');
    else log.warn(`git config --global safe.directory=* 失败: ${sd.stderr || sd.status}`);
  } catch (e) {
    log.warn(`git config --global safe.directory=* 异常: ${e?.message || e}`);
  }

  // v1.18.0：启动时确保同级仓 dsh-git-push-User 存在（api.github.com clone，不进插件目录）
  // 「干脆不要存插件目录了，就从github获取仓库到同一层级吧」
  // 【原代码】凭据/要求清单放插件 User/<username>/，安装拷贝会清空
  try {
    const sibling = await ensureUserRepoSibling({ workspaceRoot });
    if (sibling.ok && sibling.cloned) log.info(`同级仓 ${USER_REPO_NAME} 已 clone → ${sibling.dest}`);
    else if (sibling.ok) log.info(`同级仓 ${USER_REPO_NAME}: ${sibling.skipped || 'ok'} → ${sibling.dest || ''}`);
    else log.warn(`同级仓 ${USER_REPO_NAME} 未就绪: ${sibling.error || 'unknown'}`);
  } catch (e) {
    log.warn(`同级仓 ${USER_REPO_NAME} 探测失败: ${e?.message || e}`);
  }

  /** v1.27.0：dsh-repo-index 改为 JSON，唯一目标 = 同级仓 dsh-git-push-User/<owner>/dsh-repo-index.json */
  async function maintainRepoIndex() {
    if (!repoIndexEnabled) return { ok: false, skipped: 'repoIndexEnabled=false' };
    try {
      // owner 是变量：resolveUserDir 从同级仓 origin 探测（回退目录名/EIGHTfs）
      const { dir: userDir, user: owner } = resolveUserDir({ workspaceRoot });
      if (!userDir) return { ok: false, error: '同级仓 dsh-git-push-User 未就绪，无法写索引' };
      // 手工可见性基线：从现有 JSON（或旧 md）解析，GitHub API 查不到时回退
      let existing = '';
      const defaultTarget = join(userDir, 'dsh-repo-index.json');
      const legacyMd = join(userDir, 'dsh-repo-index.md');
      for (const p of [repoIndexSyncTarget || defaultTarget, legacyMd]) {
        try { if (existsSync(p)) { existing = readFileSync(p, 'utf8'); break; } } catch { /* 跳过 */ }
      }
      const manualVisibility = parseManualVisibility(existing);
      const content = await buildRepoIndex({
        workspaceRoot, depth, extraRepos, extraReposFile,
        tokenPath: repoIndexTokenPath,
        manualVisibility,
        localOnlyExtra: repoIndexLocalOnly,
        owner,
      });
      const res = syncRepoIndex({ content, userDir, owner, syncTarget: repoIndexSyncTarget });
      log.info(`dsh-repo-index.json 已更新: ${res.written.join(', ') || '无写入'}`);
      return { ok: true, ...res, target: res.written[0] || defaultTarget };
    } catch (error) {
      log.warn(`dsh-repo-index 维护失败: ${String(error?.message ?? error)}`);
      return { ok: false, error: String(error?.message ?? error) };
    }
  }

  /** 对单个仓库执行审计（L0 必跑 + L1 按开关/参数），返回审计结果。 */
  async function auditRepoPath(repoPath, { forceLlm = false } = {}) {
    // 2026-09-02 私有库豁免（）：GitHub 可见性 = private → 审计算法同样跳过敏感内容规则
    // （secret / 凭据文件 / 对话措辞），语法/二进制/npm 等硬规则照常。
    let effectiveExemptRepos = exemptRepos;
    try {
      const tokenInfo = resolveGitToken({ repoPath });
      const vis = await detectRepoVisibility({ repoPath, token: tokenInfo?.token || '' });
      if (vis.visibility === 'private') effectiveExemptRepos = [...exemptRepos, repoPath];
    } catch { /* 探测失败保守不豁免 */ }
    const result = auditRepo(repoPath, { blockOn, exemptRepos: effectiveExemptRepos, commentWordingPatterns: commentWordingRules });
    result.commentWording = { source: commentWordingSource, count: commentWordingRules.length, enabled: commentWordingEnabled };
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
   * 提交前自动清理代码注释措辞（comment-wording）：
   * 对本次变更中的代码/前端标记文件逐行改写「记录用户指令」类措辞为中性说明
   * （保留日期与功能语义），改写写回工作区文件后再走审计与提交（git add -A 会收录）。
   * dryRun：只统计不改写（预览将清理多少）。
   * @returns {{ ok:boolean, cleanedFiles:number, cleanedCount:number, skipped:number, dryRun?:boolean, error?:string }}
   */
  function autoCleanCommentWording(repoPath, { dryRun = false } = {}) {
    try {
      const d = getDiff(repoPath);
      if (!d.ok) return { ok: false, error: d.error || 'git diff 失败' };
      const CODE_MARKUP = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'php', 'rb', 'sh', 'bash', 'html', 'htm', 'css']);
      let cleanedFiles = 0, cleanedCount = 0, skipped = 0;
      for (const f of d.files) {
        if (f.isBinary) continue;
        const ext = (f.path.split('.').pop() || '').toLowerCase();
        if (!CODE_MARKUP.has(ext)) continue;
        const full = join(repoPath, f.path);
        let text;
        try { text = readFileSync(full, 'utf8'); } catch { skipped++; continue; }
        // 2026-09-07：与审计检测同规则——文件头声明 dsh-skip-sensitive 的文件跳过自动清理
        // （测试文件常把检测目标措辞当输入数据，加文件头豁免可防止被当作违规措辞误删）
        if (hasFileHeaderExempt(text)) { skipped++; continue; }
        const extra = commentWordingEnabled ? commentWordingRules.map((x) => { try { return new RegExp(x.pattern); } catch { return null; } }).filter(Boolean) : [];
        const r = cleanCommentWording(text, extra);
        if (r.count === 0) continue;
        cleanedCount += r.count;
        cleanedFiles++;
        if (!dryRun) {
          try { writeFileSync(full, r.text); } catch { skipped++; }
        }
      }
      return { ok: true, cleanedFiles, cleanedCount, skipped, dryRun: !!dryRun };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }

  /**
   * 提交前 README 预览（2026-08-20）：把仓库 README 发到会话，逐级回退——
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
  async function commitWithAudit({ repo, message, push, dryRun, audit, llmAudit: llm, showReadme = true, requirementsConfirmed = false, customIgnorePatterns = '' }) {
    // 2026-08-20：提交前 README 预览（默认开，showReadme=false 可关）——把仓库 README 发到会话
    let readmePreview = null;
    if (showReadme && !dryRun) {
      try { readmePreview = await previewReadme(repo); } catch (e) { readmePreview = { mode: 'none', error: String(e?.message ?? e) }; }
    }
    const wantAudit = audit !== false && auditEnabled;
    // 2026-09-06：提交前先自动清理代码注释措辞（comment-wording）——真实提交改写工作区，
    // dryRun 只统计（同一份输出回给用户预览）。改写后 git add -A 收录，随后审计见到的已是清理后文件。
    let autoClean = null;
    if (!dryRun) {
      autoClean = autoCleanCommentWording(repo, { dryRun: false });
    } else {
      autoClean = autoCleanCommentWording(repo, { dryRun: true });
    }
    const autoCleanBlock = {};
    if (autoClean?.cleanedCount > 0) {
      autoCleanBlock.autoClean = autoClean;
    } else if (autoClean && !autoClean.ok) {
      autoCleanBlock.autoClean = autoClean;
    }
    if (wantAudit) {
      const auditResult = await auditRepoPath(repo, { forceLlm: !!llm });
      if (auditResult.blocked && !dryRun) {
        return { ok: false, blocked: true, error: `审计未通过，拦截提交（${auditResult.summary.total} 个问题，blockOn=${blockOn}）`, findings: auditResult.findings, summary: auditResult.summary, ...(readmePreview ? { readmePreview } : {}) };
      }
      const auditOk = { ok: true, audited: true, blocked: false, findings: auditResult.findings, summary: auditResult.summary, ...(auditResult.llmError ? { llmError: auditResult.llmError } : {}), ...(auditResult.llmRoute ? { llmRoute: auditResult.llmRoute } : {}) };
      const result = await commitAndPush({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun, requirementsConfirmed, workspaceRoot, customIgnorePatterns });
      if (result.ok && result.push?.pushed) result.repoIndex = await maintainRepoIndex();
      return { ...result, audit: auditOk, ...autoCleanBlock, ...(readmePreview ? { readmePreview } : {}) };
    }
    const result = await commitAndPush({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun, requirementsConfirmed, workspaceRoot, customIgnorePatterns });
    if (result.ok && result.push?.pushed) result.repoIndex = await maintainRepoIndex();
    return { ...result, audit: { ok: true, audited: false, note: '审计已关闭或 dryRun' }, ...autoCleanBlock, ...(readmePreview ? { readmePreview } : {}) };
  }

  /* ------------------------------ 推送许可自动触发（v1.24.0，整合 dsh-task-completion） ------------------------------ */
  // 语义：AI 回复含 ✅ 且许可开启（pushOnComplete=true）→ 回合结束对扫描范围内有变更的仓库
  // 逐个走 commitWithAudit（带审计门禁）——不复刻旧插件的无审计旁路。默认关闭，绝不自动推。
  let autoPushRunning = false; // 并发闸：同时只跑一个自动推送
  const permitLastTurns = new Map(); // sessionId -> 已处理 turn（去重）
  const permitTimers = new Map(); // sessionId -> 防抖 timer

  function schedulePermitCheck(session, event) {
    const sessionId = session?.id;
    if (typeof sessionId !== 'string') return;
    const turn = event?.data?.turn ?? 0;
    if (permitLastTurns.get(sessionId) === turn) return;
    const existing = permitTimers.get(sessionId);
    if (existing !== void 0) clearTimeout(existing);
    const timer = setTimeout(() => {
      permitTimers.delete(sessionId);
      runPermitCheck(session, turn).catch((error) => {
        log.warn(`推送许可检查失败 ${sessionId}: ${String(error?.message ?? error)}`);
      });
    }, 800); // 等回合收尾事件落盘
    timer.unref?.();
    permitTimers.set(sessionId, timer);
  }

  /** 一次回合结束检查：检测完成标记 → 许可开启则逐个仓库走带审计的自动推送。 */
  async function runPermitCheck(session, turn) {
    const sessionId = session?.id;
    const state = readPermit(workspaceRoot);
    const text = extractLastAssistantText(session?.events);
    const decision = shouldAutoPush({ text, permitted: state.pushOnComplete });
    writePermit(workspaceRoot, {
      lastAttempt: {
        at: new Date().toISOString(),
        sessionId,
        turn,
        trigger: decision.trigger,
        marker: decision.marker ?? 'none',
        reason: decision.reason,
      },
    });
    permitLastTurns.set(sessionId, turn);
    if (!decision.trigger) {
      log.info(`回合 ${turn} 不触发自动推送: ${decision.reason}`);
      return { trigger: false, reason: decision.reason };
    }
    log.info(`回合 ${turn} 触发自动推送（许可开启，pushScope=${state.pushScope}）`);
    return runPermitAutoPush(session, turn, state);
  }

  /** 实际执行：解析目标仓库 → 逐个 commitWithAudit（审计拦截/失败逐仓记录，不静默）。 */
  async function runPermitAutoPush(session, turn, state) {
    if (autoPushRunning) {
      return { trigger: true, ok: false, reason: '已有自动推送在进行，跳过本次' };
    }
    autoPushRunning = true;
    try {
      const targets = resolvePermitTargets(state.pushScope, session);
      if (targets.error) {
        const msg = `无推送目标: ${targets.error}`;
        log.info(msg);
        return { trigger: true, ok: false, reason: msg };
      }
      const results = [];
      let committed = 0;
      let pushed = 0;
      for (const repoPath of targets.paths) {
        const res = await commitWithAudit({
          repo: repoPath, message: permitCommitMessage, push: true, audit: true, showReadme: false, customIgnorePatterns,
        });
        results.push({
          repo: repoPath,
          ok: !!res.ok,
          committed: !!res.committed,
          pushed: !!res.push?.pushed,
          blocked: !!res.blocked,
          error: res.error || '',
        });
        if (res.ok && res.committed) committed += 1;
        if (res.ok && res.push?.pushed) pushed += 1;
      }
      const summary = `自动推送完成: ${committed} 个仓库提交, ${pushed} 个仓库推送`;
      const current = readPermit(workspaceRoot);
      writePermit(workspaceRoot, {
        ...current,
        lastAutoPush: {
          at: new Date().toISOString(),
          sessionId: session?.id,
          turn,
          summary,
          results,
        },
      });
      log.info(summary);
      return { trigger: true, ok: true, summary, results };
    } finally {
      autoPushRunning = false;
    }
  }

  /** 计算本次自动推送的目标仓库路径列表（pushScope=all → 全部有变更；session → 仅会话 cwd 所在仓库）。 */
  function resolvePermitTargets(pushScope, session) {
    const allChanged = () => scanRepos({ root: workspaceRoot, depth, extraRepos, extraReposFile })
      .filter((r) => r.changes > 0)
      .map((r) => r.path);
    if (pushScope !== 'session') return { paths: allChanged(), error: '' };
    const cwd = session?.header?.cwd;
    if (!cwd) return { paths: [], error: '会话无 cwd' };
    const top = runGit(['rev-parse', '--show-toplevel'], cwd);
    if (top.status === 0 && top.stdout) return { paths: [top.stdout], error: '' };
    const repos = scanRepos({ root: workspaceRoot, depth, extraRepos, extraReposFile });
    const matched = repos.filter((r) => cwd === r.path || cwd.startsWith(r.path + '/'));
    if (matched.length === 0) {
      return { paths: [], error: `会话目录不在任何 git 仓库（${cwd}）` };
    }
    return { paths: matched.map((r) => r.path), error: '' };
  }

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return;
    schedulePermitCheck(session, event);
  });

  ctx.effect(() => {
    return () => {
      for (const timer of permitTimers.values()) clearTimeout(timer);
      permitTimers.clear();
    };
  }, 'git-push: permit timers');

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
            return respond(res, { ok: true, email: r.email, privateKey: r.privateKey, pubFile: r.pubFile, pub: r.pub, note: '公钥已写入同级仓 *.pub，可复制粘贴到 GitHub → Settings → SSH and GPG keys' });
          }
          if (p === '/api/git-push/status' && m === 'GET') {
            return respond(res, {
              ok: true, plugin: 'dsh-git-push', version: __VERSION__,
              workspaceRoot, extraRepos, extraReposFile: extraReposFile || '(未配置)', depth,
              audit: { auditEnabled, blockOn, llmAudit: llmAuditOn, llmAuditProvider: llmAuditProvider || '(未配置)', llmAuditModel: llmAuditModel || '(未配置)', exemptRepos },
              commentWording: { enabled: commentWordingEnabled, source: commentWordingSource, count: commentWordingRules.length, rulesFile: commentWordingRulesFile || '(未配置)', error: commentWordingError || undefined },
              repoIndex: { enabled: repoIndexEnabled, tokenPath: repoIndexTokenPath || '(未配置)', syncTarget: repoIndexSyncTarget || '(自动: dsh-git-push-User/<owner>/dsh-repo-index.json)' },
              git: runGitVersion(),
            });
          }
          if (p === '/api/git-push/rules' && m === 'GET') {
            const qTarget = url.searchParams.get('target') || '';
            if (qTarget === 'export') {
              const exported = exportCommentWordingRules(commentWordingRules);
              return respond(res, { ok: true, exported, source: commentWordingSource, count: commentWordingRules.length });
            }
            return respond(res, { ok: true, source: commentWordingSource, count: commentWordingRules.length, rules: commentWordingRules, enabled: commentWordingEnabled, error: commentWordingError || undefined });
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
            commentWordingRules = parsed;
            commentWordingSource = 'import(' + sourceDesc + ')';
            commentWordingError = '';
            return respond(res, { ok: true, count: parsed.length, source: commentWordingSource, targetFile, rules: parsed });
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
            const result = await commitWithAudit({ repo, message, push, dryRun, audit, llmAudit: llm, customIgnorePatterns });
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
        const result = await commitWithAudit({ ...params, customIgnorePatterns });
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
      description: '对指定 git 仓库按模板生成 README。模板在同级仓 dsh-git-push-User/readme-template.md（每人一份，可改章节）；没有该文件时用插件内置默认骨架。占位符 {{name}} {{description}} {{version}} {{toc}} {{versionTable}}。repo 传仓库绝对路径。writePath 可选指定写入路径，默认只返回内容不写文件。',
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
          return JSON.stringify({ ok: true, source: commentWordingSource, count: commentWordingRules.length, exported: exportCommentWordingRules(commentWordingRules), hint: 'exported 可直接粘贴到设置 commentWordingCustom，或存文件后填到 commentWordingRulesFile' }, null, 2);
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
          commentWordingRules = parsed;
          commentWordingSource = 'import(' + sourceDesc + ')';
          commentWordingError = '';
          return JSON.stringify({ ok: true, count: parsed.length, source: commentWordingSource, targetFile, note: '已即时生效，重启不丢（规则文件持久化）' }, null, 2);
        }
        return JSON.stringify({ ok: true, source: commentWordingSource, count: commentWordingRules.length, rules: commentWordingRules, enabled: commentWordingEnabled, error: commentWordingError || undefined }, null, 2);
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

function runGitVersion() {
  try {
    return execSync('git --version', { encoding: 'utf8' }).trim();
  } catch {
    return 'git 不可用';
  }
}
