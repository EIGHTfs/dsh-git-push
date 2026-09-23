/**
 * 检查层 · 硬编码魔数
 *
 * 职责：薄包装 lib/ast/magic-number.js 的 token 级判定，转成 finding。
 */

import { makeFinding } from '../audit/index.js';
import { checkMagicNumberSmartAst } from '../ast/index.js';
import { HINT_QUALITY } from './common.js';

/* ───────────────────────── 硬编码魔数检测（kind=magic-number-smart，实现见 lib/ast/magic-number.js） ───────────────────────── */

/**
 * 硬编码魔数检测（薄包装）：具体实现在 lib/ast/magic-number.js 的 checkMagicNumberSmartAst（token 级），
 * 本函数只把命中结果转成统一 finding 对象。
 *
 * 规则声明在 lib/audit-rules/audit-rules-nodejs.yml（readability/magic-number-smart）。
 * token 级实现从根上区分「代码里的数字字面量」与「注释/字符串里的数字」——
 * 注释版本号（// v1.8.0）、CSS 字号、i18n 字典值不再误报，无需任何「跳过行」补丁。
 */
export function checkMagicNumberSmart({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
  if (!rule) return findings;
  const opts = {
    magicHints: rule.magicHints,
    legitHints: rule.legitHints,
    forceCount: rule.forceCount,
  };
  for (const hit of checkMagicNumberSmartAst(text, opts)) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule.id || 'readability/magic-number-smart', kind: 'magic-number-smart',
      severity: rule.severity || 'warning',
      message: `硬编码魔数「${hit.raw}」（${hit.count >= (rule.forceCount || 3) ? `文件内出现 ${hit.count} 次，疑似魔数` : '出现在 timeout/limit/size 等数值上下文'}）——建议提取为命名常量并注释含义；版本号/日期/HTTP 状态码/常见合法常量/注释与字符串内数字自动豁免`,
      dimensions: rule.dimensions || ['可维护性'], exemptHint: 'dsh-skip-quality（文件头=整文件）', scoreImpact: 0, // 2026-09-23：魔数为「建议提取常量」提示（info 级语义），不扣分——避免配置值（timeout/limit/size）全项目性误扣
    }));
  }
  return findings;
}
