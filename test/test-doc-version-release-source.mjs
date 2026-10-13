/**
 * 回归：发版拆环 —— 版本列表最新行改由 docs/releases.json 提供（提交前即可生成/校验）。
 *
 * 背景（2026-10-13）：历史实现里「最新行」的标题只能来自 git log ⇒ 发版必须「先提交 → 再生成 → 再 amend」。
 * 现在：当前版本的标题可来自 docs/releases.json ⇒ 生成/校验在提交前即成立，一条提交一次到位。
 *   历史行仍来自 git log（无需维护）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { buildVersionListText, checkVersionDrift } from '../scripts/doc-version.mjs';

/** 造临时 git 仓库：git log 里只有旧版本提交；package.json 为当前版本；可选 docs/releases.json。 */
function fixture(version, releases) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ver-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('commit', '--allow-empty', '-q', '-m', 'release(1.0.0): 旧版本');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version }), 'utf8');
  if (releases) {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'releases.json'), JSON.stringify(releases), 'utf8');
  }
  return root;
}

test('无 releases.json：退回既有行为（最新行版本号被 package.json 覆盖）', () => {
  const { text } = buildVersionListText(fixture('2.0.0'));
  assert.match(text, /\| 2\.0\.0 \|/);
});

test('有 releases.json：提交前也生成当前版本的**正确标题行**（拆环关键）', () => {
  const { text } = buildVersionListText(fixture('2.0.0', { '2.0.0': '本版标题：拆环' }));
  assert.match(text, /\| 2\.0\.0 \| 本版标题：拆环 \|/);
  // 既有语义：git log 只有一条历史行时，那条就是「最新数据行」，其版本号按 package.json 覆盖 ⇒ 不再出现 1.0.0。
  assert.equal((text.match(/^\|\s*\d+\.\d+\.\d+\s*\|/gm) || []).length, 1, '应只有一行数据行');
});

test('幂等 + check 直接通过（写入宿主后再校验，不需要任何提交动作）', () => {
  const root = fixture('2.0.0', { '2.0.0': '本版标题：拆环' });
  const a = buildVersionListText(root).text;
  const b = buildVersionListText(root).text;
  assert.equal(a, b, '同一输入重复生成必须完全一致');
  const host = join(root, 'README.md');
  writeFileSync(host, `<!-- dshgp-version:start -->\n${a}\n<!-- dshgp-version:end -->\n`, 'utf8');
  const r = checkVersionDrift({ hostPath: host, root });
  assert.equal(r.ok, true, `check 应通过，实得：${r.issues.map((i) => i.msg).join(' / ')}`);
});

test('releases.json 非法 JSON 不阻断（静默退回 git log 行为）', () => {
  const root = fixture('2.0.0');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'releases.json'), '{ 坏 JSON', 'utf8');
  const { text } = buildVersionListText(root);
  assert.match(text, /\| 2\.0\.0 \|/, '仍应出表（不抛错）');
});
