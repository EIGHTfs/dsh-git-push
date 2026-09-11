/**
 * dsh-git-push — 审计提交总入口（commitWithAudit）
 * dsh-skip-i18n: 插件为中文零依赖，用户可见文案硬编码为产品设计
 *
 * git_commit_push 工具的核心逻辑抽成独立函数：
 *   - 供 lib/index.js 的 callTool('git_commit_push') 复用（单一实现）
 *   - 供外部插件（dsh-session-conductor 自动推送）动态 import 调用——
 *     自动推送带审计门禁（blocker 拦截 + 敏感扫描 + .gitignore），不再裸 commit+push
 * 返回结构含 audit 摘要，调用方（工具/外部插件）可据此判断「被阻断」。
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { auditWithScope } from './audit/index.js';
import { scoreQuality } from './score/index.js';
import { commitAndPush } from './git/index.js';
import { defaultConfig } from './client/index.js';

/**
 * 带审计门禁的提交推送（git_commit_push 工具同一实现）。
 * @param {object} p
 *   { repoPath, message, push?, dryRun?, audit?, auditLevel?, rulesetDir? }
 *   audit 缺省取插件配置 auditEnabled；auditLevel/rulesetDir 缺省取插件配置。
 * @returns {Promise<object>} 审计放行 → commitAndPush 结果（含 audit 摘要）；
 *   blocker 命中 → { ok:false, blocked:true, audit }，不执行 git 操作
 */
export async function commitWithAudit({
  repoPath = '',
  message = '',
  push = true,
  dryRun = false,
  audit,
  auditLevel,
  rulesetDir,
  slots,
  customIgnorePatterns = '',
  requirementsConfirmed = false,
} = {}) {
  const cfg = defaultConfig();
  const doAudit = audit ?? cfg.auditEnabled;
  let auditResult = null;
  if (doAudit) {
    const res = auditWithScope(repoPath || '.', {
      scope: cfg.auditScanScope || 'diff',
      auditLevel: auditLevel || cfg.auditLevel || 'standard',
      rulesetDir: rulesetDir || cfg.auditRuleset || '',
      slots: slots || cfg.auditRuleOrder || undefined,
    });
    auditResult = { summary: res.summary, quality: scoreQuality(res.findings) };
    if (res.summary.blocker > 0) {
      return { ok: false, blocked: true, error: `审计拦截：${res.summary.blocker} 个 blocker`, audit: auditResult };
    }
  }
  const r = await commitAndPush({ repoPath, message, push, dryRun, customIgnorePatterns, requirementsConfirmed });
  return { ok: r.ok !== false, ...r, audit: auditResult };
}

/**
 * 批量提交推送（D16，对齐 v1 commitMany）：对每个仓库依次 commitAndPush，返回逐仓结果数组。
 * 注意：仅做提交推送（不含审计门禁）——审计请用 commitWithAudit 逐仓调用。
 * @param {{repos: string[], message: string, push?: boolean, dryRun?: boolean, requirementsConfirmed?: boolean, customIgnorePatterns?: string}} opts
 * @returns {Promise<Array<{repo: string, ...commitAndPush 结果}>>}
 */
export async function commitMany({ repos = [], message = '', push = true, dryRun = false, requirementsConfirmed = false, customIgnorePatterns = '' } = {}) {
  const results = [];
  for (const repoPath of repos) {
    results.push({ repo: repoPath, ...(await commitAndPush({ repoPath, message, push, dryRun, customIgnorePatterns, requirementsConfirmed })) });
  }
  return results;
}