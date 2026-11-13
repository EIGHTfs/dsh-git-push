/**
 * 审计 UI 契约测试（lib/audit-ui-sdk）。
 *
 * 为什么要有这层门禁：这份契约的全部价值在于「坏实现**在构建期**就被挡住」。
 *   契约本身没有行为可测（它不渲染、不跑审计），能测的只有两件事：
 *   ① 该拒的必须拒，而且错误信息要能直接定位到字段（否则作者只能翻文档猜）；
 *   ② 该放行的不能被误拒（猜意图的校验就是在这一步翻车的）。
 *   另外钉住两条结构性不变量：唯一导出面（多一个符号就要有人解释）、契约零依赖（能进浏览器产物）。
 *
 * 注意断言方式：测试跑在 ESM 严格模式下，给冻结对象赋值会**抛 TypeError**；
 *   非严格模式下是静默无效 —— 两种都算「挂不上字段」，这里断言的是前者（当前运行形态）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as sdk from '../../lib/audit-ui-sdk/index.js';
import * as contract from '../../lib/audit-ui-sdk/contract.js';

const ROOT = new URL('../../', import.meta.url);

/** 合法定义的最小形态（各用例在此基础上改一处）。 */
function makePanel(patch = {}) {
  return {
    meta: { id: 'default-audit', name: '默认审计面板', contractVersion: sdk.AUDIT_UI_CONTRACT_VERSION },
    Panel: () => null,
    ...patch,
  };
}

/** 断言抛错且错误信息包含全部关键词（用于证明「错误信息带字段名、可诊断」）。 */
function assertThrowsWith(fn, keywords, label) {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error, `${label}：应当抛错但没有`);
  const message = String(error.message || error);
  for (const keyword of keywords) {
    assert.ok(message.includes(keyword), `${label}：错误信息缺「${keyword}」，实际为：${message}`);
  }
  return message;
}

// ── ① 合法定义：通过、返回冻结对象 ──────────────────────────────────
test('契约：合法定义通过，返回冻结的新对象（含 meta 单独冻结）', () => {
  const definition = makePanel({ styles: '[data-audit-panel] { color: red }', setup: () => () => {} });
  const panel = sdk.defineAuditPanel(definition);
  assert.equal(panel.meta.id, 'default-audit');
  assert.equal(panel.meta.name, '默认审计面板');
  assert.equal(panel.meta.contractVersion, 1);
  assert.equal(typeof panel.Panel, 'function');
  assert.equal(panel.styles, '[data-audit-panel] { color: red }');
  assert.equal(typeof panel.setup, 'function');
  assert.ok(Object.isFrozen(panel), '返回对象必须冻结（运行期挂字段要显式失败）');
  assert.ok(Object.isFrozen(panel.meta), 'meta 必须一起冻结（深冻结，只冻外层可绕过）');
});

test('契约：冻结有效——给面板对象/meta 挂字段会抛错（严格模式）', () => {
  const panel = sdk.defineAuditPanel(makePanel());
  assert.throws(() => { panel.extra = 1; }, TypeError, '往冻结的面板对象挂字段应抛 TypeError');
  assert.throws(() => { panel.meta.id = 'hacked'; }, TypeError, '往冻结的 meta 挂字段应抛 TypeError');
});

test('契约：未登记的字段不会带进产物（契约面固定为 meta/Panel/styles/setup）', () => {
  const panel = sdk.defineAuditPanel(makePanel({ extraField: '不该出现', meta: { ...makePanel().meta, extraMeta: '也不该出现' } }));
  assert.deepEqual(Object.keys(panel).sort(), ['Panel', 'meta', 'setup', 'styles'], '顶层只留契约字段');
  assert.deepEqual(Object.keys(panel.meta).sort(), ['contractVersion', 'id', 'name'], 'meta 只留契约字段');
});

