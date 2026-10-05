// 架构图推导的回归测试（scripts/archify-imports.mjs）。
//
// 为什么需要：架构图的组件与连线现在**全部来自代码推导**，一旦推导口径被改坏
//   （比如漏扫目录、边指向不存在的模块、分层丢失），图会静默变错而没人发现。
//   本测试把「推导必须满足的不变量」钉住，全部与真实仓库比对，不写死具体数字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveLibGraph, layersToBoundaries, importSpecifiers, resolveLibModule } from '../scripts/archify-imports.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('推导：模块集合与 lib/ 真实内容一致（目录 + 顶层 .js，同名合并），且无重复 id', () => {
  const g = deriveLibGraph(ROOT);
  const ids = g.components.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, `模块 id 不得重复：${ids.filter((x, i) => ids.indexOf(x) !== i)}`);

  // 期望集合：lib/ 下每个目录一个 id，lib/ 顶层每个 .js 一个 id（同名文件与目录合并为一个）
  const entries = readdirSync(join(ROOT, 'lib'), { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const files = entries.filter((e) => e.isFile() && /\.m?js$/.test(e.name)).map((e) => e.name.replace(/\.m?js$/, ''));
  const expected = new Set([...dirs, ...files]);
  assert.deepEqual([...new Set(ids)].sort(), [...expected].sort(), '推导出的模块应与 lib/ 实际内容一一对应');
  assert.ok(g.components.length > 0 && g.files > 0, '应至少推导出模块与文件');
});

test('推导：依赖边引用完整性（两端都必须是已声明模块，且不含自环）', () => {
  const g = deriveLibGraph(ROOT);
  const ids = new Set(g.components.map((c) => c.id));
  for (const e of g.edges) {
    assert.ok(ids.has(e.from), `边的起点不是已声明模块：${e.from}`);
    assert.ok(ids.has(e.to), `边的终点不是已声明模块：${e.to}`);
    assert.notEqual(e.from, e.to, `不应出现自环：${e.from}`);
    assert.ok(e.count >= 1, `边的引用次数应 >= 1：${JSON.stringify(e)}`);
  }
});

test('推导：每个组件都有层、锚点文件与函数数（锚点必须是真实存在的文件）', () => {
  const g = deriveLibGraph(ROOT);
  for (const c of g.components) {
    assert.ok(c.layer, `模块 ${c.id} 缺分层`);
    // 锚点必须是**真实存在的文件**（不能是目录）：archify 的 sources 只认文件，
    //   实测 lib/audit-rules 只放 .yml 时锚点曾退化成目录名，被官方 validate 判 file-missing
    assert.ok(existsSync(join(ROOT, c.file)), `模块 ${c.id} 的锚点文件不存在：${c.file}`);
    assert.ok(statSync(join(ROOT, c.file)).isFile(), `模块 ${c.id} 的锚点必须是文件而非目录：${c.file}`);
    assert.equal(typeof c.funcCount, 'number', `模块 ${c.id} 的 funcCount 应为数字`);
    // fileCount 数的是**源码文件**：只放 yml 的模块（实测 lib/audit-rules）天然为 0，
    //   故只要求非负；但锚点仍必须是真实文件（上面的断言）
    assert.ok(c.fileCount >= 0, `模块 ${c.id} 的文件数应 >= 0`);
  }
  // 函数数应来自 doc-func 的扫描（全库远大于 0）——若扫描口径被改坏，这里会立刻暴露
  const total = g.components.reduce((n, c) => n + c.funcCount, 0);
  assert.ok(total > 100, `全库函数合计应远大于 100（实测 800+），实得 ${total}——函数扫描口径可能被改坏`);
});

test('分层：boundaries 覆盖全部模块，且每层至少一个模块', () => {
  const g = deriveLibGraph(ROOT);
  const bs = layersToBoundaries(g.components);
  assert.ok(bs.length > 0, '应至少有一个分层');
  const wrapped = new Set(bs.flatMap((b) => b.wraps));
  assert.equal(wrapped.size, g.components.length, '每个模块都应落在某个分层里');
  for (const b of bs) {
    assert.equal(b.kind, 'region', '分层用 region 边界框');
    assert.ok(b.label && b.wraps.length, '分层需有名字与非空成员');
  }
});

test('解析口径：只认相对 import，且能把路径归属到 lib 模块', () => {
  assert.deepEqual(importSpecifiers("import { a } from './x.js';\nconst b = await import('./y/z.js');"),
    ['./x.js', './y/z.js'], '应解析出相对 import（含动态 import）');
  assert.deepEqual(importSpecifiers("import fs from 'node:fs';\nimport p from 'some-pkg';"), [],
    '裸模块名（node 内置 / npm 包）不算架构依赖');
  assert.equal(resolveLibModule('lib/app/handlers/x.js', '../../ast/tokenizer.js'), 'ast', '../ 应能正确回溯');
  assert.equal(resolveLibModule('lib/app/x.js', './y.js'), 'app', '同模块内部返回自身');
  assert.equal(resolveLibModule('lib/index.js', './self/index.js'), 'self', '顶层文件里的 ./self 应归属 self');
  assert.equal(resolveLibModule('scripts/a.mjs', '../lib/ast/x.js'), 'ast', '跨目录指向 lib 也应归属');
  assert.equal(resolveLibModule('lib/a.js', 'node:fs'), null, '裸模块返回 null');
});
