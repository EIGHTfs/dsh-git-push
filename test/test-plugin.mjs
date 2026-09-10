/**
 * 插件接线测试（1.0.0）：入口导出 / 工具清单 / 工具分发 / HTTP 鉴权 / 双副本同步 dry-run。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { name, GIT_PUSH_SETTINGS_NS, Config, apply, callTool, handleHttp, listTools } from '../lib/index.js';
import { listSyncFiles, syncPlugin, detectTargets, SYNC_ENTRIES, SYNC_EXCLUDE } from '../scripts/sync-plugin.mjs';
import { VERSION } from '../lib/self/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 入口标识 ----------
test('入口：插件名为 dsh-git-push（身份一致）', () => {
  assert.equal(name, 'dsh-git-push');
  assert.equal(GIT_PUSH_SETTINGS_NS, 'git-push');
});

test('入口：Config schema 含关键开关且默认关', () => {
  assert.equal(Config.auditEnabled.default, false);
  assert.equal(Config.pushPermitEnabled.default, false);
  assert.equal(Config.enabled.default, true);
});

test('入口：导出 apply/callTool/handleHttp/listTools', () => {
  assert.equal(typeof apply, 'function');
  assert.equal(typeof callTool, 'function');
  assert.equal(typeof handleHttp, 'function');
  assert.equal(typeof listTools, 'function');
});

// ---------- apply（接线） ----------
test('apply：注入 context/slots + 工具注册 + http 路由', async () => {
  const injected = [];
  const defined = [];
  const routes = [];
  const ctx = {
    workspaceRoot: '/tmp/ws',
    inject: (keys, fn) => { injected.push([keys, fn()]); },
    tools: { define: (n, s, h) => defined.push({ n, s, h }) },
    http: { route: (p, h) => routes.push({ p, h }) },
    log: { info: () => {} },
  };
  const r = await apply(ctx, {});
  assert.equal(r.ok, true);
  assert.equal(r.version, VERSION);
  assert.ok(injected.length >= 1, '应注入 systemPrompt/slots');
  assert.equal(defined.length, listTools().length, '工具数量应与清单一致');
  assert.equal(routes.length, 1);
});

test('apply：无 ctx 不崩溃（防御性）', async () => {
  const r = await apply(undefined, {});
  assert.equal(r.ok, true);
});

// ---------- 工具清单 ----------
test('工具：7 个工具名齐全', () => {
  const names = listTools().map((t) => t.name);
  for (const n of ['git_scan', 'git_commit_push', 'code_audit', 'git_clone', 'git_remote_create', 'git_set_visibility', 'link_check']) {
    assert.ok(names.includes(n), `缺工具 ${n}`);
  }
});

test('工具：每个工具都有 description 与 parameters', () => {
  for (const t of listTools()) {
    assert.ok(t.description && t.description.length > 5, `${t.name} 缺描述`);
    assert.equal(typeof t.parameters, 'object');
  }
});

// ---------- callTool 分发 ----------
test('工具分发：git_scan 扫到本仓（含 .git）', async () => {
  const r = await callTool('git_scan', { root: ROOT }, { workspaceRoot: ROOT }, {});
  assert.equal(r.ok, true);
  assert.ok(r.count >= 1);
  assert.ok(r.repos.some((x) => x.path === ROOT));
});

test('工具分发：缺 repo 参数明确报错（不静默）', async () => {
  assert.equal((await callTool('git_commit_push', {}, {}, {})).ok, false);
  assert.equal((await callTool('code_audit', {}, {}, {})).ok, false);
  assert.equal((await callTool('git_set_visibility', { repo: '/x' }, {}, {})).ok, false);
});

test('工具分发：未知工具报错', async () => {
  const r = await callTool('nope', {}, {}, {});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('未知工具'));
});

test('工具分发：code_audit 出 summary 与 quality', async () => {
  const r = await callTool('code_audit', { repo: ROOT, scope: 'full' }, {}, {});
  assert.equal(r.ok, true);
  assert.equal(typeof r.summary.blocker, 'number');
  assert.equal(typeof r.quality.score, 'number');
});

// ---------- HTTP 鉴权（接线后仍生效） ----------
test('HTTP：GET status 免 Origin', async () => {
  const r = await handleHttp({ method: 'GET', url: '/api/git-push/status' }, { workspaceRoot: ROOT }, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.plugin, 'dsh-git-push');
});

test('HTTP：POST 无 Origin → 403（鉴权前置到接线层）', async () => {
  const r = await handleHttp({ method: 'POST', url: '/api/git-push/rebuild', origin: '' }, {}, {});
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'NO_ORIGIN');
});

test('HTTP：破坏性端点缺 confirm → 400', async () => {
  const r = await handleHttp({ method: 'POST', url: '/api/git-push/rollback', origin: 'http://127.0.0.1:30801' }, {}, {});
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'NEED_CONFIRM');
});

test('HTTP：超大 body → 413', async () => {
  const r = await handleHttp({ method: 'GET', url: '/api/git-push/status', headers: { 'content-length': String(6 * 1024 * 1024) } }, {}, {});
  assert.equal(r.status, 413);
});

test('HTTP：未知端点 404', async () => {
  const r = await handleHttp({ method: 'GET', url: '/api/git-push/nope' }, {}, {});
  assert.equal(r.status, 404);
});

test('HTTP：tools 端点列出工具', async () => {
  const r = await handleHttp({ method: 'GET', url: '/api/git-push/tools' }, {}, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.tools.length, listTools().length);
});

// ---------- 双副本同步 ----------

// ---------- 1.0.4：package.json 的 dsh 装载契约（缺失→插件装上即失效） ----------
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('契约：package.json 有 dsh 段（bundle.patch + client.inject + skills）', () => {
  assert.ok(pkg.dsh, 'dsh 段必须存在——缺了 bundle patch 不读、client.js 不加载、skills 不注入');
  assert.equal(pkg.dsh.bundle?.patch, './cordis.patch.yml', 'bundle.patch 指向 cordis.patch.yml');
  assert.ok(existsSync(join(ROOT, pkg.dsh.bundle.patch)), 'patch 文件必须真实存在');
  assert.equal(pkg.dsh.client?.platform, 'web', 'client.platform 应为 web');
});

test('契约：client.inject 含设置 UI / 插件配置 / 语言包三件套', () => {
  const inject = pkg.dsh.client?.inject || [];
  for (const dep of ['@deepseek-ai/dsh-client-ui-settings-plugins', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-locale']) {
    assert.ok(inject.includes(dep), `client.inject 缺 ${dep}`);
  }
});

test('契约：有 client.js 就必须声明 client.inject（否则侧边栏永不加载）', () => {
  assert.ok(existsSync(join(ROOT, 'client.js')), '本仓有 client.js');
  assert.ok(Array.isArray(pkg.dsh.client?.inject) && pkg.dsh.client.inject.length > 0,
    'client.js 存在时 client.inject 不能为空');
});

test('契约：dsh.skills 每条路径都真实存在（防列了不存在的文件）', () => {
  const skills = pkg.dsh.skills || [];
  assert.ok(skills.length > 0, 'dsh.skills 不能为空');
  for (const rel of skills) {
    assert.ok(existsSync(join(ROOT, rel)), `dsh.skills 列了不存在的文件: ${rel}`);
  }
});
