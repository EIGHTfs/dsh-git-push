/**
 * dsh-git-push 规则总入口（核心）
 *
 * 铁律：加字段 = 加函数 + registerCompiler 一行注册；compileRule 主体永不修改。
 * 判定方式：不强制 yml 写 kind，按字段自动指派编译函数（detect 条件）。
 * 每个编译函数声明 dimensions（10 维度绑定，支持一字段多维度）。
 */
export const RULE_COMPILERS = [];

/**
 * 注册一个规则编译函数。
 * @param {string} kind  kebab-case 规则类型（如 'max-depth'）
 * @param {(rule)=>boolean} detect 认领条件（规则条目满足即归本编译函数）
 * @param {(rule, ctx)=>any} compile 编译函数，返回 { ok:true, rule } 或 { ok:false, error }
 */
export function registerCompiler(kind, detect, compile) {
  RULE_COMPILERS.push({ kind, detect, compile });
}

/**
 * 统一规则编译入口：遍历注册表，detect 命中 → compile。
 * 显式 kind 字段优先；无 kind 则字段探测。
 * @param {object} rule yml 规则条目
 * @param {object} ctx  { errors, label } 编译上下文
 */
export function compileRule(rule, ctx = {}) {
  if (rule?.kind) {
    const byKind = RULE_COMPILERS.find((e) => e.kind === rule.kind);
    if (byKind) return byKind.compile(rule, ctx);
    return { ok: false, error: `未知规则类型 kind=${rule.kind}（${rule?.id || rule?.name}）` };
  }
  for (const entry of RULE_COMPILERS) {
    if (entry.detect(rule)) return entry.compile(rule, ctx);
  }
  return { ok: false, error: `无法识别规则类型: ${rule?.id || rule?.name || '?'}` };
}

/** 编译全部规则条目（阶段3 统一入口的循环形态）。 */
export function compileAllRules(rules, ctx = {}) {
  const out = [];
  for (const r of rules || []) {
    const res = compileRule(r, ctx);
    if (res.ok) out.push(res.rule);
    else ctx.errors?.push(res.error);
  }
  return out;
}