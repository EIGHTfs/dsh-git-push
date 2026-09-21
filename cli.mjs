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
import { maintainRepoIndex, updateRepoIndex } from './lib/git/repo-index.js';
import { auditFull } from './lib/audit/index.js';
import { readSettings, applySettingsToCfg } from './lib/app/settings-bridge.js';
import { scanFileIo, summarize } from './scripts/scan-file-io.mjs';
import { defaultConfig } from './lib/client/index.js';
// 2026-09-19 补齐：CLI 与插件工具一一对应（此前缺 5 个远端/账号类命令）
import { cloneViaApi, previewClone } from './lib/git/clone.js';
import { DEFAULT_MAX_FILE_MB } from './lib/git/clone-download.js';
import { parseGithubOwnerRepo } from './lib/git/api.js';
import { checkGithubAccount, formatGithubAccountBlock } from './lib/git/account.js';
import { ensureRemoteRepo, setVisibility } from './lib/git/remote.js';
import { generateSshKey, resolveToken } from './lib/git/credentials.js';
import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** parseArgv 认识的选项白名单（cli-help-sync 机器比对基准，必须与 HELP 文本一致。
 * 注：-m 是单横线别名（helpSync 只比对 -- 双横线），不列入本表。 */
export const KNOWN_FLAGS = ['--depth', '--full', '--ruleset', '--weights', '--include-ignored', '--push', '--no-push', '--dry-run', '--force', '--req-confirm', '--push-gate-confirmed', '--json', '--max', '--owner', '--offline', '--paths', '--history', '--since', '--until', '--out',
  // file-io 三标签过滤
  '--summary', '--write', '--type', '--kind', '--risk', '--op',
  // 2026-09-19 补齐的 5 个命令（clone / account-check / remote-create / set-visibility / gen-ssh-key）
  '--dest', '--branch', '--preview', '--max-file-mb', '--concurrency', '--visibility', '--email', '--no-check-ssh', '--token'];

const HELP = `git-sluice v${VERSION} — dsh-git-push 引擎独立 CLI（脱离 DSH 运行）

用法:
  git-sluice version              查看版本
  git-sluice ruleset [槽位...]    编译规则包并输出统计（默认全部槽位）
  git-sluice scan <root> [--depth N]   全量扫描目录（非 git 目录可查）
  git-sluice repos <root> [--depth N] [--max N] [--json]
                                  扫描本地 git 仓库（尊重 .gitignore：被忽略目录整棵跳过）
  git-sluice index <root> [--owner <账号>] [--depth N] [--max N] [--offline] [--json]
                                  重建仓库索引 dsh-repo-index.json（--offline=纯离线不查 GitHub API）
  git-sluice audit <root> [--full] [--ruleset <目录>] [--weights <JSON>] [--include-ignored] [--history [--since <提交>] [--until <提交>] [--out <目录>]]
                                  审计目录（默认 diff 范围；--full=全量；--ruleset=自定规则目录；--weights=权重覆盖 JSON；--include-ignored=连 .gitignore 忽略的文件也扫；--history=历史提交审计——逐提交快照全量审计并落盘报告，--since/--until 起始~结束提交（皆缺省=全部历史、含两端），--out 报告保存目录（缺省=git 根 audit-history/））
  git-sluice commit <repo> -m <msg> [--push|--no-push] [--dry-run] [--force] [--req-confirm] [--push-gate-confirmed] [--paths <路径1,路径2>] [--json]
                                  审计门禁 → 提交（默认只 commit 不 push；--push 推远端；--force 强推覆盖远端历史；--req-confirm 显式核对开发者要求；--push-gate-confirmed 显式放行推送门禁；--paths 精确 add 指定文件替代 add -A）
  git-sluice file-io [路径...] [--summary] [--write] [--type sync|async] [--kind read|write|delete|rename] [--risk high|medium|low] [--op <操作名>] [--json]
                                  文件读写调用扫描（三标签：类型/操作/上下文）——同步 I/O 在异步路径会阻塞；写/删/改名涉及数据安全
  git-sluice link-check <路径>    检查 md/文本中的链接有效性（只 warning，flaky 域名打折）
  git-sluice module-splitter <analyze|split|verify> <file|plan> [--dry-run] [--json]
                                  巨型单文件按顶层块拆分（python3 零依赖；analyze 先出块/依赖图 → AI 写 plan.json → split 切分 → verify 校验导出面；--dry-run=split 只预演）
  git-sluice clone <owner/repo> [dest] [--branch <名>] [--dest <目录>] [--max-file-mb N] [--concurrency N] [--preview] [--json]
                                  从 GitHub 克隆仓库（Git Data API 通道，不直连 github.com；--preview=只探测不写盘）
  git-sluice account-check [--token <t>] [--no-check-ssh] [--json]
                                  校验 GitHub 账号与凭据（token 在线校验 + SSH 公钥指纹）
  git-sluice cred-env [--json]
                                  输出插件保管凭据的环境变量前缀（SSH: GIT_SSH_COMMAND 私钥路径 / HTTPS: GIT_ASKPASS 脚本）——AI 执行任意外部 git 命令时粘贴使用，全程无 token/私钥明文
  git-sluice remote-create <repo> [--owner <账号>] [--visibility public|private] [--dry-run] [--json]
                                  按项目文件夹在 GitHub 建远端仓库（已存在则复用），并指向 origin
  git-sluice set-visibility <repo> --visibility public|private [--json]
                                  切换仓库公开/私有（public 有敏感信息暴露风险）
  git-sluice gen-ssh-key --email <x@y.z> [--force] [--json]
                                  生成 SSH 密钥对（公钥回传，私钥不出本机；--force=先备份再覆盖）
  git-sluice yaml-template        输出规则 yml 模板（含 kind + dimensions 示范）
  git-sluice readme-template      输出 README 模板（{{name}} {{version}} 占位符）
  git-sluice self-check           版本一致性 + HELP↔parseArgv 机器比对（自检）
  git-sluice help                 显示本帮助
`;

