/**
 * 按钮绑定交叉比对的 jsx 工厂形态（2026-09-18）。
 *
 * 背景：本检查原先只认 innerHTML 字符串 / 反引号模板 / createElement，对
 *   `jsx.jsx('button', {...})` 这种调用式创建完全不可见——client.js 里 15 个按钮
 *   全是该形态，检查却报 0 条。补上提取后一度引入三类误报（本文件即锁死它们）：
 *   ① 把 `input` 也当按钮候选（input 用 onChange 传值，本就不需要 onClick）；
 *   ② 直接扫原文，注释里写的 jsx.jsx('button') 被当真按钮；
 *   ③ 事件判定同样扫原文，注释里写 `// onClick: 不算` 反被骗成「已绑定」。
 * 这里逐个锁住，并用正向用例确保「过滤注释」没有把真实按钮一起滤掉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractJsxButtons, readBalancedCall, checkButtonBindings } from '../lib/checks/button-bind.js';

const RULES = [{ id: 'button/unbound', severity: 'warning', message: '按钮未绑定事件' }];
/** 跑一次检查，返回 findings 条数。 */
const count = (text) => checkButtonBindings({ file: 'sample.js', text, rules: RULES }).length;

test('jsx 形态：真未绑定的按钮必须报出', () => {
  assert.equal(count("jsx.jsx('button', { type:'button', children:'x' })"), 1);
  assert.equal(count("jsx.jsxs('button', { type:'button', children:'x' })"), 1);
});

test('jsx 形态：带 onClick 的按钮不报（跨行属性对象亦然）', () => {
  assert.equal(count("jsx.jsx('button', { onClick: () => go(), children:'x' })"), 0);
  const multiLine = "jsx.jsx('button', {\n  type: 'button',\n  className: 'k',\n  onClick: () => go(),\n  children: 'x',\n})";
  assert.equal(count(multiLine), 0, '多行属性对象里的事件属性须能取到（只看单行会全judge成未绑定）');
});

test('jsx 形态：input 不作为按钮候选（input 用 onChange，无需 onClick）', () => {
  assert.equal(count("jsx.jsx('input', { type:'text', onChange: f })"), 0);
  assert.equal(count("jsx.jsx('input', { type:'text' })"), 0);
  assert.equal(extractJsxButtons("jsx.jsx('input', { type:'text' })").length, 0, 'input 不应进提取结果');
});

test('jsx 形态：注释里提到的按钮不算真按钮', () => {
  assert.equal(count("// jsx.jsx('button', {})\nconst a = 1;"), 0, '行注释');
  assert.equal(count("/* jsx.jsx('button', {}) */\nconst a = 1;"), 0, '块注释');
  assert.equal(extractJsxButtons("// jsx.jsx('button', {})\nconst a = 1;").length, 0);
});

test('jsx 形态：注释里的 onClick 不能充当绑定证据', () => {
  const src = "jsx.jsx('button', {\n  // onClick: 注释里写的不算\n  type:'button',\n  children:'y'\n})";
  assert.equal(count(src), 1, '注释里的 onClick 不得被当作已绑定');
});

test('jsx 形态：过滤注释后真实按钮仍须提取到（防过度过滤）', () => {
  assert.equal(count("// 说明\njsx.jsx('button', { type:'button', children:'z' })"), 1, '前一行有注释不影响本行按钮');
  const b = extractJsxButtons("// 说明\njsx.jsx('button', { type:'button', children:'z' })");
  assert.equal(b.length, 1);
  assert.equal(b[0].tag, 'button');
  assert.equal(b[0].line, 2, '行号应指向真实调用行');
});

test('jsx 形态：行号归属正确（跨行属性对象不漂到前一个调用）', () => {
  const src = "jsx.jsx('input', {\n  type: 'text',\n})\njsx.jsx('button', {\n  type: 'button',\n  children: 'x',\n})";
  const b = extractJsxButtons(src);
  assert.equal(b.length, 1, '只有 button 进提取结果');
  assert.equal(b[0].line, 4, 'button 在第 4 行（不得漂到第 1 行的 input）');
});

test('readBalancedCall：括号配平取完整调用（含字符串里的括号不计数）', () => {
  const src = "jsx.jsx('button', { children: ')(' , onClick: f })";
  const { snippet } = readBalancedCall(src, 0);
  assert.ok(snippet.includes('onClick'), '字符串里的括号不应提前结束片段');
  assert.ok(snippet.includes("')('"), '字符串内容须完整保留');
});
