/**
 * 提交身份解析与落盘（lib/git/identity.js）回归测试。
 *
 * 背景：旧实现只有写死的 `DSH Agent <agent@dsh.local>` 兜底，从不问登录账号是谁，
 *   本机因此混着 DSH Agent / eightfs@local / 小写 noreply 等多种身份，AI 还得自己猜。
 *   本测试钉住新行为：仓库已配 → 尊重；未配 → 用账号身份并写入仓库局部配置；账号不可用 → 兜底且不落盘。
 *
 * 落盘验证用**真实临时 git 仓库**（git init）跑真实 `git config`，不是打桩。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../lib/git/exec.js';
import { ensureRepoIdentity, identityFromAccount, noreplyEmail, resolveCommitIdentity } from '../lib/git/identity.js';

const ACCOUNT = { login: 'EIGHTfs', id: 38984640 };
const CANON_EMAIL = '38984640+EIGHTfs@users.noreply.github.com';

/** 建一个真实临时 git 仓库（用完删）。 */
function makeRepo() {
  const dir = mkdtempTracked(join(tmpdir(), 'dshgp-identity-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

/** 读临时仓库的局部配置（-q 避免 stdout 噪声）。 */
function repoConfig(dir, key) {
  return execFileSync('git', ['config', '--local', key], { cwd: dir, encoding: 'utf8' }).trim();
}

test('noreplyEmail：有 id 用 <id>+<login>，无 id 退化 <login>', () => {
  assert.equal(noreplyEmail('EIGHTfs', 38984640), CANON_EMAIL);
  assert.equal(noreplyEmail('EIGHTfs', '38984640'), CANON_EMAIL, '字符串 id 也要能用');
  assert.equal(noreplyEmail('EIGHTfs'), 'EIGHTfs@users.noreply.github.com');
  assert.equal(noreplyEmail('', 1), '', 'login 为空 → 空串');
});

test('identityFromAccount：账号不可用时返回 null（由上层走兜底）', () => {
  assert.deepEqual(identityFromAccount(ACCOUNT), { name: 'EIGHTfs', email: CANON_EMAIL, source: 'github-account' });
  assert.equal(identityFromAccount({}), null);
  assert.equal(identityFromAccount(null), null);
});

test('resolveCommitIdentity：仓库已配 → 原样尊重（不覆盖成账号身份）', () => {
  const r = resolveCommitIdentity({ configName: 'Someone', configEmail: 'someone@example.com', account: ACCOUNT });
  assert.equal(r.source, 'repo-config');
  assert.equal(r.name, 'Someone');
  assert.equal(r.email, 'someone@example.com');
  assert.equal(r.complete, true);
});

test('resolveCommitIdentity：未配 → 账号身份；账号也拿不到 → 兜底 DSH Agent', () => {
  const byAccount = resolveCommitIdentity({ account: ACCOUNT });
  assert.equal(byAccount.source, 'github-account');
  assert.equal(byAccount.email, CANON_EMAIL);
  assert.equal(byAccount.complete, false, '未落盘前需命令行 -c 兜底');

  const fallback = resolveCommitIdentity({});
  assert.equal(fallback.source, 'fallback');
  assert.equal(fallback.email, 'agent@dsh.local');
});

test('ensureRepoIdentity：未配身份 → 写入仓库局部配置（真实 git config 验证）', () => {
  const dir = makeRepo();
  try {
    const r1 = ensureRepoIdentity(dir, { runGit, account: ACCOUNT });
    assert.equal(r1.source, 'github-account');
    assert.deepEqual(r1.written, [`user.name=EIGHTfs`, `user.email=${CANON_EMAIL}`]);
    assert.equal(r1.complete, true, '写完配置即可直接 commit');
    assert.equal(repoConfig(dir, 'user.name'), 'EIGHTfs');
    assert.equal(repoConfig(dir, 'user.email'), CANON_EMAIL);

    // 幂等：第二次读到的是仓库配置 → 不再写
    const r2 = ensureRepoIdentity(dir, { runGit, account: ACCOUNT });
    assert.equal(r2.source, 'repo-config');
    assert.deepEqual(r2.written, []);
    assert.equal(r2.email, CANON_EMAIL);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureRepoIdentity：仓库已配 → 一个字节都不改', () => {
  const dir = makeRepo();
  try {
    execFileSync('git', ['config', '--local', 'user.name', '项目自定'], { cwd: dir });
    execFileSync('git', ['config', '--local', 'user.email', 'project@example.com'], { cwd: dir });
    const r = ensureRepoIdentity(dir, { runGit, account: ACCOUNT });
    assert.equal(r.source, 'repo-config');
    assert.deepEqual(r.written, [], '不得覆盖仓库已有身份');
    assert.equal(repoConfig(dir, 'user.name'), '项目自定');
    assert.equal(repoConfig(dir, 'user.email'), 'project@example.com');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureRepoIdentity：账号不可用 → 兜底身份且不把 DSH Agent 写进仓库', () => {
  const dir = makeRepo();
  try {
    const r = ensureRepoIdentity(dir, { runGit, account: null });
    assert.equal(r.source, 'fallback');
    assert.deepEqual(r.written, [], '兜底身份不该固化进仓库配置');
    // 仓库仍未配置（git config 非 0 退出）
    let configured = true;
    try { execFileSync('git', ['config', '--local', 'user.name'], { cwd: dir, stdio: 'pipe' }); } catch { configured = false; }
    assert.equal(configured, false, '兜底路径不得写仓库配置');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