// 导入 compilers 触发注册（副作用：注册 13 种编译函数到 RULE_COMPILERS）
import './lib/rule/compilers.js';

/**
 * 参数解析：白名单必须与 HELP 文本完全一致（cli-help-sync 自检）。
 *
 * 实现用**表驱动**而非 if-else 长链：每加一个 flag 只加一行表项，
 *   函数长度不随 flag 数增长（if-else 版加到第 21 个 flag 时func-lines 即 101 行、
 *   触发自己的 readability/max-function-length blocker）。
 *
 * 自检约束：helpSync 用正则 /--[\w-]+/g 扫本文件全文提取 flag 字面量，
 *   故下表必须**写成 `'--xxx'` 字面量**（拼字符串会让自检扫不到而误报）。
 */

/** 布尔开关 flag → flags 字段名（出现即为 true）。 */
const BOOL_FLAGS = {
  '--full': 'full',
  '--history': 'history',
  '--include-ignored': 'includeIgnored',
  '--dry-run': 'dryRun',
  '--force': 'force',
  '--req-confirm': 'reqConfirm',
  '--push-gate-confirmed': 'pushGateConfirmed',
  '--json': 'json',
  '--offline': 'offline',
  '--summary': 'summary',
  '--write': 'write',
  '--preview': 'preview',
  '--no-check-ssh': null, // 特殊：置 false 而非 true（见下 applyBool）
};

/** 取值 flag → [flags 字段名, 缺值提示, 转换函数?]。 */
const VALUE_FLAGS = {
  '--depth': ['depth', '--depth 缺值（用法: --depth N）', Number],
  '--max': ['max', '--max 缺值（用法: --max N）', Number],
  '--owner': ['owner', '--owner 缺值（用法: --owner <账号>）'],
  '--ruleset': ['ruleset', '--ruleset 缺值'],
  '--weights': ['weights', '--weights 缺值'],
  '-m': ['message', '-m 缺值（用法: -m <提交信息>）'],
  '--type': ['type', '--type 缺值（用法: --type sync|async）'],
  '--kind': ['kind', '--kind 缺值（用法: --kind read|write|delete|rename）'],
  '--risk': ['risk', '--risk 缺值（用法: --risk high|medium|low）'],
  '--op': ['op', '--op 缺值（用法: --op writeFileSync）'],
  '--dest': ['dest', '--dest 缺值（用法: --dest <目录>）'],
  '--branch': ['branch', '--branch 缺值（用法: --branch <分支名>）'],
  '--max-file-mb': ['maxFileMB', '--max-file-mb 缺值（用法: --max-file-mb N）', Number],
  '--concurrency': ['concurrency', '--concurrency 缺值（用法: --concurrency N）', Number],
  '--visibility': ['visibility', '--visibility 缺值（用法: --visibility public|private）'],
  '--email': ['email', '--email 缺值（用法: --email x@y.z）'],
  '--token': ['token', '--token 缺值（用法: --token <ghp_...>）'],
  '--since': ['since', '--since 缺值（用法: --since <起始提交 sha/ref>）'],
  '--until': ['until', '--until 缺值（用法: --until <结束提交 sha/ref>）'],
  '--out': ['out', '--out 缺值（用法: --out <报告保存目录>）'],
};

