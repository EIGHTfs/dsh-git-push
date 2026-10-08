/**
 * 分析覆盖率（lib/audit/analysis-coverage.js）回归测试。
 *
 * 钉子：
 *   ① 覆盖率 = 连边 / 可解析调用（成员调用排除在分母外，且单独计数）
 *   ② 未解析按原因与按文件归类，供定位「解析不到」的位置
 *   ③ **不参与评分**：同一仓库开/关覆盖率，summary 与 quality 必须逐字节一致（信息项的本质）
 *   ④ diff 范围（文件集不完整）不给失真数字，而是明确 skipped
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { computeAnalysisCoverage, formatAnalysisCoverageLine } from '../lib/audit/analysis-coverage.js';
import { callTool } from '../lib/app/tool-call.js';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';

/** 造一个临时工程（含跨文件调用与成员调用）。 */
function makeProject() {
  const root = mkdtempTracked('cov-');
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(join(root, 'lib', 'a.js'), 'export function alpha() { return 1; }\n');
  writeFileSync(join(root, 'lib', 'b.js'), 'import { alpha } from "./a.js";\nexport function beta() { console.log(1); return alpha(); }\n');
  writeFileSync(join(root, 'lib', 'c.js'), 'export function gamma() { return mystery(); }\n');
  return root;
}

test('computeAnalysisCoverage：覆盖率口径与未解析归类', async () => {
  const root = makeProject();
  try {
    const files = [
      { path: 'lib/a.js', full: 'export function alpha() { return 1; }\n' },
      { path: 'lib/b.js', full: 'import { alpha } from "./a.js";\nexport function beta() { console.log(1); return alpha(); }\n' },
      { path: 'lib/c.js', full: 'export function gamma() { return mystery(); }\n' },
    ];
    const cov = await computeAnalysisCoverage({ files });
    assert.equal(cov.files, 3);
    assert.equal(cov.exports, 3, '三个导出');
    assert.equal(cov.calls, 2, 'beta 里的 alpha() 与 gamma 里的 mystery()（console.log 是成员调用，不计）');
    assert.equal(cov.memberCallsExcluded, 1);
    assert.equal(cov.edges, 1, '只有 import 那条能连边');
    assert.equal(cov.coverage, 50, '1/2 = 50%');
    assert.equal(cov.unresolvedByReason.unknown, 1);
    assert.ok(cov.topUnresolvedFiles.some((x) => x.file === 'lib/c.js' && x.count === 1), '未解析要能定位到文件');
    assert.match(cov.note, /不参与评分/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('formatAnalysisCoverageLine：一行摘要含关键数字与「不参与评分」声明', () => {
  const line = formatAnalysisCoverageLine({ files: 3, coverage: 50, edges: 1, calls: 2, unresolved: 1, unresolvedByReason: { unknown: 1 }, memberCallsExcluded: 1 });
  assert.match(line, /分析覆盖率 50%/);
  assert.match(line, /连边 1 \/ 可解析调用 2/);
  assert.match(line, /不参与评分/);
  assert.match(formatAnalysisCoverageLine({ skipped: 'diff 范围只含变动文件，覆盖率需 scope=full' }), /跳过/);
});

test('信息项本质：开/关覆盖率不改变 summary 与 quality（逐字节一致）', async () => {
  const root = makeProject();
  try {
    const base = { repo: root, scope: 'full' };
    const withCov = await callTool('code_audit', { ...base }, {}, {}, null, null, null);
    const withoutCov = await callTool('code_audit', { ...base, coverage: false }, {}, {}, null, null, null);
    assert.ok(withCov.analysisCoverage, '默认应带 analysisCoverage');
    assert.equal(withoutCov.analysisCoverage, undefined, 'coverage:false 时应不带');
    assert.deepEqual(withCov.summary, withoutCov.summary, 'summary 必须一致（不参与评分）');
    assert.deepEqual(withCov.quality, withoutCov.quality, 'quality 必须一致（不参与评分）');
    assert.deepEqual(withCov.blocked, withoutCov.blocked);
    assert.match(String(withCov.apiGuide), /分析覆盖率/, '文本摘要里要带上覆盖率行');
    assert.ok(!/分析覆盖率/.test(String(withoutCov.apiGuide)), '关闭时不该出现');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
