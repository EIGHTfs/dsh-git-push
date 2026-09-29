/**
 * 检查层 · 重复代码检测（抽公共函数候选）
 *
 * 为什么是「跨文件」检查：runChecks 逐文件调用只能发现文件内重复，
 *   而抽公共函数的收益场景主要是「同一逻辑散落在不同模块」——因此本检查
 *   在 auditFiles 层（拿到全部文件文本后）统一执行一次，不进 runChecks。
 *
 * 判定标准（量化判定标准）：
 *   · 同一归一化结构 ≥3 处（2 次观察、3 次必须抽）
 *   · 函数体 ≥5 行（少于 5 行不值得抽）
 *   · 排除：参数 >5、布尔 flag 参数、test/ 夹具、纯语法糖
 * severity 封顶 warning（只提示不拦截）。
 */

import { collectDupCodeCandidates, findDuplicateBodies } from '../ast/dup-code.js';
import { makeFinding } from '../audit/index.js';
import { HINT_QUALITY } from './common.js';

/** 重复代码豁免提示（文件头=整文件；测试夹具/故意复用的场景声明豁免）。 */
export const HINT_DUP_CODE = 'dsh-skip-quality（文件头=整文件）';

/**
 * 跨文件重复代码检测：对全部代码文件跑一遍，找出「该抽公共函数」的候选。
 * @param {Array<{path:string, text:string}>} fileTexts 全部代码文件（path + 全文）
 * @param {object} [rules] 规则定义（取 severity/dimensions；缺省按 warning）
 * @returns {Array} findings（severity 恒 warning 封顶）
 */
export function checkDuplicateCode(fileTexts = [], rules = null) {
  const findings = [];
  if (!Array.isArray(fileTexts) || fileTexts.length < 3) return findings; // 文件太少无重复意义

  const rule = Array.isArray(rules) && rules.length ? rules[0] : null;
  const severity = 'warning'; // 恒 warning（最高只警告不拦截）
  const dimensions = rule?.dimensions || ['可维护性'];
  const ruleOpts = {
    minLines: rule?.extra?.minLines || rule?.minLines,
    minOccurrences: rule?.extra?.minOccurrences || rule?.minOccurrences,
  };

  // 逐文件提取候选（只处理代码文件，跳过 test/ 夹具）
  const perFile = [];
  for (const { path, text } of fileTexts) {
    if (!text) continue;
    if (/(^|[\\/])(test|tests|__tests__|fixtures?|mocks?)([\\/]|$)/.test(path)) continue; // 测试夹具不报
    if (!/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(path)) continue; // 只查代码文件
    try {
      perFile.push(collectDupCodeCandidates(text, path));
    } catch { /* 单文件解析异常不影响整体 */ }
  }

  const dups = findDuplicateBodies(perFile, ruleOpts);
  for (const dup of dups) {
    // 只报第一处（其余实例在 message 里列出，避免同结构 N 条 finding）
    const [first, ...rest] = dup.instances;
    const others = rest.map((i) => `${i.name}@${i.file}:${i.line}`).join('，');
    findings.push(makeFinding({
      file: first.file,
      line: first.line,
      rule: rule?.id || 'maintainability/no-duplicate-code',
      kind: 'duplicate-code',
      severity, // warning 封顶
      message: `函数「${first.name}」（${dup.lines} 行）与 ${dup.instances.length - 1} 处重复（${others}）——同一结构 ≥3 处，应抽公共函数`,
      dimensions,
      exemptHint: HINT_DUP_CODE,
      scoreImpact: 1,
    }));
  }
  return findings;
}
