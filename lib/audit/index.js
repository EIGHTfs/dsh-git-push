/**
 * dsh-git-push-v2 审计总入口
 *
 * 统一入口：auditWithScope(repo, { scope }) —— 变动 / 全量。
 * - auditChanged：git diff HEAD（仅 git 项目）
 * - auditFull：目录全量扫描（非 git 项目也可查；默认排除 .gitignore 忽略文件）
 * - 统一问题对象：{ file, line, rule, kind, dimensions[], severity, exemptHint, scoreImpact }
 */
import { loadRuleFiles } from '../rule/loader.js';

/** 统一问题对象构造器（所有审计检查的出口）。 */
export function makeFinding({ file, line, rule, kind, severity = 'warning', message, dimensions = [], exemptHint = '', scoreImpact = 0 }) {
  return { file, line, rule, kind, severity, message, dimensions, exemptHint, scoreImpact };
}

/** 变动审计：git diff HEAD（仅 git 项目；files 为空时内部走 diff）。 */
export function auditChanged(repoPath, opts = {}) {
  // 框架骨架：1.1.2 接入具体实现
  return { ok: true, scope: 'changed', repo: repoPath, findings: [], summary: { blocker: 0, warning: 0, total: 0 } };
}

/** 全量审计：目录递归扫描（非 git 项目可查）。 */
export function auditFull(repoPath, opts = {}) {
  // 框架骨架：1.1.2 接入具体实现
  return { ok: true, scope: 'full', repo: repoPath, findings: [], summary: { blocker: 0, warning: 0, total: 0 } };
}

/** 统一审计入口（设置项 auditScanScope 决定默认走哪个）。 */
export function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {
  return scope === 'full' ? auditFull(repoPath, opts) : auditChanged(repoPath, opts);
}