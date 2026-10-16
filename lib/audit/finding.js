import { exemptHintForFinding, exemptMarkerCovers } from '../exempt/index.js';

/** 统一问题对象构造器（所有审计检查的出口）。 */
export function makeFinding({ file, line, rule, kind, severity = 'warning', message, dimensions = [], exemptHint = '', scoreImpact = 0 }) {
  return { file, line, rule, kind, severity, message, dimensions, exemptHint, scoreImpact };
}

/**
 * 豁免提示「可信化」：把每个 finding 的 exemptHint 校正为**真能豁免它**的标记。
 *
 * 背景（2026-10-17 由「有人反应文件头豁免措辞无效」触发）：exemptHint 是各检查器里**写死**的
 *   字符串，而能否生效取决于 lib/exempt/index.js 的 blocked/细分清单。两者不一致时，用户照
 *   提示写了文件头标记**仍然照报**（全量自证实测 24 种组合，如 readability/vague-function-name
 *   提示 dsh-skip-residue、maintainability/max-cyclomatic-complexity 提示 dsh-skip-quality）。
 * 做法：统一在这一处（所有 finding 的汇集点）用注册表反查校正——
 *   · 原提示的标记确实覆盖 ⇒ **保留**（不打扰已熟悉的措辞与既有豁免统计）
 *   · 不覆盖 ⇒ 换成真能豁免的标记 + 该标记的官方 hint
 *   · 一个都没有 ⇒ 如实说明「当前无可用标记」（不再给一个写了不生效的 ✗）
 * 幂等：同一 finding 反复校正结果不变；对新规则同样生效（无需逐个检查器去改提示）。
 * @param {Array} findings 统一问题对象数组（原地修正 exemptHint）
 */
export function normalizeExemptHints(findings = []) {
  const MARKER_RE = /dsh-skip-[a-z-]+/;
  for (const f of findings) {
    if (!f) continue;
    const hit = String(f.exemptHint || '').match(MARKER_RE);
    if (hit && exemptMarkerCovers(hit[0], f)) continue; // 原提示有效 ⇒ 保留
    const truth = exemptHintForFinding(f);
    if (truth) f.exemptHint = `${truth.marker}（${truth.hint}）`;
    else if (hit) f.exemptHint = '（当前无可用豁免标记：该 kind 不在任何 dsh-skip-* 的 blocked 清单里）';
  }
  return findings;
}

/**
 * 扫描智能提示（1.0.8）：对 warning/blocker 且文件路径或文件名带 test 特征的 finding，
 * 在 message 末尾附加「测试文件夹可用 .test 空文件豁免」提示（告知而非自动豁免——
 * 是否豁免由用户在对应目录放 0 字节 .test 空文件决定，防逃逸语义与 1.0.6 isTestExemptDir 一致）。
 * test 特征：路径含 `test|tests|__tests__|spec` 目录段，或文件名 `.test.js`/`-spec.js` 等。
 * 重复提示幂等：message 已含「.test」则跳过。
 * @param {Array} findings 统一问题对象数组（原地补 message，返回同一数组）
 */
export function decorateTestExemptHint(findings = []) {
  const testPathRe = /(^|[/\\])(test|tests|__tests__|spec)[/\\]|\.(test|spec)(\.[a-z]+)?$/i;
  const HINT = '（提示：测试目录/文件可在对应目录放 0 字节 .test 空文件整目录豁免扫描）';
  for (const f of findings) {
    if (!f || !['warning', 'blocker', 'error'].includes(f.severity)) continue;
    const file = String(f.file || '');
    if (!testPathRe.test(file)) continue;
    if (String(f.message || '').includes('.test')) continue;
    f.message = `${f.message || ''}${HINT}`;
  }
  return findings;
}

/**
 * 汇总 findings 统计。
 *
 * 1.1.0 修复：原实现只累加 blocker/warning，但规则 severity 实际有三档
 * （blocker / error / warning）。error 级问题（凭据泄露等）既不进 blocker
 * 也不进 warning，却计入 total → 产生「0 blocker 0 warning 但 total=3」的
 * 矛盾统计，且上层按 blocker 数判断门禁时会**漏放** error 级问题。
 * 现统一语义：error 归入 blocker（拦截级），notice/info 单列，其余为 warning。
 * @param {Array} findings 统一问题对象列表
 * @returns {{blocker:number, warning:number, notice:number, total:number}}
 */
export function summarize(findings = []) {
  let blocker = 0, warning = 0, notice = 0;
  for (const f of findings) {
    const sev = f.severity || 'warning';
    if (sev === 'blocker' || sev === 'error') blocker++; // error=拦截级（凭据泄露/语法错误等）
    else if (sev === 'notice' || sev === 'info') notice++;
    else warning++;
  }
  return { blocker, warning, notice, total: findings.length };
}

/** 代码文件扩展名（residue/style 类检查只对代码生效，修规则定义/文档自举假阳性）。 */
export const CODE_EXTS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'php', 'rb', 'sh', 'bash']);
