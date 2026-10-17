/**
 * 宿主观测补发回归（2026-10-17 探针实验固化）
 *
 * 实验结论（实测）：我们补发 `fs/observed`（present + 当前 version，actor=本次 exec）之后，
 *   官方原生 write/edit 就能直接改这个文件，不再报 cannot modify "…": file has not been read ✓
 * 本测试用**假 ctx**把 recipe 钉住（不依赖真实宿主）：
 *   ① 缺 ctx/路径 ⇒ 返回 ok:false（不抛）
 *   ② 正常路径 ⇒ 依次调 ctx.get('fs').resolve → stat，再 ctx.emit('fs/observed', target, {kind:'present',version}, exec)
 *   ③ fs 抛错 / stat 为空 ⇒ ok:false（绝不冒泡，不能让补发失败影响已成功的编辑 ✓）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { observeFileForHost } from '../lib/fs/observe.js';

/** 造一个假插件 ctx（记录 emit 调用）。 */
function fakeCtx({ resolved = { targetKey: '/x/t.md', displayPath: '/x/t.md' }, info = { version: 'v1', type: 'file', size: 3 }, throwOn } = {}) {
  const emitted = [];
  const fs = {
    resolve: async () => { if (throwOn === 'resolve') throw new Error('resolve boom'); return resolved; },
    stat: async () => { if (throwOn === 'stat') throw new Error('stat boom'); return info; },
  };
  const ctx = {
    emit: (...args) => { emitted.push(args); },
    get: (k) => (k === 'fs' ? fs : undefined),
  };
  return { ctx, emitted };
}

test('缺 ctx / 路径 / fs 服务 ⇒ ok:false 且不抛（补发失败绝不影响主流程）', async () => {
  assert.equal((await observeFileForHost(null, {}, '/x')).ok, false);
  assert.equal((await observeFileForHost({ emit: () => {} }, {}, '')).ok, false);
  // fs 服务缺失（未 inject）：get('fs') 返回 undefined
  const bare = { emit: () => {}, get: () => undefined };
  assert.equal((await observeFileForHost(bare, {}, '/x/t.md')).ok, false, 'fs 服务缺失（未 inject）应安全返回');
});

test('正常路径：resolve → stat → emit(fs/observed, {kind:present, version}, exec)', async () => {
  const exec = { agent: 'a1', signal: undefined };
  const { ctx, emitted } = fakeCtx();
  const r = await observeFileForHost(ctx, exec, '/x/t.md');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.target, '/x/t.md');
  assert.equal(r.version, 'v1');
  assert.equal(emitted.length, 1, '应恰好补发一次观测');
  const [event, target, payload, actor] = emitted[0];
  assert.equal(event, 'fs/observed', '事件名必须与宿主 fs 工具层一致');
  assert.equal(target.displayPath, '/x/t.md');
  assert.equal(payload.kind, 'present', 'kind 必须是 present（读取/写入后的存在观测）');
  assert.equal(payload.version, 'v1', 'version 必须来自 provider stat（否则过不了宿主的版本 CAS）');
  assert.equal(actor, exec, 'actor 必须是本次 exec（台账按 owner 隔离，拿错 actor 等于替别人记账）');
});

test('fs 抛错 / 目标不存在 ⇒ ok:false（不冒泡）', async () => {
  const a = fakeCtx({ throwOn: 'resolve' });
  assert.equal((await observeFileForHost(a.ctx, {}, '/x/t.md')).ok, false, 'resolve 抛错应被吞掉');
  assert.equal(a.emitted.length, 0, '没解析成功就不该发观测');
  const b = fakeCtx({ throwOn: 'stat' });
  assert.equal((await observeFileForHost(b.ctx, {}, '/x/t.md')).ok, false);
  const c = fakeCtx({ info: null }); // 目标不存在（stat 返回空）——注意不用 undefined：那是默认值不生效
  const rc = await observeFileForHost(c.ctx, {}, '/x/t.md');
  assert.equal(rc.ok, false, '目标不存在（stat 为空）应安全返回');
  assert.equal(c.emitted.length, 0);
});
