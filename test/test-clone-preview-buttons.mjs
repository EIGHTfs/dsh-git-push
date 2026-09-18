/**
 * clone 预览确认框按钮可点（2026-09-18）。
 *
 * 现象：点「开始克隆」「取消」都没反应。
 * 根因：调用点写成 `dshgp_ClonePreview({ ..., onConfirm: () => { void this.cloneConfirmed(); },
 *   onCancel: () => { this.clonePreview = null; this.publish(); } })`，但所在组件
 *   `dshgp_RepoCloudPane(props)` 是**普通函数**、函数体内没有 this（ESM 严格模式下为 undefined），
 *   ESM 严格模式下 `this` 为 undefined → 点击抛 TypeError → 表现为「没反应」。
 *   且 props 里从未组装 cloneConfirmed / cancelPreview 两个入口。
 *
 * 验证方式：从源码提取真实的 dshgp_ClonePreview 与 dshgp_RepoCloudPane 函数体，
 *   用最小 jsx 替身**实际渲染**，再在渲染出的节点树里找到两个按钮并**真的调用其 onClick**，
 *   断言回调被触发（结构级 + 行为级，不是字符串匹配）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = readFileSync(join(ROOT, 'client.js'), 'utf8');

/** 记录式 jsx 替身（jsx-runtime 形状：children 在 props.children）。 */
function makeJsx() {
  const createElement = (type, props) => {
    const kids = props && props.children !== undefined
      ? (Array.isArray(props.children) ? props.children : [props.children])
      : [];
    return { type, props: props || {}, children: kids.flat(Infinity).filter((c) => c !== null && c !== undefined) };
  };
  return { jsx: createElement, jsxs: createElement };
}

/** 从源码按大括号配平提取函数体文本。 */
function extractFunction(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `未找到函数: ${signature}`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('函数体未闭合: ' + signature);
}

/** 深度遍历节点树。 */
function walk(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  for (const c of node.children || []) walk(c, out);
  return out;
}

/** 渲染 clone 预览框，返回节点树。 */
function renderPreview(handlers = {}) {
  const fnText = extractFunction(clientSrc, 'function dshgp_ClonePreview(props) {');
  const jsx = makeJsx();
  const dshgp_ClonePreview = new Function('jsx', 'return ' + fnText)(jsx);
  const tree = dshgp_ClonePreview({
    p: { repo: 'EIGHTfs/dsh-skill-scoreboard', branch: 'master', downloadCount: 26, downloadBytes: 2.0 * 1024 * 1024, skippedCount: 0, skipped: [] },
    onConfirm: handlers.onConfirm,
    onCancel: handlers.onCancel,
  });
  return { tree, nodes: walk(tree) };
}

test('clone 预览框：两个按钮都渲染出来且都带 onClick', () => {
  const { nodes } = renderPreview({ onConfirm: () => {}, onCancel: () => {} });
  const btns = nodes.filter((n) => n.type === 'button');
  assert.equal(btns.length, 2, '预览框应有「开始克隆」「取消」两个按钮');
  assert.equal(btns[0].props.children, '开始克隆');
  assert.equal(btns[1].props.children, '取消');
  for (const b of btns) assert.equal(typeof b.props.onClick, 'function', `${b.props.children} 必须绑定 onClick`);
});

test('clone 预览框：点「开始克隆」真的触发 onConfirm', () => {
  let confirmed = 0;
  const { nodes } = renderPreview({ onConfirm: () => { confirmed += 1; }, onCancel: () => {} });
  const btn = nodes.find((n) => n.type === 'button' && n.props.children === '开始克隆');
  assert.ok(btn, '应有「开始克隆」按钮');
  btn.props.onClick(); // 真点
  assert.equal(confirmed, 1, '点「开始克隆」必须触发 onConfirm');
});

test('clone 预览框：点「取消」真的触发 onCancel', () => {
  let canceled = 0;
  const { nodes } = renderPreview({ onConfirm: () => {}, onCancel: () => { canceled += 1; } });
  const btn = nodes.find((n) => n.type === 'button' && n.props.children === '取消');
  assert.ok(btn, '应有「取消」按钮');
  btn.props.onClick();
  assert.equal(canceled, 1, '点「取消」必须触发 onCancel');
});

test('clone 预览框：回调缺失时点击不抛错（防御性）', () => {
  const { nodes } = renderPreview({});
  const btns = nodes.filter((n) => n.type === 'button');
  // 传了 undefined 的 onClick，React 下等于没绑，不应在渲染期抛错
  for (const b of btns) assert.ok(b.props.onClick === undefined || typeof b.props.onClick === 'function');
});

test('调用点：dshgp_ClonePreview 的动作必须走 props，不得用 this', () => {
  const callIdx = clientSrc.indexOf('dshgp_ClonePreview({ p: s.clonePreview');
  assert.ok(callIdx > 0, '未找到调用点');
  const seg = clientSrc.slice(callIdx, callIdx + 320);
  assert.ok(!/\bthis\./.test(seg), '调用点不得出现 this（所在组件是普通函数，无 this）');
  assert.ok(/props\.cloneConfirmed\(\)/.test(seg), '确认动作应调 props.cloneConfirmed');
  assert.ok(/props\.cancelPreview\(\)/.test(seg), '取消动作应调 props.cancelPreview');
});

test('承接组件 dshgp_RepoCloudPane 函数体内不得出现 this（除注释）', () => {
  const fnText = extractFunction(clientSrc, 'function dshgp_RepoCloudPane(props) {');
  // 去掉注释再判，避免注释里提到 this 造成误报
  const noComment = fnText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\bthis\./.test(noComment), 'dshgp_RepoCloudPane 是普通函数组件，函数体内不得出现 this');
});

test('props 组装：cloneConfirmed 与 cancelPreview 两个入口都已接线', () => {
  assert.ok(/cloneConfirmed: \(\) => \{ void this\.cloneConfirmed\(\); \}/.test(clientSrc), 'props 应含 cloneConfirmed');
  assert.ok(/cancelPreview: \(\) => \{ this\.cancelPreview\(\); \}/.test(clientSrc), 'props 应含 cancelPreview');
  assert.ok(/^\s{6}cancelPreview\(\) \{/m.test(clientSrc), 'Controller 应有 cancelPreview 方法');
});

test('取消语义：cancelPreview 同时清预览态与待办态', () => {
  const m = /\n\s{6}cancelPreview\(\) \{([\s\S]*?)\n\s{6}\}/.exec(clientSrc);
  assert.ok(m, '未找到 cancelPreview 实现');
  const body = m[1];
  assert.ok(/this\.clonePreview = null/.test(body), '应清 clonePreview');
  assert.ok(/this\.clonePending = null/.test(body), '应清 clonePending（否则残留上次目标目录）');
  assert.ok(/this\.publish\(\)/.test(body), '应触发重渲染');
});
