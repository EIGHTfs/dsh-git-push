/**
 * 审计拦截测试（2026-09-14）：
 * 故意提交含敏感信息的文件，验证审计门禁能拦截 blocker。
 * 测试完自动清理临时文件，不污染仓库。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import { runAudit } from '../lib/commit-push.js';

const ROOT = join(import.meta.dirname, '..');
const cfg = { auditEnabled: true, auditScanScope: 'diff', auditLevel: 'standard' };

// 创建临时有问题文件并 git add，测试完清理
function setupBadFile(relPath, content) {
  const full = join(ROOT, relPath);
  writeFileSync(full, content, 'utf8');
  execSync(`git add -f "${relPath}"`, { cwd: ROOT, stdio: 'ignore' });
  return full;
}
function cleanup(relPath) {
  const full = join(ROOT, relPath);
  try { execSync(`git reset HEAD "${relPath}"`, { cwd: ROOT, stdio: 'ignore' }); } catch { /* noop */ }
  try { unlinkSync(full); } catch { /* noop */ }
}

test('审计拦截：硬编码密码 → blocker', async () => {
  const rel = '.tmp-test-bad-password.js';
  setupBadFile(rel, [
    '// 测试文件：故意包含硬编码密码',
    'const dbPassword = "MyS3cretP@ss!";',
    'const connStr = "mysql://root:abc123@localhost/mydb";',
    'console.log(dbPassword);',
  ].join('\n'));
  try {
    const r = await runAudit({ repoPath: ROOT, cfg });
    assert.equal(r.ok, false, '应被拦截');
    assert.equal(r.blocked, true, 'blocked 应为 true');
    assert.ok(r.audit, '应有审计摘要');
    assert.ok(r.audit.summary.blocker > 0, 'blocker 数应 > 0');
    assert.match(r.error, /blocker/, '错误信息应含 blocker');
  } finally { cleanup(rel); }
});

test('审计拦截：硬编码 API key → blocker', async () => {
  const rel = '.tmp-test-bad-apikey.js';
  setupBadFile(rel, [
    '// 测试文件：故意包含 API key',
    'const apiKey = "sk-1234567890abcdef1234567890abcdef";',
    'const awsKey = "AKIAIOSFODNN7EXAMPLE";',
    'console.log(apiKey, awsKey);',
  ].join('\n'));
  try {
    const r = await runAudit({ repoPath: ROOT, cfg });
    assert.equal(r.ok, false, '应被拦截');
    assert.equal(r.blocked, true);
    assert.ok(r.audit.summary.blocker > 0);
  } finally { cleanup(rel); }
});

test('审计拦截：敏感文件（.env）→ blocker', async () => {
  // 2026-09-14：必须用真实 .env 文件名——凭据文件路径规则（credfile-common 的
  //   path_pattern `(^|[\\/])\.env`）要求「.env 前是路径开头或斜杠」，`.tmp-test-bad.env`
  //   这类前缀名会绕过规则模式。真实 .env / .env.local / config/.env 均被拦截。
  const rel = '.env';
  setupBadFile(rel, [
    '# 测试文件：故意提交 .env',
    'DB_HOST=localhost',
    'DB_PASS=supersecret',
    'API_KEY=ghp_xxxxxxxxxxxx',
  ].join('\n'));
  try {
    const r = await runAudit({ repoPath: ROOT, cfg });
    assert.equal(r.ok, false, '应被拦截');
    assert.equal(r.blocked, true);
  } finally { cleanup(rel); }
});

test('审计通过：正常文件 → ok', async () => {
  const rel = '.tmp-test-good.js';
  setupBadFile(rel, [
    '// 测试文件：正常代码，无敏感信息',
    'export function add(a, b) { return a + b; }',
    'console.log(add(1, 2));',
  ].join('\n'));
  try {
    const r = await runAudit({ repoPath: ROOT, cfg });
    assert.equal(r.ok, true, '正常文件应通过');
    assert.equal(r.blocked, undefined, '不应有 blocked');
  } finally { cleanup(rel); }
});

test('审计跳过：auditEnabled=false → 直接通过', async () => {
  const rel = '.tmp-test-skip.js';
  setupBadFile(rel, [
    'const password = "should-not-matter";',
  ].join('\n'));
  try {
    const r = await runAudit({ repoPath: ROOT, cfg: { auditEnabled: false } });
    assert.equal(r.ok, true, '审计关闭时应直接通过');
    assert.equal(r.audit, null, 'audit 应为 null');
  } finally { cleanup(rel); }
});
