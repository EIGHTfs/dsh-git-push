#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * dsh-git-push 独立 CLI（git-sluice）
 * 不依赖 DSH 运行时，可独立运行。命名/参数与 lib 函数完全一致（外部 API 与函数名一致）。
 */
import { VERSION, readmeTemplate, yamlTemplate, helpSync } from './lib/self/index.js';
import { loadRuleFiles, discoverRuleSlots } from './lib/rule/loader.js';
import { compileAllRules } from './lib/rule/registry.js';
import { auditWithScope } from './lib/audit/index.js';
import { scoreQuality } from './lib/score/index.js';
import { checkLinks, sumLinkPenalty } from './lib/link-check/index.js';
import { collectTextFiles, readText } from './lib/audit/collector.js';
import { commitWithAudit } from './lib/commit-push.js';
import { scanRepos } from './lib/git/repos.js';
import { maintainRepoIndex } from './lib/git/repo-index.js';
import { auditFull } from './lib/audit/index.js';
import { readSettings, applySettingsToCfg } from './lib/app/settings-bridge.js';
import { defaultConfig } from './lib/client/index.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** parseArgv 认识的选项白名单（cli-help-sync 机器比对基准，必须与 HELP 文本一致。
 * 注：-m 是单横线别名（helpSync 只比对 -- 双横线），不列入本表。 */
export const KNOWN_FLAGS = ['--depth', '--full', '--level', '--ruleset', '--weights', '--include-ignored', '--push', '--no-push', '--dry-run', '--force', '--req-confirm', '--push-gate-confirmed', '--json', '--max', '--owner', '--offline'];

const HELP = `git-sluice v${VERSION} — dsh-git-push 引擎独立 CLI（脱离 DSH 运行）

用法:
  git-sluice version              查看版本
  git-sluice ruleset [槽位...]    编译规则包并输出统计（默认全部槽位）
  git-sluice scan <root> [--depth N]   全量扫描目录（非 git 目录可查）
  git-sluice repos <root> [--depth N] [--max N] [--json]
                                  扫描本地 git 仓库（尊重 .gitignore：被忽略目录整棵跳过）
  git-sluice index <root> [--owner <账号>] [--depth N] [--max N] [--offline] [--json]
                                  重建仓库索引 dsh-repo-index.json（--offline=纯离线不查 GitHub API）
  git-sluice audit <root> [--full] [--level quick|standard|deep] [--ruleset <目录>] [--weights <JSON>] [--include-ignored]
                                  审计目录（默认 diff 范围；--full=全量；--level=强度；--ruleset=自定规则目录；--weights=权重覆盖 JSON；--include-ignored=连 .gitignore 忽略的文件也扫）
  git-sluice commit <repo> -m <msg> [--push|--no-push] [--dry-run] [--force] [--req-confirm] [--push-gate-confirmed] [--json]
                                  审计门禁 → 提交（默认只 commit 不 push；--push 推远端；--force 强推覆盖远端历史；--req-confirm 显式核对开发者要求；--push-gate-confirmed 显式放行推送门禁）
  git-sluice link-check <路径>    检查 md/文本中的链接有效性（只 warning，flaky 域名打折）
  git-sluice yaml-template        输出规则 yml 模板（含 kind + dimensions 示范）
  git-sluice readme-template      输出 README 模板（{{name}} {{version}} 占位符）
  git-sluice self-check           版本一致性 + HELP↔parseArgv 机器比对（自检）
  git-sluice help                 显示本帮助
`;

// 导入 compilers 触发注册（副作用：注册 13 种编译函数到 RULE_COMPILERS）
import './lib/rule/compilers.js';

