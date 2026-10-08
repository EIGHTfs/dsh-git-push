// 镜像通道的双闸门 + 只读动词集合（纯函数用例，不联网）
//
// 为什么必须有用例：这些行为**默认全绿**（默认走 gh-proxy、写操作直连），
//   一旦哪次改动把闸门去掉，功能照常能跑、只有安全属性丢失 —— 没有用例就永远不会红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { withMirror, mirrorGitConfigEnv, mirrorPrefix, DEFAULT_MIRROR_PREFIX } from '../lib/git/endpoints.js';
import { GIT_READ_VERBS } from '../lib/git/exec.js';

const API = 'https://api.github.com/repos/a/b';
const RAW = 'https://raw.githubusercontent.com/a/b/c/d.png';
const WEB = 'https://github.com/a/b.git';

/** 临时设置镜像环境变量执行断言，结束后还原（避免用例间互相污染）。 */
const withEnv = (v, fn) => {
  const old = process.env.DSH_GIT_MIRROR_PREFIX;
  if (v === undefined) delete process.env.DSH_GIT_MIRROR_PREFIX;
  else process.env.DSH_GIT_MIRROR_PREFIX = v;
  try { return fn(); } finally {
    if (old === undefined) delete process.env.DSH_GIT_MIRROR_PREFIX;
    else process.env.DSH_GIT_MIRROR_PREFIX = old;
  }
};

test('默认通道：未设环境变量时前缀为默认值，只读 GET 的三类 github URL 都被改写', () => withEnv(undefined, () => {
  assert.equal(mirrorPrefix(), DEFAULT_MIRROR_PREFIX);
  for (const u of [API, RAW, WEB]) assert.equal(withMirror(u), DEFAULT_MIRROR_PREFIX + u, u);
}));

test('闸门一：写操作一律直连（POST/PATCH/PUT/DELETE 与 mode=write 都不改写）', () => withEnv(undefined, () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.equal(withMirror(API, { method }), API, 'method=' + method);
  }
  assert.equal(withMirror(API, { mode: 'write' }), API);
  assert.equal(withMirror(API, { method: 'POST', mode: 'write' }), API);
}));

test('闸门二：带凭据（noMirror）一律直连——token 绝不经过第三方', () => withEnv(undefined, () => {
  assert.equal(withMirror(API, { noMirror: true }), API);
  assert.equal(withMirror(RAW, { noMirror: true }), RAW);
}));

test('逃生开关：off/none/no/false/0/- 均关闭镜像，非 github URL 原样返回', () => withEnv('off', () => {
  assert.equal(mirrorPrefix(), '');
  assert.equal(withMirror(API), API);
  assert.equal(withMirror(RAW), API.includes('api') ? RAW : RAW);
}));
test('逃生开关的其它取值同样关闭镜像', () => {
  for (const v of ['none', 'no', 'false', '0', '-']) {
    withEnv(v, () => assert.equal(mirrorPrefix(), '', 'v=' + v));
  }
});

test('自定义前缀生效（不以 / 结尾时自动补），且非 github 域不改写', () => withEnv('https://example-mirror.test', () => {
  assert.equal(mirrorPrefix(), 'https://example-mirror.test/');
  assert.equal(withMirror(API), 'https://example-mirror.test/' + API);
  assert.equal(withMirror('https://gitlab.com/a/b'), 'https://gitlab.com/a/b');
}));

test('git 层：读模式注入 insteadOf，写模式绝不注入', () => withEnv(undefined, () => {
  const read = {};
  mirrorGitConfigEnv(read, { mode: 'read' });
  assert.equal(read.GIT_CONFIG_KEY_0, `url.${DEFAULT_MIRROR_PREFIX}https://github.com/.insteadOf`);
  assert.equal(read.GIT_CONFIG_VALUE_0, 'https://github.com/');
  const write = {};
  mirrorGitConfigEnv(write, { mode: 'write' });
  assert.equal(write.GIT_CONFIG_KEY_0, undefined);
  assert.equal(write.GIT_CONFIG_COUNT, undefined);
}));

test('git 层：镜像关闭时不写任何 GIT_CONFIG_*', () => withEnv('off', () => {
  const env = {};
  mirrorGitConfigEnv(env);
  assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('GIT_CONFIG')), []);
}));

test('只读动词集合：含 fetch/clone/pull/ls-remote/submodule，不含任何写动词', () => {
  for (const v of ['fetch', 'clone', 'pull', 'ls-remote', 'submodule']) assert.ok(GIT_READ_VERBS.has(v), v);
  for (const v of ['push', 'commit', 'tag', 'reset', 'checkout', 'merge', 'rebase', 'remote']) {
    assert.ok(!GIT_READ_VERBS.has(v), '写/本地动词不应被注入镜像: ' + v);
  }
});
