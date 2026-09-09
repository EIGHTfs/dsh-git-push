#!/usr/bin/env node
/**
 * dsh-git-push-v2 独立 CLI（git-sluice）
 * 不依赖 DSH 运行时，可独立运行。命名/参数与 lib 函数完全一致（外部 API 与函数名一致）。
 */
import { VERSION } from './lib/self/index.js';
import { loadRuleFiles, RULE_SLOTS, discoverRuleSlots } from './lib/rule/loader.js';
import { compileAllRules } from './lib/rule/registry.js';
import { auditWithScope } from './lib/audit/index.js';
import { scoreQuality } from './lib/score/index.js';

const HELP = `git-sluice v${VERSION} — dsh-git-push-v2 引擎独立 CLI（脱离 DSH 运行）

用法:
  git-sluice version              查看版本
  git-sluice ruleset [槽位...]    编译规则包并输出统计（默认全部槽位）
  git-sluice scan <root> [--depth N]   全量扫描目录（非 git 目录可查）
  git-sluice audit <root>         审计目录（默认 diff 范围；--full 走全量）
  git-sluice help                 显示本帮助
`;

/** 参数解析：白名单必须与 HELP 文本完全一致（cli-help-sync 自检）。 */
export function parseArgv(argv) {
  const flags = { depth: undefined, full: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--depth') flags.depth = Number(argv[++i]);
    else if (a === '--full') flags.full = true;
    else if (a.startsWith('--')) return { error: `未知参数: ${a}` };
    else positional.push(a);
  }
  return { flags, positional };
}

/** 子命令：version */
export function cmdVersion() {
  console.log(`git-sluice v${VERSION} — dsh-git-push-v2（统一函数入口架构）`);
}

/** 子命令：ruleset — 编译规则包输出统计。 */
export function cmdRuleset(slots) {
  const order = slots.length ? slots : RULE_SLOTS;
  const { ok, merged, errors, files } = loadRuleFiles(order);
  const ctx = { errors: [] };
  const compiled = compileAllRules(merged.rules, ctx);
  if (!ok || ctx.errors.length) {
    console.error('规则编译失败:');
    for (const e of [...errors, ...ctx.errors]) console.error('  ✗ ' + e);
    process.exitCode = 1;
    return;
  }
  console.log(`规则包编译 OK（${order.join('+')}）`);
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
  console.error(`未知命令: ${cmd}\n`);
  console.log(HELP);
  process.exitCode = 1;
}

// 直接运行时入口（被 import 时不执行）
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.mjs')) {
  main();
}