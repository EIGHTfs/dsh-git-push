/**
 * 检查层 · 规则作用域过滤
 *
 * 职责：按文件路径裁剪规则——exts（扩展名）与 exclude_paths（目录前缀）。
 *   这是「规则作用域」的唯一落地点：规则声明了作用域就必须在此生效，
 *   否则出现「yml 写了 exts 却被静默忽略」的缺陷。
 */

/** 全量检查器调度：对单文件跑所有已编译规则 + 内置检查（质量类走 AST 级）。
 * @param {object} opts { level: 'quick'|'standard'|'deep'（缺省 standard 全量） }
 * quick 档跳过 AST/语义重检查（分析成本高）：func-lines/complexity/depth/
 * max-lines/repeated-string/semantic/credential-file/min-length，保留正则/
 * 黑名单/路径/内置轻检——适合大仓冒烟、快速门禁。
 * deep 档当前引擎与 standard 等效（全量），为未来追加深度检查预留。 */
/**
 * 规则 exts 过滤：规则声明 `exts` 时仅对匹配扩展名的文件生效。
 * 编译产物里 exts 存在 `rule.extra.exts`（regex 编译器已透传），此处消费——
 * 修复 dsh/patch-insert-unique-id 等在 README/md 等非目标文件上的误报
 * （例：patch 语义规则只查 yml/yaml，README 里的 insert 示例代码块不再命中）。
 * @param {object} grouped 按 kind 分组的编译规则
 * @param {string} relPath 相对路径（用于取扩展名）
 * @returns {object} 过滤后的 grouped（规则数组已按 exts 裁剪）
 */
export function filterRulesByExt(grouped, relPath) {
  const ext = String(relPath || '').split('.').pop().toLowerCase();
  const out = {};
  for (const [kind, rules] of Object.entries(grouped || {})) {
    if (!Array.isArray(rules)) { out[kind] = rules; continue; }
    out[kind] = rules.filter((r) => {
      const exts = r?.exts ?? r?.extra?.exts; // ruleOut 展开后 exts 在顶层；兼容 extra 形式
      if (!Array.isArray(exts) || exts.length === 0) return true; // 未声明 exts = 不限文件
      return exts.includes(ext);
    });
  }
  return out;
}

/**
 * 2026-09-13：路径级规则过滤——规则声明 exclude_paths 时，按 relPath 前缀排除。
 * 与 filterRulesByExt 分离：exts 只按扩展名，区分不了「同是 .js 的 server/client」；
 * 需要排除整目录（如 client-node-builtin-require 只查浏览器侧，排除 server/ test/ lib/）。
 * 路径匹配：relPath 以任一 exclude 前缀开头即跳过该规则（前缀兼容有无尾斜杠）。
 */
export function filterRulesByPath(grouped, relPath) {
  const p = String(relPath || '');
  const out = {};
  for (const [kind, rules] of Object.entries(grouped || {})) {
    if (!Array.isArray(rules)) { out[kind] = rules; continue; }
    out[kind] = rules.filter((r) => {
      const excludes = r?.excludePaths ?? r?.extra?.excludePaths;
      if (!Array.isArray(excludes) || excludes.length === 0) return true; // 未声明 = 不限路径
      const norm = (s) => String(s || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
      const rel = norm(p);
      return !excludes.some((e) => {
        const ee = norm(e);
        return ee && (rel === ee || rel.startsWith(ee + '/') || rel.startsWith(ee));
      });
    });
  }
  return out;
}
