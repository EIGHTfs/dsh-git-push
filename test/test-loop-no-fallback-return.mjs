/**
 * performance/loop-no-fallback-return 的假阳性回归 + 真阳性保底。
 *
 * 背景（2026-10-13 全量审计发现 4 条 blocker 全为误报）：
 *   规则原实现在**原文**上直接跑 `/\breturn\s+[^\s;]/` 判定"循环体内有值 return"，
 *   于是三类假阳性：
 *     ① 注释/字符串里的 "return"（实测：注释行以「…只认有值 return」结尾 + 换行 + 下一行代码）
 *     ② 循环体内**嵌套函数**（IIFE / 内部箭头函数）里的 return
 *     ③ `for (;;)` / `while (true)` 且体内无 break 的循环（只能经 return/throw 退出）
 *   修复：三处收窄（见 lib/ast/perf.js 的 loopNoFallbackReturnLines 注释）。
 *   本测试同时锁死"真阳性不能漏报"——收窄过度会把真 bug 放过去。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loopNoFallbackReturnLines } from '../lib/ast/perf.js';

/** 命中行号（升序数组）。 */
const hits = (src) => [...loopNoFallbackReturnLines(src)].sort((a, b) => a - b);

test('真阳性①：普通循环体内有值 return、循环之后无语句 ⇒ 报（循环可能走完返回 undefined）', () => {
  const src = [
    'export function f(xs) {',
    '  for (const x of xs) {',
    '    if (x) return x;',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(hits(src), [2], '应命中第 2 行的 for 循环');
});

test('真阳性②：`for (;;)` 体内有 break 且循环后有值 return 缺失 ⇒ 仍报（可经 break 走到循环之后）', () => {
  const src = [
    'export function g(xs) {',
    '  for (;;) {',
    '    if (xs.length) return xs[0];',
    '    break;',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(hits(src), [2], '有 break 的无限循环仍应命中');
});

test('假阳性①：循环体里只有**注释**含 "return"（注释以 return 结尾 + 换行 + 下一行代码）⇒ 不报', () => {
  const src = [
    'export function h(xs) {',
    '  for (const x of xs) {',
    '    // 只认有值 return',
    '    sink(x);',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(hits(src), [], '注释里的 return 不算代码');
});

test('假阳性②：循环体里只有**字符串**含 "return" ⇒ 不报', () => {
  const src = [
    'export function k(xs) {',
    '  for (const x of xs) {',
    "    log('return ' + x);",
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(hits(src), [], '字符串里的 return 不算代码');
});

test('假阳性③：循环体内**嵌套函数（IIFE）**里的 return 不属于本循环 ⇒ 不报', () => {
  const src = [
    'export function i(specs) {',
    '  for (const sp of specs) {',
    '    const ok = (() => { try { return check(sp); } catch { return false; } })();',
    '    use(ok);',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(hits(src), [], 'IIFE 内的 return 不算循环自身的 return');
});

test('假阳性④：`for (;;)` / `while (true)` 且体内无 break ⇒ 走不到循环之后，不报', () => {
  const forEver = [
    'export function j(root) {',
    '  let dir = root;',
    '  for (;;) {',
    '    if (hit(dir)) return true;',
    '    if (dir === root) return false;',
    '    dir = up(dir);',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(hits(forEver), [], '无 break 的 for(;;) 不需要兜底 return');

  const whileTrue = [
    'export function j2(root) {',
    '  let dir = root;',
    '  while (true) {',
    '    if (hit(dir)) return dir;',
    '    if (dir === root) return null;',
    '    dir = up(dir);',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(hits(whileTrue), [], '无 break 的 while(true) 不需要兜底 return');
});

test('真阳性③：收窄不能漏掉"循环走完但函数还有别的分支"（循环之后无语句、体内有值 return）', () => {
  const src = [
    'export function m(xs) {',
    '  for (const x of xs) {',
    '    if (x.ok) return x;',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(hits(src), [2]);
});
