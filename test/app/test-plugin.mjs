/**
 * test-plugin.mjs —— 插件接线：入口导出 / apply 接线 / HTTP 门禁与端点契约 / 设置读写 / 打包声明
 *
 * 三条原则：
 *   ① **数量与清单从真源推导**：工具清单 ≡ `TOOL_REGISTRY`、斜杠命令 ≡ `SLASH_COMMANDS`、
 *      路由前缀从 `http-handlers.js` 导出的常量取——不写死 20 / 6 / 2 这类快照；
 *   ② **路径从模块派生**：所有路径基于 `import.meta.dirname` 与 `package.json`，不拼机器绝对路径；
 *   ③ **只测宿主自己**：审计能力（评分/规则命中/拦截结论/降级行为）不属宿主职责，
 *      由独立的预处理实现（audit-sluice）自己的测试覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// 单测网络隔离：禁止真实 GitHub API / SSH 探测（否则假 token 的 /user、ls-remote 会等满超时）。
process.env.DSH_GIT_PUSH_OFFLINE = '1';

import { name, GIT_PUSH_SETTINGS_NS, Config, apply, callTool, handleHttp, listTools } from '../../lib/index.js';
import { PREPROCESS_API_PREFIX } from '../../lib/app/http-handlers.js';
import { SLASH_COMMANDS } from '../../lib/app/slash-commands.js';
import { TOOL_REGISTRY } from '../../lib/app/command-registry.js';
import { setDefineToolOverride } from '../../lib/plugin/index.js';
import { setSettingsFileOverride } from '../../lib/app/settings-bridge.js';
import { ALLOWED_SETTING_KEYS } from '../../lib/app/handlers/settings.js';
import { commitMany, commitWithPreprocess } from '../../lib/commit-push.js';

const ROOT = join(import.meta.dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** 造一个「能接住 cordis 注入」的假 ctx（各服务只回最小可用形态）。 */
function makeCtx(overrides = {}) {
  return {
    get: (key) => (key === 'log' ? { info: () => {}, warn: () => {} } : undefined),
    inject: (keys, fn) => {
      const service = overrides[keys[0]];
      if (service) fn({ get: (key) => (key === keys[0] ? service : undefined) });
    },
    log: { info: () => {}, warn: () => {} },
  };
}

/** 读文件权限（mode & 0o777 的八进制串）。 */
function fileMode(file) {
  return (statSync(file).mode & 0o777).toString(8);
}

// ───────────────────────── 入口标识 ─────────────────────────

test('入口：插件名与设置命名空间唯一', () => {
  assert.equal(name, 'dsh-git-push');
  assert.equal(GIT_PUSH_SETTINGS_NS, 'git-push');
  assert.equal(pkg.name, name, 'package.json 的 name 必须与插件名一致');
});

test('入口：Config 可调用且带默认值（字段经 refs 索引）', () => {
  const json = Config.toJSON();
  const descriptions = Object.values(json.refs || {}).map((ref) => ref.meta?.description).filter(Boolean);
  const cfg = Config({});
  assert.equal(cfg.enabled, true, 'enabled 默认开');
  assert.equal(cfg.pushPermitEnabled, undefined, 'pushPermitEnabled 已移除');
  assert.ok(descriptions.length > 0, 'schema 至少要有带描述的字段');
});

test('入口：导出 apply / callTool / handleHttp / listTools', () => {
  for (const fn of [apply, callTool, handleHttp, listTools]) assert.equal(typeof fn, 'function');
});

// ───────────────────────── apply 接线 ─────────────────────────

test('apply：工具注册走 tools.register(defineTool(...))，返回 undefined（cordis 标准）', async () => {
  const registered = [];
  const defineCalls = [];
  setDefineToolOverride((spec) => { defineCalls.push(spec); return spec; });
  try {
    const result = await apply(makeCtx({ tools: { register: (tool) => registered.push(tool) } }), {});
    assert.equal(result, undefined, 'apply 只能返回 disposer/Promise/undefined');
    assert.equal(registered.length, defineCalls.length, 'register 数量应与 defineTool 一致');
    assert.equal(registered.length, TOOL_REGISTRY.length, '注册数量应与注册表条目数一致');
  } finally {
    setDefineToolOverride(null);
  }
});

