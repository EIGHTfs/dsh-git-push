/**
 * 检查层 · 语义类规则
 *
 * 职责：由规则 yml 声明的语义检查（如 patch insert 语义、仓库级语义规则）。
 */

import { makeFinding, CODE_EXTS } from '../audit/index.js';
import { HINT_QUALITY } from './common.js';

/** 检查语义规则（semantic：占位消费——无静态可判定性时按路径/命名提示，不做臆测）。 */
/**
 * semantic 占位规则检查：无法自动判定、需人工确认的规则（安全/a11y/dependency 类）。
 *
 * 语义（2026-09-13 修）：
 *   ① 只对**代码文件**生效——.gitignore/README/yml/json 没有「用户输入路径/依赖/按钮」
 *      可判定语义，逐文件报属纯噪音。
 *   ② **仓库级规则只报一次**——npm audit（dependency/known-vulnerability）、
 *      路径穿越人工核查（security/no-path-traversal）、a11y（button/label）都是
 *      「整个仓库」的属性，不是「某个文件」的属性。逐文件报会在 4 个文件上产出
 *      16 条同义提示（4 文件 × 4 规则），把真实问题淹没。
 *      判定依据：规则只声明 name/description、**无任何可执行字段**（无 pattern/
 *      threshold/kind/detection）→ 本 engine 无法评估，交人工按仓库维度核查一次。
 *      多文件时报在**文件路径字典序最小**的那个文件上（稳定可复现），其余文件静默。
 *   ③ 单文件审计（如 diff 范围的末尾批次）拿不到全仓列表时退回逐文件提示，
 *      由调用方（auditFull/auditChanged）传 repoLevel 去重，保证不丢提示。
 *
 * @param {object} args { file, relPath, rules, repoLevelRules? }
 *   repoLevelRules：调用方判定为「仓库级、已报过」的规则 id 集合（Set），命中则跳过。
 * @returns {Array} findings
 */
export function checkSemantic({ file, relPath, rules, repoLevelRules }) {
  const findings = [];
  const target = String(relPath || file || '');
  // ① 非代码文件没有可判定的语义对象
  const ext = target.split('.').pop().toLowerCase();
  if (!CODE_EXTS.has(ext)) return findings;
  for (const rule of rules || []) {
    // 文件系统上下文类：期望存在同名 test 文件 / 语言包文件（engine 无法读目录时跳过，交调用方仓库级处理）
    if (rule.detectionMethod === 'test-file-exists' || /test-file/i.test(rule.id || '')
      || rule.detectionMethod === 'locale-file-exists' || /locale-file/i.test(rule.id || '')) {
      continue; // 需文件系统上下文，由 auditFull 层处理（避免此处臆测）
    }
    // ② 仓库级规则已报过 → 本文件不再重复
    if (repoLevelRules && repoLevelRules.has(rule.id)) continue;
    findings.push(makeFinding({
      file, line: 1, rule: rule.id, kind: 'semantic',
      severity: 'notice',
      message: rule.message || rule.name || '语义规则提示（需人工确认）',
      dimensions: rule.dimensions || ['健壮性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0,
    }));
  }
  return findings;
}

/**
 * 判定规则是否为「仓库级语义占位」——无任何可执行检测字段、需人工按仓库维度核查。
 * 这类规则只应报一次（否则每文件一条同义提示）。
 * 判定：semantic kind 且既无 pattern(s)、无 threshold / min 长度 / max 深度等数值字段、
 *   无 detectionMethod、无 blacklist/whitelist 等清单字段。
 * @param {object} rule 编译后规则对象
 * @returns {boolean}
 */
export function isRepoLevelSemanticRule(rule) {
  if (!rule || rule.kind !== 'semantic') return false;
  if (rule.detectionMethod) return false;
  const hasPattern = rule.pattern !== undefined || (Array.isArray(rule.patterns) && rule.patterns.length > 0);
  const numericFields = ['threshold', 'minLength', 'maxDepth', 'maxLines', 'maxComplexity', 'minOccurrences', 'minLines'];
  const hasNumeric = numericFields.some((k) => rule[k] !== undefined && rule[k] !== null);
  const listFields = ['blacklist', 'whitelist', 'additionalFeatures', 'requiredPatterns'];
  const hasList = listFields.some((k) => Array.isArray(rule[k]) && rule[k].length > 0);
  return !hasPattern && !hasNumeric && !hasList;
}

/**
 * cordis.patch.yml insert 语义检查（patch-insert kind）。
 * 旧实现是 regex「命中 insert: 行即提示」——纯 insert（只新建、不覆盖任何行）
 * 也会被报，如 dsh-skill-scoreboard 的 patch（insert 新建 skill-scoreboard loader，
 * 基座没有同名行可覆盖）被误报成 duplicate-id 风险。
 * 语义判定：解析 yml 文本——
 *   1) insert 块（`- insert:` 后缩进列表）内的 id 集合
 *   2) 顶层（缩进 0）`- id:` 覆盖行的 id 集合
 *   3) 仅当两集合有交集（insert 新建的 id 与按 id 覆盖行同 id）才报 duplicate-id 双挂风险
 * 纯 insert 或 id 无交集 → 不报。
 * @param {object} p { file, text, rules } rules=编译后的 patch-insert 规则
 * @returns {Array} findings
 */
export function checkPatchInsert({ file, text, rules }) {
  const findings = [];
  const lines = String(text || '').split('\n');
  const insertIds = [];   // { id, line }
  const overrideIds = []; // { id, line }
  let inInsert = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue; // 空行/注释（README 对照示例多为注释，不算）
    if (/^- id:\s*["']?([^"'\s]+)["']?\s*$/.test(t) && /^- id:/.test(raw)) {
      // 缩进 0 的 - id 行 = 顶层覆盖已有 loader 行（无论当前是否在 insert 块内，都终结 insert 块）
      const id = t.match(/^- id:\s*["']?([^"'\s]+)["']?\s*$/)[1];
      overrideIds.push({ id, line: i + 1 });
      inInsert = false;
      continue;
    }
    if (inInsert && /^\s+- id:\s*["']?([^"'\s]+)["']?\s*$/.test(raw)) {
      const id = raw.trim().match(/^- id:\s*["']?([^"'\s]+)["']?\s*$/)[1];
      insertIds.push({ id, line: i + 1 });
      continue;
    }
    if (/^- insert:\s*$/.test(t)) { inInsert = true; continue; }
    // 离开 insert 块：insert 块内列表项以缩进（空格开头）为特征；缩进 0 的非 insert 行结束块
    if (inInsert && !/^\s/.test(raw)) inInsert = false;
  }
  for (const rule of rules || []) {
    for (const ins of insertIds) {
      if (overrideIds.some((o) => o.id === ins.id)) {
        findings.push(makeFinding({
          file, line: ins.line, rule: rule.id, kind: 'patch-insert',
          severity: rule.level === 'blocker' ? 'blocker' : rule.severity || 'warning',
          message: `${rule.message || rule.name}（insert 新建 id「${ins.id}」与顶层覆盖行同 id，会 duplicate-id 双挂）`,
          dimensions: rule.dimensions || ['健壮性'],
          exemptHint: HINT_QUALITY,
          scoreImpact: 1,
        }));
      }
    }
  }
  return findings;
}
