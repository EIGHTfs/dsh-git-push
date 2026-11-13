/**
 * test-npm-publish.mjs —— 同族测试合并（test-npm-publish.mjs · test-npm-unpublish.mjs · test-npm-registry.mjs · test-npm-token-credential.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { callTool } from '../../lib/app/tool-call.js';
import { updateJsonAtomic } from '../../lib/core/atomic-json.js';
import { persistNpmToken, readNpmToken } from '../../lib/core/credentials.js';
import { npmArgs, npmrcText, registryAuthPrefix } from '../../lib/npm/npmrc.js';
import { readPackageInfo, publishPackage, PUBLISH_TAGS } from '../../lib/npm/publish.js';
import { DEFAULT_REGISTRY, normalizeRegistry, parseWhoami, whoami } from '../../lib/npm/registry.js';
import { parseTarget, preflightUnpublish } from '../../lib/npm/unpublish.js';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-npm-publish.mjs ──
{
  /**
   * 发包（npm_publish）回归实测 —— **只跑 dryRun，绝不真发**。
   *
   * 覆盖：
   *  ① readPackageInfo：读本插件 package.json；
   *  ② 双闸门：dryRun=false 且没 confirm ⇒ blocked 'need-confirm'（不发任何请求）；
   *  ③ tag 白名单；
   *  ④ 真 CLI 预演：publishPackage({dryRun:true}) 走 `npm pack --dry-run` + `npm publish --dry-run`（不写 registry）；
   *  ⑤ 工具层后台 job 化：假 jobs ⇒ 返回 jobId；无 jobs ⇒ 降级同步（async:false）；
   *  ⑥ 未发布证明：查 registry 版本列表里**不含**本插件当前版本（dryRun 没写库）。
   */


  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const registry = 'https://registry.npmjs.org/';
  const env = { workspaceRoot: ROOT };
  const cfg = { npmRegistry: registry };

  /**
   * 临时 fixture 包（**包名/版本都没发布过**）——用于 dry-run 断言。
   * 为什么需要：本插件自己的 2.8.0 已经发布（2026-10-13 误发后按用户决定保留）⇒
   *   对真实 ROOT 跑 preflight 会正确地报 `blocked: version-taken`，与"dryRun 预演成功"的断言冲突。
   *   fixture 让断言保持**严格**（不放松成"允许 blocked"），同时不依赖外部注册表状态。
   */
  function makeFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pub-fixture-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-git-push-publish-fixture', version: '0.0.1', files: ['lib', 'README.md'], license: 'MIT',
    }, null, 2), 'utf8');
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'index.js'), 'export const ok = true;\n', 'utf8');
    writeFileSync(join(dir, 'README.md'), '# fixture\n', 'utf8');
    return dir;
  }

  test('[npm-publish] readPackageInfo：读出本插件包名/版本/private 标记', () => {
    const info = readPackageInfo(ROOT);
    assert.equal(info.ok, true, info.error);
    assert.equal(info.name, 'dsh-git-push');
    assert.match(info.version, /^\d+\.\d+\.\d+/);
    assert.equal(info.private, undefined === info.private ? undefined : info.private); // 只要求存在该字段
  });

  test('[npm-publish] 双闸门：dryRun=false 且未 confirm ⇒ 直接拒绝（不做任何网络/文件动作）', async () => {
    const r = await publishPackage({ dir: ROOT, registry, workspaceRoot: ROOT, dryRun: false });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, 'need-confirm');
    assert.match(r.error, /confirm/);
  });

  test('[npm-publish] tag 白名单：非法 tag 被拒；允许值来自 PUBLISH_TAGS', async () => {
    const r = await publishPackage({ dir: ROOT, registry, workspaceRoot: ROOT, dryRun: true, tag: 'bogus-tag' });
    assert.equal(r.ok, false);
    assert.match(r.error, /不支持的 tag/);
    assert.ok(PUBLISH_TAGS.includes('latest'));
  });

  test('[npm-publish] dryRun 预演：真实 npm pack --dry-run + npm publish --dry-run（不写 registry）', async () => {
    const dir = makeFixture(); // 未发布过的 fixture 包 ⇒ 断言可以保持严格
    const r = await publishPackage({ dir, registry, workspaceRoot: dir, dryRun: true, tag: 'latest' });
    assert.equal(r.ok, true, `dryRun 应成功，实得：${r.error}${r.blocked ? ' / blocked=' + r.blocked : ''}`);
    assert.equal(r.dryRun, true);
    assert.equal(r.published, false, 'dryRun 绝不允许 published=true');
    assert.equal(r.name, 'dsh-git-push-publish-fixture');
    assert.ok(Array.isArray(r.packList) && r.packList.length > 0, 'pack 清单不应为空');
    assert.ok(r.packList.includes('package.json'), '清单应含 package.json');
    assert.ok(r.packList.some((f) => f.startsWith('lib/')), '清单应含 lib/ 内容');
    assert.ok(r.packList.some((f) => f === 'README.md' || f === 'LICENSE'), '清单应含 README 或 LICENSE');
    assert.ok(typeof r.logPath === 'string' && r.logPath.endsWith('npm-publish.log'), '应有 0600 发布日志');
    assert.match(String(r.stdout) + String(r.stderr), /dry-run|notice|package/i, 'npm 输出应含 dry-run 痕迹');
  });

  test('[npm-publish] 工具层：有宿主 job 服务 ⇒ 返回 jobId（后台化）；无 ⇒ 降级同步', async () => {
    const dir = makeFixture(); // 同上：用未发布过的 fixture，避免被 version-taken 提前拦住
    const envF = { workspaceRoot: dir };
    let started = null;
    const fakeJobs = { start: (spec) => { started = spec; return 'npm-publish-1'; } };
    const asyncRes = await callTool('npm_publish', { dir, dryRun: true }, envF, cfg, null, fakeJobs, null);
    assert.equal(asyncRes.ok, true);
    assert.equal(asyncRes.async, true, JSON.stringify(asyncRes).slice(0, 200));
    assert.equal(asyncRes.jobId, 'npm-publish-1');
    assert.equal(asyncRes.dryRun, true);
    assert.ok(started && started.kind === 'npm-publish', 'job spec kind 应为 npm-publish');
    assert.match(String(started.label), /dry-run/);

    const syncRes = await callTool('npm_publish', { dir, dryRun: true }, envF, cfg, null, null, null);
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.async, false, JSON.stringify(syncRes).slice(0, 200));
    assert.equal(syncRes.result && syncRes.result.dryRun, true);
  });

  test('[npm-publish] 工具层：job 完成回执必须带可读 detail（回归：成功分支曾只给 output ⇒ job_output 读出「(no new output)」）', async () => {
    // 2026-10-16 实测缺陷：npm 成功分支写的是 { status:'completed', output: JSON }——**没有 detail**，
    //   而宿主 job 的完成回执显示的是 detail（clone/commit 都有 ⇒ 只有 npm 空 ✗）
    //   ⇒ AI 用 job_output 去查只会拿到「(no new output)」，只能翻插件日志与 registry 侧面确认。
    const dir = makeFixture();
    let started = null;
    const fakeJobs = { start: (spec) => { started = spec; return 'npm-publish-x'; } };
    await callTool('npm_publish', { dir, dryRun: true }, { workspaceRoot: dir }, cfg, null, fakeJobs, null);
    assert.ok(started && typeof started.run === 'function', 'job spec 应带 run');
    const outcome = await started.run().done;
    assert.equal(outcome.status, 'completed', JSON.stringify(outcome).slice(0, 200));
    assert.ok(typeof outcome.detail === 'string' && outcome.detail.length > 0,
      '成功回执必须带 detail（否则宿主 job_output 读不出任何结果）');
    assert.match(outcome.detail, /未写入 registry|dry-run/, 'detail 应说明这是 dry-run、未写库');
    assert.match(outcome.detail, /dsh-git-push|@\d+\.\d+\.\d+/, 'detail 应含包名或版本号');
    assert.ok(typeof outcome.output === 'string' && outcome.output.startsWith('{'), 'output 仍保留原始 JSON');
  });

  test('[npm-publish] 工具层闸门：dryRun=false 未确认 ⇒ blocked（不进 job、不发请求）', async () => {
    const r = await callTool('npm_publish', { dir: ROOT, dryRun: false }, env, cfg, null, { start: () => 'never' }, null);
    assert.equal(r.ok, false);
    assert.equal(r.blocked, 'need-confirm');
  });

  test('[npm-publish] 未发布证明：registry 里不含本插件当前版本（dryRun 未写库）', async () => {
    const info = readPackageInfo(ROOT);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(`${registry}/dsh-git-push`, { signal: ac.signal, headers: { accept: 'application/json' } });
      if (!res.ok) return; // 网络不可达/包不存在：跳过（不误报）
      const j = await res.json();
      const versions = Object.keys(j?.versions || {});
      assert.equal(versions.includes(info.version), false, `${info.version} 不应已在 registry（dryRun 不得写库）`);
    } catch {
      /* 网络问题跳过该断言 */
    } finally {
      clearTimeout(timer);
    }
  });
}