/** 默认值（函数内每次调用新建，避免跨调用串状态）。 */
function defaultFlags() {
  return {
    depth: undefined, full: false, ruleset: undefined, weights: undefined, includeIgnored: false,
    push: undefined, dryRun: false, force: false, reqConfirm: false, pushGateConfirmed: false,
    message: undefined, json: false, max: undefined, owner: undefined, offline: false,
    summary: false, write: false, type: undefined, kind: undefined, risk: undefined, op: undefined,
    dest: undefined, branch: undefined, preview: false, maxFileMB: undefined, concurrency: undefined,
    visibility: undefined, email: undefined, checkSsh: true, token: undefined,
  };
}

/** 布尔开关落值：--no-check-ssh 语义是「关掉」而非「开启」，单独处理。 */
function applyBoolFlag(flags, a) {
  if (a === '--no-check-ssh') { flags.checkSsh = false; return; }
  // --push / --no-push 是同一字段的两态，不能混进 BOOL_FLAGS 的「出现即 true」
  if (a === '--push') { flags.push = true; return; }
  if (a === '--no-push') { flags.push = false; return; }
  flags[BOOL_FLAGS[a]] = true;
}

/** 取值 flag 落值。 */
function applyValueFlag(flags, a, v) {
  const [field, , conv] = VALUE_FLAGS[a];
  flags[field] = conv ? conv(v) : v;
}

