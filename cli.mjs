#!/usr/bin/env node
/**
 * dsh-git-push 独立 CLI（v1.44.0）——脱离 DSH 直接调用插件引擎（用户需求：补个脚本可以脱离插件调用）
 *
 * 原理：只 import 纯引擎模块（core.js / audit.js / rule-packs.js / full-scan.js / quality.js / repo-index.js），
 * 不 import lib/index.js 与任何 plugin-*.js（那层是 DSH 接线：工具/设置页/HTTP/systemPrompt）。
 * 零第三方依赖；Node ≥18。
 *
 * 命令：
 *   audit      <repo>                       L0 静态审计（blocker 拦截，退出码 2）
 *   full-scan  <repo>                       全仓 AI 对话残留注释扫描（只读报告，--fail-on-warn 时退出码 3）
 *   commit     <repo> -m <msg>              审计门禁 → 提交（默认 push:false；--push 推远端）
 *   scan       [root]                       扫描目录下的 git 仓库与变更
 *   ruleset    [nodejs,frontend,comment]   编译 YAML 规则集（作者自检）
 *
 * 通用参数：--json（原始 JSON 输出） --ruleset <槽位顺序> --help
 * 退出码：0 成功 / 1 用法错误 / 2 审计拦截或提交失败 / 3 full-scan 警告（--fail-on-warn 时）
 *
 * L1 LLM 深度审查、设置页、HTTP API、推送许可面板为 DSH 接线层专属，本 CLI 不含。
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commitAndPush, scanRepos } from './lib/core.js';
import { auditRepo } from './lib/audit.js';
import { fullScanRepo } from './lib/full-scan.js';
import { getCompiledRulePack, RULE_SLOTS, DEFAULT_RULE_ORDER } from './lib/rule-packs.js';

const VERSION = '1.47.0';

/** argv 解析：位置参数 + --flag / --key value / -m value（零依赖手写） */
function parseArgv(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--push') flags.push = true;
    else if (a === '--no-push') flags.push = false;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--req-confirm') flags.reqConfirm = true;
    else if (a === '--fail-on-warn') flags.failOnWarn = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--ruleset') flags.ruleset = argv[++i] ?? '';
    else if (a === '-m' || a === '--message') flags.message = argv[++i] ?? '';
    else if (a.startsWith('--')) return { pos, flags, bad: a };
    else pos.push(a);
  }
  return { pos, flags };
}

const HELP = `git-sluice v${VERSION} — dsh-git-push 引擎独立 CLI（脱离 DSH 运行）

用法：git-sluice <命令> <参数> [选项]

命令：
  audit <repo>                     L0 静态审计（规则包 blocker 拦截；退出码 2=拦截）
  full-scan <repo>                 全仓 AI 对话残留注释扫描（分数制黑加白减；只读报告）
  commit <repo> -m <msg>           审计门禁 → 提交（默认只 commit 不 push；--push 推远端）
  scan [root] [--depth N]          扫描目录下 git 仓库与变更统计
  ruleset [nodejs,frontend,comment]   编译 YAML 规则集（作者自检；缺省默认顺序）
  help                             本帮助

选项：
  --ruleset <槽位顺序>                 临时换规则顺序（如 comment,nodejs；缺省 nodejs,frontend,comment）
  --json                            输出原始 JSON
  --no-push / --push                commit 是否推送（默认不推）
  --dry-run                         commit 只模拟
  --req-confirm                     声明已核对开发者特殊要求（缺省未核对会拒绝提交）
  --fail-on-warn                    full-scan 有 ⚠ 警告时退出码 3（CI 用）

退出码：0 成功 / 1 用法错误 / 2 审计拦截或提交失败 / 3 full-scan 警告
说明：token/SSH 从插件配置目录探测，独立环境缺省走系统 git 凭据；L1 LLM 审计为 DSH 专属不在本 CLI。`;

/** 装载规则集：''/builtin/eightfs = 默认顺序 YAML；'a,b,c' = 逗号分隔槽位顺序；失败直接退出（CLI 场景 fail fast） */
async function loadRuleset(choice) {
  const c = String(choice || '').trim();
  const order = !c || c === 'builtin' || c === 'eightfs' || c === 'default'
    ? undefined
    : c.split(',').map((s) => s.trim()).filter((s) => RULE_SLOTS.includes(s));
  const rs = getCompiledRulePack(order);
  return rs;
}

/** 人读输出：findings 摘要表 */
function printFindings(findings, { json }) {
  if (json) return;
  const b = findings.filter((f) => f.level === 'blocker');
  const w = findings.filter((f) => f.level === 'warning');
  console.log(`blocker ${b.length} / warning ${w.length}`);
  for (const f of findings) console.log(`  [${f.level}] ${f.rule} ${f.file} — ${f.message}`);
}

/** 人读输出：full-scan 表格 */
function printFullScan(r, { json }) {
  if (json) return;
  console.log(r.table);
}

/** 人读输出：仓库扫描 */
function printScan(repos, { json }) {
  if (json) return;
  console.log(`发现 ${repos.length} 个 git 仓库（有变更的才列出分支/未提交数）：`);
  for (const r of repos) console.log(`  ${r.path}  branch=${r.branch || '-'}  未提交=${r.dirty ?? r.uncommitted ?? '-'}`);
}

