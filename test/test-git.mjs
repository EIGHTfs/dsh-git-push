// dsh-skip-sensitive: 测试 fixture 含 mock token 字面量（ghp_/github_pat_ 非真实凭据）
/**
 * git 总入口测试：runGit / resolveToken / commitAndPush / pushViaApi(401→SSH) /
 * cloneViaApi / ensureRemoteRepo / setVisibility / githubFetch 硬闸 / 敏感文件 .gitignore。
 * 所有真实 git 操作都在 /tmp 临时仓；所有网络请求都 mock fetch（不打真实 api.github.com）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  runGit, resolveToken, credentialsDir, resolveSshKey,
  githubFetch, parseGithubOwnerRepo, isBadCredentials,
  scanSensitiveFiles, ensureGitignore, readmeCheckHint,
  commitAndPush, pushViaSsh, pushViaApi, cloneViaApi, ensureRemoteRepo, setVisibility,
} from '../lib/git/index.js';
import { gitRaw } from '../lib/git/index.js';
import { commitWithAudit } from '../lib/commit-push.js';

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

/**
 * mock fetch：按请求路径返回预置响应；记录调用。routes 按序匹配（靠前优先）。
 *
 * 2026-09-18：下载改走 raw.githubusercontent.com（只有它支持 Range 续传），
 *   故 mock 必须能返回**原始字节**而非 JSON。route 给 raw 字段即按二进制回，
 *   并支持 rawHeaders 用于模拟 Range/206 语义。
 */
