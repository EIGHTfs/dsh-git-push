/**
 * 提交时按文件临时豁免审计（auditExemptPaths）回归
 *
 * 覆盖任务.md 的 4 条验收：
 *   ① 带参数：所列文件的 blocker 不再拦截（含 blocker 级）
 *   ② 未列文件判定与不带参数时一致
 *   ③ 结果可见被豁免的文件与规则清单
 *   ④ 不带该参数时行为与现状零差异
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runAudit } from '../lib/commit-push.js';
import { tempRepo } from './helpers/tmp-dir.mjs';

/** 建一个有基线提交的临时仓库（审计 diff 范围需要 HEAD 作基线）。 */
function makeRepo(t) {
  const dir = tempRepo('exempt', { t });
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['config', 'user.name', 'test']);
  git(['config', 'user.email', 'test@example.com']);
  writeFileSync(join(dir, 'README.md'), '# base\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-qm', 'base']);
  return dir;
}

/** 写一个必然命中 blocker 的文件（硬编码密码，与 test-audit-bad-file.mjs 同源触发）。 */
function writeBlocker(dir, name = 'bad.js') {
  writeFileSync(join(dir, name), [
    '// 审计 blocker 触发器：硬编码密码',
    'const dbPassword = "MyS3cretP@ss!";',
    'const connStr = "mysql://root:abc123@localhost/mydb";',
  ].join('\n'), 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir });
}

test('① 带 auditExemptPaths：所列文件的 blocker 不再拦截', async (t) => {
  const dir = makeRepo(t);
  writeBlocker(dir);
  const r = await runAudit({ repoPath: dir, audit: true, exemptPaths: ['bad.js'] });
  assert.equal(r.ok, true, '豁免后应放行');
  assert.ok(r.audit && r.audit.exempt, '应带回豁免回显');
});

test('② 未列文件照常拦截（只豁免一个，另一个仍拦）', async (t) => {
  const dir = makeRepo(t);
  writeBlocker(dir, 'bad-a.js');
  writeBlocker(dir, 'bad-b.js');
  const r = await runAudit({ repoPath: dir, audit: true, exemptPaths: ['bad-a.js'] });
  assert.equal(r.ok, false, '未列文件仍应拦截');
  assert.ok(r.audit.blocked.some((f) => f.file === 'bad-b.js'), '拦截清单应含未列文件');
  assert.ok(!r.audit.blocked.some((f) => f.file === 'bad-a.js'), '拦截清单不应含已豁免文件');
});

test('③ 回显：files / count / rules / reason', async (t) => {
  const dir = makeRepo(t);
  writeBlocker(dir);
  const r = await runAudit({ repoPath: dir, audit: true, exemptPaths: ['./bad.js'], exemptReason: '测试豁免' });
  assert.equal(r.ok, true);
  const ex = r.audit.exempt;
  assert.deepEqual(ex.files, ['bad.js'], './ 前缀应被归一化');
  assert.ok(ex.count >= 1, '应统计豁免 finding 条数');
  assert.ok(Array.isArray(ex.rules) && ex.rules.length >= 1, '应列出规则清单');
  assert.equal(ex.reason, '测试豁免');
});

test('④ 不带参数：行为与现状零差异（仍拦截、无 exempt 字段）', async (t) => {
  const dir = makeRepo(t);
  writeBlocker(dir);
  const r = await runAudit({ repoPath: dir, audit: true });
  assert.equal(r.ok, false);
  assert.ok(!r.audit.exempt, '不带参数不应出现豁免字段');
});
