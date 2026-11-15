/**
 * 「拦截级」严重度判定（宿主侧同步快照）
 *
 * 语义与审计包 `lib/engine/finding.js` 的 `isBlockerFinding` 相同：`blocker` 与 `error` 都算拦截级。
 * 为什么宿主还留一份：调用点是**同步**的（HTTP handler 内即时过滤 findings），
 *   而审计包只能异步加载。**不是又一处双份真相，是带对拍门禁的快照**——
 *   test/app/test-audit-severity-parity.mjs 会比对两边结果，分叉即红。
 * @param {object} finding
 * @returns {boolean}
 */
export function isBlockerSeverity(finding) {
  const severity = finding?.severity;
  return severity === 'blocker' || severity === 'error';
}
