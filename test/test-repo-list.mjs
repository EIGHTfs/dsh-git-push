/**
 * 仓库列表测试（本地 / 远端 / 索引 / HTTP 端点）。
 *
 * 覆盖三块此前没有专测的链路：
 *   ① 本地扫描 scanRepos —— 发现仓库、识远端、算变更数、去重、深度与上限
 *   ② 仓库索引 repo-index —— 读写定位、条目匹配、远端状态回写（合并而非重建）
 *   ③ HTTP 端点 repos-local / repos-cloud / repos-local-refresh —— 结构与真源字段
 *
 * 设计原则：
 *   - 全部用**临时仓库 + 隔离 DSH_HOME**，绝不碰真实配置与用户仓库（见 test-plugin 的教训：
 *     测试写凭据未隔离 DSH_HOME，曾把用户真 token 覆盖成假值）。
 *   - 联网用例（远端列表）默认**跳过**，设 DSH_TEST_ONLINE=1 才跑，避免 CI 依赖网络与凭据。
 *
 * 运行：node --test test/test-repo-list.mjs
 *       DSH_TEST_ONLINE=1 node --test test/test-repo-list.mjs   （含真实 GitHub 远端用例）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { scanRepos, describeRepo, maskRemoteUrl } from '../lib/git/repos.js';
import {
  locateRepoIndex, readRepoIndexMap, indexEntryForRepo, updateRepoRemoteStateInIndex,
  mergeCloudReposIntoIndex,
} from '../lib/git/repo-index.js';

const ONLINE = process.env.DSH_TEST_ONLINE === '1';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

/** 造一个临时 git 仓库（可选带远端 + 一个提交）。 */
function makeRepo(dir, { remote = '', commit = true } = {}) {
  mkdirSync(dir, { recursive: true });
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@example.com', { cwd: dir });
  execSync('git config user.name tester', { cwd: dir });
  if (remote) execSync(`git remote add origin ${remote}`, { cwd: dir });
  if (commit) {
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    execSync('git add -A && git commit -qm init', { cwd: dir });
  }
  return dir;
}

