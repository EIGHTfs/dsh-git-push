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
import { readFileSync } from 'node:fs';

/** parseArgv 认识的选项白名单（cli-help-sync 机器比对基准，必须与 HELP 文本一致）。 */
export const KNOWN_FLAGS = ['--depth', '--full'];

const HELP = `git-sluice v${VERSION} — dsh-git-push 引擎独立 CLI（脱离 DSH 运行）

用法:
  git-sluice version              查看版本
  git-sluice ruleset [槽位...]    编译规则包并输出统计（默认全部槽位）
  git-sluice scan <root> [--depth N]   全量扫描目录（非 git 目录可查）
  git-sluice audit <root>         审计目录（默认 diff 范围；--full 走全量）
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
  const flags = { depth: undefined, full: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--depth') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `--depth 缺值（用法: --depth N）` };
      flags.depth = Number(v);
    } else if (a === '--full') flags.full = true;
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

/** 子命令：scan — 全量扫描目录。 */
export function cmdScan(root, flags) {
  const depth = flags.depth ?? 3;
  const res = auditWithScope(root, { scope: 'full', depth });
  console.log(`扫描 ${root}（full，depth=${depth}）`);
  console.log(`  findings: ${res.summary.total}（blocker ${res.summary.blocker} / warning ${res.summary.warning}）`);
  for (const f of res.findings.slice(0, 20)) {
    console.log(`  [${f.severity}] ${f.rule} ${f.file}:${f.line} ${f.message || ''}`);
  }
}

/** 子命令：audit — 审计目录。 */
export function cmdAudit(root, flags) {
  const res = auditWithScope(root, { scope: flags.full ? 'full' : 'diff' });
  const q = scoreQuality(res.findings);
  console.log(`审计 ${root}（scope=${res.scope}）`);
  console.log(`  summary: ${JSON.stringify(res.summary)}`);
  console.log(`  quality: ${q.score}/100（${q.level}）`);
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
  const h = helpSync(HELP, KNOWN_FLAGS);
  let fail = 0;
  console.log('自身自检:');
  console.log(`  version: v${VERSION}`);
  if (!h.ok) {
    fail++;
    console.error(`  ✗ cli-help-sync: HELP 与 parseArgv 不一致`);
    for (const f of h.missingInHelp) console.error(`    parseArgv 认但 HELP 没写: ${f}`);
    for (const f of h.missingInParse) console.error(`    HELP 写了但 parseArgv 不认: ${f}`);
  } else {
    console.log(`  ✓ cli-help-sync: HELP 与 parseArgv 一致（${h.helpFlags.join(' ')}）`);
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
  if (cmd === 'audit') {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return cmdAudit(positional[0] || '.', flags);
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