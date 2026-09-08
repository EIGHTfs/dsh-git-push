/**
 * dsh-git-push — 审计服务层（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * auditRepoPath：单仓库审计（L0 必跑 + L1 按开关），可见性决定拦截力度与敏感豁免。
 * isUserRepoPath：识别 user 仓（历史 dsh-git-push-User 或 -User 结尾），审计特殊照顾。
 */
import { join } from 'node:path';
import { auditRepo, getAuditRuleset } from './audit.js';
import { getCompiledRulePack } from './rule-packs.js';
import { fullScanRepo, compileFullScan, FULLSCAN_DEFAULTS } from './full-scan.js'; // v1.43.0：附属能力
import { llmAudit } from './llm.js';
import { getDiff, resolveValidGitToken, detectRepoVisibility, setRepoVisibility } from './core.js';

/** 创建审计服务：返回 { isUserRepoPath, auditRepoPath, fullScan }。（v1.45.0：提交前自动清理已移除——只警告不删改） */
export function createAuditor(ctx, env) {
  const { log, workspaceRoot, exemptRepos, blockOn, commentWordingEnabled, hardcodeFullScan, llmAuditOn, llmAuditProvider, llmAuditModel, maxDiffBytes } = env;

  /** 识别 user 仓（历史 dsh-git-push-User 或任意 -User 结尾目录）：审计特殊照顾——自动确保私有。
   * v1.40.0：同级仓已废除，仅对残留本地副本继续兜底。 */
  function isUserRepoPath(repoPath) {
    try {
      const base = (repoPath || '').replace(/[\\/]+$/, '');
      const name = base.split(/[\\/]/).pop() || '';
      return name === 'dsh-git-push-User' || /-User$/i.test(name);
    } catch { return false; }
  }

  /** 对单个仓库执行审计（L0 必跑 + L1 按开关/参数），返回审计结果。v1.41.0 支持按调用换规则集。 */
  async function auditRepoPath(repoPath, { forceLlm = false, ruleset } = {}) {
    // v1.41.0：ruleset 参数（builtin | 本地规则包路径 | http(s):// 在线包），缺省用启动时装载的配置规则集
    let rulesetOverride;
    if (ruleset && String(ruleset).trim()) {
      rulesetOverride = await getCompiledRulePack(String(ruleset).trim());
      if (rulesetOverride.errors?.length) log.warn(`规则集 ${String(ruleset)} 装载告警: ${rulesetOverride.errors.join('；')}`);
    }
    // 2026-09-02 私有库豁免（）：GitHub 可见性 = private → 审计算法同样跳过敏感内容规则
    // （secret / 凭据文件 / 对话措辞），语法/二进制/npm 等硬规则照常。
    // v1.37.0：可见性决定拦截力度——
    //   · private 仓：blocker 全部降级为 warning（仅警告，不拦截），敏感规则仍豁免；
    //   · public 仓：保持 blockOn 拦截（且 hardcode-ip/path 等敏感规则照常阻断）；
    //   · user 仓（dsh-git-push-User）特殊照顾：探测到 public 时自动 PATCH 改回 private。
    let effectiveExemptRepos = exemptRepos;
    let effectiveBlockOn = blockOn;
    let visibility = { visibility: 'unknown' };
    let userRepoAutoFixed = false;
    try {
      // v1.36.2：异步真校验版 token（跳过失效 token，私有库豁免探测才准）
      const tokenInfo = await resolveValidGitToken({ repoPath });
      const vis = await detectRepoVisibility({ repoPath, token: tokenInfo?.token || '' });
      visibility = vis;
      const isUserRepo = isUserRepoPath(repoPath);
      if (vis.visibility === 'private') {
        effectiveExemptRepos = [...exemptRepos, repoPath];
        effectiveBlockOn = 'none'; // 私有仓：任何问题都不拦截，仅警告
      } else if (vis.visibility === 'public') {
        // 公开仓：保持拦截。user 仓特殊照顾——自动改回私有再审计
        if (isUserRepo) {
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
    const result = auditRepo(repoPath, { blockOn: effectiveBlockOn, exemptRepos: effectiveExemptRepos, commentWordingPatterns: env.commentWordingRules, hardcodeFullScan, ruleset: rulesetOverride });
    result.commentWording = { source: env.commentWordingSource, count: env.commentWordingRules.length, enabled: commentWordingEnabled };
    if (result.exempted) result.privateExempted = true;
    result.visibility = visibility.visibility;
    if (userRepoAutoFixed) result.userRepoAutoFixed = true;
    if (visibility.visibility === 'public') result.visibilityRisk = 'public';
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
        result.blocked = effectiveBlockOn === 'any' ? result.findings.length > 0 : effectiveBlockOn === 'none' ? false : result.summary.blocker > 0;
        result.passed = !result.blocked;
      }
    }
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
