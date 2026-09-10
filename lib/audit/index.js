/**
 * dsh-git-push 审计总入口
 *
 * 统一入口：auditWithScope(repo, { scope }) —— 变动 / 全量。
 * - auditChanged：git diff HEAD（仅 git 项目）
 * - auditFull：目录全量扫描（非 git 项目也可查；默认排除 .gitignore 忽略文件）
 * - 统一问题对象：{ file, line, rule, kind, dimensions[], severity, exemptHint, scoreImpact }
 */
import { collectTextFiles, readText, isGitRepo, collectChangedFiles } from './collector.js';
import { runChecks, groupByKind } from './checks.js';
import { hasHeaderExempt } from '../exempt/index.js';
import { loadRuleFiles, RULE_SLOTS } from '../rule/loader.js';
import { compileAllRules } from '../rule/registry.js';
import '../rule/compilers.js'; // 副作用：注册 13 种编译函数

/** 统一问题对象构造器（所有审计检查的出口）。 */
export function makeFinding({ file, line, rule, kind, severity = 'warning', message, dimensions = [], exemptHint = '', scoreImpact = 0 }) {
  return { file, line, rule, kind, severity, message, dimensions, exemptHint, scoreImpact };
}

/** 汇总 findings 统计。 */
export function summarize(findings) {
  let blocker = 0, warning = 0;
  for (const f of findings) {
    if (f.severity === 'blocker') blocker++;
    else if (f.severity === 'warning') warning++;
  }
  return { blocker, warning, total: findings.length };
}

/**
 * 单文件审计：读文件 → 文件头豁免判定 → 跑检查。
 * 豁免消费：文件头 dsh-skip-sensitive/func-length/quality/residue/style → 整文件对应检查关闭。
 */
export function auditFile({ file, relPath, text, grouped }) {
  if (!text) return [];
  let findings = runChecks({ file, relPath, text, grouped });
  // 文件头豁免（整文件）：
  if (hasHeaderExempt(text, 'dsh-skip-sensitive')) {
    findings = findings.filter((f) => f.kind !== 'secret' && f.kind !== 'credential-ref' && f.kind !== 'credential-file' && f.kind !== 'path-regex');
  }
  if (hasHeaderExempt(text, 'dsh-skip-func-length')) {
    findings = findings.filter((f) => f.kind !== 'func-lines');
  }
  if (hasHeaderExempt(text, 'dsh-skip-quality')) {
    findings = findings.filter((f) => ![ 'func-lines', 'empty-catch' ].includes(f.kind));
  }
  if (hasHeaderExempt(text, 'dsh-skip-residue')) {
    findings = findings.filter((f) => f.kind !== 'regex' || !/residue|console|debugger/.test(f.rule));
  }
  if (hasHeaderExempt(text, 'dsh-skip-style')) {
    findings = findings.filter((f) => !/^(min-length|max-lines|max-complexity|max-depth|min-occurrences|repeated-string)$/.test(f.kind));
  }
  return findings;
}

/** 全量审计：目录递归扫描，非 git 项目可查，默认排除 git 忽略文件。 */
export function auditFull(repoPath, opts = {}) {
  const root = repoPath;
  const gitIgnoreRoot = opts.gitIgnoreRoot !== false && isGitRepo(root) ? root : null;
  const files = collectTextFiles(root, {
    depth: opts.depth ?? 10,
    gitIgnoreRoot,
    includeIgnored: opts.includeIgnored,
  });
  // 编译规则：调用方可传 compiled；未传时默认加载 nodejs 槽位（含 npm/html 等槽位建好后自动扩展）
  let compiled = opts.compiled;
  if (!compiled) {
    const loaded = loadRuleFiles(opts.slots || RULE_SLOTS);
    compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  }
  const grouped = groupByKind(compiled);
  const findings = [];
  for (const f of files) {
    const text = readText(f.full);
    findings.push(...auditFile({ file: f.path, relPath: f.path, text, grouped }));
  }
  return { ok: true, scope: 'full', repo: repoPath, findings, summary: summarize(findings), files: files.length };
}

/**
 * 变动审计：git status --porcelain 取工作区变动文件 → 逐文件审计（仅 git 项目）。
 * 非 git 项目退化为 auditFull，但 scope 仍标记 changed（调用方语义一致）。
 */
export function auditChanged(repoPath, opts = {}) {
  const changed = collectChangedFiles(repoPath);
  if (changed === null) {
    const res = auditFull(repoPath, opts);
    res.scope = 'changed';
    return res;
  }
  const targets = changed.filter((f) => f.status !== 'D'); // 删除的没有可读内容
  // 编译规则：与 auditFull 相同的默认装载
  let compiled = opts.compiled;
  if (!compiled) {
    const loaded = loadRuleFiles(opts.slots || RULE_SLOTS);
    compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  }
  const grouped = groupByKind(compiled);
  const findings = [];
  for (const f of targets) {
    const text = readText(f.full);
    findings.push(...auditFile({ file: f.rel, relPath: f.rel, text, grouped }));
  }
  return { ok: true, scope: 'changed', repo: repoPath, findings, summary: summarize(findings), files: targets.length };
}

/** 统一审计入口（设置项 auditScanScope 决定默认走哪个）。 */
export function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {
  return scope === 'full' ? auditFull(repoPath, opts) : auditChanged(repoPath, opts);
}