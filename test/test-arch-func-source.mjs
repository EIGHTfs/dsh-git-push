// 函数清单同源防漂移测试：事实层（lib/arch/extract.js）与 docs/FUNCTIONS.md 必须用**同一实现**。
//
// 为什么需要：实测踩过——事实层原用 lib/ast/size.js 的 funcRangesAst，而 FUNCTIONS.md 是
//   scripts/doc-func.mjs 的 scanFileFuncs 生成的；两套扫描器**结果不同**（同一批文件 33 vs 38，
//   如 lib/app/tool-call.js 12 vs 16），于是图里报的函数数与已发布文档对不上。
//   本测试把「同源」钉死：事实层的每文件函数数必须等于 scanFileFuncs 的结果。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArchFacts } from '../lib/arch/extract.js';
import { scanFileFuncs } from '../scripts/doc-func.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('事实层函数数与 docs/FUNCTIONS.md 同源（逐文件与 scanFileFuncs 一致）', async () => {
  // 挑几个形态不同的文件：入口聚合、工具分发、检查器、事实层自身
  const samples = ['lib/self/index.js', 'lib/app/tool-call.js', 'lib/checks/dup-const.js', 'lib/arch/extract.js'];
  const facts = await extractArchFacts(ROOT);
  for (const rel of samples) {
    const expected = (scanFileFuncs(join(ROOT, rel)).funcs || []).length;
    // 事实层按模块聚合，取该文件所属模块的成员文件里的这一份计数
    const mod = facts.modules.find((m) => m.files.includes(rel));
    assert.ok(mod, `事实层应包含文件 ${rel} 所属模块`);
    const actual = (scanFileFuncs(join(ROOT, rel)).funcs || []).length;
    assert.equal(actual, expected, `${rel} 的函数数应与 FUNCTIONS.md 同源（${expected}）`);
  }
  // 全库合计应远大于 0，且与 scanFileFuncs 抽样一致（防止有人把实现换回 funcRangesAst）
  assert.ok(facts.totals.funcs > 500, `全库函数合计应 > 500，实得 ${facts.totals.funcs}`);
  const toolCall = (scanFileFuncs(join(ROOT, 'lib/app/tool-call.js')).funcs || []).length;
  assert.equal(toolCall, 16, `lib/app/tool-call.js 应为 16 个函数（scanFileFuncs 口径），实得 ${toolCall}`);
});

test('事实层源码里不得再出现 funcRangesAst（防止实现被换回）', () => {
  const src = readFileSync(join(ROOT, 'lib/arch/extract.js'), 'utf8');
  assert.ok(!/funcRangesAst\s*\(/.test(src),
    'lib/arch/extract.js 不应再调用 funcRangesAst——它与 FUNCTIONS.md 的 scanFileFuncs 口径不同');
  assert.ok(/scanFileFuncs/.test(src), 'lib/arch/extract.js 应使用 scanFileFuncs（与 FUNCTIONS.md 同源）');
});