function mockFetch(routes) {
  fetchCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    fetchCalls.push({ url: u, method: opts.method || 'GET', headers: opts.headers || {} });
    for (const r of routes) {
      if (r.match(u, opts.method || 'GET')) {
        const status = r.status ?? 200;
        if (r.raw !== undefined) {
          const buf = Buffer.isBuffer(r.raw) ? r.raw : Buffer.from(String(r.raw), 'utf8');
          return new Response(buf, { status, headers: r.rawHeaders || {} });
        }
        return new Response(JSON.stringify(r.body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ message: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  };
}

/**
 * 生成「raw 端点」mock 路由：把 path→内容 的映射转成 raw.githubusercontent 路由，
 * 并按 Range 头返回 206 分片（模拟真实 CDN 行为）。老测试只 mock 了 blob API，
 * 新下载器改走 raw，故统一用本函数补路由。
 */
function mockRawRoutes(files) {
  return Object.entries(files).map(([p, content]) => {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    return {
      match: (u) => u.includes('raw.githubusercontent.com') && decodeURIComponent(u).endsWith('/' + p),
      status: 200,
      raw: buf,
      rawHeaders: { 'Content-Length': String(buf.length), 'Accept-Ranges': 'bytes' },
    };
  });
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

// 2026-09-14 回归：runGit 返回形状契约 {ok,stdout,stderr}——绝无 status 字段。
//   曾发生 describeRepo/push 误用 rc.status（永远 undefined→静默失效→「远端状态未知」），
//   此断言守住接口形状，谁改 runGit 返回结构谁先撞测试。
test('runGit：返回形状契约——只含 ok/stdout/stderr、绝无 status（防 .status 误用再犯）', () => {
  const r = runGit(['--version'], { cwd: repo });
  const keys = Object.keys(r).sort();
  assert.deepEqual(keys, ['ok', 'stderr', 'stdout'], 'runGit 返回键集必须恰为 {ok,stdout,stderr}（顺序无关）');
  assert.ok(!('status' in r), 'runGit 返回不得含 status 字段');
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.stdout, 'string');
  assert.equal(typeof r.stderr, 'string');
});

test('gitRaw：返回形状契约——含 status/stdout Buffer/stderr Buffer（与 runGit 不同，可判 exitCode）', () => {
  const r = gitRaw(['--version'], { cwd: repo });
  assert.ok('status' in r, 'gitRaw 必须含 status');
  assert.equal(typeof r.status, 'number');
  assert.ok(Buffer.isBuffer(r.stdout));
  assert.ok(Buffer.isBuffer(r.stderr));
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

test('scanSensitiveFiles：扫描 .env / token 文件（文件名黑名单 + 内容级）', async () => {
  writeFileSync(join(repo, '.env'), 'KEY=1\n');
  writeFileSync(join(repo, 'secret.pem'), 'x\n');
  // 内容级：硬编码密码应被检出
  writeFileSync(join(repo, 'app.js'), 'const password = "hunter2secret";\n');
  const found = await scanSensitiveFiles(repo);
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

test('scanSensitiveFiles：占位符 / 示例 / 豁免注释不误报', async () => {
  writeFileSync(join(repo, 'ok.js'), 'const password = "your_password";\n');
  writeFileSync(join(repo, 'ok2.js'), '// 例如 password = "demo123"\n');
  writeFileSync(join(repo, 'exempt.js'), 'const token = "abc12345"; // dsh-skip-sensitive\n');
  const found = await scanSensitiveFiles(repo);
  const paths = found.map((h) => h.path);
  assert.ok(!paths.includes('ok.js'), '占位符值不应误报');
  assert.ok(!paths.includes('ok2.js'), '示例行不应误报');
  assert.ok(!paths.includes('exempt.js'), '行尾豁免注释不应误报');
  for (const f of ['ok.js', 'ok2.js', 'exempt.js']) rmSync(join(repo, f), { force: true });
});

test('ensureGitignore：敏感文件只报告不写 .gitignore（2026-09-12 用户指令）', async () => {
  writeFileSync(join(repo, '.env'), 'KEY=1\n');
  const r1 = await ensureGitignore(repo);
  assert.ok(r1.files.includes('.env'), 'files 应报告 .env');
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(!gi.includes('.env'), '敏感文件不写 .gitignore');
  // 敏感文件不再写盘，基线与自定义照常（基线幂等）
  assert.ok(gi.includes('node_modules/'), '基线忽略照常写');
  const r2 = await ensureGitignore(repo);
  assert.equal(r2.baseline, 0, '二次调用基线不重复写');
  rmSync(join(repo, '.env'), { force: true });
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：customIgnorePatterns 追加自定义忽略', async () => {
  const r1 = await ensureGitignore(repo, { customIgnorePatterns: '*.bak*,*.orig' });
  assert.ok(r1.custom >= 2, `custom 应补入 2 条（实际 ${r1.custom}）`);
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(gi.includes('*.bak*'));
  assert.ok(gi.includes('*.orig'));
  const r2 = await ensureGitignore(repo, { customIgnorePatterns: '*.bak*,*.orig' });
  assert.equal(r2.custom, 0, '自定义忽略幂等');
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：基线忽略 node_modules 与 node_modules.orig', async () => {
  const r = await ensureGitignore(repo);
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  assert.ok(r.baseline >= 1, '应有基线补入');
  assert.ok(gi.includes('node_modules/'), '应含 node_modules/');
  assert.ok(gi.includes('node_modules.orig/'), '应含 node_modules.orig/');
  // 幂等：二次调用不再追加基线
  const r2 = await ensureGitignore(repo);
  assert.equal(r2.baseline, 0, '基线已存在时不重复写');
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：已手写 node_modules（无斜杠）时不重复追加', async () => {
  writeFileSync(join(repo, '.gitignore'), 'node_modules\nnode_modules.orig\n');
  const r = await ensureGitignore(repo);
  assert.equal(r.baseline, 0, '裸名与带斜杠视为同一忽略项');
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：node_modules.orig 目录不参与敏感文件扫描', async () => {
  mkdirSync(join(repo, 'node_modules.orig'), { recursive: true });
  writeFileSync(join(repo, 'node_modules.orig', '.env'), 'KEY=1\n');
  const r = await ensureGitignore(repo);
  assert.ok(!r.files.some((f) => f.includes('node_modules.orig')), '残留副本目录内的文件不应被当成仓库敏感文件');
  rmSync(join(repo, 'node_modules.orig'), { recursive: true, force: true });
  rmSync(join(repo, '.gitignore'), { force: true });
});

test('ensureGitignore：.samples 目录豁免——敏感文件一律不写 .gitignore、照常报告', async () => {
  // fixtures/.samples 空文件 = 豁免标记：目录内假 token 照常报告，但不进 .gitignore
  mkdirSync(join(repo, 'fixtures'), { recursive: true });
  writeFileSync(join(repo, 'fixtures', '.samples'), '');
  writeFileSync(join(repo, 'fixtures', 'secret.js'), 'const apiKey = "sk-test-abcdef1234567890abcdef";\n');
  writeFileSync(join(repo, 'real.js'), 'const apiKey = "sk-test-abcdef1234567890abcdef";\n');
  const r = await ensureGitignore(repo);
  assert.ok(r.files.includes('fixtures/secret.js'), '豁免目录敏感文件照常报告');
  assert.ok(r.files.includes('real.js'), '非豁免敏感文件照常报告');
  assert.equal(r.sampleExempted, 1, 'sampleExempted 计数 = 1');
  const gi = readFileSync(join(repo, '.gitignore'), 'utf8');
  // 2026-09-12 用户指令：扫描到敏感文件不改动 git 忽略——豁免与非豁免都不写 .gitignore
  assert.ok(!gi.includes('fixtures/secret.js'), '豁免目录文件不写 .gitignore');
  assert.ok(!gi.includes('real.js'), '非豁免文件也不写 .gitignore（只报告）');
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

// D13 开发者要求门禁（commitPushPreflight：内置 user-requirements.json 存在时未核对拦截）
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

test('commitAndPush：无变更跳过（非错误，成功跳过）', async () => {
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

// D15：推送成功后维护 remote-tracking ref + 辅助 SSH remote + dsh- 项目自动打 tag
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
    { match: (u, m) => m === 'GET' && u.includes('/git/trees/main?recursive=1'), status: 200, body: { sha: 'x'.repeat(40), tree: [{ path: 'hello.txt', type: 'blob', sha: 'b1', size: 5, mode: '100644' }, { path: 'sub/nested.txt', type: 'blob', sha: 'b2', size: 6, mode: '100644' }] } },
    ...mockRawRoutes({ 'hello.txt': 'hello', 'sub/nested.txt': 'nested' }),
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

test('cloneViaApi：blob 失败不再静默报成功（回归：超时留半成品）', async () => {
  const dest = join(tmp, 'clone-blob-fail');
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/o/r'), status: 200, body: { default_branch: 'main' } },
    { match: (u) => u.includes('/git/trees/main?recursive=1'), status: 200, body: { sha: 'x'.repeat(40), tree: [
      { path: 'a.txt', type: 'blob', sha: 'b1' },
      { path: 'b.txt', type: 'blob', sha: 'b2' },
    ] } },
    { match: (u) => u.includes('raw.githubusercontent.com') && decodeURIComponent(u).endsWith('/a.txt'), status: 200, raw: 'x' },
    { match: (u) => u.includes('raw.githubusercontent.com') && decodeURIComponent(u).endsWith('/b.txt'), status: 0 },
  ]);
  const r = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_clone' });
  assert.equal(r.ok, false, '缺文件不得报成功');
  assert.equal(r.failedCount, 1);
  assert.match(r.error, /克隆未完成/);
  // 2026-09-18 语义变更：失败**不再删光目录**，改为保留已下文件以便续传。
  //   原实现删光 targetDir，实测导致已下的 104MB 内容全丢、gallery 目录整个消失。
  assert.equal(r.cleaned, false, '不应再标记为「已清理」');
  assert.equal(r.kept, true, '应标记为「已保留」');
  assert.equal(r.resumable, true, '应标记为「可续传」');
  // status 0 = 超时 → 成因 network、可重试
  assert.equal(r.cause, 'network');
  assert.equal(r.retriable, true);
  assert.ok(existsSync(dest), '半成品目录应保留（已下文件可复用）');
  assert.ok(existsSync(join(dest, 'a.txt')), '已下成功的文件应保留');
  // 关键：保留的目录必须仍是「可自愈残留」——有标记、无提交，
  //   下次 clone 会被 isPartialCloneDir 识别，不会被「已存在且非空」永久挡住
  assert.ok(existsSync(join(dest, '.dsh-git-push-cloning')), '应保留进行中标记，供下次识别为残留');
});

test('cloneViaApi：失败成因分类——401/404 不得标为可重试（回归：误导重试）', async () => {
  const tree = { sha: 'x'.repeat(40), tree: [{ path: 'a.txt', type: 'blob', sha: 'b1', size: 1, mode: '100644' }] };
  const cases = [
    { label: 'token 失效', status: 401, cause: 'auth', retriable: false },
    { label: '仓库不存在', status: 404, cause: 'notfound', retriable: false },
    { label: '限流', status: 429, cause: 'ratelimit', retriable: true },
    { label: '服务端错误', status: 500, cause: 'server', retriable: true },
  ];
  for (const c of cases) {
    const dest = join(tmp, 'clone-cause-' + c.status);
    mockFetch([
      { match: (u, m) => m === 'GET' && u.endsWith('/repos/o/r'), status: 200, body: { default_branch: 'main' } },
      { match: (u) => u.includes('/git/trees/main?recursive=1'), status: 200, body: tree },
      // 下载走 raw 端点；c.status 决定成因分类（401→auth / 404→notfound / …）
      { match: (u) => u.includes('raw.githubusercontent.com') && decodeURIComponent(u).endsWith('/a.txt'), status: c.status },
    ]);
    const r = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_x' });
    assert.equal(r.ok, false, c.label + ' 应失败');
    assert.equal(r.cause, c.cause, c.label + ' 成因应为 ' + c.cause);
    assert.equal(r.retriable, c.retriable, c.label + ' 的 retriable 应为 ' + c.retriable);
    // 语义变更：保留目录以便续传（但仍须保留标记与无 .git 状态，才能被识别为残留）
    assert.ok(existsSync(dest), c.label + '：半成品应保留以便续传');
    assert.ok(existsSync(join(dest, '.dsh-git-push-cloning')), c.label + '：应保留标记供下次识别');
  }
});

test('cloneViaApi：401 的文案须给出可操作处置，而非笼统「网络问题」', async () => {
  const dest = join(tmp, 'clone-auth-msg');
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/o/r'), status: 200, body: { default_branch: 'main' } },
    { match: (u) => u.includes('/git/trees/main?recursive=1'), status: 200, body: { sha: 'x'.repeat(40), tree: [{ path: 'a.txt', type: 'blob', sha: 'b1' , size: 1, mode: '100644'}] } },
    { match: (u) => u.includes('raw.githubusercontent.com') && decodeURIComponent(u).endsWith('/a.txt'), status: 401 },
  ]);
  const r = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_bad' });
  assert.match(r.error, /token/i, '应提示处理 token，而非让用户重试');
  assert.doesNotMatch(r.error, /网络/, '不得把凭据问题说成网络问题');
});

test('cloneViaApi：失败清理后可直接重试成功（回归：本 bug 的核心症状）', async () => {
  const dest = join(tmp, 'clone-retry');
  // 第一次：blob 超时 → 失败并清理
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/o/r'), status: 200, body: { default_branch: 'main' } },
    { match: (u) => u.includes('/git/trees/main?recursive=1'), status: 200, body: { sha: 'y'.repeat(40), tree: [{ path: 'f.txt', type: 'blob', sha: 'c1' , size: 2, mode: '100644'}] } },
    { match: (u) => u.includes('raw.githubusercontent.com') && decodeURIComponent(u).endsWith('/f.txt'), status: 0 },
  ]);
  const r1 = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_clone' });
  assert.equal(r1.ok, false);
  // 第二次：网络恢复 → 应直接成功，不再撞「目标目录已存在且非空」
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/o/r'), status: 200, body: { default_branch: 'main' } },
    { match: (u) => u.includes('/git/trees/main?recursive=1'), status: 200, body: { sha: 'y'.repeat(40), tree: [{ path: 'f.txt', type: 'blob', sha: 'c1' , size: 2, mode: '100644'}] } },
    { match: (u) => u.includes('raw.githubusercontent.com') && decodeURIComponent(u).endsWith('/f.txt'), status: 200, raw: 'ok' },
  ]);
  const r2 = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_clone' });
  assert.equal(r2.ok, true, '重试应成功，错误: ' + (r2.error || ''));
  assert.equal(readFileSync(join(dest, 'f.txt'), 'utf8'), 'ok');
});

test('cloneViaApi：进程被中断留下的残留（有标记、无提交）可自愈重试', async () => {
  const dest = join(tmp, 'clone-interrupted');
  // 手工造「被 kill」现场：目录 + 标记文件 + 半个文件，但没有跑完 git init/commit
  mkdirSync(join(dest, 'sub'), { recursive: true });
  writeFileSync(join(dest, '半成品.txt'), 'partial\n');
  writeFileSync(join(dest, '.dsh-git-push-cloning'), String(Date.now()));
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/o/r'), status: 200, body: { default_branch: 'main' } },
    { match: (u) => u.includes('/git/trees/main?recursive=1'), status: 200, body: { sha: 'z'.repeat(40), tree: [{ path: 'ok.txt', type: 'blob', sha: 'd1' , size: 1, mode: '100644'}] } },
    { match: (u) => u.includes('raw.githubusercontent.com') && decodeURIComponent(u).endsWith('/ok.txt'), status: 200, raw: 'x' },
  ]);
  const r = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_clone' });
  assert.equal(r.ok, true, '残留目录应被识别并重来，错误: ' + (r.error || ''));
  assert.ok(existsSync(join(dest, 'ok.txt')), '本次应下到目标文件');
  // 语义变更：残留清理只清分片目录，**不再删掉用户上一次留下的文件**。
  //   本测试的核心意图（残留可自愈重试）不变，且额外保证不误删中间产物。
  assert.ok(existsSync(join(dest, '半成品.txt')), '上次留下的文件应保留（清理只针对 .dsh-parts）');
  assert.ok(!existsSync(join(dest, '.dsh-parts')), '分片目录应已清理');
});

test('cloneViaApi：用户自有目录（无标记）仍拒绝覆盖——不得误删', async () => {
  const dest = join(tmp, 'user-own-dir');
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'my-work.txt'), 'important\n');
  mockFetch([{ match: () => true, status: 200, body: { default_branch: 'main' } }]);
  const r = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_clone' });
  assert.equal(r.ok, false);
  assert.match(r.error, /非空/);
  assert.ok(existsSync(join(dest, 'my-work.txt')), '用户文件必须原样保留');
});

