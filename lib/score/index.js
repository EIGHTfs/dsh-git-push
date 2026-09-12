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
 * @param {Array} findings
 * @param {object} [weights] 覆盖权重（默认 DEFAULT_WEIGHTS）
 * @returns {{dims: object, score: number, level: 'A'|'B'|'C'|'D'}}
 */
export function scoreQuality(findings = [], weights = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const counts = countByDimension(findings);
  const dims = {};
  for (const d of DIMENSION_ORDER) {
    const weight = w[d] || 0;
    // 每个问题：warning 扣 1，blocker 扣 2；维度得分 = 10 - 扣分（下限 0），按权重折算
    const raw = Math.max(0, 10 - counts[d]);
    dims[d] = Number((raw * weight).toFixed(2));
  }
  // 总分归一化：dimSum 满分 = Σ(10 × weight) = 10 × totalWeight → score = dimSum / (10 × totalWeight) × 100
  const totalWeight = Object.values(w).reduce((a, b) => a + b, 0);
  const dimSum = Object.values(dims).reduce((a, b) => a + b, 0);
  const score = totalWeight > 0 ? Math.round((dimSum / (10 * totalWeight)) * 100) : 0;
  const level = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  return { dims, counts, score, level, weights: w };
}