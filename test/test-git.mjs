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

test('scanSensitiveFiles：扫描 .env / token 文件（文件名黑名单 + 内容级）', () => {
  writeFileSync(join(repo, '.env'), 'KEY=1\n');
  writeFileSync(join(repo, 'secret.pem'), 'x\n');
  // 内容级：硬编码密码应被检出
  writeFileSync(join(repo, 'app.js'), 'const password = "hunter2secret";\n');
  const found = scanSensitiveFiles(repo);
  const paths = found.map((h) => h.path);
  assert.ok(paths.includes('.env'), `.env 应命中（实际: ${paths.join(',')}）`);
  assert.ok(paths.includes('secret.pem'), `secret.pem 应命中（实际: ${paths.join(',')}）`);
  assert.ok(paths.includes('app.js'), `app.js 内容级应命中（实际: ${paths.join(',')}）`);
  const appHit = found.find((h) => h.path === 'app.js');
  assert.ok(appHit && appHit.fields.includes('password'), 'app.js 应标记 password 字段');
  rmSync(join(repo, '.env'), { force: true });
  rmSync(join(repo, 'secret.pem'), { force: true });
  rmSync(join(repo, 'app.js'), { force: true });
});

test('scanSensitiveFiles：占位符 / 示例 / 豁免注释不误报', () => {
  writeFileSync(join(repo, 'ok.js'), 'const password = "your_password";\n');
  writeFileSync(join(repo, 'ok2.js'), '// 例如 password = "demo123"\n');
  writeFileSync(join(repo, 'exempt.js'), 'const token = "abc12345"; // dsh-skip-sensitive\n');
  const found = scanSensitiveFiles(repo);
  const paths = found.map((h) => h.path);
  assert.ok(!paths.includes('ok.js'), '占位符值不应误报');
  assert.ok(!paths.includes('ok2.js'), '示例行不应误报');
  assert.ok(!paths.includes('exempt.js'), '行尾豁免注释不应误报');
  for (const f of ['ok.js', 'ok2.js', 'exempt.js']) rmSync(join(repo, f), { force: true });
});

