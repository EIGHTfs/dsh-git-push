/**
 * index.js —— 审计 UI SDK 的唯一导出面：面板实现只允许从这里 import。
 *
 * 为什么「只留一个入口」：分组导出看着只是方便，实际是**什么算稳定契约**的边界——
 * 实现若绕过它去 import contract.js 的内部细节，SDK 一旦重构就会伤到别人。
 * 所以本文件只 re-export 承诺面，一个多余符号都不加；想加符号先问「它算契约吗」。
 * 契约形状（meta/Panel/styles/setup 与 props 三组键）的权威说明在 ./contract.js 头部。
 */

export {
  AUDIT_UI_CONTRACT_VERSION,
  AUDIT_PANEL_ID_PATTERN,
  AUDIT_PANEL_DATA_KEYS,
  AUDIT_PANEL_ACTION_KEYS,
  AUDIT_PANEL_STATE_KEYS,
  defineAuditPanel,
} from './contract.js';