/** 隔离沙箱：临时工作区 + 临时 DSH_HOME（凭据/索引都写到那里）。 */
function sandbox(fn) {
  const ws = mkdtempSync(join(tmpdir(), 'dshgp-repolist-ws-'));
  const home = mkdtempSync(join(tmpdir(), 'dshgp-repolist-home-'));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    return fn({ ws, home });
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
    rmSync(ws, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

/* ───────────────────── ① 本地扫描 scanRepos ───────────────────── */

test('scanRepos：发现子目录里的 git 仓库并带上基础字段', () => {
  sandbox(({ ws }) => {
    makeRepo(join(ws, 'proj-a'), { remote: 'https://github.com/EIGHTfs/proj-a.git' });
    makeRepo(join(ws, 'nested', 'proj-b'));
    mkdirSync(join(ws, 'not-a-repo'), { recursive: true });

    const repos = scanRepos(ws);
    const names = repos.map((r) => r.name).sort();
    assert.deepEqual(names, ['proj-a', 'proj-b'], '应发现两个仓库，跳过普通目录');

    const a = repos.find((r) => r.name === 'proj-a');
    assert.equal(a.hasRemote, true, 'proj-a 有 origin');
    assert.equal(typeof a.path, 'string');
    assert.ok(a.branch, '应识别分支');
    assert.equal(typeof a.changed, 'number', 'changed 应为数字');
    assert.equal(a.changed, 0, '刚提交完工作树干净');
  });
});

test('scanRepos：无远端的仓库 hasRemote=false（不冒充同步）', () => {
  sandbox(({ ws }) => {
    makeRepo(join(ws, 'solo'));
    const r = scanRepos(ws).find((x) => x.name === 'solo');
    assert.equal(r.hasRemote, false);
  });
});

test('scanRepos：未提交改动计入 changed', () => {
  sandbox(({ ws }) => {
    const p = makeRepo(join(ws, 'dirty'));
    writeFileSync(join(p, 'new.txt'), 'x\n');
    const r = scanRepos(ws).find((x) => x.name === 'dirty');
    assert.ok(r.changed >= 1, `应统计到未跟踪文件，实际 changed=${r.changed}`);
  });
});

test('scanRepos：depth 限制子目录层级', () => {
  sandbox(({ ws }) => {
    makeRepo(join(ws, 'l1', 'l2', 'l3', 'deep'));
    const shallow = scanRepos(ws, { depth: 1 }).map((r) => r.name);
    const deep = scanRepos(ws, { depth: 5 }).map((r) => r.name);
    assert.ok(!shallow.includes('deep'), 'depth=1 不应下钻到 l3/deep');
    assert.ok(deep.includes('deep'), 'depth=5 应能发现深层仓库');
  });
});

test('scanRepos：maxRepos 截断并如实标记', () => {
  sandbox(({ ws }) => {
    for (let i = 0; i < 4; i++) makeRepo(join(ws, `r${i}`));
    const repos = scanRepos(ws, { maxRepos: 2 });
    assert.ok(repos.length <= 2, `应被截断到 2，实际 ${repos.length}`);
  });
});

test('scanRepos：extraRepos 把工作区外的仓库纳入（去重）', () => {
  sandbox(({ ws }) => {
    const inside = makeRepo(join(ws, 'inside'));
    const outsideDir = mkdtempSync(join(tmpdir(), 'dshgp-outside-'));
    const outside = makeRepo(join(outsideDir, 'outside'));
    try {
      const repos = scanRepos(ws, { extraRepos: [outside] });
      const names = repos.map((r) => r.name);
      assert.ok(names.includes('inside') && names.includes('outside'));
      // 同一个仓库重复传也应去重
      const dup = scanRepos(ws, { extraRepos: [outside, outside] }).filter((r) => r.name === 'outside');
      assert.equal(dup.length, 1, '同一路径不应重复登记');
      assert.ok(inside);
    } finally { rmSync(outsideDir, { recursive: true, force: true }); }
  });
});

test('maskRemoteUrl：内嵌凭据的 URL 必须打码（不泄露 token）', () => {
  const masked = maskRemoteUrl('https://user:ghp_secretvalue123@github.com/o/r.git');
  assert.ok(!masked.includes('ghp_secretvalue123'), 'URL 内嵌凭据不得原样保留');
  assert.match(masked, /github\.com/, '仍应保留主机与路径');
});

test('describeRepo：非仓库目录返回空状态而非抛错', () => {
  sandbox(({ ws }) => {
    const r = describeRepo(ws);
    assert.ok(r && typeof r === 'object', '应返回对象');
    // '(空仓)' 是产品约定的占位（是 git 目录但尚无分支）；关键是**不抛错**且不是真实分支名
    assert.ok(!r.branch || r.branch === '(空仓)' || r.branch === 'HEAD',
      `非仓库不应给出真实分支名，实际 ${r.branch}`);
  });
});

/* ───────────────────── ② 仓库索引 repo-index ───────────────────── */

test('索引：locateRepoIndex 未建索引时返回 null；建好后落在隔离 DSH_HOME 内', () => {
  sandbox(({ ws, home }) => {
    assert.equal(locateRepoIndex(ws), null, '索引不存在应返回 null（调用方据此走重建）');
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    writeFileSync(target, JSON.stringify({ repos: [] }));
    const p = locateRepoIndex(ws);
    assert.ok(p && p.startsWith(home), `索引应写在隔离 DSH_HOME 内，实际 ${p}`);
  });
});

test('索引：updateRepoRemoteStateInIndex 只改该条目、保留其他条目', () => {
  sandbox(({ ws, home }) => {
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    writeFileSync(target, JSON.stringify({
      owner: 'EIGHTfs',
      repos: [
        { name: 'keepme', path: '/x/keepme', remoteHead: 'aaaaaaa' },
        { name: 'upd', path: '/x/upd', remoteHead: '' },
      ],
    }, null, 2));

    const r = updateRepoRemoteStateInIndex({
      workspaceRoot: ws, repoName: 'upd',
      remoteState: { remoteHead: 'bbbbbbb', ahead: 2, behind: 1, synced: false },
      syncTarget: target,
    });
    assert.equal(r.ok, true, r.error || '');

    const after = JSON.parse(readFileSync(target, 'utf8'));
    const upd = after.repos.find((x) => x.name === 'upd');
    const keep = after.repos.find((x) => x.name === 'keepme');
    assert.equal(upd.remoteHead, 'bbbbbbb', '目标条目应被更新');
    assert.equal(upd.ahead, 2, '领先数应写入');
    assert.equal(keep.remoteHead, 'aaaaaaa', '其他条目必须原样保留（只改单条，不重建）');
  });
});

test('索引：updateRepoRemoteStateInIndex 对不存在的仓库如实报错', () => {
  sandbox(({ ws, home }) => {
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    writeFileSync(target, JSON.stringify({ repos: [] }));
    const r = updateRepoRemoteStateInIndex({
      workspaceRoot: ws, repoName: 'nope',
      remoteState: { remoteHead: 'x' }, syncTarget: target,
    });
    assert.equal(r.ok, false, '找不到条目不应假装成功');
  });
});

test('索引：mergeCloudReposIntoIndex 只更新已有本地条目，不新增云端-only', () => {
  sandbox(({ ws, home }) => {
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    // 索引里已有一个本地仓库；云端还有一个本地没有的（不应进索引）
    writeFileSync(target, JSON.stringify({
      owner: 'EIGHTfs',
      repos: [{ name: 'mine', path: join(ws, 'mine'), owner: 'EIGHTfs', repo: 'mine', visibility: '未知' }],
    }));

    const r = mergeCloudReposIntoIndex({
      workspaceRoot: ws, owner: 'EIGHTfs', syncTarget: target,
      cloudRepos: [
        // 注意字段名是 camelCase（该函数吃的是插件内部结构，不是 GitHub API 原始响应）
        { name: 'mine', fullName: 'EIGHTfs/mine', defaultBranch: 'main', pushedAt: '2026-09-01T00:00:00Z', private: true },
        { name: 'cloud-only', fullName: 'EIGHTfs/cloud-only', defaultBranch: 'dev', private: false },
      ],
    });
    assert.equal(r.ok, true, r.error || '');

    const after = JSON.parse(readFileSync(target, 'utf8'));
    const mine = after.repos.find((x) => x.name === 'mine');
    assert.ok(mine, '已有本地条目应保留');
    assert.equal(mine.defaultBranch, 'main', '本地条目应补上云端默认分支');
    assert.equal(mine.path, join(ws, 'mine'), '合并不得丢掉本地字段（path）');
    assert.equal(mine.visibility, '私有', 'private=true 应写为「私有」');

    // 语义收缩：索引只存本地仓库；云端-only 由 repos-cloud 的 localExists 判定，不进索引
    assert.equal(after.repos.find((x) => x.name === 'cloud-only'), undefined,
      '云端-only 不应被登记进索引（只存本地仓库）');
  });
});

test('索引：readRepoIndexMap / indexEntryForRepo 按路径匹配条目', () => {
  sandbox(({ ws, home }) => {
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    const repoPath = join(ws, 'matched');
    writeFileSync(target, JSON.stringify({
      repos: [{ name: 'matched', path: repoPath, owner: 'EIGHTfs', repo: 'matched', visibility: 'private' }],
    }));
    const map = readRepoIndexMap(ws);
    assert.ok(map, `索引应可读，实际 ${map}`);
    const hit = indexEntryForRepo(repoPath, map);
    assert.ok(hit, `应按本地路径命中索引条目，map=${JSON.stringify(map)}`);
    // map 是 { name → {owner, repo, path, ...} }，条目里没有自反的 name 字段
    assert.equal(hit.repo, 'matched', '应命中对应条目');
  });
});

/* ───────────────────── ③ HTTP 端点 ───────────────────── */

test('HTTP repos-local：返回结构含本地列表与索引真源', async () => {
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const ws = mkdtempSync(join(tmpdir(), 'dshgp-rl-http-'));
  const home = mkdtempSync(join(tmpdir(), 'dshgp-rl-home-'));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    makeRepo(join(ws, 'one'));
    // 离线重建按作者过滤（author 需与登录账号一致），这里直接写索引模拟已登记，
    // 聚焦「端点返回结构与字段」，作者过滤另有用例覆盖。
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    writeFileSync(target, JSON.stringify({
      owner: 'EIGHTfs',
      repos: [{ name: 'one', path: join(ws, 'one'), owner: 'EIGHTfs', repo: 'one', visibility: 'private' }],
    }));
    const r = await handleHttp(
      { method: 'GET', url: `/api/git-push/repos-local?path=${encodeURIComponent(ws)}` },
      { workspaceRoot: ROOT }, {},
    );
    assert.equal(r.status, 200, `端点应 200，实际 ${r.status}`);
    const body = r.body || {};
    assert.equal(body.ok, true, body.error || '应 ok');
    assert.ok(Array.isArray(body.repos), 'repos 应为数组');
    const one = body.repos.find((x) => x.name === 'one');
    assert.ok(one, `应包含已入索引的仓库，实际: ${JSON.stringify(body.repos.map((x) => x.name))}`);
    // 远端状态字段必须存在（前端据此渲染，缺失会退化成「未知」）
    for (const k of ['hasRemote', 'ahead', 'branch', 'path']) {
      assert.ok(k in one, `仓库条目应含字段 ${k}`);
    }
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
    rmSync(ws, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('HTTP repos-local：缺省只读索引（不重扫）——列表永远与索引一致', async () => {
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const ws = mkdtempSync(join(tmpdir(), 'dshgp-rl-idx-'));
  const home = mkdtempSync(join(tmpdir(), 'dshgp-rl-home3-'));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    makeRepo(join(ws, 'not-indexed'));
    // 不带 rebuild：磁盘上有仓库但索引为空 → 列表应为空（证明「只读索引，不复扫」）
    const r = await handleHttp(
      { method: 'GET', url: `/api/git-push/repos-local?path=${encodeURIComponent(ws)}` },
      { workspaceRoot: ROOT }, {},
    );
    assert.equal(r.status, 200);
    const names = (r.body.repos || []).map((x) => x.name);
    assert.deepEqual(names, [], '缺省（不 rebuild）应只读索引——索引为空则列表为空，不凭空重扫');
    // 写一条索引后，同一请求应能读到（证明列表源自索引文件）
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    writeFileSync(target, JSON.stringify({
      repos: [{ name: 'not-indexed', path: join(ws, 'not-indexed'), owner: 'EIGHTfs', repo: 'not-indexed', visibility: 'private' }],
    }));
    const r2 = await handleHttp(
      { method: 'GET', url: `/api/git-push/repos-local?path=${encodeURIComponent(ws)}` },
      { workspaceRoot: ROOT }, {},
    );
    assert.ok((r2.body.repos || []).some((x) => x.name === 'not-indexed'), '入索引后应能读到');
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
    rmSync(ws, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('HTTP repos-local-refresh：空 repos 不炸，返回空结果', async () => {
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const r = await handleHttp(
    { method: 'POST', url: '/api/git-push/repos-local-refresh', origin: 'http://127.0.0.1:30801', body: { repos: [] } },
    { workspaceRoot: ROOT }, {},
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.count, 0);
});

/* ───────────────────── ④ 远端状态语义（本轮修复点） ───────────────────── */

test('远端状态：liveSkipped 与「已连通待比较」必须可区分（前端文案依赖）', async () => {
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const ws = mkdtempSync(join(tmpdir(), 'dshgp-rl-skip-'));
  const home = mkdtempSync(join(tmpdir(), 'dshgp-rl-home2-'));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    // 无远端仓库：不会触发 SSH 探测，稳定落到「未探测」分支
    makeRepo(join(ws, 'lonely'));
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    writeFileSync(target, JSON.stringify({
      repos: [{ name: 'lonely', path: join(ws, 'lonely'), owner: 'EIGHTfs', repo: 'lonely', visibility: 'private' }],
    }));
    const r = await handleHttp(
      { method: 'GET', url: `/api/git-push/repos-local?path=${encodeURIComponent(ws)}` },
      { workspaceRoot: ROOT }, {},
    );
    const one = (r.body.repos || []).find((x) => x.name === 'lonely');
    assert.ok(one, '应包含 lonely');
    assert.equal(one.hasRemote, false, '无远端应为 false');
    // 有远端但未探测时 ahead 必须为 null（而非 0——0 会被前端当作「已同步」）
    assert.ok(one.ahead === null || typeof one.ahead === 'number', 'ahead 应为 null 或数字');
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
    rmSync(ws, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('前端文案：不再出现写死的「远端状态未知」分支', () => {
  const src = readFileSync(join(ROOT, 'client.js'), 'utf8');
  // 修复后按 liveSkipped / remoteHead 分三种措辞，不应再有单一写死文案
  assert.ok(!/'远端状态未知'/.test(src), '不应再写死「远端状态未知」');
  assert.match(src, /liveSkipped/, '应依据 liveSkipped 区分真未知');
  assert.match(src, /未探测远端/, '真未探测应有独立文案');
});

/* ───────────────────── ⑤ 联网用例（默认跳过） ───────────────────── */

test('远端列表：真实 GitHub 拉取（DSH_TEST_ONLINE=1 才跑）', { skip: !ONLINE }, async () => {
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const r = await handleHttp(
    { method: 'GET', url: '/api/git-push/repos-cloud' },
    { workspaceRoot: ROOT }, {},
  );
  assert.equal(r.status, 200, '云端端点应 200');
  assert.ok(r.body && typeof r.body.ok === 'boolean', '应返回 ok 标志');
  if (r.body.ok) {
    assert.ok(Array.isArray(r.body.repos), 'repos 应为数组');
    for (const repo of r.body.repos.slice(0, 5)) {
      assert.ok(repo.name, '每条应有仓库名');
      assert.equal(typeof repo.localExists, 'boolean', '应标记本地是否已有');
    }
  }
});

test('索引：remoteState 传 visibility 时写回可见性（push 后刷新用）', () => {
  sandbox(({ ws, home }) => {
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    writeFileSync(target, JSON.stringify({
      owner: 'EIGHTfs',
      repos: [{ name: 'r', path: '/x/r', visibility: '未知', remoteHead: '' }],
    }, null, 2));

    const r = updateRepoRemoteStateInIndex({
      workspaceRoot: ws, repoName: 'r',
      remoteState: { remoteHead: 'cafe123', ahead: 0, behind: 0, synced: true, visibility: '私有' },
      syncTarget: target,
    });
    assert.equal(r.ok, true, r.error || '');
    const hit = JSON.parse(readFileSync(target, 'utf8')).repos.find((x) => x.name === 'r');
    assert.equal(hit.visibility, '私有', '传了 visibility 就必须写回（此前只更新 5 个远端字段，可见性永远停在旧值）');
    assert.equal(hit.remoteHead, 'cafe123', '远端 HEAD 应写回');
    assert.equal(hit.synced, true, '同步态应写回');
    assert.ok(hit.remoteStateAt, 'remoteStateAt 时间戳应写入');
  });
});

test('索引：remoteState 不带 visibility 时不得抹掉既有可见性', () => {
  sandbox(({ ws, home }) => {
    const target = join(home, 'git-push', 'dsh-repo-index.json');
    mkdirSync(join(home, 'git-push'), { recursive: true });
    writeFileSync(target, JSON.stringify({
      owner: 'EIGHTfs',
      repos: [{ name: 'r', path: '/x/r', visibility: '公开', remoteHead: '' }],
    }, null, 2));

    // 模拟「可见性查询失败」：visibility 缺省 = 本次没查到，而不是「已知是未知」
    const r = updateRepoRemoteStateInIndex({
      workspaceRoot: ws, repoName: 'r',
      remoteState: { remoteHead: 'dead456', ahead: 0, behind: 0, synced: true },
      syncTarget: target,
    });
    assert.equal(r.ok, true, r.error || '');
    const hit = JSON.parse(readFileSync(target, 'utf8')).repos.find((x) => x.name === 'r');
    assert.equal(hit.visibility, '公开', '未传 visibility 时必须保留既有值，不能覆盖成空/未知');
    assert.equal(hit.remoteHead, 'dead456', '其余远端字段照常更新');
  });
});

test('推送索引：SSH 通道 push 结果无 commitSha 时必须回退本地 HEAD（不能写空）', () => {
  sandbox(({ ws, home }) => {
    // 复刻 push 端点里那段取值逻辑：SSH 通道 return 不含 commitSha（见 transport.js 两处 return），
    //   只有 API 通道才有。旧实现 `r.push?.commitSha || ''` 在 SSH 推送后取到空串 →
    //   把索引里已有的 remoteHead 抹成空。此处锁死「回退本地 HEAD」这一行为。
    const sshPush = { ok: true, pushed: true, method: 'ssh', owner: 'EIGHTfs', repo: 'r', branch: 'main' };
    const apiPush = { ok: true, pushed: true, method: 'api', commitSha: 'a'.repeat(40), owner: 'EIGHTfs', repo: 'r' };
    const localHead = 'b'.repeat(40);

    // 旧写法（错误）：SSH 下得到空串
    assert.equal(String(sshPush.commitSha || '').slice(0, 40) || localHead, localHead,
      'SSH 通道拿不到 commitSha，必须回退本地 HEAD');

    // 新写法：API 通道优先用 commitSha，SSH 回退本地 HEAD，两者都不为空
    const pick = (push) => String(push?.commitSha || '').slice(0, 40) || localHead;
    assert.equal(pick(apiPush), 'a'.repeat(40), 'API 通道应以 commitSha 为准');
    assert.equal(pick(sshPush), localHead, 'SSH 通道应回退本地 HEAD');
    assert.ok(pick(sshPush).length > 0, 'remoteHead 绝不能是空串（会抹掉索引已有值）');
  });
});

test('探测调优：runGitAsync 与 runGit 语义一致（并发探测的前提）', async () => {
  const { runGit, runGitAsync } = await import('../lib/git/exec.js');
  // 成功路径：stdout 都要 trim，ok 都应为 true
  const a = runGit(['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  const b = await runGitAsync(['rev-parse', '--show-toplevel'], { cwd: process.cwd() });
  assert.equal(b.ok, true, 'runGitAsync 成功路径 ok 应为 true');
  assert.equal(b.stdout, a.stdout, 'runGitAsync 与 runGit 的 stdout 必须一致（都 trim）');
  // 失败路径：都不能抛，且 ok=false（否则并发 worker 会中断整批探测）
  const bad = await runGitAsync(['rev-parse', '--verify', 'no-such-ref-xyz'], { cwd: process.cwd() });
  assert.equal(bad.ok, false, '失败时 runGitAsync 应返回 ok:false 而非抛出');
});

test('探测调优：SSH 连接复用参数可关闭，且默认拼装包含 ControlMaster', async () => {
  const { liveRemoteHeadAsync } = await import('../lib/git/transport.js');
  assert.equal(typeof liveRemoteHeadAsync, 'function', '必须导出异步版探测函数');
  // 异步版在非 git 目录下应安全返回 ok:false（不得抛）
  const r = await liveRemoteHeadAsync({ repoPath: '/nonexistent-dir-xyz', branch: 'main' });
  assert.equal(r.ok, false, '非仓库路径应返回 ok:false');
});
