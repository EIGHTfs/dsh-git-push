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
import { isSampleExemptDir } from './exempt/index.js';

/**
 * 同步执行审计门禁（不跑 git）。供 git_commit_push 后台化方案复用：审计同步即时
 *   拦截，通过后再把 commit+push 丢后台。返回 { ok, blocked?, error?, audit }。
 * @param {object} p { repoPath, audit?, auditLevel?, rulesetDir?, slots?, cfg? }
 */
export function runAudit({ repoPath = '', audit, auditLevel, rulesetDir, slots, cfg: extCfg } = {}) {
  const cfg = extCfg || defaultConfig();
  const doAudit = audit ?? cfg.auditEnabled;
  if (!doAudit) return { ok: true, audit: null };
  const slotOrder = Array.isArray(slots) && slots.length ? slots
    : Array.isArray(cfg.auditRuleOrder) && cfg.auditRuleOrder.length ? cfg.auditRuleOrder
    : undefined;
  const auditRes = auditWithScope(repoPath || '.', {
    scope: cfg.auditScanScope || 'diff',
    maxScanFiles: cfg.maxScanFiles,
    auditLevel: auditLevel || cfg.auditLevel || 'standard',
    rulesetDir: rulesetDir || cfg.auditRuleset || '',
    slots: slotOrder,
    disabledSlots: Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [],
  });
  // 2026-09-15 修复：提交前审计同样消费侧边栏权重覆盖（cfg.weightOverrides，config.json 回读），
  //   与 code_audit 工具同源——此前传空权重，评分恒用默认权重表（侧边栏权重设置对提交审计无效）。
  let auditWeights = {};
  if (typeof cfg.weightOverrides === 'string' && cfg.weightOverrides.trim()) {
    try { auditWeights = JSON.parse(cfg.weightOverrides) || {}; } catch { /* 非法 JSON 回退默认 */ }
  }
  const auditOut = { summary: auditRes.summary, quality: scoreQuality(auditRes.findings, auditWeights, { files: auditRes.files }) };
  // 2026-09-15：audit 结果带 findings——拦截时直接列出被拦文件/规则（和全量审计一致），
  //   不再只说「N 个 blocker」说不清是哪些；同时保留全部 findings 供调用方展示 warning 等
  auditOut.findings = auditRes.findings || [];
  // 只算非示例目录的 blocker（示例目录内的 blocker 是规则演示，不拦真实提交）
  const blocked = auditRes.findings.filter((f) => f.severity === 'blocker' && !isSampleExemptDir(repoPath || '.', f.file));
  if (blocked.length > 0) {
    const list = blocked.map((f) => {
      const where = f.file ? ` ${f.file}` + (f.line ? `:${f.line}` : '') : '';
      const why = f.rule || f.message || '';
      return where + (why ? `（${why}）` : '');
    });
    return {
      ok: false,
      blocked: true,
      error: `审计拦截：${blocked.length} 个 blocker → ${list.join('；')}`,
      audit: auditOut,
    };
  }
  return { ok: true, audit: auditOut };
}

/**
 * 带审计门禁的提交推送（git_commit_push 工具旧同步实现，仍保留供外部插件/批量复用）。
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
  force = false,
  pushMethod,
} = {}) {
  const cfg = defaultConfig();
  const a = runAudit({ repoPath, audit, auditLevel, rulesetDir, slots });
  if (!a.ok) return { ok: false, blocked: true, error: a.error, audit: a.audit };
  // 推送通道缺省取插件配置（默认 ssh：推本地 HEAD、远端 sha 与本地一致）
  const r = await commitAndPush({ repoPath, message, push, dryRun, customIgnorePatterns, requirementsConfirmed, force, pushMethod: pushMethod || cfg.pushMethod || 'ssh' });
  return { ok: r.ok !== false, ...r, audit: a.audit };
}

/**
 * 批量提交推送（D16 commitMany）：对每个仓库依次 commitAndPush，返回逐仓结果数组。
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