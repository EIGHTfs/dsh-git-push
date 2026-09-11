/**
 * 插件接线测试（1.0.0）：入口导出 / 工具清单 / 工具分发 / HTTP 鉴权 / 双副本同步 dry-run。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

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
  // Config 是 schemastery Schema.object（可调用 validate）；字段经 refs 索引
  const j = Config.toJSON();
  const fields = Object.values(j.refs || {}).map((r) => r.meta?.description).filter(Boolean);
  // 作为函数调用返回带默认值的配置对象（schemastery 真实语义）
  const cfg = Config({});
  assert.equal(cfg.auditEnabled, false, 'auditEnabled 默认关');
  assert.equal(cfg.pushPermitEnabled, undefined, 'pushPermitEnabled 已移除（2026-09-11 用户要求全删）');
  assert.equal(cfg.enabled, true, 'enabled 默认开');
  assert.ok(fields.some((d) => String(d).includes('审计')), 'schema 含审计开关描述');
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
    // cordis 服务属性必须经 get() 防御式读取（2026-09-11 修复：直读抛 without inject）
    get: (k) => k === 'log' ? { info: () => {}, warn: () => {} } : undefined,
    inject: (keys, fn) => {
      if (keys[0] === 'tools') fn({ get: (k) => k === 'tools' ? { register: (t) => registered.push(t) } : undefined });
      if (keys[0] === 'systemPrompt') fn({ get: (k) => k === 'systemPrompt' ? { section: (s) => {} } : undefined });
      if (keys[0] === 'webServer') fn({ get: (k) => k === 'webServer' ? { register: (r) => {} } : undefined });
    },
  };
  setDefineToolOverride((spec) => { defineCalls.push(spec); return spec; });
  const r = await apply(ctx, {});
  // 2026-09-11 修复：apply 返回 undefined（cordis 标准：只收 disposer/Promise/undefined，对象抛 Invalid effect）
  assert.equal(r, undefined, 'apply 应返回 undefined（cordis 标准写法）');
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
    get: (k) => k === 'log' ? { info: () => {}, warn: () => {} } : undefined,
    inject: (keys, fn) => {
      if (keys[0] === 'tools') fn({ get: (k) => k === 'tools' ? { register: () => {} } : undefined });
      if (keys[0] === 'systemPrompt') fn({ get: (k) => k === 'systemPrompt' ? { section: (s) => sections.push(s) } : undefined });
      if (keys[0] === 'webServer') fn({ get: (k) => k === 'webServer' ? { register: () => {} } : undefined });
    },
  };
  const r = await apply(ctx, {});
  assert.equal(r, undefined, 'apply 应返回 undefined（cordis 标准写法）');
  assert.ok(sections.length >= 1, '应注册至少一段 systemPrompt');
  assert.ok(sections.every((s) => typeof s.name === 'string' && typeof s.text === 'function'),
    '段必须含 name + 同步 text()');
  assert.ok(sections.some((s) => s.name === 'dsh-git-push-env'), '应含环境注入段');
  assert.ok(sections.some((s) => s.name === 'dsh-git-push-readme-check'), '应含 README 检查提醒段');
});

test('apply：HTTP 走 webServer.register({kind:"prefix"})（真实 API）', async () => {
  const routes = [];
  const ctx = {
    get: (k) => k === 'log' ? { info: () => {}, warn: () => {} } : undefined,
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
  assert.equal(r, undefined, '无 ctx 也不崩，返回 undefined');
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

// ---------- commitWithAudit（审计提交总入口，1.0.4 供外部插件复用） ----------
import { commitWithAudit, commitMany } from '../lib/commit-push.js';
test('commitWithAudit：非 git 仓库不崩且带审计摘要', async () => {
  const r = await commitWithAudit({ repoPath: '/nonexistent-xyz', message: 'x', requirementsConfirmed: true });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, undefined, '放行路径不设 blocked（仅拦截时 blocked=true）');
});

// D16 commitMany：批量提交（对齐 v1 commitMany；不含审计门禁）
test('commitMany：逐仓返回结果数组（含非 git 仓库错误）', async () => {
  const results = await commitMany({
    repos: [ROOT, '/nonexistent-abc'],
    message: 'batch test',
    dryRun: true,
    requirementsConfirmed: true,
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].repo, ROOT);
  assert.equal(results[0].ok, true, '真实仓库 dryRun 应成功');
  assert.equal(results[0].dryRun, true);
  assert.equal(results[1].repo, '/nonexistent-abc');
  assert.equal(results[1].ok, false, '非 git 仓库应记失败不抛异常');
  assert.match(results[1].error, /非 git 仓库/);
});
test('commitWithAudit：audit=false 不跑审计（audit 为 null）', async () => {
  const r = await commitWithAudit({ repoPath: '/nonexistent-xyz', message: 'x', audit: false, requirementsConfirmed: true });
  assert.equal(r.audit, null);
});
test('commitWithAudit：dryRun 透传（对真实仓库）', async () => {
  const r = await commitWithAudit({ repoPath: ROOT, message: 'test', dryRun: true, audit: false, requirementsConfirmed: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
});

// 2026-09-11：.samples 空文件目录豁免 —— 审计照常出结果，但该目录内 blocker 不拦截提交
function makeExemptRepo() {
  const root = mkdtempSync(join(tmpdir(), 'gp-cwa-exempt-'));
  execSync('git init -b master', { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, 'base.js'), 'export const base = 1;\n');
  execSync('git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -m init', { cwd: root, stdio: 'ignore' });
  return root;
}
function addSecretFile(root, path) {
  mkdirSync(join(root, dirname(path)), { recursive: true });
  writeFileSync(join(root, path), 'const apiKey = "sk-test-abcdef1234567890abcdef";\n');
}
test('commitWithAudit：.samples 目录内 blocker 不拦截（照常可推 dryRun）', async () => {
  const root = makeExemptRepo();
  try {
    mkdirSync(join(root, 'fixtures'), { recursive: true });
    writeFileSync(join(root, 'fixtures', '.samples'), '');
    addSecretFile(root, 'fixtures/sample.js');
    const r = await commitWithAudit({ repoPath: root, message: 'sample', dryRun: true, audit: true, requirementsConfirmed: true });
    assert.equal(r.blocked, undefined, '豁免目录 blocker 不应拦截');
    assert.equal(r.ok, true, 'dryRun 应放行');
    assert.ok(r.audit && r.audit.summary.blocker >= 1, '审计结果照常出（blocker 计数保留）');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('commitWithAudit：对照——非豁免目录 blocker 照常拦截', async () => {
  const root = makeExemptRepo();
  try {
    addSecretFile(root, 'real.js');
    const r = await commitWithAudit({ repoPath: root, message: 'real', dryRun: true, audit: true, requirementsConfirmed: true });
    assert.equal(r.blocked, true, '非豁免目录 blocker 应拦截');
    assert.match(r.error, /审计拦截/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
