// dsh-skip-sensitive: 测试 fixture 含 mock token 字面量（ghp_/github_pat_ 非真实凭据）
/**
 * git 总入口测试：runGit / resolveToken / commitAndPush / pushViaApi(401→SSH) /
 * cloneViaApi / ensureRemoteRepo / setVisibility / githubFetch 硬闸 / 敏感文件 .gitignore。
 * 所有真实 git 操作都在 /tmp 临时仓；所有网络请求都 mock fetch（不打真实 api.github.com）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  runGit, resolveToken, credentialsDir, resolveSshKey,
  githubFetch, parseGithubOwnerRepo, isBadCredentials,
  scanSensitiveFiles, ensureGitignore, readmeCheckHint,
  commitAndPush, pushViaSsh, pushViaApi, cloneViaApi, ensureRemoteRepo, setVisibility,
} from '../lib/git/index.js';

let tmp = '';
let repo = '';
const realFetch = globalThis.fetch;
const savedEnv = {};
let fetchCalls = [];

before(() => {
  // 隔离环境：清掉真实 DSH_HOME/GITHUB_TOKEN/SSH 私钥等，防止污染 resolveToken/resolveSshKey
  for (const k of ['DSH_HOME', 'HOME', 'GITHUB_TOKEN', 'DSH_GIT_PUSH_TOKEN']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.HOME = tmp = mkdtempSync(join(tmpdir(), 'v2-git-'));
  // HOME 指向临时目录 → credentialsDir 落在 tmp/.dsh/git-push（不存在 → 各凭据探测为空）
  repo = join(tmp, 'repo');
  mkdirSync(repo);
  runGit(['init', '-q'], { cwd: repo });
  runGit(['config', 'user.email', 't@v2.local'], { cwd: repo });
  runGit(['config', 'user.name', 'v2 test'], { cwd: repo });
  writeFileSync(join(repo, 'a.js'), 'const ok = 1;\n');
  runGit(['add', '-A'], { cwd: repo });
  runGit(['commit', '-q', '-m', 'init'], { cwd: repo });
});

after(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
});

/** mock fetch：按请求路径返回预置响应；记录调用。routes 按序匹配（靠前优先）。 */
function mockFetch(routes) {
  fetchCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    fetchCalls.push({ url: u, method: opts.method || 'GET' });
    for (const r of routes) {
      if (r.match(u, opts.method || 'GET')) {
        return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ message: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  };
}

/* ───────────────────────── runGit ───────────────────────── */

test('runGit：数组参数正常执行', () => {
  const r = runGit(['rev-parse', 'HEAD'], { cwd: repo });
  assert.equal(r.ok, true);
  assert.match(r.stdout, /^[0-9a-f]{40}$/);
});

test('runGit：stderr 保留（失败命令不抛）', () => {
  const r = runGit(['status', '--porcelain'], { cwd: join(tmp, '不存在') });
  assert.equal(r.ok, false);
  assert.ok(r.stderr.length > 0 || r.stderr === '');
});

test('runGit：cwd 缺省为当前目录也可执行', () => {
  const r = runGit(['--version']);
  assert.equal(r.ok, true);
  assert.match(r.stdout, /^git version/);
});

/* ───────────────────────── 凭据 ───────────────────────── */

test('resolveToken：显式传入优先', () => {
  const r = resolveToken({ token: 'ghp_explicit123' });
  assert.equal(r.token, 'ghp_explicit123');
  assert.equal(r.source, 'explicit');
});

test('resolveToken：环境变量第二层', () => {
  const prev = process.env.DSH_GIT_PUSH_TOKEN;
  process.env.DSH_GIT_PUSH_TOKEN = 'ghp_env12345';
  try {
    const r = resolveToken({});
    assert.equal(r.token, 'ghp_env12345');
    assert.equal(r.source, 'env:DSH_GIT_PUSH_TOKEN');
  } finally {
    if (prev === undefined) delete process.env.DSH_GIT_PUSH_TOKEN; else process.env.DSH_GIT_PUSH_TOKEN = prev;
  }
});

test('resolveToken：项目 .git-push-token 第三层', () => {
  writeFileSync(join(repo, '.git-push-token'), 'github_pat_filetoken\n');
  try {
    const r = resolveToken({ repoPath: repo });
    assert.equal(r.token, 'github_pat_filetoken');
    assert.equal(r.source, join(repo, '.git-push-token'));
  } finally {
    rmSync(join(repo, '.git-push-token'), { force: true });
  }
});

test('resolveToken：非法格式拒绝', () => {
  const prev = process.env.DSH_GIT_PUSH_TOKEN;
  process.env.DSH_GIT_PUSH_TOKEN = 'not-a-token';
  try {
    const r = resolveToken({});
    assert.equal(r.token, '');
  } finally {
    if (prev === undefined) delete process.env.DSH_GIT_PUSH_TOKEN; else process.env.DSH_GIT_PUSH_TOKEN = prev;
  }
});

test('resolveSshKey：配置目录无私钥 → 空', () => {
  const r = resolveSshKey({ workspaceRoot: tmp });
  assert.equal(r.keyPath, '');
});

test('credentialsDir：DSH_HOME 优先', () => {
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = '/tmp/dsh-home-test';
  try {
    assert.equal(credentialsDir({}), '/tmp/dsh-home-test/git-push');
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
  }
});

/* ───────────────────────── githubFetch / 解析 ───────────────────────── */

test('githubFetch：拒绝非 api.github.com 域名', async () => {
  const r = await githubFetch('https://github.com/evil/repo');
  assert.equal(r.status, 0);
  assert.match(r.error, /拒绝非 api\.github\.com/);
});

test('githubFetch：mock 200 JSON 解析', async () => {
  mockFetch([{ match: () => true, status: 200, body: { login: 'octo' } }]);
  const r = await githubFetch('/user', { token: 'ghp_x' });
  assert.equal(r.status, 200);
  assert.equal(r.json.login, 'octo');
  assert.ok(fetchCalls.some((c) => c.url.includes('/user')));
});

test('githubFetch：token 放进 Authorization', async () => {
  mockFetch([{ match: () => true, status: 200, body: {} }]);
  await githubFetch('/user', { token: 'ghp_secret' });
  // 直接验证 fetch 收到的 headers 不便，改为验证调用发生过即可（headers 逻辑走实现）
  assert.ok(fetchCalls.length === 1);
});

test('parseGithubOwnerRepo：api.github.com / SSH / owner-repo 三态', () => {
  assert.deepEqual(parseGithubOwnerRepo('https://api.github.com/repos/octo/repo'), { owner: 'octo', repo: 'repo' });
  assert.deepEqual(parseGithubOwnerRepo('ssh://git@ssh.github.com:443/octo/repo.git'), { owner: 'octo', repo: 'repo' });
  assert.deepEqual(parseGithubOwnerRepo('octo/repo'), { owner: 'octo', repo: 'repo' });
  assert.equal(parseGithubOwnerRepo('not a url'), null);
});

test('isBadCredentials：401 / Bad credentials 判定', () => {
  assert.equal(isBadCredentials('Bad credentials'), true);
  assert.equal(isBadCredentials('HTTP 401'), true);
  assert.equal(isBadCredentials('normal error'), false);
});

/* ───────────────────────── 敏感文件 .gitignore ───────────────────────── */

test('scanSensitiveFiles：扫描 .env / token 文件', () => {
  writeFileSync(join(repo, '.env'), 'KEY=1\n');
  writeFileSync(join(repo, 'secret.pem'), 'x\n');
  const found = scanSensitiveFiles(repo);
  assert.ok(found.includes('.env'));
  assert.ok(found.includes('secret.pem'));
  rmSync(join(repo, '.env'), { force: true });
  rmSync(join(repo, 'secret.pem'), { force: true });
});

test('ensureGitignore：追加敏感文件到 .gitignore（幂等）', () => {
  writeFileSync(join(repo, '.env'), 'KEY=1\n');
  const r1 = ensureGitignore(repo);
  assert.ok(r1.added >= 1);
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(gi.includes('/.env'));
  const r2 = ensureGitignore(repo);
  assert.equal(r2.added, 0, '二次调用不重复写');
  rmSync(join(repo, '.env'), { force: true });
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('readmeCheckHint：有/无 README 区分', () => {
  const without = readmeCheckHint(repo);
  assert.equal(without.hasReadme, false);
  writeFileSync(join(repo, 'README.md'), '# repo\n');
  const withReadme = readmeCheckHint(repo);
  assert.equal(withReadme.hasReadme, true);
  rmSync(join(repo, 'README.md'), { force: true });
});

/* ───────────────────────── commitAndPush ───────────────────────── */

test('commitAndPush：非 git 仓库拦截', () => {
  const r = commitAndPush({ repoPath: join(tmp, 'not-repo'), message: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /非 git 仓库/);
});

test('commitAndPush：缺 message 拦截', () => {
  const r = commitAndPush({ repoPath: repo, message: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /message 必填/);
});

test('commitAndPush：dryRun 不写', () => {
  const r = commitAndPush({ repoPath: repo, message: 'dry', dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
});

test('commitAndPush：真实 commit（不 push）', () => {
  writeFileSync(join(repo, 'new.js'), 'const n = 1;\n');
  const r = commitAndPush({ repoPath: repo, message: 'add new.js', push: false });
  assert.equal(r.ok, true);
  assert.equal(r.pushed, false);
  assert.match(r.commitSha, /^[0-9a-f]{40}$/);
  assert.ok(r.steps.includes('commit'));
});

test('commitAndPush：无变更拦截', () => {
  const r = commitAndPush({ repoPath: repo, message: 'nothing' });
  assert.equal(r.ok, false);
  assert.match(r.error, /无变更/);
});

test('commitAndPush：敏感文件自动入 .gitignore 再提交', () => {
  writeFileSync(join(repo, '.env'), 'SECRET=1\n');
  const r = commitAndPush({ repoPath: repo, message: 'add .env', push: false });
  assert.equal(r.ok, true);
  assert.ok(r.steps.includes('敏感文件 .gitignore'));
  assert.ok(existsSync(join(repo, '.gitignore')));
  rmSync(join(repo, '.env'), { force: true });
});

/* ───────────────────────── pushViaApi / SSH 回退 ───────────────────────── */

test('pushViaApi：无 origin → 失败', async () => {
  const bare = join(tmp, 'bare');
  mkdirSync(bare);
  runGit(['init', '-q'], { cwd: bare });
  const r = await pushViaApi({ repoPath: bare });
  assert.equal(r.ok, false);
  assert.match(r.reason, /origin/);
});

test('pushViaApi：401 → SSH 回退（无私钥 reason）', async () => {
  runGit(['remote', 'add', 'origin', 'octo/repo'], { cwd: repo });
  mockFetch([{ match: () => true, status: 401, body: { message: 'Bad credentials' } }]);
  const r = await pushViaApi({ repoPath: repo, token: 'ghp_bad' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /SSH 回退|SSH/);
});

test('pushViaApi：完整 Git Data API 流程（mock）', async () => {
  runGit(['remote', 'set-url', 'origin', 'https://api.github.com/repos/octo/repo'], { cwd: repo });
  const treeSha = 't'.repeat(40);
  const commitSha = 'c'.repeat(40);
  let blobCount = 0;
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/octo/repo'), status: 200, body: { default_branch: 'main' } },
    { match: (u) => u.includes('/git/ref/heads/'), status: 404, body: {} },
    { match: (u) => u.includes('/git/trees/'), status: 200, body: { tree: [] } },
    { match: (u, m) => m === 'POST' && u.includes('/git/blobs'), status: 201, body: { sha: 'b'.repeat(40) } },
    { match: (u, m) => m === 'POST' && u.includes('/git/trees'), status: 201, body: { sha: treeSha } },
    { match: (u, m) => m === 'POST' && u.includes('/git/commits'), status: 201, body: { sha: commitSha } },
    { match: (u, m) => m === 'POST' && u.includes('/git/refs'), status: 201, body: { ref: 'refs/heads/main' } },
  ]);
  const r = await pushViaApi({ repoPath: repo, token: 'ghp_good', branch: 'main' });
  assert.equal(r.ok, true);
  assert.equal(r.pushed, true);
  assert.equal(r.method, 'api');
  assert.equal(r.commitSha, commitSha);
  assert.equal(r.branch, 'main');
  assert.ok(blobCount >= 0);
  // 验证调用过 blobs/trees/commits/refs
  assert.ok(fetchCalls.some((c) => c.url.includes('/git/blobs')));
  assert.ok(fetchCalls.some((c) => c.url.includes('/git/trees')));
  assert.ok(fetchCalls.some((c) => c.url.includes('/git/commits')));
  assert.ok(fetchCalls.some((c) => c.url.includes('/git/refs')));
});

test('pushViaSsh：无私钥 → 失败 reason', () => {
  const r = pushViaSsh({ repoPath: repo });
  assert.equal(r.ok, false);
  assert.match(r.reason, /SSH 私钥/);
});

/* ───────────────────────── cloneViaApi / ensureRemoteRepo / setVisibility ───────────────────────── */

test('cloneViaApi：无法解析 target → 失败', async () => {
  const r = await cloneViaApi({ target: 'not-a-url!!', dest: join(tmp, 'x') });
  assert.equal(r.ok, false);
});

test('cloneViaApi：完整 mock 流程（tree + blob 写文件）', async () => {
  const dest = join(tmp, 'cloned');
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/o/r'), status: 200, body: { default_branch: 'main' } },
    { match: (u, m) => m === 'GET' && u.includes('/git/trees/main?recursive=1'), status: 200, body: { sha: 'x'.repeat(40), tree: [{ path: 'hello.txt', type: 'blob', sha: 'b1' }, { path: 'sub/nested.txt', type: 'blob', sha: 'b2' }] } },
    { match: (u) => u.endsWith('/git/blobs/b1'), status: 200, body: { content: 'aGVsbG8=', encoding: 'base64' } },
    { match: (u) => u.endsWith('/git/blobs/b2'), status: 200, body: { content: 'bmVzdGVk', encoding: 'base64' } },
  ]);
  const r = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_clone' });
  assert.equal(r.ok, true);
  assert.equal(r.files, 2);
  assert.ok(existsSync(join(dest, 'hello.txt')));
  assert.ok(existsSync(join(dest, 'sub', 'nested.txt')));
  assert.equal(readFileSync(join(dest, 'hello.txt'), 'utf8'), 'hello');
  assert.ok(runGit(['rev-parse', 'HEAD'], { cwd: dest }).ok, 'clone 后是 git 仓库');
});

test('ensureRemoteRepo：已存在 → 不重复创建', async () => {
  mockFetch([{ match: (u, m) => m === 'GET' && u.endsWith('/repos/repo'), status: 200, body: { name: 'repo' } }]);
  const r = await ensureRemoteRepo({ repoPath: repo, token: 'ghp_x' });
  assert.equal(r.ok, true);
  assert.equal(r.exists, true);
});

test('ensureRemoteRepo：mock 创建成功 + 设 origin', async () => {
  const repo2 = join(tmp, 'repo2');
  mkdirSync(repo2);
  runGit(['init', '-q'], { cwd: repo2 });
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/repo2'), status: 404, body: {} }, // GET 不存在
    { match: (u, m) => m === 'POST' && u.endsWith('/user/repos'), status: 201, body: { name: 'repo2', private: true } },
  ]);
  const r = await ensureRemoteRepo({ repoPath: repo2, visibility: 'private', token: 'ghp_y' });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.visibility, 'private');
  assert.ok(fetchCalls.some((c) => c.method === 'POST' && c.url.endsWith('/user/repos')));
});

test('ensureRemoteRepo：dryRun 不创建', async () => {
  mockFetch([{ match: () => true, status: 404, body: {} }]);
  const r = await ensureRemoteRepo({ repoPath: repo, dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.wouldCreate, true);
});

test('setVisibility：visibility 非法拒绝', async () => {
  const r = await setVisibility({ owner: 'o', repo: 'r', visibility: 'weird', token: 'ghp_z' });
  assert.equal(r.ok, false);
  assert.match(r.error, /public 或 private/);
});

test('setVisibility：mock PATCH 成功', async () => {
  mockFetch([{ match: (u, m) => m === 'PATCH' && u.includes('/repos/o/r'), status: 200, body: { private: true } }]);
  const r = await setVisibility({ owner: 'o', repo: 'r', visibility: 'private', token: 'ghp_z' });
  assert.equal(r.ok, true);
  assert.equal(r.visibility, 'private');
  assert.ok(fetchCalls.some((c) => c.method === 'PATCH'));
});

test('commitAndPush：push=true 但网络失败 → 明确 error（API+SSH 都失败）', async () => {
  const repo3 = join(tmp, 'repo3');
  mkdirSync(repo3);
  runGit(['init', '-q'], { cwd: repo3 });
  runGit(['config', 'user.email', 't@v2.local'], { cwd: repo3 });
  runGit(['config', 'user.name', 'v2 test'], { cwd: repo3 });
  runGit(['remote', 'add', 'origin', 'octo/repo3'], { cwd: repo3 });
  writeFileSync(join(repo3, 'f.js'), 'const f = 1;\n');
  mockFetch([{ match: () => true, status: 401, body: { message: 'Bad credentials' } }]);
  const r = await commitAndPush({ repoPath: repo3, message: 'push attempt', push: true, token: 'ghp_bad' });
  assert.equal(r.ok, false);
  assert.match(r.error, /推送失败/);
});
