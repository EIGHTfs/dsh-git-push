/**
 * 工具探测 API + node 兜底测试（2026-09-28）
 *
 * 覆盖：
 *   · /api/git-push/tool-probes 端点（GET 只读，返回 48 工具探测清单）
 *   · probeToolPath('node') 在 PATH 无 node 时回退 process.execPath（DSH 宿主自带 node）
 *   · 探测结果为「真实路径 + 版本」，found:true 者 path 非空
 */
// dsh-skip-sensitive: 测试只断言工具路径/版本，无凭据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { handleHttp } from '../lib/app/http-handlers.js';
import { probeToolPath } from '../lib/context/index.js';

// 2026-10-05：改相对路径派生（此前硬编码机器绝对路径 /volume1/...，换机即失效）
const ROOT = join(import.meta.dirname, '..');

test('/api/git-push/tool-probes：GET 返回探测清单（只读豁免 origin）', async () => {
  const r = await handleHttp({ method: 'GET', url: '/api/git-push/tool-probes' }, { workspaceRoot: ROOT }, {});
  assert.equal(r.status, 200, 'GET 不需 origin 豁免，应 200');
  const b = r.body;
  assert.equal(b.ok, true);
  assert.ok(Array.isArray(b.probes) && b.probes.length >= 5, `应返回 ≥5 个工具（得 ${b.probes?.length}）`);
});

test('/api/git-push/tool-probes：存在已探测到的工具（node/git 路径非空）', async () => {
  const r = await handleHttp({ method: 'GET', url: '/api/git-push/tool-probes' }, { workspaceRoot: ROOT }, {});
  const found = r.body.probes.filter((p) => p.found);
  const node = found.find((p) => p.name === 'node');
  assert.ok(node, 'node 应被探测到（本机 PATH 可能无 node，靠 execPath 兜底）');
  assert.ok(node.path && node.path.length > 0, 'node 路径非空');
  const git = found.find((p) => p.name === 'git');
  assert.ok(git && git.found, 'git 应探测到');
});

test('probeToolPath：node 走 process.execPath 兜底（返回宿主 node 路径）', () => {
  const r = probeToolPath('node', ['--version']);
  assert.equal(r.found, true, 'node 应 found:true（execPath 兜底不依赖 PATH）');
  assert.ok(r.path && r.path.length > 0, 'node 路径非空');
  assert.ok(r.version, 'node 版本非空（--version）');
});

test('probeToolPath：非 node 工具正常 which 探测', () => {
  const r = probeToolPath('curl', ['--version']);
  // curl 在多数环境存在；若不存在只断言「返回结构完整」而非必 found
  assert.equal(typeof r.found, 'boolean');
  assert.equal(r.name, 'curl');
  assert.ok(typeof r.path === 'string');
});