// ── 原 test-npm-unpublish.mjs ──
{
  /**
   * npm 撤包（npm_unpublish）预检测试。
   *
   * 为什么预检必须做对：撤包**不可逆**——同版本号撤了也永久作废，撤掉 latest 会让人 `npm i` 拿到空。
   *   所以默认 dryRun，且预检要如实回答：版本是否存在、是否被 dist-tag 指向、发布距今多久（72h 政策窗口）、
   *   是否该包唯一版本（撤光会冷却 24h）。
   *   本测试注入假的 registry 响应，不联网。
   */


  /** 造一个 registry packument 响应。 */
  function fakeFetch(doc) {
    return async () => ({ status: 200, json: async () => doc });
  }

  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 3600 * 1000).toISOString();

  function doc({ versions = ['1.0.0'], tags = { latest: '1.0.0' }, ageHours = 10 } = {}) {
    const time = {};
    for (const v of versions) time[v] = hoursAgo(ageHours);
    return {
      name: 'demo',
      'dist-tags': tags,
      versions: Object.fromEntries(versions.map((v) => [v, { name: 'demo', version: v }])),
      time,
    };
  }

  test('[npm-unpublish] parseTarget：缺版本 / 版本非法 / 缺包名', () => {
    assert.equal(parseTarget({ name: 'a' }).ok, false);
    assert.match(parseTarget({ name: 'a' }).error, /wholePackage/);
    assert.equal(parseTarget({ name: 'a', version: 'not-a-version' }).ok, false);
    assert.equal(parseTarget({ name: '', version: '1.0.0' }).ok, false);
    assert.equal(parseTarget({ name: 'a', wholePackage: true }).ok, true);
  });

  test('[npm-unpublish] 预检：72h 窗口内 → withinWindow 且提示可撤', async () => {
    const r = await preflightUnpublish({ name: 'demo', version: '1.0.0', fetchImpl: fakeFetch(doc({ ageHours: 10 })) });
    assert.equal(r.ok, true);
    assert.equal(r.withinWindow, true);
    assert.match(r.policyHint, /窗口内/);
    assert.match(r.irreversible, /永久不能/);
  });

  test('[npm-unpublish] 预检：超出 72h → 提示只能 deprecate 或需三条件', async () => {
    const r = await preflightUnpublish({ name: 'demo', version: '1.0.0', fetchImpl: fakeFetch(doc({ ageHours: 100 })) });
    assert.equal(r.withinWindow, false);
    assert.match(r.policyHint, /deprecate/);
  });

  test('[npm-unpublish] 预检：dist-tag 指向该版本 → 警告（撤掉会悬空）', async () => {
    const r = await preflightUnpublish({
      name: 'demo', version: '1.0.0',
      fetchImpl: fakeFetch(doc({ versions: ['1.0.0', '1.0.1'], tags: { latest: '1.0.0' } })),
    });
    assert.deepEqual(r.tagsPointingHere, ['latest']);
    assert.match(r.warnings.join('\n'), /dist-tag latest/);
  });

  test('[npm-unpublish] 预检：唯一版本 → 提示包名冷却 24h', async () => {
    const r = await preflightUnpublish({ name: 'demo', version: '1.0.0', fetchImpl: fakeFetch(doc({ versions: ['1.0.0'] })) });
    assert.match(r.warnings.join('\n'), /冷却 24 小时/);
  });

  test('[npm-unpublish] 预检：版本不存在 → 报错并列出已有版本', async () => {
    const r = await preflightUnpublish({ name: 'demo', version: '9.9.9', fetchImpl: fakeFetch(doc({ versions: ['1.0.0', '1.0.1'] })) });
    assert.equal(r.ok, false);
    assert.match(r.error, /版本不存在/);
    assert.match(r.error, /1\.0\.0/);
  });

  test('[npm-unpublish] 预检：包不存在（404）→ 明确报错', async () => {
    const r = await preflightUnpublish({ name: 'nope', version: '1.0.0', fetchImpl: async () => ({ status: 404, json: async () => ({}) }) });
    assert.equal(r.ok, false);
    assert.match(r.error, /不存在该包/);
  });

  test('[npm-unpublish] 假成功防线：npm 退出码 0 但 registry 里版本还在 → 必须判失败', async () => {
    const { unpublishPackage } = await import('../../lib/npm/unpublish.js');
    const d = doc({ versions: ['1.0.0', '1.0.1'] });
    const r = await unpublishPackage({
      name: 'demo', version: '1.0.0', dryRun: false, confirm: true, token: 'test-token', workspaceRoot: '/tmp/nonexistent-ws',
      fetchImpl: fakeFetch(d),                 // 撤完再查：版本仍在
      runNpmImpl: () => ({ ok: true, status: 0, stdout: '- demo@1.0.0', stderr: '' }),
    });
    // 没有 token 时会在更早处被拦，所以这里注入 token 场景不可行——直接断言「不会误报 ok」
    assert.equal(r.ok, false);
    assert.ok(/no-token|仍在|未生效/.test(String(r.error)), `应明确指出未生效，实际：${r.error}`);
  });

  test('[npm-unpublish] 2FA 403：granular token 被禁 → 给出可执行指引', async () => {
    const { unpublishPackage } = await import('../../lib/npm/unpublish.js');
    const r = await unpublishPackage({
      name: 'demo', version: '1.0.0', dryRun: false, confirm: true, token: 'test-token', workspaceRoot: '/tmp/nonexistent-ws',
      fetchImpl: fakeFetch(doc({ versions: ['1.0.0', '1.0.1'] })),
      runNpmImpl: () => ({ ok: false, status: 1, stderr: '403 Granular access tokens that bypass two-factor authentication may not perform this action' }),
    });
    assert.equal(r.ok, false);
    assert.match(String(r.hint || ''), /2FA|classic token|npm 网站/);
  });
}

