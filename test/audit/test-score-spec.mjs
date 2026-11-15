/**
 * 评分权移交（批 1）：引擎声明 scoreSpec，中间层算分。
 *
 * 三条不变量（本文件就是它们的门禁）：
 *   ① **评分逐字一致**：老路径 `scoreQuality(findings, weights, ctx)` 与新路径
 *      `score(findings, spec, weights, ctx)` 在同仓库同 scope 上必须给出完全相同的
 *      `score / level / dims / counts / weights`；
 *   ② **声明与兜底表不漂移**：`getBuiltinScoreSpec().dims` 必须与 `lib/score` 的
 *      `DEFAULT_WEIGHTS` 完全一致（两份定义分别服务「引擎声明」与「中间层兜底」）；
 *   ③ **中间层独占算分**：仓库里只有 `lib/preprocess/score.js` 真的调用 `scoreQuality`
 *      （其余是定义与注释）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_WEIGHTS, scoreQuality } from '../../lib/score/index.js';
import { BUILTIN_DIMENSIONS, getBuiltinScoreSpec, validateScoreSpec } from '../../lib/audit/score-spec.js';
import {
  fallbackDimOfRule, fillMissingDimensions, resolveWeights, score,
} from '../../lib/preprocess/score.js';
import { auditFull } from '../../lib/audit/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('① 声明与兜底表一致：getBuiltinScoreSpec().dims ≡ DEFAULT_WEIGHTS（防两处漂移）', () => {
  const spec = getBuiltinScoreSpec();
  assert.ok(Array.isArray(spec.dims) && spec.dims.length, 'scoreSpec.dims 必须非空');
  // 维度集合与权重值必须完全相同（顺序也一致——顺序影响 DIMENSION_ORDER 的展示顺序）
  assert.deepEqual(spec.dims.map((d) => d.id), Object.keys(DEFAULT_WEIGHTS), '维度名与顺序必须与 DEFAULT_WEIGHTS 完全一致');
  assert.deepEqual(Object.fromEntries(spec.dims.map((d) => [d.id, d.weight])), { ...DEFAULT_WEIGHTS }, '每个维度的权重值必须一致');
  // 声明是共享契约：调用方改自己的副本不能污染下一个人
  spec.dims[0].weight = -999;
  assert.equal(getBuiltinScoreSpec().dims[0].weight, BUILTIN_DIMENSIONS[0].weight, '每次取声明都应是独立副本');
});

test('① 评分逐字一致：真实仓库上 老路径 scoreQuality ≡ 新路径 score（score/level/dims/counts/weights 全同）', async () => {
  // 用仓库自身当样本（有真实 findings、多维度、含 scoreImpact=0 的提示项）
  const result = await auditFull(ROOT, { maxScanFiles: 60, coverage: false });
  const findings = result.findings || [];
  assert.ok(findings.length > 0, '样本仓库应有 findings');
  const ctx = {
    files: result.files,
    dimFileCounts: result.dimFileCounts,
    dimRuleCounts: result.dimRuleCounts,
  };
  // 老路径：迁移前 5 个调用点的写法（直接调 scoreQuality + 用户权重）
  const legacy = scoreQuality(findings, {}, ctx);
  // 新路径：中间层（引擎声明 + 无用户覆盖）
  const next = score(findings, getBuiltinScoreSpec(), {}, ctx);
  assert.deepEqual(next, legacy, '默认权重下新旧评分必须逐字一致（整份对象）');

  // 带用户覆盖（含用户自定义维度键）也要一致
  const userWeights = { '安全性': 100, '文档': 0, '自定义维度': 7 };
  assert.deepEqual(score(findings, getBuiltinScoreSpec(), userWeights, ctx), scoreQuality(findings, userWeights, ctx), '用户权重覆盖下也必须逐字一致');
});

test('① 评分逐字一致：空目录（files=0）仍返回 emptyResult 且不变', async () => {
  const result = await auditFull(join(ROOT, 'docs'), { maxScanFiles: 0, coverage: false });
  const ctx = { files: 0, dimFileCounts: result.dimFileCounts, dimRuleCounts: result.dimRuleCounts };
  const legacy = scoreQuality(result.findings || [], {}, ctx);
  const next = score(result.findings || [], getBuiltinScoreSpec(), {}, ctx);
  assert.deepEqual(next, legacy);
  assert.equal(next.emptyResult, true, 'files=0 应返回 emptyResult（防「没扫到就满分」）');
});

test('② 声明校验：形状不合法的声明会被识别（中间层据此退回内置声明）', () => {
  assert.equal(validateScoreSpec(getBuiltinScoreSpec()).ok, true);
  assert.equal(validateScoreSpec({ dims: [] }).ok, false, '空 dims 不合法');
  assert.equal(validateScoreSpec({}).ok, false, '缺 dims 不合法');
  assert.equal(validateScoreSpec({ dims: [{ id: '', weight: 1 }] }).ok, false, '空 id 不合法');
  assert.equal(validateScoreSpec({ dims: [{ id: 'x', weight: 'abc' }] }).ok, false, '非数字权重不合法');
  assert.equal(validateScoreSpec({ dims: [{ id: 'x', weight: 1 }], dimOfRule: 'nope' }).ok, false, 'dimOfRule 非函数不合法');
  // 声明写坏时 score() 不能整块失败（退回内置声明继续算分），且必须**可观测**（不能静默）
  const bad = score([], { dims: [] }, {}, { files: 0 });
  assert.equal(bad.emptyResult, true, '非法声明应退回内置声明并正常返回结果');
  assert.equal(bad.specFallback, true, '退回时必须打标 specFallback:true（排查者要能知道这次用的是兜底声明）');
  assert.match(String(bad.specFallbackReason), /dims/, '退回原因要能读出来');
  // 正常路径不得出现退回标记（否则「打标」就变成噪音）
  assert.equal(score([], undefined, {}, { files: 0 }).specFallback, undefined, '正常路径不应带 specFallback');
});

test('③ 权重合成：引擎声明作默认、用户覆盖压在上面（与旧裸展开等价）', () => {
  const spec = getBuiltinScoreSpec();
  assert.deepEqual(resolveWeights(spec, {}), { ...DEFAULT_WEIGHTS }, '无覆盖时 = 声明默认值');
  assert.deepEqual(resolveWeights(spec, { '安全性': 100 }), { ...DEFAULT_WEIGHTS, '安全性': 100 }, '用户覆盖优先');
  // 用户加自定义维度键：保留（不裁掉），与旧实现 `{ ...DEFAULT_WEIGHTS, ...userWeights }` 等价
  assert.equal(resolveWeights(spec, { '自定义': 7 })['自定义'], 7);
});

test('③ 维度兜底：按 rule 前缀推断（引擎不声明维度时也能算分），推断不出就不猜', () => {
  assert.equal(fallbackDimOfRule('security/no-hardcoded-credentials'), '安全性');
  assert.equal(fallbackDimOfRule('readability/magic-number'), '可读性');
  assert.equal(fallbackDimOfRule('docs/missing-readme'), '文档');
  assert.equal(fallbackDimOfRule('unknown-slot/whatever'), undefined, '前缀不认识时返回 undefined（不猜维度）');
  assert.equal(fallbackDimOfRule(''), undefined);

  // 引擎自带 dimOfRule 时优先于通用兜底
  const spec = { dims: [{ id: '安全性', weight: 10 }], dimOfRule: (rule) => (rule === 'x/y' ? '安全性' : undefined) };
  const filled = fillMissingDimensions([{ rule: 'x/y' }, { rule: 'readability/magic-number' }, { rule: 'unknown/z' }], spec);
  assert.deepEqual(filled[0].dimensions, ['安全性'], '引擎声明优先');
  assert.deepEqual(filled[1].dimensions, ['可读性'], '引擎不认时走通用兜底');
  assert.equal(filled[2].dimensions, undefined, '都认不出时保持原样（不猜）');
  // 已带 dimensions 的 finding 不被覆盖（内置引擎恒走这条分支 ⇒ 现有评分不变）
  const kept = fillMissingDimensions([{ rule: 'security/x', dimensions: ['健壮性'] }], spec);
  assert.deepEqual(kept[0].dimensions, ['健壮性'], '已有维度不得被兜底改掉');
});

test('③ 中间层独占算分：仓库里只有 lib/preprocess/score.js 真的调用 scoreQuality', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!/\.(js|mjs)$/.test(entry.name)) continue;
      const rel = abs.slice(ROOT.length + 1);
      if (rel === 'lib/score/index.js') continue;          // 定义处
      if (rel === 'lib/preprocess/score.js') continue;     // 唯一调用处
      const text = readFileSync(abs, 'utf8');
      // 只查「真的调用」：scoreQuality( 出现即算（注释里的提及是说明，不算调用）
      for (const line of text.split('\n')) {
        if (/scoreQuality\s*\(/.test(line) && !/^\s*(\*|\/\/)/.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
      }
    }
  };
  walk(join(ROOT, 'lib'));
  walk(join(ROOT, 'scripts'));
  assert.deepEqual(offenders, [], `以下位置仍在直接调用 scoreQuality（应改为经 lib/preprocess/score.js）：\n${offenders.join('\n')}`);
});
