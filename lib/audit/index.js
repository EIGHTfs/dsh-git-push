/**
 * 审计层 · 统一出口
 *
 * 本目录是「审计编排层」：采集文件（collector/glob）→ 逐文件跑检查（audit-file）
 *   → 豁免过滤（lib/exempt/）→ 汇总（finding/slot）→ 按范围编排（orchestrate）。
 *
 * 分层位置（四层审计架构最上层）：
 *   lib/audit-rules/*.yml  规则内容（阈值/严重度/豁免清单）
 *   lib/rule/*             规则加载与编译
 *   lib/ast/* · lib/checks/*   token 级实现与检查包装
 *   lib/audit/*            采集与编排（本目录）
 *
 * 模块划分：
 *   finding.js       finding 构造、豁免提示装饰、汇总统计、代码扩展名表
 *   slot.js          规则槽位统计（槽位命中数、槽位映射、按槽位计数）
 *   repo-level.js    仓库级语义规则的锚点文件选择（全仓只报一次的那类规则）
 *   file-context.js  文件上下文判定辅助（同函数内 mkdir、外部调用超时、js/yaml import、版本号在路径中）
 *   audit-file.js    单文件审计（读文件 → 跑检查 → 豁免过滤）
 *   orchestrate.js   编排入口：全量审计 / 变动审计 / 作用域审计 / 扫描上限截断
 *
 * 注意本文件底部的副作用 import：lib/rule/compilers.js 靠 import 触发规则编译器注册，
 *   删掉它会让审计拿到空编译器表（不报错，但检查项全不出）。
 */

import '../rule/compilers.js'; // 副作用：注册 13 种编译函数

export { makeFinding, decorateTestExemptHint, summarize, CODE_EXTS } from './finding.js';
export { slotStatsFromFindings, buildRuleSlotMap, countRulesBySlot } from './slot.js';
export { repoLevelSemanticRuleIds, pickRepoLevelAnchorFile } from './repo-level.js';
export { hasMkdirInSameFunction, hasExternalCallTimeout, detectRepoJsYamlImport, isVersionInPathContext } from './file-context.js';
export { auditFile } from './audit-file.js';
export { capScanFiles, auditFull, auditChanged, auditWithScope } from './orchestrate.js';
