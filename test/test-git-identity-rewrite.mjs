/**
 * 提交身份历史改写（lib/git/identity-rewrite.js）回归测试。
 *
 * 钉子（都是安全属性，不能只测 happy path）：
 *   ① dryRun 报告命中数但**一个字节都不写**（HEAD 不变、没有备份引用）
 *   ② 真改写：身份全规范、提交数不变、工作树内容不变、备份引用存在
 *   ③ 未命中的提交（别人的身份）**sha 完全不变**——证明只动了该动的
 *   ④ 已跟踪文件有改动 → 拒绝改写（不把未保存的工作卷进历史重写）
 *   ⑤ 只有未跟踪文件 → 不该被拦（很多仓库有大量未跟踪产物）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../lib/git/exec.js';
import {
  buildLegacyIdentityHint, identityHits, legacyIdentityReport, parseGithubRepo, rewriteRepoIdentity, wrongIdentityEmails,
} from '../lib/git/identity-rewrite.js';

const CANON = { name: 'EIGHTfs', email: '38984640+EIGHTfs@users.noreply.github.com' };
const OTHER = { name: 'Other', email: 'other@example.com' };
const TS = '20990101'; // 固定时间戳 → 备份引用路径可预期

function makeRepo() {
  const dir = mkdtempTracked(join(tmpdir(), 'dshgp-idnrw-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  // 仓库局部身份：故意用非规范身份，模拟「没配身份的仓库」
  execFileSync('git', ['config', '--local', 'user.name', 'DSH Agent'], { cwd: dir });
  execFileSync('git', ['config', '--local', 'user.email', 'agent@dsh.local'], { cwd: dir });
  return dir;
}

/** 造一个提交（committer 用给定身份，author 可另指）。 */
function commit(dir, msg, { author = null, committer = { name: 'DSH Agent', email: 'agent@dsh.local' } } = {}) {
  const args = ['-c', `user.name=${committer.name}`, '-c', `user.email=${committer.email}`, 'commit', '-q', '--allow-empty', '-m', msg];
  if (author) args.push(`--author=${author.name} <${author.email}>`);
  execFileSync('git', args, { cwd: dir });
}

