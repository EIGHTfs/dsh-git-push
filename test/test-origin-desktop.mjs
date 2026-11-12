/**
 * 桌面端（dsh-app://）写请求 403 NO_ORIGIN 修复回归。
 *
 * 现象（外部报告完整复现并定位到桌面壳源码）：DSH 桌面版经自定义协议 dsh-app://app
 *   加载 GUI，桌面壳 forwardWebRequest 把 /api/* 转发到后端时**显式剥离 Origin**
 *   （headers.delete('origin')，只补 cookie）。于是所有写请求到插件时 Origin 为空 →
 *   checkOrigin 一律 403 NO_ORIGIN，而 GET 免校验照常 → 「页面能打开、保存永不生效、
 *   回显旧值」，且拒绝发生在 handler 之前连日志都不留。
 *
 * 修复判据（三条同时成立才放行，CSRF 防护不降级）：
 *   ① Content-Type 是 application/json（跨站表单设不出这个 CT）；
 *   ② Host 是回环地址（桌面壳转发目标是 127.0.0.1:<port>）；
 *   ③ 浏览器发起的写请求必带 Origin ⇒ 走既有同源/跨源判定，不受影响。
 *
 * 本文件锁死「桌面端恢复」与「跨站仍被拒」两侧——只验前者会把防护缺口放进来。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkOrigin, isLoopbackHost, hostNameOf, isJsonContentType,
} from '../lib/http/index.js';

const LOOPBACK_HOST = '127.0.0.1:58885';

// ---------- 放行侧：桌面端形态必须恢复 ----------

test('桌面端转发形态放行：无 Origin + JSON CT + 回环 Host', () => {
  const r = checkOrigin('POST', '', undefined, LOOPBACK_HOST, 'application/json');
  assert.equal(r.ok, true, '桌面壳转发的写请求必须放行（否则设置页全部保存失效）');
});

test('JSON CT 带 charset 后缀同样放行', () => {
  const r = checkOrigin('POST', '', undefined, LOOPBACK_HOST, 'application/json; charset=utf-8');
  assert.equal(r.ok, true);
});

test('全部写方法都覆盖（POST/PUT/PATCH/DELETE）', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = checkOrigin(method, '', undefined, LOOPBACK_HOST, 'application/json');
    assert.equal(r.ok, true, `${method} 也应放行`);
  }
});

test('localhost / ::1 也算回环', () => {
  assert.equal(checkOrigin('POST', '', undefined, 'localhost:3080', 'application/json').ok, true);
  assert.equal(checkOrigin('POST', '', undefined, '[::1]:3080', 'application/json').ok, true);
});

// ---------- 拒绝侧：防线必须完好 ----------

test('无 Origin + 非 JSON CT 仍拒（跨站表单设不出 JSON CT）', () => {
  for (const badCt of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
    const r = checkOrigin('POST', '', undefined, LOOPBACK_HOST, badCt);
    assert.equal(r.ok, false, `Content-Type=${badCt || '(空)'} 必须拒绝`);
    assert.equal(r.code, 'NO_ORIGIN');
  }
});

test('无 Origin + 非回环 Host 仍拒（不给局域网开 CSRF 口子）', () => {
  for (const lanHost of ['10.10.10.4:3080', '192.168.1.9:3080', 'example.com', '']) {
    const r = checkOrigin('POST', '', undefined, lanHost, 'application/json');
    assert.equal(r.ok, false, `Host=${lanHost || '(空)'} 必须拒绝`);
    assert.equal(r.code, 'NO_ORIGIN');
  }
});

test('跨站 Origin 带 JSON CT 仍拒（浏览器跨站请求必带 Origin）', () => {
  const r = checkOrigin('POST', 'https://evil.example', undefined, LOOPBACK_HOST, 'application/json');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CROSS_ORIGIN');
});

test('既有放行路径不受影响：同源 Origin / 回环白名单 / GET 免校验', () => {
  assert.equal(checkOrigin('POST', 'http://127.0.0.1:58885', undefined, LOOPBACK_HOST).ok, true, '同源放行');
  assert.equal(checkOrigin('POST', 'http://localhost:9999', undefined, '10.0.0.4:3080').ok, true, '回环白名单放行');
  assert.equal(checkOrigin('GET', '', undefined, LOOPBACK_HOST).ok, true, 'GET 免校验');
  assert.equal(checkOrigin('GET', '', undefined, '10.10.10.4:3080').ok, true, 'GET 免校验（局域网）');
});

// ---------- 辅助函数边界 ----------

test('hostNameOf 正确剥 scheme / 端口 / IPv6 方括号', () => {
  assert.equal(hostNameOf('http://127.0.0.1:3080'), '127.0.0.1');
  assert.equal(hostNameOf('10.10.10.4:3080'), '10.10.10.4');
  assert.equal(hostNameOf('http://[::1]:3080'), '::1');
  assert.equal(hostNameOf('dsh-app://app'), 'app');
  assert.equal(hostNameOf(''), '');
});

test('isLoopbackHost 只认三种回环写法', () => {
  assert.equal(isLoopbackHost('127.0.0.1:1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('[::1]:9'), true);
  assert.equal(isLoopbackHost('10.0.0.1'), false);
  assert.equal(isLoopbackHost(''), false);
});

test('isJsonContentType 忽略参数、不误判表单类型', () => {
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('Application/JSON;charset=UTF-8'), true);
  assert.equal(isJsonContentType('text/plain'), false);
  assert.equal(isJsonContentType('multipart/form-data; boundary=x'), false);
  assert.equal(isJsonContentType(''), false);
});

// ---------- 端到端：settings-set 无 Origin 能真正写入 ----------

test('端到端：settings-set 无 Origin + JSON CT 可写入（桌面端保存恢复）', async () => {
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-origin-'));
  process.env.DSH_HOME = dir;
  try {
    const out = await handleHttp({
      method: 'POST',
      url: '/api/git-push/settings-set',
      origin: '',
      headers: { host: LOOPBACK_HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'npmRegistry', value: 'https://registry.npmjs.org/' }),
    }, { workspaceRoot: dir }, {});
    assert.equal(out.status, 200, `应写入成功，实得 ${out.status} ${JSON.stringify(out.body)}`);
    assert.equal(out.body.ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端：无 Origin + 非回环 Host 仍 403（局域网不可写）', async () => {
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const out = await handleHttp({
    method: 'POST',
    url: '/api/git-push/settings-set',
    origin: '',
    headers: { host: '10.10.10.4:3080', 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'npmRegistry', value: 'https://registry.npmjs.org/' }),
  }, { workspaceRoot: '' }, {});
  assert.equal(out.status, 403);
  assert.equal(out.body.code, 'NO_ORIGIN');
});

// ---------- 附带修复：凭据不再明文回显 ----------

test('settings-set：凭据类键回显脱敏，不回传明文', async () => {
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-origin-mask-'));
  process.env.DSH_HOME = dir;
  try {
    const secret = 'npm_thisIsAVeryLongFakeTokenForEchoMaskTest0123456789';
    const out = await handleHttp({
      method: 'POST',
      url: '/api/git-push/settings-set',
      origin: '',
      headers: { host: LOOPBACK_HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'npmToken', value: secret }),
    }, { workspaceRoot: dir }, {});
    assert.equal(out.status, 200);
    const echoed = JSON.stringify(out.body);
    assert.ok(!echoed.includes(secret), `响应体不得含明文 token，实际：${echoed.slice(0, 120)}`);
    assert.equal(out.body.value, '(已保存)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- 攻击面：Host 头可伪造，必须以 TCP 对端地址定论 ----------

test('伪造 Host: 127.0.0.1 不能绕过（远端 socket + 伪造 Host 仍拒）', () => {
  // 这是 2026-11-13 复查时发现的真弱点：原判据只看 Host，而 Host 是客户端可控的。
  //   攻击者从局域网发 POST，只需带 `Host: 127.0.0.1` + `Content-Type: application/json`
  //   就能命中「无 Origin 放行」分支。改为 socket 优先后该伪造失效。
  const r = checkOrigin('POST', '', undefined, '127.0.0.1:30800', 'application/json', '10.10.10.4');
  assert.equal(r.ok, false, '远端 socket 地址必须拒绝，哪怕 Host 伪造成回环');
  assert.equal(r.code, 'NO_ORIGIN');
});

test('本机 socket 地址放行（不依赖 Host 是否有值）', () => {
  // 某些转发链路会丢 Host（实测宿主转发后 host 为空）——此时仍应凭 socket 地址放行。
  for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const r = checkOrigin('POST', '', undefined, '', 'application/json', addr);
    assert.equal(r.ok, true, `socket 对端 ${addr} 应视为本机`);
  }
});

test('socket 地址优先于 Host：两者冲突时以 socket 为准', () => {
  // Host 说回环、socket 说远端 → 拒（防伪造）
  assert.equal(checkOrigin('POST', '', undefined, '127.0.0.1', 'application/json', '192.168.1.5').ok, false);
  // Host 说远端、socket 说本机 → 放行（Host 只是被剥离/改写的正常情况）
  assert.equal(checkOrigin('POST', '', undefined, '10.10.10.4:3080', 'application/json', '127.0.0.1').ok, true);
});
