/**
 * CLI 命令 · 审计域（audit/scan + 插件配置对齐工具）（2026-10-05 从 cli.mjs 抽出）
 *
 * 为什么拆出来：cli.mjs 578 行代码超单文件阈值（400），审计命令族 + 配置对齐工具
 *   （cliPluginConfig / pluginEqualAuditOpts / pluginEqualWeights / pathExists）是
 *   「与插件 code_audit 结果一致」的独立能力域，被 cmdAudit/cmdScan/cmdCommit 共享。
 *
 * 保持薄引用：审计逻辑在 lib/audit/*（与插件 code_audit 同源）。
 */

import { auditWithScope, auditFull } from '../audit/index.js';
import { scoreQuality } from '../score/index.js';
import { readSettings, applySettingsToCfg } from '../app/settings-bridge.js';
import { defaultConfig } from '../client/index.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

/** 审计 full 扫描 findings 打印条数上限（防刷屏）。 */
const AUDIT_PRINT_LIMIT = 20;

/** 读插件同一份配置（config.json）→ 运行期 cfg（与插件启动回读同一映射）。
 *  注意：applySettingsToCfg 是**原地修改** cfg、返回 { changedSystemPrompt } 状态对象
 *  （与插件 apply.js 用法一致：`const changed = applySettingsToCfg(cfg, saved)`）。
 *  绝不能把它的返回值当 cfg 用——那会让 auditLevel/maxScanFiles/weightOverrides 等全变
 *  undefined，CLI 结果与插件不一致。 */
export function cliPluginConfig() {
  const cfg = defaultConfig();
  try {
    const saved = readSettings({});
    applySettingsToCfg(cfg, saved || {}); // 原地改 cfg，忽略返回值
  } catch {
    /* 配置缺失/损坏 → 保留 defaultConfig（与插件首启一致） */
  }
  return cfg;
}

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
  const weights = pluginEqualWeights(cfg, flags);
  const auditResult = full ? await auditFull(root, opts) : await auditWithScope(root, opts);
  const quality = scoreQuality(auditResult.findings, weights, { files: auditResult.files });
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, repo: root, scope: auditResult.scope, summary: auditResult.summary, quality, findings: auditResult.findings, files: auditResult.files, yaml: auditResult.yaml }, null, 2));
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
}

/** 子命令：scan — 全量扫描目录（**与插件 code_audit 结果一致**）。
 * 修复：此前 CLI 只传 scope+depth，完全不带插件配置（auditLevel / maxScanFiles /
 *    规则包启停 auditDisabledSlots / 权重 weightOverrides）→ 审计结果与插件不一致
 *    （实测「CLI 全量扫描分更低、文件更多」：跑了已禁用规则包 + 默认权重 + 不同文件上限）。
 *    现在 CLI 读**同一份** config.json（$DSH_HOME/git-push/config.json），用与插件 code_audit
 *    完全相同的 auditOpts 与入口（auditFull），保证功能与结果一致。 */
export async function cmdScan(root, flags) {
  const depth = flags.depth ?? 3;
  const scanResult = await auditWithScope(root, { scope: 'full', depth });
  console.log(`扫描 ${root}（full，depth=${depth}）`);
  console.log(`  findings: ${scanResult.summary.total}（blocker ${scanResult.summary.blocker} / warning ${scanResult.summary.warning}）`);
  for (const f of scanResult.findings.slice(0, AUDIT_PRINT_LIMIT)) {
    console.log(`  [${f.severity}] ${f.rule} ${f.file}:${f.line} ${f.message || ''}`);
  }
}
