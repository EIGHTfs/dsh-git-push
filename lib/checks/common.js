/**
 * 检查层 · 公共设施
 *
 * 职责：检查器共用的豁免提示、severity 封顶、按 kind 分组，
 *   以及各 astConfirm 精筛集合的取值函数（把 AST 判定结果喂给 regex 类规则）。
 *
 * 为什么集中在这里：这些是多个检查器的共同依赖，散落各处会造成
 *   「同一语义两处定义、改一处漏一处」——精筛集合尤其如此。
 */

import { checkMagicNumberSmartAst, checkSmallFileReadAst, checkShortFunctionNameAst, checkPlaceholderCredentialAst, checkCredentialRefAst } from '../ast/index.js';

/** 质量类检查的豁免提示（文件头=整文件豁免）。单处定义，多处复用，避免重复字面量。 */
export const HINT_QUALITY = 'dsh-skip-quality（文件头=整文件）';

/**
 * 规则声明的 severity 是上限：检查器内部风险升级不得超过规则自身声明。
 * （修正：max-complexity 规则声明 warning，不应因内部 block 阈值而升为 blocker）
 * @param {string} ruleSeverity yml 声明的 severity
 * @param {string} internalLevel 检查器内部评估等级
 * @returns {string} 最终 severity
 */
export function capSeverity(ruleSeverity, internalLevel) {
  const rank = { notice: 0, info: 0, warning: 1, error: 2, blocker: 2 };
  const declared = rank[ruleSeverity] ?? 1;
  const internal = rank[internalLevel] ?? 1;
  const final = Math.min(declared, internal);
  return final >= 2 ? (ruleSeverity === 'error' ? 'error' : 'blocker') : (final === 1 ? 'warning' : 'notice');
}

/** 按 kind 分组编译规则。 */
export function groupByKind(compiled) {
  const g = {};
  for (const r of compiled || []) {
    (g[r.kind] ||= []).push(r);
  }
  return g;
}

/**
 * astConfirm: "magic-number" 的值级精筛集合——返回 checkMagicNumberSmartAst
 * 判定为「真魔数」的行的 Set（版本号/日期/HTTP 状态码/命名常量值/参数默认值/
 * 索引运算 i+1 等豁免行不在其中）。正则初筛出的候选行必须在此集合内才报。
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号集合
 */
export function smartHitLines(text) {
  const hits = checkMagicNumberSmartAst(String(text || ''));
  return new Set(hits.map((h) => h.line));
}

/**
 * astConfirmKind: "small-file-read" 的精筛集合——受控小文件读取的行号
 * （读 JSON 数据/配置/缓存，不构成 memory-bomb 风险）。
 * @param {string} text 文件全文
 * @returns {Set<number>} 应豁免的行号集合
 */
export function smallFileReadLines(text) {
  return checkSmallFileReadAst(String(text || ''));
}

/**
 * astConfirmKind: "short-func-name" 的精筛集合——token 级判定为「真的过短且非公认
 * 缩写」的函数声明行（i18n 的 tr/t、字典 L 等不在其中）。
 * @param {string} text 文件全文
 * @returns {Set<number>} 允许报的行号集合
 */
export function shortFuncNameLines(text) {
  return new Set(checkShortFunctionNameAst(String(text || '')).map((h) => h.line));
}

/**
 * astConfirmKind: "credential-value" 的精筛集合——token 级确认「凭据标识符右侧
 * 直接是有效字符串字面量」的行号（类型检查/字段透传/占位符/取环境变量都不算硬编码）。
 * 见 ast.js checkCredentialRefAst。
 */
/**
 * astConfirmKind: "placeholder-credential" 的集合取值——占位符密钥串所在行。
 * 集合内 = 命中行是演示/占位值（豁免）；集合外 = 疑似真凭据（照报）。
 */
export function placeholderCredentialLines(text) {
  return checkPlaceholderCredentialAst(text);
}

export function credentialValueLines(text) {
  return checkCredentialRefAst(String(text || ''));
}
