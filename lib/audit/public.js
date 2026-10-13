/**
 * 审计对外门面（稳定 API 面）—— 审计按独立包设计的对外契约。
 *
 * 为什么需要本文件（2026-10-13）：
 *   审计部分要能被别的 DSH 插件/项目依赖（长期目标是独立 npm 包，当前形态是整包子路径导出），
 *   因此对外只暴露**冻结的最小面**，其余导出（checks/rule/score 内部件）视为内部实现，可随时调整。
 *   外部用法：node: `import { auditWithScope } from 'dsh-git-push/audit'`
 *
 * 稳定性承诺：本文件导出的符号只在 minor/major 版本变更时才会增删（随整包发版，见
 *   开发者文档/dsh-git-push/审计独立包设计-20261013.md；抽成独立包时本文件整体搬走，消费方 import 路径不变）。
 *
 * 依赖边界：本文件及其依赖的子图**不得**引用宿主（cordis / @deepseek-ai/* / lib/app / lib/plugin / lib/cli /
 *   lib/client / scripts/**）——由 test/test-audit-git-boundary.mjs 机器门禁守住。
 */
export {
  auditWithScope, // 按范围审计（提交门禁用：diff / full）
  auditFull, // 全量审计
  auditChanged, // 仅改动集
  auditFile, // 单文件审计
  buildRuleSlotMap, // 规则槽位映射
  summarize, // findings → 结论汇总
} from './index.js';

export { formatAnalysisCoverageLine } from './analysis-coverage.js';