test('apply：systemPrompt 注入段含 name + 同步 text()', async () => {
  const sections = [];
  await apply(makeCtx({ systemPrompt: { section: (section) => sections.push(section) } }), {});
  assert.ok(sections.length > 0, '应注册至少一段 systemPrompt');
  for (const section of sections) {
    assert.equal(typeof section.name, 'string');
    assert.equal(typeof section.text, 'function', '段必须提供同步 text()');
  }
});

test('apply：HTTP 前缀路由 —— 每条前缀都指同一个 handler（鉴权不可绕过）', async () => {
  const routes = [];
  await apply(makeCtx({ webServer: { register: (route) => routes.push(route) } }), {});
  assert.ok(routes.length > 0, '应注册至少一条前缀路由');
  for (const route of routes) {
    assert.equal(route.kind, 'prefix', `${route.path} 应是前缀路由`);
    assert.equal(typeof route.handler, 'function', `${route.path} 的 handler 应是函数`);
  }
  // 关系式断言：所有前缀必须复用同一个 handler（另起入口 = 无门禁裸端点）
  const handlers = new Set(routes.map((route) => route.handler));
  assert.equal(handlers.size, 1, `所有前缀必须复用同一个 handler，实际有 ${handlers.size} 个不同函数`);
  // 前缀集合从代码导出推导（含预处理侧前缀常量），不写死字符串
  const prefixes = routes.map((route) => route.path).sort();
  assert.ok(prefixes.includes('/api/git-push'), '必须注册宿主自身前缀 /api/git-push');
  assert.ok(prefixes.includes(PREPROCESS_API_PREFIX), `必须注册预处理侧前缀 ${PREPROCESS_API_PREFIX}`);
});

test('apply：无 ctx / 缺服务时不崩（防御性接线）', async () => {
  assert.equal(await apply(undefined, {}), undefined);
  assert.equal(await apply(makeCtx(), {}), undefined, '缺 commands/webServer 也不得失败');
});

test('apply：斜杠命令数量与 SLASH_COMMANDS 一致，首条含 input.hint', async () => {
  const registered = [];
  await apply(makeCtx({ commands: { register: (definition) => registered.push(definition) } }), {});
  assert.equal(registered.length, SLASH_COMMANDS.length, '注册数量必须与 SLASH_COMMANDS 真源一致');
  for (const definition of registered) {
    assert.equal(typeof definition.name, 'string');
    assert.equal(typeof definition.handler, 'function');
    // input.hint 是可选的（不是每个命令都需要参数提示）；有则必须是字符串
    if (definition.input) assert.equal(typeof definition.input.hint, 'string', `${definition.name} 的 input.hint 必须是字符串`);
  }
  assert.ok(registered.some((definition) => definition.input && definition.input.hint),
    '至少应有命令带参数提示（发现菜单靠它显示用法）');
});

// ───────────────────────── 工具公开面 ─────────────────────────

test('工具：listTools 与 TOOL_REGISTRY 一一对应（不写死清单）', () => {
  const hostNames = listTools().map((tool) => tool.name).sort();
  const registryNames = TOOL_REGISTRY.map((entry) => entry.name).sort();
  assert.deepEqual(hostNames, registryNames, '宿主注册面必须与注册表完全一致');
});

test('工具：每项都有 description 与 parameters', () => {
  for (const tool of listTools()) {
    assert.ok(tool.description && tool.description.length > 5, `${tool.name} 缺描述`);
    assert.equal(typeof tool.parameters, 'object');
  }
});

// ───────────────────────── callTool 分发（宿主侧） ─────────────────────────

test('工具分发：git_scan 扫到本仓', async () => {
  const result = await callTool('git_scan', { root: ROOT }, { workspaceRoot: ROOT }, {});
  assert.equal(result.ok, true);
  assert.ok(result.repos.some((repo) => repo.path === ROOT), '应包含插件根仓库');
});

test('工具分发：git_sluice 透传 git（返回 stdout/status/command）', async () => {
  const result = await callTool('git_sluice', { args: '--version' }, { workspaceRoot: ROOT }, {});
  assert.equal(result.ok, true);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /git version/);
  assert.equal(result.command, 'git --version');
});

test('工具分发：git_sluice 空 args 明确报错', async () => {
  const result = await callTool('git_sluice', { args: '   ' }, { workspaceRoot: ROOT }, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /args 必填/);
});

