// 镜像故障自动回退直连（需要一次真实网络请求；离线环境自动跳过）
//
// 为什么必须有用例：回退只在「镜像不可用」时生效 —— 平时永远走不到，删掉它也没有任何测试会红，
//   而它挂掉时的后果是「代理一抖、克隆全挂」。故必须有一条用例专门制造故障并断言仍能成功。
import test from 'node:test';
import assert from 'node:assert/strict';
import { githubFetch } from '../lib/git/api.js';

const OFFLINE = process.env.DSH_GIT_PUSH_OFFLINE === '1';
const SKIP = OFFLINE ? '离线模式（DSH_GIT_PUSH_OFFLINE=1）跳过：该用例需要一次真实请求' : false;

const withMirror = async (value, fn) => {
  const old = process.env.DSH_GIT_MIRROR_PREFIX;
  if (value === undefined) delete process.env.DSH_GIT_MIRROR_PREFIX;
  else process.env.DSH_GIT_MIRROR_PREFIX = value;
  try { return await fn(); } finally {
    if (old === undefined) delete process.env.DSH_GIT_MIRROR_PREFIX;
    else process.env.DSH_GIT_MIRROR_PREFIX = old;
  }
};

test('镜像故障 ⇒ 自动回退直连（坏镜像下仍应成功）', { skip: SKIP }, async () => {
  const r = await withMirror('https://mirror-must-fail-probe.invalid/', () => githubFetch('/repos/EIGHTfs/dsh-skill-scoreboard', {}));
  assert.equal(r.status, 200, `坏镜像下应回退直连并成功，实际 ${JSON.stringify({ status: r.status, error: r.error })}`);
  assert.ok(r.json && r.json.default_branch, '应拿到仓库 JSON（含 default_branch）');
});

test('镜像正常 ⇒ 经镜像成功（不回退也不影响结果）', { skip: SKIP }, async () => {
  const r = await withMirror(undefined, () => githubFetch('/repos/EIGHTfs/dsh-skill-scoreboard', {}));
  assert.equal(r.status, 200, `默认镜像下应成功，实际 ${JSON.stringify({ status: r.status, error: r.error })}`);
});

test('关闭镜像 ⇒ 直连成功（逃生开关可用）', { skip: SKIP }, async () => {
  const r = await withMirror('off', () => githubFetch('/repos/EIGHTfs/dsh-skill-scoreboard', {}));
  assert.equal(r.status, 200, `off 时应直连成功，实际 ${JSON.stringify({ status: r.status, error: r.error })}`);
});

test('4xx 不触发回退（远端真实答案，回退无意义）', { skip: SKIP }, async () => {
  // 用一个必定 404 的仓库名：若实现对 4xx 也回退，将出现两次请求；这里只断言最终仍是 404 且不抛错
  const r = await withMirror('https://mirror-must-fail-probe.invalid/', () => githubFetch('/repos/EIGHTfs/__no-such-repo-dshgp-probe__', {}));
  assert.equal(r.status, 404, `应如实回传 404，实际 ${JSON.stringify({ status: r.status, error: r.error })}`);
});
