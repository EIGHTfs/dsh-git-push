/**
 * `.auditignore` 细粒度豁免（路径 : 规则）测试。
 *
 * 背景：`.auditignore` 原先只有「整文件跳过」一档，导致「只想免 magic-number」的文件
 *   被迫整文件豁免，连带把可读性/健壮性问题一起藏掉；而且豁免是静默的，
 *   报告里分不清「已确认豁免」与「未处理」。
 *
 * 本测试锁五件事：
 *   ① 解析：合法细粒度行 → 生效；规则段不像规则 id（Windows 盘符 / URL / a:b）→ 整行当文件模式；
 *   ② 拆分：细粒度行**不进**采集用文本（否则文件被整文件跳过，等于退化）；
 *   ③ 匹配：仅命中声明的规则（含 `slot/*` 通配），同文件其它规则照报；
 *   ④ 语义：命中后标记 exempted（不删），summary/评分/规则包统计都跳过它；
 *   ⑤ 端到端：写了细粒度行的文件仍然被采集（不像整文件条目那样消失）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  applyScopedExemptions, matchScopedExemption, parseScopedLine, ruleMatches, splitAuditIgnore,
} from '../../lib/audit/auditignore-rules.js';
import { summarize } from '../../lib/audit/finding.js';
import { countByDimension, countHitFilesByDimension } from '../../lib/score/index.js';

test('parseScopedLine：合法行解析出文件/规则/理由', () => {
  const r = parseScopedLine('lib/score/index.js : readability/magic-number-smart  # 权重参数表');
  assert.deepEqual(r, {
    filePattern: 'lib/score/index.js',
    rulePatterns: ['readability/magic-number-smart'],
    reason: '权重参数表',
  });
});

test('parseScopedLine：多规则 + 通配', () => {
  const r = parseScopedLine('a.js : robustness/*, paths/hardcoded-absolute-path');
  assert.deepEqual(r.rulePatterns, ['robustness/*', 'paths/hardcoded-absolute-path']);
  assert.equal(r.reason, '');
});

test('parseScopedLine：规则段不像规则 id ⇒ 不当细粒度（保护旧写法）', () => {
  for (const line of [
    'C:\\Users\\x\\file : something',     // 规则段非法
    'https://a.com/b : c',                // 同上
    'a:b',                                // 无两侧空格
    'a :b',                               // 单侧空格
    '# 注释 : 不算',
    'only-file.js',
  ]) assert.equal(parseScopedLine(line), null, `不应解析: ${line}`);
});

test('splitAuditIgnore：细粒度行不进 wholeText，注释与整文件条目保留', () => {
  const text = [
    '# 说明注释',
    'dist/',
    'lib/score/index.js : readability/magic-number-smart  # 参数表',
    'vendor/*.min.js',
  ].join('\n');
  const { wholeText, scoped } = splitAuditIgnore(text);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].filePattern, 'lib/score/index.js');
  assert.ok(!wholeText.includes('readability/magic-number-smart'), '细粒度行必须从采集文本里剔除');
  assert.ok(wholeText.includes('dist/'));
  assert.ok(wholeText.includes('vendor/*.min.js'));
  assert.ok(wholeText.includes('# 说明注释'));
});

test('ruleMatches：精确与 slot 通配', () => {
  assert.equal(ruleMatches('paths/hardcoded-absolute-path', 'paths/hardcoded-absolute-path'), true);
  assert.equal(ruleMatches('robustness/*', 'robustness/timeout-on-external-api'), true);
  assert.equal(ruleMatches('robustness/*', 'paths/hardcoded-absolute-path'), false);
  assert.equal(ruleMatches('*', 'readability/magic-number-smart'), true);
  assert.equal(ruleMatches('paths/*-path', 'paths/hardcoded-absolute-path'), true);
});

test('matchScopedExemption：只命中声明的规则，其它规则不受影响', () => {
  const { scoped } = splitAuditIgnore('lib/a.js : readability/magic-number-smart  # 参数表');
  assert.equal(matchScopedExemption(scoped, 'lib/a.js', 'readability/magic-number-smart').hit, true);
  assert.equal(matchScopedExemption(scoped, 'lib/a.js', 'paths/hardcoded-absolute-path').hit, false);
  assert.equal(matchScopedExemption(scoped, 'lib/b.js', 'readability/magic-number-smart').hit, false);
});

test('applyScopedExemptions：标记 exempted 并保留 finding（不删）', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-ai-'));
  try {
    writeFileSync(join(root, '.auditignore'), 'src/a.js : readability/magic-number-smart  # 映射表\n', 'utf8');
    const findings = [
      { file: 'src/a.js', line: 3, rule: 'readability/magic-number-smart', severity: 'warning', dimensions: ['可读性'], scoreImpact: 5 },
      { file: 'src/a.js', line: 9, rule: 'paths/hardcoded-absolute-path', severity: 'warning', dimensions: ['可部署性'], scoreImpact: 5 },
    ];
    const r = applyScopedExemptions(findings, root);
    assert.equal(r.total, 1);
    assert.equal(findings.length, 2, '豁免不能删掉 finding');
    assert.equal(findings[0].exempted, true);
    assert.equal(findings[0].exemptReason, '映射表');
    assert.equal(findings[0].exemptBy, 'auditignore');
    assert.equal(findings[1].exempted, undefined, '同文件其它规则照报');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('已豁免的 finding：summary / 维度计数 / 命中文件数都不计入', () => {
  const findings = [
    { file: 'a.js', rule: 'readability/magic-number-smart', severity: 'warning', dimensions: ['可读性'], scoreImpact: 5, exempted: true },
    { file: 'b.js', rule: 'paths/hardcoded-absolute-path', severity: 'warning', dimensions: ['可部署性'], scoreImpact: 5 },
  ];
  assert.deepEqual(summarize(findings), { blocker: 0, warning: 1, notice: 0, total: 1 });
  const counts = countByDimension(findings);
  assert.equal(counts['可读性'], 0, '已豁免维度不应被计数');
  assert.ok(counts['可部署性'] > 0);
  const hits = countHitFilesByDimension(findings);
  assert.equal(hits['可读性'], 0, '已豁免维度不应出现在命中统计里');
  assert.equal(hits['可部署性'], 1);
});

test('端到端：采集输入里只保留整文件条目（细粒度条目不会让文件消失）', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-ai2-'));
  try {
    writeFileSync(join(root, '.auditignore'), 'src/a.js : readability/magic-number-smart\nsrc/b.js\n', 'utf8');
    const { wholeText, scoped } = splitAuditIgnore(readFileSync(join(root, '.auditignore'), 'utf8'));
    // 采集阶段拿到的是 wholeText：a.js 不在其中（照样被采集），b.js 仍在（整文件跳过）
    assert.ok(!wholeText.includes('src/a.js'), '细粒度条目的文件不得进入采集忽略文本');
    assert.ok(wholeText.includes('src/b.js'), '整文件条目必须保留');
    assert.equal(scoped.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
