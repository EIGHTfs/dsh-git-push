/**
 * button-bind 事件识别范围回归（起因：外部项目实测反馈）。
 *
 * 现象：三处 `<input type="file">`（隐藏 input + `<label>`，靠 `label.click()` 原生行为
 *   打开文件选择框）被报「创建了按钮但没有绑定点击事件」。
 *
 * 判定：这是**能力不足**（规则判错事实），不是误报——这三处根本不需要 click：
 *   `<input type="file">` 的正当事件是 `change`（拿文件内容），触发靠原生 label 点击。
 *   旧实现只把 `.addEventListener('click')` / `.onclick=` / `.on('click')` 视为绑定证据，
 *   于是：① 表单控件绑 change/input 一律被判未绑；② 文件选择框被判未绑。
 *
 * 附加缺陷（同一轮反馈指出，更严重）：`button-bind` 这个 kind **不在任何豁免标记的
 *   blocked 列表里**，而两条 button 规则的 `exemptHint` 却写着 `dsh-skip-quality`
 *   ⇒ 用户按提示写文件头标记完全不生效、且找不到别的标记可用。
 *
 * 本测试锁定四条边界：
 *   ① 文件选择框（原生 label.click() 触发）→ 不报
 *   ② 表单控件绑 change → 不报
 *   ③ 真按钮无绑定 → 仍报（不许无谓放宽）
 *   ④ 裸 input 无 handler 也无程序化触发 → 仍报
 * 另外锁定 button-bind 的豁免路径真实可用。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { auditFull } from '../lib/audit/orchestrate.js';
import { exemptHintForFinding } from '../lib/exempt/index.js';

/** 在临时仓库里写若干源文件并跑全量审计，返回 button-bind 类 finding。 */
async function auditFiles(files) {
  const dir = mkdtempSync(join(tmpdir(), 'btn-bind-'));
  try {
    mkdirSync(dir, { recursive: true });
    for (const [name, code] of Object.entries(files)) writeFileSync(join(dir, name), code, 'utf8');
    const r = await auditFull(dir, { scope: 'full', maxScanFiles: 50 });
    return (r.findings || []).filter((f) => f.kind === 'button-bind');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('文件选择框：隐藏 input + label.click() 原生触发 → 不报', async () => {
  const hits = await auditFiles({
    'picker.js': [
      'export function mount(root) {',
      "  const label = document.createElement('label');",
      "  const input = document.createElement('input');",
      "  input.type = 'file';",
      '  label.appendChild(input);',
      '  root.appendChild(label);',
      '  label.click();',
      '}',
    ].join('\n'),
  });
  assert.equal(hits.length, 0, `文件选择框不应被报未绑定：${JSON.stringify(hits.map((h) => h.message))}`);
});

test('表单控件：绑 change 即为已绑定 → 不报', async () => {
  const hits = await auditFiles({
    'field.js': [
      'export function mount(root) {',
      "  const el = document.createElement('input');",
      "  el.setAttribute('type', 'text');",
      "  el.addEventListener('change', () => {});",
      '  root.appendChild(el);',
      '}',
    ].join('\n'),
  });
  assert.equal(hits.length, 0, `绑 change 的表单控件不应被报：${JSON.stringify(hits.map((h) => h.message))}`);
});

test('真按钮无任何绑定 → 仍要报（不许无谓放宽）', async () => {
  const hits = await auditFiles({
    'bad.js': [
      'export function mount(root) {',
      "  const btn = document.createElement('button');",
      "  btn.textContent = 'ok';",
      '  root.appendChild(btn);',
      '}',
    ].join('\n'),
  });
  assert.equal(hits.length, 1, '未绑定的真按钮必须仍然被报');
});

test('裸 input：无 handler 也无程序化触发 → 仍要报', async () => {
  const hits = await auditFiles({
    'bare.js': [
      'export function mount(root) {',
      "  const el = document.createElement('input');",
      "  el.setAttribute('type', 'text');",
      '  root.appendChild(el);',
      '}',
    ].join('\n'),
  });
  assert.equal(hits.length, 1, '既无 handler 也无触发的 input 必须仍然被报');
});

test('button 混在文件中时：只有 change 证据不算按钮已绑定', async () => {
  // 语义边界：alt 事件（change/input/…）对 button 不是绑定证据——按钮的正当交互是 click 类
  const hits = await auditFiles({
    'mixed.js': [
      'export function mount(root, form) {',
      "  const btn = document.createElement('button');",
      "  btn.textContent = 'ok';",
      '  root.appendChild(btn);',
      "  form.addEventListener('change', () => {});",
      '}',
    ].join('\n'),
  });
  assert.equal(hits.length, 1, 'change 监听不能证明 button 已绑定');
});

test('button-bind 有可用豁免标记，且与 finding 的 exemptHint 一致', () => {
  // 反馈里最要紧的一条：该 kind 此前没有任何标记可豁免，提示却指向 dsh-skip-quality
  const hint = exemptHintForFinding({ rule: 'button/create-element-binding', kind: 'button-bind' });
  assert.ok(hint && hint.marker, 'button-bind 必须能反查到可用标记（否则用户无从豁免）');
  assert.equal(hint.marker, 'dsh-skip-quality', '应落在质量标记（与规则的 exemptHint 提示一致）');
  // unbound 与 create-element-binding 同 kind，覆盖同一标记
  const hint2 = exemptHintForFinding({ rule: 'button/unbound', kind: 'button-bind' });
  assert.equal(hint2 && hint2.marker, 'dsh-skip-quality');
});

test('文件头写 dsh-skip-quality 后，未绑定按钮不再被报（标记真生效）', async () => {
  const hits = await auditFiles({
    'skip.js': [
      '// dsh-skip-quality: 该按钮由宿主事件委托统一处理，无法在本文件内体现',
      'export function mount(root) {',
      "  const btn = document.createElement('button');",
      '  root.appendChild(btn);',
      '}',
    ].join('\n'),
  });
  assert.equal(hits.length, 0, '写豁免标记后应真正不报（提示与行为必须一致）');
});
