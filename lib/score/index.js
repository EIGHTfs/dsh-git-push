/**
 * dsh-git-push 评分总入口
 *
 * 统一 10 维度加权评分：问题(dimensions) → 分维度计数 → 加权总分。
 * 每个编译函数声明 dimensions 绑定（支持一字段多维度）。
 * 权重沿用旧项目 10 维度表（合计 100）。
 */
export const DEFAULT_WEIGHTS = {
  '可读性': 15, '可维护性': 15, '健壮性': 15, '安全性': 18, '性能': 10,
  '测试覆盖': 10, '可观测性': 5, '可部署性': 5, '文档': 4, '开发者体验': 3,
};

export const DIMENSION_ORDER = Object.keys(DEFAULT_WEIGHTS);

/**
 * 按 10 维度汇总问题计数。
 * @param {Array} findings 统一问题对象数组（含 dimensions 字段）
 * @returns {{[dim]: number}} 分维度计数
 */
export function countByDimension(findings = []) {
  const counts = Object.fromEntries(DIMENSION_ORDER.map((d) => [d, 0]));
  for (const f of findings) {
    for (const d of f.dimensions || []) {
      if (d in counts) counts[d] += (f.severity === 'blocker' ? 2 : 1);
    }
  }
  return counts;
}

/**
 * 计算 10 维度评分与总分（0-100）。
 *
 * 公式（用户 2026-09-11 权威）：最终得分 = Σ(维度得分 × 权重) / Σ权重 × 10
 *   - dims[d] = 维度得分（0-10 原始分：10 - 该维度问题计数，warning 扣 1 / blocker 扣 2，下限 0）
 *   - score   = Σ(dims[d] × w[d]) / Σw × 10（满分区间的百分比映射 × 100，数学等价）
 * @param {Array} findings
 * @param {object} [weights] 覆盖权重（默认 DEFAULT_WEIGHTS）
 * @returns {{dims: object, score: number, level: 'A'|'B'|'C'|'D', weights: object}}
 */
export function scoreQuality(findings = [], weights = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const counts = countByDimension(findings);
  const dims = {};
  for (const d of DIMENSION_ORDER) {
    // 维度得分（0-10）：warning 扣 1，blocker 扣 2；下限 0。dims 存原始分（不乘权重）。
    dims[d] = Math.max(0, 10 - counts[d]);
  }
  // 最终得分 = Σ(维度得分 × 权重) / Σ权重 × 10（Σ(10×w)/Σw×10 = 100 满分；全扣时 Σ(0×w)/Σw×10 = 0）
  const totalWeight = Object.values(w).reduce((a, b) => a + b, 0);
  const weightedSum = DIMENSION_ORDER.reduce((a, d) => a + dims[d] * (w[d] || 0), 0);
  const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) : 0;
  const level = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  return { dims, counts, score, level, weights: w };
}