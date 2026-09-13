/**
 * 检查层 · 数据流规则（三层审计 L2）
 *
 * 职责：薄包装 lib/ast/dataflow.js 的 checkClearAccessAst（token 级同函数
 *   数据流判定），把命中转成统一 finding。
 *
 * 三层对应（2026-09-14）：
 *   L1 正则初筛：filterRulesByFileText 用规则声明的 file_patterns 先筛候选文件，
 *      未命中 → grouped['dataflow'] 为空数组 → 本检查器空规则短路直接 return。
 *   L2 本检查器：只对候选文件跑 AST 数据流分析（同函数清空后访问）。
 *   L3 运行时：scripts/audit-runtime-check.mjs 兜跨文件/闭包/异步盲区。
 *
 * 安全：空 rules 短路（防 rule.severity 崩溃——与 structural.js 各检查器同款守卫）。
 */

import { makeFinding } from '../audit/index.js';
import { checkClearAccessAst } from '../ast/index.js';
import { HINT_QUALITY } from './common.js';

/**
 * 数据流检查（kind=dataflow）：同函数「清空后访问」。
 * @param {object} ctx { file, text, rules }
 * @returns {Array} findings
 */
export function checkDataflow({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
  if (!rule) return findings; // 2026-09-14：规则被 L1 file_patterns 初筛剔除 / exts 过滤为空时短路
  for (const hit of checkClearAccessAst(text)) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule.id || 'dataflow/clear-then-access', kind: 'dataflow',
      severity: rule.severity || 'warning',
      message: `「${hit.obj}」先被清空（${hit.clearOp}，行 ${hit.clearLine}），同函数内随后访问 ${hit.accessOp}——可能读到已清空对象（undefined/空）；若中间有重新填充或跨分支时序，请用运行时检测（L3）确认`,
      dimensions: rule.dimensions || ['健壮性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 1,
    }));
  }
  return findings;
}
