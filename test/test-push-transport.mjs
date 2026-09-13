/**
 * 推送通道回归：默认 SSH 优先、ssha 一致性语义、通道可配置。
 *
 * 背景：原先 push.js 无条件先走 API（Git Data API 在远端 blob→tree→commit **重建**提交），
 *   SSH 仅在 token 401 时兜底 → 推完远端 sha 与本地必然不同，本地 origin/<branch> 引用
 *   与实际远端对不上，每次都要额外对齐。
 * 现行为：dispatchPush 单点决策，pushMethod 默认 'ssh'（推本地 HEAD，远端 sha == 本地 sha），
 *   无可用私钥才回落 API，并把回落原因记进 fallbackReason。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { dispatchPush, pushViaSsh } from '../lib/git/index.js';
import { resolveSshKeys, resolveSshKey, credentialsDir } from '../lib/git/credentials.js';
import { defaultConfig, SETTINGS_SCHEMA } from '../lib/client/index.js';
import { Config } from '../lib/app/schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 建一个只有一次提交、无 origin 的临时仓库。 */
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-sshprobe-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'probe@test');
  git('config', 'user.name', 'probe');
  writeFileSync(join(dir, 'a.txt'), 'probe\n');
  git('add', '-A');
  git('commit', '-qm', 'probe init');
  return dir;
}

test('默认通道是 ssh（配置 / schema / 设置项三处一致）', () => {
  assert.equal(defaultConfig().pushMethod, 'ssh', 'defaultConfig 默认应为 ssh');
  const item = SETTINGS_SCHEMA.find((x) => x.key === 'pushMethod');
  assert.ok(item, 'SETTINGS_SCHEMA 应有推送通道设置项');
  assert.equal(item.default, 'ssh', '设置项默认应为 ssh');
  assert.deepEqual(item.values, ['ssh', 'api', 'auto'], '可选值应为 ssh/api/auto');
  const refs = (Config.toJSON ? Config.toJSON().refs : []) || [];
  const f = refs.find((r) => r.key === 'pushMethod');
  assert.ok(f, 'Host Config 应有 pushMethod');
  assert.equal(f.meta.default, 'ssh', 'Host schema 默认应为 ssh');
});

