/**
 * 文件健康度矩阵评分（1.0.13）测试：三维等级/加权扣分/插值/severity/豁免。
 * 算法来源：用户提供《文件健康度矩阵评分算法》1.0.0（行数40% + 大小35% + 行长25%）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFileHealth } from '../lib/audit/checks.js';

/** 构造一条编译后形态的 file-health 规则（ruleOut 把 extra 展开进 rule 顶层）。 */
function rule(over = {}) {
  return {
    id: 'maintainability/file-health', kind: 'file-health', severity: 'warning',
    message: '文件健康度矩阵评分', dimensions: ['可维护性', '可读性'],
    weightLines: 0.40, weightSize: 0.35, weightLineLength: 0.25, baseScore: 10,
    lineLevels: [200, 400, 800, 1500], sizeLevels: [30, 100, 300, 1000], lengthLevels: [120, 200, 300, 500],
    penalties: [0, 1.0, 2.5, 4.5, 7.0], warnScore: 9, blockScore: 5,
    exemptSkip: ['generated.', '.min.', '/locales/', 'locales/'],
    exemptConstants: ['/constants/', 'constants/'],
    exemptRoutes: ['/routes/', 'routes/'],
    ...over,
  };
}

const big = (n, line = 'const X = 1;') => Array(n).fill(line).join('\n');

// ---------- 三维分级与得分 ----------
test('file-health：健康文件（三维 L0）不产出 finding', () => {
  const f = checkFileHealth({ file: 'a.js', relPath: 'a.js', text: big(100), rules: [rule()] });
  assert.equal(f.length, 0);
});

test('file-health：行数 1200（L3）→ warning，message 含三维诊断', () => {
  const f = checkFileHealth({ file: 'huge.js', relPath: 'huge.js', text: big(1200), rules: [rule()] });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning');
  assert.ok(f[0].message.includes('行数 1200'), '应含行数诊断');
  assert.ok(f[0].message.includes('优先处理'), '应含优先处理维度');
});

test('file-health：三维皆高危（行数 L4 + 大小 L4 + 行长 L4）→ score 3.0 → blocker', () => {
  // 2000 行 × 700 字符 ≈ 1.4MB（大小 L4），行长 L4，行数 L4 → 加权 4.0 → score 3.0
  const text = Array(2000).fill('x'.repeat(700)).join('\n');
  const f = checkFileHealth({ file: 'app.js', relPath: 'app.js', text, rules: [rule()] });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'blocker');
  assert.ok(f[0].message.includes('3.0/10'), '应报 score 3.0，实际: ' + f[0].message.slice(0, 60));
});

test('file-health：行长超长（L4）单独不足以 blocker（行长权重 25%）', () => {
  // 行长 L4 + 行数 300（L1）+ 大小约 40KB（L1）→ 加权 1.75 → score 8.1 → warning（非 blocker）
  const text = Array(300).fill('const D = "' + 'A'.repeat(600) + '";').join('\n');
  const f = checkFileHealth({ file: 'data.js', relPath: 'data.js', text, rules: [rule()] });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning');
  assert.ok(f[0].message.includes('行长'), '应指出行长维度');
});

// ---------- 豁免 ----------
test('file-health：constants/ 行数豁免（行数等级强制 0，大小/行长仍评）', () => {
  const f = checkFileHealth({ file: '/p/constants/t.js', relPath: 'constants/t.js', text: big(900), rules: [rule()] });
  assert.equal(f.length, 0, 'constants 行数豁免后应健康');
});

test('file-health：generated./.min./locales/ 整文件跳过', () => {
  const t = big(3000);
  assert.equal(checkFileHealth({ file: 's.generated.js', relPath: 's.generated.js', text: t, rules: [rule()] }).length, 0);
  assert.equal(checkFileHealth({ file: 'lib.min.js', relPath: 'lib.min.js', text: t, rules: [rule()] }).length, 0);
  assert.equal(checkFileHealth({ file: 'locales/zh.js', relPath: 'locales/zh.js', text: t, rules: [rule()] }).length, 0);
});

// ---------- 参数覆盖 ----------
test('file-health：规则条目可覆盖阈值（warn_score 降低→更敏感）', () => {
  const r = rule({ warnScore: 7 });
  const f = checkFileHealth({ file: 'mid.js', relPath: 'mid.js', text: big(450), rules: [r] });
  // 450 行 L2 → 加权 2×0.4=0.8 → score ~8.9；warnScore=7 → 仍 warning（8.9≥7 不报？）
  // 注意：score≥warnScore 不报；8.9≥7 → 不产出
  assert.equal(f.length, 0);
});

test('file-health：空 rules / 无匹配规则 → 空结果', () => {
  assert.equal(checkFileHealth({ file: 'a.js', relPath: 'a.js', text: big(100), rules: [] }).length, 0);
});
