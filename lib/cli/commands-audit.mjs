/**
 * CLI 命令 · 审计域（audit/scan + 插件配置对齐工具）（从 cli.mjs 抽出）
 *
 * 为什么拆出来：cli.mjs 578 行代码超单文件阈值（400），审计命令族 + 配置对齐工具
 *   （cliPluginConfig / pluginEqualAuditOpts / pluginEqualWeights / pathExists）是
 *   「与插件 code_audit 结果一致」的独立能力域，被 cmdAudit/cmdScan/cmdCommit 共享。
 *
 * 保持薄引用：审计逻辑在 lib/audit/*（与插件 code_audit 同源）。
 */

import { cliPluginConfig } from './shared.mjs';
import { auditWithScope, auditFull } from '../audit/index.js';
import { formatAnalysisCoverageLine } from '../audit/analysis-coverage.js';
import { scoreQuality } from '../score/index.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { probeRepoOwnership } from '../app/repo-ownership.js';

/** 审计 full 扫描 findings 打印条数上限（防刷屏）。 */
const AUDIT_PRINT_LIMIT = 20;

// cliPluginConfig 已挪到 lib/cli/shared.mjs（三入口共用；git 侧读配置不必 import 审计实现）。
//   这里保留同名导出，外部按老路径 import 不受影响。
export { cliPluginConfig };

/**
 * 构造与插件 code_audit **完全相同**的审计参数（保证 CLI 与插件结果一致）。
 * 对齐点：auditLevel、maxScanFiles、规则包顺序 slots、禁用槽位 disabledSlots、
 *   includeIgnored、rulesetDir、权重（weightOverrides）。CLI 显式传参优先于配置。
 */
export function pluginEqualAuditOpts(cfg, flags, { scope = 'diff' } = {}) {
  const rulesetDir = flags.ruleset || '';
  return {
    scope,
    rulesetDir,
    maxScanFiles: cfg.maxScanFiles,
    slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined,
    disabledSlots: Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [],
    includeIgnored: flags.includeIgnored === true,
    // 分析覆盖率信息项（与插件 code_audit 同口径，由审计编排层计算；见 lib/audit/orchestrate.js）
    coverage: flags.coverage !== false,
  };
}

/** CLI 审计权重：显式 --weights > 插件配置 weightOverrides > 默认权重表（与 code_audit 同序）。 */
export function pluginEqualWeights(cfg, flags) {
  const src = flags.weights || (typeof cfg.weightOverrides === 'string' ? cfg.weightOverrides : '');
  if (!src) return {};
  try { return JSON.parse(src); } catch { return {}; }
}

/** 路径是否存在（异步，避免在 async 命令里做同步 I/O）。 */
async function pathExists(p) {
  try { await access(p); return true; } catch { return false; }
}

/** 子命令：audit — 审计目录（**与插件 code_audit 结果一致**）。 */
export async function cmdAudit(root, flags) {
  // 拆分：history 模式与 standard 模式各自独立函数（圈复杂度 18→各 <10）
  if (flags.history === true) return runHistoryAuditCmd(root, flags);
  return runStandardAudit(root, flags);
}

/** history 模式：历史提交审计（逐提交快照全量审计 + 落盘报告）。 */
async function runHistoryAuditCmd(root, flags) {
  const cfg = cliPluginConfig();
  const { runHistoryAudit } = await import('../audit/history.js');
  const opts = pluginEqualAuditOpts(cfg, flags, { scope: 'full' });
  opts.ownership = probeRepoOwnership(root); // 与插件工具同参：隐私规则只对自有仓库生效
  const weights = pluginEqualWeights(cfg, flags);
  const r = await runHistoryAudit(root || '.', {
    since: flags.since, until: flags.until, outDir: flags.out,
    auditOpts: opts, weights,
    onCommit: (p) => { if (!flags.json) console.log(`  [${p.index}/${p.total}] ${p.short} ${p.ok ? '✓' : '✗ ' + (p.error || '')}`); },
  });
  if (!r.ok) { console.error(`❌ ${r.error || '历史审计失败'}`); return 1; }
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
  console.log(`历史审计完成：${r.total} 个提交（处理 ${r.processed}，失败 ${r.failed}${r.aborted ? '，已中断' : ''}）`);
  console.log(`报告目录：${r.reportDir}`);
  return 0;
}

