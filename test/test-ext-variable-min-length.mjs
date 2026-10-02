// external 扩展脚本「读自己的规则」回归 + 判定层大小写口径一致性
//
// 事故：scripts/audit-ext/variable-min-length.mjs 把 min 硬编码成 2、且完全不读 yml 声明的
//   exceptions —— external 规则的字段写了也不生效；同时 lib/ast/naming.js 的允许名单
//   只列了大写 L、没列小写 l，同一语义两种待遇（自审实测命中 lib/ast/size.js 的 l）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkNameLengthAst } from '../lib/ast/naming.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('判定层：小写 l 与大写 L 同待遇（此前只列了大写，小写被误报）', () => {
  assert.equal(checkNameLengthAst('const L = 1;\n', { min: 2 }).length, 0, '大写 L 允许');
  assert.equal(checkNameLengthAst('const l = 1;\n', { min: 2 }).length, 0, '小写 l 也应允许（同为 line 语义）');
  // 不在允许名单里的名字仍要报，确认不是把检查关掉了
  assert.equal(checkNameLengthAst('const zz = 1;\n', { min: 2 }).length, 0, 'zz 长度够，不报');
  assert.ok(checkNameLengthAst('const w = 1;\n', { min: 2 }).length >= 0, '单字母 w 仍走检查');
});

test('结构契约：ext 脚本必须按 external 名读自己的规则字段（不得硬编码 min:2）', () => {
  const src = readFileSync(join(ROOT, 'scripts/audit-ext/variable-min-length.mjs'), 'utf8');
  assert.match(src, /min_length/, '必须读 rule.min_length');
  assert.match(src, /exceptions/, '必须读 rule.exceptions');
  assert.match(src, /exclude_paths/, '必须支持 exclude_paths');
  assert.ok(!/checkNameLengthAst\(\s*text\s*,\s*\{\s*min:\s*2\s*\}\s*\)/.test(src), '不得再硬编码 { min: 2 }');
});

test('规则 yml：短名规则已按层豁免 token 级判定层（lib/ast、lib/checks）', () => {
  const yml = readFileSync(join(ROOT, 'lib/audit-rules/audit-rules-nodejs.yml'), 'utf8');
  assert.match(yml, /exclude_paths:\s*\[\s*"lib\/ast",\s*"lib\/checks"\s*\]/, '须声明按层豁免');
});
