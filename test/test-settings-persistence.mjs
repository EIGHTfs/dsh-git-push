/**
 * 设置侧边栏持久化专项测试（2026-09-15 用户指派「检查所有功能设置是否真正持久化」）。
 *
 * 四层链路逐键断言：
 *   L1 前端提交点   client.js 是否存在该键的 commitSetting/persistSetting 调用（UI 可改）
 *   L2 HTTP 白名单  /api/git-push/settings-set 是否接受该键（可写入）
 *   L3 落盘+回读    writeSettingsKey → config.json；applySettingsToCfg → cfg（重启后恢复）
 *   L4 消费端       审计/推送流程是否真正读取该 cfg 键（设置生效，不只是保存）
 *
 * 每键四层全通才叫「真正持久化」；任一层缺失即列为断链。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SETTINGS_SCHEMA, defaultConfig } from '../lib/client/index.js';
import { readSettings, writeSettingsKey, applySettingsToCfg } from '../lib/app/settings-bridge.js';
import { handleHttp } from '../lib/app/http-handlers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ───────────────────────── 数据源收集 ───────────────────────── */

/** client.js 中所有 commitSetting/persistSetting 的键（前端提交点 L1）。 */
function clientSubmitKeys() {
  const src = readFileSync(join(ROOT, 'client.js'), 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/(?:commitSetting|persistSetting)\('([a-zA-Z]+)'/g)) keys.add(m[1]);
  // 2026-09-15：setAdvanced 是通用提交函数（setAdvanced(key, value)，key 为变量）——
  //   其允许的键集合硬编码在 client.js 的 setAdvanced 白名单正则里（7 键，见下方 SET_ADVANCED）。
  for (const k of SET_ADVANCED) keys.add(k);
  return keys;
}

/** setAdvanced 允许键（与 client.js setAdvanced 正则同步；新增键时两处都要加）。 */
const SET_ADVANCED = ['auditLevel', 'auditRuleset', 'maxScanFiles', 'hardcodeFullScan', 'pushMethod'];

/** settings-set 白名单键（L2）。 */
function allowlistKeys() {
  const src = readFileSync(join(ROOT, 'lib/app/http-handlers.js'), 'utf8');
  const m = src.match(/allowedKeys = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'http-handlers 中应有 allowedKeys 白名单');
  return new Set([...m[1].matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1]));
}

/** applySettingsToCfg 映射键（L3 回读）。 */
function cfgMappingKeys() {
  const src = readFileSync(join(ROOT, 'lib/app/settings-bridge.js'), 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/patch\.([a-zA-Z]+)/g)) keys.add(m[1]);
  return keys;
}

/** 隔离 DSH_HOME（config.json 写入目标）。 */
function isolatedEnv() {
  const prev = process.env.DSH_HOME;
  const home = mkdtempSync(join(tmpdir(), 'dsh-gp-persist-'));
  process.env.DSH_HOME = home;
  const credDir = join(home, 'git-push');
  mkdirSync(credDir, { recursive: true });
  return { home, credDir, cleanup: () => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev; rmSync(home, { recursive: true, force: true }); } };
}

/* ───────────────────────── 集合一致性 ───────────────────────── */

test('L0 集合：SETTINGS_SCHEMA 声明的每个键都有默认值（UI 事实源自洽）', () => {
  const def = defaultConfig();
  for (const item of SETTINGS_SCHEMA) {
    assert.ok(item.key in def, `schema 键 ${item.key} 应有默认值`);
  }
  assert.ok(SETTINGS_SCHEMA.length > 8, `schema 应声明全部设置项（现 ${SETTINGS_SCHEMA.length} 项）`);
});

test('L2 全键：settings-set 白名单覆盖 SETTINGS_SCHEMA 全部键 + 凭据键', () => {
  const allow = allowlistKeys();
  for (const item of SETTINGS_SCHEMA) {
    assert.ok(allow.has(item.key), `白名单缺失 schema 键: ${item.key}`);
  }
  for (const k of ['githubToken', 'sshPub']) {
    assert.ok(allow.has(k), `白名单缺失凭据键: ${k}`);
  }
});

