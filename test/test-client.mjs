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
test('默认关：审计开关/推送许可/LLM/全量扫 全部默认 false', () => {
  const c = defaultConfig();
  assert.equal(c.auditEnabled, false);
  assert.equal(c.pushPermitEnabled, false);
  assert.equal(c.llmAudit, false);
  assert.equal(c.hardcodeFullScan, false);
  assert.equal(c.injectFullSkill, false);
  assert.equal(c.injectRepoIndexFull, false);
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
  assert.equal(resolveConfig({ commitMessage: 123 }).commitMessage, '123');
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

test('组件：复选框 checked 反映配置真值（默认关 → false）', () => {
  const react = mockReact();
  createSettingsCard(react, { config: defaultConfig() });
  const boxes = react.calls.filter((c) => c.type === 'input' && c.props.type === 'checkbox');
  assert.ok(boxes.length > 0);
  for (const b of boxes) assert.equal(b.props.checked, false, '默认应为未勾选');
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
  assert.deepEqual(opts.sort(), ['deep', 'diff', 'full', 'quick', 'standard']);
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
  assert.deepEqual(info.slots, ['settings.section', 'settings.plugin.item']);
});

test('模块描述：不实现 viewer（0.1.8 决策）', () => {
  const info = clientModuleInfo();
  assert.ok(!JSON.stringify(info).includes('viewer'), '侧边栏不应含提交历史查看器入口');
});
// ---------- 根 client.js（DSH 客户端插件适配层，1.0.0） ----------
const rootClientSrc = readFileSync(join(ROOT, 'client.js'), 'utf8');

test('client.js：DSH 模块加载器格式 + 手写 createElement 无 JSX', () => {
  assert.ok(rootClientSrc.includes('__ModuleLoader__.load'), '应为 DSH 客户端模块入口');
  assert.ok(rootClientSrc.includes("id: 'dsh-git-push'"));
  assert.ok(rootClientSrc.includes('react.createElement') || rootClientSrc.includes('const h = react.createElement'));
  assert.ok(!/jsx-runtime/.test(rootClientSrc), '不应依赖 jsx-runtime');
});

test('client.js：零外部资源（内联 CSS 无外链/url()/@import）', () => {
  // 取源码里 INLINE_CSS 常量文本做实际检查（注释中提及 url() 属说明文字）
  const cssMatch = /const INLINE_CSS = ([\s\S]*?);\n/.exec(rootClientSrc);
  assert.ok(cssMatch, '应能取到 INLINE_CSS 常量');
  assert.deepEqual(collectExternalRefs(cssMatch[1]), []);
  assert.ok(!cssMatch[1].includes('@import'));
  assert.ok(!cssMatch[1].includes('url('));
  // 源码整体不应出现真实外链字符串
  assert.ok(!/['"`]https?:\/\//.test(rootClientSrc), '不应引用外部 URL');
});

test('client.js：开关默认关（与服务端 schema 一致）', () => {
  for (const key of ['auditEnabled', 'pushPermitEnabled', 'llmAudit', 'hardcodeFullScan', 'injectFullSkill']) {
    assert.ok(new RegExp(`key: '${key}', type: 'boolean', default: false`).test(rootClientSrc), `${key} 应默认 false`);
  }
});

test('client.js：设置项与服务端 SETTINGS_SCHEMA 键一致', () => {
  const serverKeys = SETTINGS_SCHEMA.map((s) => s.key).filter((k) => !['commitMessage', 'injectRepoIndexFull'].includes(k));
  for (const k of serverKeys) {
    assert.ok(rootClientSrc.includes(`'${k}'`), `client.js 缺设置项 ${k}`);
  }
});

test('client.js：不实施 viewer', () => {
  assert.ok(!rootClientSrc.includes('viewer'));
});
