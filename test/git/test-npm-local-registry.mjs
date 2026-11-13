/**
 * 本地 npm registry 协议测试（不调 npm CLI、不联网）。
 *
 * 为什么要测协议层：本地 registry 的用途是「发版前把 publish→install 真跑一遍」，
 *   它一旦有 bug（packument 缺字段、版本冲突没拦、tarball 路径不对），彩排就会给人假信心。
 *   所以这里直接按 npm 客户端的行为打三条路由：
 *     ① PUT  /:name          → 201；同版本重复 PUT → 403（与真 registry 语义一致）
 *     ② GET  /:name          → packument 含 dist-tags / versions / dist.tarball
 *     ③ GET  /:name/-/:file  → tarball 字节原样返回
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startLocalRegistry } from '../../lib/npm/local-registry.js';

const MANIFEST = { name: 'demo-pkg', version: '1.2.3', description: 'demo' };

/** 造一份 npm publish 的请求体（_attachments 里是 base64 tarball）。 */
function publishBody({ name = 'demo-pkg', version = '1.2.3', tag = 'beta', bytes = 'FAKE-TARBALL' } = {}) {
  const filename = `${name}-${version}.tgz`;
  return {
    _id: name,
    name,
    'dist-tags': { [tag]: version },
    versions: { [version]: { ...MANIFEST, name, version, dist: { shasum: 'x', integrity: 'y' } } },
    _attachments: { [filename]: { content_type: 'application/octet-stream', data: Buffer.from(bytes).toString('base64'), length: bytes.length } },
  };
}

async function withRegistry(fn) {
  const reg = await startLocalRegistry();
  try { return await fn(reg); } finally { await reg.close(); }
}

test('PUT 收包 → 201，且 packument 可读', () => withRegistry(async (reg) => {
  const put = await fetch(`${reg.url}/demo-pkg`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(publishBody()),
  });
  assert.equal(put.status, 201);
  const doc = await (await fetch(`${reg.url}/demo-pkg`)).json();
  assert.equal(doc.name, 'demo-pkg');
  assert.deepEqual(doc['dist-tags'], { beta: '1.2.3' });
  assert.deepEqual(Object.keys(doc.versions), ['1.2.3']);
  assert.match(doc.versions['1.2.3'].dist.tarball, /\/demo-pkg\/-\/demo-pkg-1\.2\.3\.tgz$/);
}));

test('同版本重复 PUT → 403（与真 registry 一致，彩排才能发现"忘了升版本"）', () => withRegistry(async (reg) => {
  await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody()) });
  const again = await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody()) });
  assert.equal(again.status, 403);
  const body = await again.json();
  assert.match(String(body.error), /existing version/);
}));

test('新版本可以叠加，dist-tags 可切换', () => withRegistry(async (reg) => {
  await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody({ version: '1.2.3', tag: 'beta' })) });
  await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody({ version: '1.2.4', tag: 'latest' })) });
  const doc = await (await fetch(`${reg.url}/demo-pkg`)).json();
  assert.deepEqual(Object.keys(doc.versions).sort(), ['1.2.3', '1.2.4']);
  assert.equal(doc['dist-tags'].beta, '1.2.3');
  assert.equal(doc['dist-tags'].latest, '1.2.4');
}));

test('tarball 原样可下载（字节一致）', () => withRegistry(async (reg) => {
  await fetch(`${reg.url}/demo-pkg`, { method: 'PUT', body: JSON.stringify(publishBody({ bytes: 'HELLO-TARBALL-BYTES' })) });
  const doc = await (await fetch(`${reg.url}/demo-pkg`)).json();
  const url = doc.versions['1.2.3'].dist.tarball;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  assert.equal(buf.toString('utf8'), 'HELLO-TARBALL-BYTES');
}));

test('不存在的 tarball → 404', () => withRegistry(async (reg) => {
  const r = await fetch(`${reg.url}/demo-pkg/-/nope.tgz`);
  assert.equal(r.status, 404);
}));

test('-/ping 健康检查', () => withRegistry(async (reg) => {
  const r = await fetch(`${reg.url}/-/ping`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
}));