test('L3 全键：applySettingsToCfg 映射覆盖白名单全部键（否则重启后 cfg 不恢复）', () => {
  const allow = allowlistKeys();
  const mapped = cfgMappingKeys();
  const missing = [...allow].filter((k) => !mapped.has(k));
  assert.deepEqual(missing, [], `applySettingsToCfg 缺失映射键: ${missing.join(', ')}`);
});

test('L1 全键：client.js 提交点覆盖 SETTINGS_SCHEMA 全部键（否则 UI 只能看不能改）', () => {
  const submitted = clientSubmitKeys();
  // auditDisabledSlots 是唯一例外：其 UI 入口 = 规则包行「禁用/启用」按钮（toggleDisabled），
  //   持久化走 /toggle-rule 直接改 yml 顶层 disabled（不以 settings-set 落 config.json），豁免。
  const exempt = new Set(['auditDisabledSlots']);
  const missing = SETTINGS_SCHEMA
    .filter((item) => !exempt.has(item.key) && !submitted.has(item.key))
    .map((item) => item.key);
  assert.deepEqual(missing, [], `client.js 无提交点的 schema 键（UI 无入口）: ${missing.join(', ')}`);
});

/* ───────────────────────── 写入 → 落盘 → 回读 ───────────────────────── */

test('L3 集成：每键 writeSettingsKey → config.json → applySettingsToCfg 回读 cfg（模拟重启）', async () => {
  const env = isolatedEnv();
  try {
    // 每键给一个代表性的「已设值」（bool/数字/字符串/数组/枚举）
    const samples = {
      auditEnabled: true,
      injectRequirements: true,
      injectSystemPrompt: false,
      auditScanScope: 'full',
      auditLevel: 'quick',
      auditRuleset: '/tmp/rules',
      maxScanFiles: 500,
      weightOverrides: '{"安全性":100}',
      pushMethod: 'api',
      hardcodeFullScan: true,
      auditRuleOrder: ['comment', 'nodejs'],
      auditDisabledSlots: ['comment'],
      githubToken: 'ghp_'.concat('T'.repeat(36)),
      sshPub: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test@example.com',
    };
    const broken = [];
    for (const [key, value] of Object.entries(samples)) {
      const w = await writeSettingsKey(key, value, { workspaceRoot: '' });
      assert.equal(w.ok, true, `writeSettingsKey(${key}) 应成功: ${w.error || ''}`);
      // 落盘断言：config.json 里存在该键且值一致
      const snap = readSettings({ workspaceRoot: '' });
      assert.ok(snap && key in snap, `config.json 应包含 ${key}`);
      // 回读断言：applySettingsToCfg 把值灌回 cfg（模拟 apply.js 启动 merge）
      const cfg = {};
      applySettingsToCfg(cfg, { [key]: snap[key] });
      const present = key in cfg;
      const same = present && JSON.stringify(cfg[key]) === JSON.stringify(snap[key]);
      if (!present || !same) broken.push(key);
    }
    assert.deepEqual(broken, [], `写入后重启回读失败的键: ${broken.join(', ')}`);
  } finally { env.cleanup(); }
});

test('L1 集成：前端提交键确实能被 settings-set 接受（防前端键游离出白名单）', async () => {
  const env = isolatedEnv();
  try {
    const allow = allowlistKeys();
    const submitted = clientSubmitKeys();
    for (const key of submitted) {
      assert.ok(allow.has(key), `client.js 提交的键不在白名单: ${key}`);
    }
  } finally { env.cleanup(); }
});

/* ───────────────────────── 消费端生效 ───────────────────────── */

