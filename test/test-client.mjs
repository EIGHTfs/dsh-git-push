/**
 * 侧边栏测试（0.1.8）：手写 createElement 无 JSX、零外部资源、开关默认关、配置即时生效。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CONFIG, SETTINGS_SCHEMA, defaultConfig, resolveConfig,
  createSettingsCard, collectExternalRefs, INLINE_CSS, clientModuleInfo,
} from '../lib/client/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = readFileSync(join(ROOT, 'lib/client/index.js'), 'utf8');

/** 最小 mock react（记录 createElement 调用形状）。 */
function mockReact() {
  const calls = [];
  return {
    calls,
    createElement(type, props, children) { calls.push({ type, props, children }); return { type, props: props || {}, children }; },
  };
}

// ---------- 默认关（关键安全默认） ----------
test('默认关：审计开关/LLM/全量扫 全部默认 false', () => {
  const c = defaultConfig();
  assert.equal(c.auditEnabled, false);
  assert.equal(c.pushPermitEnabled, undefined, 'pushPermitEnabled 已移除（2026-09-11）');
  assert.equal(c.llmAudit, undefined, 'llmAudit 已移除（v2 不提供 LLM 深度审查）');
  // 2026-09-17：hardcodeFullScan / auditLevel / auditRuleset 已删除（非用户可配项）
  assert.equal(c.hardcodeFullScan, undefined, 'hardcodeFullScan 已移除（2026-09-17：硬编码扫描随审计范围走）');
  assert.equal(c.auditLevel, undefined, 'auditLevel 已移除（2026-09-17：审计固定完整流程）');
  assert.equal(c.auditRuleset, undefined, 'auditRuleset 已移除（2026-09-17：设置项删除，只认工具 ruleset 参数）');
  // 2026-09-13：injectFullSkill / injectRepoIndexFull 已按需求废弃移除（不做全量注入）
  assert.equal(c.injectFullSkill, undefined, 'injectFullSkill 已移除（2026-09-13：全量注入开关不要了）');
  assert.equal(c.injectRepoIndexFull, undefined, 'injectRepoIndexFull 已移除（2026-09-13）');
  // 新增：注入系统提示词总开关（默认开——注入目录/功能用法才能让 AI 用插件而非绕开）
  assert.equal(c.injectSystemPrompt, true, 'injectSystemPrompt 默认开（2026-09-13 新增）');
});

test('默认关：DEFAULT_CONFIG 与 schema 默认值一致', () => {
  const c = defaultConfig();
  for (const item of SETTINGS_SCHEMA) {
    assert.equal(c[item.key], item.default, `${item.key} 默认值不一致`);
  }
});

test('默认数值：审计范围默认 diff（不做全量）', () => {
  assert.equal(defaultConfig().auditScanScope, 'diff');
});

// ---------- 配置合并（即时生效语义） ----------
test('合并：布尔严格取真值（"true" 字符串不算开）', () => {
  assert.equal(resolveConfig({ auditEnabled: true }).auditEnabled, true);
  assert.equal(resolveConfig({ auditEnabled: 'true' }).auditEnabled, false);
  assert.equal(resolveConfig({ auditEnabled: 1 }).auditEnabled, false);
});

test('合并：未知键丢弃（防配置漂移）', () => {
  const c = resolveConfig({ unknownKey: 1, auditEnabled: true });
  assert.equal(c.unknownKey, undefined);
  assert.equal(c.auditEnabled, true);
});

test('合并：enum 非法值回落默认', () => {
  assert.equal(resolveConfig({ auditScanScope: 'bogus' }).auditScanScope, 'diff');
  assert.equal(resolveConfig({ auditScanScope: 'full' }).auditScanScope, 'full');
});

test('合并：string 类型统一字符串', () => {
  // 2026-09-17：auditRuleset 已删除，改用仍存在的 string 键（weightOverrides）
  assert.equal(resolveConfig({ weightOverrides: 123 }).weightOverrides, '123');
});

