/**
 * 规则按扩展名过滤（filterRulesByExt）回归测试。
 *
 * 修的是什么：旧实现 `String(relPath).split('.').pop()` 对**含点目录**的路径取错扩展名 ✗ ——
 *   `docs/.vitepress/theme/index.ts` ⇒ "vitepress/theme/index"（不是 ts）
 *   ⇒ 该文件所有声明 exts 的规则全部失配（审计实测：.vitepress 下文件只拿到通用规则）。
 * 新实现：先取 basename，再取最后一个点之后 ✓；无扩展名文件返回空串 ✓。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterRulesByExt } from '../lib/checks/filter.js';

const R = (id, exts) => (exts === undefined ? { id } : { id, exts });
const ids = (out, kind = 'max-lines') => (out[kind] || []).map((r) => r.id);

test('普通路径：按扩展名正确保留/剔除', () => {
  const grouped = { 'max-lines': [R('ts-rule', ['ts']), R('py-rule', ['py'])] };
  assert.deepEqual(ids(filterRulesByExt(grouped, 'src/index.ts')), ['ts-rule']);
  assert.deepEqual(ids(filterRulesByExt(grouped, 'src/T.py')), ['py-rule']);
  assert.deepEqual(ids(filterRulesByExt(grouped, 'src/readme.md')), []);
});

test('含点目录（修复点）：docs/.vitepress/theme/index.ts 必须识别为 ts', () => {
  const grouped = { 'max-lines': [R('ts-rule', ['ts']), R('py-rule', ['py'])] };
  assert.deepEqual(ids(filterRulesByExt(grouped, 'docs/.vitepress/theme/index.ts')), ['ts-rule'],
    '含点目录时旧实现取成 "vitepress/theme/index" ⇒ 这里必须为 [ts-rule]');
  assert.deepEqual(ids(filterRulesByExt(grouped, 'a.b.c/d.e/file.py')), ['py-rule']);
});

test('无扩展名文件：exts 规则不匹配（返回空串语义）', () => {
  const grouped = { 'max-lines': [R('ts-rule', ['ts']), R('any-ext', [''])] };
  assert.deepEqual(ids(filterRulesByExt(grouped, 'Makefile')), ['any-ext'],
    '无扩展名 ⇒ ext 为空串；只有显式声明 "" 的规则才匹配');
  assert.deepEqual(ids(filterRulesByExt(grouped, 'dir/Makefile')), ['any-ext']);
});

test('未声明 exts（或空数组）的规则不受文件类型限制', () => {
  const grouped = { 'max-lines': [R('no-exts'), R('empty-exts', []), R('ts-rule', ['ts'])] };
  assert.deepEqual(ids(filterRulesByExt(grouped, 'whatever.xyz')), ['no-exts', 'empty-exts']);
  assert.deepEqual(ids(filterRulesByExt(grouped, 'x.ts')), ['no-exts', 'empty-exts', 'ts-rule']);
});

test('大小写与反斜杠路径都归一', () => {
  const grouped = { 'max-lines': [R('ts-rule', ['ts'])] };
  assert.deepEqual(ids(filterRulesByExt(grouped, 'SRC/Index.TS')), ['ts-rule'], '扩展名应小写归一');
  assert.deepEqual(ids(filterRulesByExt(grouped, 'src\\.hidden\\Index.TS')), ['ts-rule'], '反斜杠路径应等价');
});

test('非数组条目原样保留（grouped 里可能有非规则值）', () => {
  const grouped = { meta: { note: 'x' }, 'max-lines': [R('ts-rule', ['ts'])] };
  const out = filterRulesByExt(grouped, 'a.ts');
  assert.deepEqual(out.meta, { note: 'x' });
  assert.deepEqual(ids(out), ['ts-rule']);
});

test('空输入不抛错', () => {
  assert.deepEqual(filterRulesByExt({}, 'a.ts'), {});
  assert.deepEqual(filterRulesByExt(null, 'a.ts'), {});
  assert.deepEqual(filterRulesByExt({ 'max-lines': [R('t', ['ts'])] }, ''), { 'max-lines': [] });
});