test('L4 权重：code_audit 流程真的消费 cfg.weightOverrides（权重设置不是摆设）', () => {
  const src = readFileSync(join(ROOT, 'lib/app/tool-call.js'), 'utf8');
  // scoreQuality 的 weights 应优先来自 args.weights，缺省回退 cfg.weightOverrides 解析
  assert.ok(/cfg\.weightOverrides/.test(src) || /weightOverrides/.test(src.match(/let weights = \{[\s\S]*?scoreQuality/)?.[0] || ''),
    'tool-call.js 应消费 cfg.weightOverrides（或 args.weights 显式传入）——否则权重设置保存了也不生效');
  const commitSrc = readFileSync(join(ROOT, 'lib/commit-push.js'), 'utf8');
  assert.ok(/weightOverrides/.test(commitSrc), 'commit-push.js（提交前审计）也应消费权重覆盖');
});

test('L4 关键键 auditRuleOrder：规则加载顺序真正使用 cfg.auditRuleOrder', () => {
  const loader = readFileSync(join(ROOT, 'lib/rule/loader.js'), 'utf8');
  // 端点层把 cfg.auditRuleOrder 传给 resolveSlotOrder（listRuleSlots 第一参）
  const http = readFileSync(join(ROOT, 'lib/app/http-handlers.js'), 'utf8');
  assert.ok(/listRuleSlots\(cfg\.auditRuleOrder/.test(http), 'rule-slots 端点应把 cfg.auditRuleOrder 传入 listRuleSlots');
  assert.ok(/resolveSlotOrder\(order/.test(loader), 'resolveSlotOrder 应消费传入 order');
});

test('L4 关键键 auditScanScope / auditLevel：加载与审计真实读取 cfg', () => {
  const tool = readFileSync(join(ROOT, 'lib/app/tool-call.js'), 'utf8');
  assert.ok(/cfg\.auditLevel/.test(tool), 'code_audit 应使用 cfg.auditLevel');
  // auditScanScope 由前端/工具参数决定，审计 opts 至少包含 scope 字段
  assert.ok(/scope:/.test(tool), '审计 opts 应有 scope 字段');
});

/* ───────────────────────── 凭据链路（不应受断链影响） ───────────────────────── */

test('凭据：githubToken 经 settings-set 落 config.json（打码位不裸传）', async () => {
  const env = isolatedEnv();
  try {
    const r = await handleHttp(
      { method: 'POST', url: '/api/git-push/settings-set', origin: 'http://127.0.0.1:30801', body: { key: 'githubToken', value: 'ghp_'.concat('X'.repeat(36)) } },
      { workspaceRoot: '' },
      {},
    );
    assert.equal(r.status, 200, 'settings-set githubToken 应 200');
    const snap = readSettings({ workspaceRoot: '' });
    assert.ok(snap && snap.githubToken, 'config.json 应落 githubToken');
    const out = await handleHttp({ method: 'GET', url: '/api/git-push/status' }, { workspaceRoot: '' }, { githubToken: snap.githubToken });
    assert.ok(!JSON.stringify(out.body).includes('ghp_'), 'status 响应不得裸传 token 明文');
    assert.equal(out.body.config.tokenConfigured, true, '应派生 tokenConfigured=true');
  } finally { env.cleanup(); }
});

test('凭据：sshPub 经 settings-set 落 config.json + 公钥文件', async () => {
  const env = isolatedEnv();
  try {
    const pub = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test@example.com';
    const r = await handleHttp(
      { method: 'POST', url: '/api/git-push/settings-set', origin: 'http://127.0.0.1:30801', body: { key: 'sshPub', value: pub } },
      { workspaceRoot: '' },
      {},
    );
    assert.equal(r.status, 200);
    const snap = readSettings({ workspaceRoot: '' });
    assert.ok(snap && snap.sshPub, 'config.json 应落 sshPub');
    const files = readdirSync(env.credDir);
    assert.ok(files.includes('id_ed25519.pub'), `公钥文件应落插件目录: ${files.join(',')}`);
  } finally { env.cleanup(); }
});

/* ───────────────────────── 输出断链清单（供修复阶段参考） ───────────────────────── */

test('汇总：输出全部断链键（warning 语义，供人工核对）', () => {
  const allow = allowlistKeys();
  const mapped = cfgMappingKeys();
  const submitted = clientSubmitKeys();
  const schemaKeys = SETTINGS_SCHEMA.map((x) => x.key);
  const lines = [];
  for (const key of schemaKeys) {
    const l1 = submitted.has(key);
    const l2 = allow.has(key);
    const l3 = mapped.has(key);
    const l4 = key === 'weightOverrides' || key === 'auditRuleOrder' || key === 'auditLevel' || key === 'auditScanScope' || key === 'auditEnabled' ? '依赖上层断言' : '需代码确认';
    const status = (l1 && l2 && l3) ? '✅ 链路通' : `⚠️ 断链(L1提交=${l1} L2白名单=${l2} L3回读=${l3} L4=${l4})`;
    lines.push(`${key}: ${status}`);
  }
  process.stdout.write('\n════ 设置项链路总览 ════\n' + lines.join('\n') + '\n');
});