/** 参数解析：白名单必须与 HELP 文本完全一致（cli-help-sync 自检）。 */
export function parseArgv(argv) {
  const flags = { depth: undefined, full: false, level: undefined, ruleset: undefined, weights: undefined, includeIgnored: false, push: undefined, dryRun: false, force: false, reqConfirm: false, pushGateConfirmed: false, message: undefined, json: false, max: undefined, owner: undefined, offline: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--depth') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `--depth 缺值（用法: --depth N）` };
      flags.depth = Number(v);
    } else if (a === '--max') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `--max 缺值（用法: --max N）` };
      flags.max = Number(v);
    } else if (a === '--owner') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `--owner 缺值（用法: --owner <账号>）` };
      flags.owner = v;
    } else if (a === '--offline') flags.offline = true;
    else if (a === '--full') flags.full = true;
    else if (a === '--include-ignored') flags.includeIgnored = true;
    else if (a === '--level' || a === '--ruleset' || a === '--weights' || a === '-m') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `${a} 缺值` };
      if (a === '--level') {
        if (!['quick', 'standard', 'deep'].includes(v)) return { error: `--level 取值须为 quick|standard|deep（收到 ${v}）` };
        flags.level = v;
      } else if (a === '--ruleset') flags.ruleset = v;
      else if (a === '--weights') flags.weights = v;
      else flags.message = v;
    } else if (a === '--push') flags.push = true;
    else if (a === '--no-push') flags.push = false;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--req-confirm') flags.reqConfirm = true;
    else if (a === '--push-gate-confirmed') flags.pushGateConfirmed = true;
    else if (a === '--json') flags.json = true;
    else if (a.startsWith('--')) return { error: `未知参数: ${a}` };
    else positional.push(a);
  }
  return { flags, positional };
}

/** 子命令：version */
export function cmdVersion() {
  console.log(`git-sluice v${VERSION} — dsh-git-push（统一函数入口架构）`);
}

/** 子命令：ruleset — 编译规则包输出统计。 */
export function cmdRuleset(slots) {
  const order = slots.length ? slots : null; // null=动态发现全部槽位
  const { ok, merged, errors, files, order: effective } = loadRuleFiles(order);
  const ctx = { errors: [] };
  const compiled = compileAllRules(merged.rules, ctx);
  if (!ok || ctx.errors.length) {
    console.error('规则编译失败:');
    for (const e of [...errors, ...ctx.errors]) console.error('  ✗ ' + e);
    process.exitCode = 1;
    return;
  }
  console.log(`规则包编译 OK（${effective.join('+')}）`);
  console.log(`  文件: ${files.length} 个槽位, 规则条目 ${merged.rules.length}, 编译成功 ${compiled.length}`);
  const byKind = {};
  for (const r of compiled) byKind[r.kind || r.type || 'other'] = (byKind[r.kind || r.type || 'other'] || 0) + 1;
  for (const [k, v] of Object.entries(byKind)) console.log(`  ${k}: ${v}`);
}

/** 子命令：scan — 全量扫描目录（**与插件 code_audit 结果一致**）。
 *  2026-09-16 修复：此前 CLI 只传 scope+depth，完全不带插件配置（auditLevel / maxScanFiles /
 *    规则包启停 auditDisabledSlots / 权重 weightOverrides）→ 审计结果与插件不一致
 *    （实测「CLI 全量扫描分更低、文件更多」：跑了已禁用规则包 + 默认权重 + 不同文件上限）。
 *    现在 CLI 读**同一份** config.json（$DSH_HOME/git-push/config.json），用与插件 code_audit
 *    完全相同的 auditOpts 与入口（auditFull），保证功能与结果一致。 */
export function cmdScan(root, flags) {
  const depth = flags.depth ?? 3;
  const scanResult = auditWithScope(root, { scope: 'full', depth });
  console.log(`扫描 ${root}（full，depth=${depth}）`);
  console.log(`  findings: ${scanResult.summary.total}（blocker ${scanResult.summary.blocker} / warning ${scanResult.summary.warning}）`);
  for (const f of scanResult.findings.slice(0, 20)) {
    console.log(`  [${f.severity}] ${f.rule} ${f.file}:${f.line} ${f.message || ''}`);
  }
}

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
  const validLevels = ['quick', 'standard', 'deep'];
  const level = validLevels.includes(flags.level) ? flags.level : (cfg.auditLevel || 'standard');
  const rulesetDir = flags.ruleset || '';
  return {
    scope,
    rulesetDir,
    auditLevel: level,
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

/** 子命令：audit — 审计目录（**与插件 code_audit 结果一致**）。 */
export function cmdAudit(root, flags) {
  const cfg = cliPluginConfig();
  const full = flags.full === true || !existsSync(join(root || '.', '.git'));
  const opts = pluginEqualAuditOpts(cfg, flags, { scope: full ? 'full' : 'diff' });
  const weights = pluginEqualWeights(cfg, flags);
  const auditResult = full ? auditFull(root, opts) : auditWithScope(root, opts);
  const quality = scoreQuality(auditResult.findings, weights, { files: auditResult.files });
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, repo: root, scope: auditResult.scope, summary: auditResult.summary, quality, findings: auditResult.findings, files: auditResult.files, yaml: auditResult.yaml }, null, 2));
    return;
  }
  console.log(`审计 ${root}（scope=${auditResult.scope}, level=${opts.auditLevel}${opts.rulesetDir ? ', ruleset=' + opts.rulesetDir : ''}${opts.includeIgnored ? ', include-ignored' : ''}）`);
  console.log(`  summary: ${JSON.stringify(auditResult.summary)}`);
  if (quality.emptyResult) {
    console.log(`  quality: ${quality.emptyReason}（files=${auditResult.files}）`);
  } else {
    console.log(`  quality: ${quality.score}/100（${quality.level}）`);
  }
  if (Object.keys(weights).length) console.log(`  权重覆盖（来自插件配置 weightOverrides）: ${JSON.stringify(weights)}`);
}

