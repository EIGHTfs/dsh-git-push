#!/usr/bin/env node
/**
 * 审计扩展统一入口（CLI）——独立跑 scripts/audit-ext/ 下全部审计扩展脚本。
 *
 * 用法：
 *   node scripts/audit-runner.mjs <repo> [--dir scripts/audit-ext] [--json]
 *
 * 与插件审计的关系：auditFull/auditWithScope 已自动并入 audit-ext 扩展 findings
 * （source 标记 ext:<name>）；本脚本用于独立调试/单独跑扩展（不带核心审计）。
 */

import { runAuditExt } from '../lib/audit/ext-runner.js';

async function main() {
  const argv = process.argv.slice(2);
  const repo = argv.find((a) => !a.startsWith('--')) || process.cwd();
  const dirIdx = argv.indexOf('--dir');
  const dir = dirIdx >= 0 ? argv[dirIdx + 1] : undefined;
  const json = argv.includes('--json');

  const findings = await runAuditExt(repo, { dir, log: console });
  if (json) {
    console.log(JSON.stringify({ repo, extFindings: findings.length, findings }, null, 2));
    return;
  }
  console.log(`审计扩展 ${repo} → ${findings.length} 条 findings（source: ext:*）`);
  for (const f of findings.slice(0, 20)) {
    console.log(`  ${f.source} ${f.file || ''}:${f.line || ''} [${f.severity || 'warning'}] ${(f.message || '').slice(0, 60)}`);
  }
}

main().catch((e) => { console.error('audit-runner 失败:', e); process.exitCode = 1; });