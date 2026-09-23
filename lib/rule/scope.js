/**
 * 审计作用域判断 · 机制层（2026-09-23，方案 Step 3）
 *
 * 目标：让规则知道「这段代码在什么作用域/路径上」，从“看代码长什么样”升级到
 * “理解代码在干什么”——误报率从 ~97%（io-risk 实测 2/65 真警告）往 ~15% 收敛。
 *
 * 本文件只做机制（声明 + 解析），不判断任何具体作用域：
 *   - normalizeScopeRules：编译期把规则 yml 的 scope_rules 规范成 rule.scopeRules 数组
 *   - resolveScopeAction：执行期按运行时填充的 scopeInfo（path/lexical/effective）取 action
 *
 * 作用域命名空间（规则 yml 里 scope 字段可用的值，多值逗号分隔，* 全匹配）：
 *   - 执行路径：startup / request / background / test / unknown
 *   - 词法作用域：global / module / function / block / loop
 *   - 功能作用域（闭包双重作用域）：public / private / callback
 * action：exempt（豁免）/ block（阻断）/ warn（警告），缺省 warn。
 *
 * 与规则检查器约定（Step 4 起各规则填充）：
 *   scopeInfo = { path: 'request'|'startup'|..., lexical: 'function'|'loop'|..., effective: 'public'|... }
 *   —— rule.scopeRules 命中任一维度值即返回对应 action；无 scope_rules 或未命中 → null（规则默认行为）。
 */

/** 合法 action 白名单（缺省 warn——未知作用域保守提示，不豁免也不阻断）。 */
export const SCOPE_ACTIONS = ['exempt', 'block', 'warn'];

/**
 * 规范化规则 yml 的 scope_rules 字段（编译期，幂等）。
 * @param {object} rule 编译后的规则对象（yml 字段已透传：rule.scope_rules）
 * @returns {Array<{scope:string, action:string, reason:string, _i:number}>}
 */
export function normalizeScopeRules(rule) {
  const raw = rule && (rule.scope_rules || rule.scopeRules);
  if (!Array.isArray(raw)) return [];
  return raw.map((x, i) => ({
    scope: String((x && x.scope) || '').trim(),
    action: SCOPE_ACTIONS.includes(x && x.action) ? x.action : 'warn',
    reason: (x && x.reason) || '',
    _i: i,
  }));
}

/**
 * 执行期：按运行时作用域信息取 action。
 * @param {Array<{scope:string, action:string}>} scopeRules 规范化后的规则作用域规则（rule.scopeRules）
 * @param {object} [scopeInfo] 运行时填充：{ path, lexical, effective }（值即作用域字符串，如 'request'）
 * @returns {'exempt'|'block'|'warn'|null} action；无规则/无命中 → null（规则默认行为）
 */
export function resolveScopeAction(scopeRules, scopeInfo = {}) {
  if (!Array.isArray(scopeRules) || scopeRules.length === 0) return null;
  for (const sr of scopeRules) {
    const keys = String(sr.scope || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!keys.length) continue;
    if (keys.includes('*')) return sr.action;
    const hit = keys.some((k) => {
      for (const v of Object.values(scopeInfo)) {
        if (v != null && String(v) === k) return true;
      }
      return false;
    });
    if (hit) return sr.action;
  }
  return null;
}