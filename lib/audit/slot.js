/**
 * 按规则包（槽位）聚合审计命中数（2026-09-13）。
 *
 * 侧边栏规则包列表的「拦截 / 警告 / 通过」显示的是**实际审计命中数**：
 *   · 拦截 = 该规则包命中的 blocker/error 级问题数
 *   · 警告 = 该规则包命中的 warning 级问题数
 *   · 通过 = 该规则包已加载的规则数 −（有命中的规则数）——即「没查出问题的规则」条数
 *
 * 槽位归属来自编译后规则对象的 slot 字段（loader 打 __slot → compileRule 透传）；
 * 规则 id → slot 的映射由调用方一次性构建（同一 id 可能多槽位复用，取首个）。
 *
 * @param {Array} findings 审计结果（统一 finding 对象，带 rule/severity）
 * @param {Map<string,string>} ruleSlotMap 规则 id → 槽位名
 * @param {Record<string, number>} [slotRuleCount] 各槽位已加载规则数（用于算「通过」）
 * @returns {Record<string, {blocker:number, warning:number, pass:number, total:number}>}
 */
export function slotStatsFromFindings(findings = [], ruleSlotMap = new Map(), slotRuleCount = {}) {
  const stats = {};
  const hitRules = {}; // slot → Set(命中的规则 id)
  // 先为「所有已加载槽位」建条目：未命中的槽位也要出现在结果里
  // （前端显示「0 拦截 / 0 警告 / 全部规则通过」，否则该行会退回规则条数口径，两种口径混排）
  for (const [slot, count] of Object.entries(slotRuleCount)) {
    stats[slot] = { blocker: 0, warning: 0, pass: count, total: count };
  }
  const ensure = (slot) => {
    if (!stats[slot]) stats[slot] = { blocker: 0, warning: 0, pass: 0, total: slotRuleCount[slot] || 0 };
    return stats[slot];
  };
  for (const f of findings) {
    const slot = ruleSlotMap.get(f.rule);
    if (!slot) continue;
    const st = ensure(slot);
    const sev = f.severity || 'warning';
    if (sev === 'blocker' || sev === 'error') st.blocker++;
    else if (sev === 'warning') st.warning++;
    // notice/info 不计入拦截/警告（与 summarize 语义一致）
    (hitRules[slot] ||= new Set()).add(f.rule);
  }
  // 通过 = 该槽位规则总数 − 有命中的规则数（无命中即「通过」）
  for (const [slot, st] of Object.entries(stats)) {
    const hit = (hitRules[slot] || new Set()).size;
    st.pass = Math.max(0, (slotRuleCount[slot] || 0) - hit);
  }
  return stats;
}

/** 取「规则 id → 槽位」映射（编译后规则集带 slot；同 id 取首个非空槽位）。 */
export function buildRuleSlotMap(compiledRules = []) {
  const map = new Map();
  for (const r of compiledRules) {
    if (!r?.id || !r?.slot) continue;
    if (!map.has(r.id)) map.set(r.id, r.slot);
  }
  return map;
}

/** 统计各槽位已加载规则数（供「通过」列基数）。 */
export function countRulesBySlot(compiledRules = []) {
  const out = {};
  for (const r of compiledRules) {
    if (!r?.slot) continue;
    out[r.slot] = (out[r.slot] || 0) + 1;
  }
  return out;
}
