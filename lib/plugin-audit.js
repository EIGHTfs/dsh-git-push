/**
 * dsh-git-push — 审计服务层（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * auditRepoPath：单仓库审计（L0 必跑 + L1 按开关），可见性决定拦截力度与敏感豁免。
 * autoCleanCommentWording：提交前自动清理代码注释措辞（comment-wording）。
 * isUserRepoPath：识别 user 仓（历史 dsh-git-push-User 或 -User 结尾），审计特殊照顾。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditRepo, cleanCommentWording } from './audit.js';
import { getCompiledRulePack } from './rule-packs.js';
import { llmAudit } from './llm.js';
import { getDiff, resolveValidGitToken, detectRepoVisibility, setRepoVisibility, hasFileHeaderExempt } from './core.js';

/** 创建审计服务：返回 { isUserRepoPath, auditRepoPath, autoCleanCommentWording }。 */
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
        const extra = commentWordingEnabled ? env.commentWordingRules.map((x) => { try { return new RegExp(x.pattern); } catch { return null; } }).filter(Boolean) : [];
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

  return { isUserRepoPath, auditRepoPath, autoCleanCommentWording };
}