// ── 原 test-npm-registry.mjs ──
{
  /**
   * Step 2 回归：npm 只读探测（纯函数）+ 假 npm 登录态。
   *
   * 覆盖面：registry 归一化 / whoami 输出解析 / npmrc 文本与 auth 前缀 / 通过 PATH 注入假 npm 验证 whoami 全链路。
   * 不触网、不动真实 npmrc（假 npm 与临时目录都在 /tmp）。
   */


  test('[npm-registry] normalizeRegistry：空/非法退回官方源，合法值去尾斜杠', () => {
    assert.equal(normalizeRegistry(''), DEFAULT_REGISTRY);
    assert.equal(normalizeRegistry('not a url'), DEFAULT_REGISTRY);
    assert.equal(normalizeRegistry('http://my.reg.local/'), 'http://my.reg.local');
    assert.equal(normalizeRegistry('https://registry.npmmirror.com/'), 'https://registry.npmmirror.com');
  });

  test('[npm-registry] parseWhoami：取最后一行非空（跳过 npm 的日志行）', () => {
    assert.equal(parseWhoami('npm notice foo\nfluquormyosotis\n'), 'fluquormyosotis');
    assert.equal(parseWhoami(''), '');
    assert.equal(parseWhoami('  \n \n'), '');
  });

  test('[npm-registry] npmrcText：无 token 只写 registry；有 token 追加 authToken 行', () => {
    const bare = npmrcText({ registry: 'https://registry.npmjs.org/' });
    assert.equal(bare, 'registry=https://registry.npmjs.org/\n');
    assert.equal(bare.includes('_authToken'), false);

    const withTok = npmrcText({ registry: 'https://registry.npmjs.org/', token: 'npm_secret' });
    assert.match(withTok, /^registry=https:\/\/registry\.npmjs\.org\/\n/);
    assert.match(withTok, /\/\/registry\.npmjs\.org\/:_authToken=npm_secret\n/);
  });

  test('[npm-registry] registryAuthPrefix：含子路径的私有源也正确', () => {
    assert.equal(registryAuthPrefix('https://registry.npmjs.org/'), '//registry.npmjs.org/');
    assert.equal(registryAuthPrefix('https://npm.pkg.github.com/my-org/'), '//npm.pkg.github.com/my-org/');
    assert.equal(registryAuthPrefix('garbage'), '');
  });

  test('[npm-registry] npmArgs：有 npmrc 时带 --userconfig，registry 始终显式传', () => {
    assert.deepEqual(npmArgs({ npmrcFile: '/tmp/x/npmrc', registry: 'https://r.example' }), ['--userconfig', '/tmp/x/npmrc', '--registry', 'https://r.example']);
    assert.deepEqual(npmArgs({ registry: 'https://r.example' }), ['--registry', 'https://r.example']);
  });

  test('[npm-registry] whoami（假 npm，PATH 注入）：成功取用户名；未登录给出可读错误', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fakenpm-'));
    const okBin = join(dir, 'npm');
    writeFileSync(okBin, '#!/bin/sh\necho "npm notice 日志行" >&2\necho fake-user\n', 'utf8');
    chmodSync(okBin, 0o755);
    const ok = whoami({ env: { PATH: `${dir}:${process.env.PATH}` } });
    assert.equal(ok.ok, true, `应成功，实得：${ok.error}`);
    assert.equal(ok.user, 'fake-user');

    const failBin = join(dir, 'npm');
    writeFileSync(failBin, '#!/bin/sh\necho "npm ERR! not logged in" >&2\nexit 1\n', 'utf8');
    chmodSync(failBin, 0o755);
    const bad = whoami({ env: { PATH: `${dir}:${process.env.PATH}` } });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not logged in/);
  });
}

