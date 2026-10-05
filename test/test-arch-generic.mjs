// 通用性验收测试：**提取器必须真的在读代码**，而不是把某个仓库的结构写死在代码里。
//
// 验收标准（用户给的破法）：
//   ① 换一个结构完全不同的仓库跑，输出必须不同 —— 两次输出一致 = 100% 写死
//   ② 改一行代码（加一个 import），输出必须变 —— 不变说明压根没读文件
// 这两条能挡住「表面能跑、换输入纹丝不动」的假分析器。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArchFacts } from '../lib/arch/extract.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = dirname(ROOT);

/** 结构签名：源码根 + 模块集合 + 边集合（任一不同即视为不同输出）。 */
function signature(facts) {
  return JSON.stringify({
    sourceRoot: facts.sourceRoot,
    modules: facts.modules.map((m) => m.id).sort(),
    edges: facts.edges.map((e) => `${e.from}→${e.to}`).sort(),
  });
}

test('验收①：结构不同的仓库必须产出不同结果（相同即写死）', async () => {
  // 我们自己（lib/ 扁平多子目录）与另一个结构完全不同的项目
  const other = join(WORKSPACE, 'dsh-normify');
  const a = await extractArchFacts(ROOT);
  const b = await extractArchFacts(other);
  assert.ok(a.modules.length > 0, '我们自己的仓库应提取到模块');
  assert.ok(b.modules.length > 0, '另一个仓库应提取到模块');
  assert.notEqual(signature(a), signature(b),
    '两个结构不同的仓库产出完全一致 ⇒ 说明结果是写死的，不是真分析');
});

test('验收②：改一行代码（新增一个 import）输出必须变', async () => {
  // 在临时目录造一个最小仓库：a.js 不 import b.js → 再加一行 import b.js，边集合必须变化
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-arch-generic-'));
  try {
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'a.js'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'lib', 'b.js'), 'export const b = 2;\n');
    const before = await extractArchFacts(dir);
    // 加一行 import
    writeFileSync(join(dir, 'lib', 'a.js'), "import { b } from './b.js';\nexport const a = b;\n");
    const after = await extractArchFacts(dir);
    assert.notEqual(signature(before), signature(after),
      '改了一行 import，输出却没变 ⇒ 说明没有真的在读文件/解析依赖');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('验收③：源码根为仓库根（代码全在根目录）时必须能提取到模块与边', async () => {
  // 造一个「没有 lib/src、代码全在根」的仓库：核心文件之间互相 require
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-arch-root-'));
  try {
    writeFileSync(join(dir, 'core.js'), "const p = require('./progress.js');\nmodule.exports = { p };\n");
    writeFileSync(join(dir, 'progress.js'), 'module.exports = { n: 1 };\n');
    writeFileSync(join(dir, 'cli.js'), "const c = require('./core.js');\nmodule.exports = { c };\n");
    const facts = await extractArchFacts(dir);
    assert.equal(facts.sourceRoot, '.', `代码全在根目录时源码根应为 '.'，实得 ${facts.sourceRoot}`);
    assert.ok(facts.modules.length >= 3, `应提取到 >=3 个模块，实得 ${facts.modules.length}`);
    assert.ok(facts.edges.length >= 2, `应提取到 >=2 条边，实得 ${facts.edges.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