test('工具分发：缺必填参数与未知工具都明确报错（不静默）', async () => {
  assert.equal((await callTool('git_commit_push', {}, {}, {})).ok, false);
  assert.equal((await callTool('git_set_visibility', { repo: '/x' }, {}, {})).ok, false);
  const unknown = await callTool('nope', {}, {}, {});
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /未知工具/);
});

// ───────────────────────── HTTP 门禁与端点契约 ─────────────────────────

test('HTTP：GET 只读免 Origin', async () => {
  const response = await handleHttp({ method: 'GET', url: '/api/git-push/status' }, { workspaceRoot: ROOT }, {});
  assert.equal(response.status, 200);
  assert.equal(response.body.plugin, 'dsh-git-push');
});

test('HTTP：POST 无 Origin → 403 NO_ORIGIN', async () => {
  const response = await handleHttp({ method: 'POST', url: '/api/git-push/repo-push', origin: '' }, {}, {});
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'NO_ORIGIN');
});

test('HTTP：破坏性端点缺 confirm → 400 NEED_CONFIRM', async () => {
  const response = await handleHttp(
    { method: 'POST', url: '/api/git-push/repo-clone', origin: 'http://127.0.0.1:30801' },
    {}, {},
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'NEED_CONFIRM');
});

test('HTTP：超大 body → 413', async () => {
  const response = await handleHttp(
    { method: 'GET', url: '/api/git-push/status', headers: { 'content-length': String(6 * 1024 * 1024) } },
    {}, {},
  );
  assert.equal(response.status, 413);
});

test('HTTP：未知端点 → 404', async () => {
  const response = await handleHttp({ method: 'GET', url: '/api/git-push/nope' }, {}, {});
  assert.equal(response.status, 404);
});

test('HTTP：tools 端点与 listTools 同源同数', async () => {
  const response = await handleHttp({ method: 'GET', url: '/api/git-push/tools' }, {}, {});
  assert.equal(response.status, 200);
  assert.equal(response.body.tools.length, listTools().length);
});

test('HTTP：npm-install-progress 路由存在且空闲时返回 idle', async () => {
  const response = await handleHttp(
    { method: 'POST', url: '/api/git-push/npm-install-progress', origin: 'http://127.0.0.1:30801', body: {} },
    { workspaceRoot: ROOT }, {},
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.state, 'idle');
});

test('HTTP：browse 返回目录与父目录；不存在路径 → 400', async () => {
  const ok = await handleHttp(
    { method: 'GET', url: `/api/git-push/browse?path=${encodeURIComponent(ROOT)}` },
    { workspaceRoot: ROOT }, {},
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.body.path, ROOT);
  assert.ok(Array.isArray(ok.body.dirs) && ok.body.dirs.includes('lib'), '应列出 lib 子目录');
  const bad = await handleHttp(
    { method: 'GET', url: `/api/git-push/browse?path=${encodeURIComponent(join(ROOT, 'no-such-dir-xyz'))}` },
    { workspaceRoot: ROOT }, {},
  );
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /目录不存在/);
});

