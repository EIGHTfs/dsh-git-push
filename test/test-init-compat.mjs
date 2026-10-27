/**
 * git 仓库初始化兼容层回归（CIFS/SMB 等不支持 chmod 的文件系统）。
 *
 * 为什么必须有这组测试（2026-10-28 实测事故）：
 *   往 CIFS 挂载（`nounix`）里克隆仓库时，`git init` 会 fatal：
 *     `error: chmod on .../.git/config.lock failed: Operation not permitted`
 *     `fatal: could not set 'core.filemode' to 'false'`
 *   原因是 git init 要把 `core.filemode` **写入** `.git/config`，写 config 走
 *   `config.lock → chmod → rename`，而那些卷上 chmod 恒 EPERM。
 *   直接后果：目标目录留下一个未初始化的空 `.git`，克隆整体失败（用户侧就是
 *   「克隆到 SMB 一直失败」）。
 *
 * 修法：探测 chmod 能力，不支持时手写最小 `.git` 结构（HEAD + config[filemode=false]
 *   + 空 objects/refs/info），绕开 git 的 config 写入流程。
 *
 * 这组测试守两件事：
 *   ① 两条分支真的分开走了（能 chmod 走 git init、不能则走 manual）；
 *   ② 降级路径搭出来的仓库**真的是可用仓库**（add/commit/log/status/remote 全通）——
 *      只断言「文件存在」是不够的，结构不全时 git 只是静默不认，正是历史事故形态。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { fsSupportsChmod, writeMinimalGitDir, initRepoCompat } from '../lib/git/init-compat.js';

/** 建临时目录并放一个工作树文件（降级路径需要「已有内容」的目录才有意义）。 */
function tmpRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'initcompat-'));
  writeFileSync(join(dir, 'a.js'), 'console.log(1);\n');
  return dir;
}

/** 在该目录跑 git（测试内联，断言真实可用性而非只看文件）。 */
function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('fsSupportsChmod：本机临时目录支持 chmod（对照组）', () => {
  const dir = tmpRepo();
  try {
    assert.equal(fsSupportsChmod(dir), true, '本地盘必须探测为支持 chmod，否则降级分支会误触发');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('initRepoCompat：支持 chmod 时走标准 git init', () => {
  const dir = tmpRepo();
  try {
    const r = initRepoCompat(dir, { branch: 'main' });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'git-init');
    assert.equal(r.filemode, true);
    assert.ok(existsSync(join(dir, '.git', 'config')), '标准 init 必须生成 .git/config');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('initRepoCompat：不支持 chmod 时降级为手工结构，且不产生空壳 .git', () => {
  const dir = tmpRepo();
  try {
    const r = initRepoCompat(dir, { branch: 'main', chmodOk: false });
    assert.equal(r.ok, true, `降级初始化必须成功：${r.stderr || ''}`);
    assert.equal(r.via, 'manual');
    assert.equal(r.filemode, false);
    // 结构四件套
    for (const p of ['.git/HEAD', '.git/config', '.git/objects', '.git/refs']) {
      assert.ok(existsSync(join(dir, p)), `缺 ${p}`);
    }
    // HEAD 指向目标分支
    assert.equal(readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim(), 'ref: refs/heads/main');
    // filemode 必须预置 false —— 否则 CIFS 上所有文件恒被报成 modified
    assert.match(readFileSync(join(dir, '.git', 'config'), 'utf8'), /filemode = false/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('降级结构是真仓库：add / commit / log / status / remote 全部可用', () => {
  const dir = tmpRepo();
  const url = 'https://github.com/example/demo.git';
  try {
    const r = initRepoCompat(dir, { branch: 'main', remoteUrl: url, chmodOk: false });
    assert.equal(r.ok, true, `降级初始化失败：${r.stderr || ''}`);
    // 真实 git 操作链（这是「结构完整」的唯一可信判据）
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-qm', 'init']);
    assert.match(git(dir, ['log', '--oneline']), /init/, 'commit 后应能读到提交');
    assert.equal(git(dir, ['status', '--short']), '', 'status 必须干净（无 filemode 噪音）');
    assert.equal(git(dir, ['rev-parse', '--is-inside-work-tree']), 'true');
    // remote 段手写进 config 后必须能被 git 读出来（fetch/push 依赖它）
    assert.equal(git(dir, ['remote', 'get-url', 'origin']), url);
    // 分支名必须真的落到 refs/heads/<branch>
    assert.equal(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('writeMinimalGitDir：不给 remoteUrl 时不写 remote 段', () => {
  const dir = tmpRepo();
  try {
    writeMinimalGitDir(dir, { branch: 'master' });
    const cfg = readFileSync(join(dir, '.git', 'config'), 'utf8');
    assert.doesNotMatch(cfg, /\[remote/, '无 remoteUrl 时不应凭空写 remote 段');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('initRepoCompat：结构搭好但 git 不认时返回失败（不许静默成功）', () => {
  // 历史事故形态就是「以为 init 成功、其实是空壳」——自检失败必须显式报错
  const dir = tmpRepo();
  try {
    const r = initRepoCompat(dir, {
      chmodOk: false,
      gitInit: () => ({ ok: false, stderr: '模拟 git 不可用' }),
    });
    assert.equal(r.ok, false, '自检失败必须 ok:false');
    assert.match(String(r.stderr), /模拟 git 不可用|自检失败/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
