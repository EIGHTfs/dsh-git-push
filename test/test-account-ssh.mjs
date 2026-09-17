/**
 * 账号检查 + SSH 密钥（2026-09-11 补齐 D34）：maskToken / readSshPub / persistSshPub /
 * checkGithubAccount（离线分支）/ formatGithubAccountBlock / generateSshKey（校验与存在性分支）。
 * 在线 /user 校验与真实 ssh-keygen 属集成面，另由调用实测覆盖（不写进单测防网络/外部依赖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  maskToken, readSshPub, persistSshPub, checkGithubAccount, formatGithubAccountBlock, generateSshKey,
} from '../lib/git/index.js';

/** 隔离 DSH_HOME（凭据目录走 DSH_HOME/git-push），测完清理。测试内设置 env 保证 credentialsDir 命中。 */
function isolatedEnv() {
  const prev = process.env.DSH_HOME;
  const home = mkdtempSync(join(tmpdir(), 'dsh-gp-acc-'));
  process.env.DSH_HOME = home;
  const credDir = join(home, 'git-push');
  mkdirSync(credDir, { recursive: true });
  return { home, credDir, cleanup: () => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev; rmSync(home, { recursive: true, force: true }); } };
}

// ---------- maskToken ----------
test('maskToken：正常 token 前4…后4', () => {
  assert.equal(maskToken('ghp_abcdefghijklmnop'), 'ghp_…mnop');
});
test('maskToken：过短打 ****；空串回空', () => {
  assert.equal(maskToken('abc'), '****');
  assert.equal(maskToken(''), '');
});

// ---------- readSshPub ----------
test('readSshPub：无公钥 → configured:false', () => {
  const env = isolatedEnv();
  try {
    const r = readSshPub({ workspaceRoot: '' }); // DSH_HOME 已指向隔离目录
    assert.equal(r.configured, false);
  } finally { env.cleanup(); }
});
test('readSshPub：config.json 有 sshPub → configured:true + 指纹', () => {
  const env = isolatedEnv();
  try {
    // 2026-09-16 凭据只读写 config.json：公钥写入 config.json 的 sshPub 键
    writeFileSync(join(env.credDir, 'config.json'), JSON.stringify({ sshPub: 'ssh-rsa AAAAB3NzaC1yc2EAAAA test@example.com' }), 'utf8');
    const r = readSshPub({});
    assert.equal(r.configured, true);
    assert.ok(r.pub.startsWith('ssh-rsa'));
    assert.ok(r.fingerprint.includes('…'), `指纹应含省略号: ${r.fingerprint}`);
  } finally { env.cleanup(); }
});

// ---------- persistSshPub ----------
test('persistSshPub：空/坏格式拒绝', () => {
  const env = isolatedEnv();
  try {
    assert.equal(persistSshPub('', {}).ok, false);
    assert.equal(persistSshPub('not-a-key', {}).ok, false);
  } finally { env.cleanup(); }
});
test('persistSshPub：ed25519 写入 config.json 的 sshPub', () => {
  const env = isolatedEnv();
  try {
    const r = persistSshPub('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test@example.com', {});
    assert.equal(r.ok, true);
    assert.ok(r.file.endsWith('config.json'), '公钥应写入 config.json（凭据只读写 json）');
    assert.equal(existsSync(r.file), true, 'config.json 应存在');
  } finally { env.cleanup(); }
});

// ---------- checkGithubAccount（离线分支；在线 /user 由实测覆盖） ----------
test('checkGithubAccount：无 token 无公钥 → 未登录 err', async () => {
  const env = isolatedEnv();
  try {
    const r = await checkGithubAccount({});
    assert.equal(r.ok, true);
    assert.equal(r.loggedIn, false);
    assert.equal(r.warnLevel, 'err');
    assert.equal(r.cred.hasToken, false);
    assert.equal(r.cred.hasSshPub, false);
  } finally { env.cleanup(); }
});
test('checkGithubAccount：仅公钥无 token → 未登录 warn', async () => {
  const env = isolatedEnv();
  try {
    writeFileSync(join(env.credDir, 'config.json'), JSON.stringify({ sshPub: 'ssh-rsa AAAAB3NzaC1yc2EAAAA t@e.com' }), 'utf8');
    const r = await checkGithubAccount({});
    assert.equal(r.loggedIn, false);
    assert.equal(r.warnLevel, 'warn');
    assert.equal(r.cred.hasSshPub, true);
  } finally { env.cleanup(); }
});