test('合并：不改动基线对象（纯函数）', () => {
  const base = defaultConfig();
  resolveConfig({ auditEnabled: true }, base);
  assert.equal(base.auditEnabled, false);
});

// ---------- 手写 createElement（无 JSX） ----------
test('组件：createSettingsCard 只用 createElement（无 JSX 语法）', () => {
  const react = mockReact();
  const el = createSettingsCard(react, { config: defaultConfig() });
  assert.equal(el.type, 'div');
  assert.ok(react.calls.length >= SETTINGS_SCHEMA.length, '每个设置项至少一次 createElement');
  assert.ok(react.calls.some((c) => c.type === 'input'));
  assert.ok(react.calls.some((c) => c.type === 'select'));
});

test('组件：无 react.createElement 时明确报错（禁止 JSX 构建假设）', () => {
  assert.throws(() => createSettingsCard(null, {}), /createElement/);
  assert.throws(() => createSettingsCard({}, {}), /createElement/);
});

test('组件：复选框 checked 反映配置真值（逐项等于 schema 默认值）', () => {
  // 2026-09-13：不再假设「所有开关默认 false」——注入系统提示词默认 true（需求新增），
  //   改为逐项对照 SETTINGS_SCHEMA 默认值断言，新增开关无需再改本测试。
  const react = mockReact();
  const cfg = defaultConfig();
  createSettingsCard(react, { config: cfg });
  const boxes = react.calls.filter((c) => c.type === 'input' && c.props.type === 'checkbox');
  assert.ok(boxes.length > 0);
  const boolKeys = SETTINGS_SCHEMA.filter((i) => i.type === 'boolean').map((i) => i.key);
  assert.equal(boxes.length, boolKeys.length, '复选框数量应等于 schema 布尔项数量');
  for (const k of boolKeys) {
    const expected = cfg[k];
    const hit = boxes.filter((b) => b.props.checked === expected);
    assert.ok(hit.length > 0, `${k} 的 checked 应等于默认值 ${expected}`);
  }
});

test('组件：onChange 立即回调（配置即时生效）', () => {
  const react = mockReact();
  const changes = [];
  createSettingsCard(react, { config: defaultConfig(), onChange: (k, v) => changes.push([k, v]) });
  const box = react.calls.find((c) => c.type === 'input' && c.props.type === 'checkbox');
  box.props.onChange({ target: { checked: true } });
  assert.equal(changes.length, 1, 'onChange 应被立即调用一次');
  assert.equal(changes[0][1], true, '回调值应为勾选后的真值');
  assert.ok(typeof changes[0][0] === 'string' && changes[0][0].length > 0, '回调应带设置键名');
});

test('组件：enum 渲染选项齐全', () => {
  const react = mockReact();
  createSettingsCard(react, {});
  const opts = react.calls.filter((c) => c.type === 'option').map((c) => c.props.value);
  // 2026-09-13：新增「推送通道」enum（ssh/api/auto）。
  // 2026-09-17：审计强度 enum 已删除（quick/standard/deep 不再出现在界面），
  //   审计范围 enum（diff/full）与推送通道 enum（ssh/api/auto）保留。
  assert.deepEqual(opts.sort(), ['api', 'auto', 'diff', 'full', 'ssh']);
});

test('源码：不含 JSX 语法（无 <Tag> 形式）', () => {
  assert.ok(!/<[A-Z][A-Za-z]*[\s/>]/.test(clientSrc), '源码不应含 JSX 标签');
  assert.ok(!clientSrc.includes('jsx-runtime'), '不应依赖 jsx-runtime');
});

// ---------- 零外部资源 ----------
test('零外部资源：内联 CSS 无外链/url()/@import', () => {
  assert.deepEqual(collectExternalRefs(INLINE_CSS), []);
  assert.ok(!INLINE_CSS.includes('@import'));
  assert.ok(!INLINE_CSS.includes('url('));
});

test('零外部资源：自检能抓出外链（自检有效性）', () => {
  const bad = '.a { background: url(https://cdn.example.com/x.png); } @import "http://x/y.css";';
  const refs = collectExternalRefs(bad);
  assert.ok(refs.length >= 2, `应抓出外部引用，实际 ${refs.length}`);
});

