/**
 * 动态权重测试（2026-10-30）。
 *
 * 需求公式：实际权重 = 设定权重 × 动态权重，动态权重 = 命中文件数 / 总文件数。
 *
 * 三条口径（实现时逐条验证过，缺一条就会算出错误分数）：
 *   ① 分母用 Σ实际权重（不是固定 100）——否则「全绿」时有效权重全为 0，会把满分算成 0 分；
 *   ② **无命中的维度不缩放**（保持设定权重）——否则满分维度被自己的 0 权重拖成 0 分；
 *   ③ 文档维度也参与，其「命中文件数」取 docsScore.files（它是加分制，没有「命中问题的文件」概念）。
 *
 * 语义：某维度只在少数文件出问题 → 该维度实际权重按覆盖面缩小 → 扣分更轻；
 *   问题铺满全仓 → 动态权重=1 → 退化为纯静态权重（与历史分数逐位一致）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreQuality, countHitFilesByDimension, DEFAULT_WEIGHTS } from '../lib/score/index.js';

/** 造一条指定维度的 finding（scoreImpact=1 表示参与计分）。 */
const mk = (dim, file, extra = {}) => ({
  file, rule: 'r1', dimensions: [dim], severity: 'warning', scoreImpact: 1, ...extra,
});

test('全绿（100 文件、无 finding）→ 100 分，不会除零', () => {
  const r = scoreQuality([], {}, { files: 100 });
  assert.equal(r.score, 100, '无命中时所有维度用设定权重，必须满分');
});

test('命中 1/100 文件 → 动态权重把该维度压到 15×0.01，扣分极轻', () => {
  const r = scoreQuality([mk('可读性', 'f1.js')], {}, { files: 100 });
  // 可读性设定权重 15；命中 1/100 ⇒ 实际权重 0.15
  assert.ok(Math.abs(r.dynamicWeights['可读性'] - 15 * 0.01) < 1e-9,
    `实际权重应为 0.15，实际 ${r.dynamicWeights['可读性']}`);
  // 只损失该维度极小一部分 ⇒ 分数应显著高于静态口径
  const staticScore = scoreQuality([mk('可读性', 'f1.js')], {}, {}).score;
  assert.ok(r.score > staticScore, '命中面窄时分数应高于静态口径（惩罚更轻）');
  assert.ok(r.score > 99, `应接近满分，实际 ${r.score}`);
});

test('命中 100/100 文件 → 动态权重=设定权重，与静态口径逐位一致', () => {
  const findings = Array.from({ length: 100 }, (_, i) => mk('可读性', `f${i}.js`));
  const dyn = scoreQuality(findings, {}, { files: 100 });
  const stat = scoreQuality(findings, {}, {});
  assert.ok(Math.abs(dyn.dynamicWeights['可读性'] - DEFAULT_WEIGHTS['可读性']) < 1e-9,
    '全覆盖时动态权重应等于设定权重');
  assert.equal(dyn.score, stat.score, '全覆盖时总分必须与静态口径完全一致（向后兼容）');
});

test('单调性：命中面越大扣分越多', () => {
  const build = (n) => Array.from({ length: n }, (_, i) => mk('可读性', `f${i}.js`));
  const s1 = scoreQuality(build(1), {}, { files: 100 }).score;
  const s50 = scoreQuality(build(50), {}, { files: 100 }).score;
  const s100 = scoreQuality(build(100), {}, { files: 100 }).score;
  assert.ok(s1 > s50 && s50 > s100, `应为 s1>s50>s100，实际 ${s1} / ${s50} / ${s100}`);
});

test('不传 files（旧调用方）→ 全部不缩放，行为与改造前一致', () => {
  const f = [mk('可读性', 'f1.js')];
  const noFiles = scoreQuality(f, {}, {});
  const oneFile = scoreQuality(f, {}, { files: 1 });
  assert.equal(noFiles.score, oneFile.score, 'files=1 时动态权重=1，应等于不传 files');
  assert.ok(Math.abs(noFiles.dynamicWeights['可读性'] - DEFAULT_WEIGHTS['可读性']) < 1e-9,
    '不传 files 时不应缩放');
});

test('无命中的维度不被缩放（满分贡献必须保住）', () => {
  const r = scoreQuality([mk('可读性', 'f1.js')], {}, { files: 100 });
  // 其余 9 个维度无命中 ⇒ 实际权重 = 设定权重
  for (const dim of ['安全性', '性能', '测试覆盖', '文档']) {
    if (dim === '文档') continue; // 文档维度单独测
    assert.ok(Math.abs(r.dynamicWeights[dim] - DEFAULT_WEIGHTS[dim]) < 1e-9,
      `${dim} 无命中，实际权重应等于设定权重`);
  }
});

test('文档维度也参与：其动态权重取 docsScore.files / 总文件数', () => {
  const docsScore = { items: [], files: Array.from({ length: 10 }, (_, i) => `d${i}.md`), hits: [] };
  const r = scoreQuality([], {}, { files: 100, docsScore });
  assert.ok(Math.abs(r.dynamicWeights['文档'] - DEFAULT_WEIGHTS['文档'] * 0.1) < 1e-9,
    `文档实际权重应为 设定×0.1，实际 ${r.dynamicWeights['文档']}`);
});

test('文档维度无 docsScore.files 时回退不缩放（避免权重归零）', () => {
  const r = scoreQuality([], {}, { files: 100, docsScore: { items: [], hits: [], files: [] } });
  assert.ok(Math.abs(r.dynamicWeights['文档'] - DEFAULT_WEIGHTS['文档']) < 1e-9,
    '无文档文件信息时不应缩放');
});

test('countHitFilesByDimension：同文件多条只算 1 个命中文件', () => {
  const hits = countHitFilesByDimension([
    mk('可读性', 'a.js'), mk('可读性', 'a.js'), mk('可读性', 'a.js'),
    mk('可读性', 'b.js'),
  ]);
  assert.equal(hits['可读性'], 2, '两个文件命中 4 条 finding ⇒ 命中文件数应为 2');
});

test('countHitFilesByDimension：scoreImpact=0 的纯提示不计入命中', () => {
  const hits = countHitFilesByDimension([
    mk('可读性', 'a.js', { scoreImpact: 0 }),
    mk('可读性', 'b.js'),
  ]);
  assert.equal(hits['可读性'], 1, '只有参与计分的那条才算命中文件');
});

test('countHitFilesByDimension：无文件归属的仓库级 finding 记为 1', () => {
  const hits = countHitFilesByDimension([{ file: null, rule: 'folder', dimensions: ['可维护性'], severity: 'warning', scoreImpact: 1 }]);
  assert.equal(hits['可维护性'], 1, '仓库级 finding 应算 1 个命中，不能算 0');
});

test('空目录（files=0）仍返回未评分，不进入动态权重计算', () => {
  const r = scoreQuality([], {}, { files: 0 });
  assert.equal(r.score, null);
  assert.equal(r.emptyResult, true);
});

test('动态权重只影响总分，不改维度原始分 dims', () => {
  const f = [mk('可读性', 'f1.js')];
  const wide = scoreQuality(f, {}, { files: 100 });
  const narrow = scoreQuality(f, {}, { files: 1 });
  assert.equal(wide.dims['可读性'], narrow.dims['可读性'], 'dims 是维度原始分，不应受动态权重影响');
  assert.equal(wide.counts['可读性'], narrow.counts['可读性'], 'counts 同样不受影响');
});
