// 短变量名规则的**作用域分析 + 降级**回归。
//
// 需求原话（提出时的话，按约定只记在提交信息里）：
//   「插件应该能分析变量作用域」
//   「紧邻的几行小作用域里能被扫到，但是不警告（降级），但能被聚合结果找出来位置」
//
// 语义（本测试锁定的契约）：
//   · 窄作用域（声明所在大括号块行跨度 ≤ SCOPE_LINES=8）里的短别名 ⇒ **仍然报出**（聚合结果里
//     能查到位置、便于人工核对），但带 narrowScope: true ⇒ 上游降为 notice，不按 warning 告警
//   · 宽作用域（跨越大段代码仍在用）⇒ 不带标记，仍按 warning 报
//   · 同文件里的同名短别名按各自所在块判定，互不污染
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkNameLengthAst } from '../lib/ast/naming.js';

test('窄作用域短别名：仍被扫出（位置可查），但带 narrowScope 标记（降级）', () => {
  const src = [
    'function readBody(req) {',
    '  const c = String(req.url ?? "");',
    '  if (!c) return "";',
    '  return c.length;',
    '}',
  ].join('\n');
  const hits = checkNameLengthAst(src);
  assert.equal(hits.length, 1, '窄作用域短名仍应被扫出（不丢弃，聚合结果里能查位置）');
  assert.equal(hits[0].name, 'c');
  assert.equal(hits[0].narrowScope, true, '窄作用域必须带标记 ⇒ 上游降级为 notice');
});

test('宽作用域短名：不带标记，仍按 warning 报', () => {
  const filler = Array.from({ length: 20 }, (_, i) => `  step${i}();`).join('\n');
  const src = ['function g() {', '  const q = 1;', filler, '  return q;', '}'].join('\n');
  const hits = checkNameLengthAst(src).filter((h) => h.name === 'q');
  assert.equal(hits.length, 1, '宽作用域短名应被报出');
  assert.notEqual(hits[0].narrowScope, true, '宽作用域不得带窄作用域标记');
});

test('同文件两个同名短别名：按各自所在块判定（不得互相污染）', () => {
  const big = Array.from({ length: 20 }, (_, i) => `    step${i}();`).join('\n');
  const src = [
    'function a() {',
    '  const c = 1;',
    '  return c;',
    '}',
    'function b() {',
    '  const c = 2;',
    big,
    '  return c;',
    '}',
  ].join('\n');
  const cs = checkNameLengthAst(src).filter((h) => h.name === 'c');
  assert.equal(cs.length, 2, '两个 c 都应被扫出');
  assert.equal(cs[0].narrowScope, true, '第一个 c 在窄块 ⇒ 降级');
  assert.notEqual(cs[1].narrowScope, true, '第二个 c 在大块 ⇒ 仍按 warning');
});
