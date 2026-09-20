/**
 * dsh-git-push 评分总入口
 *
 * 统一 10 维度加权评分：问题(dimensions) → 分维度计数 → 加权总分。
 * 每个编译函数声明 dimensions 绑定（支持一字段多维度）。
 * 权重沿用 10 维度表（合计 100）。
 *
 * 审计豁免见 .auditignore（本文件是配置数据表，魔数即参数值，不适用魔数类规则）。
 */
export const DEFAULT_WEIGHTS = {
  '可读性': 15, '可维护性': 15, '健壮性': 15, '安全性': 18, '性能': 10,
  '测试覆盖': 10, '可观测性': 5, '可部署性': 5, '文档': 4, '开发者体验': 3,
};

/**
 * 每维度对数衰减系数 k（2026-09-13 约定：扣分平缓化，线性改对数 + 5 档调 k）。
 * 单维度评分：max(0.1, base - k * ln(1 + errorCount))，base=10。
 * k 按维度重要性分 5 档：安全类衰减最快（k=1.5），文档/开发者体验最宽松（k=0.8）。
 * 比旧版（安全 1.8 / 其余 1.0-1.5）整体调低 0.2-0.3——同样错误数下扣分更温和、不会一下子扣完。
 * 注：10 个维度权重（DEFAULT_WEIGHTS）由侧边栏可调，k 是固定的 5 档衰减系数，两者独立。
 */
export const DIMENSION_K = {
  '可读性': 1.3, '可维护性': 1.3, '健壮性': 1.3, '安全性': 1.5, '性能': 1.1,
  '测试覆盖': 1.0, '可观测性': 1.0, '可部署性': 1.0, '文档': 0.8, '开发者体验': 0.8,
};

export const DIMENSION_ORDER = Object.keys(DEFAULT_WEIGHTS);

/** 等级分界（score ≥ 阈值取该级；A 最优，E 最差）。 */
export const LEVEL_A_MIN = 85;
export const LEVEL_B_MIN = 70;
export const LEVEL_C_MIN = 55;
export const LEVEL_D_MIN = 40;
/** 单维度得分下限：错误再多也保留微弱区分度（不塌陷成 0）。 */
export const DIMENSION_SCORE_FLOOR = 0.1;

/**
 * 按 10 维度汇总问题计数。
 * @param {Array} findings 统一问题对象数组（含 dimensions 字段）
 * @returns {{[dim]: number}} 分维度计数
 */
export function countByDimension(findings = []) {
  const counts = Object.fromEntries(DIMENSION_ORDER.map((d) => [d, 0]));
  for (const f of findings) {
    // 2026-09-13：scoreImpact: 0 的纯提醒（语义占位提示：npm audit 人工核查 / a11y /
    //   路径穿越人工确认）不拉低质量分——它们不是「代码质量缺陷」，只是需要人工确认的
    //   提示项；照常展示但不计入评分维度计数（severity=notice 且声明 0 影响的都不计）。
    if (f.scoreImpact === 0) continue;
    for (const dim of f.dimensions || []) {
      if (dim in counts) counts[dim] += (f.severity === 'blocker' ? 2 : 1);
    }
  }
  return counts;
}

/**
 * 计算 10 维度评分与总分（0-100）。
 *
 * 公式（用户 2026-09-11 权威 + 2026-09-12 防零分塌陷升级）：
 *   - dims[d] = 维度得分（0-10 原始分）：max(0.1, base - k_d * ln(1 + errorCount_d))
 *     base=10；k_d 见 DIMENSION_K（5 档：安全 1.5 / 可读·可维护·健壮 1.3 / 性能 1.1 / 测试·可观测·可部署 1.0 / 文档·开发者体验 0.8）
 *     errorCount 按 countByDimension：warning 计 1 / blocker 计 2
 *   - score   = Σ(dims[d] × w[d]) / Σw × 10（满分区间的百分比映射 × 100，数学等价）
 * 防零分塌陷：对数衰减替代线性扣分——10 个错误和 100 个错误有明显分差（不都归 0），floor=0.1 保留微弱区分度。
 * @param {Array} findings
 * @param {object} [weights] 覆盖权重（默认 DEFAULT_WEIGHTS）
 * @param {object} [context] { files?: number, scope?: string } —— files=0（空目录/0 变动）时
 *   不评分（score:null + emptyResult:true），防止「没扫到任何文件却直接满分」。
 * @returns {{dims: object, score: number|null, level: 'A'|'B'|'C'|'D'|'E'|null, weights: object, emptyResult?: boolean, emptyReason?: string}}
 */
