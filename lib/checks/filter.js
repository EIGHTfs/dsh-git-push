/**
 * 检查层 · 规则作用域过滤
 *
 * 职责：按文件路径裁剪规则——exts（扩展名）、exclude_paths（目录前缀），
 *   以及 2026-09-14 新增的 file_patterns（文件内容级初筛，三层审计 L1）。
 *   这是「规则作用域」的唯一落地点：规则声明了作用域就必须在此生效，
 *   否则出现「yml 写了 exts 却被静默忽略」的缺陷。
 *
 * 三层审计管线（2026-09-14）：
 *   L1 正则初筛（本文件 filterRulesByFileText）——每文件一次正则扫描，成本极低，
 *      命中 file_patterns 的文件才进 L2；不命中直接剔除该规则（空数组短路）。
 *   L2 AST+YAML 精查（lib/ast/dataflow.js + lib/checks/dataflow.js）——只对 L1
 *      候选文件做同函数内数据流判定（如「清空后访问」）。
 *   L3 运行时检测（scripts/audit-runtime-check.mjs）——兜住跨文件/闭包/异步盲区。
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

/**
 * 2026-09-14：三层审计 L1——文件内容级初筛（file_patterns）。
 *
 * 动机：AST/数据流类规则（第二层）成本中，若对每个文件都跑 token 解析浪费。
 *   声明 `file_patterns` 的规则先做一次**纯正则**快速筛选：文件文本命中任一
 *   pattern 才算「候选文件」，才进 L2 精查；未命中 → 该规则剔除（数组为空，
 *   检查器空规则短路，顺带防 rule.severity 崩溃）。
 *
 * 与 exts/exclude_paths 的区别：那是**路径/扩展名**级裁剪，这是**文件内容**级
 *   初筛——解决「正则模式本身命中面太宽、但 AST 精判成本高」的三层分层问题
 *   （如 clear-then-access 只在同函数含「清空动作」的文件上才值得做数据流分析）。
 *
 * @param {object} grouped 按 kind 分组的编译规则
 * @param {string} text 文件全文（读一次，多规则共享）
 * @returns {object} 过滤后的 grouped
 */
export function filterRulesByFileText(grouped, text) {
  const out = {};
  for (const [kind, rules] of Object.entries(grouped || {})) {
    if (!Array.isArray(rules)) { out[kind] = rules; continue; }
    out[kind] = rules.filter((r) => {
      const fps = r?.filePatterns ?? r?.extra?.filePatterns; // ruleOut 展开后顶层；兼容 extra
      if (!Array.isArray(fps) || fps.length === 0) return true; // 未声明 = 全文都算候选（不做 L1 初筛）
      // 纯文本单次扫描：任一 pattern 命中即候选（L1 只追求召回，不追求精度）
      const body = String(text || '');
      return fps.some((p) => {
        if (p instanceof RegExp) { p.lastIndex = 0; return p.test(body); }
        // 字符串形态 = 正则源串（compiler 从 yml file_patterns 透传，含 \b 等转义），
        //   按 RegExp 编译执行；编译失败（非法正则）退回子串包含（保守：宁放行不漏筛）。
        try { return new RegExp(String(p)).test(body); }
        catch { return body.includes(String(p)); }
      });
    });
  }
  return out;
}
