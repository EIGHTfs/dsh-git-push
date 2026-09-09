/**
 * dsh-git-push — 审计服务层（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * auditRepoPath：单仓库审计（L0 必跑 + L1 按开关），可见性决定拦截力度与敏感豁免。
 * isUserRepoPath：识别 user 仓（历史 dsh-git-push-User 或 -User 结尾），审计特殊照顾。
 * v1.48.0：主干逻辑提出工厂为模块级 helper（resolveRulesetOverride / resolveVisibilityPolicy /
 *   attachAuditMeta / runLlmAudit），工厂只留薄装配——解决 createAuditor 工厂整体超 100 行 blocker。
 */
import { join } from 'node:path';
import { auditRepo, getAuditRuleset } from './audit.js';
import { getCompiledRulePack } from './rule-packs.js';
import { fullScanRepo, compileFullScan, FULLSCAN_DEFAULTS } from './full-scan.js'; // v1.43.0：附属能力
import { llmAudit } from './llm.js';
import { getDiff, resolveValidGitToken, detectRepoVisibility, setRepoVisibility } from './core.js';

/** 识别 user 仓（历史 dsh-git-push-User 或任意 -User 结尾目录）：审计特殊照顾——自动确保私有。
 * v1.40.0：同级仓已废除，仅对残留本地副本继续兜底。 */
function isUserRepoPath(repoPath) {
  try {
    const base = (repoPath || '').replace(/[\\/]+$/, '');
    const name = base.split(/[\\/]/).pop() || '';
    return name === 'dsh-git-push-User' || /-User$/i.test(name);
  } catch { return false; }
}

/** 解析 ruleset 参数（builtin | 本地规则包路径 | http(s):// 在线包），缺省 null → 用启动时装载的配置规则集。 */
async function resolveRulesetOverride(ruleset, log) {
  if (!ruleset || !String(ruleset).trim()) return null;
  const override = await getCompiledRulePack(String(ruleset).trim());
  if (override.errors?.length) log.warn(`规则集 ${String(ruleset)} 装载告警: ${override.errors.join('；')}`);
  return override;
}

/**
 * 探测可见性 → 决定拦截力度与豁免范围（v1.37.0）：
 *   private 仓：blocker 全部降级 warning（blockOn='none' 仅警告），敏感规则豁免；
 *   public 仓：保持 blockOn 拦截；
 *   user 仓（dsh-git-push-User）探测到 public 时自动 PATCH 改回 private 再审计。
 * 返回 { effectiveExemptRepos, effectiveBlockOn, visibility, userRepoAutoFixed }；探测失败保守不豁免。
 */
async function resolveVisibilityPolicy(repoPath, { exemptRepos, blockOn }) {
  let effectiveExemptRepos = exemptRepos;
  let effectiveBlockOn = blockOn;
  let visibility = { visibility: 'unknown' };
  let userRepoAutoFixed = false;
  try {
    // v1.36.2：异步真校验版 token（跳过失效 token，私有库豁免探测才准）
    const tokenInfo = await resolveValidGitToken({ repoPath });
    const vis = await detectRepoVisibility({ repoPath, token: tokenInfo?.token || '' });
    visibility = vis;
    const isUser = isUserRepoPath(repoPath);
    if (vis.visibility === 'private') {
      effectiveExemptRepos = [...exemptRepos, repoPath];
      effectiveBlockOn = 'none'; // 私有仓：任何问题都不拦截，仅警告
    } else if (vis.visibility === 'public') {
      // 公开仓：保持拦截。user 仓特殊照顾——自动改回私有再审计
      if (isUser) {
        const fix = await setRepoVisibility({ repoPath, visibility: 'private', token: tokenInfo?.token || '' });
        if (fix.ok) {
          userRepoAutoFixed = true;
          effectiveExemptRepos = [...exemptRepos, repoPath];
          effectiveBlockOn = 'none';
          visibility = { visibility: 'private', owner: vis.owner, repo: vis.repo, autoFixed: true };
        }
      }
    }
  } catch { /* 探测失败保守不豁免 */ }
  return { effectiveExemptRepos, effectiveBlockOn, visibility, userRepoAutoFixed };
}

