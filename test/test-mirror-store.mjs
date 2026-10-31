/**
 * 镜像候选清单与健康度学习测试（2026-10-31）。
 *
 * 背景：旧实现把镜像硬编码成单一 gh-proxy.com —— 该镜像实测对一个 8MB 文件返回过
 *   total=590454 的**截断缓存**（真实 8059635），单点坏掉就没有退路。
 *   现改为候选清单：按优先级选第一个未停用的；实际下载的数据校验失败会累计该镜像的
 *   失败次数（满 3 停用），一次成功即清零；全部停用则直连（宁可不加速也不用坏源）。
 *
 * 本测试锁五件事：
 *   ① 环境变量优先级（显式钉死 / off 关闭）高于清单；
 *   ② 清单顺序即优先级，停用的自动跳过；
 *   ③ 连续 3 次数据校验失败 → 停用；成功一次 → 恢复；
 *   ④ 探测判据必须校验**内容长度**（坏镜像的特征是 HTTP 正常但内容截断）；
 *   ⑤ 状态文件与出厂清单分离（不写脏随仓库入库的那份）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  MAX_FAILURES, SEED_PATH, invalidateMirrorCache, listCandidates, normalizeMirror,
  pickMirror, probeMirror, readSeed, readState, recordOutcome, statePath,
} from '../lib/core/mirror-store.js';

/** 每个用例独立的临时状态文件（不碰真实配置目录）。 */
function withStateFile(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-mirror-'));
  const stateFile = join(dir, 'mirror-state.json');
  const prev = process.env.DSH_GIT_MIRROR_STATE;
  const prevPick = process.env.DSH_GIT_MIRROR_PREFIX;
  process.env.DSH_GIT_MIRROR_STATE = stateFile;
  delete process.env.DSH_GIT_MIRROR_PREFIX;
  invalidateMirrorCache();
  try { return fn({ dir, stateFile }); } finally {
    if (prev === undefined) delete process.env.DSH_GIT_MIRROR_STATE; else process.env.DSH_GIT_MIRROR_STATE = prev;
    if (prevPick === undefined) delete process.env.DSH_GIT_MIRROR_PREFIX; else process.env.DSH_GIT_MIRROR_PREFIX = prevPick;
    invalidateMirrorCache();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('normalizeMirror：补结尾斜杠、去空白', () => {
  assert.equal(normalizeMirror('https://a.com'), 'https://a.com/');
  assert.equal(normalizeMirror('  https://a.com/  '), 'https://a.com/');
  assert.equal(normalizeMirror(''), '');
});

test('出厂清单：至少 2 个候选，且都以 / 结尾', () => {
  const seed = readSeed();
  assert.ok(seed.length >= 2, `出厂清单应有多候选，实际 ${seed.length}`);
  for (const it of seed) assert.match(it.mirror, /\/$/);
  assert.ok(existsSync(SEED_PATH), '出厂清单文件必须随仓库入库');
});

test('pickMirror：默认取清单里第一个未停用的', () => withStateFile(() => {
  const first = readSeed()[0].mirror;
  assert.equal(pickMirror(), first);
}));

test('pickMirror：环境变量显式钉死优先于清单', () => withStateFile(() => {
  process.env.DSH_GIT_MIRROR_PREFIX = 'https://pinned.example';
  invalidateMirrorCache();
  assert.equal(pickMirror(), 'https://pinned.example/');
}));

test('pickMirror：off/none/0 等取值 → 关闭镜像（返回空串）', () => withStateFile(() => {
  for (const v of ['off', 'none', 'no', 'false', '0', '-']) {
    process.env.DSH_GIT_MIRROR_PREFIX = v;
    invalidateMirrorCache();
    assert.equal(pickMirror(), '', `${v} 应关闭镜像`);
  }
}));

test('recordOutcome：连续失败达阈值即停用，成功一次恢复', () => withStateFile(({ stateFile }) => {
  const seed = readSeed();
  const m = seed[0].mirror;
  for (let i = 1; i <= MAX_FAILURES; i++) {
    const r = recordOutcome(m, { ok: false, error: `坏数据 ${i}`, stateFile });
    assert.equal(r.state.failures, i);
    assert.equal(r.disabled, i >= MAX_FAILURES, `第 ${i} 次失败后 disabled 应为 ${i >= MAX_FAILURES}`);
  }
  invalidateMirrorCache();
  // 第一个停用后，选择应自动落到下一个候选
  assert.equal(pickMirror(), seed[1].mirror);
  // 一次成功清零并恢复
  recordOutcome(m, { ok: true, stateFile });
  invalidateMirrorCache();
  assert.equal(readState(stateFile)[m].failures, 0);
  assert.equal(pickMirror(), m, '恢复后应重新成为首选');
}));

test('recordOutcome：全部候选停用 → pickMirror 返回空（走直连）', () => withStateFile(({ stateFile }) => {
  for (const it of readSeed()) {
    for (let i = 0; i < MAX_FAILURES; i++) recordOutcome(it.mirror, { ok: false, error: 'x', stateFile });
  }
  invalidateMirrorCache();
  assert.equal(pickMirror(), '', '全停用应回退直连，而不是继续用坏源');
}));

test('状态文件与出厂清单分离：学习结果不写进入库的 candidates.json', () => withStateFile(({ stateFile }) => {
  const before = readFileSync(SEED_PATH, 'utf8');
  recordOutcome(readSeed()[0].mirror, { ok: false, error: 'x', stateFile });
  assert.equal(readFileSync(SEED_PATH, 'utf8'), before, '出厂清单必须保持原样');
  assert.ok(existsSync(stateFile), '学习结果应落在独立状态文件');
}));

test('statePath：可被 DSH_GIT_MIRROR_STATE 覆盖（测试隔离用）', () => withStateFile(({ stateFile }) => {
  assert.equal(statePath(), stateFile);
}));

test('listCandidates：合并清单与状态（顺序不变、带健康度）', () => withStateFile(({ stateFile }) => {
  const seed = readSeed();
  recordOutcome(seed[0].mirror, { ok: false, error: 'boom', stateFile });
  invalidateMirrorCache();
  const list = listCandidates();
  assert.equal(list.length, seed.length);
  assert.equal(list[0].mirror, seed[0].mirror);
  assert.equal(list[0].failures, 1);
  assert.equal(list[0].lastError, 'boom');
  assert.equal(list[1].failures, 0);
}));

test('probeMirror：内容总长与期望不符 → 判不健康（坏镜像的典型形态）', async () => {
  const fakeFetch = async () => new Response('x'.repeat(10), {
    status: 206,
    headers: { 'content-range': 'bytes 0-9/590454', 'content-length': '10' },
  });
  const r = await probeMirror({ mirror: 'https://bad.example/', fetchImpl: fakeFetch, expectedBytes: 8059635 });
  assert.equal(r.ok, false);
  assert.match(r.error, /声明总长/);
});

test('probeMirror：总长一致 → 判健康', async () => {
  const fakeFetch = async () => new Response('x'.repeat(10), {
    status: 206,
    headers: { 'content-range': 'bytes 0-9/8059635', 'content-length': '10' },
  });
  const r = await probeMirror({ mirror: 'https://good.example/', fetchImpl: fakeFetch, expectedBytes: 8059635 });
  assert.equal(r.ok, true);
});

test('probeMirror：HTTP 错误 → 判不健康', async () => {
  const fakeFetch = async () => new Response('nope', { status: 503 });
  const r = await probeMirror({ mirror: 'https://down.example/', fetchImpl: fakeFetch });
  assert.equal(r.ok, false);
  assert.match(r.error, /503/);
});

test('probeMirror：网络异常 → 判不健康且不抛', async () => {
  const fakeFetch = async () => { throw new Error('ECONNRESET'); };
  const r = await probeMirror({ mirror: 'https://boom.example/', fetchImpl: fakeFetch });
  assert.equal(r.ok, false);
  assert.match(r.error, /ECONNRESET/);
});