test('契约：合法 id 边界值放行（2 字符下限 / 32 字符上限 / 含数字与连字符）', () => {
  for (const id of ['ab', 'a1', 'audit-v2-panel', `a${'b'.repeat(31)}`]) {
    const panel = sdk.defineAuditPanel(makePanel({ meta: { ...makePanel().meta, id } }));
    assert.equal(panel.meta.id, id, `合法 id 被误拒：${id}`);
  }
});

// ── ② meta.id 非法：拒 + 带字段名与要求 ────────────────────────────
test('契约：meta.id 非法一律拒绝，且错误信息带字段名与要求的正则', () => {
  const badIds = ['Default-audit', 'default_audit', 'a', `a${'b'.repeat(32)}`, '', 123, undefined];
  for (const id of badIds) {
    assertThrowsWith(
      () => sdk.defineAuditPanel(makePanel({ meta: { ...makePanel().meta, id } })),
      ['meta.id', '/^[a-z][a-z0-9-]{1,31}$/'],
      `id=${JSON.stringify(id)}`,
    );
  }
});

test('契约：meta 缺失或非对象 → 拒绝并说明要求', () => {
  for (const meta of [undefined, null, 'default-audit', 42]) {
    assertThrowsWith(() => sdk.defineAuditPanel(makePanel({ meta })), ['meta'], `meta=${JSON.stringify(meta)}`);
  }
});

test('契约：meta.name 空串/非字符串 → 拒绝（带字段名）', () => {
  for (const name of ['', '   ', 42, undefined]) {
    assertThrowsWith(
      () => sdk.defineAuditPanel(makePanel({ meta: { ...makePanel().meta, name } })),
      ['meta.name'],
      `name=${JSON.stringify(name)}`,
    );
  }
});

// ── ③ 版本不匹配：拒 + 说明当前版本 ────────────────────────────────
test('契约：contractVersion 不匹配 → 拒绝并说明「当前 SDK 是 N」', () => {
  for (const version of [0, 2, '1', undefined]) {
    // 错误信息必须同时给出「面板写的值」与「当前 SDK 的值」，否则作者不知道该改成什么
    const message = assertThrowsWith(
      () => sdk.defineAuditPanel(makePanel({ meta: { ...makePanel().meta, contractVersion: version } })),
      ['meta.contractVersion', `当前 SDK 是 ${sdk.AUDIT_UI_CONTRACT_VERSION}`],
      `contractVersion=${JSON.stringify(version)}`,
    );
    assert.ok(message.includes(JSON.stringify(version)), `错误信息应回显面板写的版本值：${message}`);
  }
});

// ── ④ 必填/可选形状 ────────────────────────────────────────────────
test('契约：缺 Panel 或 Panel 非函数 → 拒绝（带字段名）', () => {
  assertThrowsWith(() => sdk.defineAuditPanel({ meta: makePanel().meta }), ['Panel'], '缺 Panel');
  for (const Panel of [null, 'div', 42, {}]) {
    assertThrowsWith(() => sdk.defineAuditPanel(makePanel({ Panel })), ['Panel'], `Panel=${typeof Panel}`);
  }
});

test('契约：styles 非字符串 → 拒绝；setup 非函数 → 拒绝（都带字段名）', () => {
  for (const styles of [42, null, {}, ['a']]) {
    assertThrowsWith(() => sdk.defineAuditPanel(makePanel({ styles })), ['styles'], `styles=${JSON.stringify(styles)}`);
  }
  for (const setup of [42, 'init', {}, []]) {
    assertThrowsWith(() => sdk.defineAuditPanel(makePanel({ setup })), ['setup'], `setup=${JSON.stringify(setup)}`);
  }
});

test('契约：参数不是对象（含数组/字符串/null）→ 拒绝并给出期望形状', () => {
  for (const definition of [null, undefined, 'panel', 42, []]) {
    assertThrowsWith(() => sdk.defineAuditPanel(definition), ['defineAuditPanel', '{ meta, Panel'], String(definition));
  }
});