test('模块描述：jsx=false、外链为空、默认配置已带出', () => {
  const info = clientModuleInfo();
  assert.equal(info.jsx, false);
  assert.deepEqual(info.externalResources, []);
  assert.equal(info.defaultConfig.auditEnabled, false);
  assert.deepEqual(info.slots, ['settings.section']);
});

test('模块描述：不实现 viewer（0.1.8 决策）', () => {
  const info = clientModuleInfo();
  assert.ok(!JSON.stringify(info).includes('viewer'), '侧边栏不应含提交历史查看器入口');
});
// ---------- 根 client.js（DSH 客户端插件适配层，1.0.0） ----------
const rootClientSrc = readFileSync(join(ROOT, 'client.js'), 'utf8');

test('client.js：DSH 模块加载器格式（2026-09-12 完全移植 v1 结构）', () => {
  assert.ok(rootClientSrc.includes('__ModuleLoader__.load'), '应为 DSH 客户端模块入口');
  assert.ok(rootClientSrc.includes("id: 'dsh-git-push'"));
  // v1 验证过的结构：jsx-runtime（jsx.jsx/jsxs）+ Controller + card.inject hooks 模式
  assert.ok(rootClientSrc.includes('jsx-runtime') || rootClientSrc.includes('react.createElement'), 'v1 结构：jsx-runtime 或手写 createElement');
});