/** standard 模式：full/diff 审计 + 评分 + 结果输出。 */
async function runStandardAudit(root, flags) {
  const cfg = cliPluginConfig();
  const full = flags.full === true || !(await pathExists(join(root || '.', '.git')));
  const opts = pluginEqualAuditOpts(cfg, flags, { scope: full ? 'full' : 'diff' });
  opts.ownership = probeRepoOwnership(root); // 与插件工具同参：隐私规则只对自有仓库生效
  const weights = pluginEqualWeights(cfg, flags);
  const auditResult = full ? await auditFull(root, opts) : await auditWithScope(root, opts);
  const quality = scoreQuality(auditResult.findings, weights, { files: auditResult.files, dimFileCounts: auditResult.dimFileCounts, dimRuleCounts: auditResult.dimRuleCounts });
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, repo: root, scope: auditResult.scope, summary: auditResult.summary, quality, findings: auditResult.findings, files: auditResult.files, analysisCoverage: auditResult.analysisCoverage || null, yaml: auditResult.yaml }, null, 2));
    return;
  }
  printAuditResult(root, auditResult, opts, weights, quality);
}

/** standard 审计结果的可读输出（文案集中一处）。 */
function printAuditResult(root, auditResult, opts, weights, quality) {
  console.log(`审计 ${root}（scope=${auditResult.scope}${opts.rulesetDir ? ', ruleset=' + opts.rulesetDir : ''}${opts.includeIgnored ? ', include-ignored' : ''}）`);
  console.log(`  summary: ${JSON.stringify(auditResult.summary)}`);
  if (quality.emptyResult) {
    console.log(`  quality: ${quality.emptyReason}（files=${auditResult.files}）`);
  } else {
    console.log(`  quality: ${quality.score}/100（${quality.level}）`);
  }
  if (Object.keys(weights).length) console.log(`  权重覆盖（来自插件配置 weightOverrides）: ${JSON.stringify(weights)}`);
  // 文档加分制（0 分起、上限 10）——结构信号 + 交叉验证，不进问题计数
  const ds = auditResult.docsScore;
  if (ds && Array.isArray(ds.items)) {
    const total = ds.items.filter((i) => i.hit).reduce((a, i) => a + (Number(i.score) || 0), 0);
    console.log(`  文档加分：命中 ${ds.hits?.length ?? 0}/${ds.items.length}（+${total.toFixed(1)}/10）`);
    if (Array.isArray(ds.review) && ds.review.length) console.log(`  建议人工复核：${ds.review.join('；')}`);
  }
  // 分析覆盖率（信息项，不进评分）——与插件 code_audit 同一口径，让「到底解析到多少」可见
  if (auditResult.analysisCoverage) console.log(`  ${formatAnalysisCoverageLine(auditResult.analysisCoverage)}`);
}

/** 子命令：scan — 全量扫描目录（**与插件 code_audit 结果一致**）。
 * 修复：此前 CLI 只传 scope+depth，完全不带插件配置（auditLevel / maxScanFiles /
 *    规则包启停 auditDisabledSlots / 权重 weightOverrides）→ 审计结果与插件不一致
 *    （实测「CLI 全量扫描分更低、文件更多」：跑了已禁用规则包 + 默认权重 + 不同文件上限）。
 *    现在 CLI 读**同一份** config.json（$DSH_HOME/git-push/config.json），用与插件 code_audit
 *    完全相同的 auditOpts 与入口（auditFull），保证功能与结果一致。 */
/**
 * ⚠️ **当前 CLI 不可达**（2026-11-13 核实）：`scan` 命令由注册表 `git_scan` 接管
 *   （输出 `count: N` 的仓库扫描），本函数不挂在任何 COMMANDS 表里。
 *   保留原因：它调的是 `auditWithScope(root,{scope:'full',depth})`，是「按审计口径扫描」的
 *   另一种语义，将来若要提供 `scan --audit` 之类可复用。**注意它没传**
 *   `maxScanFiles / disabledSlots / rulesetDir` —— 若接回 CLI，需先补这三个，
 *   否则会与插件侧的扫描口径不一致。
 */
export async function cmdScan(root, flags) {
  const depth = flags.depth ?? 3;
  const scanResult = await auditWithScope(root, { scope: 'full', depth });
  console.log(`扫描 ${root}（full，depth=${depth}）`);
  console.log(`  findings: ${scanResult.summary.total}（blocker ${scanResult.summary.blocker} / warning ${scanResult.summary.warning}）`);
  for (const f of scanResult.findings.slice(0, AUDIT_PRINT_LIMIT)) {
    console.log(`  [${f.severity}] ${f.rule} ${f.file}:${f.line} ${f.message || ''}`);
  }
}
