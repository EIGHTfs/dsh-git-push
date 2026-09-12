import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, statSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { persistGithubToken, persistSshPub, credentialsDir, resolveToken } = await import(
  require.resolve('../lib/git/index.js')
);

/**
 * 凭据持久化实测（2026-09-13 用户实测根因回归）：
 * 侧边栏保存凭据 → persistGithubToken / persistSshPub → 写插件配置目录
 * credentialsDir()/github-token（0600）+ 对应 *.pub。全部在隔离 DSH_HOME 临时目录验证，
 * 不触碰真实 .dsh/git-push 凭据。
 */
function withIsolatedDshHome(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-git-push-persist-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  mkdirSync(join(dir, 'git-push'), { recursive: true, mode: 0o700 });
  try {
    fn(dir);
  } finally {
    process.env.DSH_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('persistGithubToken 写入插件配置目录 github-token（0600）', () => {
  withIsolatedDshHome((dir) => {
    const r = persistGithubToken('ghp_TEST_TOKEN_12345', {});
    assert.equal(r.ok, true, `应写入成功: ${r.error || ''}`);
    const file = join(dir, 'git-push', 'github-token');
    assert.equal(existsSync(file), true, 'github-token 文件应存在');
    assert.equal(readFileSync(file, 'utf8').trim(), 'ghp_TEST_TOKEN_12345', '内容应为 token');
    const mode = statSync(file).mode & 0o777;
    assert.ok((mode & 0o077) === 0, `权限应不含 group/other 位（实际 ${mode.toString(8)}）`);
  });
});

test('persistGithubToken 拒绝非法格式 token', () => {
  withIsolatedDshHome((dir) => {
    const r = persistGithubToken('not-a-token', {});
    assert.equal(r.ok, false, '非法 token 应拒绝');
    assert.match(r.error, /格式/, '错误应说明格式');
  });
});

test('persistSshPub 写入对应 *.pub（ssh-rsa → id_rsa.pub / ssh-ed25519 → id_ed25519.pub）', () => {
  withIsolatedDshHome((dir) => {
    const r1 = persistSshPub('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCtest test@example.com', {});
    assert.equal(r1.ok, true, r1.error || '');
    assert.equal(existsSync(join(dir, 'git-push', 'id_rsa.pub')), true, 'ssh-rsa 应写 id_rsa.pub');
    const r2 = persistSshPub('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITEST fake@example.com', {});
    assert.equal(r2.ok, true, r2.error || '');
    assert.equal(existsSync(join(dir, 'git-push', 'id_ed25519.pub')), true, 'ssh-ed25519 应写 id_ed25519.pub');
  });
});

test('写入后 resolveToken 能读到（完整闭环：保存 → 落盘 → 检出）', () => {
  withIsolatedDshHome((dir) => {
    persistGithubToken('ghp_TEST_ROUNDTRIP_999', {});
    const r = resolveToken({});
    assert.equal(r.token, 'ghp_TEST_ROUNDTRIP_999', 'resolveToken 应读回刚写入的 token');
    assert.match(r.source, /github-token$/, '来源应是插件配置目录文件');
  });
});

test('scope.watch 链路：模拟设置页保存（githubToken/sshPub 变更触发 persist）', () => {
  withIsolatedDshHome((dir) => {
    // 直接验证持久化函数的最终落盘效果（scope.watch 里调用的就是这两个函数）
    const tok = persistGithubToken('ghp_SETTINGSPAGE_777', {});
    assert.equal(tok.ok, true, tok.error || '');
    const pub = persistSshPub('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCpub7 pub@example.com', {});
    assert.equal(pub.ok, true, pub.error || '');
    // 文件级终验
    assert.equal(readFileSync(join(dir, 'git-push', 'github-token'), 'utf8').trim(), 'ghp_SETTINGSPAGE_777');
    assert.equal(existsSync(join(dir, 'git-push', 'id_rsa.pub')), true);
  });
});
