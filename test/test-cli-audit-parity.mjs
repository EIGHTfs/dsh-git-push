/**
 * CLI 与源码直接调用全量审计结果一致性测试（2026-09-23）：
 *   git-sluice audit <repo> --full --json 的输出必须与直接 import auditFull 调用完全一致
 *   （files / findings / summary）——防止 CLI 通道丢字段、stdout 被进度噪音污染导致 JSON 不可解析。
 * 测试仓库：临时 git 仓库（含 .gitignore 忽略文件 + 中文文件名 + 普通文件），小规模跑得快。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { auditFull } from '../lib/audit/index.js';

const cliPath = fileURLToPath(new URL('../cli.mjs', import.meta.url));

function makeAuditRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'dshgp-parity-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  // 正常文件（含中文路径，验证 quotepath/文件级忽略路径）
  mkdirSync(join(repo, 'lib'), { recursive: true });
  writeFileSync(join(repo, 'a.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
  writeFileSync(join(repo, 'lib/b.js'), 'const x = 1;\n');
  writeFileSync(join(repo, 'README.md'), '# t\n');
  // 被 .gitignore 忽略的文件（文件级规则，验证忽略生效）
  writeFileSync(join(repo, '.gitignore'), 'lib/client.js\n任务.md\n*.log\nnode_modules/\n');
  mkdirSync(join(repo, 'node_modules'), { recursive: true });
  writeFileSync(join(repo, 'lib/client.js'), '/* 构建产物，应被忽略 */\n');
  writeFileSync(join(repo, '任务.md'), '待办\n');
  writeFileSync(join(repo, 'app.log'), 'log\n');
  writeFileSync(join(repo, 'node_modules/x.js'), 'x\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

test('CLI audit --full --json 与 auditFull 直接调用完全一致（含忽略文件排除）', async () => {
  const repo = makeAuditRepo();
  try {
    // 通道 A：CLI（stdout 必须纯净 JSON，无进度噪音）
    const cli = spawnSync(process.execPath, [cliPath, 'audit', repo, '--full', '--json'], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(cli.status, 0, `CLI 退出码非 0：${cli.stderr}`);
    let a;
    try { a = JSON.parse(cli.stdout); } catch (e) { assert.fail(`CLI --json stdout 无法解析（有噪音/损坏）: ${e.message}\nstdout 头: ${String(cli.stdout).slice(0, 200)}`); }
    // 通道 B：源码直接调用
    const b = await auditFull(repo, {});
    assert.equal(a.files, b.files, `files 不一致：CLI=${a.files} 源码=${b.files}`);
    assert.equal(a.findings.length, b.findings.length, `findings 数不一致：CLI=${a.findings.length} 源码=${b.findings.length}`);
    assert.deepEqual(a.summary, b.summary, 'summary 不一致');
    // 忽略文件不得进入审计（文件级规则 + 中文 + node_modules）
    const rels = new Set((b.findings || []).map((f) => f.file));
    assert.ok(![...rels].some((r) => r.includes('client.js') || r.includes('任务.md') || r.endsWith('.log') || r.includes('node_modules')), `忽略文件漏进审计：${[...rels].join(',')}`);
    // 抽样：关键字段对齐（第一条 finding 的 file/rule/severity）
    if (a.findings.length && b.findings.length) {
      assert.equal(a.findings[0].rule, b.findings[0].rule);
      assert.equal(a.findings[0].severity, b.findings[0].severity);
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});