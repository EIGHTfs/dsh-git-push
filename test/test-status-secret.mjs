/**
 * 1.1.5 安全回归：token 明文不得随 HTTP 出口下发。
 *
 * 背景：`/api/git-push/status` 原本 `config: cfg` 整包回吐，curl 一条就能取到 GitHub token 明文；
 *   schema 里 githubToken 也没标密钥位，浏览器读设置同样能拿到。
 * 本测试锁两件事：①状态端点不回吐明文、并给出「是否已配置」布尔位；
 *   ②schema 把 githubToken 声明为密钥位（远端读由 DSH redactSecrets 负责）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config, redactConfig, SECRET_CONFIG_FIELDS } from '../lib/app/schema.js';
import { handleHttp } from '../lib/app/http-handlers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'ghp_' + 'A'.repeat(36);

test('redactConfig：密钥位删除、派生布尔位、不改原对象', () => {
  const cfg = { githubToken: TOKEN, sshPub: 'ssh-ed25519 AAAAdemo', auditLevel: 'standard' };
  const out = redactConfig(cfg);
  assert.equal(out.githubToken, undefined, 'githubToken 必须从下发副本中删除');
  assert.equal(out.tokenConfigured, true, '应派生 tokenConfigured=true');
  assert.equal(out.sshConfigured, true, '应派生 sshConfigured=true（公钥非密钥，值保留）');
  assert.equal(out.sshPub, 'ssh-ed25519 AAAAdemo', '公钥不是密钥，仍应下发');
  assert.equal(out.auditLevel, 'standard', '普通字段照常下发');
  assert.equal(cfg.githubToken, TOKEN, '不得改动 host 侧原配置');

  const empty = redactConfig({});
  assert.equal(empty.tokenConfigured, false, '未配置时布尔位为 false');
  assert.equal(empty.sshConfigured, false);
});

test('SECRET_CONFIG_FIELDS 与 schema 的 role(secret) 对得上（防两处漂移）', () => {
  // schemastery 的字段元信息经 toJSON().refs 暴露（Config.dict 不存在）——
  //   DSH 的 redactSecrets 读的正是这份 meta.role。
  const refs = (Config.toJSON ? Config.toJSON().refs : []) || [];
  const byRole = refs
    .filter((r) => r && r.meta && r.meta.role === 'secret')
    .map((r) => r.key)
    .sort();
  assert.deepEqual(byRole, [...SECRET_CONFIG_FIELDS].sort(),
    `schema 声明为 secret 的字段(${byRole})应与 SECRET_CONFIG_FIELDS(${SECRET_CONFIG_FIELDS})一致`);
});

test('/api/git-push/status：不回吐 token 明文，且报告是否已配置', async () => {
  const cfg = { githubToken: TOKEN, sshPub: 'ssh-ed25519 AAAAdemo', auditEnabled: false };
  const r = await handleHttp({ method: 'GET', url: '/api/git-push/status' }, { workspaceRoot: '/tmp' }, cfg);
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes(TOKEN), 'status 响应体不得出现 token 明文');
  assert.ok(!text.includes('ghp_'), 'status 响应体不得出现任何 ghp_ 前缀片段');
  assert.equal(r.body.config.githubToken, undefined, 'config.githubToken 应被删除');
  assert.equal(r.body.config.tokenConfigured, true, '应给出 tokenConfigured=true 供浏览器渲染');
  assert.equal(r.body.plugin, 'dsh-git-push');
  assert.ok(typeof r.body.version === 'string' && r.body.version.length > 0, '应照常返回版本号');
});

test('client.js：token 是否已配置不再只依赖明文（防退化回明文判断）', () => {
  const src = readFileSync(join(ROOT, 'client.js'), 'utf8');
  assert.ok(src.includes('dshgp_tokenConfigured'), 'client.js 应经 dshgp_tokenConfigured 判断是否已配置');
  assert.ok(src.includes("v.tokenConfigured === true"), '应优先采用 host 派生的布尔位');
  assert.ok(!/this\.tokenConfigured = !!\(snap\.value\.githubToken/.test(src),
    '不得再直接以设置快照里的 githubToken 明文作为唯一判断');
  assert.ok(src.includes('loadCredentialFlags'), '应在挂载时向 /status 取凭据状态');
});
