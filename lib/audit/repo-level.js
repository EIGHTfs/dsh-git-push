import { isRepoLevelSemanticRule } from './checks.js';
import { CODE_EXTS } from './finding.js';

/**
 * 收集「仓库级语义占位规则」id 集合（无任何可执行检测字段、需人工按仓库核查）。
 * 见 checks.js isRepoLevelSemanticRule 的判定说明。
 * @param {object} grouped groupByKind 结果
 * @returns {Set<string>}
 */
export function repoLevelSemanticRuleIds(grouped = {}) {
  const out = new Set();
  for (const rule of grouped['semantic'] || []) {
    if (isRepoLevelSemanticRule(rule)) out.add(rule.id);
  }
  return out;
}

/**
 * 选仓库级规则的「代表文件」：代码文件中路径字典序最小者（稳定可复现）。
 * 无代码文件时返回 null（此时不做去重，逐文件提示以免丢信息）。
 * @param {Array<{path:string}>} files 采集到的文件列表
 * @returns {string|null}
 */
export function pickRepoLevelAnchorFile(files = []) {
  const code = files
    .map((f) => String(f?.path || ''))
    .filter((p) => CODE_EXTS.has(p.split('.').pop().toLowerCase()))
    .sort();
  return code.length ? code[0] : null;
}