export function scoreQuality(findings = [], weights = {}, context = {}) {
  const { files = null, docsScore = null } = context;
  // 2026-09-16：0 文件（空目录 / diff 0 变动）不评分——findings 为空时对数衰减天然给满分，
  //   但「没扫到任何文件」不等于「代码健康」，返回 null 明确区分（调用方展示「未扫描到内容」）。
  if (files !== null && Number(files) === 0) {
    return {
      dims: {}, counts: {}, score: null, level: null,
      weights: { ...DEFAULT_WEIGHTS, ...weights },
      emptyResult: true,
      emptyReason: '未扫描到任何文件（空目录或 0 个变动文件），未评分',
    };
  }
  const weightMap = { ...DEFAULT_WEIGHTS, ...weights };
  const counts = countByDimension(findings);
  const dims = {};
  // 2026-09-21：文档维度加分制（需求讨论 DeepSeekHarness/文档加分制.md）——
  //   文档得分 = min(10, Σ命中加分项分值)，0 分起、上限 = 其他扣分制维度满分；
  //   分值来自 docsScore.items[].score（配置可调，缺省每项 2.5）；
  //   docsScore 缺省（旧调用不传 context.docsScore）→ 回退扣分制，兼容。
  const docsTotal = Array.isArray(docsScore?.items)
    ? docsScore.items.filter((i) => i.hit).reduce((a, i) => a + (Number(i.score) || 0), 0)
    : NaN;
  for (const dim of DIMENSION_ORDER) {
    // 对数衰减（防零分塌陷）：score = max(DIMENSION_SCORE_FLOOR, 10 - k*ln(1+count))。dims 存原始分（不乘权重）。
    if (dim === '文档' && Number.isFinite(docsTotal)) {
      dims[dim] = Math.min(10, docsTotal);
      continue;
    }
    const k = DIMENSION_K[dim] ?? 1.5;
    dims[dim] = Math.max(DIMENSION_SCORE_FLOOR, 10 - k * Math.log(1 + counts[dim]));
  }
  // 最终得分 = Σ(维度得分 × 权重) / Σ权重 × 10（Σ(10×w)/Σw×10 = 100 满分；floor 0.1 时全扣 ≈ 1 分）
  // 2026-09-15：保留一位小数（不再 Math.round 取整）——整数分丢失维度间差异（79 与 79.4 同显 79），
  //   侧边栏/工具展示更精细；level 档位用同一位小数分判定。
  const totalWeight = Object.values(weightMap).reduce((a, b) => a + b, 0);
  const weightedSum = DIMENSION_ORDER.reduce((a, d) => a + dims[d] * (weightMap[d] || 0), 0);
  // 百分比映射：Σ(dims×w)/Σw 是 0~10 的分值，×10 归一到 0~100；再保留一位小数
  const percentScale = 10;
  const decimalPlaces = 10;
  const score = totalWeight > 0 ? Math.round(((weightedSum / totalWeight) * percentScale) * decimalPlaces) / decimalPlaces : 0;
  const level = score >= LEVEL_A_MIN ? 'A' : score >= LEVEL_B_MIN ? 'B' : score >= LEVEL_C_MIN ? 'C' : score >= LEVEL_D_MIN ? 'D' : 'E';
  return { dims, counts, score, level, weights: weightMap };
}