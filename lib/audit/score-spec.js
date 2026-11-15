/**
 * 自研引擎的**评分标准声明**（scoreSpec）
 *
 * 分层原则（docs/2026-11-15-审计中间层与引擎声明分层方案.MD §4.2）：
 *   - 引擎只**声明**「有哪些维度、各占多少权重」，不自己算分；
 *   - 算分（对数衰减曲线、动态权重、零规则维度记 0 等口径）永远在中间层
 *     （`lib/preprocess/score.js` → `lib/score/index.js` 的 `scoreQuality`），**不开放给引擎**。
 *   理由：一旦引擎能定制扣分曲线，「换引擎分数口径就变」，与「引擎可替换但分数可比」的初衷相反。
 *
 * 与 `lib/score/index.js` 的 `DEFAULT_WEIGHTS` 是**两份**（引擎声明 / 中间层兜底），
 *   由 `test/audit/test-score-spec.mjs` 钉住两者一致——防「改一处漏另一处」的静默漂移。
 *
 * 维度 id 直接用 `scoreQuality` 认识的维度名（与 finding.dimensions 同值）：
 *   这样「声明 → 权重表 → 计分」全程同一个键，不需要额外的 id→显示名映射表
 *   （多一层映射就多一个漂移点，且对现有评分口径零收益）。
 */

/**
 * 内置引擎声明的 10 个维度及其默认权重。
 * 权重语义：**相对占比**（`scoreQuality` 内部按 Σ权重 归一）。侧边栏「权重覆盖」可改。
 */
export const BUILTIN_DIMENSIONS = Object.freeze([
  { id: '可读性', weight: 15 },
  { id: '可维护性', weight: 15 },
  { id: '健壮性', weight: 15 },
  { id: '安全性', weight: 18 },
  { id: '性能', weight: 10 },
  { id: '测试覆盖', weight: 10 },
  { id: '可观测性', weight: 5 },
  { id: '可部署性', weight: 5 },
  { id: '文档', weight: 4 },
  { id: '开发者体验', weight: 3 },
]);

/**
 * 取内置引擎的评分标准声明。
 *
 * 每次返回**新对象/新数组**（dims 元素也复制）：声明是共享契约，调用方不该改到别人的副本。
 * @returns {{dims: Array<{id: string, weight: number}>, dimOfRule?: Function, note?: string}}
 */
export function getBuiltinScoreSpec() {
  return {
    dims: BUILTIN_DIMENSIONS.map((dim) => ({ ...dim })),
    // 内置引擎的 finding 自带 dimensions（由规则声明 + 编译器写入），不需要按 rule 反推；
    //   第三方引擎若只给 rule 名，由中间层的通用兜底映射补（见 lib/preprocess/score.js）。
    dimOfRule: undefined,
    note: '内置自研引擎：10 维固定权重，扣分曲线由中间层统一（引擎不参与）',
  };
}

/**
 * 声明是否「形状合法」（中间层消费前的轻校验）。
 *
 * 只校验**能不能用来算分**：dims 是非空数组、每项 id 是非空字符串、weight 是有限数字。
 * 不校验「维度名是否眼熟」——那会把第三方引擎的维度表达力掐死（换引擎就是要能换维度名）。
 * @param {object} scoreSpec
 * @returns {{ok: boolean, reason?: string}}
 */
export function validateScoreSpec(scoreSpec) {
  const dims = scoreSpec?.dims;
  if (!Array.isArray(dims) || dims.length === 0) return { ok: false, reason: 'scoreSpec.dims 必须是非空数组' };
  for (const dim of dims) {
    if (!dim || typeof dim.id !== 'string' || !dim.id.trim()) return { ok: false, reason: 'scoreSpec.dims[].id 必须是非空字符串' };
    if (!Number.isFinite(Number(dim.weight))) return { ok: false, reason: `scoreSpec.dims[${dim.id}].weight 必须是数字` };
  }
  if (scoreSpec.dimOfRule !== undefined && typeof scoreSpec.dimOfRule !== 'function') {
    return { ok: false, reason: 'scoreSpec.dimOfRule 若存在必须是函数' };
  }
  return { ok: true };
}