/** 命令：audit */
async function cmdAudit({ pos, flags }) {
  const repo = resolve(pos[0] || '');
  if (!repo || !existsSync(join(repo, '.git'))) { console.error(`不是 git 仓库: ${pos[0] || '(空)'}`); return 1; }
  const rs = await loadRuleset(flags.ruleset);
  const result = auditRepo(repo, { ruleset: rs, blockOn: 'blocker' });
  if (!result.ok) { console.error(`审计失败: ${result.error}`); return 2; }
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`审计 ${repo}（规则包 ${rs.meta.name} v${rs.meta.version} / ${rs.meta.owner} / ${rs.meta.source}）`);
    printFindings(result.findings, flags);
    console.log(`质量评分 ${result.quality?.score ?? '-'}（${result.quality?.level ?? '-'} 级）| 拦截=${result.blocked}`);
  }
  return result.blocked ? 2 : 0;
}

/** 命令：full-scan */
async function cmdFullScan({ pos, flags }) {
  const repo = resolve(pos[0] || '');
  if (!repo || !existsSync(join(repo, '.git'))) { console.error(`不是 git 仓库: ${pos[0] || '(空)'}`); return 1; }
  const rs = await loadRuleset(flags.ruleset);
  const fs = rs.fullScan || undefined; // 缺省由引擎内置
  const result = fullScanRepo(repo, { fullScan: fs });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else printFullScan(result, flags);
  if (flags.failOnWarn && result.warnCount > 0) return 3;
  return 0;
}

/** 命令：commit（审计门禁 → 提交） */
async function cmdCommit({ pos, flags }) {
  const repo = resolve(pos[0] || '');
  if (!repo || !existsSync(join(repo, '.git'))) { console.error(`不是 git 仓库: ${pos[0] || '(空)'}`); return 1; }
  if (!String(flags.message || '').trim()) { console.error('缺少 -m <commit message>'); return 1; }
  // 1) 审计门禁（与 DSH 提交链同语义：blocker 拦截）
  const rs = await loadRuleset(flags.ruleset);
  const audit = auditRepo(repo, { ruleset: rs, blockOn: 'blocker' });
  if (audit.ok && audit.blocked) {
    console.error('审计拦截（blocker），提交中止：');
    printFindings(audit.findings, {});
    return 2;
  }
  // 2) 提交（requirementsConfirmed 缺省 false：与 DSH 门禁同语义，--req-confirm 显式核对后才放行）
  const result = await commitAndPush({
    repoPath: repo,
    message: flags.message,
    push: flags.push === true,
    dryRun: flags.dryRun === true,
    requirementsConfirmed: flags.reqConfirm === true,
    workspaceRoot: repo,
  });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    if (!result.ok && result.error) console.error(`提交失败: ${typeof result.error === 'string' ? result.error : JSON.stringify(result.error)}`);
    console.log(JSON.stringify(result, null, 2).slice(0, 2000));
  }
  return result.ok ? 0 : 2;
}

/** 命令：scan */
async function cmdScan({ pos, flags }) {
  const root = resolve(pos[0] || process.cwd());
  const depth = Number(flags.depth) > 0 ? Number(flags.depth) : 3;
  const repos = scanRepos({ root, depth });
  if (flags.json) console.log(JSON.stringify({ ok: true, root, count: repos.length, repos }, null, 2));
  else printScan(repos, flags);
  return 0;
}

/** 命令：ruleset（作者自检：校验 + 编译 + 计数） */
async function cmdRuleset({ pos, flags }) {
  const choice = pos[0] || 'builtin';
  const rs = await loadRuleset(choice);
  const counts = {
    secret: rs.secretPatterns.length,
    credentialFile: rs.credentialFileRes.length,
    credentialRef: rs.credentialRefPatterns.length,
    commentWording: rs.wordingPatterns.length,
    docConversation: rs.docConvPatterns.length,
    codeQuality: Object.keys(rs.codeQuality || {}).length,
    loadErrors: rs.errors.length,
    fullScan: rs.fullScan ? { threshold: rs.fullScan.threshold, keywords: rs.fullScan.keywords.length, protectWords: rs.fullScan.protectWords.length } : '(内置缺省)',
  };
  if (flags.json) console.log(JSON.stringify({ ok: true, meta: rs.meta, counts }, null, 2));
  else {
    console.log(`规则包 ${rs.meta.name} v${rs.meta.version}（${rs.meta.owner} / ${rs.meta.source}）编译 OK`);
    console.log(JSON.stringify(counts, null, 2));
  }
  return rs.errors.length ? 2 : 0;
}

/** 命令：help（打印帮助退出 0） */
function cmdHelp() {
  console.log(HELP);
  return 0;
}

const COMMANDS = { audit: cmdAudit, 'full-scan': cmdFullScan, commit: cmdCommit, scan: cmdScan, ruleset: cmdRuleset, help: cmdHelp };

async function main() {
  const argv = process.argv.slice(2);
  const { pos, flags, bad } = parseArgv(argv);
  if (bad) { console.error(`未知参数: ${bad}`); console.log(HELP); return 1; }
  if (flags.help || !pos.length) { console.log(HELP); return 0; }
  const cmd = pos[0];
  const fn = COMMANDS[cmd];
  if (!fn) { console.error(`未知命令: ${cmd}`); console.log(HELP); return 1; }
  try {
    return await fn({ pos: pos.slice(1), flags });
  } catch (e) {
    console.error(`执行失败: ${String(e?.message ?? e)}`);
    return 2;
  }
}

main().then((code) => process.exit(code ?? 0)).catch((e) => { console.error(String(e)); process.exit(1); });
