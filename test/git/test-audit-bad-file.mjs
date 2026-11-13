/**
 * 审计拦截测试：
 * 故意提交含敏感信息的文件，验证审计门禁能拦截 blocker。
 *
 * 零污染纪律（2026-11-06 改造）：全部动作在 **tmp 目录里的独立 git 仓库** 进行，
 *   不再向真实项目根写临时文件 + git add。旧写法有两类残留实录：
 *   ① 批次进程被 SIGKILL（超时/中断）时 finally 不执行，.tmp-test-*.js 留在真实仓库
 *     index 里；② 残留被 doc-tree sync 收进 tree-doc.json 键与 FILE-TREE.md 行，
 *     文件删了键还在，真实根 checkDrift 从此报 stale/orphan 假漂移。
 *   临时仓库被杀也只是杀一个 mkdtemp 目录，真实仓库 git 状态与文档索引不可能被触碰。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { runAudit } from '../../lib/commit-push.js';

const cfg = { auditEnabled: true, auditScanScope: 'diff', auditLevel: 'standard' };

// 独立临时 git 仓库：一个基线提交 + 干净工作区，diff 审计范围由此而来
let ROOT = '';
before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'dshgp-badfile-'));
  ROOT = join(tmp, 'repo');
  mkdirSync(ROOT, { recursive: true });
  const git = (args) => execSync(`git ${args}`, { cwd: ROOT, stdio: 'ignore' });
  git('init -q');
  git('config user.email test@dsh.local');
  git('config user.name dsh-test');
  writeFileSync(join(ROOT, 'README.md'), '# fixture\n');
  git('add README.md');
  git('commit -qm baseline');
});
after(() => { if (ROOT) rmSync(join(ROOT, '..'), { recursive: true, force: true }); });

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
  // 必须用真实 .env 文件名——凭据文件路径规则（credfile-common 的
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
