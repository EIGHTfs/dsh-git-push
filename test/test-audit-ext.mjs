import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------- 审计扩展自动接入（重构：统一入口动态加载） ----------

import { loadAuditExt, runAuditExt, DEFAULT_EXT_DIR } from '../lib/audit/ext-runner.js';

test('ext-runner：DEFAULT_EXT_DIR 指向插件根 scripts/audit-ext', () => {
  assert.ok(DEFAULT_EXT_DIR.endsWith('scripts/audit-ext'), DEFAULT_EXT_DIR);
});

test('ext-runner：动态加载契约脚本 + _ 前缀示例不加载', async () => {
  const exts = await loadAuditExt(DEFAULT_EXT_DIR);
  // 真实扩展（非 _ 前缀）被加载：variable-min-length（内置规则抽出试点）
  assert.ok(exts.some((e) => e.name === 'variable-min-length'), 'variable-min-length 扩展加载');
  // 演示契约的 _ 前缀脚本不参与实际审计
  assert.ok(!exts.some((e) => e.name === 'example-readme-present'), '_ 前缀示例不加载');
});

test('ext-runner：契约执行——有 README 不报，缺 README 报 info', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-ext-test-'));
  writeFileSync(join(dir, 'ok-ext.mjs'), `
    export const auditExt = {
      name: 't-check-readme',
      match: (repo) => Boolean(repo),
      run: async (repo) => {
        const { existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        if (!existsSync(join(repo, 'README.md'))) {
          return [{ file: 'README.md', line: 1, rule: 'ext/readme-present', severity: 'info', message: '缺 README', dimensions: ['文档'] }];
        }
        return [];
      },
    };
  `, 'utf8');
  const repo = mkdtempSync(join(tmpdir(), 'repo-'));
  const findings = await runAuditExt(repo, { dir });
  assert.equal(findings.length, 1, '缺 README 应报 1 条');
  assert.ok(findings[0].source.startsWith('ext:t-check-readme'), 'source 标记 ext:<name>');
  // 有 README 不报
  writeFileSync(join(repo, 'README.md'), '# r\n', 'utf8');
  const findings2 = await runAuditExt(repo, { dir });
  assert.equal(findings2.length, 0);
});

test('ext-runner：match 返回 false 跳过该扩展', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-ext-match-'));
  writeFileSync(join(dir, 'skip.mjs'), `
    export const auditExt = {
      name: 't-skip',
      match: (repo) => repo === 'ONLY_THIS',
      run: async () => [{ file: 'x', line: 1, rule: 'ext/skip', severity: 'warning', message: '不应出现' }],
    };
  `, 'utf8');
  const f = await runAuditExt('/elsewhere', { dir });
  assert.equal(f.length, 0, 'match false 应跳过');
  const f2 = await runAuditExt('ONLY_THIS', { dir });
  assert.equal(f2.length, 1, 'match true 应执行');
});

test('ext-runner：单脚本失败降级跳过（不中断其他扩展）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-ext-fail-'));
  writeFileSync(join(dir, 'bad.mjs'), 'export const auditExt = { name: "t-bad", run: async () => { throw new Error("boom"); } };\n', 'utf8');
  writeFileSync(join(dir, 'good.mjs'), `
    export const auditExt = { name: 't-good', run: async () => [{ file: 'g', line: 1, rule: 'ext/good', severity: 'warning', message: 'ok' }] };
  `, 'utf8');
  const f = await runAuditExt('/repo', { dir });
  assert.equal(f.length, 1, '坏脚本降级跳过，好脚本仍出结果');
  assert.equal(f[0].source, 'ext:t-good');
});

// ---------- auditFull 自动并入扩展（端到端） ----------

test('auditFull：扩展 findings 自动并入（auditExtDir 注入）', async () => {
  const { auditFull } = await import('../lib/audit/orchestrate.js');
  await import('../lib/rule/compilers.js');
  // 临时扩展目录（缺 README 报 info）
  const extDir = mkdtempSync(join(tmpdir(), 'audit-ext-dir-'));
  writeFileSync(join(extDir, 'need-readme.mjs'), `
    export const auditExt = { name: 't-need-readme', run: async (repo) => {
      const { existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      return existsSync(join(repo, 'README.md')) ? [] : [{ file: 'README.md', line: 1, rule: 'ext/need-readme', severity: 'info', message: '缺 README', dimensions: ['文档'] }];
    } };
  `, 'utf8');
  // 临时仓库（无 README → 扩展报 info）
  const repo = mkdtempSync(join(tmpdir(), 'audit-ext-full-'));
  const r = await auditFull(repo, { auditExtDir: extDir });
  const ext = (r.findings || []).filter((f) => f.source && f.source.startsWith('ext:'));
  assert.ok(ext.length >= 1, 'auditFull 应并入扩展 findings（缺 README 报 info）');
  assert.ok(ext.some((f) => f.source === 'ext:t-need-readme'), '注入扩展接入');
  assert.equal(ext.filter((f) => f.source === 'ext:t-need-readme').length, 1, '同 repo 只跑一次');
});
