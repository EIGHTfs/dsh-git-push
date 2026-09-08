/**
 * dsh-git-push — git 自动提交推送插件
 *
 * v1.42.0（D1 文件级拆分）：本文件改为纯调度器，按功能拆分到 lib/plugin-*.js：
 *   plugin-config.js        配置卡片 schema + 设置命名空间 + 插件名
 *   plugin-setup.js         配置解析/规则包装载（resolvePluginEnv）+ 设置页注册
 *   plugin-context-inject.js 上下文注入：systemPrompt 三段 + agent/pre-step（skill / repo-index）
 *   repo-index-sync.js      dsh-repo-index.json 自动维护（推送成功后重建）
 *   plugin-audit.js         审计服务：auditRepoPath / autoCleanCommentWording / isUserRepoPath
 *   plugin-commit-flow.js   previewReadme + commitWithAudit（审计门禁提交流程）
 *   plugin-push-permit.js   推送许可自动触发（session/event turn/end 防抖 → 自动 commit+push）
 *   plugin-http.js          HTTP API：/git-push/viewer + /api/git-push/*（含 runGitVersion）
 *   plugin-tools.js         agent 工具注册（11 个 defineTool）
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
 * dsh-repo-index 维护（v1.3.0 新增 / v1.27.0 改 JSON / v1.35.0 注入）：
 *   git_commit_push 推送成功后自动重新生成 dsh-repo-index.json（md 表格已废弃）。
 *   仓库清单来自 git remote，skills 来自 package.json dsh.skills + skills/*.md，
 *   可见性来自 GitHub API（token）。权威源 = 插件配置目录 credentialsDir()/dsh-repo-index.json（v1.40.0：原同级仓废除）。
 *   会话注入：默认只给文件名；injectRepoIndexFull=true 再注入 JSON 正文。
 *
 * 配置（cordis.patch.yml config）：
 *   enabled / workspaceRoot / extraRepos / depth
 *   auditEnabled(默认 true) / blockOn(默认 'blocker') / llmAudit(默认 false)
 *   llmAuditProvider / llmAuditModel（如 'free' / 'agnes-2.5-flash'）/ maxDiffBytes
 *   repoIndexEnabled(默认 true) / repoIndexTokenPath / repoIndexSyncTarget / repoIndexLocalOnly
 */
import { existsSync, mkdirSync } from 'node:fs';
import { ensureGlobalFilemodeFalse, ensureGlobalSafeDirectoryStar, credentialsDir } from './core.js';
import { name, Config, GIT_PUSH_SETTINGS_NS } from './plugin-config.js';
import { resolvePluginEnv, registerSettings } from './plugin-setup.js';
import { registerContextInjection } from './plugin-context-inject.js';
import { createRepoIndexMaintainer } from './repo-index-sync.js';
import { createAuditor } from './plugin-audit.js';
import { createCommitFlow } from './plugin-commit-flow.js';
import { createPushPermit } from './plugin-push-permit.js';
import { registerHttpApi } from './plugin-http.js';
import { registerAgentTools } from './plugin-tools.js';

export { name, Config, GIT_PUSH_SETTINGS_NS };

/**
 * 插件入口（apply 函数形态）。拆分后只保留调度职责，副作用注册顺序与拆分前完全一致：
 * 解析环境 → 注册设置页 → 未启用提前返回 → 注入注册（systemPrompt + pre-step）→
 * git 全局配置 + 凭据目录 → 服务组装 → session 监听 + effect 清理 → HTTP → 工具。
 */
export async function apply(ctx, config = {}) {
  // v1.42.0：配置规范化 + 规则包装载 + comment-wording 解析（原 apply 开头段，含 log TDZ 修复）
  const env = await resolvePluginEnv(ctx, config);
  const { log, enabled, workspaceRoot, auditEnabled, blockOn, llmAuditOn, repoIndexEnabled } = env;

  // 设置 → 插件 → 插件配置：凭据落盘 + 运行期字段即时同步（在 enabled 检查之前，与拆分前一致）
  registerSettings(ctx, env);

  if (!enabled) {
    log.info('已禁用（config.enabled=false）');
    return;
  }
  log.info(`启动: workspaceRoot=${workspaceRoot} auditEnabled=${auditEnabled} blockOn=${blockOn} llmAudit=${llmAuditOn} repoIndex=${repoIndexEnabled}`);

  // ── 服务组装（互 depend：commitFlow 依赖 auditor + repoIndexMaintainer；permit 依赖 commitFlow）──
  const maintainRepoIndex = createRepoIndexMaintainer(env);
  const auditor = createAuditor(ctx, env);
  const commitFlow = createCommitFlow(env, {
    auditRepoPath: auditor.auditRepoPath,
    autoCleanCommentWording: auditor.autoCleanCommentWording,
    maintainRepoIndex,
  });
  const permit = createPushPermit(env, { commitWithAudit: commitFlow.commitWithAudit });

  // 上下文注入入口：systemPrompt 三段（功能目录 / README 检查 / 环境注入）+ agent/pre-step（skill / repo-index）
  registerContextInjection(ctx, env);

  // v1.18.4：启动时 git config --global core.filemode false（CIFS 可执行位噪声；失败不阻断启动）
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

  // v1.40.0（B1/B5）：凭据收敛进插件配置目录 credentialsDir()；目录随实例走，不入 git。
  try {
    const credDir = credentialsDir({ workspaceRoot });
    if (!existsSync(credDir)) mkdirSync(credDir, { recursive: true, mode: 0o700 });
    log.info(`插件配置目录就绪: ${credDir}`);
  } catch (e) {
    log.warn(`插件配置目录创建失败: ${e?.message || e}`);
  }

  // 推送许可：session/event turn/end 防抖监听 + 定时器 effect 清理（拆分前位于 commitWithAudit 定义之后）
  permit.registerSessionListener(ctx);

  // HTTP API：/git-push/viewer + /api/git-push/*（webServer 服务存在时）
  registerHttpApi(ctx, env, { auditRepoPath: auditor.auditRepoPath, commitWithAudit: commitFlow.commitWithAudit });

  // agent 工具：git_scan / git_commit_push / code_audit / git_gen_readme / git_remote_create /
  // git_set_visibility / git_clone / git_rebuild_history / git_push_rules / push_permit_status / push_permit_config
  registerAgentTools(ctx, env, { commitWithAudit: commitFlow.commitWithAudit, auditRepoPath: auditor.auditRepoPath });
}
