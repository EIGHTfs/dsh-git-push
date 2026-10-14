/**
 * npm 执行器回归测试：ENOBUFS（子进程输出超过 maxBuffer）必须**自动放大缓冲重试一次** ✓。
 *
 * 历史现象（用户实测）：`npm 调用失败（…/npm）：spawnSync … ENOBUFS` ——
 *   真因是 npm 跑在了错误的 cwd（继承宿主 cwd，那里有 package.json ⇒ npm pack 输出 2.1MB）
 *   且缓冲上限不够；cwd 已在 lib/npm/publish.js 显式传（pack/publish 都以目标包为 cwd ✓），
 *   本测试锁的是**第二道防线**：即便输出真超限，也不该把一句 ENOBUFS 直接甩给上层 ✗。
 *
 * 怎么做到确定性：runNpm 支持注入 maxBuffer ✓ ⇒ 传 1 字节 ⇒ 首次必然 ENOBUFS ⇒
 *   若重试生效则整体成功（ok=true）✓；不生效则 ok=false 且 error 含 ENOBUFS ✗。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runNpm, resolveNpmBin, NPM_TIMEOUT_MS } from '../lib/npm/registry.js';

test('ENOBUFS 自动重试：注入 1 字节缓冲也应最终成功', async () => {
  const r = await runNpm(['--version'], { timeoutMs: 120000, maxBuffer: 1 });
  assert.equal(r.ok, true,
    `1 字节缓冲必然先 ENOBUFS，重试放大后应成功——实得 ok=${r.ok} error=${String(r.error || '').slice(0, 120)}`);
  assert.match(String(r.stdout || ''), /\d+\.\d+/, '应拿到 npm 版本号');
  assert.ok(!/ENOBUFS/.test(String(r.error || '')), '成功路径不应残留 ENOBUFS 错误');
});

test('默认缓冲路径不受影响（不注入 maxBuffer）', async () => {
  const r = await runNpm(['--version'], { timeoutMs: 120000 });
  assert.equal(r.ok, true);
  assert.match(String(r.stdout || ''), /\d+\.\d+/);
});

test('返回结构稳定：bin / code / stdout / stderr 都在', async () => {
  const r = await runNpm(['--version'], { timeoutMs: 120000 });
  assert.equal(typeof r.bin, 'string');
  assert.equal(r.bin, resolveNpmBin({ env: process.env }) || r.bin);
  assert.equal(typeof r.code, 'number');
  assert.equal(typeof r.stdout, 'string');
  assert.equal(typeof r.stderr, 'string');
  assert.ok(NPM_TIMEOUT_MS > 0);
});
