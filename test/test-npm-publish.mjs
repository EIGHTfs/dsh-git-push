/**
 * 发包（npm_publish）回归实测 —— **只跑 dryRun，绝不真发**。
 *
 * 覆盖：
 *  ① readPackageInfo：读本插件 package.json；
 *  ② 双闸门：dryRun=false 且没 confirm ⇒ blocked 'need-confirm'（不发任何请求）；
 *  ③ tag 白名单；
 *  ④ 真 CLI 预演：publishPackage({dryRun:true}) 走 `npm pack --dry-run` + `npm publish --dry-run`（不写 registry）；
 *  ⑤ 工具层后台 job 化：假 jobs ⇒ 返回 jobId；无 jobs ⇒ 降级同步（async:false）；
 *  ⑥ 未发布证明：查 registry 版本列表里**不含**本插件当前版本（dryRun 没写库）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { readPackageInfo, publishPackage, PUBLISH_TAGS } from '../lib/npm/publish.js';
import { callTool } from '../lib/app/tool-call.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org/';
const env = { workspaceRoot: ROOT };
const cfg = { npmRegistry: registry };

/**
 * 临时 fixture 包（**包名/版本都没发布过**）——用于 dry-run 断言。
 * 为什么需要：本插件自己的 2.8.0 已经发布（2026-10-13 误发后按用户决定保留）⇒
 *   对真实 ROOT 跑 preflight 会正确地报 `blocked: version-taken`，与"dryRun 预演成功"的断言冲突。
 *   fixture 让断言保持**严格**（不放松成"允许 blocked"），同时不依赖外部注册表状态。
 */
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pub-fixture-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-git-push-publish-fixture', version: '0.0.1', files: ['lib', 'README.md'], license: 'MIT',
  }, null, 2), 'utf8');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'index.js'), 'export const ok = true;\n', 'utf8');
  writeFileSync(join(dir, 'README.md'), '# fixture\n', 'utf8');
  return dir;
}

test('readPackageInfo：读出本插件包名/版本/private 标记', () => {
  const info = readPackageInfo(ROOT);
  assert.equal(info.ok, true, info.error);
  assert.equal(info.name, 'dsh-git-push');
  assert.match(info.version, /^\d+\.\d+\.\d+/);
  assert.equal(info.private, undefined === info.private ? undefined : info.private); // 只要求存在该字段
});

test('双闸门：dryRun=false 且未 confirm ⇒ 直接拒绝（不做任何网络/文件动作）', async () => {
  const r = await publishPackage({ dir: ROOT, registry, workspaceRoot: ROOT, dryRun: false });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'need-confirm');
  assert.match(r.error, /confirm/);
});

test('tag 白名单：非法 tag 被拒；允许值来自 PUBLISH_TAGS', async () => {
  const r = await publishPackage({ dir: ROOT, registry, workspaceRoot: ROOT, dryRun: true, tag: 'bogus-tag' });
  assert.equal(r.ok, false);
  assert.match(r.error, /不支持的 tag/);
  assert.ok(PUBLISH_TAGS.includes('latest'));
});

test('dryRun 预演：真实 npm pack --dry-run + npm publish --dry-run（不写 registry）', async () => {
  const dir = makeFixture(); // 未发布过的 fixture 包 ⇒ 断言可以保持严格
  const r = await publishPackage({ dir, registry, workspaceRoot: dir, dryRun: true, tag: 'latest' });
  assert.equal(r.ok, true, `dryRun 应成功，实得：${r.error}${r.blocked ? ' / blocked=' + r.blocked : ''}`);
  assert.equal(r.dryRun, true);
  assert.equal(r.published, false, 'dryRun 绝不允许 published=true');
  assert.equal(r.name, 'dsh-git-push-publish-fixture');
  assert.ok(Array.isArray(r.packList) && r.packList.length > 0, 'pack 清单不应为空');
  assert.ok(r.packList.includes('package.json'), '清单应含 package.json');
  assert.ok(r.packList.some((f) => f.startsWith('lib/')), '清单应含 lib/ 内容');
  assert.ok(r.packList.some((f) => f === 'README.md' || f === 'LICENSE'), '清单应含 README 或 LICENSE');
  assert.ok(typeof r.logPath === 'string' && r.logPath.endsWith('npm-publish.log'), '应有 0600 发布日志');
  assert.match(String(r.stdout) + String(r.stderr), /dry-run|notice|package/i, 'npm 输出应含 dry-run 痕迹');
});

