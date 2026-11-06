/**
 * 外部 linter 委托层 · 入口（方向 A）
 *
 * 一次调用完成「探测项目自带 linter → 逐个委托执行 → 聚合 finding」。
 * 与 ext-runner 同构：auditFull/auditWithScope 末尾并入其产出，任何环节失败都降级为空数组。
 *
 * 输出契约（供编排层与测试消费）：
 *   { findings: Array, linted: Array<{key,bin,version,count,note}> }
 *   —— linted 记录「本次委托了哪些外部 linter、各产出多少」，让「用没用上外部权威源」在报告里可见
 *      （与 treeUsage 同一防再哑思路：委托层若长期空转，报告能看到，不至于误以为外部精度已生效）。
 */
import { detectLinters, detectLinterStatus } from './detect.js';
import { runLinter } from './runner.js';

/**
 * @param {string} repoRoot 仓库根
 * @param {object} [opts] { linters?: 覆盖探测结果（测试注入用）, log? }
 */
export async function runLintAdapters(repoRoot, opts = {}) {
  // let：未注入时由探测结果赋值（对 const 赋值会在运行期抛 TypeError，node --check 抓不到）
  let linters = opts.linters;
  const unavailable = [];
  if (!linters) {
    // 走真实探测：unavailable（项目声明了 linter 但工具不可用）必须进 linted，
    //   否则「部署副本迁移丢了 +x」这类问题与「项目压根没配 ruff」在报告里同样沉默——
    //   委托层宣称防静默空转，自己不能再有灯下黑。
    const st = detectLinterStatus(repoRoot);
    linters = st.ok;
    unavailable.push(...st.unavailable);
  }
  const findings = [];
  const linted = [];
  // 不可用项也记一条（count=0 + reason 含修复动作），使「为什么没委托成」可读。
  for (const u of unavailable) {
    linted.push({ key: u.key, bin: '', version: '', count: 0, unavailable: true, note: `未委托：${u.reason}` });
  }
  for (const linter of linters) {
    let res;
    try {
      res = await runLinter(linter, repoRoot);
    } catch (e) {
      res = { findings: [], note: `执行异常降级跳过：${(e && e.message) || e}` };
    }
    findings.push(...res.findings);
    linted.push({ key: linter.key, bin: linter.bin, version: linter.version || '', count: res.findings.length, note: res.note });
  }
  return { findings, linted };
}

export { detectLinters } from './detect.js';