// ── ⑤ 结构性不变量：唯一导出面 / 零依赖 / 常量冻结 ──────────────────
test('唯一导出面：index.js 只导出承诺的 6 个符号（多一个都要有人解释）', () => {
  const exported = Object.keys(sdk).sort();
  assert.deepEqual(exported, [
    'AUDIT_PANEL_ACTION_KEYS',
    'AUDIT_PANEL_DATA_KEYS',
    'AUDIT_PANEL_ID_PATTERN',
    'AUDIT_PANEL_STATE_KEYS',
    'AUDIT_UI_CONTRACT_VERSION',
    'defineAuditPanel',
  ].sort(), `导出面变了：${exported.join(', ')}。若确认要扩契约，请同时改本条断言与 docs/SPEC.md 第十一节`);
});

test('唯一导出面：index.js 是纯 re-export，不夹带自己的实现', () => {
  const source = readFileSync(new URL('lib/audit-ui-sdk/index.js', ROOT), 'utf8');
  // 只允许 re-export 与注释；出现函数定义/常量赋值就说明有实现混进导出面
  assert.doesNotMatch(source, /^\s*(export\s+)?(function|class)\s/m, 'index.js 不应包含函数/类定义');
  assert.doesNotMatch(source, /^\s*(export\s+)?(const|let|var)\s/m, 'index.js 不应包含自己的常量');
});

test('契约零依赖：contract.js 不 import 任何模块（要能同时进构建脚本与浏览器产物）', () => {
  const source = readFileSync(new URL('lib/audit-ui-sdk/contract.js', ROOT), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m, 'contract.js 出现 import —— 契约层必须零依赖');
  assert.doesNotMatch(source, /\brequire\s*\(/, 'contract.js 出现 require —— 契约层必须零依赖');
});

test('契约常量本身不可篡改：键清单数组被冻结，push 会抛错', () => {
  for (const [name, list] of [
    ['AUDIT_PANEL_DATA_KEYS', sdk.AUDIT_PANEL_DATA_KEYS],
    ['AUDIT_PANEL_ACTION_KEYS', sdk.AUDIT_PANEL_ACTION_KEYS],
    ['AUDIT_PANEL_STATE_KEYS', sdk.AUDIT_PANEL_STATE_KEYS],
  ]) {
    assert.ok(Object.isFrozen(list), `${name} 必须冻结（宿主与实现共用，不能被某一方改掉）`);
    assert.throws(() => { list.push('added'); }, TypeError, `${name} 被 push 应抛 TypeError`);
  }
});

test('props 键清单与 docs/SPEC.md 第十一节一致（防止文档改了 SDK 没跟）', () => {
  const spec = readFileSync(new URL('docs/SPEC.md', ROOT), 'utf8');
  const section = spec.slice(spec.indexOf('## 十一、审计 UI 契约'));
  assert.ok(section.length > 0, '未找到 SPEC 第十一节');
  for (const key of [...sdk.AUDIT_PANEL_DATA_KEYS, ...sdk.AUDIT_PANEL_ACTION_KEYS, ...sdk.AUDIT_PANEL_STATE_KEYS]) {
    assert.ok(section.includes(key), `SPEC 第十一节未提及契约键 ${key}（文档与 SDK 已漂移）`);
  }
  // 抽查三组的分组名也在（data / actions / state），避免「键都在但挂错组」
  for (const group of ['data', 'actions', 'state']) assert.ok(section.includes(group), `SPEC 第十一节未提及 ${group}`);
});

test('契约版本常量与 contract.js 内部一致（index 不会导出过期值）', () => {
  assert.equal(sdk.AUDIT_UI_CONTRACT_VERSION, contract.AUDIT_UI_CONTRACT_VERSION);
  assert.equal(sdk.AUDIT_UI_CONTRACT_VERSION, 1, '破坏性改动必须 +1，且同步 docs/SPEC.md 第十一节');
});
