// 忽略策略回归测试：把「审计豁免 ≠ 文件不存在」这条设计口径钉死。
//
// 背景（排查 6 轮才定位，必须锁住）：collectTextFiles 原先在建集时**只喂目录**，
//   文件级 .gitignore/.auditignore 规则命中不了；下游又加了一层「事后过滤」去补，
//   两层参数还不一致（一个有 --no-index 一个没有）⇒ 行为互相掩盖，
//   导致被 .auditignore 豁免的文件（如 Pawchive 的 adapters/KToolBox-webui.js）整目录从架构 facts 消失。
//
// 两条不变量（任一被破坏就失败）：
//   ① `respectAuditIgnore: false`（架构事实用）⇒ 被 .auditignore 豁免的文件**必须出现**
//   ② `respectAuditIgnore: true`（审计默认） ⇒ 同一文件**必须不出现**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectTextFiles } from '../lib/audit/collector.js';

/** 造一个 git 仓库：lib/keep.js 正常、lib/exempt.js 被 .auditignore 豁免。 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-ignore-'));
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'keep.js'), 'export const keep = 1;\n');
  writeFileSync(join(dir, 'lib', 'exempt.js'), 'export const exempt = 2;\n');
  writeFileSync(join(dir, '.auditignore'), 'lib/exempt.js\n');
  writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(dir, 'ignored.txt'), 'x\n');
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
  return dir;
}

const paths = (list) => list.map((f) => String(f.path).replace(/\\/g, '/'));

test('策略分离：.auditignore 只影响审计策略，不影响架构（repository）策略', async () => {
  const dir = makeRepo();
  try {
    // 架构事实策略：豁免文件必须出现
    const repo = paths(await collectTextFiles(dir, { depth: 5, gitIgnoreRoot: dir, respectAuditIgnore: false }));
    assert.ok(repo.includes('lib/exempt.js'),
      `respectAuditIgnore=false 时被豁免文件必须出现，实得：${repo.join(', ')}`);
    assert.ok(repo.includes('lib/keep.js'), '普通文件必须出现');
    // 审计策略：豁免文件必须不出现
    const audit = paths(await collectTextFiles(dir, { depth: 5, gitIgnoreRoot: dir, respectAuditIgnore: true }));
    assert.ok(!audit.includes('lib/exempt.js'),
      `respectAuditIgnore=true 时被豁免文件必须被排除，实得：${audit.join(', ')}`);
    assert.ok(audit.includes('lib/keep.js'), '普通文件在两种策略下都应出现');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('文件级 .gitignore 规则生效（建集必须覆盖文件，而不只是目录）', async () => {
  const dir = makeRepo();
  try {
    const repo = paths(await collectTextFiles(dir, { depth: 5, gitIgnoreRoot: dir, respectAuditIgnore: false }));
    assert.ok(!repo.includes('ignored.txt'),
      `.gitignore 的 ignored.txt 必须被排除（建集只喂目录时会漏掉它），实得：${repo.join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('非 git 目录也能收集（不因缺 .git 而报错或返回空）', async () => {
  const dir = makeRepo();
  try {
    rmSync(join(dir, '.git'), { recursive: true, force: true });
    const list = paths(await collectTextFiles(dir, { depth: 5 }));
    assert.ok(list.includes('lib/keep.js'), `非 git 目录也应收集到文件，实得：${list.join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
