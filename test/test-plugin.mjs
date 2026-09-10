/**
 * 插件接线测试（1.0.0）：入口导出 / 工具清单 / 工具分发 / HTTP 鉴权 / 双副本同步 dry-run。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { name, GIT_PUSH_SETTINGS_NS, Config, apply, callTool, handleHttp, listTools } from '../lib/index.js';
import { setDefineToolOverride } from '../lib/plugin/index.js';
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

// ---------- apply（接线，真实 API 断言） ----------
test('apply：工具注册走 tools.register(defineTool(...))（真实 API）', async () => {
  const registered = [];
  const defineCalls = [];
  const ctx = {
    workspaceRoot: '/tmp/ws',
    inject: (keys, fn) => {
      if (keys[0] === 'tools') fn({ get: (k) => k === 'tools' ? { register: (t) => registered.push(t) } : undefined });
      if (keys[0] === 'systemPrompt') fn({ get: (k) => k === 'systemPrompt' ? { section: (s) => {} } : undefined });
      if (keys[0] === 'webServer') fn({ get: (k) => k === 'webServer' ? { register: (r) => {} } : undefined });
    },
    log: { info: () => {}, warn: () => {} },
  };
  setDefineToolOverride((spec) => { defineCalls.push(spec); return spec; });
  const r = await apply(ctx, {});
  assert.equal(r.ok, true);
  assert.ok(defineCalls.length >= 6, `应经 defineTool 包装（实际 ${defineCalls.length}）`);
  assert.equal(registered.length, defineCalls.length, 'register 数量应与 define 一致');
  const names = registered.map((t) => t.name);
  for (const n of ['git_scan', 'git_commit_push', 'code_audit', 'git_clone', 'git_remote_create', 'git_set_visibility', 'link_check']) {
    assert.ok(names.includes(n), `缺工具 ${n}`);
  }
  setDefineToolOverride(null);
});

test('apply：systemPrompt 注入走 section({name,order,text})（真实 API）', async () => {
  const sections = [];
  const ctx = {
    workspaceRoot: '/tmp/ws',
    inject: (keys, fn) => {
      if (keys[0] === 'tools') fn({ get: (k) => k === 'tools' ? { register: () => {} } : undefined });
      if (keys[0] === 'systemPrompt') fn({ get: (k) => k === 'systemPrompt' ? { section: (s) => sections.push(s) } : undefined });
      if (keys[0] === 'webServer') fn({ get: (k) => k === 'webServer' ? { register: () => {} } : undefined });
    },
    log: { info: () => {}, warn: () => {} },
  };
  const r = await apply(ctx, {});
  assert.equal(r.ok, true);
  assert.ok(sections.length >= 1, '应注册至少一段 systemPrompt');
  assert.ok(sections.every((s) => typeof s.name === 'string' && typeof s.text === 'function'),
    '段必须含 name + 同步 text()');
  assert.ok(sections.some((s) => s.name === 'dsh-git-push-env'), '应含环境注入段');
  assert.ok(sections.some((s) => s.name === 'dsh-git-push-readme-check'), '应含 README 检查提醒段');
});

test('apply：HTTP 走 webServer.register({kind:"prefix"})（真实 API）', async () => {
  const routes = [];
  const ctx = {
    workspaceRoot: '/tmp/ws',
    inject: (keys, fn) => {
      if (keys[0] === 'tools') fn({ get: (k) => k === 'tools' ? { register: () => {} } : undefined });
      if (keys[0] === 'systemPrompt') fn({ get: (k) => k === 'systemPrompt' ? { section: () => {} } : undefined });
      if (keys[0] === 'webServer') fn({ get: (k) => k === 'webServer' ? { register: (r) => routes.push(r) } : undefined });
    },
    log: { info: () => {}, warn: () => {} },
  };
  await apply(ctx, {});
  assert.equal(routes.length, 1, '应注册 1 条前缀路由');
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, '/api/git-push');
  assert.equal(typeof routes[0].handler, 'function');
});

test('apply：无 ctx 不崩溃（防御性）', async () => {
  const r = await apply(undefined, {});
  assert.equal(r.ok, true);
});

// ---------- 工具清单 ----------
test('工具：8 个工具名齐全（含 git_gen_readme）', () => {
  const names = listTools().map((t) => t.name);
  for (const n of ['git_scan', 'git_commit_push', 'code_audit', 'git_clone', 'git_remote_create', 'git_set_visibility', 'link_check', 'git_gen_readme']) {
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

test('工具分发：git_gen_readme 生成 README 内容（模板 + 版本表 + 目录）', async () => {
  const r = await callTool('git_gen_readme', { repo: ROOT }, { workspaceRoot: '' }, {});
  assert.equal(r.ok, true);
  assert.equal(r.name, 'dsh-git-push');
  assert.equal(typeof r.content, 'string');
  assert.ok(r.content.length > 200, '内容应有足够长度');
  assert.ok(r.versionTable.length >= 1, '应有版本表行');
  assert.ok(r.toc.includes('架构设计'), '目录应含第一章');
  assert.equal(r.written, false, '未传 writePath 不应写文件');
  assert.ok(r.templateSource.includes('readme-templates') || r.templateSource === 'builtin', '模板源应来自内置 yml 或兜底');
});

test('工具分发：git_gen_readme 缺 repo 报错', async () => {
  const r = await callTool('git_gen_readme', {}, { workspaceRoot: '' }, {});
  assert.equal(r.ok, false);
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
