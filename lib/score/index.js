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

/**
 * 每维度对数衰减系数 k（用户 2026-09-12「代码质量评分规则（防零分塌陷版）」YAML）。
 * 单维度评分：max(0.1, base - k * ln(1 + errorCount))，base=10。
 * k 按维度重要性调整：安全类衰减更快（k=1.8，安全问题更严重），文档/开发者体验宽松（k=1.0）。
 * 与 DEFAULT_WEIGHTS 键序一致（同维度名）。
 */
export const DIMENSION_K = {
  '可读性': 1.5, '可维护性': 1.5, '健壮性': 1.5, '安全性': 1.8, '性能': 1.3,
  '测试覆盖': 1.2, '可观测性': 1.2, '可部署性': 1.2, '文档': 1.0, '开发者体验': 1.0,
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
 * 公式（用户 2026-09-11 权威 + 2026-09-12 防零分塌陷升级）：
 *   - dims[d] = 维度得分（0-10 原始分）：max(0.1, base - k_d * ln(1 + errorCount_d))
 *     base=10；k_d 见 DIMENSION_K（安全 1.8 / 性能 1.3 / 测试·可观测·可部署 1.2 / 文档·开发者体验 1.0 / 其余 1.5）
 *     errorCount 按 countByDimension：warning 计 1 / blocker 计 2
 *   - score   = Σ(dims[d] × w[d]) / Σw × 10（满分区间的百分比映射 × 100，数学等价）
 * 防零分塌陷：对数衰减替代线性扣分——10 个错误和 100 个错误有明显分差（不都归 0），floor=0.1 保留微弱区分度。
 * @param {Array} findings
 * @param {object} [weights] 覆盖权重（默认 DEFAULT_WEIGHTS）
 * @returns {{dims: object, score: number, level: 'A'|'B'|'C'|'D'|'E', weights: object}}
 */
export function scoreQuality(findings = [], weights = {}) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const counts = countByDimension(findings);
  const dims = {};
  for (const d of DIMENSION_ORDER) {
    // 对数衰减（防零分塌陷）：score = max(0.1, 10 - k*ln(1+count))。dims 存原始分（不乘权重）。
    const k = DIMENSION_K[d] ?? 1.5;
    dims[d] = Math.max(0.1, 10 - k * Math.log(1 + counts[d]));
  }
  // 最终得分 = Σ(维度得分 × 权重) / Σ权重 × 10（Σ(10×w)/Σw×10 = 100 满分；floor 0.1 时全扣 ≈ 1 分）
  const totalWeight = Object.values(w).reduce((a, b) => a + b, 0);
  const weightedSum = DIMENSION_ORDER.reduce((a, d) => a + dims[d] * (w[d] || 0), 0);
  const score = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) : 0;
  const level = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'E';
  return { dims, counts, score, level, weights: w };
}