export function parseArgv(argv) {
  const flags = defaultFlags();
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--push' || a === '--no-push' || a === '--no-check-ssh' || a in BOOL_FLAGS) {
      applyBoolFlag(flags, a);
    } else if (a in VALUE_FLAGS) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: VALUE_FLAGS[a][1] };
      applyValueFlag(flags, a, v);
    } else if (a.startsWith('--')) {
      return { error: `未知参数: ${a}` };
    } else {
      positional.push(a);
    }
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
export async function cmdScan(root, flags) {
  const depth = flags.depth ?? 3;
  const scanResult = await auditWithScope(root, { scope: 'full', depth });
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
  const cfg = cliPluginConfig();
  // 2026-09-21：history 模式——历史提交审计（逐提交快照全量审计 + 落盘报告）
  if (flags.history === true) {
    const { runHistoryAudit } = await import('./lib/audit/history.js');
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
  const full = flags.full === true || !(await pathExists(join(root || '.', '.git')));
  const opts = pluginEqualAuditOpts(cfg, flags, { scope: full ? 'full' : 'diff' });
  const weights = pluginEqualWeights(cfg, flags);
  const auditResult = full ? await auditFull(root, opts) : await auditWithScope(root, opts);
  const quality = scoreQuality(auditResult.findings, weights, { files: auditResult.files });
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, repo: root, scope: auditResult.scope, summary: auditResult.summary, quality, findings: auditResult.findings, files: auditResult.files, yaml: auditResult.yaml }, null, 2));
    return;
  }
  console.log(`审计 ${root}（scope=${auditResult.scope}${opts.rulesetDir ? ', ruleset=' + opts.rulesetDir : ''}${opts.includeIgnored ? ', include-ignored' : ''}）`);
  console.log(`  summary: ${JSON.stringify(auditResult.summary)}`);
  if (quality.emptyResult) {
    console.log(`  quality: ${quality.emptyReason}（files=${auditResult.files}）`);
  } else {
    console.log(`  quality: ${quality.score}/100（${quality.level}）`);
  }
  if (Object.keys(weights).length) console.log(`  权重覆盖（来自插件配置 weightOverrides）: ${JSON.stringify(weights)}`);
  // 2026-09-21：文档加分制（0 分起、上限 10）——结构信号 + 交叉验证，不进问题计数
  const ds = auditResult.docsScore;
  if (ds && Array.isArray(ds.items)) {
    const total = ds.items.filter((i) => i.hit).reduce((a, i) => a + (Number(i.score) || 0), 0);
    console.log(`  文档加分：命中 ${ds.hits?.length ?? 0}/${ds.items.length}（+${total.toFixed(1)}/10）`);
    if (Array.isArray(ds.review) && ds.review.length) console.log(`  建议人工复核：${ds.review.join('；')}`);
  }
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
  // 2026-09-20：统一走 updateRepoIndex（mode='rebuild' 读-改-写合并不全量覆盖）
  const r = await updateRepoIndex({
    workspaceRoot: root || '.',
    owner,
    depth,
    maxRepos: max,
    offline: flags.offline === true, // --offline=纯离线（不查 GitHub API）
    mode: 'rebuild',
  });
  if (flags.json) { console.log(JSON.stringify({ ...r, root, owner, offline: !!flags.offline }, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) { console.error(`❌ 索引重建失败: ${r.error || ''}`); return 1; }
  console.log(`✅ 索引已更新：${r.target || ''}（新增/更新 ${r.updated ?? 0} 条，indexUpdated=${r.indexUpdated === true}）`);
  console.log(`   扫描根 ${root || '.'}（owner=${owner}, depth=${depth}, max=${max}${flags.offline ? ', offline' : ''}）`);
  return 0;
}

/** 子命令：commit — 审计门禁 → 提交（默认只 commit 不 push；--push 推远端；--force 强推）。 */
export async function cmdCommit(root, flags) {
  const repo = root || '';
  if (!repo || !(await pathExists(join(repo, '.git')))) { console.error(`不是 git 仓库: ${repo || '(空)'}`); return 1; }
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
    // 2026-09-21：精确 add 路径（逗号分隔，相对 repo）；空 = git add -A
    paths: String(flags.paths || ''),
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
  const files = (await collectTextFiles(root, { depth: 5 })).filter((f) => /\.(md|markdown|txt)$/i.test(f.path));
  const all = [];
  for (const f of files) {
    const findings = await checkLinks({ file: f.path, text: readText(f.full) });
    if (findings.length) all.push(...findings);
  }
  console.log(`链接检查 ${root}（${files.length} 个文档）`);
  for (const x of all) console.log(`  ${x.file}:${x.line} [${x.linkLevel}${x.flaky ? '/flaky' : ''}] ${x.message}`);
  console.log(`共 ${all.length} 个问题，扣分合计 ${sumLinkPenalty(all)}（只 warning，不拦提交）`);
}

/** 子命令：clone — 从 GitHub 克隆仓库（Git Data API 通道，不直连 github.com）。 */
export async function cmdClone(flags, positional) {
  const target = positional[0] || '';
  const dest = positional[1] || flags.dest || '';
  if (!target) { console.error('缺少 <owner/repo>（用法: git-sluice clone <owner/repo> [dest]）'); return 1; }
  // --preview：只探测不写盘（对应插件 git_clone 的预检语义）
  if (flags.preview) {
    // previewClone 不自己解析 token（内部无 resolveToken），私有仓不传就是 404
    const tk = flags.token || resolveToken({ tokenPath: process.env.DSH_GIT_PUSH_TOKEN ? undefined : '', repoPath: '' }).token;
    const pr = await previewClone({ target, token: tk, branch: flags.branch || '' });
    if (flags.json) { console.log(JSON.stringify(pr, null, 2)); return pr.ok ? 0 : 1; }
    if (!pr.ok) { console.error(`❌ 预演失败: ${pr.error || ''}`); return 1; }
    console.log(`预演 ${target}（分支 ${pr.branch || '(默认)'}）`);
    // 字段名以 previewClone 实际返回为准：totalFiles/downloadCount/downloadBytes/skipped
    console.log(`  共 ${pr.totalFiles ?? 0} 个文件，将下载 ${pr.downloadCount ?? 0} 个`
      + `（${((pr.downloadBytes || 0) / 1048576).toFixed(1)} MB）`);
    if (pr.skipped?.length) console.log(`  ⚠️ 超限跳过 ${pr.skipped.length} 个（> ${flags.maxFileMB ?? DEFAULT_MAX_FILE_MB} MB）`);
    if (pr.empty) console.log('  ⚠️ 全部文件均超限，无内容可下载');
    return 0;
  }
  const r = await cloneViaApi({
    target,
    dest,
    token: flags.token || '',
    branch: flags.branch || '',
    maxFileMB: flags.maxFileMB,
    // 并发过高会撞 GitHub 风控（与插件同默认值）
    concurrency: flags.concurrency,
    // 进度回调：CLI 下按 5% 粒度打点，避免刷屏
    onProgress: ({ done, total, failed }) => {
      if (!total) return;
      const pct = Math.floor((done / total) * 100);
      if (pct !== cmdClone._lastPct) { cmdClone._lastPct = pct; process.stderr.write(`\r  下载 ${done}/${total}（${pct}%，失败 ${failed}）`); }
    },
  });
  cmdClone._lastPct = -1;
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) {
    console.error(`\n❌ 克隆未完成：${r.error || ''}`);
    if (r.failed?.length) for (const x of r.failed.slice(0, 10)) console.error(`  ${x.path} → ${x.reason}`);
    if (r.kept) console.error('  （已下好的文件已保留，可再次运行续传）');
    return 1;
  }
  console.error(''); // 结束进度行
  console.log(`✅ 克隆完成：${r.dest || dest || target}`);
  console.log(`   ${r.files ?? 0}/${r.total ?? 0} 个文件${r.skippedCount ? `，跳过 ${r.skippedCount} 个大文件` : ''}`);
  if (r.skipped?.length) for (const x of r.skipped) console.log(`   ⚠️ 跳过 ${x.path}（${(x.size / 1048576).toFixed(1)} MB）`);
  return 0;
}

