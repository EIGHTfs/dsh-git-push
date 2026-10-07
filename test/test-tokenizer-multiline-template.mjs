// 多行模板字符串跨行 tokenize 回归：模板正文不得被当代码（否则正文里的占位符会被当标识符）。
//
// 事故：cli.mjs 的 HELP 是多行模板，正文里有占位符 `[--depth N]`。tokenizer 按行 split，
//   consumeTemplate 遇未闭合反引号只「归并到行尾」且不记跨行状态 ⇒ 模板第 2 行整行被当代码，
//   `N` 产出 type:"ident" ⇒ readability/variable-min-length 把帮助文本当短变量名误报（实测 3 条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, clearTokenCache } from '../lib/ast/tokenizer.js';
import { checkNameLengthAst } from '../lib/ast/naming.js';
import { checkMagicNumberSmartAst } from '../lib/ast/magic-number.js';

const SRC = [
  'const HELP = `用法:',
  '  git-sluice scan <root> [--depth N]',
  '`;',
  'const N = 1;',
].join('\n');

test('多行模板正文不产出 ident（帮助文本里的 N 不该是标识符）', () => {
  clearTokenCache();
  const all = tokenize(SRC);
  const nTokens = all.filter((t) => t.value === 'N');
  // 模板正文里的 N 应被并入 tmpl；只有第 4 行的真变量才是 ident
  const idents = nTokens.filter((t) => t.type === 'ident');
  assert.equal(idents.length, 1, `真变量应只有 1 个 ident，实得 ${JSON.stringify(nTokens.map((t) => t.type + '@' + t.line))}`);
  assert.equal(idents[0].line, 4, 'ident 应来自模板之后那行的真变量');
  // 模板跨行应产出多个 tmpl token（第 1 行开引号 / 第 2 行正文 / 第 3 行闭引号）
  const tmplLines = all.filter((t) => t.type === 'tmpl').map((t) => t.line);
  assert.deepEqual(tmplLines, [1, 2, 3], `模板正文应跨行产出 tmpl，实得行号 ${JSON.stringify(tmplLines)}`);
});

test('短名规则不再报模板正文里的占位符', () => {
  clearTokenCache();
  const hits = checkNameLengthAst(SRC, { min: 2 });
  assert.ok(!hits.some((h) => h.line === 2), `模板正文（第 2 行）不该被报：${JSON.stringify(hits)}`);
  assert.ok(hits.some((h) => h.name === 'N' && h.line === 4), '真变量 N（第 4 行）仍应被报，确认检查没被关掉');
});

// 反引号正好在行尾的形态（`const css = ` + 换行）：token 值只有单个反引号，
//   旧判据看 endsWith('`') 为真 ⇒ 漏置跨行状态 ⇒ 整段 CSS 被当代码，其中的 #141518/#888/1.5
//   被魔数规则误报（dsh-session-conductor 的 compaction.js 实测 3 条）。
const CSS_TMPL = [
  'const css = `',
  '  .cm_card { border:1px solid rgba(128,128,128,.2); background:var(--x,#141518); }',
  '  .cm_hint { color:#888; line-height:1.5; }',
  '`;',
  'const after = 1;',
].join('\n');

test('模板开引号独占行尾时，正文仍并入 tmpl（不产 ident/num）', () => {
  clearTokenCache();
  const all = tokenize(CSS_TMPL);
  const leaked = all.filter((t) => (t.line === 2 || t.line === 3) && !['tmpl', 'ws', 'comment'].includes(t.type));
  assert.deepEqual(leaked.map((t) => t.type + '@' + t.line + ':' + t.value), [], '模板正文行不该产出代码 token');
  const tmplLines = all.filter((t) => t.type === 'tmpl').map((t) => t.line);
  assert.deepEqual(tmplLines, [1, 2, 3, 4], `模板应跨 4 行产出 tmpl，实得 ${JSON.stringify(tmplLines)}`);
});

test('魔数规则不再报 CSS 模板正文里的数值', () => {
  clearTokenCache();
  const hits = checkMagicNumberSmartAst(CSS_TMPL, {});
  assert.deepEqual(hits, [], `CSS 正文里的 #141518/#888/1.5 不该报魔数：${JSON.stringify(hits)}`);
});
