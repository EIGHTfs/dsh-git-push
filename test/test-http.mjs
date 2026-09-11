/**
 * HTTP 总入口测试（0.1.7）：Origin/CSRF 校验、写确认、413 体大小、路由分发。
 * 纯函数单测（不依赖真实服务器）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  MAX_BODY_BYTES, WRITE_METHODS, READ_METHODS, checkOrigin, checkWriteConfirm,
  checkBodySize, authPipeline, readJsonBody, routeRequest, httpOk,
} from '../lib/http/index.js';

// ---------- checkOrigin（CSRF 防护核心） ----------
test('Origin：GET 只读免校验', () => {
  const r = checkOrigin('GET', '', new Set(['http://127.0.0.1']));
  assert.equal(r.ok, true);
});

test('Origin：OPTIONS 免校验（CORS 预检）', () => {
  assert.equal(checkOrigin('OPTIONS').ok, true);
});

test('Origin：POST 无 Origin → 403', () => {
  const r = checkOrigin('POST', '', new Set(['http://127.0.0.1']));
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.code, 'NO_ORIGIN');
});

test('Origin：POST 跨源 → 403', () => {
  const r = checkOrigin('POST', 'https://evil.example.com');
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.code, 'CROSS_ORIGIN');
});

test('Origin：POST 同源放行', () => {
  const r = checkOrigin('POST', 'http://127.0.0.1:30801', new Set(['http://127.0.0.1']));
  assert.equal(r.ok, true);
});

// ---------- 1.0.5：侧边栏按钮同源放行（局域网 GUI） ----------
test('Origin 1.0.5：局域网 GUI 同源放行（Host 头一致）', () => {
  const r = checkOrigin('POST', 'http://10.10.10.4:3080', undefined, '10.10.10.4:3080');
  assert.equal(r.ok, true, 'Origin host 与请求 Host 一致 → 放行（侧边栏按钮可用）');
});

test('Origin 1.0.5：同源放行忽略端口差异', () => {
  const r = checkOrigin('POST', 'http://10.10.10.4:9999', undefined, '10.10.10.4:3080');
  assert.equal(r.ok, true, '同主机不同端口 → 放行');
});

test('Origin 1.0.5：跨站 Origin 即使 Host 同域也拒绝（域名不同）', () => {
  const r = checkOrigin('POST', 'https://evil.example.com', undefined, '10.10.10.4:3080');
  assert.equal(r.ok, false, '攻击者站点 Origin ≠ Host → 拒绝');
  assert.equal(r.code, 'CROSS_ORIGIN');
});

test('Origin 1.0.5：Host 头缺失回退白名单（本机回环仍放行）', () => {
  const r = checkOrigin('POST', 'http://127.0.0.1:30801', undefined, '');
  assert.equal(r.ok, true, '无 Host 头 + 本机回环 Origin → 白名单兜底放行');
});

test('Origin：localhost 允许（开发 GUI）', () => {
  assert.equal(checkOrigin('PATCH', 'http://localhost').ok, true);
});

test('Origin：origin 带路径后缀也放行（本地 GUI 场景）', () => {
  const r = checkOrigin('PUT', 'http://127.0.0.1:30801/some/path', new Set(['http://127.0.0.1']));
  assert.equal(r.ok, true);
});

test('Origin：非本机主机 → 403', () => {
  const r = checkOrigin('DELETE', 'http://other-host.local');
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('Origin：未知方法 → 405', () => {
  const r = checkOrigin('PURGE', 'http://127.0.0.1');
  assert.equal(r.ok, false);
  assert.equal(r.status, 405);
});

// ---------- checkWriteConfirm（破坏性操作确认） ----------
test('写确认：confirm:true 放行', () => {
  assert.equal(checkWriteConfirm({ confirm: true }).ok, true);
});

test('写确认：缺 confirm → 400', () => {
  const r = checkWriteConfirm({ rebuild: true });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.code, 'NEED_CONFIRM');
});

test('写确认：confirm 非 true（字符串/0）→ 400', () => {
  assert.equal(checkWriteConfirm({ confirm: 'true' }).ok, false);
  assert.equal(checkWriteConfirm({ confirm: 1 }).ok, false);
});

test('写确认：空 body → 400', () => {
  assert.equal(checkWriteConfirm({}).ok, false);
});

// ---------- checkBodySize（413） ----------
test('413：超 5MB → 413', () => {
  const r = checkBodySize(MAX_BODY_BYTES + 1);
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
  assert.equal(r.code, 'TOO_LARGE');
});

test('413：恰好 5MB → 放行（=limit 不算超）', () => {
  assert.equal(checkBodySize(MAX_BODY_BYTES).ok, true);
});

test('413：正常大小放行', () => {
  assert.equal(checkBodySize(1024).ok, true);
});

test('413：负长度/NaN → 400', () => {
  assert.equal(checkBodySize(-1).ok, false);
  assert.equal(checkBodySize(NaN).ok, false);
});

test('413：自定义更低上限生效', () => {
  const r = checkBodySize(1024, 512);
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
});

// ---------- authPipeline / routeRequest（集成） ----------
test('authPipeline：GET 小体走通', () => {
  assert.equal(authPipeline({ method: 'GET', contentLength: 10 }).ok, true);
});

test('authPipeline：POST 无 Origin 被拦', () => {
  const r = authPipeline({ method: 'POST', contentLength: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('routeRequest：GET 命中处理器', () => {
  const r = routeRequest(
    { method: 'GET', url: '/api/git-push/status', origin: '' },
    { 'GET /api/git-push/status': () => ({ plugin: 'dsh-git-push' }) },
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.plugin, 'dsh-git-push');
});

test('routeRequest：POST 无 Origin → 403（不经处理器）', () => {
  let called = false;
  const r = routeRequest(
    { method: 'POST', url: '/api/git-push/rebuild', origin: '' },
    { 'POST /api/git-push/rebuild': () => { called = true; return {}; } },
  );
  assert.equal(r.status, 403);
  assert.equal(called, false);
});

test('routeRequest：未定义端点 → 404', () => {
  const r = routeRequest({ method: 'GET', url: '/nope' }, {});
  assert.equal(r.status, 404);
});

// ---------- readJsonBody / httpOk ----------
test('readJsonBody：正常 JSON 解析', async () => {
  const req = new EventEmitter();
  const p = new Promise((res) => readJsonBody(req, res));
  req.emit('data', '{"a":1}');
  req.emit('end');
  assert.deepEqual(await p, { a: 1 });
});

test('readJsonBody：非法 JSON → {}', async () => {
  const req = new EventEmitter();
  const p = new Promise((res) => readJsonBody(req, res));
  req.emit('data', 'not-json{');
  req.emit('end');
  assert.deepEqual(await p, {});
});

test('readJsonBody：超 5MB → null（413 语义）', async () => {
  const req = new EventEmitter();
  let destroyed = false;
  req.destroy = () => { destroyed = true; };
  const p = new Promise((res) => readJsonBody(req, res));
  req.emit('data', 'x'.repeat(MAX_BODY_BYTES + 10));
  req.emit('end');
  assert.equal(await p, null);
  assert.equal(destroyed, true);
});

test('readJsonBody：流 error → {}', async () => {
  const req = new EventEmitter();
  const p = new Promise((res) => readJsonBody(req, res));
  req.emit('error', new Error('boom'));
  assert.deepEqual(await p, {});
});

test('httpOk：统一响应形状', () => {
  assert.deepEqual(httpOk(true, { version: '0.1.7' }), { ok: true, version: '0.1.7' });
  assert.deepEqual(httpOk(false, { code: 'X' }), { ok: false, code: 'X' });
});

// ---------- 常量完整性 ----------
test('常量：写/读方法集合正确', () => {
  assert.ok(WRITE_METHODS.has('POST'));
  assert.ok(WRITE_METHODS.has('DELETE'));
  assert.ok(READ_METHODS.has('GET'));
  assert.ok(READ_METHODS.has('OPTIONS'));
});

test('常量：5MB 上限精确（旧项目 A5 教训）', () => {
  assert.equal(MAX_BODY_BYTES, 5 * 1024 * 1024);
});