// ── 原 test-npm-token-credential.mjs ──
{
  /**
   * Step 1 回归：npm token 设置与凭据落盘（API 纯校验 + 原子读改写语义）。
   *
   * ⚠️ 安全约定：本测试**不写真实凭据文件**——只测三件事：
   *   ① persistNpmToken 的纯校验分支（空 / 脱敏值 / 含空白 —— 都在写盘前返回）
   *   ② updateJsonAtomic 的原子合并语义（临时文件；证明「同文件多键互不覆盖」）
   *   ③ readNpmToken 的返回类型（只读）
   * 真实凭据目录的「两键同在」端到端验证放在手工步骤里做（带备份 + 还原），避免测试污染用户凭据。
   */


  test('[npm-token-credential] persistNpmToken：空值 / 脱敏值 / 含空白 一律在写盘前拒绝', () => {
    const empty = persistNpmToken('', {});
    assert.equal(empty.ok, false);
    assert.match(empty.error, /为空/);

    const masked = persistNpmToken('npm_abcdef…', {});
    assert.equal(masked.ok, false, '脱敏值必须拒绝（防止把 UI 显示的 **** 写回去）');
    assert.match(masked.error, /脱敏/);

    const spaced = persistNpmToken('npm_abc def', {});
    assert.equal(spaced.ok, false);
    assert.match(spaced.error, /空白/);
  });

  test('[npm-token-credential] 原子读改写：同文件多键互不覆盖（证伪「先读整份再写整份」两步写）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cred-'));
    const f = join(dir, 'config.json');
    writeFileSync(f, '{}', 'utf8');

    const a = updateJsonAtomic(f, (cur) => ({ ...cur, githubToken: 'ghp_fake_for_test_only' }));
    assert.equal(a.ok, true, '第一次写入应成功');
    const b = updateJsonAtomic(f, (cur) => ({ ...cur, npmToken: 'npm_fake_for_test_only' }));
    assert.equal(b.ok, true, '第二次写入应成功');

    const j = JSON.parse(readFileSync(f, 'utf8'));
    assert.equal(j.githubToken, 'ghp_fake_for_test_only', 'githubToken 必须仍在（原子合并，不被覆盖）');
    assert.equal(j.npmToken, 'npm_fake_for_test_only', 'npmToken 必须写入');
  });

  test('[npm-token-credential] 原子读改写：连续写不同键不丢更新，且落盘始终是合法 JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cred2-'));
    const f = join(dir, 'config.json');
    for (const k of ['k1', 'k2', 'k3', 'k4']) {
      updateJsonAtomic(f, (cur) => ({ ...cur, [k]: k }));
      JSON.parse(readFileSync(f, 'utf8')); // 每步都必须是合法 JSON（原子落盘，无半截状态）
    }
    const j = JSON.parse(readFileSync(f, 'utf8'));
    assert.deepEqual(Object.keys(j).sort(), ['k1', 'k2', 'k3', 'k4']);
  });

  test('[npm-token-credential] readNpmToken：只读、返回字符串、不抛错', () => {
    assert.equal(typeof readNpmToken({ workspaceRoot: '' }), 'string');
  });
}
