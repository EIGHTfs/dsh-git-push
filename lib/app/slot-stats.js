/**
 * 插件入口层 · 槽位命中统计
 *
 * 记录最近一次审计各规则槽位的命中数与时间/仓库（模块级可变状态，故集中一处，
 *   避免散落多个模块各存一份导致读到旧值）。callTool 写入，handleHttp 读取回显。
 */

/* ───────────── 最近一次审计的按规则包命中数缓存（2026-09-13） ─────────────
 * 侧边栏规则包列表的「拦截 / 警告 / 通过」要显示实际审计命中数，但 HTTP
 * /rule-slots 是独立分发（不共享工具调用的调用栈/局部状态），故用模块级缓存：
 * code_audit 每次审计后写入（setLastSlotHitStats），接口读取（getLastSlotHitStats）。
 */
let lastSlotHitStats = null;

let lastSlotHitAt = null;

let lastSlotHitRepo = '';

/** 写入最近一次审计的按规则包命中数（code_audit 审计后调用）。 */
export function setLastSlotHitStats(stats, repo = '') {
  if (!stats || typeof stats !== 'object') return;
  lastSlotHitStats = stats;
  lastSlotHitAt = new Date().toISOString();
  lastSlotHitRepo = String(repo || '');
}

/** 读最近一次审计的按规则包命中数（无审计记录时返回 null → 前端回退规则条数口径）。 */
export function getLastSlotHitStats() {
  return lastSlotHitStats;
}

/** 读最近一次审计命中数的时间与仓库（供状态接口展示「统计时间」）。 */
export function getLastSlotHitMeta() {
  return { at: lastSlotHitAt, repo: lastSlotHitRepo };
}
