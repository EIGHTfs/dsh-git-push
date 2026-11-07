/**
 * 插件入口层 · 配置 schema（审计侧）
 *
 * 为什么单独成文件（2026-11-08 UI 与审计解耦 · 文件隔离阶段）：
 *   审计与 git 侧计划重构成两个独立项目，本阶段先把**文件边界**划清——
 *   审计相关设置键集中在本文件，git / 发布侧的键留在 `schema.js`。
 *   行为完全不变：`schema.js` 用 `...auditConfigShape(Schema)` 展开合并，
 *   产出的仍是同一个 Config 对象（同一批键、同一批默认值）。
 *
 * 边界判据：键的语义属于「静态检查 / 规则 / 评分 / 措辞」即归审计侧；
 *   属于「扫描仓库 / 克隆 / 推送 / 凭据 / 注入」留在 schema.js。
 *   `injectRequirements` 归审计侧：它是「提交前审计」的子开关（注入开发者要求清单）。
 */

/** 全量审计文件数上限默认值（0=不限）。 */
const DEFAULT_MAX_SCAN_FILES = 3000;

/**
 * 审计侧配置键形状。
 * @param {object} Schema schemastery（或 makeFallbackSchema 兜底实现）
 * @returns {object} 键名 → schema 字段
 */
export function auditConfigShape(Schema) {
  return {
    auditEnabled: Schema.boolean().default(false).description('提交前审计（默认关）'),
    // 提交前审计的子开关：开启后在系统提示词注入「开发者特殊要求」清单全文，AI 常驻可见、
    // 不必等门禁拦截才去读清单（省一次失败的工具往返）。auditEnabled 关闭时本项不生效。
    maxScanFiles: Schema.number().default(DEFAULT_MAX_SCAN_FILES).description('全量审计文件数上限（0=不限）；超限按变动文件优先截断，防止弱机扫大仓卡死'),
    injectRequirements: Schema.boolean().default(false).description('注入开发者要求清单到系统提示词（可直接勾选；父开关「提交前审计」关闭时置灰且不注入，勾选保留；默认关）'),
    auditScanScope: Schema.string().default('diff').description('diff | full'),
    auditRuleOrder: Schema.array(Schema.string()).default([]).description('规则槽位加载顺序（后加载覆盖先加载；空=默认偏好顺序；private 恒末尾强制）'),
    auditDisabledSlots: Schema.array(Schema.string()).default([]).description('UI 禁用的规则槽位（设置页单击切换；nodejs/private 安全红线不可禁用）'),
    weightOverrides: Schema.string().default('').description('权重覆盖 JSON（如 {"安全性":100}，空=默认权重表）'),
    linkCheckEnabled: Schema.boolean().default(false).description('链接检查（默认关，需网络）'),
    commentWordingEnabled: Schema.boolean().default(true).description('提交信息措辞检查'),
    commentWordingCustom: Schema.string().default('').description('自定义措辞规则'),
    commentWordingRulesFile: Schema.string().default('').description('措辞规则文件路径'),
    commentWordingRulesUrl: Schema.string().default('').description('措辞规则 URL'),
    auditRuleWeights: Schema.dict(Schema.any()).default({}).description('规则权重（{ blacklist: { pattern: weight } }）'),
    qualityWeights: Schema.dict(Schema.number()).default({}).description('质量维度权重覆盖（{ 维度名: weight }）'),
  };
}
