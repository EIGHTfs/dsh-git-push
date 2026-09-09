/**
 * dsh-git-push — 插件运行环境解析 + 设置页注册（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * resolvePluginEnv：config 规范化 → 审计规则包装载 → comment-wording 规则解析，产出全模块共享的 env 对象。
 *   闭包可变状态（设置页 watch / HTTP / 工具会改写的字段）全部收敛为 env 属性，语义与原 let 闭包一致。
 * registerSettings：设置 → 插件 → 插件配置 卡片注册 + 凭据落盘 + 运行期字段同步。
 */
import { setDefaultGithubOwner } from './core.js';
import { githubTokenStatus, persistGithubToken, persistSshPub } from './core.js';
import { initAuditRuleset } from './audit.js';
import { loadCommentWordingRulesSync, fetchCommentWordingRules, DEFAULT_COMMENT_WORDING_PATTERNS } from './rules.js';
import { Config, GIT_PUSH_SETTINGS_NS } from './plugin-config.js';
import { getRuleSlotMeta } from './rule-packs.js';

/** 解析审计相关配置：enabled/blockOn/ruleset 选择与装载（initAuditRuleset 有副作用，保持原位调用时机）。 */
function parseAuditCfg(config, log) {
  const auditEnabled = config.auditEnabled !== false;
  const blockOn = config.blockOn === 'any' ? 'any' : 'blocker'; // 默认仅拦截严重问题
  // v1.47.0 审计规则引擎 YAML 化：来源 = 四份 YAML 有序装载（后覆盖前）。
  // 顺序：auditRuleOrder（数组）优先 → auditRuleset（逗号分隔槽位）→ 缺省 nodejs,frontend,comment（template 不加载）。
  // auditRuleWeights：侧边栏「调权重」写回（pattern 权重覆盖，参与进门禁判定）。
  const auditRulesetChoice = typeof config.auditRuleset === 'string' ? config.auditRuleset.trim() : '';
  const orderCfg = Array.isArray(config.auditRuleOrder) && config.auditRuleOrder.length
    ? config.auditRuleOrder
    : (auditRulesetChoice ? auditRulesetChoice.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  const weightsCfg = (config.auditRuleWeights && typeof config.auditRuleWeights === 'object') ? config.auditRuleWeights : undefined;
  const auditRuleset = initAuditRuleset({ order: orderCfg, weights: weightsCfg });
  if (auditRuleset.errors?.length) {
    log.warn(`审计规则装载告警: ${auditRuleset.errors.join('；')}`);
  }
  log.info(`审计规则: ${auditRuleset.meta.name}@${auditRuleset.meta.version} (order=${auditRuleset.meta.order.join('→')}, secret=${auditRuleset.secretPatterns.length} wording=${auditRuleset.wordingPatterns.length} docConv=${auditRuleset.docConvPatterns.length} style=${auditRuleset.styleRules.length})`);
  return { auditEnabled, blockOn, auditRulesetChoice, auditRuleset };
}

/** 解析 LLM 审计与仓库索引相关配置。 */
function parseLlmAndRepoIndexCfg(config) {
  const llmAuditOn = config.llmAudit === true;
  const llmAuditProvider = typeof config.llmAuditProvider === 'string' ? config.llmAuditProvider : '';
  const llmAuditModel = typeof config.llmAuditModel === 'string' ? config.llmAuditModel : '';
  const maxDiffBytes = Number(config.maxDiffBytes) || 6000;
  const repoIndexEnabled = config.repoIndexEnabled !== false;
  const repoIndexTokenPath = typeof config.repoIndexTokenPath === 'string' ? config.repoIndexTokenPath : '';
  const repoIndexSyncTarget = typeof config.repoIndexSyncTarget === 'string' ? config.repoIndexSyncTarget : '';
  const repoIndexLocalOnly = Array.isArray(config.repoIndexLocalOnly) ? config.repoIndexLocalOnly : [];
  return { llmAuditOn, llmAuditProvider, llmAuditModel, maxDiffBytes, repoIndexEnabled, repoIndexTokenPath, repoIndexSyncTarget, repoIndexLocalOnly };
}

/** 解析推送许可与忽略/扫描范围相关配置（运行期可变字段保持 config 直读，设置页 watch 覆盖即时生效）。 */
function parsePermitAndRuntimeCfg(config) {
  const exemptRepos = Array.isArray(config.exemptRepos) ? config.exemptRepos.map((x) => String(x)) : [];
  const pushScopeCfg = config.pushScope === 'session' ? 'session' : 'all'; // v1.24.0 推送许可 scope
  const permitCommitMessage = typeof config.commitMessage === 'string' && config.commitMessage.trim()
    ? config.commitMessage.trim() : 'chore(ai): 任务完成自动提交';
  // v1.28.0 自定义忽略 pattern（逗号/换行分隔，如 *.bak*）：提交时自动追加到目标仓库 .gitignore
  // v1.30.0：改为 let —— 设置页改动经 settings scope.watch 同步覆盖（见 settings 注册处），运行期即时生效
  const customIgnorePatterns = typeof config.customIgnorePatterns === 'string' ? config.customIgnorePatterns.trim() : '';
  // v1.36.1：硬编码审计扫描范围（设置页开关，运行期可 watch 覆盖）
  const hardcodeFullScan = config.hardcodeFullScan === true;
  // v1.54.0：YAML 检查模式（js-yaml 默认 / heuristic 启发式兜底；设置页下拉，运行期 watch 即时生效）
  const yamlCheckMode = config.yamlCheckMode === 'heuristic' ? 'heuristic' : 'js-yaml';
  return { exemptRepos, pushScopeCfg, permitCommitMessage, customIgnorePatterns, hardcodeFullScan, yamlCheckMode };
}

/**
 * 解析 comment-wording 规则配置（2026-09-06 设置 → 插件 → git-push 可自定义）。
 * 规则来源优先级：commentWordingCustom（设置里直接填 JSON 文本）
 *   > commentWordingRulesFile（规则文件地址：本地路径或 http(s) URL，在线导入填地址即可）
 *   > 内置默认。启动时解析一次存内存（URL 场景 await fetch，失败回退内置并告警）。
 */
async function parseCommentWordingCfg(config, log) {
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
  return { commentWordingEnabled, commentWordingRulesFile, commentWordingRules, commentWordingSource, commentWordingError };
}

/** 解析配置并装载规则包，产出插件运行环境 env（所有拆分模块共享的唯一状态源）。 */
export async function resolvePluginEnv(ctx, config = {}) {
  // v1.42.0 修复：log 必须先于审计规则块创建（v1.41.0 起第 101/103 行在 const log 声明前使用 log，
  // 静态插件普通 ESM 作用域下会 TDZ ReferenceError——旧运行实例还是 v1.39.0 副本未爆雷）。
  const log = ctx.logger('git-push');
  const enabled = config.enabled !== false;
  const workspaceRoot = config.workspaceRoot || process.cwd();
  // D7 (v1.40.0)：默认 owner 可配置（config.githubOwner）——ensureRemoteRepo / repo-index / 模板兜底用它，不再硬编码 EIGHTfs
  const githubOwnerCfg = typeof config.githubOwner === 'string' ? config.githubOwner.trim() : '';
  if (githubOwnerCfg) setDefaultGithubOwner(githubOwnerCfg);
  const extraRepos = Array.isArray(config.extraRepos) ? config.extraRepos : [];
  const extraReposFile = typeof config.extraReposFile === 'string' ? config.extraReposFile : '';
  const depth = Number(config.depth) || 3;
  const { auditEnabled, blockOn, auditRulesetChoice, auditRuleset } = parseAuditCfg(config, log);
  const { llmAuditOn, llmAuditProvider, llmAuditModel, maxDiffBytes, repoIndexEnabled, repoIndexTokenPath, repoIndexSyncTarget, repoIndexLocalOnly } = parseLlmAndRepoIndexCfg(config);
  const { exemptRepos, pushScopeCfg, permitCommitMessage, customIgnorePatterns, hardcodeFullScan, yamlCheckMode } = parsePermitAndRuntimeCfg(config);
  // v1.59.0：质量维度权重覆盖（侧边栏滑块写回，维度名 → 权重；得分质量评分 qualityWeights 覆盖 yaml/默认）
  const qualityWeights = (config.qualityWeights && typeof config.qualityWeights === 'object') ? config.qualityWeights : {};
  const { commentWordingEnabled, commentWordingRulesFile, commentWordingRules, commentWordingSource, commentWordingError } = await parseCommentWordingCfg(config, log);
  return {
    ctx, config, log, enabled, workspaceRoot, githubOwnerCfg,
    extraRepos, extraReposFile, depth,
    auditEnabled, blockOn, auditRulesetChoice, auditRuleset,
    llmAuditOn, llmAuditProvider, llmAuditModel, maxDiffBytes,
    repoIndexEnabled, repoIndexTokenPath, repoIndexSyncTarget, repoIndexLocalOnly,
    exemptRepos, pushScopeCfg, permitCommitMessage, injectFullSkill: config.injectFullSkill === true,
    // 运行期可变字段（原 let 闭包语义 → env 属性；设置页/HTTP/工具改写，读方实时取值）
    customIgnorePatterns, hardcodeFullScan, yamlCheckMode, qualityWeights,
    injectRepoIndexFull: config.injectRepoIndexFull === true,
    commentWordingEnabled, commentWordingRulesFile, commentWordingRules, commentWordingSource, commentWordingError,
  };
}

/** 设置 → 插件 → 插件配置：填写 GitHub token 落盘到插件配置目录 + 运行期字段即时同步。 */
export function registerSettings(ctx, env) {
  const { config, log, workspaceRoot } = env;
  // 设置 → 插件 → 插件配置：填写 GitHub token，落到插件配置目录 github-token（不进 settings.yaml 明文；v1.40.0 原同级仓废除）
  // 「插件配置填写凭据，入口在设置里面」
  ctx.inject(['settings'], (settingsCtx) => {
    const tok = githubTokenStatus({ workspaceRoot });
    // v1.52.0：动态槽位元数据（client 规则卡显示名/清单来源）——从规则目录发现（扫描 audit-rules/*.yml）
    // 而非硬编码；client 拿不到文件系统，经 config snapshot 读取。新增规则 yml 重启后自动出现。
    const ruleSlotMeta = getRuleSlotMeta();
    const entry = { githubToken: '', sshPub: '', tokenConfigured: tok.configured, commentWordingEnabled: true, commentWordingCustom: '', commentWordingRulesFile: '', commentWordingRulesUrl: '', envInjectionEnabled: true, envInjectionTools: '', injectFullSkill: false, injectRepoIndexFull: false, customIgnorePatterns: '', hardcodeFullScan: false, yamlCheckMode: 'js-yaml', ruleSlotMeta };
    const scope = settingsCtx.settings.register(GIT_PUSH_SETTINGS_NS, Config, { base: entry });
    scope.watch(async (next) => {
      // v1.30.0：设置页改动 → 同步覆盖运行期变量（injectFullSkill / customIgnorePatterns 即时生效，
      // 不再只有 token/sshPub 落盘；注意 next 是完整快照，可能不含未改字段，用 typeof 判断）
      if (next && typeof next.injectFullSkill === 'boolean') {
        env.injectFullSkill = next.injectFullSkill;
        log.info(`injectFullSkill 设置已更新 → ${env.injectFullSkill}（设置页即时生效）`);
      }
      if (next && typeof next.injectRepoIndexFull === 'boolean') {
        env.injectRepoIndexFull = next.injectRepoIndexFull;
        log.info(`injectRepoIndexFull 设置已更新 → ${env.injectRepoIndexFull}（设置页即时生效）`);
      }
      if (next && typeof next.customIgnorePatterns === 'string') {
        env.customIgnorePatterns = next.customIgnorePatterns.trim();
        log.info(`customIgnorePatterns 设置已更新 → ${env.customIgnorePatterns || '(空)'}`);
      }
      if (next && typeof next.hardcodeFullScan === 'boolean') {
        env.hardcodeFullScan = next.hardcodeFullScan;
        log.info(`hardcodeFullScan 设置已更新 → ${env.hardcodeFullScan}（硬编码审计${env.hardcodeFullScan ? '全量扫' : '只扫新增行'}）`);
      }
      if (next && typeof next.yamlCheckMode === 'string' && next.yamlCheckMode !== env.yamlCheckMode) {
        env.yamlCheckMode = next.yamlCheckMode === 'heuristic' ? 'heuristic' : 'js-yaml';
        log.info(`yamlCheckMode 设置已更新 → ${env.yamlCheckMode}（YAML 检查：${env.yamlCheckMode === 'js-yaml' ? '真实解析' : '宽松启发式'}）`);
      }
// v1.59.0：质量维度权重写回（侧边栏滑块 → config.qualityWeights → env.qualityWeights，质量评分即时生效）
      if (next && next.qualityWeights && typeof next.qualityWeights === 'object') {
        env.qualityWeights = next.qualityWeights;
        if (Object.keys(next.qualityWeights).length) log.info(`qualityWeights 设置已更新 → ${Object.keys(next.qualityWeights).join(',')}（质量维度权重覆盖）`);
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
}