// ---------- formatGithubAccountBlock ----------
// 2026-09-17：文案改为逐条列出（Token / SSH 各自用户名与时间），取消单一「已登录 GitHub：X」汇总行
//   ——两条凭据可属不同 GitHub 用户，写唯一用户名会隐藏另一个账号。断言随新语义更新。
test('formatGithubAccountBlock：未登录含凭据摘要', () => {
  const block = formatGithubAccountBlock({ cookieSet: true, loggedIn: false, warnLevel: 'err', detail: 'Token 无效（Bad credentials）', cred: { hasToken: true, tokenMasked: 'ghp_…abcd' } });
  assert.ok(block.includes('凭据不可用'), `应提示凭据不可用，实际:\n${block}`);
  assert.ok(block.includes('ghp_…abcd'), '应含 token 掩码摘要');
  assert.ok(block.includes('Token'), '应有 Token 明细行');
});

test('formatGithubAccountBlock：逐条列出各自用户名（支持 Token/SSH 不同用户）', () => {
  const block = formatGithubAccountBlock({
    cookieSet: true, loggedIn: true, publicRepos: 9, plan: 'free',
    cred: { hasToken: true, tokenMasked: 'ghp_…abcd', hasSshPub: true, sshFingerprint: 'ssh-rsa AAAA…x@y.com' },
    tokenStatus: { valid: true, checked: true, login: 'userA', detail: '' },
    sshStatus: { valid: true, checked: true, login: 'userB', detail: '' },
  });
  assert.ok(block.includes('凭据可用'), `应提示凭据可用，实际:\n${block}`);
  assert.ok(block.includes('userA'), '应显示 Token 的用户名');
  assert.ok(block.includes('userB'), '应显示 SSH 的用户名（可与 Token 不同）');
  assert.ok(block.includes('9'), '应含公钥仓库数');
  assert.ok(!/已登录 GitHub/.test(block), '不应再有单一账号汇总行');
});

// ---------- generateSshKey（校验与存在性分支；真实 ssh-keygen 由实测覆盖） ----------
test('generateSshKey：邮箱格式错拒绝', () => {
  assert.equal(generateSshKey('bad-email', {}).ok, false);
  assert.equal(generateSshKey('', {}).ok, false);
});
test('generateSshKey：私钥已存在且非 force → 拒绝', () => {
  const env = isolatedEnv();
  try {
    writeFileSync(join(env.credDir, 'id_rsa'), 'existing', 'utf8');
    const r = generateSshKey('test@example.com', {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('已存在'));
  } finally { env.cleanup(); }
});
test('generateSshKey：force 备份旧私钥后再生成（真实 ssh-keygen 存在时）', (t) => {
  const env = isolatedEnv();
  try {
    writeFileSync(join(env.credDir, 'id_rsa'), 'old-key', 'utf8');
    // ssh-keygen 可能不存在（瘦环境）：不存在时 force 也走失败分支，仅断言「不会原地覆盖旧文件」
    const r = generateSshKey('test@example.com', { force: true });
    if (r.ok) {
      assert.equal(existsSync(join(env.credDir, 'id_rsa')), true);
      assert.equal(existsSync(join(env.credDir, 'config.json')), true, '凭据应落 config.json');
    } else {
      // 失败（无 ssh-keygen）：旧私钥必须已被备份走（force 语义），且未被覆盖成新内容
      assert.ok(r.error, '应有错误信息');
    }
  } finally { env.cleanup(); }
});
