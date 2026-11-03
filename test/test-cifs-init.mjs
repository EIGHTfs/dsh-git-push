/**
 * CIFS/SMB 挂载上的本地仓库初始化与 origin 设置（2026-11-02）。
 *
 * 背景：smb2 挂载上 `git init` 会在写 `.git/config` 时 `chmod config.lock` 失败而**半途退出**，
 *   留下没有 HEAD/objects 的残缺 `.git`。老实现只判 `existsSync('.git')` 就去 `git remote add`，
 *   于是 `remote add` 报「not a git repository」，而函数仍返回成功 —— 用户看到「建仓成功」但本地不可用。
 *
 * 现在统一走 `ensureUsableLocalRepo`（复用 clone 已在用的 CIFS 安全 init）：
 *   已可用 → keep；残缺 → repair；没有 → create；并如实回报 origin 结果。
 * 本测试用**仓库内的临时目录**（本机即 CIFS 挂载），因此跑的就是真实挂载条件。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureUsableLocalRepo, isUsableRepo } from '../lib/git/init-compat.js';
import { prepareLocalRepoForRemote } from '../lib/git/remote.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
// 临时目录放在**仓库的父目录**（工作区根，同样是 CIFS 挂载）：放仓库内会被 git 向上当成父仓库的一部分
const WORKSPACE_ROOT = join(REPO_ROOT, '..');

/** 在仓库内建临时目录（走真实挂载 FS，而非 /tmp）。 */
function withDir(fn) {
  const dir = mkdtempSync(join(WORKSPACE_ROOT, '.tmp-cifs-init-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const gitOk = (dir, args) => {
  try { execFileSync('git', args, { cwd: dir, stdio: 'ignore' }); return true; } catch { return false; }
};

test('全新目录：ensureUsableLocalRepo 建出可用仓库', () => withDir((dir) => {
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  const r = ensureUsableLocalRepo(dir, { branch: 'main', remoteUrl: 'https://github.com/x/y.git' });
  assert.equal(r.ok, true, `初始化失败：${r.stderr || ''}`);
  assert.equal(r.action, 'create');
  assert.equal(isUsableRepo(dir), true, 'git 必须能识别这个仓库');
  assert.equal(gitOk(dir, ['status', '--short']), true, '工作区可用');
  // 注意：**不要**在这里断言 origin —— 只有降级路径（手写 .git）才会顺带把 remote 写进 config；
  //   正常文件系统上 `git init` 可用，remote 由 `prepareLocalRepoForRemote` 随后补 add。
  //   早期版本在这里断言了 origin，于是本地 CIFS 通过、GitHub runner（ext4）失败。
  assert.equal(r.action, 'create');
}));

test('残缺 .git（CIFS 上 git init 半途而废的形态）：应被修复', () => withDir((dir) => {
  // 复刻真实残缺形态：有 .git 与 config，但没有 HEAD/objects
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  assert.equal(isUsableRepo(dir), false, '残缺 .git 不应被当成可用仓库');
  const r = ensureUsableLocalRepo(dir, { branch: 'main' });
  assert.equal(r.ok, true, `修复失败：${r.stderr || ''}`);
  assert.equal(r.action, 'repair');
  assert.equal(isUsableRepo(dir), true);
  assert.ok(existsSync(join(dir, '.git', 'HEAD')), '应补上 HEAD');
}));

test('已可用的仓库：再次调用保持不动（keep）', () => withDir((dir) => {
  ensureUsableLocalRepo(dir, { branch: 'main' });
  const again = ensureUsableLocalRepo(dir, { branch: 'main' });
  assert.equal(again.ok, true);
  assert.equal(again.action, 'keep');
}));

test('prepareLocalRepoForRemote：建仓后本地可用且 origin 指向该仓库', () => withDir((dir) => {
  const r = prepareLocalRepoForRemote(dir, 'EIGHTfs', 'demo-proj');
  assert.equal(r.ok, true, `准备失败：${r.error || ''}`);
  assert.equal(r.url, 'https://github.com/EIGHTfs/demo-proj');
  assert.equal(isUsableRepo(dir), true);
  const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(origin, 'https://github.com/EIGHTfs/demo-proj');
}));

test('CIFS 上「本地提交」可行（首推的前提）', () => withDir((dir) => {
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  ensureUsableLocalRepo(dir, { branch: 'main' });
  assert.equal(gitOk(dir, ['add', '-A']), true, 'git add 应可写 index');
  const committed = gitOk(dir, ['-c', 'user.name=t', '-c', 'user.email=t@e.f', 'commit', '-m', 'init']);
  assert.equal(committed, true, '本地提交应成功（否则首推无从下手）');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.match(head, /^[0-9a-f]{40}$/);
}));
