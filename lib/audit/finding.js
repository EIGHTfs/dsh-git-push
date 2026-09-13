/** 统一问题对象构造器（所有审计检查的出口）。 */
export function makeFinding({ file, line, rule, kind, severity = 'warning', message, dimensions = [], exemptHint = '', scoreImpact = 0 }) {
  return { file, line, rule, kind, severity, message, dimensions, exemptHint, scoreImpact };
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
