/**
 * 测试缓存（test/helpers/test-cache.mjs）回归测试。
 *
 * 钉子（都是「宁可少跳过，不可漏跑」的安全属性）：
 *   ① 依赖闭包：a→b→c 传递解析；裸包名不进闭包
 *   ② 键失效：**依赖文件**内容一变，键必变（否则会把该跑的测试跳过）
 *   ③ 不缓存判定：正文含宿主/网络标记的测试一律不缓存
 *   ④ 计划：首次全跑 → 通过后命中跳过 → 依赖改了又重跑
 *   ⑤ 缓存文件损坏/版本不符 → 按空缓存（不能因缓存本身报错）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  cacheKeyFor, importClosure, isCacheableTest, loadTestCache, planTestRun, relativeSpecifiers, saveTestCache, stripCommentsAndStrings,
} from './helpers/test-cache.mjs';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';

/** 造一个小工程：entry → mid → leaf（外加一个裸包名依赖）。 */
function makeProject() {
  const root = mkdtempTracked('cache-');
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(join(root, 'test-x.mjs'), "import { mid } from './lib/mid.js';\nimport fs from 'node:fs';\nmid();\n");
  writeFileSync(join(root, 'lib', 'mid.js'), "import { leaf } from './leaf.js';\nexport function mid() { return leaf(); }\n");
  writeFileSync(join(root, 'lib', 'leaf.js'), 'export function leaf() { return 1; }\n');
  return root;
}

test('relativeSpecifiers：只取工程内相对说明符（裸包名与 node: 内建不取）', () => {
  const specs = relativeSpecifiers("import a from './a.js';\nimport fs from 'node:fs';\nimport react from 'react';\nconst b = require('./b');\nimport('./c.js');\n");
  assert.deepEqual(specs.sort(), ['./a.js', './b', './c.js']);
});

test('importClosure：传递闭包（entry → mid → leaf）', () => {
  const root = makeProject();
  const closure = importClosure(join(root, 'test-x.mjs'));
  const names = closure.map((p) => p.slice(root.length + 1)).sort();
  assert.deepEqual(names, ['lib/leaf.js', 'lib/mid.js', 'test-x.mjs'], '必须传递解析到 leaf');
});

test('cacheKeyFor：**依赖文件**内容变化 → 键必变（否则会跳过该跑的测试）', () => {
  const root = makeProject();
  const entry = join(root, 'test-x.mjs');
  const key1 = cacheKeyFor(importClosure(entry));
  // 改入口 → 键变
  writeFileSync(entry, "import { mid } from './lib/mid.js';\nmid(); // 改注释\n");
  const key2 = cacheKeyFor(importClosure(entry));
  assert.notEqual(key1, key2, '入口变化必须失效');
  // 只改**依赖**（leaf）→ 键也必须变
  writeFileSync(join(root, 'lib', 'leaf.js'), 'export function leaf() { return 2; }\n');
  const key3 = cacheKeyFor(importClosure(entry));
  assert.notEqual(key2, key3, '依赖变化必须失效');
  // 都不动 → 稳定
  assert.equal(cacheKeyFor(importClosure(entry)), key3, '无变化时键必须稳定');
});

test('isCacheableTest：语句级联网才不缓存，夹具字符串/注释里的示例不算', () => {
  // 真联网 → 不缓存
  assert.equal(isCacheableTest('const r = await fetch("http://127.0.0.1:30801/api/x");').cacheable, false, 'await fetch 不缓存');
  assert.equal(isCacheableTest('const srv = createServer(handler);').cacheable, false, 'createServer 不缓存');
  assert.equal(isCacheableTest('srv.listen(3000);').cacheable, false, '.listen( 不缓存');
  assert.equal(isCacheableTest('const c = net.connect(80);').cacheable, false, 'net.connect 不缓存');
  // 夹具字符串/注释里的示例 → 仍可缓存（此前的关键字判据在这里误判，白跑 40s）
  assert.equal(isCacheableTest("writeFileSync(f, '外部请求示例：fetch(\"https://example.com\")');").cacheable, true, '夹具字符串不算联网');
  assert.equal(isCacheableTest('// 注释里提到 fetch(url) 的写法\nconst a = 1;').cacheable, true, '普通注释不算联网');
  // 整仓不变式测试必须常跑（新增文件未登记时它们才会红）
  const drift = isCacheableTest('const a = 1;', 'test-tree-doc.mjs');
  assert.equal(drift.cacheable, false, '整仓不变式测试（README 树漂移）必须常跑');
  assert.match(drift.reason, /整仓不变式/);
  const pure = isCacheableTest("import { tokenize } from '../lib/ast/tokenizer.js';\nassert.equal(1, 1);\n");
  assert.equal(pure.cacheable, true, '纯本地测试可缓存');
});

test('planTestRun：首次全跑 → 命中跳过 → 依赖改了重跑', () => {
  const root = makeProject();
  const files = [join(root, 'test-x.mjs')];
  const cache = { results: {} };
  const first = planTestRun(files, cache);
  assert.deepEqual(first.run, files, '首次必须真跑');
  assert.equal(first.skipped.length, 0);

  // 模拟「上次通过」
  cache.results[files[0]] = { key: cacheKeyFor(importClosure(files[0])), passed: true };
  const second = planTestRun(files, cache);
  assert.deepEqual(second.skipped, files, '内容与依赖都没变 → 跳过');
  assert.equal(second.run.length, 0);

  // 改依赖 → 必须重跑
  writeFileSync(join(root, 'lib', 'leaf.js'), 'export function leaf() { return 3; }\n');
  const third = planTestRun(files, cache);
  assert.deepEqual(third.run, files, '依赖变化 → 必须重跑');
});

test('stripCommentsAndStrings：夹具字符串与注释里的示例被剥掉，真调用保留', () => {
  const src = [
    "// 注释里的示例：await fetch('http://x')",
    "const fixture = '外部请求示例：await fetch(\"https://example.com\")';",
    "const real = await fetch('https://api.example.com');",
    '/* 块注释里的 createServer(handler) */',
  ].join('\n');
  const stripped = stripCommentsAndStrings(src);
  assert.ok(!stripped.includes('注释里的示例'), '行注释被剥掉');
  assert.ok(!stripped.includes('外部请求示例'), '字符串字面量被剥掉');
  assert.ok(!stripped.includes('createServer'), '块注释被剥掉');
  assert.equal((stripped.match(/await fetch\(/g) || []).length, 1, '只剩真调用那一处');
});

test('save/loadTestCache：版本不符或损坏 → 按空缓存（不因缓存本身报错）', () => {
  const root = mkdtempTracked('cacheio-');
  assert.deepEqual(loadTestCache(root).results, {}, '无缓存文件 → 空');
  assert.equal(saveTestCache(root, { results: { a: { key: 'k', passed: true } } }), true);
  assert.equal(loadTestCache(root).results.a.passed, true, '写入后可读回');
  // 损坏内容
  writeFileSync(join(root, '.test-cache', 'results.json'), '{ 坏 json');
  assert.deepEqual(loadTestCache(root).results, {}, '损坏 → 空缓存');
  rmSync(join(root, '.test-cache'), { recursive: true, force: true });
});
