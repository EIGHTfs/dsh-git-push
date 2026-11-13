/**
 * test-button.mjs —— 同族测试合并（test-button-bind.mjs · test-button-bind-events.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { auditFull } from '../../lib/audit/orchestrate.js';
import { extractJsxButtons, readBalancedCall, checkButtonBindings } from '../../lib/checks/button-bind.js';
import { exemptHintForFinding } from '../../lib/exempt/index.js';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// ── 原 test-button-bind.mjs ──
{
  /**
   * 按钮绑定交叉比对的 jsx 工厂形态。
   *
   * 背景：本检查原先只认 innerHTML 字符串 / 反引号模板 / createElement，对
   *   `jsx.jsx('button', {...})` 这种调用式创建完全不可见——client.js 里 15 个按钮
   *   全是该形态，检查却报 0 条。补上提取后一度引入三类误报（本文件即锁死它们）：
   *   ① 把 `input` 也当按钮候选（input 用 onChange 传值，本就不需要 onClick）；
   *   ② 直接扫原文，注释里写的 jsx.jsx('button') 被当真按钮；
   *   ③ 事件判定同样扫原文，注释里写 `// onClick: 不算` 反被骗成「已绑定」。
   * 这里逐个锁住，并用正向用例确保「过滤注释」没有把真实按钮一起滤掉。
   */


  const RULES = [{ id: 'button/unbound', severity: 'warning', message: '按钮未绑定事件' }];
  /** 跑一次检查，返回 findings 条数。 */
  const count = (text) => checkButtonBindings({ file: 'sample.js', text, rules: RULES }).length;

  test('[button-bind] jsx 形态：真未绑定的按钮必须报出', () => {
    assert.equal(count("jsx.jsx('button', { type:'button', children:'x' })"), 1);
    assert.equal(count("jsx.jsxs('button', { type:'button', children:'x' })"), 1);
  });

  test('[button-bind] jsx 形态：带 onClick 的按钮不报（跨行属性对象亦然）', () => {
    assert.equal(count("jsx.jsx('button', { onClick: () => go(), children:'x' })"), 0);
    const multiLine = "jsx.jsx('button', {\n  type: 'button',\n  className: 'k',\n  onClick: () => go(),\n  children: 'x',\n})";
    assert.equal(count(multiLine), 0, '多行属性对象里的事件属性须能取到（只看单行会全judge成未绑定）');
  });

  test('[button-bind] jsx 形态：input 不作为按钮候选（input 用 onChange，无需 onClick）', () => {
    assert.equal(count("jsx.jsx('input', { type:'text', onChange: f })"), 0);
    assert.equal(count("jsx.jsx('input', { type:'text' })"), 0);
    assert.equal(extractJsxButtons("jsx.jsx('input', { type:'text' })").length, 0, 'input 不应进提取结果');
  });

  test('[button-bind] jsx 形态：注释里提到的按钮不算真按钮', () => {
    assert.equal(count("// jsx.jsx('button', {})\nconst a = 1;"), 0, '行注释');
    assert.equal(count("/* jsx.jsx('button', {}) */\nconst a = 1;"), 0, '块注释');
    assert.equal(extractJsxButtons("// jsx.jsx('button', {})\nconst a = 1;").length, 0);
  });

  test('[button-bind] jsx 形态：注释里的 onClick 不能充当绑定证据', () => {
    const src = "jsx.jsx('button', {\n  // onClick: 注释里写的不算\n  type:'button',\n  children:'y'\n})";
    assert.equal(count(src), 1, '注释里的 onClick 不得被当作已绑定');
  });

  test('[button-bind] jsx 形态：过滤注释后真实按钮仍须提取到（防过度过滤）', () => {
    assert.equal(count("// 说明\njsx.jsx('button', { type:'button', children:'z' })"), 1, '前一行有注释不影响本行按钮');
    const b = extractJsxButtons("// 说明\njsx.jsx('button', { type:'button', children:'z' })");
    assert.equal(b.length, 1);
    assert.equal(b[0].tag, 'button');
    assert.equal(b[0].line, 2, '行号应指向真实调用行');
  });

  test('[button-bind] jsx 形态：行号归属正确（跨行属性对象不漂到前一个调用）', () => {
    const src = "jsx.jsx('input', {\n  type: 'text',\n})\njsx.jsx('button', {\n  type: 'button',\n  children: 'x',\n})";
    const b = extractJsxButtons(src);
    assert.equal(b.length, 1, '只有 button 进提取结果');
    assert.equal(b[0].line, 4, 'button 在第 4 行（不得漂到第 1 行的 input）');
  });

  test('[button-bind] readBalancedCall：括号配平取完整调用（含字符串里的括号不计数）', () => {
    const src = "jsx.jsx('button', { children: ')(' , onClick: f })";
    const { snippet } = readBalancedCall(src, 0);
    assert.ok(snippet.includes('onClick'), '字符串里的括号不应提前结束片段');
    assert.ok(snippet.includes("')('"), '字符串内容须完整保留');
  });
}

// ── 原 test-button-bind-events.mjs ──
{
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

  test('[button-bind-events] 文件选择框：隐藏 input + label.click() 原生触发 → 不报', async () => {
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

  test('[button-bind-events] 表单控件：绑 change 即为已绑定 → 不报', async () => {
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

  test('[button-bind-events] 真按钮无任何绑定 → 仍要报（不许无谓放宽）', async () => {
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

  test('[button-bind-events] 裸 input：无 handler 也无程序化触发 → 仍要报', async () => {
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

  test('[button-bind-events] button 混在文件中时：只有 change 证据不算按钮已绑定', async () => {
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

  test('[button-bind-events] button-bind 有可用豁免标记，且与 finding 的 exemptHint 一致', () => {
    // 反馈里最要紧的一条：该 kind 此前没有任何标记可豁免，提示却指向 dsh-skip-quality
    const hint = exemptHintForFinding({ rule: 'button/create-element-binding', kind: 'button-bind' });
    assert.ok(hint && hint.marker, 'button-bind 必须能反查到可用标记（否则用户无从豁免）');
    assert.equal(hint.marker, 'dsh-skip-quality', '应落在质量标记（与规则的 exemptHint 提示一致）');
    // unbound 与 create-element-binding 同 kind，覆盖同一标记
    const hint2 = exemptHintForFinding({ rule: 'button/unbound', kind: 'button-bind' });
    assert.equal(hint2 && hint2.marker, 'dsh-skip-quality');
  });

  test('[button-bind-events] 文件头写 dsh-skip-quality 后，未绑定按钮不再被报（标记真生效）', async () => {
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
}