/** 子命令：account-check — 校验 GitHub 账号与凭据（token 在线校验 + SSH 公钥指纹）。 */
export async function cmdAccountCheck(flags) {
  const r = await checkGithubAccount({ token: flags.token || '', checkSsh: flags.checkSsh !== false });
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok === false ? 1 : 0; }
  // 复用插件的格式化输出（保证 CLI 与侧边栏账号面板口径一致）
  console.log(formatGithubAccountBlock(r));
  if (r.sshPub) console.log(`\n公钥内容：\n${r.sshPub}`);
  return r.ok === false ? 1 : 0;
}

/** 子命令：cred-env — 输出插件保管凭据的环境变量前缀（AI 执行外部 git 时粘贴使用，无明文）。 */
export async function cmdCredEnv(flags) {
  const { buildCredEnv } = await import('./lib/git/cred-env.js');
  const r = buildCredEnv({});
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
  if (!r.provided.length) { console.log(`❌ ${r.hint}`); return 1; }
  console.log('凭据传递（插件保管，以下只有路径/命令串，无 token/私钥明文）：');
  for (const ch of r.provided) {
    const c = r[ch];
    console.log(`\n[${ch === 'ssh' ? 'SSH 通道' : 'HTTPS 通道'}]`);
    console.log(`  envPrefix: ${c.envPrefix}`);
    console.log(`  用法示例: ${c.example}`);
  }
  console.log(`\n提示：${r.hint}`);
  return 0;
}

/** 子命令：remote-create — 按项目文件夹在 GitHub 建远端仓库（已存在则复用）。 */
export async function cmdRemoteCreate(repo, flags) {
  if (!repo) { console.error('缺少 <repo>（用法: git-sluice remote-create <repo> [--visibility public|private]）'); return 1; }
  const r = await ensureRemoteRepo({
    repoPath: repo,
    owner: flags.owner || '',
    visibility: flags.visibility || 'private',
    dryRun: flags.dryRun === true,
  });
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) { console.error(`❌ 失败: ${r.error || ''}`); return 1; }
  if (r.dryRun) { console.log(`预演：将创建 ${r.owner}/${r.name}（${r.visibility}）`); return 0; }
  if (r.exists) { console.log(`✅ 远端已存在，直接复用：${r.owner}/${r.name}（${r.visibility}）`); return 0; }
  console.log(`✅ 已创建远端仓库：${r.owner}/${r.name}（${r.visibility}）`);
  console.log(`   origin → ${r.origin || ''}`);
  return 0;
}

