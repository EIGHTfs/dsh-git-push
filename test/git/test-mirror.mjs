/**
 * test-mirror.mjs —— 同族测试合并（test-mirror-fallback.mjs · test-mirror-gates.mjs · test-mirror-store.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { MAX_FAILURES, SEED_PATH, invalidateMirrorCache, listCandidates, normalizeMirror, pickMirror, probeMirror, readSeed, readState, recordOutcome, statePath } from '../../lib/core/mirror-store.js';
import { githubFetch } from '../../lib/git/api.js';
import { withMirror, mirrorGitConfigEnv, mirrorPrefix, DEFAULT_MIRROR_PREFIX } from '../../lib/git/endpoints.js';
import { GIT_READ_VERBS } from '../../lib/git/exec.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
// ── 原 test-mirror-fallback.mjs ──
{
  // 镜像故障自动回退直连（需要一次真实网络请求；离线环境自动跳过）
  //
  // 为什么必须有用例：回退只在「镜像不可用」时生效 —— 平时永远走不到，删掉它也没有任何测试会红，
  //   而它挂掉时的后果是「代理一抖、克隆全挂」。故必须有一条用例专门制造故障并断言仍能成功。

  const OFFLINE = process.env.DSH_GIT_PUSH_OFFLINE === '1';
  // 联网用例门禁（与 test-repo-list.mjs 既有约定一致）：这三条要真发一次 GitHub 请求，而 CI runner
  //   无 token、匿名访问会被限流（实测 403，是环境而非代码问题）⇒ 必须显式 DSH_TEST_ONLINE=1 才跑，
  //   否则 CI 必因环境而红、把真实回归信号淹掉。
  const ONLINE = process.env.DSH_TEST_ONLINE === '1';
  const SKIP = OFFLINE
    ? '离线模式（DSH_GIT_PUSH_OFFLINE=1）跳过：该用例需要一次真实请求'
    : (ONLINE ? false : '联网用例（设 DSH_TEST_ONLINE=1 才跑）：CI 匿名访问会被 GitHub 限流（403）');

  const withMirror = async (value, fn) => {
    const old = process.env.DSH_GIT_MIRROR_PREFIX;
    if (value === undefined) delete process.env.DSH_GIT_MIRROR_PREFIX;
    else process.env.DSH_GIT_MIRROR_PREFIX = value;
    try { return await fn(); } finally {
      if (old === undefined) delete process.env.DSH_GIT_MIRROR_PREFIX;
      else process.env.DSH_GIT_MIRROR_PREFIX = old;
    }
  };

  test('[mirror-fallback] 镜像故障 ⇒ 自动回退直连（坏镜像下仍应成功）', { skip: SKIP }, async () => {
    const r = await withMirror('https://mirror-must-fail-probe.invalid/', () => githubFetch('/repos/EIGHTfs/dsh-skill-scoreboard', {}));
    assert.equal(r.status, 200, `坏镜像下应回退直连并成功，实际 ${JSON.stringify({ status: r.status, error: r.error })}`);
    assert.ok(r.json && r.json.default_branch, '应拿到仓库 JSON（含 default_branch）');
  });

  test('[mirror-fallback] 镜像正常 ⇒ 经镜像成功（不回退也不影响结果）', { skip: SKIP }, async () => {
    const r = await withMirror(undefined, () => githubFetch('/repos/EIGHTfs/dsh-skill-scoreboard', {}));
    assert.equal(r.status, 200, `默认镜像下应成功，实际 ${JSON.stringify({ status: r.status, error: r.error })}`);
  });

  test('[mirror-fallback] 关闭镜像 ⇒ 直连成功（逃生开关可用）', { skip: SKIP }, async () => {
    const r = await withMirror('off', () => githubFetch('/repos/EIGHTfs/dsh-skill-scoreboard', {}));
    assert.equal(r.status, 200, `off 时应直连成功，实际 ${JSON.stringify({ status: r.status, error: r.error })}`);
  });

  test('[mirror-fallback] 4xx 不触发回退（远端真实答案，回退无意义）', { skip: SKIP }, async () => {
    // 用一个必定 404 的仓库名：若实现对 4xx 也回退，将出现两次请求；这里只断言最终仍是 404 且不抛错
    const r = await withMirror('https://mirror-must-fail-probe.invalid/', () => githubFetch('/repos/EIGHTfs/__no-such-repo-dshgp-probe__', {}));
    assert.equal(r.status, 404, `应如实回传 404，实际 ${JSON.stringify({ status: r.status, error: r.error })}`);
  });
}

// ── 原 test-mirror-gates.mjs ──
{
  // 镜像通道的双闸门 + 只读动词集合（纯函数用例，不联网）
  //
  // 为什么必须有用例：这些行为**默认全绿**（默认走 gh-proxy、写操作直连），
  //   一旦哪次改动把闸门去掉，功能照常能跑、只有安全属性丢失 —— 没有用例就永远不会红。

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

  test('[mirror-gates] 默认通道：未设环境变量时前缀为默认值，只读 GET 的三类 github URL 都被改写', () => withEnv(undefined, () => {
    assert.equal(mirrorPrefix(), DEFAULT_MIRROR_PREFIX);
    for (const u of [API, RAW, WEB]) assert.equal(withMirror(u), DEFAULT_MIRROR_PREFIX + u, u);
  }));

  test('[mirror-gates] 闸门一：写操作一律直连（POST/PATCH/PUT/DELETE 与 mode=write 都不改写）', () => withEnv(undefined, () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      assert.equal(withMirror(API, { method }), API, 'method=' + method);
    }
    assert.equal(withMirror(API, { mode: 'write' }), API);
    assert.equal(withMirror(API, { method: 'POST', mode: 'write' }), API);
  }));

  test('[mirror-gates] 闸门二：带凭据（noMirror）一律直连——token 绝不经过第三方', () => withEnv(undefined, () => {
    assert.equal(withMirror(API, { noMirror: true }), API);
    assert.equal(withMirror(RAW, { noMirror: true }), RAW);
  }));

  test('[mirror-gates] 逃生开关：off/none/no/false/0/- 均关闭镜像，非 github URL 原样返回', () => withEnv('off', () => {
    assert.equal(mirrorPrefix(), '');
    assert.equal(withMirror(API), API);
    assert.equal(withMirror(RAW), API.includes('api') ? RAW : RAW);
  }));
  test('[mirror-gates] 逃生开关的其它取值同样关闭镜像', () => {
    for (const v of ['none', 'no', 'false', '0', '-']) {
      withEnv(v, () => assert.equal(mirrorPrefix(), '', 'v=' + v));
    }
  });

  test('[mirror-gates] 自定义前缀生效（不以 / 结尾时自动补），且非 github 域不改写', () => withEnv('https://example-mirror.test', () => {
    assert.equal(mirrorPrefix(), 'https://example-mirror.test/');
    assert.equal(withMirror(API), 'https://example-mirror.test/' + API);
    assert.equal(withMirror('https://gitlab.com/a/b'), 'https://gitlab.com/a/b');
  }));

  test('[mirror-gates] git 层：读模式注入 insteadOf，写模式绝不注入', () => withEnv(undefined, () => {
    const read = {};
    mirrorGitConfigEnv(read, { mode: 'read' });
    assert.equal(read.GIT_CONFIG_KEY_0, `url.${DEFAULT_MIRROR_PREFIX}https://github.com/.insteadOf`);
    assert.equal(read.GIT_CONFIG_VALUE_0, 'https://github.com/');
    const write = {};
    mirrorGitConfigEnv(write, { mode: 'write' });
    assert.equal(write.GIT_CONFIG_KEY_0, undefined);
    assert.equal(write.GIT_CONFIG_COUNT, undefined);
  }));

  test('[mirror-gates] git 层：镜像关闭时不写任何 GIT_CONFIG_*', () => withEnv('off', () => {
    const env = {};
    mirrorGitConfigEnv(env);
    assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('GIT_CONFIG')), []);
  }));

  test('[mirror-gates] 只读动词集合：含 fetch/clone/pull/ls-remote/submodule，不含任何写动词', () => {
    for (const v of ['fetch', 'clone', 'pull', 'ls-remote', 'submodule']) assert.ok(GIT_READ_VERBS.has(v), v);
    for (const v of ['push', 'commit', 'tag', 'reset', 'checkout', 'merge', 'rebase', 'remote']) {
      assert.ok(!GIT_READ_VERBS.has(v), '写/本地动词不应被注入镜像: ' + v);
    }
  });
}

// ── 原 test-mirror-store.mjs ──
{
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

  test('[mirror-store] normalizeMirror：补结尾斜杠、去空白', () => {
    assert.equal(normalizeMirror('https://a.com'), 'https://a.com/');
    assert.equal(normalizeMirror('  https://a.com/  '), 'https://a.com/');
    assert.equal(normalizeMirror(''), '');
  });

  test('[mirror-store] 出厂清单：至少 2 个候选，且都以 / 结尾', () => {
    const seed = readSeed();
    assert.ok(seed.length >= 2, `出厂清单应有多候选，实际 ${seed.length}`);
    for (const it of seed) assert.match(it.mirror, /\/$/);
    assert.ok(existsSync(SEED_PATH), '出厂清单文件必须随仓库入库');
  });

  test('[mirror-store] pickMirror：默认取清单里第一个未停用的', () => withStateFile(() => {
    const first = readSeed()[0].mirror;
    assert.equal(pickMirror(), first);
  }));

  test('[mirror-store] pickMirror：环境变量显式钉死优先于清单', () => withStateFile(() => {
    process.env.DSH_GIT_MIRROR_PREFIX = 'https://pinned.example';
    invalidateMirrorCache();
    assert.equal(pickMirror(), 'https://pinned.example/');
  }));

  test('[mirror-store] pickMirror：off/none/0 等取值 → 关闭镜像（返回空串）', () => withStateFile(() => {
    for (const v of ['off', 'none', 'no', 'false', '0', '-']) {
      process.env.DSH_GIT_MIRROR_PREFIX = v;
      invalidateMirrorCache();
      assert.equal(pickMirror(), '', `${v} 应关闭镜像`);
    }
  }));

  test('[mirror-store] recordOutcome：连续失败达阈值即停用，成功一次恢复', () => withStateFile(({ stateFile }) => {
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

  test('[mirror-store] recordOutcome：全部候选停用 → pickMirror 返回空（走直连）', () => withStateFile(({ stateFile }) => {
    for (const it of readSeed()) {
      for (let i = 0; i < MAX_FAILURES; i++) recordOutcome(it.mirror, { ok: false, error: 'x', stateFile });
    }
    invalidateMirrorCache();
    assert.equal(pickMirror(), '', '全停用应回退直连，而不是继续用坏源');
  }));

  test('[mirror-store] 状态文件与出厂清单分离：学习结果不写进入库的 candidates.json', () => withStateFile(({ stateFile }) => {
    const before = readFileSync(SEED_PATH, 'utf8');
    recordOutcome(readSeed()[0].mirror, { ok: false, error: 'x', stateFile });
    assert.equal(readFileSync(SEED_PATH, 'utf8'), before, '出厂清单必须保持原样');
    assert.ok(existsSync(stateFile), '学习结果应落在独立状态文件');
  }));

  test('[mirror-store] statePath：可被 DSH_GIT_MIRROR_STATE 覆盖（测试隔离用）', () => withStateFile(({ stateFile }) => {
    assert.equal(statePath(), stateFile);
  }));

  test('[mirror-store] listCandidates：合并清单与状态（顺序不变、带健康度）', () => withStateFile(({ stateFile }) => {
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

  test('[mirror-store] probeMirror：内容总长与期望不符 → 判不健康（坏镜像的典型形态）', async () => {
    const fakeFetch = async () => new Response('x'.repeat(10), {
      status: 206,
      headers: { 'content-range': 'bytes 0-9/590454', 'content-length': '10' },
    });
    const r = await probeMirror({ mirror: 'https://bad.example/', fetchImpl: fakeFetch, expectedBytes: 8059635 });
    assert.equal(r.ok, false);
    assert.match(r.error, /声明总长/);
  });

  test('[mirror-store] probeMirror：总长一致 → 判健康', async () => {
    const fakeFetch = async () => new Response('x'.repeat(10), {
      status: 206,
      headers: { 'content-range': 'bytes 0-9/8059635', 'content-length': '10' },
    });
    const r = await probeMirror({ mirror: 'https://good.example/', fetchImpl: fakeFetch, expectedBytes: 8059635 });
    assert.equal(r.ok, true);
  });

  test('[mirror-store] probeMirror：HTTP 错误 → 判不健康', async () => {
    const fakeFetch = async () => new Response('nope', { status: 503 });
    const r = await probeMirror({ mirror: 'https://down.example/', fetchImpl: fakeFetch });
    assert.equal(r.ok, false);
    assert.match(r.error, /503/);
  });

  test('[mirror-store] probeMirror：网络异常 → 判不健康且不抛', async () => {
    const fakeFetch = async () => { throw new Error('ECONNRESET'); };
    const r = await probeMirror({ mirror: 'https://boom.example/', fetchImpl: fakeFetch });
    assert.equal(r.ok, false);
    assert.match(r.error, /ECONNRESET/);
  });
}