/** 当前 HEAD 的全部身份（去重）。 */
function identities(dir) {
  return execFileSync('git', ['log', '--format=%ae|%ce'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').sort();
}

function repoWrongEmails() {
  return wrongIdentityEmails({ account: { login: 'EIGHTfs' }, extra: ['862434889@qq.com'] });
}

test('wrongIdentityEmails：含工具身份 + 账号 noreply 变体 + 额外邮箱（小写去重）', () => {
  const list = repoWrongEmails();
  for (const e of ['agent@dsh.local', 'eightfs@local', 'v2-clone@local', '862434889@qq.com',
    'eightfs@users.noreply.github.com']) {
    assert.ok(list.includes(e), `应包含 ${e}`);
  }
  assert.equal(new Set(list).size, list.length, '不得重复');
  assert.ok(list.every((e) => e === e.toLowerCase()), '统一小写比较');
});

test('parseGithubRepo：ssh / https / api 三种写法都认', () => {
  assert.deepEqual(parseGithubRepo('ssh://git@ssh.github.com:443/EIGHTfs/dsh-git-push.git'), { owner: 'EIGHTfs', repo: 'dsh-git-push' });
  assert.deepEqual(parseGithubRepo('https://github.com/EIGHTfs/dsh-git-push.git'), { owner: 'EIGHTfs', repo: 'dsh-git-push' });
  assert.deepEqual(parseGithubRepo('https://api.github.com/repos/EIGHTfs/spine-multi-viewer'), { owner: 'EIGHTfs', repo: 'spine-multi-viewer' });
  assert.equal(parseGithubRepo('/volume1/local/repo'), null);
  assert.equal(parseGithubRepo(''), null);
});

test('dryRun：报命中数但不写任何东西', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'c1 agent');
    commit(dir, 'c2 other', { author: OTHER, committer: OTHER });
    commit(dir, 'c3 old noreply', { author: { name: 'EIGHTfs', email: 'EIGHTfs@users.noreply.github.com' } });
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const r = rewriteRepoIdentity(dir, { runGit, canonical: CANON, wrongEmails: repoWrongEmails(), dryRun: true, timestamp: TS });
    assert.equal(r.skipped, undefined);
    assert.equal(r.branches.length, 1);
    assert.equal(r.branches[0].hits, 2, 'c1（committer 命中）+ c3（author 命中）= 2 条');
    assert.equal(r.branches[0].dryRun, true);
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(), headBefore, 'dryRun 不得动 HEAD');
    const backup = runGit(['rev-parse', '--verify', `refs/backup/identity-rewrite/${TS}/master`], { cwd: dir });
    assert.equal(backup.ok, false, 'dryRun 不得建备份引用');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('apply：身份全规范、提交数/树不变、未命中提交的字段与树一模一样', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'c1 agent');
    commit(dir, 'c2 other', { author: OTHER, committer: OTHER });
    commit(dir, 'c3 old noreply', { author: { name: 'EIGHTfs', email: 'EIGHTfs@users.noreply.github.com' } });
    const before = execFileSync('git', ['log', '--format=%H %ae %ce %s'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
    const otherBefore = before.find((l) => l.includes('other@example.com'));

    const r = rewriteRepoIdentity(dir, { runGit, canonical: CANON, wrongEmails: repoWrongEmails(), dryRun: false, timestamp: TS });
    const b = r.branches[0];
    assert.equal(b.hits, 2);
    assert.equal(b.before, b.after, '提交数必须不变');
    assert.equal(b.stillWrong, 0, '不得残留非规范身份');
    assert.equal(b.treeChanged, false, '工作树内容不得变');
    assert.ok(b.backupRef, '必须留下备份引用');
    assert.equal(b.push, undefined, 'push=false 时不做推送动作');

    const after = execFileSync('git', ['log', '--format=%H %ae %ce %s'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
    const otherAfter = after.find((l) => l.includes('other@example.com'));
    // 未命中身份的提交：**字段（作者/committer/标题）与树原样保留**；
    //   sha 会随祖先改写而变化（git 提交对象哈希包含父提交 sha），这是改写语义的必然结果。
    assert.equal(otherAfter.split(' ').slice(1).join(' '), otherBefore.split(' ').slice(1).join(' '),
      '未命中身份的提交字段必须原样保留');
    const otherShaBefore = otherBefore.split(' ')[0];
    const otherShaAfter = otherAfter.split(' ')[0];
    const treeOld = execFileSync('git', ['rev-parse', `${otherShaBefore}^{tree}`], { cwd: dir, encoding: 'utf8' }).trim();
    const treeNew = execFileSync('git', ['rev-parse', `${otherShaAfter}^{tree}`], { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(treeNew, treeOld, '未命中身份的提交树内容必须一致');
    const ids = identities(dir);
    assert.ok(ids.every((l) => l.includes(CANON.email) || l.includes(OTHER.email)), `身份应只剩规范身份与他人身份：${ids.join(' / ')}`);
    // 备份引用指向改写前 HEAD，可回滚
    const backupHead = execFileSync('git', ['rev-parse', `refs/backup/identity-rewrite/${TS}/master`], { cwd: dir, encoding: 'utf8' }).trim();
    assert.notEqual(backupHead, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(), '备份引用应指向改写前的提交');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('已跟踪文件有改动 → 拒绝改写（不碰未保存的工作）', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'a.txt'), 'v1\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: dir });
    commit(dir, 'c1 agent');
    appendFileSync(join(dir, 'a.txt'), 'v2\n'); // 已跟踪文件被改动
    const r = rewriteRepoIdentity(dir, { runGit, canonical: CANON, wrongEmails: repoWrongEmails(), dryRun: false, timestamp: TS });
    assert.equal(r.skipped, true);
    assert.match(r.reason, /已跟踪文件改动/);
    assert.equal(r.branches.length, 0, '跳过时不得做任何分支级动作');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('只有未跟踪文件 → 不该被拦（大量未跟踪产物是常态）', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'c1 agent');
    writeFileSync(join(dir, 'untracked.bin'), 'x'); // 未跟踪
    const r = rewriteRepoIdentity(dir, { runGit, canonical: CANON, wrongEmails: repoWrongEmails(), dryRun: true, timestamp: TS });
    assert.equal(r.skipped, undefined, '未跟踪文件不该让改写停摆');
    assert.equal(r.branches[0].hits, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('identityHits：作者/committer 命中都能识别，且区分命中侧', () => {  const dir = makeRepo();
  try {
    commit(dir, 'c1'); // committer 命中（author 同）
    commit(dir, 'c2', { author: { name: 'X', email: 'x@example.com' } }); // 仅 committer 命中
    const hits = identityHits(dir, { runGit, wrongEmails: repoWrongEmails() });
    assert.equal(hits.length, 2);
    assert.ok(hits.every((h) => h.side === 'both' || h.side === 'committer'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacyIdentityReport / buildLegacyIdentityHint：提交时提醒「以前」的遗留身份', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'c1 agent');
    commit(dir, 'c2 other', { author: OTHER, committer: OTHER });
    const rep = legacyIdentityReport(dir, { runGit, wrongEmails: repoWrongEmails() });
    assert.equal(rep.count, 1, '只统计命中身份的那条');
    assert.deepEqual(rep.emails, ['agent@dsh.local']);

    const hint = buildLegacyIdentityHint(rep, CANON);
    assert.match(hint, /还有 1 条非规范身份提交/);
    assert.ok(hint.includes(CANON.email), '提醒里要写明本次已用规范身份');
    assert.match(hint, /由你决定|dry-run/i, '提醒要说明历史改写由用户决定、可先预演');

    assert.equal(buildLegacyIdentityHint({ count: 0 }, CANON), '', '没有遗留就不要打扰');
    assert.equal(buildLegacyIdentityHint({}, CANON), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