test('client.js：零外部资源（内联 CSS 无外链/url()/@import）', () => {
  // 三选项卡版：css 变量名 dshgp_css（字符串数组）；取数组元素拼起来检查
  const cssMatch = /const dshgp_css = \[([\s\S]*?)\n(\s*)\]\.join\(''\)/.exec(rootClientSrc);
  assert.ok(cssMatch, '应能取到 dshgp_css 数组');
  const css = cssMatch[1].split(',').join('\n');
  assert.deepEqual(collectExternalRefs(css), []);
  assert.ok(!css.includes('@import'));
  assert.ok(!css.includes('url('));
  // 源码整体不应出现真实外链字符串
  assert.ok(!/['"`]https?:\/\//.test(rootClientSrc), '不应引用外部 URL');
});

test('client.js：审计相关开关默认关（2026-09-12 三选项卡版）', () => {
  // 2026-09-12 三选项卡重写：v1 移植的注入/硬编码全量扫等开关已移出 client.js（纯展示/审计/设置三页）
  // 保留的审计默认关：Controller 初始 auditEnabled=false
  assert.ok(/this\.auditEnabled = false/.test(rootClientSrc), 'auditEnabled 应默认 false');
  assert.ok(!rootClientSrc.includes("'llmAudit'"), 'client.js 不应含 llmAudit（v2 不提供 LLM 深度审查）');
  assert.ok(!rootClientSrc.includes("'pushPermitEnabled'"), 'client.js 不应含 pushPermitEnabled（已移除 2026-09-11）');
});

test('client.js：设置项键（2026-09-12 三选项卡：客户端写回键须在 Host Config）', () => {
  // 三选项卡版 client.js 写回的键（settingsScope.set）：token/ssh/审计开关/规则次序/权重覆盖
  const clientKeys = ['githubToken', 'sshPub', 'auditEnabled', 'auditRuleOrder', 'weightOverrides'];
  for (const k of clientKeys) {
    assert.ok(rootClientSrc.includes(k), `client.js 缺设置键引用 ${k}`);
  }
  // 与 Host Config 一致：客户端能写的键 Host 必须也有。
  // 1.1.4 起 Config 定义在 lib/app/schema.js（入口 lib/index.js 只做再导出），
  // 故两处都读——免得下次再挪位置又把测试改一遍。
  const hostSrc = ['lib/app/schema.js', 'lib/index.js']
    .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  for (const k of clientKeys) {
    assert.ok(hostSrc.includes(`${k}:`), `Host Config 缺 ${k}`);
  }
});

test('client.js：不实施 viewer', () => {
  assert.ok(!rootClientSrc.includes('viewer'));
});

// 1.0.10 回归：ctx.get('ruleSlotMeta') 对未 inject 声明抛 "cannot get property without inject"
// （vendor/cordis/lib 675 行）曾导致 apply 崩溃 → 设置侧边栏空白。修复：try/catch 兜底。
// 2026-09-12：配置卡已删除，只保留 settings.section（三选项卡侧边栏页）。
test('client.js apply：ctx.get 抛错不崩，settings.section 注册且渲染不崩（1.0.10 回归 + 三选项卡）', () => {
  // 捕获 ModuleLoader.load 的 factory
  let captured = null;
  const prevWindow = globalThis.window;
  globalThis.window = { __ModuleLoader__: { load: ({ id, factory }) => { captured = { id, factory }; } } };
  const reactMock = {
    createElement: () => ({ __mock: 'el' }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    // 1.0.14：GitPushCard 用 uSES 桥接读取 settings 快照（scope.use 不存在）
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  };
  const req = (name) => {
    if (name === 'react') return reactMock;
    // v1 结构依赖（2026-09-12 完全移植 v1）：jsx-runtime / primitives / store
    if (name === 'react/jsx-runtime') return { jsx: reactMock.createElement, jsxs: reactMock.createElement };
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconChevronDownOutline14: 'icon-mock' };
    if (name === '@deepseek-ai/dsh-client-store') return {
      createSnapshotStore: (initial) => {
        let value = initial;
        const listeners = new Set();
        return {
          getSnapshot: () => value,
          set: (v) => { value = v; listeners.forEach((l) => l()); },
          subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
        };
      },
    };
    throw new Error('require: ' + name);
  };
  // 执行根 client.js 顶层（触发 ModuleLoader.load）
  new Function('require', 'window', rootClientSrc)(req, globalThis.window); // dsh-skip-sensitive: 沙箱执行仓库内 client.js 顶层（受控源码，非外部输入）
  globalThis.window = prevWindow;
  assert.ok(captured, 'ModuleLoader.load 应被调用');
  const mod = captured.factory(req);
  assert.deepEqual(mod.inject, ['slots', 'settingsScope'], 'inject 依赖声明（2026-09-12 纯中文：不再依赖 locale）');

  // mock ctx：get 必抛（模拟 cordis 未 inject 行为）
  const registered = [];
  const scopeMock = {
    // 官方 SettingsScope 契约：getSnapshot/subscribe/set（无 use()——1.0.14 修复点）
    getSnapshot: () => ({ status: 'ready', value: { auditEnabled: false, auditScanScope: 'diff', auditLevel: 'standard', auditRuleset: '', auditRuleOrder: ['nodejs'], weightOverrides: '' } }),
    subscribe: () => () => {},
    set: async () => {}, mutate: async () => {}, unset: async () => {},
  };
  const ctx = {
    effect: () => {},
    get: () => { throw new Error('cannot get property "ruleSlotMeta" without inject'); },
    slots: {
      register: (desc, component) => ({ ...desc, component }),
      inject: (name, registerFn) => { registered.push({ slot: name, desc: registerFn() }); },
    },
    settingsScope: { bind: () => scopeMock },
  };
  assert.doesNotThrow(() => mod.apply(ctx), 'apply 遇 ctx.get 抛错不得崩溃');

  // 2026-09-12 三选项卡：只注册 settings.section；settings.plugin.item 已删除
  assert.ok(!registered.some((r) => r.slot === 'settings.plugin.item'), 'settings.plugin.item 不应注册（已删除）');
  const secReg = registered.find((r) => r.slot === 'settings.section');
  assert.ok(secReg, 'settings.section 应注册');
  assert.equal(secReg.desc.id, 'dsh-git-push');
  assert.doesNotThrow(() => secReg.desc.component(), '侧边栏 section 渲染不得抛错');
  assert.ok(registered.some((r) => r.slot === 'settings.section' && r.desc.id === 'dsh-git-push'), 'settings.section 应注册');
});