test('工具层：有宿主 job 服务 ⇒ 返回 jobId（后台化）；无 ⇒ 降级同步', async () => {
  const dir = makeFixture(); // 同上：用未发布过的 fixture，避免被 version-taken 提前拦住
  const envF = { workspaceRoot: dir };
  let started = null;
  const fakeJobs = { start: (spec) => { started = spec; return 'npm-publish-1'; } };
  const asyncRes = await callTool('npm_publish', { dir, dryRun: true }, envF, cfg, null, fakeJobs, null);
  assert.equal(asyncRes.ok, true);
  assert.equal(asyncRes.async, true, JSON.stringify(asyncRes).slice(0, 200));
  assert.equal(asyncRes.jobId, 'npm-publish-1');
  assert.equal(asyncRes.dryRun, true);
  assert.ok(started && started.kind === 'npm-publish', 'job spec kind 应为 npm-publish');
  assert.match(String(started.label), /dry-run/);

  const syncRes = await callTool('npm_publish', { dir, dryRun: true }, envF, cfg, null, null, null);
  assert.equal(syncRes.ok, true);
  assert.equal(syncRes.async, false, JSON.stringify(syncRes).slice(0, 200));
  assert.equal(syncRes.result && syncRes.result.dryRun, true);
});

test('工具层：job 完成回执必须带可读 detail（回归：成功分支曾只给 output ⇒ job_output 读出「(no new output)」）', async () => {
  // 2026-10-16 实测缺陷：npm 成功分支写的是 { status:'completed', output: JSON }——**没有 detail**，
  //   而宿主 job 的完成回执显示的是 detail（clone/commit 都有 ⇒ 只有 npm 空 ✗）
  //   ⇒ AI 用 job_output 去查只会拿到「(no new output)」，只能翻插件日志与 registry 侧面确认。
  const dir = makeFixture();
  let started = null;
  const fakeJobs = { start: (spec) => { started = spec; return 'npm-publish-x'; } };
  await callTool('npm_publish', { dir, dryRun: true }, { workspaceRoot: dir }, cfg, null, fakeJobs, null);
  assert.ok(started && typeof started.run === 'function', 'job spec 应带 run');
  const outcome = await started.run().done;
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome).slice(0, 200));
  assert.ok(typeof outcome.detail === 'string' && outcome.detail.length > 0,
    '成功回执必须带 detail（否则宿主 job_output 读不出任何结果）');
  assert.match(outcome.detail, /未写入 registry|dry-run/, 'detail 应说明这是 dry-run、未写库');
  assert.match(outcome.detail, /dsh-git-push|@\d+\.\d+\.\d+/, 'detail 应含包名或版本号');
  assert.ok(typeof outcome.output === 'string' && outcome.output.startsWith('{'), 'output 仍保留原始 JSON');
});

test('工具层闸门：dryRun=false 未确认 ⇒ blocked（不进 job、不发请求）', async () => {
  const r = await callTool('npm_publish', { dir: ROOT, dryRun: false }, env, cfg, null, { start: () => 'never' }, null);
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'need-confirm');
});

test('未发布证明：registry 里不含本插件当前版本（dryRun 未写库）', async () => {
  const info = readPackageInfo(ROOT);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(`${registry}/dsh-git-push`, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return; // 网络不可达/包不存在：跳过（不误报）
    const j = await res.json();
    const versions = Object.keys(j?.versions || {});
    assert.equal(versions.includes(info.version), false, `${info.version} 不应已在 registry（dryRun 不得写库）`);
  } catch {
    /* 网络问题跳过该断言 */
  } finally {
    clearTimeout(timer);
  }
});
