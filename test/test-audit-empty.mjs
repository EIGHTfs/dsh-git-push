import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scoreQuality } from '../lib/score/index.js';
import { auditFull } from '../lib/audit/orchestrate.js';
import { findingsToYaml } from '../lib/audit/report-yaml.js';

test('scoreQuality：0 文件 → 不评分（emptyResult），防空扫描满分', () => {
  const r = scoreQuality([], {}, { files: 0 });
  assert.equal(r.score, null, '0 文件时 score 应为 null（不给满分 100）');
  assert.equal(r.level, null, '0 文件时 level 应为 null');
  assert.equal(r.emptyResult, true, '应标记 emptyResult');
  assert.ok(r.emptyReason && r.emptyReason.includes('未扫描'), 'emptyReason 应说明原因');
});

test('scoreQuality：有文件但 0 问题 → 正常满分（不是空结果）', () => {
  const r = scoreQuality([], {}, { files: 5 });
  assert.ok(!r.emptyResult, '有文件时不应标记 emptyResult');
  assert.equal(r.score, 100, '0 问题且文件数>0 是正常满分');
});

test('scoreQuality：不传 files 上下文 → 兼容旧行为（不判空）', () => {
  const r = scoreQuality([], {});
  assert.equal(r.emptyResult, undefined, '无 context 时不应有 emptyResult（旧调用兼容）');
  assert.equal(r.score, 100, '旧行为：空 findings 给满分（调用方负责判断空结果）');
});

test('findingsToYaml：层级聚合（summary → 级别 → 目录 → 文件 → 规则明细）', () => {
  const yaml = findingsToYaml([
    { file: 'lib/a.js', line: 1, rule: 'r1', severity: 'warning', message: 'm1' },
    { file: 'lib/a.js', line: 2, rule: 'r2', severity: 'warning', message: 'm2' },
    { file: 'b.js', line: 3, rule: 'r3', severity: 'blocker', message: 'm3' },
  ]);
  assert.ok(yaml.includes('blocker: 1'), 'summary 应统计 blocker=1');
  assert.ok(yaml.includes('warning: 2'), 'summary 应统计 warning=2');
  assert.ok(yaml.includes('lib/:'), '应按目录聚合（lib/）');
  assert.ok(yaml.includes('a.js:'), '目录下应按文件聚合（a.js）');
  assert.ok(yaml.includes('rule: r1'), '文件下应列规则明细');
  assert.ok(yaml.includes('b.js:'), '根级文件应归 ./');
});

test('auditFull：空目录返回 files=0 + yaml 字段', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-empty-'));
  try {
    const r = await auditFull(dir, {});
    assert.equal(r.files, 0, '空目录 files 应为 0');
    assert.equal(r.summary.total, 0, '空目录无 findings');
    assert.ok(typeof r.yaml === 'string' && r.yaml.includes('summary:'), '应返回 yaml 字符串');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
