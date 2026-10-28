/**
 * C# 插值串不计入「重复硬编码文本」的回归用例。
 *
 * 为什么需要：`security/no-repeated-hardcoded-literals` 统计同文件重复 ≥3 次的字符串字面量，
 *   而 C# 插值串 `$"…"` 里的 `{expr}` 是表达式、不是文本。若按普通字符串处理，
 *   表达式会被当成硬编码值参与计数（C# 语料实测 10/41 由此误报，例如
 *   `$"<error: {ex.Message}>"` 被提成 `<error: {ex.Message}>`）。
 *
 * 口径：插值串在 tokenizer 层归为 `tmpl`（与 JS 模板串同类，该规则的提取器已排除 tmpl）；
 *   `@"…"`（verbatim 但**不插值**）仍是 `str`，必须照常统计 —— 它是纯字面量。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize } from '../lib/ast/tokenizer.js';
import { checkRepeatedStringsAst } from '../lib/ast/size.js';

const kinds = (src) => tokenize(src).filter((t) => t.type === 'str' || t.type === 'tmpl').map((t) => t.type);

test('tokenizer：C# 插值串产出 tmpl，verbatim 不插值仍是 str', () => {
  assert.deepEqual(kinds('var a = $"x {y} z";'), ['tmpl'], '插值串应为 tmpl');
  assert.deepEqual(kinds('var b = @"C:\\path";'), ['str'], 'verbatim 不插值应仍是 str');
  assert.deepEqual(kinds('var c = $@"q {r}";'), ['tmpl'], '$@" 前缀也是插值串');
  assert.deepEqual(kinds('var d = @$"q {r}";'), ['tmpl'], '@$" 前缀也是插值串');
  assert.deepEqual(kinds('var e = "plain";'), ['str'], '普通字符串不受影响');
});

test('tokenizer：插值洞内含嵌套字符串时不得在洞内截断', () => {
  // 洞内的 "null" 是表达式里的字符串，不能当作插值串的结束引号，
  //   否则残片 `)}, "` 会被当成一个新字面量参与统计（实测该形态仍误报）。
  const toks = tokenize('var s = $"head={(c ? a : "null")}, " + t;').filter((t) => t.type === 'str' || t.type === 'tmpl');
  assert.equal(toks.length, 1, '整个插值串应是一个 token');
  assert.equal(toks[0].type, 'tmpl');
  assert.match(toks[0].value, /\{\(c \? a : "null"\)\}/, '洞内表达式应完整保留在 token 里');
});

test('提取器：插值串重复 3 次不报（表达式不是硬编码文本）', () => {
  const text = ['a();', 'b($"<error: {ex.Message}>");', 'c($"<error: {ex.Message}>");', 'd($"<error: {ex.Message}>");'].join('\n');
  assert.equal(checkRepeatedStringsAst(text, { min: 3 }).length, 0, '插值串不应计入重复硬编码文本');
});

test('提取器：纯字面量重复 3 次照报（真命中不许被一起干掉）', () => {
  const text = ['GUILayout.Button("Open File");', 'GUILayout.Button("Open File");', 'GUILayout.Button("Open File");'].join('\n');
  const hits = checkRepeatedStringsAst(text, { min: 3 });
  assert.equal(hits.length, 1, '纯字面量重复必须仍然报');
  assert.equal(hits[0].value, 'Open File');
});

test('提取器：verbatim 串（不插值）重复仍统计', () => {
  const text = ['x = @"C:\\fixed\\path";', 'y = @"C:\\fixed\\path";', 'z = @"C:\\fixed\\path";'].join('\n');
  assert.equal(checkRepeatedStringsAst(text, { min: 3 }).length, 1, 'verbatim 是纯字面量，应照常统计');
});
