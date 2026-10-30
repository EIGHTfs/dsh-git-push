/**
 * 动态权重分母口径 A 测试（2026-10-31）：分母 = 该维度**可作用文件数**（按规则 exts 声明），
 * 而不是总文件数。
 *
 * 起因（ModelStage 实测）：进入审计管道的文本文件里大量是模型清单 json（数据资产），
 *   可读性规则声明 exts=js/mjs/ts… 却按全部文件数摊薄权重 ⇒ 数据文件越多、代码问题
 *   扣得越轻，代码质量分被资产数量稀释（口径失真）。
 *
 * 修复后语义：
 *   - 某维度规则全部声明了 exts ⇒ 分母只数匹配这些扩展名的文件；
 *   - 有任一规则未声明 exts（= 作用全部文本文件，凭据扫描就是这类，密钥常藏在 json/yaml）
 *     ⇒ 该维度分母回到总文件数（正确，不是失真）；
 *   - 双重计数防护：同一文件对同一维度只 +1（commonDims 与 extDims 并集）；
 *   - 调用方不传 dimFileCounts ⇒ 回退总文件数（向后兼容，旧行为逐位一致）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeDimFileCounts } from '../lib/audit/orchestrate.js';
import { scoreQuality } from '../lib/score/index.js';

const mk = (dim, file) => ({ file, rule: 'r1', dimensions: [dim], severity: 'warning', scoreImpact: 1 });

test('computeDimFileCounts：只数规则 exts 匹配到的文件', () => {
  const grouped = {
    'regex': [{ id: 'readability/a', dimensions: ['可读性'], exts: ['js', 'mjs'] }],
  };
  const files = [
    { path: 'src/a.js' }, { path: 'src/b.mjs' }, { path: 'data/x.json' }, { path: 'img/y.png' },
  ];
  const counts = computeDimFileCounts(grouped, files);
  assert.equal(counts['可读性'], 2, 'js/mjs 各 1 → 2；json/png 不匹配 exts 不计');
});

test('computeDimFileCounts：未声明 exts 的规则按代码文件计', () => {
  // 这类规则（secret-*、复杂度、变量名…）实际只会作用代码文件——不限扩展名是
  //   「没声明」而不是「要查数据文件」。json/yml 不计入其维度分母。
  const grouped = {
    'credential': [{ id: 'secret-x', dimensions: ['安全性'] }],
  };
  const files = [{ path: 'a.js' }, { path: 'b.json' }, { path: 'c.yml' }, { path: 'd.py' }, { path: 'e.sh' }];
  assert.equal(computeDimFileCounts(grouped, files)['安全性'], 3, 'js/py/sh 是代码文件，json/yml 不是');
});

test('computeDimFileCounts：同一文件对同一维度只计 1 次（并集去重）', () => {
  // 可读性同时存在「未声明 exts 的规则」与「声明 js 的规则」：a.js 不能 +2
  const grouped = {
    'k1': [{ id: 'readability/generic', dimensions: ['可读性'] }],            // commonDims（按代码文件）
    'k2': [{ id: 'readability/scoped', dimensions: ['可读性'], exts: ['js'] }], // extDims.js
  };
  const counts = computeDimFileCounts(grouped, [{ path: 'a.js' }, { path: 'b.json' }]);
  assert.equal(counts['可读性'], 1, 'a.js 两条规则命中同一维度只 +1；b.json 不属于任一作用面');
});

test('computeDimFileCounts：取扩展名按 basename（带点目录不踩坑）', () => {
  const grouped = { 'k': [{ id: 'r', dimensions: ['可读性'], exts: ['ts'] }] };
  const counts = computeDimFileCounts(grouped, [{ path: 'docs/.vitepress/theme/index.ts' }]);
  assert.equal(counts['可读性'], 1, '路径里多个点必须取最后一段的扩展名');
});

test('computeDimFileCounts：同一规则 id 在多个 kind 组出现只处理一次', () => {
  const rule = { id: 'shared', dimensions: ['可维护性'], exts: ['js'] };
  const counts = computeDimFileCounts({ a: [rule], b: [rule] }, [{ path: 'x.js' }]);
  assert.equal(counts['可维护性'], 1);
});

test('scoreQuality：dimFileCounts 存在时分母用它（而非总文件数）', () => {
  const f = [mk('可读性', 'a.js')];
  // 总文件 1000（数据 json 陪跑），但可读性只作用 10 个代码文件、命中 1 个 → 权重 ×0.1
  const q = scoreQuality(f, {}, { files: 1000, dimFileCounts: { 可读性: 10 } });
  const expected = 15 * 0.1;
  assert.ok(Math.abs(q.dynamicWeights['可读性'] - expected) < 1e-9,
    `实际权重应为 ${expected}，得到 ${q.dynamicWeights['可读性']}`);
  // 对照：无 dimFileCounts 时按总文件数 → ×0.001（旧口径）
  const q2 = scoreQuality(f, {}, { files: 1000 });
  assert.ok(Math.abs(q2.dynamicWeights['可读性'] - 15 * 0.001) < 1e-9);
  // 方向注意：维度分母更小 → 动态权重更大 → 低分维度在加权中占更重 → 总分**更低**（惩罚回归真实）
  assert.ok(q.score < q2.score, '维度分母下惩罚更重（旧口径被数据文件稀释而偏乐观）');
});

test('scoreQuality：dimFileCounts 缺该维度时回退总文件数', () => {
  const f = [mk('健壮性', 'a.js')];
  const q = scoreQuality(f, {}, { files: 50, dimFileCounts: { 可读性: 10 } });
  // 健壮性不在 dimFileCounts → 用 files=50 摊薄
  assert.ok(Math.abs(q.dynamicWeights['健壮性'] - 15 * (1 / 50)) < 1e-9,
    `缺维度分母应回退总文件数，实际 ${q.dynamicWeights['健壮性']}`);
});

test('scoreQuality：分母被维度口径撑大也不会把权重放大过设定值', () => {
  // 极端：dimFileCounts 小于命中文件数（理论上不该发生，防御性 Math.min(1)）
  const f = [mk('可读性', 'a.js'), mk('可读性', 'b.js')];
  const q = scoreQuality(f, {}, { files: 10, dimFileCounts: { 可读性: 1 } });
  assert.ok(q.dynamicWeights['可读性'] <= 15, '动态权重上限 = 设定权重');
});
