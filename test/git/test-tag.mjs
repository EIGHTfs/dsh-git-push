/**
 * tag 管理（lib/git/tag.js）回归
 *
 * 重点锁三件事，它们都是「看着成功、实际出错」的类型：
 *   ① dryRun 必须真的不落盘（否则用户以为只是预演，结果 tag 已经打上了）；
 *   ② 同名 tag 默认绝不覆盖（覆盖等于改写发布含义，必须显式 force）；
 *   ③ 删除必须 confirm（不可逆操作不能因为参数缺省就执行）。
 * 远端相关分支用注入的假 fetch 覆盖，不需要真实网络。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTag, deleteTag, isValidTagName, listLocalTags, localTagExists, pushTag,
} from '../../lib/git/tag.js';

/** 造一个有初始提交的临时仓库（tag 必须有 commit 可指）。 */
function makeRepo() {
  const repoPath = mkdtempSync(join(tmpdir(), 'dshgp-tagrepo-'));
  const git = (args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repoPath, stdio: 'pipe' });
  git(['init', '-q']);
  // 仓库级身份：createTag 内部用 runGit 打 annotated tag，需要 committer 身份
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  git(['commit', '--allow-empty', '-q', '-m', 'init']);
  return { repoPath, cleanup: () => { try { rmSync(repoPath, { recursive: true, force: true }); } catch { /* 忽略 */ } } };
}

test('isValidTagName：合法名通过，危险形态一律拒绝', () => {
  for (const good of ['v1.0.0', 'release-1.0', 'v3.2.0-rc.1', 'a/b']) {
    assert.equal(isValidTagName(good), true, `${good} 应合法`);
  }
  for (const bad of ['', ' bad', 'bad tag', '..x', 'v1..0', 'x~1', 'x^1', 'x:1', 'x?1', 'x*1', '/lead', 'trail/', '.lead', 'trail.', 'x.lock', 'a@{1}']) {
    assert.equal(isValidTagName(bad), false, `${JSON.stringify(bad)} 应被拒绝`);
  }
});

test('createTag dryRun：返回预览但**不落盘**', async () => {
  const { repoPath, cleanup } = makeRepo();
  try {
    const result = await createTag({ repoPath, tag: 'v0.0.1-probe', dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.ok(result.sha, '预览里应带目标 sha');
    assert.ok(result.commit, '预览里应带 commit 摘要，便于确认指向对不对');
    assert.equal(localTagExists(repoPath, 'v0.0.1-probe'), false, 'dryRun 绝不能真的建 tag');
  } finally { cleanup(); }
});

test('createTag 真建轻量 tag：本地可查到', async () => {
  const { repoPath, cleanup } = makeRepo();
  try {
    const result = await createTag({ repoPath, tag: 'v0.0.2', dryRun: false });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.localCreated, true);
    assert.equal(localTagExists(repoPath, 'v0.0.2'), true);
    assert.deepEqual(listLocalTags({ repoPath }).tags, ['v0.0.2']);
  } finally { cleanup(); }
});

test('createTag annotated：带 message，并记录 annotated=true', async () => {
  const { repoPath, cleanup } = makeRepo();
  try {
    const result = await createTag({ repoPath, tag: 'v0.0.3', message: 'release 0.0.3', annotated: true, dryRun: false });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.annotated, true);
    // annotated tag 的对象类型是 tag，轻量 tag 是 commit
    const type = execFileSync('git', ['cat-file', '-t', 'v0.0.3'], { cwd: repoPath, encoding: 'utf8' }).trim();
    assert.equal(type, 'tag', '给了 message 应建 annotated tag（对象类型 tag）');
  } finally { cleanup(); }
});

test('同名 tag 已存在：默认拒绝覆盖；force 才覆盖', async () => {
  const { repoPath, cleanup } = makeRepo();
  try {
    await createTag({ repoPath, tag: 'v0.0.4', dryRun: false });
    const refused = await createTag({ repoPath, tag: 'v0.0.4', dryRun: false });
    assert.equal(refused.ok, false, '默认绝不覆盖同名 tag');
    assert.match(refused.error, /已存在/);
    const forced = await createTag({ repoPath, tag: 'v0.0.4', dryRun: false, force: true });
    assert.equal(forced.ok, true, 'force 时应允许覆盖');
  } finally { cleanup(); }
});

test('非法 tag 名：建与删都被前置拒绝，不落到 git', async () => {
  const { repoPath, cleanup } = makeRepo();
  try {
    const created = await createTag({ repoPath, tag: 'bad tag', dryRun: false });
    assert.equal(created.ok, false);
    assert.match(created.error, /不合法/);
    const deleted = await deleteTag({ repoPath, tag: 'bad tag', dryRun: false, confirm: true });
    assert.equal(deleted.ok, false);
  } finally { cleanup(); }
});

test('deleteTag：默认 dryRun；真删不传 confirm 被拒；传了才删', async () => {
  const { repoPath, cleanup } = makeRepo();
  try {
    await createTag({ repoPath, tag: 'v0.0.5', dryRun: false });
    const dry = await deleteTag({ repoPath, tag: 'v0.0.5' });
    assert.equal(dry.ok, true);
    assert.equal(dry.dryRun, true);
    assert.equal(localTagExists(repoPath, 'v0.0.5'), true, 'dryRun 不该删');

    const refused = await deleteTag({ repoPath, tag: 'v0.0.5', dryRun: false });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /confirm/);
    assert.equal(localTagExists(repoPath, 'v0.0.5'), true, '没 confirm 不该删');

    const done = await deleteTag({ repoPath, tag: 'v0.0.5', dryRun: false, confirm: true, deleteRemote: false });
    assert.equal(done.ok, true, done.error);
    assert.equal(localTagExists(repoPath, 'v0.0.5'), false);
  } finally { cleanup(); }
});

test('pushTag：本地没有该 tag 时明确报错（不去推一个不存在的东西）', async () => {
  const { repoPath, cleanup } = makeRepo();
  try {
    const result = await pushTag({ repoPath, tag: 'v9.9.9', dryRun: false });
    assert.equal(result.ok, false);
    assert.match(result.error, /本地没有/);
  } finally { cleanup(); }
});

test('pushTag dryRun：报告两条通道各自可用性，不发起推送', async () => {
  const { repoPath, cleanup } = makeRepo();
  try {
    await createTag({ repoPath, tag: 'v0.0.6', dryRun: false });
    const preview = await pushTag({ repoPath, tag: 'v0.0.6', dryRun: true });
    assert.equal(preview.ok, true);
    assert.equal(preview.dryRun, true);
    assert.ok(preview.channels, '预览应说明 API / git 两条通道是否可用');
    assert.equal(typeof preview.channels.git, 'boolean');
  } finally { cleanup(); }
});
