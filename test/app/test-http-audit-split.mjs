/**
 * HTTP 分侧回归：审计侧独立前缀 `/api/git-audit/*`（A′ 施工）。
 *
 * 为什么单独一个测试文件：这次改动把 5 个审计端点从 `/api/git-push/*` 搬到新前缀，
 * 有三件事最容易在搬运里悄悄坏掉，且**都不会让别的测试变红**：
 *   ① 旧路径还能不能用（前端/外部 curl 在升级窗口里还在调旧路径）；
 *   ② 旧路径的 `Deprecation` / `Link` 头有没有真的写到响应上（是"留痕"的唯一证据）；
 *   ③ 新前缀有没有**继承鉴权**——它在 handleHttp 的 switch 之前统一执行，
 *      一旦有人另写一个 handler 入口，新前缀就变成无门禁的裸端点（安全项）。
 * 另有 git 侧 25 条路径「一个字不改」的承诺，用 git diff 在交付里证明，这里用行为兜住。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adaptHttpHandler, handleHttp } from '../../lib/app/http-handlers.js';
import { callTool } from '../../lib/app/tool-call.js';
import { defaultConfig } from '../../lib/client/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV = { workspaceRoot: ROOT };
const CFG = defaultConfig();

/** 走一遍 HTTP 分发（与宿主/工具/CLI 同一条代码路径）。 */
async function http(method, url, extra = {}) {
  return await handleHttp({ method, url, origin: 'http://127.0.0.1', ...extra }, ENV, CFG);
}

/** 断言结果是「端点存在」的响应（不是 404 NOT_FOUND）。 */
function assertRouted(result, label) {
  assert.ok(result, `${label}：handler 无返回`);
  const notFound = result.status === 404 && String(result.body?.code || '') === 'NOT_FOUND';
  assert.ok(!notFound, `${label}：落到了 404 NOT_FOUND（端点未注册？）→ ${JSON.stringify(result.body).slice(0, 200)}`);
}

test('审计新前缀：5 条路径全部可用（/api/git-audit/*）', async () => {
  const cases = [
    ['GET', '/api/git-audit/rule-slots'],
    ['GET', '/api/git-audit/rule-detail?slot=nodejs'],
    ['GET', '/api/git-audit/exempt-hint?file=a.js'],
    ['POST', '/api/git-audit/toggle-rule'],
    ['POST', '/api/git-audit/audit'],
  ];
  for (const [method, url] of cases) {
    const r = await http(method, url, { body: method === 'POST' ? {} : undefined });
    assertRouted(r, `${method} ${url}`);
  }
});

test('旧前缀仍转发：5 条路径可用 + 都带 Deprecation / Link 头', async () => {
  const oldToNew = [
    ['/api/git-push/rule-slots', '/api/git-audit/rule-slots'],
    ['/api/git-push/rule-detail?slot=nodejs', '/api/git-audit/rule-detail'],
    ['/api/git-push/exempt-hint?file=a.js', '/api/git-audit/exempt-hint'],
  ];
  for (const [oldUrl, successor] of oldToNew) {
    const r = await http('GET', oldUrl);
    assertRouted(r, `旧路径 ${oldUrl}`);
    assert.equal(r.headers?.Deprecation, 'true', `${oldUrl} 应带 Deprecation 头`);
    assert.match(String(r.headers?.Link || ''), new RegExp(`<${successor}>; rel="successor-version"`), `${oldUrl} 的 Link 头应指向 ${successor}`);
  }
  // 写端点也走转发：POST 两条
  for (const oldUrl of ['/api/git-push/toggle-rule', '/api/git-push/audit']) {
    const r = await http('POST', oldUrl, { body: {} });
    assertRouted(r, `旧路径 ${oldUrl}`);
    assert.equal(r.headers?.Deprecation, 'true', `${oldUrl} 应带 Deprecation 头`);
  }
});