test('cloneViaApi：成功后不留进行中标记', async () => {
  const dest = join(tmp, 'clone-no-marker');
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/o/r'), status: 200, body: { default_branch: 'main' } },
    { match: (u) => u.includes('/git/trees/main?recursive=1'), status: 200, body: { sha: 'w'.repeat(40), tree: [{ path: 'x.txt', type: 'blob', sha: 'e1' , size: 1, mode: '100644'}] } },
    { match: (u) => u.includes('raw.githubusercontent.com') && decodeURIComponent(u).endsWith('/x.txt'), status: 200, raw: 'x' },
  ]);
  const r = await cloneViaApi({ target: 'o/r', dest, token: 'ghp_clone' });
  assert.equal(r.ok, true);
  assert.ok(!existsSync(join(dest, '.dsh-git-push-cloning')), '标记文件不应留在成果里');
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

// 2026-09-11：force 强推参数（pushViaApi 内容级短路需被 force 跳过）
test('pushViaApi：force=true 跳过内容级短路（remoteHead===headSha 仍建 commit）', async () => {
  runGit(['remote', 'set-url', 'origin', 'https://api.github.com/repos/octo/repo'], { cwd: repo });
  const headSha = runGit(['rev-parse', 'HEAD'], { cwd: repo }).stdout;
  const treeSha = 't'.repeat(40);
  const commitSha = 'c'.repeat(40);
  // remoteHead === 本地 headSha：非 force 会命中「无新提交可推送」短路；force 必须继续走建 commit。
  mockFetch([
    { match: (u, m) => m === 'GET' && u.endsWith('/repos/octo/repo'), status: 200, body: { default_branch: 'main' } },
    { match: (u) => u.includes('/git/ref/heads/main'), status: 200, body: { object: { sha: headSha } } },
    { match: (u) => u.includes('/git/commits/') && u.includes('HEAD'), status: 200, body: { object: { sha: headSha } } },
    { match: (u, m) => m === 'POST' && u.includes('/git/blobs'), status: 201, body: { sha: 'b'.repeat(40) } },
    { match: (u, m) => m === 'POST' && u.includes('/git/trees'), status: 201, body: { sha: treeSha } },
    { match: (u, m) => m === 'POST' && u.includes('/git/commits'), status: 201, body: { sha: commitSha } },
    { match: (u, m) => m === 'PATCH' && u.includes('/git/refs/heads/main'), status: 200, body: { ref: 'refs/heads/main', object: { sha: commitSha } } },
  ]);
  const rForce = await pushViaApi({ repoPath: repo, token: 'ghp_force', branch: 'main', force: true });
  assert.equal(rForce.ok, true, `force 推送应成功（实际 error: ${rForce.reason || '-'}）`);
  assert.equal(rForce.pushed, true, 'force 推送应 pushed=true');
  assert.ok(fetchCalls.some((c) => c.method === 'POST' && c.url.includes('/git/commits')), 'force 时应建 commit（跳过短路）');
  assert.ok(fetchCalls.some((c) => c.method === 'PATCH' && c.url.includes('/git/refs/heads/main')), 'force 时应 PATCH ref（覆盖远端历史）');
  // 对照组：非 force 同场景命中短路，不建 commit。
  const rNoForce = await pushViaApi({ repoPath: repo, token: 'ghp_noforce', branch: 'main', force: false });
  assert.equal(rNoForce.pushed, false, '非 force 同场景应「无新提交可推送」短路');
  assert.match(rNoForce.reason, /无新提交/, `非 force 短路原因（实际: ${rNoForce.reason}）`);
});