test('commitAndPush 与 commitWithAudit 默认走 ssh（防退回 API 优先）', () => {
  const pushSrc = readFileSync(join(ROOT, 'lib/git/push.js'), 'utf8');
  assert.ok(/pushMethod = 'ssh'/.test(pushSrc), 'commitAndPush 的 pushMethod 默认应为 ssh');
  assert.ok(pushSrc.includes('dispatchPush('), 'commitAndPush 应经 dispatchPush 决策通道');
  assert.ok(!/const pr = await pushViaApi\(/.test(pushSrc),
    '不得再无条件先调 pushViaApi（那会在远端重建提交 → sha 不一致）');
  const cpSrc = readFileSync(join(ROOT, 'lib/commit-push.js'), 'utf8');
  assert.ok(/pushMethod: pushMethod \|\| cfg\.pushMethod \|\| 'ssh'/.test(cpSrc),
    'commitWithAudit 应把配置里的 pushMethod 透传下去，缺省 ssh');
});

test('dispatchPush：三档语义正确（无 origin 时如实报错不崩）', async () => {
  const repo = tempRepo();
  const ssh = await dispatchPush({ repoPath: repo, pushMethod: 'ssh' });
  assert.equal(ssh.ok, false, '无 origin 应失败');
  assert.ok(String(ssh.reason).includes('origin'), '应说明是 origin 解析问题');
  const api = await dispatchPush({ repoPath: repo, pushMethod: 'api' });
  assert.equal(api.ok, false);
  assert.equal(api.method, 'api', 'api 档优先尝试 API，method 应记 api');
  const auto = await dispatchPush({ repoPath: repo, pushMethod: 'auto' });
  assert.equal(auto.ok, false, 'auto 无 origin 也应失败');
});

test('dispatchPush：pushMethod 缺省即 ssh（不传参也走 SSH 优先）', async () => {
  const repo = tempRepo();
  const r = await dispatchPush({ repoPath: repo });
  // 无 origin 时两条通道都会失败，但 method 字段反映「先试的是谁」
  assert.equal(r.method, 'ssh', '缺省应优先 SSH（method=ssh）');
});

test('pushViaSsh：多密钥逐个尝试（避免有可用密钥却推不动）', () => {
  const keys = resolveSshKeys();
  assert.ok(Array.isArray(keys), 'resolveSshKeys 应返回数组');
  for (const k of keys) {
    assert.ok(k.keyPath && k.kind, '每项应有 keyPath/kind');
  }
  // 与首个可用密钥语义一致（resolveSshKey 是 resolveSshKeys 的首元素）
  const first = resolveSshKey();
  if (keys.length) assert.equal(first.keyPath, keys[0].keyPath, 'resolveSshKey 应等于候选列表首个');
  const src = readFileSync(join(ROOT, 'lib/git/transport.js'), 'utf8');
  assert.ok(/for \(const \{ keyPath, kind \} of keys\)/.test(src),
    'pushViaSsh 应逐个尝试候选密钥');
});

test('凭据目录自探测：脚本自己找 token/密钥，无需用户填路径', () => {
  const src = readFileSync(join(ROOT, 'lib/git/credentials.js'), 'utf8');
  assert.ok(/export function credentialsDir/.test(src), 'credentialsDir 应存在');
  assert.ok(/export function resolveSshKeys/.test(src), 'resolveSshKeys 应存在');
  assert.ok(/export function resolveToken/.test(src), 'resolveToken 应存在');
  const dir = credentialsDir();
  assert.ok(typeof dir === 'string' && dir.length > 0, 'credentialsDir 应返回路径');
});

test('SSH 成功后也做推送后增强（remoteRef/auxRemote/autoTag）', () => {
  const src = readFileSync(join(ROOT, 'lib/git/push.js'), 'utf8');
  // 原先 SSH 分支只 fetchRemoteHeads，不更新 remote-tracking ref → 走 SSH 时引用错位
  const sshOnlyHeads = /if \(ssh\.ok\) \{\s*const heads = await fetchRemoteHeads/.test(src);
  assert.ok(!sshOnlyHeads, 'SSH 成功分支不得只拉 heads 而不做 remoteRef/auxRemote 增强');
  assert.ok(/steps\.push\(`pushed-via-/.test(src), '应记录实际生效的通道');
});

test('安全：remote URL 不得内嵌明文凭据（token/密码）', () => {
  // 实测发现 6 个仓库的 origin 曾被写成 https://ghp_xxx@github.com/...——
  //   明文落在 .git/config，且那把 token 已失效（HTTP 401）纯属负担。
  //   推送凭据应由凭据目录自探测提供（token/密钥），不进 remote URL。
  const { execFileSync } = require('node:child_process');
  const out = execFileSync('git', ['remote', '-v'], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(!/gh[pous]_[A-Za-z0-9]{20,}/.test(out), 'remote URL 不得内嵌 ghp_ 类 token');
  assert.ok(!/github_pat_[A-Za-z0-9_]{20,}/.test(out), 'remote URL 不得内嵌 github_pat_ 类 token');
  assert.ok(!/https:\/\/[^\s/@]+:[^\s/@]+@/.test(out), 'remote URL 不得内嵌 user:password 形式凭据');
});

test('安全：.git/config 不得落盘明文 token', () => {
  const cfgPath = join(ROOT, '.git', 'config');
  if (!existsSync(cfgPath)) return; // 非 git 检出（打包副本）跳过
  const cfg = readFileSync(cfgPath, 'utf8');
  assert.ok(!/gh[pous]_[A-Za-z0-9]{20,}/.test(cfg), '.git/config 不得出现明文 token');
});
