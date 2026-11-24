/**
 * autoTagDSHProject 回归（锁住现有行为，再动实现）
 *
 * 为什么先写它：接下去要把「调 GitHub API 打 tag」的逻辑抽出去与新 tag 模块共用。
 *   一旦抽错，症状是**推送成功但 tag 没打上**——不报错、不告警，只在下游发现「没有版本标签」。
 *   所以先用注入的假 fetch 把 11 种分支全部钉住，改完再跑一遍，确认行为一字未变。
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoTagDSHProject, setPostPushFetchDeps } from '../../lib/git/post-push.js';

/** 造一个按序返回预设响应的假 githubFetch，并记录调用。 */
function makeFetch(sequence) {
  const pending = [...sequence];
  const calls = [];
  const impl = async (path, options) => {
    calls.push({ path: String(path), options: options || {} });
    return pending.shift() ?? { status: 0, json: null, error: 'no-more-responses' };
  };
  impl.calls = calls;
  return impl;
}

const OK_GET_404 = { status: 404, json: null };
const OK_POST_201 = { status: 201, json: { ref: 'refs/tags/v1.0.0' } };

let workDir = '';

/** 造一个「名字像 dsh- 项目」的临时目录（用于 repoPath 兜底路径）。 */
function makeRepoDir(name = 'dsh-probe') {
  workDir = mkdtempSync(join(tmpdir(), 'dshgp-tag-'));
  const repoPath = join(workDir, name);
  // mkdtemp 只造父目录；这里需要最后一段目录名带 dsh- 前缀
  writeFileSync(join(workDir, 'placeholder'), '');
  return { repoPath, workDir: workDir };
}

afterEach(() => {
  setPostPushFetchDeps(null);
  if (workDir) { try { rmSync(workDir, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ } workDir = ''; }
});

test('非 dsh- 前缀项目：跳过，不发起任何请求', async () => {
  const fake = makeFetch([]);
  setPostPushFetchDeps(fake);
  const result = await autoTagDSHProject({ repoPath: '/tmp', repo: 'my-tool', version: '1.0.0', commitSha: 'abc', token: 't' });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, 'not-dsh-prefix');
  assert.equal(fake.calls.length, 0, '非 dsh- 项目不该打任何 API');
});

test('没有版本号：跳过', async () => {
  const { repoPath } = makeRepoDir();
  const fake = makeFetch([]);
  setPostPushFetchDeps(fake);
  const result = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', commitSha: 'abc', token: 't' });
  assert.equal(result.skipped, 'no-version');
  assert.equal(fake.calls.length, 0);
});

test('没有 commitSha / 没有 token：分别跳过', async () => {
  const { repoPath } = makeRepoDir();
  setPostPushFetchDeps(makeFetch([]));
  const noSha = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', version: '1.0.0', token: 't' });
  assert.equal(noSha.skipped, 'no-commit-sha');
  const noToken = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', version: '1.0.0', commitSha: 'abc' });
  assert.equal(noToken.skipped, 'no-token');
});

test('无 origin 且未显式给 owner/repo：跳过', async () => {
  const { repoPath } = makeRepoDir();
  setPostPushFetchDeps(makeFetch([]));
  const result = await autoTagDSHProject({ repoPath, version: '1.0.0', commitSha: 'abc', token: 't' });
  assert.equal(result.skipped, 'no-origin', '非 git 目录拿不到 origin，应如实跳过而不是瞎打');
});

test('tag 已存在于远端：跳过 tag-exists，不发创建请求', async () => {
  const { repoPath } = makeRepoDir();
  const fake = makeFetch([{ status: 200, json: { ref: 'refs/tags/v1.0.0' } }]);
  setPostPushFetchDeps(fake);
  const result = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', owner: 'me', version: '1.0.0', commitSha: 'abc', token: 't' });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, 'tag-exists');
  assert.equal(result.tag, 'v1.0.0');
  assert.equal(fake.calls.length, 1, '存在即停，不该再发创建请求');
});

test('创建成功：POST refs 且 ref/sha 正确', async () => {
  const { repoPath } = makeRepoDir();
  const fake = makeFetch([OK_GET_404, OK_POST_201]);
  setPostPushFetchDeps(fake);
  const result = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', owner: 'me', version: '1.0.0', commitSha: 'deadbeef', token: 't' });
  assert.equal(result.ok, true);
  assert.equal(result.tag, 'v1.0.0');
  const createCall = fake.calls[1];
  assert.match(createCall.path, /\/repos\/me\/dsh-probe\/git\/refs$/);
  assert.equal(createCall.options.method, 'POST');
  assert.deepEqual(createCall.options.body, { ref: 'refs/tags/v1.0.0', sha: 'deadbeef' });
});

test('版本号已带 v 前缀：不重复加 v', async () => {
  const { repoPath } = makeRepoDir();
  const fake = makeFetch([OK_GET_404, OK_POST_201]);
  setPostPushFetchDeps(fake);
  const result = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', owner: 'me', version: 'v2.3.4', commitSha: 'abc', token: 't' });
  assert.equal(result.tag, 'v2.3.4');
});

test('422 且 message 含 already exists：判 tag-exists（不报错）', async () => {
  const { repoPath } = makeRepoDir();
  setPostPushFetchDeps(makeFetch([OK_GET_404, { status: 422, json: { message: 'Reference already exists' } }]));
  const result = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', owner: 'me', version: '1.0.0', commitSha: 'abc', token: 't' });
  assert.equal(result.skipped, 'tag-exists');
});

test('422 其它原因：如实透出 skipped=422 与 message', async () => {
  const { repoPath } = makeRepoDir();
  setPostPushFetchDeps(makeFetch([OK_GET_404, { status: 422, json: { message: 'Invalid sha' } }]));
  const result = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', owner: 'me', version: '1.0.0', commitSha: 'abc', token: 't' });
  assert.equal(result.skipped, '422');
  assert.equal(result.error, 'Invalid sha');
});

test('其它状态码：skipped 记录状态码，不吞错', async () => {
  const { repoPath } = makeRepoDir();
  setPostPushFetchDeps(makeFetch([OK_GET_404, { status: 500, error: 'boom' }]));
  const result = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', owner: 'me', version: '1.0.0', commitSha: 'abc', token: 't' });
  assert.equal(result.skipped, '500');
  assert.equal(result.error, 'boom');
});

test('注入的 fetch 抛异常：收敛成 skipped=error，不向调用方抛', async () => {
  const { repoPath } = makeRepoDir();
  setPostPushFetchDeps(async () => { throw new Error('dns failed'); });
  const result = await autoTagDSHProject({ repoPath, repo: 'dsh-probe', owner: 'me', version: '1.0.0', commitSha: 'abc', token: 't' });
  assert.equal(result.skipped, 'error');
  assert.match(String(result.error), /dns failed/);
});
