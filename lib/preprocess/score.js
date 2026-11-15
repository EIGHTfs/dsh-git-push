/**
 * 审计中间层 · 评分编排（**唯一调用 `scoreQuality` 的地方**）
 *
 * 分层后职责：
 *   引擎：产 findings + 声明 scoreSpec（dims/weights）→ 交出去就结束
 *   本层：把「引擎声明的默认权重 + 用户覆盖」合成为最终权重，套统一扣分曲线算分
 *   git/CLI/HTTP：只拿最终 quality 结果，不关心权重从哪来
 *
 * 为什么扣分曲线不放这里、也不开放：曲线是**跨引擎可比**的前提（见方案文档 §4.2「明确不开放」）。
 * 本层只做「权重合成 + 维度补齐 + 调 scoreQuality」，不碰 k 值/衰减公式。
 */

import { scoreQuality } from '../score/index.js';
import { getBuiltinScoreSpec, validateScoreSpec } from '../audit/score-spec.js';

/**
 * 通用兜底「规则前缀 → 维度」映射。
 *
 * 用在**第三方引擎只声明 rule 名、没填 finding.dimensions** 的场景：此时按规则前缀推断维度，
 * 让「引擎不声明维度」也能算出分（而不是所有 finding 都落不进任何维度、白拿满分）。
 * 内置引擎的 finding 自带 dimensions ⇒ 本映射对它恒不生效（不会改变现有评分）。
 *
 * 引擎自己的 `scoreSpec.dimOfRule` 优先于这张表（见 resolveDimension）。
 */
const RULE_PREFIX_DIMENSION = Object.freeze({
  security: '安全性',
  credential: '安全性',
  secret: '安全性',
  robustness: '健壮性',
  error: '健壮性',
  readability: '可读性',
  naming: '可读性',
  comment: '可读性',
  maintainability: '可维护性',
  complexity: '可维护性',
  duplicate: '可维护性',
  performance: '性能',
  perf: '性能',
  test: '测试覆盖',
  coverage: '测试覆盖',
  observability: '可观测性',
  logging: '可观测性',
  deploy: '可部署性',
  docs: '文档',
  documentation: '文档',
  structure: '文档',
  dx: '开发者体验',
});

/**
 * 按规则前缀推断维度（通用兜底）。
 * @param {string} rule 规则 id（形如 `security/no-hardcoded-credentials`）
 * @returns {string|undefined} 维度名；推断不出返回 undefined（**不猜**）
 */
export function fallbackDimOfRule(rule) {
  const prefix = String(rule || '').split('/')[0].trim().toLowerCase();
  if (!prefix) return undefined;
  return RULE_PREFIX_DIMENSION[prefix];
}

/**
 * 合成最终权重：引擎声明的 dims 作默认 → 用户覆盖压在上面。
 * 与旧行为等价：旧调用点直接把 userWeights 交给 `scoreQuality`，而它在内部做
 * `{ ...DEFAULT_WEIGHTS, ...weights }`；这里提前完成同一合成，因为默认权重现在来自**引擎声明**。
 * @param {{dims: Array<{id: string, weight: number}>}} scoreSpec
 * @param {object} [userWeights] 用户权重覆盖（键=维度名）
 * @returns {object} 权重对象（键=维度名）
 */
export function resolveWeights(scoreSpec, userWeights = {}) {
  const spec = scoreSpec && Array.isArray(scoreSpec.dims) && scoreSpec.dims.length ? scoreSpec : getBuiltinScoreSpec();
  const weights = {};
  for (const dim of spec.dims) weights[dim.id] = Number(dim.weight);
  // 用户覆盖优先。这里**不**过滤非法值：旧实现是 `{ ...DEFAULT_WEIGHTS, ...userWeights }` 的裸展开，
  //   过滤会改变「传了非法权重」时的结果（旧行为会把非数字代进算式），与「对外行为不变」冲突。
  for (const [key, value] of Object.entries(userWeights || {})) weights[key] = value;
  return weights;
}

/**
 * 给「缺 dimensions 的 finding」补维度（引擎未声明时用兜底映射）。
 *
 * 只处理**真的缺**的 finding：内置引擎每条 finding 都带 dimensions ⇒ 这里恒不生效，
 *   现有评分逐字不变（有测试钉住）。
 * @param {Array<object>} findings
 * @param {object} scoreSpec 引擎声明（其 dimOfRule 优先）
 * @returns {Array<object>} 新数组（不就地改调用方数据）
 */
export function fillMissingDimensions(findings = [], scoreSpec = getBuiltinScoreSpec()) {
  const engineDimOfRule = typeof scoreSpec?.dimOfRule === 'function' ? scoreSpec.dimOfRule : null;
  return findings.map((finding) => {
    if (Array.isArray(finding?.dimensions) && finding.dimensions.length) return finding;
    const dim = (engineDimOfRule ? engineDimOfRule(finding?.rule) : undefined) || fallbackDimOfRule(finding?.rule);
    if (!dim) return finding; // 推断不出就不猜：保持原样（计分口径不变）
    return { ...finding, dimensions: [dim] };
  });
}

/**
 * 算分（中间层唯一出口）。
 *
 * @param {Array<object>} findings 引擎产出的 findings
 * @param {object} [scoreSpec] 引擎声明的评分标准（缺省 = 内置引擎声明）
 * @param {object} [userWeights] 用户权重覆盖（来自设置）
 * @param {object} [context] 评分上下文：`{ files, dimFileCounts, dimRuleCounts, docsScore? }`
 *   —— 原样透传给 `scoreQuality`（含 `docsScore`：历史审计会用它，别丢）
 * @returns {object} `scoreQuality` 的结果（dims/score/level/weights/…，形状不变）
 */
export function score(findings = [], scoreSpec = getBuiltinScoreSpec(), userWeights = {}, context = {}) {
  const checked = validateScoreSpec(scoreSpec);
  // 声明不合法时退回内置声明并继续算分：评分不能因为「引擎声明写坏」而整块失败
  //   （fail-open 在这里是对的：分只是展示/排序用的，拦不拦由 blocker 决定）。
  // ⚠️ 但**不能静默**：退回时既要留痕迹（stderr，落进 job 输出/子进程日志），
  //   也要在结果体上打标（specFallback: true），否则就是「删了不报错、功能悄悄变差」的形态。
  const spec = checked.ok ? scoreSpec : getBuiltinScoreSpec();
  const weights = resolveWeights(spec, userWeights);
  const quality = scoreQuality(fillMissingDimensions(findings, spec), weights, context);
  if (checked.ok) return quality;
  // 为什么写 stderr 而不是 stdout：审计引擎入口（scripts/audit-gate.mjs）的 stdout 必须只有一行契约 JSON，
  //   往 stdout 写提示会直接破坏调用方的解析。
  try {
    process.stderr.write(`[score] scoreSpec 不合法，已退回内置声明：${checked.reason}\n`);
  } catch { /* 输出失败不影响算分 */ }
  return { ...quality, specFallback: true, specFallbackReason: checked.reason };
}
