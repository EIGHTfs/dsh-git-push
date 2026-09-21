/**
 * git_cred_env 凭据传递测试（2026-09-21）：
 *   buildCredEnv 返回结构（SSH/HTTPS 双通道）／输出无 token/私钥明文（核心目标）／
 *   askpass 脚本生成且可执行（Username→git、Password→token）／无凭据场景 provided 空 + hint。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { buildCredEnv } from '../lib/git/cred-env.js';

test('git_cred_env：双通道输出且不含 token/私钥明文', () => {
  const r = buildCredEnv({});
  assert.ok(Array.isArray(r.provided), 'provided 应为数组');
  assert.equal(typeof r.hasSshKey, 'boolean');
  assert.equal(typeof r.hasToken, 'boolean');
  // 核心：输出序列化后不得含 token 明文（ghp_ 开头长串）或私钥内容
  const txt = JSON.stringify(r);
  assert.ok(!/ghp_[A-Za-z0-9]{20,}/.test(txt), '输出不得含 token 明文');
  assert.ok(!/BEGIN (RSA|OPENSSH|EC) PRIVATE KEY/.test(txt), '输出不得含私钥内容');
  if (r.hasSshKey && r.ssh) {
    assert.ok(r.ssh.envPrefix.startsWith('GIT_SSH_COMMAND='), 'SSH envPrefix 应为 GIT_SSH_COMMAND 前缀');
    assert.ok(r.ssh.envPrefix.includes(r.ssh.keyPath), 'SSH envPrefix 应含私钥路径');
    assert.ok(!r.ssh.envPrefix.includes('PRIVATE KEY'), 'SSH envPrefix 不得含私钥内容');
  }
  if (r.hasToken && r.https) {
    assert.ok(r.https.envPrefix.includes('GIT_ASKPASS='), 'HTTPS envPrefix 应为 GIT_ASKPASS');
    assert.ok(existsSync(r.https.askpass), 'askpass 脚本应已生成');
    try { accessSync(r.https.askpass, constants.X_OK); assert.ok(true, 'askpass 应可执行'); } catch { assert.fail('askpass 应可执行（chmod 755）'); }
  }
});

test('git_cred_env：askpass 脚本实际调用（Username→git、Password→token，值不打印）', () => {
  const r = buildCredEnv({});
  if (!r.hasToken || !r.https) return; // 无 token 环境跳过（CI 无凭据）
  const user = execFileSync(r.https.askpass, ['Username for github.com'], { encoding: 'utf8' }).trim();
  assert.equal(user, 'git', 'Username 问应返回 git 占位');
  const pass = execFileSync(r.https.askpass, ['Password for github.com'], { encoding: 'utf8' }).trim();
  assert.ok(pass.length >= 20, 'Password 问应返回 token（长度≥20，具体值不打印断言）');
  assert.ok(/^(gh[pous]_|github_pat_)/.test(pass), 'Password 应为 GitHub token 格式');
});

test('git_cred_env：无凭据场景（空配置目录）→ provided 空 + 引导 hint', () => {
  // credentialsDir 优先 process.env.DSH_HOME（测试环境有值）——临时覆盖为空的临时目录
  const tmp = mkdtempSync(join(tmpdir(), 'dshgp-credenv-'));
  const oldHome = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp; // tmp/git-push 不存在 → 无私钥无 token
  try {
    const r = buildCredEnv({});
    assert.equal(r.hasSshKey, false, '空配置目录 → 无私钥');
    assert.equal(r.hasToken, false, '空配置目录 → 无 token');
    assert.deepEqual(r.provided, [], '无凭据 → provided 空');
    assert.ok(r.hint.includes('git_gen_ssh_key'), 'hint 应引导生成密钥');
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    rmSync(tmp, { recursive: true, force: true });
  }
});