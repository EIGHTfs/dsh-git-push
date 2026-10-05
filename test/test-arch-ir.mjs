// ArchFacts IR 规范验收测试（规范第 6 节 8 条不变量）。
//
// 正例：在临时目录造最小仓库 → extractArchFacts → aggregateModules → toArchFacts → validateFacts 必须 0 错
// 负例：逐条破坏 IR 的一个不变量，validateFacts **必须报错**（这是「校验器真的在工作」的证明）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractArchFacts } from '../lib/arch/extract.js';
import { aggregateModules } from '../lib/arch/aggregate.js';
import { toArchFacts, ARCH_FACTS_SCHEMA } from '../lib/arch/ir.js';
import { validateFacts } from '../lib/arch/validate-facts.js';

/** 造一个最小仓库：lib/ 下三个文件，含 import 与 IO，够覆盖各条不变量。 */
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-ir-'));
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'a.js'), "const b = require('./b.js');\nmodule.exports = { b };\n");
  writeFileSync(join(dir, 'lib', 'b.js'), "const fs = require('node:fs');\nfs.readFileSync('data.json');\nmodule.exports = {};\n");
  writeFileSync(join(dir, 'lib', 'data.json'), '{}\n');
  return dir;
}

async function buildIr(dir) {
  const facts = await extractArchFacts(dir);
  const agg = aggregateModules(facts);
  return { facts, agg, ir: toArchFacts(agg, facts, { name: 'fixture', repoPath: dir }) };
}

test('正例：IR 通过全部不变量校验（0 错）', async () => {
  const dir = makeFixture();
  try {
    const { ir } = await buildIr(dir);
    assert.equal(ir.schema, ARCH_FACTS_SCHEMA);
    const r = validateFacts(ir, { repoPath: dir });
    assert.equal(r.ok, true, `不应有错，实得：${r.errors.join(' ｜ ')}`);
    assert.ok(r.counts.nodes > 0 && r.counts.module > 0, '应至少有一个模块节点');
    assert.equal(r.counts.nodes, ir.nodes.length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('负例：8 条不变量逐条破坏，校验器必须报错', async () => {
  const dir = makeFixture();
  try {
    const { ir } = await buildIr(dir);
    const cases = [
      ['① anchor 不存在', (x) => { x.nodes[0].anchor = 'lib/__nope__.js'; }],
      ['② module 的 members 为空', (x) => { x.nodes[0].members = []; }],
      ['③ evidence 为空', (x) => { x.nodes[0].evidence = []; }],
      ['④ 边引用了不存在的节点', (x) => { x.edges.push({ from: 'x', to: 'y', kind: 'import', count: 1, evidence: ['a.js:1'] }); }],
      ['⑤ 自环', (x) => { x.edges.push({ from: x.nodes[0].id, to: x.nodes[0].id, kind: 'import', count: 1, evidence: ['a.js:1'] }); }],
      ['⑥ 模块级环', (x) => {
        // 造两节点互指（members 各 1 个 ⇒ 视为模块级，环应判错）
        const a = x.nodes[0].id; const b = x.nodes[1].id;
        x.edges.push({ from: a, to: b, kind: 'import', count: 1, evidence: ['a.js:1'] });
        x.edges.push({ from: b, to: a, kind: 'import', count: 1, evidence: ['b.js:1'] });
      }],
      ['⑦ totals 不自洽', (x) => { x.totals.nodes = 999; }],
      ['⑧ kind 非法', (x) => { x.nodes[0].kind = 'bogus'; }],
    ];
    for (const [label, mutate] of cases) {
      const copy = JSON.parse(JSON.stringify(ir));
      mutate(copy);
      const r = validateFacts(copy, { repoPath: dir });
      assert.equal(r.ok, false, `「${label}」被破坏了，校验器却没报错`);
      assert.ok(r.errors.length > 0, `「${label}」应产生至少一条错误`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('第 6 条口径：聚合层环记 warning、模块级环记 error', () => {
  // 手工构造：两个「聚合节点」（members 各 2 个）互指 ⇒ 应为 warning 而非 error
  const ir = {
    schema: ARCH_FACTS_SCHEMA,
    repo: { name: 'x', root: '', sourceRoot: 'lib' },
    totals: { files: 0, funcs: 0, nodes: 2, edges: 2 },
    nodes: [
      { id: 'g1', kind: 'module', label: 'g1', layer: 'g1', members: ['lib/a.js', 'lib/b.js'], anchor: 'lib/a.js', stats: {}, io: {}, evidence: ['lib/a.js'] },
      { id: 'g2', kind: 'module', label: 'g2', layer: 'g2', members: ['lib/c.js', 'lib/d.js'], anchor: 'lib/c.js', stats: {}, io: {}, evidence: ['lib/c.js'] },
    ],
    edges: [
      { from: 'g1', to: 'g2', kind: 'import', count: 1, evidence: ['x:1'] },
      { from: 'g2', to: 'g1', kind: 'import', count: 1, evidence: ['y:1'] },
    ],
    groups: [],
  };
  const r = validateFacts(ir); // 不给 repoPath ⇒ 不校验文件存在，只验拓扑
  assert.equal(r.errors.length, 0, `聚合层环不应算错误：${r.errors.join(' ｜ ')}`);
  assert.ok(r.warnings.some((w) => w.includes('聚合层环')), `应记 warning，实得：${r.warnings.join(' ｜ ')}`);
});
