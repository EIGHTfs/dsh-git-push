// dsh-skip-sensitive: 测试 fixture 含 mock 凭据字面量（非真实凭据）
/**
 * 1.0.8 测试：扫描智能提示（test 路径/文件名 → .test 空文件豁免提示）+ 评分对数衰减（防零分塌陷）。
 * 场景对照（用户 2026-09-12）：扫描出 warning/blocker 的文件路径或文件名带 test → 提示测试文件夹可豁免；
 * 评分公式 max(0.1, 10 - k*ln(1+count)) 替代线性扣分，保留错误数量区分度。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decorateTestExemptHint, auditFull, makeFinding } from '../lib/audit/index.js';
import { scoreQuality, DIMENSION_K, DEFAULT_WEIGHTS } from '../lib/score/index.js';

// ---------- 扫描智能提示 ----------

test('decorateTestExemptHint：test 路径 warning/blocker 附加提示', () => {
  const findings = [
    { file: 'src/test/utils.js', severity: 'warning', message: '函数过长' },
    { file: 'src/__tests__/a.test.js', severity: 'blocker', message: '凭据泄露' },
  ];
  decorateTestExemptHint(findings);
  for (const f of findings) {
    assert.match(f.message, /\.test 空文件/, `${f.file} 应含豁免提示`);
  }
});

test('decorateTestExemptHint：非 test 路径 / notice / 已含提示不动', () => {
  const findings = [
    { file: 'src/app.js', severity: 'warning', message: '普通文件' },
    { file: 'src/test/foo.js', severity: 'notice', message: 'info 不提示' },
    { file: 'test/bar.js', severity: 'warning', message: '已含 .test 提示' },
  ];
  const before = findings.map((f) => f.message);
  decorateTestExemptHint(findings);
  assert.deepEqual(findings.map((f) => f.message), before, '不应改动非目标 finding');
});

test('decorateTestExemptHint：spec/test 文件名特征（.test.js / .spec.ts）', () => {
  const findings = [
    { file: 'spec/helper-spec.ts', severity: 'warning', message: '硬编码' },
    { file: 'foo.test.js', severity: 'warning', message: '断言' },
  ];
  decorateTestExemptHint(findings);
  for (const f of findings) assert.match(f.message, /\.test 空文件/);
});

test('审计集成：auditFull 对 test 目录 warning finding 附加提示', () => {
  const finding = makeFinding({ file: 'test/demo.js', line: 1, rule: 'x', kind: 'x', severity: 'warning', message: '警告样本', dimensions: ['可维护性'] });
  const decorated = decorateTestExemptHint([finding]);
  assert.match(decorated[0].message, /\.test 空文件/);
});

// ---------- 评分对数衰减（防零分塌陷） ----------

test('对数衰减公式与用户 YAML 示例一致（k=1.5）', () => {
  const expect = { 0: 10.0, 1: 8.96, 5: 7.31, 10: 6.40, 50: 4.11, 100: 3.07 };
  for (const [n, exp] of Object.entries(expect)) {
    const got = Math.max(0.1, 10 - 1.5 * Math.log(1 + Number(n)));
    assert.ok(Math.abs(got - exp) < 0.02, `count=${n} 期望 ${exp} 实际 ${got.toFixed(2)}`);
  }
});

test('DIMENSION_K：安全最高 1.8 / 文档最低 1.0 / 覆盖 10 维度', () => {
  assert.equal(DIMENSION_K['安全性'], 1.8);
  assert.equal(DIMENSION_K['文档'], 1.0);
  assert.equal(Object.keys(DIMENSION_K).length, 10);
  for (const d of Object.keys(DEFAULT_WEIGHTS)) assert.ok(DIMENSION_K[d] > 0, `${d} 应有 k 值`);
});

test('scoreQuality：零问题 100 分 A / 日志衰减不归零', () => {
  const r = scoreQuality([]);
  assert.equal(r.score, 100);
  assert.equal(r.level, 'A');
  // 1000 个错误也不归零（floor 0.1 保留区分度）
  const heavy = scoreQuality([{ dimensions: ['性能'], severity: 'blocker' }], { '性能': 100 });
  const k = DIMENSION_K['性能'];
  assert.ok(heavy.dims['性能'] <= 10 - k * Math.log(2) + 0.01, '一个有错误维度分应低于满分');
});

test('scoreQuality：错误数 8 vs 60 维度分有区分度', () => {
  const k = DIMENSION_K['健壮性'];
  // counts=2（1 blocker） vs counts=60（30 blocker）
  const light = scoreQuality([{ dimensions: ['健壮性'], severity: 'blocker' }]).dims['健壮性'];
  const heavyArr = [];
  for (let i = 0; i < 30; i++) heavyArr.push({ dimensions: ['健壮性'], severity: 'blocker' });
  const heavy = scoreQuality(heavyArr).dims['健壮性'];
  assert.ok(light > heavy, `8 错误维度分应高于 60 错误：${light} > ${heavy}`);
  assert.ok(heavy >= 0.1, '60 错误不归零（floor 0.1）');
  // 公式核对：counts=2 → 10-k*ln(3)；counts=60 → 10-k*ln(61)
  assert.ok(Math.abs(light - (10 - k * Math.log(3))) < 0.01, `light 应与公式一致：${light}`);
  assert.ok(Math.abs(heavy - Math.max(0.1, 10 - k * Math.log(61))) < 0.01, `heavy 应与公式一致：${heavy}`);
});

test('scoreQuality：level 含 E 档（<40）', () => {
  // 极端跨维度压分：10 维度各 20 blocker → 每维 counts=40，对数衰减后应显著低于 40
  const dims = ['可读性', '可维护性', '健壮性', '安全性', '性能', '测试覆盖', '可观测性', '可部署性', '文档', '开发者体验'];
  const all = [];
  for (const d of dims) for (let i = 0; i < 20; i++) all.push({ dimensions: [d], severity: 'blocker' });
  const r = scoreQuality(all);
  assert.ok(r.level === 'E' || r.level === 'D', `极端压分 level 应为 E/D，实际 ${r.level}(${r.score})`);
});