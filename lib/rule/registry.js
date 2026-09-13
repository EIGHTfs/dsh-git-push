/**
 * dsh-git-push 规则总入口（核心）
 *
 * 铁律：加字段 = 加函数 + registerCompiler 一行注册；compileRule 主体永不修改。
 * 判定方式：不强制 yml 写 kind，按字段自动指派编译函数（detect 条件）。
 * 每个编译函数声明 dimensions（10 维度绑定，支持一字段多维度）。
 */
import { findHomoglyphs } from './homoglyph.js';

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
  // G3 防再犯：kind/id 夹带同形字符（с→c/е→e/а→a 等）→ 匹配不上注册表，
  // 静默失效零提示。入口显式拦截：检出同形 → 报错（不进入 detect/compile）。
  for (const key of ['kind', 'id']) {
    if (typeof rule?.[key] !== 'string') continue;
    const hits = findHomoglyphs(rule[key]);
    if (hits.length) {
      const detail = hits.map((h) => `「${h.ch}」→${h.ascii}@${h.index}`).join(' ');
      return { ok: false, error: `${key}=${rule[key]} 含同形字符（${detail}），须用纯 ASCII（可复制正确写法或人工重敲）` };
    }
  }
  // 2026-09-13：槽位归属透传——loader 给每条 yml 规则打了 __slot（来源规则包），
  // 编译结果统一补 slot 字段，供审计结果按规则包聚合命中数
  // （侧边栏规则包行的「拦截/警告/通过」= 该规则包实际命中的问题数）。
  const slot = typeof rule?.__slot === 'string' ? rule.__slot : undefined;
  const withSlot = (res) => {
    if (res && res.ok && res.rule && slot && res.rule.slot === undefined) res.rule.slot = slot;
    return res;
  };
  if (rule?.kind) {
    const byKind = RULE_COMPILERS.find((e) => e.kind === rule.kind);
    if (byKind) return withSlot(byKind.compile(rule, ctx));
    return { ok: false, error: `未知规则类型 kind=${rule.kind}（${rule?.id || rule?.name}）` };
  }
  for (const entry of RULE_COMPILERS) {
    if (entry.detect(rule)) return withSlot(entry.compile(rule, ctx));
  }
  return { ok: false, error: `无法识别规则类型: ${rule?.id || rule?.name || '?'}` };
}

/** 编译全部规则条目（阶段3 统一入口的循环形态）。 */
export function compileAllRules(rules, ctx = {}) {
  const out = [];
  for (const r of rules || []) {
    const res = compileRule(r, ctx);
    if (res.ok) out.push(withRuleScope(res.rule, r));
    else ctx.errors?.push(res.error);
  }
  return out;
}

/**
 * 统一补齐规则作用域字段（exts + astConfirmKind）——2026-09-13。
 *
 * 背景（真实缺陷）：`exts` 原本要求每个编译器自己归一化后塞进 `extra` 透传，
 *   16 个编译器里 10 个漏了（credential-ref/[FUNC]/semantic/blacklist/npm-json 等）。
 *   后果是 yml 里写了 `exts` 却被**静默忽略**——规则照旧跑遍所有文本文件，
 *   产生误报且看不出原因（实例：comment 包的 blacklist 规则声明了只查代码/HTML，
 *   仍把 .json 配置文件的流程约定报成 blocker，卡死提交门禁）。
 *
 * 放在这里而不是各编译器：作用域是规则的通用属性，与具体 kind 无关；
 *   统一收口后新增编译器自动具备，不会再漏。已在编译器内显式归一化的保持不变。
 *
 * @param compiled 编译产物（顶层 exts 或 extra.exts 均可被 filterRulesByExt 读取）
 * @param source 原始 yml 规则
 */
function withRuleScope(compiled, source) {
  if (!compiled) return compiled;
  let out = compiled;
  const patch = (obj, key, value) => (out = out === obj ? { ...obj, [key]: value } : { ...out, [key]: value });

  // ① 文件作用域 exts
  if (!(Array.isArray(out.exts) && out.exts.length) && Array.isArray(source?.exts) && source.exts.length) {
    patch(out, 'exts', source.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')));
  }
  // ② 具名精筛 astConfirmKind —— 与 exts 同类缺陷：原本只有 regex 编译器透传，
  //    [FUNC]/blacklist/semantic 等 kind 声明了也被静默忽略（实例：secret-github-pat
  //    编译成 [FUNC]，声明的 placeholder-credential 精筛不生效，占位符仍被报泄漏）。
  if (out.astConfirmKind === undefined && source?.astConfirmKind) {
    patch(out, 'astConfirmKind', source.astConfirmKind);
  }
  return out;
}