test('新前缀必须继承写请求门禁：POST /api/git-audit/toggle-rule 不带 Origin → 403', async () => {
  // 不带 Origin 且 CT 非 JSON、Host 非回环 ⇒ 必须被 checkOrigin 拒绝（与旧前缀同口径）
  const blocked = await handleHttp({
    method: 'POST',
    url: '/api/git-audit/toggle-rule',
    headers: { host: 'evil.example.com', 'content-type': 'text/plain' },
    body: {},
  }, ENV, CFG);
  assert.equal(blocked.status, 403, `新前缀写请求应被门禁拦下，实际 ${blocked.status}`);
  assert.equal(blocked.body?.code, 'NO_ORIGIN', `应报 NO_ORIGIN，实际 ${blocked.body?.code}`);
  // 旧前缀同口径（两条前缀共用一个入口 ⇒ 门禁完全一致）
  const blockedOld = await handleHttp({
    method: 'POST',
    url: '/api/git-push/toggle-rule',
    headers: { host: 'evil.example.com', 'content-type': 'text/plain' },
    body: {},
  }, ENV, CFG);
  assert.equal(blockedOld.status, 403);
  // 带同源 Origin 的写请求放行（证明 403 来自门禁而非端点不存在）
  const allowed = await http('POST', '/api/git-audit/toggle-rule', { body: {} });
  assert.notEqual(allowed.status, 403, '带同源 Origin 的写请求不应被 403');
});

test('adaptHttpHandler 会把 handler 的 headers 写到响应上（Deprecation 头能到客户端）', async () => {
  const written = {};
  const res = {
    writeHead(status, headers) { written.status = status; written.headers = headers; },
    end() {},
  };
  const result = await adaptHttpHandler(
    { method: 'GET', url: '/api/git-push/rule-slots', headers: { host: '127.0.0.1' } },
    res, ENV, CFG,
  );
  assert.ok(result, 'adaptHttpHandler 应返回 handler 结果');
  assert.equal(written.headers?.Deprecation, 'true', `Deprecation 头应被写进响应，实际 headers=${JSON.stringify(written.headers)}`);
  assert.match(String(written.headers?.['Content-Type'] || ''), /application\/json/, 'Content-Type 不能被覆盖掉');
});

test('git_api 的 path 三种写法都能通（AI 面契约不断）', async () => {
  const env = { workspaceRoot: ROOT };
  const run = (path) => callTool('git_api', { path, method: 'GET' }, env, CFG, console, null, null);
  // ① 短名 → 走旧前缀（转发仍然可用）
  const shortName = await run('rule-slots');
  assert.equal(shortName.ok, true, `短名 rule-slots 应可用：${JSON.stringify(shortName).slice(0, 200)}`);
  // ② 前缀相对 → 新前缀（推荐写法）
  const prefixed = await run('git-audit/rule-slots');
  assert.equal(prefixed.ok, true, `git-audit/rule-slots 应可用：${JSON.stringify(prefixed).slice(0, 200)}`);
  // ③ 完整路径 → 原样
  const fullPath = await run('/api/git-audit/rule-slots');
  assert.equal(fullPath.ok, true, `完整路径应可用：${JSON.stringify(fullPath).slice(0, 200)}`);
  // 三种写法打到同一个端点：结果结构一致
  assert.deepEqual(shortName.result.slots?.order, prefixed.result.slots?.order, '短名与前缀相对应返回同一份数据');
});

test('apiGuide 里的审计 URL 已换新前缀（给用户/AI 复制的链接不能 404）', async () => {
  const { buildAuditApiGuide } = await import('../../lib/app/inject-text.js');
  const text = buildAuditApiGuide(ROOT, { scope: 'full', summary: { blocker: 0, warning: 0, notice: 0, total: 0 }, quality: { score: 90, level: 'A' } });
  assert.match(text, /\/api\/git-audit\/audit/, `apiGuide 应指向新前缀，实际：${text.split('\n').slice(0, 4).join(' | ')}`);
  assert.doesNotMatch(text, /\/api\/git-push\/audit/, 'apiGuide 不得再出现旧前缀');
});

test('git 侧 25 条路径零改动（行为兜底：抽查 git/共享端点仍走老路径）', async () => {
  for (const url of ['/api/git-push/status', '/api/git-push/tools', '/api/git-push/tool-probes', '/api/git-push/settings-get']) {
    const r = await http('GET', url);
    assertRouted(r, url);
    assert.equal(r.status, 200, `${url} 应 200，实际 ${r.status}`);
    assert.equal(r.headers?.Deprecation, undefined, `${url} 属 git/共享侧，不该带 Deprecation 头`);
  }
});
