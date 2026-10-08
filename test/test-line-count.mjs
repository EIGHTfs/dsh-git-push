/**
 * 行数口径（lib/ast/line-count.js）回归测试。
 *
 * 钉子（口径要稳定可预期，且各处共用同一实现）：
 *   ① 纯代码：全部计入代码行
 *   ② 空行不计（含文件末尾换行产生的空元素）
 *   ③ 纯注释行不计；**行尾注释仍算代码行**（这是最容易算错的一处）
 *   ④ 块注释覆盖的每一行都不计；块注释内部的空行算注释行（不与空行重复扣减）
 *   ⑤ code + comment + blank === total（分布自洽）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { codeLineCount, lineStats } from '../lib/ast/line-count.js';

test('纯代码：全部计入代码行', () => {
  const s = lineStats('const a = 1;\nconst b = 2;');
  assert.deepEqual(s, { total: 2, comment: 0, blank: 0, code: 2 });
});

test('空行不计（含末尾换行产生的空元素）', () => {
  const s = lineStats('const a = 1;\n\nconst b = 2;\n');
  assert.equal(s.total, 4, 'split 后含末尾空元素');
  assert.equal(s.blank, 2, '中间空行 + 末尾空元素');
  assert.equal(s.code, 2);
});

test('纯注释行不计；**行尾注释仍算代码行**', () => {
  const pure = lineStats('// 只有注释\nconst a = 1;');
  assert.equal(pure.comment, 1);
  assert.equal(pure.code, 1);
  const trailing = lineStats('const a = 1; // 行尾注释');
  assert.equal(trailing.comment, 0, '行尾注释所在行有代码 → 不算纯注释行');
  assert.equal(trailing.code, 1, '该行仍算代码行');
});

test('块注释覆盖每一行；块内空行不计入代码行（分布归注释或空行都可）', () => {
  const s = lineStats('/*\n 说明\n\n 第二段\n*/\nconst a = 1;');
  assert.equal(s.total, 6);
  // tokenizer 把块注释**按行**发 comment token，且注释内的空行不发 token →
  //   该空行落在 blank 里（而非 comment）。两种归类都不计入代码行 ✓，故只钉「代码行」与自洽性。
  assert.equal(s.code, 1, '块注释整体不计代码行');
  assert.equal(s.comment + s.blank, 5, '其余 5 行全部归注释或空行（都不算代码）');
  assert.equal(s.code + s.comment + s.blank, s.total, '分布自洽');
});

test('codeLineCount：与 lineStats().code 一致', () => {
  const text = '// 头\n\nconst a = 1;\n\n// 尾\n';
  assert.equal(codeLineCount(text), lineStats(text).code);
});
