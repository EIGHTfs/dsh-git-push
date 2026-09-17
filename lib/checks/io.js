/**
 * dsh-git-push — I/O 风险分级检查器（checks 层，2026-09-17）
 *
 * 分层：本文件是**薄层**——只负责「调 lib/ast/io-risk.js 的判定 → 转 finding」，
 *   不做任何自己的边界识别/上下文判定（那属于 lib/ast 实现层，见 README「正则初筛 → AST 精筛」）。
 *
 * 取代原 `quality/sync-fs`（checkSyncFsInFile）：旧检查只判 `inAsync`，
 *   本检查是它的**超集**——同样覆盖「异步路径中的同步 I/O」，另加循环内、
 *   请求路径、启动路径三种上下文，以及读/写/删/改名四类操作。
 *   两者并存会对同一处 I/O 重复报，故旧规则一并移除。
 *
 * 分级 → 严重度：一律 warning（只提示不拦提交），风险高低体现在 message 徽标与描述中。
 */
import { scanIoRiskAst, RISK_BADGE, RISK_LABEL } from '../ast/io-risk.js';
import { makeFinding } from '../audit/index.js';

/** 豁免说明：复用 quality 标记（同为「性能/质量」类豁免）。 */
const HINT_IO = 'dsh-skip-quality（文件头=整文件；启动阶段一次性读取可豁免）';

/**
 * 扫描单个文件的 I/O 调用并按四级风险转 findings。
 *
 * @param {{file:string, text:string}} ctx 文件路径与全文
 * @returns {Array} findings（按行号升序）
 */
export function checkIoRisk({ file, text }) {
  const findings = [];
  let hits = [];
  try {
    hits = scanIoRiskAst(text);
  } catch {
    return findings; // 单文件解析异常不影响整体审计
  }

  for (const hit of hits) {
    const badge = RISK_BADGE[hit.risk] || '·';
    const label = RISK_LABEL[hit.risk] || hit.risk;
    // 上下文串：只列出成立的项，便于一眼看懂为什么是这个级别
    const ctxs = [];
    if (hit.inAsync) ctxs.push('异步路径');
    if (hit.inLoop) ctxs.push('循环内');
    if (hit.inRequest) ctxs.push('请求路径');
    if (hit.inStartup) ctxs.push('启动路径');
    const ctxText = ctxs.length ? ctxs.join('+') : '未知上下文';

    findings.push(makeFinding({
      file,
      line: hit.line,
      rule: 'robustness/io-risk',
      kind: 'io-risk',
      severity: 'warning',
      message: `${badge} ${label}风险：${hit.call}（${hit.type}/${hit.kind}，${ctxText}）——${hit.reason}`,
      dimensions: ['性能', '健壮性'],
      exemptHint: HINT_IO,
      scoreImpact: hit.risk === 'high' ? 2 : 1,
    }));
  }
  return findings;
}