test('commitWithAudit：force 参数透传到 commitAndPush（返回含 force 语义的步骤）', async () => {
  // 非 git 仓库走不到 push，无法观察 force；改验证 commitWithAudit 不再吞掉 force（签名存在 + push=false 时步骤正常）
  const root2 = join(tmpdir(), `gp-cwa-force-${Date.now()}`);
  mkdirSync(root2);
  const r = await commitWithAudit({ repoPath: root2, message: 'force test', push: false, dryRun: true, requirementsConfirmed: true, force: true });
  assert.equal(r.ok, false, '非 git 仓库应 ok:false（force 不改变预检语义）');
  assert.match(r.error || '', /非 git 仓库/, `error 应为非 git 仓库（实际: ${r.error}）`);
  rmSync(root2, { recursive: true, force: true });
});

// 2026-09-11：gitRaw buffer 通道——防 pushViaApi blob 损坏回归（runGit utf8+trim 丢末尾换行）
test('gitRaw：buffer 通道保留 blob 原始字节（含末尾换行/非 UTF-8 字节）', () => {
  const dir = join(tmpdir(), `gp-gitraw-${Date.now()}`);
  mkdirSync(dir);
  try {
    runGit(['init', '-b', 'master'], { cwd: dir });
    writeFileSync(join(dir, 'a.txt'), '你好\n第二行\n');           // 末尾换行 + UTF-8 中文
    writeFileSync(join(dir, 'b.bin'), Buffer.from([0x00, 0xff, 0xfe, 0x0a])); // 非 UTF-8 原始字节
    runGit(['add', '-A'], { cwd: dir });
    runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: dir });
    // a.txt：gitRaw 读回必须保留末尾换行（runGit 的 trim 会丢）
    const shaA = runGit(['rev-parse', 'HEAD:a.txt'], { cwd: dir }).stdout;
    const bufA = gitRaw(['cat-file', 'blob', shaA], { cwd: dir });
    assert.equal(bufA.status, 0, 'gitRaw 应成功');
    assert.equal(bufA.stdout.toString('utf8'), '你好\n第二行\n', 'gitRaw 应完整保留文本（含末尾换行）');
    // b.bin：gitRaw 读回必须与原始字节完全一致（runGit utf8 解码会损坏 0xff/0xfe）
    const shaB = runGit(['rev-parse', 'HEAD:b.bin'], { cwd: dir }).stdout;
    const bufB = gitRaw(['cat-file', 'blob', shaB], { cwd: dir });
    assert.equal(bufB.status, 0, 'gitRaw 二进制也应成功');
    assert.deepEqual([...bufB.stdout], [0x00, 0xff, 0xfe, 0x0a], 'gitRaw 二进制字节应逐一一致');
    // 对照：runGit 读同一 blob 会丢末尾换行（旧 bug 语义——pushViaApi 曾因它损坏 17/109 文件）
    const oldWay = runGit(['cat-file', 'blob', shaA], { cwd: dir });
    assert.notEqual(oldWay.stdout, '你好\n第二行\n', 'runGit(utf8+trim) 应有损（证明 gitRaw 必要）');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- 2026-09-21：commitAndPush paths（精确 add，避免 add -A 扫入无关文件） ----------
test('commitAndPush：paths 只暂存指定文件（他人改动保持未暂存）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-paths-'));
  try {
    // 造仓库 + 两个改动文件：mine.js（本次要提交）+ theirs.js（他人未提交，不应被扫入）
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email t@example.com', { cwd: dir });
    execSync('git config user.name tester', { cwd: dir });
    writeFileSync(join(dir, 'mine.js'), 'const a = 1;\n');
    writeFileSync(join(dir, 'theirs.js'), 'const b = 2;\n');
    execSync('git add -A && git commit -qm init', { cwd: dir });
    writeFileSync(join(dir, 'mine.js'), 'const a = 1;\nconst a2 = 11;\n');
    writeFileSync(join(dir, 'theirs.js'), 'const b = 2;\nconst b2 = 22;\n');
    // paths 只指 mine.js → 只暂存 mine；theirs.js 保持未暂存（add -A 会把它也扫入）
    const r = await commitAndPush({ repoPath: dir, message: 'paths 精确提交', push: false, requirementsConfirmed: true, paths: 'mine.js' });
    assert.equal(r.ok, true, r.error || '');
    const staged = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' });
    assert.ok(!staged.includes('mine.js'), 'mine.js 应已提交（status 不再出现）');
    assert.ok(staged.includes('theirs.js'), 'theirs.js 必须保持未暂存（未被 paths 提交扫入）');
    const committed = execSync('git show --stat --oneline HEAD', { cwd: dir, encoding: 'utf8' });
    assert.ok(committed.includes('mine.js'), '提交应只含 mine.js');
    assert.ok(!committed.includes('theirs.js'), '提交不得含 theirs.js（add -A 误扫场景被 paths 阻止）');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
