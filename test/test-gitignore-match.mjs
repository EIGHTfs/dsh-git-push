/**
 * `.auditignore` 非 git 目录兜底（2026-09-18）。
 *
 * 背景：`.auditignore` 原先只走 `git check-ignore`，因此**仅在 git 仓库内生效**——
 *   非 git 目录（解压的源码包、临时导出目录、未 init 的工程）下该文件形同不存在，
 *   同一个 `*.sh` 规则在 `git init` 前后行为相反。
 *
 * 本文件两层锁定：
 *   ① 纯 JS 匹配器 `lib/audit/gitignore-match.js` 的语义**逐条对齐真 git**（有 git 时直接对拍）
 *   ② 端到端：非 git 目录跑 auditFull，`.auditignore` 必须生效，且结果与 git init 后一致
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseGitignore, isIgnoredByRules, isIgnored } from '../lib/audit/gitignore-match.js';
import { auditFull } from '../lib/audit/index.js';

/** git 是否可用（不可用时只跑不依赖 git 的用例）。 */
function gitAvailable() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const HAS_GIT = gitAvailable();

/** 搭一棵固定结构的目录树，返回根路径。 */
function makeTree() {
  const dir = mkdtempSync(join(tmpdir(), 'gim-'));
  for (const f of ['root.sh', 'sub/s.sh', 'deep/a/b/x.sh', 'keep.sh', 'a.lock', 'sub/b.lock', 'gen/g.js', 'lib/main.js']) {
    const p = join(dir, f);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, 'x\n');
  }
  return dir;
}
const ALL = ['root.sh', 'sub/s.sh', 'deep/a/b/x.sh', 'keep.sh', 'a.lock', 'sub/b.lock', 'gen/g.js', 'lib/main.js'];

test('匹配器：基础语义（*.sh 任意层级 / /*.sh 仅根 / 目录规则 / 否定）', () => {
  const ig = (text, f) => isIgnored(text, f);
  // *.sh 匹配任意层级（这是 gitignore 语义，不是只根目录）
  assert.equal(ig('*.sh', 'root.sh'), true);
  assert.equal(ig('*.sh', 'sub/s.sh'), true);
  assert.equal(ig('*.sh', 'deep/a/b/x.sh'), true);
  assert.equal(ig('*.sh', 'lib/main.js'), false);
  // 前导 / 锚定到根
  assert.equal(ig('/*.sh', 'root.sh'), true);
  assert.equal(ig('/*.sh', 'sub/s.sh'), false);
  // 含 / 的模式从根锚定
  assert.equal(ig('sub/*.sh', 'sub/s.sh'), true);
  assert.equal(ig('sub/*.sh', 'deep/a/b/x.sh'), false);
  // 目录规则命中其下全部后代
  assert.equal(ig('gen/', 'gen/g.js'), true);
  assert.equal(ig('gen/', 'gen'), true);
  assert.equal(ig('gen/', 'other/g.js'), false);
  // 否定：后出现的覆盖先出现的
  assert.equal(ig('*.sh\n!keep.sh', 'keep.sh'), false);
  assert.equal(ig('*.sh\n!keep.sh', 'root.sh'), true);
  // 注释与空行
  assert.equal(ig('# 注释\n\n*.sh\n', 'root.sh'), true);
});

test('匹配器：与真 git 逐条对拍（有 git 时）', { skip: !HAS_GIT && 'git 不可用' }, () => {
  const dir = makeTree();
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const CASES = ['*.sh', '/*.sh', 'sub/*.sh', '**/*.sh', '*.lock', 'gen/', '*.sh\n!keep.sh', '*.sh\n!sub/\n!sub/s.sh', 'gen/\n!gen/keep.js'];
    for (const pat of CASES) {
      writeFileSync(join(dir, '.gitignore'), pat + '\n');
      let gitIgnored = [];
      try {
        gitIgnored = execFileSync('git', ['check-ignore', '--no-index', ...ALL], { cwd: dir, encoding: 'utf8' })
          .trim().split('\n').filter(Boolean);
      } catch { /* exit 1 = 无命中 */ }
      const mine = ALL.filter((f) => isIgnored(pat, f));
      assert.deepEqual(mine.sort(), gitIgnored.sort(), `规则 ${JSON.stringify(pat)} 与 git 判定不一致`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('端到端：非 git 目录下 .auditignore 生效（*.sh 被豁免）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gim-nogit-'));
  try {
    for (const f of ['build.sh', 'scripts/setup.sh', 'deep/nested/run.sh', 'src/main.js']) {
      const p = join(dir, f);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, "const badlyNamedVariable = 1\n");
    }
    writeFileSync(join(dir, '.auditignore'), '*.sh\n');
    assert.ok(!existsSync(join(dir, '.git')), '本用例要求非 git 目录');
    const r = await auditFull(dir, {});
    const files = [...new Set((r.findings || []).map((f) => f.file))];
    assert.ok(!files.some((f) => f.endsWith('.sh')), `非 git 下 .sh 应被 .auditignore 豁免，实际审计到: ${files.join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('端到端：非 git 与 git 结果一致（同一棵树、同一规则）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gim-both-'));
  try {
    for (const f of ['build.sh', 'gen/a.js', 'src/main.js']) {
      const p = join(dir, f);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, "const badlyNamedVariable = 1\n");
    }
    writeFileSync(join(dir, '.auditignore'), '*.sh\ngen/\n');
    const before = [...new Set(((await auditFull(dir, {})).findings || []).map((f) => f.file))].sort();
    if (HAS_GIT) {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      const after = [...new Set(((await auditFull(dir, {})).findings || []).map((f) => f.file))].sort();
      assert.deepEqual(after, before, 'git init 前后审计结果应一致（兜底与 git 路径等价）');
    }
    assert.ok(!before.some((f) => f.endsWith('.sh')), '.sh 应被豁免');
    assert.ok(!before.some((f) => f.startsWith('gen/')), 'gen/ 应整棵豁免');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('端到端：无 .auditignore 时不受影响（不误伤）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gim-none-'));
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'a.sh'), "const badlyNamedVariable = 1\n");
    const r = await auditFull(dir, {});
    const files = [...new Set((r.findings || []).map((f) => f.file))];
    assert.ok(files.some((f) => f.endsWith('a.sh')), '无 .auditignore 时 .sh 应正常纳入审计');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('解析器：目录规则与否定规则的字段正确', () => {
  const rules = parseGitignore('gen/\n!keep.sh\n/rooted.txt');
  assert.equal(rules.length, 3);
  assert.equal(rules[0].dirOnly, true, 'gen/ 应标记为目录规则');
  assert.equal(rules[1].negated, true, '!keep.sh 应标记为否定');
  assert.equal(rules[2].anchored, true, '/rooted.txt 应锚定到根');
  const hits = (rel) => isIgnoredByRules(rules, rel);
  assert.equal(hits('gen/x.js'), true);
  assert.equal(hits('keep.sh'), false);
  assert.equal(hits('rooted.txt'), true);
  assert.equal(hits('sub/rooted.txt'), false);
});
