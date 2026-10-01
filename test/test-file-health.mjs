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

// ---------- 2026-10-06 误报修复：注释/行长/聚合型 ----------
test('file-health：行长按代码行计——注释内嵌示例 JSON 不再 L4（Java response 类误报源）', () => {
  // Javadoc 注释里 dump 整个 API 响应 JSON（单行 27 万字符），代码行长却很短
  const commentJson = '    /** response : {"id":1,"name":"x","data":' + 'A'.repeat(200000) + '} */';
  const body = [
    'public class Resp {',
    '    private int id;',
    commentJson,
    '    public int getId() { return id; }',
    '}',
  ].join('\n');
  const f = checkFileHealth({ file: 'Resp.java', relPath: 'app/responses/Resp.java', text: body, rules: [rule()] });
  assert.equal(f.length, 0, '注释内嵌超长 JSON 不应触发行长 L4（注释不计行长/行数/大小）');
});

test('file-health：聚合型（文件大但函数都合规）行数/大小豁免', () => {
  // 1200 行：3 个小函数 + 大量顶层小语句（有函数且都 ≤50 行）→ 聚合型 → 健康
  const lines = ['function a(){const x=1;}', 'function b(){const y=2;}', 'function c(){const z=3;}'];
  for (let i = 0; i < 1200; i++) lines.push(`const v${i} = ${i};`);
  const f = checkFileHealth({ file: 'agg.js', relPath: 'agg.js', text: lines.join('\n'), rules: [rule()] });
  assert.equal(f.length, 0, '聚合型（最大函数 ≤50）不按行数/大小扣分');
});

test('file-health：无函数纯脚本超长不豁免（保持 warning）', () => {
  // 无函数（maxFunctionLength=0）→ 无「函数多」证据 → 不豁免
  const f = checkFileHealth({ file: 'top.js', relPath: 'top.js', text: big(1200), rules: [rule()] });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning');
});

test('file-health：臃肿型（文件大因藏超大函数）不豁免——正常按行数计', () => {
  const lines = ['function bigOne(){'];
  for (let i = 0; i < 80; i++) lines.push(`const v${i} = ${i};`);
  lines.push('}');
  for (let i = 0; i < 1100; i++) lines.push(`const w${i} = ${i};`);
  const f = checkFileHealth({ file: 'fat.js', relPath: 'fat.js', text: lines.join('\n'), rules: [rule()] });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning', '存在超大函数时文件大仍按行数计分');
  assert.ok(f[0].message.includes('最大函数'), 'message 应显示最大函数行数');
});
