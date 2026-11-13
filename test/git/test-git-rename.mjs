/**
 * 远程仓库改名（git_remote_rename）测试。
 *
 * 设计要点：改名不可逆，故 dryRun 默认开，且必须先把「旧名散落在哪」列清楚——
 *   package.json 的 repository/homepage、README 的克隆地址、CI 配置……
 *   改完还要把本地 remote 同步过去，否则就会出现「远端改了、本地还指着旧的」。
 *
 * 本测试只覆盖**不触网**的部分：参数校验、旧名扫描（含 URL 形态分类）、remote 识别；
 *   真正的 PATCH 由 GitHub API 完成，联调靠 dryRun 人工核。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { remotesPointingTo, renameRepo, scanOldName } from '../../lib/git/rename.js';

function withRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-rename-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('非法新名 → 直接拒绝（不触网）', async () => {
  for (const bad of ['', 'has space', 'a/b', 'x'.repeat(101), '名字']) {
    const r = await renameRepo({ repoPath: '/tmp', newName: bad });
    assert.equal(r.ok, false, `应拒绝：${bad}`);
    assert.match(r.error, /不合法/);
  }
});

test('新名与当前名相同 → 拒绝', () => withRepo(async (root) => {
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:EIGHTfs/demo.git'], { cwd: root });
  const r = await renameRepo({ repoPath: root, newName: 'demo' });
  assert.equal(r.ok, false);
  assert.match(r.error, /相同/);
}));

test('缺 repo → 报错', async () => {
  const r = await renameRepo({ repoPath: '', newName: 'ok-name' });
  assert.equal(r.ok, false);
  assert.match(r.error, /repo 必填/);
});

test('scanOldName：能扫到名字与 URL 两种形态，且 URL 优先展示', () => withRepo((root) => {
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'demo',
    repository: { url: 'git+https://github.com/EIGHTfs/demo.git' },
  }, null, 2));
  writeFileSync(join(root, 'README.md'), '# demo\n\n克隆：git clone https://github.com/EIGHTfs/demo.git\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  const r = scanOldName(root, 'demo');
  assert.equal(r.scanned, true);
  assert.ok(r.total >= 3, `至少要扫到 3 处，实际 ${r.total}`);
  assert.ok(r.urlLike >= 2, `URL 形态至少 2 处，实际 ${r.urlLike}`);
  assert.equal(r.samples[0].kind, 'url', 'URL 形态必须排在样例最前面（改名后必须改的就是它们）');
  assert.ok(Object.keys(r.byFile).includes('package.json'));
}));

test('remotesPointingTo：只列出指向该仓库的 remote，带 URL', () => withRepo((root) => {
  execFileSync('git', ['remote', 'add', 'origin', 'ssh://git@ssh.github.com:443/EIGHTfs/demo.git'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'github-ssh', 'ssh://git@ssh.github.com:443/EIGHTfs/demo.git'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'other', 'git@github.com:EIGHTfs/unrelated.git'], { cwd: root });
  const list = remotesPointingTo(root, 'EIGHTfs', 'demo');
  assert.deepEqual(list.map((r) => r.name).sort(), ['github-ssh', 'origin']);
  assert.ok(list.every((r) => r.url.includes('/demo')));
}));

test('remotesPointingTo：没有匹配时返回空（不误报）', () => withRepo((root) => {
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:someone/other.git'], { cwd: root });
  assert.deepEqual(remotesPointingTo(root, 'EIGHTfs', 'demo'), []);
}));
