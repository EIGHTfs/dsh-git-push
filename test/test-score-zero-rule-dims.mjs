/**
 * 「零规则维度权重记 0」测试（方向 B 评分诚实度，2026-11-06）。
 *
 * 问题：评分公式对「无命中维度」给满分 10 并按设定权重计入总分。若某维度在本次生效
 *   规则集里**一条规则都没绑定**（无检测能力），它照样贡献满分——把「测不到」算成「质量高」。
 *   实测外部 PySide6 仓库：安全性权重 18 仅 3 处绑定、测试覆盖/可观测性/开发者体验 0 处绑定，
 *   五维齐满分抬到 85/A，人工核实却存在 6 个真问题（含路径穿越与凭据双向失灵）。
 * 口径：dimRuleCounts（维度→生效规则绑定数）给出时，绑定数为 0 的维度权重记 0
 *   （等价于剔出分母），并回传 uncoveredDimensions 供报告显式标注。
 * 兼容：缺 dimRuleCounts（旧调用方/独立调用）⇒ 逐位等价于改造前。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreQuality, DIMENSION_ORDER, DEFAULT_WEIGHTS } from '../lib/score/index.js';

const mk = (dim, file) => ({
  file, rule: 'r1', dimensions: [dim], severity: 'warning', scoreImpact: 1,
});

/** 除 listed 外全部维度都算「有检测能力」（各给 1 条规则绑定）。 */
const countsExcept = (...listed) => Object.fromEntries(
  DIMENSION_ORDER.map((d) => [d, listed.includes(d) ? 0 : 1]),
);

test('① 零绑定维度：权重记 0、进 uncoveredDimensions，不计入总分分母', () => {
  const r = scoreQuality([], {}, { files: 100, dimRuleCounts: countsExcept('可观测性', '开发者体验') });
  assert.equal(r.dynamicWeights['可观测性'], 0, '零绑定维度权重必须为 0');
  assert.equal(r.dynamicWeights['开发者体验'], 0, '零绑定维度权重必须为 0');
  assert.deepEqual(r.uncoveredDimensions, ['可观测性', '开发者体验'],
    '无检测能力的维度必须显式回传，供报告标注');
  assert.equal(r.score, 100, '剔除无检测能力维度后，其余满分维度仍应是 100（不应塌成 0）');
});

test('② 诚实性效果：无检测能力维度的「假满分」不再稀释真扣分', () => {
  // 场景：只有「可读性」被测且出问题，其余维度里若干条无检测能力。
  const findings = Array.from({ length: 10 }, (_, i) => mk('可读性', `f${i}.js`));
  const old = scoreQuality(findings, {}, { files: 100 });                      // 旧口径：九维假满分抬分
  const honest = scoreQuality(findings, {}, { files: 100, dimRuleCounts: { 可读性: 1 } }); // 只有可读性有检测能力
  assert.ok(honest.score < old.score,
    `剔掉无检测能力的满分维度后，总分应更能反映真实问题：honest=${honest.score} old=${old.score}`);
  assert.deepEqual(honest.uncoveredDimensions, DIMENSION_ORDER.filter((d) => d !== '可读性'),
    '除可读性外全部维度都应标注为无检测能力');
});

test('③ 全维度都有绑定 → 与不传 dimRuleCounts 逐位一致（向后兼容）', () => {
  const findings = [mk('可读性', 'a.js'), mk('安全性', 'b.js', { severity: 'blocker', scoreImpact: 2 })];
  const allBound = Object.fromEntries(DIMENSION_ORDER.map((d) => [d, 2]));
  const a = scoreQuality(findings, {}, { files: 50, dimRuleCounts: allBound });
  const b = scoreQuality(findings, {}, { files: 50 });
  assert.equal(a.score, b.score, '全覆盖时分数不应因新口径改变');
  assert.deepEqual(a.uncoveredDimensions, [], '全覆盖时无未检测维度');
  for (const d of DIMENSION_ORDER) assert.equal(a.dynamicWeights[d], b.dynamicWeights[d], d);
});

test('④ 全塌保护：dimRuleCounts 十维全 0（自定义规则集不声明 dimensions）→ 退回旧口径', () => {
  const allZero = Object.fromEntries(DIMENSION_ORDER.map((d) => [d, 0]));
  const r = scoreQuality([], {}, { files: 100, dimRuleCounts: allZero });
  assert.equal(r.score, 100, '十维全 0 时不得把满分仓库算成 0 分');
  assert.equal(r.uncoveredDimensions, null, '未启用本口径时回传 null（区分「都覆盖」与「口径未启用」）');
  for (const d of DIMENSION_ORDER) {
    assert.ok(r.dynamicWeights[d] > 0, `${d} 应恢复设定权重`);
  }
});

test('⑤ 缺 dimRuleCounts（旧调用方）→ 行为与改造前完全一致', () => {
  const findings = [mk('性能', 'x.js')];
  const legacy = scoreQuality(findings, {}, { files: 10 });
  assert.equal(legacy.uncoveredDimensions, null, '口径未启用时回传 null（区别于空数组=全覆盖）');
  // 无命中维度保持设定权重（正是旧行为：满分维度贡献满权重）
  for (const d of DIMENSION_ORDER) {
    if (d === '性能') continue;
    assert.ok(legacy.dynamicWeights[d] > 0, `${d} 不应被记 0`);
  }
  // 传 {} 等同不传（没有任何维度给出「有检测能力」的证据 → 整条口径不启用）
  const empty = scoreQuality(findings, {}, { files: 10, dimRuleCounts: {} });
  assert.equal(empty.score, legacy.score, 'dimRuleCounts={} 应与不传逐位一致');
  assert.equal(empty.uncoveredDimensions, null);
});