/** 审计结果装饰：commentWording 来源 / 私有豁免标记 / 可见性 / user 仓自动改私有标记 / public 风险。 */
function attachAuditMeta(result, { visibility, userRepoAutoFixed, commentWording, commentWordingEnabled }) {
  result.commentWording = commentWording;
  if (result.exempted) result.privateExempted = true;
  result.visibility = visibility.visibility;
  if (userRepoAutoFixed) result.userRepoAutoFixed = true;
  if (visibility.visibility === 'public') result.visibilityRisk = 'public';
}

/** L1 LLM 深度审查（无 blocker 时可选追加，结果合并进 findings 并重算 summary/blocked）。 */
async function runLlmAudit(result, { ctx, repoPath, llmAuditOn, forceLlm, llmAuditProvider, llmAuditModel, maxDiffBytes, effectiveBlockOn }) {
  const withLlm = llmAuditOn || forceLlm;
  if (!withLlm || result.findings.filter((f) => f.level === 'blocker').length > 0) return;
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
    result.blocked = effectiveBlockOn === 'any' ? result.findings.length > 0 : effectiveBlockOn === 'none' ? false : result.summary.blocker > 0;
    result.passed = !result.blocked;
  }
}

/** 创建审计服务：返回 { isUserRepoPath, auditRepoPath, fullScan }。（v1.45.0：提交前自动清理已移除——只警告不删改） */
export function createAuditor(ctx, env) {
  const {
    log, workspaceRoot, exemptRepos, blockOn, commentWordingEnabled, commentWordingSource, commentWordingRules,
    hardcodeFullScan, llmAuditOn, llmAuditProvider, llmAuditModel, maxDiffBytes, yamlCheckMode = 'js-yaml',
    qualityWeights,
  } = env;

  /** 对单个仓库执行审计（L0 必跑 + L1 按开关/参数），返回审计结果。v1.41.0 支持按调用换规则集。 */
  async function auditRepoPath(repoPath, { forceLlm = false, ruleset } = {}) {
    const rulesetOverride = await resolveRulesetOverride(ruleset, log);
    const { effectiveExemptRepos, effectiveBlockOn, visibility, userRepoAutoFixed } = await resolveVisibilityPolicy(repoPath, { exemptRepos, blockOn });
    const result = auditRepo(repoPath, {
      blockOn: effectiveBlockOn, exemptRepos: effectiveExemptRepos, commentWordingPatterns: commentWordingRules,
      hardcodeFullScan, qualityWeights, ruleset: rulesetOverride, visibility: visibility.visibility, yamlMode: yamlCheckMode,
    });
    attachAuditMeta(result, {
      visibility, userRepoAutoFixed,
      commentWording: { source: commentWordingSource, count: commentWordingRules.length, enabled: commentWordingEnabled },
      commentWordingEnabled,
    });
    await runLlmAudit(result, { ctx, repoPath, llmAuditOn, forceLlm, llmAuditProvider, llmAuditModel, maxDiffBytes, effectiveBlockOn });
    return result;
  }

  /**
   * v1.43.0：全仓 AI 对话残留注释扫描（附属能力，D5）——只读不删码，分数制报告。
   * 黑名单加分/白名单减分（规则包 fullScan 段，缺省内置），总分 ≥ 阈值标⚠警告，全部命中列 markdown 表格。
   */
  async function fullScan(repoPath, { ruleset, files } = {}) {
    if (!repoPath) return { ok: false, error: '缺少 repo' };
    let fs = getAuditRuleset()?.fullScan || compileFullScan(FULLSCAN_DEFAULTS);
    if (String(ruleset || '').trim()) {
      const override = await getCompiledRulePack(String(ruleset).trim());
      if (override.fullScan) fs = override.fullScan; else log.warn('规则包未配 fullScan 段，用内置缺省');
    }
    return fullScanRepo(repoPath, { files, fullScan: fs });
  }

  return { isUserRepoPath, auditRepoPath, fullScan };
}