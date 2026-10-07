/**
 * 跨文件符号索引（lib/ast/symbol-index.js）回归测试。
 *
 * 钉子（都是「宁缺勿错」的安全属性）：
 *   ① 稳定 ID 不含行号 —— 文件顶部加一行（行号全变）后 ID 不变
 *   ② import 解析：相对说明符（含省略后缀 / 指向 index.js）解析到工程内文件；裸包名不解析
 *   ③ 跨文件调用落地：import（含 `as` 别名）能连到目标导出；全工程唯一同名也能连
 *   ④ 歧义不连边：两个文件导出同名时，未 import 的调用点记 ambiguous，绝不猜
 *   ⑤ 未使用导出为**候选**：被 import 引用过的不算候选
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSymbolIndex, callersOf, extractFileSymbols, indexSummary, resolveSpecifier, sanitizeId, symbolId, unusedExportCandidates,
} from '../lib/ast/symbol-index.js';

const FILES = {
  'lib/a.js': 'export function alpha() { return 1; }\nexport function unusedOne() { return 2; }\n',
  'lib/b.js': 'import { alpha } from "./a.js";\nexport function beta() { return alpha(); }\n',
  'lib/c.js': 'import { alpha as al } from "../lib/a.js";\nexport function gamma() { return al(); }\n',
  'lib/index.js': 'export function fromIndex() { return 0; }\n',
  'lib/usesIndex.js': 'import { fromIndex } from "./";\nexport function go() { return fromIndex(); }\n',
  'lib/dup1.js': 'export function dup() { return 1; }\n',
  'lib/dup2.js': 'export function dup() { return 2; }\n',
  'lib/useDup.js': 'import { dup } from "./dup1.js";\nexport function useDup() { return dup(); }\n',
  'lib/amb.js': 'export function useDupAmb() { return dup(); }\n',
  'lib/mystery.js': 'export function m() { return noSuchThing(); }\n',
};

function build(extra = {}) {
  const files = { ...FILES, ...extra };
  return buildSymbolIndex(Object.keys(files), { readFile: (rel) => files[rel] });
}

const hasEdge = (idx, from, to, via) => idx.edges.some((e) => e.from === from && e.to === to && e.via === via);

test('symbolId/sanitizeId：稳定 ID 只由「路径 + 符号名」决定，不含行号', () => {
  assert.equal(symbolId('lib/a.js', 'alpha'), 'lib_a#alpha');
  assert.equal(symbolId('lib/a.js', 'alpha'), symbolId('lib/a.js', 'alpha'), '可复现');
  assert.equal(sanitizeId('a-b.c/d'), 'a_b_c_d');
  // 关键属性：文件内容顶部加一行（行号全部漂移）后，ID 不变
  const before = buildSymbolIndex(['lib/a.js'], { readFile: () => FILES['lib/a.js'] });
  const after = buildSymbolIndex(['lib/a.js'], { readFile: () => '\n' + FILES['lib/a.js'] });
  assert.deepEqual([...before.symbols.keys()].sort(), [...after.symbols.keys()].sort(), 'ID 不得随行号变化');
});

test('resolveSpecifier：相对说明符解析到工程内文件，裸包名不解析', () => {
  const fileSet = new Set(Object.keys(FILES));
  assert.equal(resolveSpecifier('lib/b.js', './a.js', fileSet), 'lib/a.js');
  assert.equal(resolveSpecifier('lib/b.js', './a', fileSet), 'lib/a.js', '省略后缀');
  assert.equal(resolveSpecifier('lib/usesIndex.js', './', fileSet), 'lib/index.js', '指向 index.js');
  assert.equal(resolveSpecifier('lib/c.js', '../lib/a.js', fileSet), 'lib/a.js', '向上级回退');
  assert.equal(resolveSpecifier('lib/b.js', 'react', fileSet), null, '裸包名=外部依赖');
  assert.equal(resolveSpecifier('lib/b.js', './not-exist.js', fileSet), null);
});

test('跨文件调用：import（含 as 别名）连到目标导出', () => {
  const idx = build();
  assert.ok(hasEdge(idx, 'lib/b.js', symbolId('lib/a.js', 'alpha'), 'import'), '具名 import 应连边');
  assert.ok(hasEdge(idx, 'lib/c.js', symbolId('lib/a.js', 'alpha'), 'import'), 'as 别名应连到原符号');
  assert.ok(hasEdge(idx, 'lib/usesIndex.js', symbolId('lib/index.js', 'fromIndex'), 'import'), './ 目录 import 应连边');
  assert.ok(hasEdge(idx, 'lib/useDup.js', symbolId('lib/dup1.js', 'dup'), 'import'), '同名时 import 优先，不判歧义');
});

test('歧义不连边：两个文件导出同名且调用点没 import → 记 ambiguous', () => {
  const idx = build();
  const amb = idx.unresolved.filter((u) => u.file === 'lib/amb.js' && u.name === 'dup');
  assert.equal(amb.length, 1, '未 import 的同名调用必须记未解析');
  assert.equal(amb[0].reason, 'ambiguous');
  assert.ok(!idx.edges.some((e) => e.from === 'lib/amb.js'), '歧义绝不猜边');
  const unknown = idx.unresolved.find((u) => u.name === 'noSuchThing');
  assert.equal(unknown && unknown.reason, 'unknown');
});

test('未使用导出为候选：被 import 引用过的不算候选', () => {
  const idx = build();
  const names = unusedExportCandidates(idx).map((x) => x.name);
  assert.ok(names.includes('unusedOne'), '没人用的导出应进候选');
  assert.ok(!names.includes('alpha'), '被 import 引用过的不该进候选');
  assert.ok(!names.includes('fromIndex'), '被 import 引用过的不该进候选');
});

test('callersOf / indexSummary：查询与摘要可用', () => {
  const idx = build();
  const callers = callersOf(idx, symbolId('lib/a.js', 'alpha'));
  assert.ok(callers.some((c) => c.file === 'lib/b.js'), '应能查到 b.js 的调用');
  assert.ok(callers.some((c) => c.file === 'lib/c.js'), '应能查到 c.js 的调用');
  const summary = indexSummary(idx);
  assert.match(summary, /符号索引：文件 \d+/);
  assert.match(summary, /覆盖率 \d+(\.\d+)?%/);
  assert.ok(idx.stats.coverage > 0 && idx.stats.coverage <= 100);
});

test('TS 回退：`./x.js` 指向实际存在的 `x.ts` 也能解析（Node 解析规范下的 TS 写法）', () => {
  const fileSet = new Set(['src/a.ts', 'src/b.ts']);
  assert.equal(resolveSpecifier('src/b.ts', './a.js', fileSet), 'src/a.ts', '应回退到 .ts');
  assert.equal(resolveSpecifier('src/b.ts', './a', fileSet), 'src/a.ts', '省略后缀也要能命中 .ts');
  assert.equal(resolveSpecifier('src/b.ts', './missing.js', fileSet), null, '目标不存在仍是 null');
  // 端到端：TS 工程的跨文件调用能连边（修复前 import 边为 0）
  const files = {
    'src/a.ts': 'export function alpha() { return 1; }\n',
    'src/b.ts': 'import { alpha } from "./a.js";\nexport function beta() { return alpha(); }\n',
  };
  const idx = buildSymbolIndex(Object.keys(files), { readFile: (r) => files[r] });
  assert.ok(idx.edges.some((e) => e.from === 'src/b.ts' && e.to === symbolId('src/a.ts', 'alpha') && e.via === 'import'),
    'TS 的 .js 写法必须连到 .ts 目标');
});

test('成员调用不计入可解析调用（否则未解析爆炸、覆盖率虚低）', () => {
  const facts = extractFileSymbols('m.js', 'export function f() { console.log(1); obj.method(); return g(); }\n');
  assert.equal(facts.calls.length, 1, 'console.log / obj.method 是成员调用，应被排除');
  assert.equal(facts.calls[0].name, 'g', '只留真正可能跨文件解析的裸调用');
  assert.equal(facts.skippedMemberCalls, 2, '被排除的成员调用要如实计数');
  // `a?.b()` 可选链成员调用同样排除
  const opt = extractFileSymbols('n.js', 'export function h() { return a?.b(); }\n');
  assert.equal(opt.calls.length, 0);
  assert.equal(opt.skippedMemberCalls, 1);
});
