import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- 变量重命名位置定位（2026-09-30：按作用域聚合——单字母变量人工重命名辅助） ----------

import { locateVariables } from '../scripts/rename-locator.mjs';

test('rename-locator：同名不同作用域分组（x 在两个函数各自一组）', () => {
  const src = 'function processUser(user) {\n  const x = user.name\n  return x.trim()\n}\nfunction calculate(a, b) {\n  const x = a * b\n  return x + 100\n}\n';
  const g = locateVariables(src);
  assert.equal(g.length, 2, '两个 x 分两组');
  const [a, b] = g;
  assert.equal(a.scopeName, 'processUser');
  assert.equal(b.scopeName, 'calculate');
  assert.deepEqual(a.refs, [3], 'processUser 内 x 引用 L3');
  assert.deepEqual(b.refs, [7], 'calculate 内 x 引用 L7');
});

test('rename-locator：模块级变量归 (module)，声明+引用齐全', () => {
  const src = 'const d = 42;\nconsole.log(d + 1);\nfunction f() {\n  const e = d * 2;\n  return e;\n}\n';
  const g = locateVariables(src);
  const d = g.find((x) => x.name === 'd');
  assert.ok(d, '应找到模块级 d');
  assert.equal(d.scopeName, '(module)');
  assert.ok(d.refs.includes(2), 'd 引用 L2');
  // 函数内 e 独立
  const e = g.find((x) => x.name === 'e');
  assert.equal(e.scopeName, 'f');
  assert.deepEqual(e.refs, [5]);
});

test('rename-locator：--name 过滤只出指定变量所有作用域组', () => {
  const src = 'function a() {\n  const t = 1;\n  return t;\n}\nfunction b() {\n  const t = 2;\n  return t + t;\n}\nconst r = t1;\n'.replace('t1', '1');
  const t = locateVariables(src, { name: 't' });
  assert.equal(t.length, 2, '两个 t 分两组');
  assert.ok(t.every((x) => x.name === 't'));
});

test('rename-locator：无短变量返回空（minLen 默认 2）', () => {
  const g = locateVariables('function f() {\n  const value = 1;\n  return value;\n}\n');
  assert.equal(g.length, 0, '无 <2 字符短变量');
  // all-len 语义：minLen 0 全量
  const g2 = locateVariables('function f() {\n  const value = 1;\n  return value;\n}\n', { minLen: 0 });
  assert.equal(g2.length, 1, 'minLen 0 全量含 value');
});