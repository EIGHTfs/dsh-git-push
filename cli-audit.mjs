#!/usr/bin/env node
/**
 * audit-sluice 入口（宿主侧薄转发器）
 *
 * 审计实现已整体搬到独立包 `audit-sluice`；本文件只保留「三入口」的对外形态
 *   （`git-sluice` / `audit-sluice` / `tool-sluice`），实际执行交给审计包 CLI。
 * 为什么保留：① 已有用户/脚本按 `audit-sluice <子命令>` 调用；② 三入口契约有机器门禁
 *   （test/tool/test-cli.mjs），入口消失会让契约测试红。
 * 退出码原样透传（0 无 blocker / 1 有 blocker / 2 执行失败）。
 */
import { spawn } from 'node:child_process';
import { resolveAuditSluiceEntry } from './lib/commit-push/pre-commit-engine.js';

const HELP = `audit-sluice — 审计 CLI（实现在独立包 audit-sluice，本入口转发）

  audit-sluice audit --repo <路径> --scope diff|full [--visibility private|public|unknown] [--exempt-paths a,b] [--exempt-reason <理由>] [--ruleset <目录>] [--weights <JSON>] [--compact|--no-compact] [--blockers-only] [--max-scan-files N] [--slots <包,...>] [--disabled-slots <包,...>] [--json]
  audit-sluice manifest --json
  audit-sluice io_scan --repo <路径> [--write-only] [--json]
  audit-sluice link_check --path <文件或目录> [--json]
  audit-sluice scope_check --repo <路径> [--files <f1,f2>] [--prefix <前缀>] [--allowlist <a,b>] [--top-level-must-be-empty] [--json]
  audit-sluice exempt_hint --action add|remove|list|check [--repo <路径>] [--path <文件>] [--line N] [--scope header|line] [--rule <规则>] [--marker <dsh-skip-*>] [--reason <理由>] [--dry-run] [--json]

退出码：0 无 blocker / 1 有 blocker / 2 执行失败
`;

const wantsHelp = process.argv.length <= 2 || ['help', '--help', '-h'].includes(process.argv[2]);
if (wantsHelp) { process.stdout.write(HELP); process.exit(0); }

const entry = resolveAuditSluiceEntry();
if (!entry.ok) {
  process.stderr.write(`审计包不可用：${entry.error}\n`);
  process.exit(2);
}
const child = spawn(process.execPath, [entry.path, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.exit(2);
  process.exit(typeof code === 'number' ? code : 2);
});
child.on('error', (e) => { process.stderr.write(`启动审计包失败：${e?.message || e}\n`); process.exit(2); });
