/**
 * 性能规则回归测试：循环体内「全量集合物化」（performance/loop-full-collection）。
 *
 * 样本来源（真实项目，非虚构）：
 *   dsh-codegraph `packages/core/src/indexer/symbol-table.ts` 第 213 / 342 行 ——
 *   在「按文件 / 按未解析继承」的循环体内写 `Array.from(this.nodes.values()).filter(...)`。
 *   实测：49 文件子集全量扫描 5047ms 中 `resolveCrossFileReferences` 独占 4621ms（91.6%），
 *   每文件成本随规模 54ms→102ms（10→50 文件）→ 292 文件时 1416ms/文件（413s 全量）。
 * 因此本测试用「该文件的真实片段」当正样本，确保规则真的能抓住这类坑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loopBodyLines, loopFullCollectionLines } from '../lib/ast/perf.js';
import { checkRegexRules } from '../lib/checks/regex.js';

/** 正样本：取自 dsh-codegraph symbol-table.ts 的结构（循环体内物化全表）。 */
const REAL_SAMPLE = [
  'for (const [filePath, extracted] of this.fileExtractionCache.entries()) {',
  '  for (const inh of extracted.unresolvedInheritance || []) {',
  '    if (!targetSuperId) {',
  '      const cleanName = superName.split(".").pop() || superName;',
  '      const candidates = Array.from(this.nodes.values()).filter(',
  '        (n) => n.entityType === "CLASS" && n.name.toLowerCase() === cleanName.toLowerCase()',
  '      );',
  '      if (candidates.length === 1) targetSuperId = candidates[0].id;',
  '    }',
  '  }',
  '}',
].join('\n');

/** 负样本：同样的写法，但在循环**外**（做一次快照是正常且必要的）。 */
const OUTSIDE_LOOP = [
  'const allNodes = Array.from(this.nodes.values());',
  'const classes = allNodes.filter((n) => n.entityType === "CLASS");',
].join('\n');

test('loopFullCollectionLines：循环体内命中（真实样本 213/342 行同构）', () => {
  const lines = loopFullCollectionLines(REAL_SAMPLE);
  assert.equal(lines.size, 1, '恰好命中一行');
  assert.ok(lines.has(5), '命中循环体内的第 5 行（Array.from(this.nodes.values())）');
});

test('loopFullCollectionLines：循环外不命中（不得误报）', () => {
  assert.equal(loopFullCollectionLines(OUTSIDE_LOOP).size, 0, '循环外物化一次是正常写法');
});

test('loopFullCollectionLines：forEach/map 回调体内同样算循环体', () => {
  const text = ['items.forEach((item) => {', '  const ids = Array.from(this.map.values());', '});'].join('\n');
  assert.equal(loopFullCollectionLines(text).size, 1, '回调体内物化应命中');
});

test('loopFullCollectionLines：单行无括号循环体不命中（已知局限，宁可漏报）', () => {
  const text = 'for (const x of xs) Array.from(this.m.values());';
  assert.equal(loopFullCollectionLines(text).size, 0, '无块体的单行循环不覆盖');
});

test('loopFullCollectionLines：注释/字符串里的示例不算命中（真实假阳性回归）', () => {
  // 真实假阳性：规则说明注释里写了 `Array.from(x.values())` 示例，且该注释恰在 for 循环体内，
  //   被自己的规则命中（allow 语义会跳过引擎的通用 codeFilter，必须在检查器内排掉）。
  const text = [
    'for (const x of xs) {',
    '  // 反例说明：循环内 Array.from(x.values()) 会二次增长',
    '  const s = "Array.from(y.values())";',
    '  real();',
    '}',
  ].join('\n');
  assert.equal(loopFullCollectionLines(text).size, 0, '注释与字符串里的示例不得命中');
});

test('loopBodyLines：for 圆括号内的对象字面量不干扰块体识别', () => {
  const text = ['for (const k of Object.keys({ a: 1, b: 2 })) {', '  use(k);', '}', 'after();'].join('\n');
  const lines = loopBodyLines(text);
  assert.ok(lines.has(2), '循环体内第 2 行在集合里');
  assert.ok(!lines.has(4), '循环体外的第 4 行不在集合里');
});

test('端到端：checkRegexRules 只在循环体内报该规则（allow 语义）', () => {
  const rule = {
    id: 'performance/loop-full-collection',
    name: '禁止在循环体内做全量集合物化',
    severity: 'warning',
    astConfirmKind: 'loop-full-collection',
    subPatterns: [{ id: 'array-from-values', regex: /Array\.from\s*\(\s*[A-Za-z_$][\w.$]*\.(values|keys|entries)\s*\(\s*\)\s*\)/, message: '循环体内全量物化集合' }],
  };
  const hit = checkRegexRules({ file: 'a.ts', text: REAL_SAMPLE, rules: [rule] });
  assert.equal(hit.length, 1, '循环体内命中一次');
  assert.equal(hit[0].ruleId || hit[0].rule, 'performance/loop-full-collection', '规则 id 正确');
  const miss = checkRegexRules({ file: 'a.ts', text: OUTSIDE_LOOP, rules: [rule] });
  assert.equal(miss.length, 0, '循环外不报');
});