/** 子命令：repos — 扫描本地 git 仓库（尊重 .gitignore）。 */
export function cmdRepos(root, flags) {
  const depth = flags.depth ?? 10;
  const max = flags.max ?? 200;
  const list = scanRepos(root || '.', { depth, maxRepos: max });
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, root, count: list.length, repos: list }, null, 2));
    return;
  }
  console.log(`扫描 ${root || '.'}（depth=${depth}, max=${max}）→ ${list.length} 个仓库：`);
  for (const r of list) {
    const br = r.branch ? ` [${r.branch}]` : '';
    const remote = r.remote ? ` ← ${r.remote}` : ' （无远端）';
    const dirty = r.changed ? ` · 未提交 ${r.changed}` : '';
    console.log(`  ${r.name}${br}${dirty}${remote}`);
    console.log(`    ${r.path}`);
  }
  console.log(`（被 .gitignore 忽略的目录已整棵跳过，不当独立仓库）`);
}

/** 子命令：index — 重建仓库索引 dsh-repo-index.json。 */
export async function cmdIndex(root, flags) {
  const depth = flags.depth ?? 20;
  const max = flags.max ?? 200;
  const owner = flags.owner || 'EIGHTfs';
  const r = await maintainRepoIndex({
    workspaceRoot: root || '.',
    owner,
    depth,
    maxRepos: max,
    offline: flags.offline === true, // --offline=纯离线（不查 GitHub API）
  });
  if (flags.json) { console.log(JSON.stringify({ ...r, root, owner, offline: !!flags.offline }, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) { console.error(`❌ 索引重建失败: ${r.error || ''}`); return 1; }
  console.log(`✅ 索引已重建：${r.target || ''}`);
  console.log(`   扫描根 ${root || '.'}（owner=${owner}, depth=${depth}, max=${max}${flags.offline ? ', offline' : ''}）`);
  return 0;
}

/** 子命令：commit — 审计门禁 → 提交（默认只 commit 不 push；--push 推远端；--force 强推）。 */
export async function cmdCommit(root, flags) {
  const repo = root || '';
  if (!repo || !existsSync(join(repo, '.git'))) { console.error(`不是 git 仓库: ${repo || '(空)'}`); return 1; }
  if (!String(flags.message || '').trim()) { console.error('缺少 -m <commit message>'); return 1; }
  // 推送门禁开关取插件配置（config.json pushGate，与侧边栏同一真源）；CLI 未确认时会被拦截
  const cfg = cliPluginConfig();
  // 审计门禁：blocker 拦截（v2 审计独立调用——与 DSH 工具 git_commit_push 同一实现 commitWithAudit）
  const commitOutcome = await commitWithAudit({
    repoPath: repo,
    message: flags.message,
    push: flags.push === true,
    dryRun: flags.dryRun === true,
    requirementsConfirmed: flags.reqConfirm === true,
    force: flags.force === true,
    // 2026-09-17：推送门禁（设置侧边栏开关）——CLI 对应 --push-gate-confirmed（用户已确认）
    pushGate: cfg.pushGate === true,
    pushConfirmed: flags.pushGateConfirmed === true,
  });
  if (commitOutcome.blocked) {
    console.error(`审计拦截（${commitOutcome.error || 'blocker'}），提交中止：`);
    if (commitOutcome.audit) console.error(`  summary: ${JSON.stringify(commitOutcome.audit.summary)}`);
    return 2;
  }
  if (flags.json) console.log(JSON.stringify(commitOutcome, null, 2));
  else {
    if (!commitOutcome.ok && commitOutcome.error) console.error(`提交失败: ${typeof commitOutcome.error === 'string' ? commitOutcome.error : JSON.stringify(commitOutcome.error)}`);
    console.log(JSON.stringify(commitOutcome, null, 2).slice(0, 2000));
  }
  return commitOutcome.ok ? 0 : 2;
}

/** 子命令：link-check — 检查文本文件的链接有效性（只 warning，不拦提交）。 */
export async function cmdLinkCheck(root = '.') {
  const files = collectTextFiles(root, { depth: 5 }).filter((f) => /\.(md|markdown|txt)$/i.test(f.path));
  const all = [];
  for (const f of files) {
    const findings = await checkLinks({ file: f.path, text: readText(f.full) });
    if (findings.length) all.push(...findings);
  }
  console.log(`链接检查 ${root}（${files.length} 个文档）`);
  for (const x of all) console.log(`  ${x.file}:${x.line} [${x.linkLevel}${x.flaky ? '/flaky' : ''}] ${x.message}`);
  console.log(`共 ${all.length} 个问题，扣分合计 ${sumLinkPenalty(all)}（只 warning，不拦提交）`);
}

export function cmdYamlTemplate() {
  console.log(yamlTemplate());
}

/** 子命令：readme-template — 输出 README 模板。 */
export function cmdReadmeTemplate() {
  console.log(readmeTemplate().template);
}

/** 子命令：self-check — 版本一致性 + HELP↔parseArgv 机器比对。 */
export function cmdSelfCheck() {
  const helpRes = helpSync(HELP, KNOWN_FLAGS);
  let fail = 0;
  console.log('自身自检:');
  console.log(`  version: v${VERSION}`);
  if (!helpRes.ok) {
    fail++;
    console.error(`  ✗ cli-help-sync: HELP 与 parseArgv 不一致`);
    for (const f of helpRes.missingInHelp) console.error(`    parseArgv 认但 HELP 没写: ${f}`);
    for (const f of helpRes.missingInParse) console.error(`    HELP 写了但 parseArgv 不认: ${f}`);
  } else {
    console.log(`  ✓ cli-help-sync: HELP 与 parseArgv 一致（${helpRes.helpFlags.join(' ')}）`);
  }
  const pkgRes = readPkgJson();
  if (pkgRes && pkgRes.version && pkgRes.version !== VERSION) {
    fail++;
    console.error(`  ✗ version: lib/self=${VERSION} vs package.json=${pkgRes.version}`);
  } else {
    console.log(`  ✓ version: lib/self = package.json = ${VERSION}`);
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

/** 读 package.json（失败返回 null）。 */
function readPkgJson() {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  } catch { return null; }
}

export function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  if (cmd === 'version' || cmd === '-v' || cmd === '--version') return cmdVersion();
  if (cmd === 'ruleset') return cmdRuleset(rest);
  if (cmd === 'scan') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return cmdScan(positional[0] || '.', flags);
  }
  if (cmd === 'repos') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return cmdRepos(positional[0] || '.', flags);
  }
  if (cmd === 'index') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return cmdIndex(positional[0] || '.', flags);
  }
  if (cmd === 'audit') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return cmdAudit(positional[0] || '.', flags);
  }
  if (cmd === 'commit') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return cmdCommit(positional[0] || '', flags);
  }
  if (cmd === 'link-check') return cmdLinkCheck(rest[0] || '.');
  if (cmd === 'yaml-template') return cmdYamlTemplate();
  if (cmd === 'readme-template') return cmdReadmeTemplate();
  if (cmd === 'self-check') return cmdSelfCheck();
  console.error(`未知命令: ${cmd}\n`);
  console.log(HELP);
  process.exitCode = 1;
}

// 直接运行时入口（被 import 时不执行）
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.mjs')) {
  main();
}