test('HTTP：repos-local 重建索引后可读，且行内带领先/落后/远端字段', async () => {
  const home = mkdtempSync(join(tmpdir(), 'vp-local-'));
  process.env.DSH_HOME = home;
  try {
    const url = `/api/git-push/repos-local?rebuild=1&path=${encodeURIComponent(ROOT)}`;
    const rebuilt = await handleHttp({ method: 'GET', url }, { workspaceRoot: ROOT }, {});
    assert.equal(rebuilt.status, 200);
    assert.equal(rebuilt.body.indexedAvailable, true, '重建后索引应可用');
    const self = rebuilt.body.repos.find((repo) => repo.name === basename(ROOT));
    assert.ok(self, '索引应包含插件根仓库');
    for (const field of ['ahead', 'behind', 'hasRemote']) assert.ok(field in self, `索引项缺字段 ${field}`);
    const listed = await handleHttp(
      { method: 'GET', url: `/api/git-push/repos-local?path=${encodeURIComponent(ROOT)}` },
      { workspaceRoot: ROOT }, {},
    );
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.body.repos));
  } finally {
    delete process.env.DSH_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('HTTP：repos-cloud 未配 token → 友好错误（loggedIn:false）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'vp-cloud-'));
  process.env.DSH_HOME = home;
  try {
    const response = await handleHttp({ method: 'GET', url: '/api/git-push/repos-cloud' }, { workspaceRoot: ROOT }, {});
    assert.equal(response.status, 200);
    assert.equal(response.body.loggedIn, false);
    assert.match(response.body.error, /未配置 GitHub Token/);
  } finally {
    delete process.env.DSH_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('HTTP：repo-push / repo-clone 参数缺失与非 git 目录都明确报错', async () => {
  const noPath = await handleHttp(
    { method: 'POST', url: '/api/git-push/repo-push', origin: 'http://127.0.0.1:30801', body: { confirm: true } },
    {}, {},
  );
  assert.equal(noPath.status, 400);
  const plainDir = mkdtempSync(join(tmpdir(), 'vp-notgit-'));
  try {
    const notGit = await handleHttp(
      { method: 'POST', url: '/api/git-push/repo-push', origin: 'http://127.0.0.1:30801', body: { path: plainDir, confirm: true } },
      {}, {},
    );
    assert.equal(notGit.status, 400);
    assert.match(notGit.body.error, /非 git 仓库/);
  } finally { rmSync(plainDir, { recursive: true, force: true }); }

  const noTarget = await handleHttp(
    { method: 'POST', url: '/api/git-push/repo-clone', origin: 'http://127.0.0.1:30801', body: { confirm: true, dir: '/tmp' } },
    {}, {},
  );
  assert.equal(noTarget.status, 400);
  assert.match(noTarget.body.error, /target/);
});

test('HTTP：account-check 用传入 cfg 的 token（脱敏回显）', async () => {
  const previousHome = process.env.DSH_HOME;
  const home = mkdtempSync(join(tmpdir(), 'vp-acc-'));
  process.env.DSH_HOME = home;
  try {
    const fakeToken = 'ghp_testtokenplaceholder123';
    // POST 而非 GET：account-check 会 persistSshPub + 写 account-status 快照，是有副作用的端点，
    //   路由层现在会用方法闸门把 GET 挡成 405（防止 <img>/预取替用户按下「重新检测」）。
    const response = await handleHttp(
      { method: 'POST', url: '/api/git-push/account-check', origin: 'http://127.0.0.1:30801', body: {} },
      { workspaceRoot: ROOT },
      { githubToken: fakeToken },
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.cred.hasToken, true, 'cfg.githubToken 应被采用');
    assert.equal(String(response.body.cred.tokenMasked).includes(fakeToken), false, 'token 必须脱敏');
    assert.ok(response.body.block, '应返回可读文本块');
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

// ───────────────────────── 打包声明（缺一条 = 装上即失效） ─────────────────────────

test('契约：package.json 的 dsh 段完整（bundle.patch / client / skills）', () => {
  assert.ok(pkg.dsh, 'dsh 段必须存在');
  const patchPath = pkg.dsh.bundle?.patch;
  assert.ok(patchPath, 'bundle.patch 必须声明');
  assert.ok(existsSync(join(ROOT, patchPath)), `bundle.patch 指向的文件不存在：${patchPath}`);
  assert.equal(typeof pkg.dsh.client?.platform, 'string', 'client.platform 必须声明');
  assert.ok(Array.isArray(pkg.dsh.client?.inject) && pkg.dsh.client.inject.length > 0,
    '有 client 注入就必须声明 inject 依赖（否则侧边栏永不加载）');
  const skills = pkg.dsh.skills || [];
  assert.ok(skills.length > 0, 'dsh.skills 不能为空');
  for (const relativePath of skills) {
    assert.ok(existsSync(join(ROOT, relativePath)), `dsh.skills 列了不存在的文件：${relativePath}`);
  }
});

test('契约：bin 入口都真实存在（CLI 分家后只剩宿主自有入口）', () => {
  const bins = pkg.bin || {};
  const entries = Object.entries(bins);
  assert.ok(entries.length > 0, 'bin 不能为空');
  for (const [binName, relativePath] of entries) {
    assert.ok(existsSync(join(ROOT, relativePath)), `bin ${binName} 指向的文件不存在：${relativePath}`);
  }
});

// ───────────────────────── 提交总入口（宿主侧） ─────────────────────────

test('commitMany：逐仓返回结果，非 git 仓库记失败不抛异常', async () => {
  const results = await commitMany({
    repos: [ROOT, '/nonexistent-abc'],
    message: 'batch test',
    dryRun: true,
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].repo, ROOT);
  assert.equal(results[0].ok, true, '真实仓库 dryRun 应成功');
  assert.equal(results[0].dryRun, true);
  assert.equal(results[1].ok, false, '非 git 仓库应记失败');
  assert.match(results[1].error, /非 git 仓库/);
});

test('commitWithPreprocess：dryRun 透传（不触发任何写操作）', async () => {
  // 隔离手段必须用「现行语义」：stages: [] 才表示「这次不跑预处理」（见 runPreprocess 的契约）。
  //   历史上这里传的是 audit:false —— 该参数从来不存在，键被静默丢弃，于是每次都真跑门禁：
  //   工作树里一旦有 blocker（比如正在改的文件触发 max-function-length），这条只验 dryRun
  //   的用例就假红，还把「门禁拦住了提交」误报成「dryRun 透传失败」。
  //   audit:false 不是开关、是无效参数（现在传它会直接抛错，见下一条用例）——跳过门禁用 stages: []。
  const result = await commitWithPreprocess({
    repoPath: ROOT, message: 'test', dryRun: true, stages: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.audit, null, 'stages: [] 应让本次完全跳过预处理（audit 为 null 即证明没跑）');
});

test('commitWithPreprocess：传未知参数（如 audit:false）必须抛错，不得静默忽略', async () => {
  // 钉死这个坑：参数名传错过去是**静默无效**——调用方以为关掉了门禁，实际照跑，
  //   表现为「只在工作树有 blocker 时才假红」的隐蔽故障。补校验后必须当场抛错，
  //   且错误信息要列出可用参数名，否则调用方只能靠读源码猜。
  let thrown = null;
  try {
    await commitWithPreprocess({ repoPath: ROOT, message: 'test', dryRun: true, audit: false });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, '未知参数必须抛错（不能静默继续）');
  assert.match(String(thrown.message), /未知参数/, '错误信息应点明「未知参数」');
  assert.match(String(thrown.message), /audit/, '错误信息应带上那个未知的键名');
  assert.match(String(thrown.message), /stages/, '错误信息应列出可用参数名（调用方据此改正）');
});

// ───────────────────────── 设置读写端点 ─────────────────────────
// 背景：设置持久化 = 插件私有 config.json（不写公共 settings.yaml）。
//   单测用 setSettingsFileOverride 指向临时文件，不污染真实配置。

test('settings-get：无配置文件 → 200 + 空设置（降级不崩）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-setget-'));
  try {
    setSettingsFileOverride(join(dir, 'config.json'));
    const response = await handleHttp({ method: 'GET', url: '/api/git-push/settings-get' }, { workspaceRoot: ROOT }, {});
    assert.equal(response.status, 200);
    assert.equal(response.body.settings.tokenConfigured, false, '派生布尔位默认 false');
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings-set：写盘成功且文件权限 0600', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-setset-'));
  try {
    const file = join(dir, 'config.json');
    setSettingsFileOverride(file);
    // 键名从白名单真源取（不手抄）：这里只验证「通用单键写盘链路 + 0600」，
    //   嵌套键（preCommitEnabled）另有专门用例覆盖。
    const settableKey = ALLOWED_SETTING_KEYS.find((k) => k === 'pushGate');
    assert.ok(settableKey, '白名单里应有 pushGate（通用布尔键）');
    const response = await handleHttp(
      { method: 'POST', url: '/api/git-push/settings-set', origin: 'http://127.0.0.1:30801', body: { key: settableKey, value: true } },
      { workspaceRoot: ROOT }, {},
    );
    assert.equal(response.status, 200);
    assert.match(readFileSync(file, 'utf8'), /"pushGate": true/);
    assert.equal(fileMode(file), '600');
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings-set：非白名单键 → 400（防越权写任意字段）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-sete-'));
  try {
    setSettingsFileOverride(join(dir, 'config.json'));
    const response = await handleHttp(
      { method: 'POST', url: '/api/git-push/settings-set', origin: 'http://127.0.0.1:30801', body: { key: 'evilKey', value: 'x' } },
      { workspaceRoot: ROOT }, {},
    );
    assert.equal(response.status, 400);
    assert.match(response.body.error, /不支持的设置键/);
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings-set：写后读回一致（持久化闭环）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-setloop-'));
  try {
    setSettingsFileOverride(join(dir, 'config.json'));
    const written = await handleHttp(
      { method: 'POST', url: '/api/git-push/settings-set', origin: 'http://127.0.0.1:30801', body: { key: 'pushGate', value: true } },
      { workspaceRoot: ROOT }, {},
    );
    assert.equal(written.status, 200);
    const read = await handleHttp({ method: 'GET', url: '/api/git-push/settings-get' }, { workspaceRoot: ROOT }, {});
    assert.equal(read.body.settings.pushGate, true, '写后读回应保持');
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings-set：POST（空 key）→ 400（白名单校验先行）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-setget2-'));
  try {
    setSettingsFileOverride(join(dir, 'config.json'));
    // 用 POST：settings-set 有副作用，GET 已被路由层方法闸门挡成 405（见 test-http-method-gate）；
    //   本用例验的是 handler 内部的白名单校验，必须真正进到 handler 里。
    const response = await handleHttp(
      { method: 'POST', url: '/api/git-push/settings-set', origin: 'http://127.0.0.1:30801', body: { key: '' } },
      { workspaceRoot: ROOT },
      {},
    );
    assert.equal(response.status, 400);
    assert.match(response.body.error, /设置键/);
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('settings-set：UI 提交日志落盘且凭据打码（0600）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-setlog-'));
  const previousHome = process.env.DSH_HOME;
  // 凭据落盘走 credentialsDir() → DSH_HOME，必须一起隔离，否则会覆盖真实 token
  process.env.DSH_HOME = dir;
  try {
    setSettingsFileOverride(join(dir, 'config.json'));
    const plain = await handleHttp(
      { method: 'POST', url: '/api/git-push/settings-set', origin: 'http://127.0.0.1:30801', body: { key: 'pushGate', value: true } },
      { workspaceRoot: ROOT }, {},
    );
    const secret = await handleHttp(
      { method: 'POST', url: '/api/git-push/settings-set', origin: 'http://127.0.0.1:30801', body: { key: 'githubToken', value: 'ghp_SECRETTOKEN_XYZ' } },
      { workspaceRoot: ROOT }, {},
    );
    assert.equal(plain.status, 200);
    assert.equal(secret.status, 200);
    const logFile = join(dir, 'settings-ui.log');
    assert.ok(existsSync(logFile), 'settings-ui.log 必须生成');
    const logText = readFileSync(logFile, 'utf8');
    assert.ok(logText.includes('pushGate'), '普通键必须留痕');
    assert.ok(logText.includes('githubToken'), '凭据键名必须留痕');
    assert.equal(logText.includes('ghp_SECRETTOKEN_XYZ'), false, '凭据值不得落明文');
    assert.equal(fileMode(logFile), '600', '日志文件必须 0600');
  } finally {
    setSettingsFileOverride(null);
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── 工作区路径端点 ─────────────────────────

test('HTTP：workspace-paths 读写按方法分派（GET 读清单 / POST 写）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'vp-wsp-'));
  process.env.DSH_HOME = home;
  try {
    const readOnly = await handleHttp({ method: 'GET', url: '/api/git-push/workspace-paths' }, { workspaceRoot: ROOT }, {});
    assert.equal(readOnly.status, 200);
    assert.ok(Array.isArray(readOnly.body.paths) || Array.isArray(readOnly.body.workspacePaths), 'GET 应返回路径清单');
  } finally {
    delete process.env.DSH_HOME;
    rmSync(home, { recursive: true, force: true });
  }
  // 初始化一个 git 仓库给 POST 用（避免依赖真实工作区）
  const dir = mkdtempSync(join(tmpdir(), 'vp-wsp2-'));
  try {
    execSync('git init -q', { cwd: dir, stdio: 'ignore' });
    const written = await handleHttp(
      { method: 'POST', url: '/api/git-push/workspace-paths', origin: 'http://127.0.0.1:30801', body: { paths: [dir] } },
      { workspaceRoot: ROOT }, {},
    );
    // 端点契约：合法路径 → 200；不合法 → 400。这里只断言「有明确状态码且非 5xx」
    assert.ok([200, 400].includes(written.status), `POST workspace-paths 应 200/400，实际 ${written.status}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