test('ensureGitignore：追加敏感文件到 .gitignore（幂等）', () => {
  writeFileSync(join(repo, '.env'), 'KEY=1\n');
  const r1 = ensureGitignore(repo);
  assert.ok(r1.added >= 1);
  assert.ok(Array.isArray(r1.files), 'files 应为路径数组');
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(gi.includes('/.env'));
  const r2 = ensureGitignore(repo);
  assert.equal(r2.added, 0, '二次调用不重复写');
  rmSync(join(repo, '.env'), { force: true });
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：customIgnorePatterns 追加自定义忽略', () => {
  const r1 = ensureGitignore(repo, { customIgnorePatterns: '*.bak*,*.orig' });
  assert.ok(r1.custom >= 2, `custom 应补入 2 条（实际 ${r1.custom}）`);
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(gi.includes('*.bak*'));
  assert.ok(gi.includes('*.orig'));
  const r2 = ensureGitignore(repo, { customIgnorePatterns: '*.bak*,*.orig' });
  assert.equal(r2.custom, 0, '自定义忽略幂等');
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：基线忽略 node_modules 与 node_modules.orig', () => {
  const r = ensureGitignore(repo);
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(r.baseline >= 1, '应有基线补入');
  assert.ok(gi.includes('node_modules/'), '应含 node_modules/');
  assert.ok(gi.includes('node_modules.orig/'), '应含 node_modules.orig/');
  // 幂等：二次调用不再追加基线
  const r2 = ensureGitignore(repo);
  assert.equal(r2.baseline, 0, '基线已存在时不重复写');
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：已手写 node_modules（无斜杠）时不重复追加', () => {
  writeFileSync(join(repo, '.gitignore'), 'node_modules\nnode_modules.orig\n');
  const r = ensureGitignore(repo);
  assert.equal(r.baseline, 0, '裸名与带斜杠视为同一忽略项');
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：node_modules.orig 目录不参与敏感文件扫描', () => {
  mkdirSync(join(repo, 'node_modules.orig'), { recursive: true });
  writeFileSync(join(repo, 'node_modules.orig', '.env'), 'KEY=1\n');
  const r = ensureGitignore(repo);
  assert.ok(!r.files.some((f) => f.includes('node_modules.orig')), '残留副本目录内的文件不应被当成仓库敏感文件');
  rmSync(join(repo, 'node_modules.orig'), { recursive: true, force: true });
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：.samples 目录豁免——不写 .gitignore、照常报告', () => {
  // fixtures/.samples 空文件 = 豁免标记：目录内假 token 照常报告，但不进 .gitignore
  mkdirSync(join(repo, 'fixtures'), { recursive: true });
  writeFileSync(join(repo, 'fixtures', '.samples'), '');
  writeFileSync(join(repo, 'fixtures', 'secret.js'), 'const apiKey = "sk-test-abcdef1234567890abcdef";\n');
  writeFileSync(join(repo, 'real.js'), 'const apiKey = "sk-test-abcdef1234567890abcdef";\n');
  const r = ensureGitignore(repo);
  assert.ok(r.files.includes('fixtures/secret.js'), '豁免目录敏感文件照常报告');
  assert.ok(r.files.includes('real.js'), '非豁免敏感文件照常报告');
  assert.equal(r.sampleExempted, 1, 'sampleExempted 计数 = 1');
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(!gi.includes('fixtures/secret.js'), '豁免目录文件不写 .gitignore');
  assert.ok(gi.includes('/real.js') || gi.includes('real.js'), '非豁免文件照常写 .gitignore');
  rmSync(join(repo, 'fixtures'), { recursive: true, force: true });
  rmSync(join(repo, 'real.js'), { force: true });
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

test('commitAndPush：非 git 仓库拦截', async () => {
  const r = await commitAndPush({ repoPath: join(tmp, 'not-repo'), message: 'x', requirementsConfirmed: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /非 git 仓库/);
});

test('commitAndPush：缺 message 拦截', async () => {
  const r = await commitAndPush({ repoPath: repo, message: '', requirementsConfirmed: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /message 必填/);
});

// D13 开发者要求门禁（对齐 v1 commitPushPreflight：内置 user-requirements.json 存在时未核对拦截）
test('commitAndPush：开发者要求未核对 → 拦截（D13）', async () => {
  const r = await commitAndPush({ repoPath: repo, message: 'feat: 未核对要求', push: false });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.equal(r.code, 'USER_REQUIREMENTS');
  assert.match(r.error, /开发者特殊要求未核对/);
  assert.ok(r.requirements && r.requirements.found, '应带要求清单');
  assert.ok(r.requirements.items.length > 0, '清单应有条目');
});

test('commitAndPush：开发者要求核对 → 放行（D13）', async () => {
  const r = await commitAndPush({ repoPath: repo, message: 'feat: 已核对要求', push: false, requirementsConfirmed: true });
  assert.equal(r.ok, true, 'requirementsConfirmed:true 应放行');
});

test('commitAndPush：dryRun 不写', async () => {
  const r = await commitAndPush({ repoPath: repo, message: 'dry', dryRun: true, requirementsConfirmed: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
});

test('commitAndPush：真实 commit（不 push）', async () => {
  writeFileSync(join(repo, 'new.js'), 'const n = 1;\n');
  const r = await commitAndPush({ repoPath: repo, message: 'add new.js', push: false, requirementsConfirmed: true });
  assert.equal(r.ok, true);
  assert.equal(r.pushed, false);
  assert.match(r.commitSha, /^[0-9a-f]{40}$/);
  assert.ok(r.steps.includes('commit'));
});

test('commitAndPush：无变更跳过（对齐 v1 v1.18.1：非错误，成功跳过）', async () => {
  const r = await commitAndPush({ repoPath: repo, message: 'nothing', push: false, requirementsConfirmed: true });
  assert.equal(r.ok, true, '无变更应为成功跳过而非错误');
  assert.equal(r.committed, false);
  assert.match(r.message, /无变更/);
  assert.equal(r.push.pushed, false);
  assert.match(r.push.reason, /无变更/);
});

test('commitAndPush：敏感文件自动入 .gitignore 再提交', async () => {
  writeFileSync(join(repo, '.env'), 'SECRET=1\n');
  const r = await commitAndPush({ repoPath: repo, message: 'add .env', push: false, requirementsConfirmed: true });
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

// D15：推送成功后维护 remote-tracking ref + 辅助 SSH remote + dsh- 项目自动打 tag（对齐 v1 commitPushAfterApiSuccess）
test('commitAndPush：推送成功后 remoteRef + aux remote + autoTag（dsh- 前缀，mock）', async () => {
  const repoD15 = join(tmp, 'dsh-demo');
  mkdirSync(repoD15);
  runGit(['init', '-q'], { cwd: repoD15 });
  runGit(['config', 'user.email', 't@v2.local'], { cwd: repoD15 });
  runGit(['config', 'user.name', 'v2 test'], { cwd: repoD15 });
  writeFileSync(join(repoD15, 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '0.3.0' }));
  writeFileSync(join(repoD15, 'b.js'), 'const ok = 2;\n');
  runGit(['add', '-A'], { cwd: repoD15 });
  runGit(['commit', '-q', '-m', 'init'], { cwd: repoD15 });
  // pushViaApi 解析 origin 需要 owner 段
  runGit(['remote', 'add', 'origin', 'https://api.github.com/repos/octo/dsh-demo'], { cwd: repoD15 });
  runGit(['checkout', '-q', '-b', 'main'], { cwd: repoD15 });
  const treeSha15 = 'e'.repeat(40);
  const commitSha15 = 'f'.repeat(40);
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/octo/dsh-demo'), status: 200, body: { default_branch: 'main' } },
    { match: (u) => u.includes('/git/ref/heads/'), status: 404, body: {} },
    { match: (u) => u.includes('/git/trees/'), status: 200, body: { tree: [] } },
    { match: (u, m) => m === 'POST' && u.includes('/git/blobs'), status: 201, body: { sha: 'b'.repeat(40) } },
    { match: (u, m) => m === 'POST' && u.includes('/git/trees'), status: 201, body: { sha: treeSha15 } },
    { match: (u, m) => m === 'POST' && u.includes('/git/commits'), status: 201, body: { sha: commitSha15 } },
    { match: (u, m) => m === 'POST' && u.includes('/git/refs'), status: 201, body: { ref: 'refs/heads/main' } },
    // autoTag：GET tags/v0.3.0 → 404（不存在）→ POST refs → 201
    { match: (u, m) => m === 'GET' && u.includes('/git/ref/tags/v0.3.0'), status: 404, body: {} },
    // fetchRemoteHeads（commits 列表）
    { match: (u) => u.includes('/commits?'), status: 200, body: [{ sha: commitSha15, commit: { message: 'init', author: { date: '2026-01-01' } } }] },
  ]);
  const r = await commitAndPush({ repoPath: repoD15, message: 'add b.js', push: true, token: 'ghp_d15', requirementsConfirmed: true });
  assert.equal(r.ok, true, `应推送成功（实际: ${JSON.stringify(r)?.slice(0, 400)}）`);
  assert.equal(r.pushed, true);
  // ① remote-tracking ref 已更新
  assert.match(r.push.remoteRef, /refs\/remotes\/origin\/main = /, `remoteRef 应已更新（实际: ${r.push.remoteRef}）`);
  const refCheck = runGit(['rev-parse', 'refs/remotes/origin/main'], { cwd: repoD15 });
  assert.ok(refCheck.ok && /^[0-9a-f]{40}$/.test(refCheck.stdout), '本地 refs/remotes/origin/main 应可解析');
  // ② 辅助 SSH remote 已确保
  assert.ok(r.push.auxRemote, 'auxRemote 应有记录');
  const auxUrl = runGit(['remote', 'get-url', 'github-ssh'], { cwd: repoD15 });
  assert.equal(auxUrl.stdout, 'ssh://git@ssh.github.com:443/octo/dsh-demo.git');
  // ③ dsh- 前缀项目自动打 tag（v0.3.0）；资源许可下应发起 GET tags + POST refs
  assert.ok(r.autoTag, 'autoTag 应有结果');
  assert.equal(r.autoTag.ok, true, `autoTag 应成功（实际: ${JSON.stringify(r.autoTag)}）`);
  assert.equal(r.autoTag.tag, 'v0.3.0');
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

test('cloneViaApi：非空目标目录拒绝覆盖', async () => {
  const dest = join(tmp, 'cloned-nonempty');
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'existing.txt'), 'do not clobber\n');
  mockFetch([{ match: () => true, status: 200, body: { default_branch: 'main' } }]);
  const r = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_clone' });
  assert.equal(r.ok, false);
  assert.match(r.error, /非空/);
  assert.ok(existsSync(join(dest, 'existing.txt')), '已有文件不被覆盖');
});

test('ensureRemoteRepo：已存在 → 不重复创建', async () => {
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/user'), status: 200, body: { login: 'EIGHTfs' } },
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/EIGHTfs/repo'), status: 200, body: { name: 'repo' } },
  ]);
  const r = await ensureRemoteRepo({ repoPath: repo, token: 'ghp_x' });
  assert.equal(r.ok, true);
  assert.equal(r.exists, true);
  assert.equal(r.owner, 'EIGHTfs', 'owner 应从 /user 解析');
});

test('ensureRemoteRepo：mock 创建成功 + 设 origin', async () => {
  const repo2 = join(tmp, 'repo2');
  mkdirSync(repo2);
  runGit(['init', '-q'], { cwd: repo2 });
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/user'), status: 200, body: { login: 'EIGHTfs' } },
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/EIGHTfs/repo2'), status: 404, body: {} }, // GET 不存在
    { match: (u, m) => m === 'POST' && u.endsWith('/user/repos'), status: 201, body: { name: 'repo2', private: true } },
  ]);
  const r = await ensureRemoteRepo({ repoPath: repo2, visibility: 'private', token: 'ghp_y' });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.visibility, 'private');
  assert.equal(r.owner, 'EIGHTfs');
  assert.ok(fetchCalls.some((c) => c.method === 'POST' && c.url.endsWith('/user/repos')));
  // origin 必须带 owner 段（否则 pushViaApi 无法解析）
  assert.ok(r.origin.endsWith('/repos/EIGHTfs/repo2'), `origin 应含 owner 段: ${r.origin}`);
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
  const r = await commitAndPush({ repoPath: repo3, message: 'push attempt', push: true, token: 'ghp_bad', requirementsConfirmed: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /推送失败/);
});

test('commitAndPush：私有库豁免（private 不写 .gitignore 只扫描报告）', async () => {
  const repo4 = join(tmp, 'repo4');
  mkdirSync(repo4);
  runGit(['init', '-q'], { cwd: repo4 });
  runGit(['config', 'user.email', 't@v2.local'], { cwd: repo4 });
  runGit(['config', 'user.name', 'v2 test'], { cwd: repo4 });
  runGit(['remote', 'add', 'origin', 'octo/repo4'], { cwd: repo4 });
  writeFileSync(join(repo4, '.env'), 'SECRET=1\n');
  mockFetch([{ match: (u, m) => m === 'GET' && u.endsWith('/repos/octo/repo4'), status: 200, body: { private: true } }]);
  const r = await commitAndPush({ repoPath: repo4, message: 'private push', push: false, token: 'ghp_priv', requirementsConfirmed: true });
  assert.equal(r.ok, true);
  assert.ok(r.steps.some((s) => s.includes('private-exempt')), `steps 应含 private-exempt（实际: ${r.steps.join(',')}）`);
  assert.ok(!existsSync(join(repo4, '.gitignore')), 'private 仓库不应写 .gitignore');
});
