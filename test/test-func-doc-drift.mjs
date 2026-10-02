// 审计侧「函数列表漂移」回归：只有带 dshgp-functions 标记块的仓库才检查；
// 块内容与真实扫描不一致 → structure/functions-doc-drift（warning）。
//
// 条件触发是本设计的要点：其他作者的仓库没有这份文档 → 不检查、不误报（与文件树漂移同款口径）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { auditFull } from '../lib/audit/index.js';
import { buildFuncListText } from '../scripts/doc-func.mjs';

const RULE = 'structure/functions-doc-drift';

// 造一个 dsh 插件形态的临时仓库：package.json(name=dsh-*) + lib/ 源码 + 可选 docs/FUNCTIONS.md。
// block 三种取值：'stale' 写假内容（必然漂移）/ 'fresh' 写最新扫描内容（无漂移）/ 'none' 不放文档。
function fixture(block) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-funcdrift-'));
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-fixture', version: '0.0.0' }));
  writeFileSync(join(dir, 'lib', 'sample.js'), 'export function alpha() { return 1; }\nexport const beta = () => 2;\n');
  if (block === 'none') return dir;
  mkdirSync(join(dir, 'docs'), { recursive: true });
  const body = block === 'fresh'
    ? buildFuncListText(dir).text
    : '### lib/sample.js（1 行 · 1 个函数）\n\n| 函数 | 行号 | 行数 | 签名 |\n|------|------|------|------|\n| `已经删掉的函数` | 1-1 | 1 | `function gone() {` |';
  writeFileSync(join(dir, 'docs', 'FUNCTIONS.md'),
    `# 函数列表\n\n<!-- dshgp-functions:start -->\n${body}\n<!-- dshgp-functions:end -->\n`);
  return dir;
}

// 跑全量审计并挑出函数漂移 finding。
// 用 auditFull（真编排）而不是只调 checkFuncDrift：要证明的是「审计确实会报」这条链路，
//   而不是脚本自己能比对（后者已有 test-doc-func 覆盖）。
async function driftFindings(dir) {
  const res = await auditFull(dir, { maxScanFiles: 0 });
  return (res.findings || []).filter((f) => f.rule === RULE);
}

test('函数列表漂移：块内容与扫描不一致 → 报 structure/functions-doc-drift', async () => {
  const dir = fixture('stale');
  try {
    const hits = await driftFindings(dir);
    assert.equal(hits.length, 1, '应恰好报一条函数列表漂移');
    assert.equal(hits[0].severity, 'warning', '漂移为 warning（不拦提交但提示维护）');
    assert.match(hits[0].file, /FUNCTIONS\.md$/, 'finding 指向函数列表宿主 md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('函数列表漂移：块内容与扫描一致 → 不报', async () => {
  const dir = fixture('fresh');
  try {
    assert.equal((await driftFindings(dir)).length, 0, '一致时不得误报');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('条件触发：没有函数列表文档的仓库 → 不检查（不误报外仓）', async () => {
  const dir = fixture('none');
  try {
    assert.equal((await driftFindings(dir)).length, 0, '无 dshgp-functions 标记块时不该出现该 finding');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