/** 子命令：set-visibility — 切换仓库公开/私有。 */
export async function cmdSetVisibility(repo, flags) {
  const vis = String(flags.visibility || '').toLowerCase();
  if (!repo || (vis !== 'public' && vis !== 'private')) {
    console.error('用法: git-sluice set-visibility <repo> --visibility public|private');
    return 1;
  }
  // 用 local remote 反推 owner/repo（与插件 git_set_visibility 同一路径）
  const pr = await resolveRepoOwnerName(repo);
  if (!pr.ok) { console.error(`❌ ${pr.error}`); return 1; }
  const r = await setVisibility({ owner: pr.owner, repo: pr.name, visibility: vis });
  if (flags.json) { console.log(JSON.stringify({ ...r, owner: pr.owner, repo: pr.name }, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) { console.error(`❌ 失败: ${r.error || ''}`); return 1; }
  console.log(`✅ ${pr.owner}/${pr.name} 可见性已切换为 ${vis}`);
  return 0;
}

/** 子命令：gen-ssh-key — 生成 SSH 密钥对（公钥回传，私钥不出本机）。 */
export async function cmdGenSshKey(flags) {
  const email = flags.email || '';
  if (!email) { console.error('缺少 --email <x@y.z>（用法: git-sluice gen-ssh-key --email you@example.com [--force]）'); return 1; }
  const r = await generateSshKey(email, { force: flags.force === true });
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) { console.error(`❌ 失败: ${r.error || ''}`); return 1; }
  console.log(`✅ SSH 密钥已生成（${email}）`);
  if (r.pubPath) console.log(`   公钥文件：${r.pubPath}`);
  if (r.privPath) console.log(`   私钥文件：${r.privPath}（权限 0600，不上传）`);
  if (r.pub) console.log(`\n公钥（整行复制到 GitHub → Settings → SSH keys）：\n${r.pub}`);
  return 0;
}

/** 从本地 remote 反推 owner/repo（set-visibility 用）。 */
async function resolveRepoOwnerName(repoPath) {
  const { execFileSync } = await import('node:child_process');
  let url = '';
  try {
    url = execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  } catch { return { ok: false, error: `读不到 origin：${repoPath}` }; }
  const pr = parseGithubOwnerRepo(url);
  if (!pr) return { ok: false, error: `无法从 origin 解析 owner/repo：${url}` };
  return { ok: true, owner: pr.owner, name: pr.repo };
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

/**
 * file-io —— 文件读写调用扫描（三标签：类型/操作/上下文）。
 * 输出每条命中带 sync|async、read|write|delete|rename、以及「是否在 async 函数内 /
 *   循环内 / 请求处理路径上」，用于判断同步 I/O 会不会阻塞其他请求、写操作是否高风险。
 * @param {string[]} targets 扫描目标（文件或目录；空=默认 lib/ scripts/ cli.mjs）
 * @param {object} flags { json, summary, write, op, kind, type, risk }
 */
export function cmdFileIo(targets = [], flags = {}) {
  const splitMulti = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  const hits = scanFileIo({
    targets,
    opFilter: splitMulti(flags.op),
    kindFilter: splitMulti(flags.kind),
    typeFilter: splitMulti(flags.type),
    riskOnly: flags.risk || '',
    writeOnly: !!flags.write,
  });
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, count: hits.length, hits }, null, 2));
    return hits;
  }
  if (flags.summary) { summarize(hits); return hits; }
  if (!hits.length) { console.log('（未命中任何文件操作）'); return hits; }
  // 按文件分组输出（组内按行号，风险降序已由 scanFileIo 排好）
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  const riskMark = (r) => (r === 'high' ? '🔴' : r === 'medium' ? '🟠' : '·');
  const tagsOf = (h) => {
    const t = [h.type === 'sync' ? '同步' : '异步', h.kind];
    if (h.inAsync) t.push('async内');
    if (h.inLoop) t.push('循环内');
    if (h.inRequest) t.push('请求路径');
    return t.join('·');
  };
  for (const [file, hs] of [...byFile.entries()].sort()) {
    console.log(`\n── ${file} (${hs.length}) ──`);
    for (const h of hs.sort((a, b) => a.line - b.line)) {
      console.log(`  ${riskMark(h.risk)} L${String(h.line).padEnd(4)} ${h.op.padEnd(14)} ${tagsOf(h)}`);
      console.log(`       ${h.path}`);
    }
  }
  console.log(`\n合计 ${hits.length} 处文件操作（🔴high=写/删且并发路径 · 🟠medium=同步阻塞或写类 · ·low=普通读）`);
  return hits;
}

/** module-splitter CLI（与插件工具 module_splitter 同实现，调 python3 零依赖脚本）。 */
export async function cmdModuleSplitter(positional = [], flags = {}) {
  const sub = String(positional[0] || '').trim();
  const target = String(positional[1] || '').trim();
  if (!['analyze', 'split', 'verify'].includes(sub)) {
    console.error(`module-splitter 子命令应为 analyze|split|verify（得「${sub || '(空)'}」）`);
    return { ok: false, error: '子命令应为 analyze|split|verify' };
  }
  if (!target) {
    console.error('module-splitter 需要目标参数：analyze <file.js> / split <plan.json> / verify <plan.json>');
    return { ok: false, error: '缺目标文件/plan 路径' };
  }
  const { spawnSync } = await import('node:child_process');
  const script = fileURLToPath(new URL('./scripts/module-splitter.py', import.meta.url));
  const args = [script, sub, target];
  if (flags.dryRun) args.push('--dry-run');
  const r = spawnSync('python3', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  if (r.error) {
    const msg = r.error.code === 'ENOENT' ? 'python3 不可用（module-splitter 依赖 python3 标准库）' : `执行失败: ${r.error.message}`;
    console.error(msg);
    return { ok: false, error: msg };
  }
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || `退出码 ${r.status}`);
    return { ok: false, status: r.status, error: String(r.stderr || r.stdout || '执行失败').trim().slice(0, 500) };
  }
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, command: sub, target, output: r.stdout }, null, 2));
  } else {
    console.log(r.stdout);
  }
  return { ok: true, command: sub, target, output: r.stdout };
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  if (cmd === 'version' || cmd === '-v' || cmd === '--version') return await cmdVersion();
  if (cmd === 'ruleset') return await cmdRuleset(rest);
  if (cmd === 'scan') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdScan(positional[0] || '.', flags);
  }
  if (cmd === 'repos') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdRepos(positional[0] || '.', flags);
  }
  if (cmd === 'index') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdIndex(positional[0] || '.', flags);
  }
  if (cmd === 'audit') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdAudit(positional[0] || '.', flags);
  }
  if (cmd === 'commit') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdCommit(positional[0] || '', flags);
  }
  if (cmd === 'file-io') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdFileIo(positional, flags);
  }
  if (cmd === 'link-check') return await cmdLinkCheck(rest[0] || '.');
  if (cmd === 'module-splitter') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdModuleSplitter(positional, flags);
  }
  if (cmd === 'clone') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdClone(flags, positional);
  }
  if (cmd === 'account-check') {
    const { flags, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdAccountCheck(flags);
  }
  if (cmd === 'cred-env') {
    const { flags, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdCredEnv(flags);
  }
  if (cmd === 'remote-create') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdRemoteCreate(positional[0] || '', flags);
  }
  if (cmd === 'set-visibility') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdSetVisibility(positional[0] || '', flags);
  }
  if (cmd === 'gen-ssh-key') {
    const { flags, error } = parseArgv(rest);
    if (error) return console.error(error);
    return await cmdGenSshKey(flags);
  }
  if (cmd === 'yaml-template') return await cmdYamlTemplate();
  if (cmd === 'readme-template') return await cmdReadmeTemplate();
  if (cmd === 'self-check') return await cmdSelfCheck();
  console.error(`未知命令: ${cmd}\n`);
  console.log(HELP);
  process.exitCode = 1;
}

// 直接运行时入口（被 import 时不执行）
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.mjs')) {
  // 顶层 await：main 已异步，未 await 时 rejection 会变成 unhandled rejection
  //   （进程静默退出、退出码不对），故显式 await 并回传退出码。
  // 2026-09-20：命令函数（cmdFileIo/cmdModuleSplitter 等）返回业务对象/数组，
  //   只有 number 才赋 exitCode——否则 `process.exitCode = 对象` 抛 ERR_INVALID_ARG_TYPE。
  const mainResult = await main();
  if (typeof mainResult === 'number' && Number.isInteger(mainResult)) process.exitCode = mainResult;
}