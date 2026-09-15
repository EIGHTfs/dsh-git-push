/**
 * 编译层 · 数值阈值类 kind（数据表驱动，六个）
 *
 * numericKinds 是一张 kind 定义表（判定式 + 字段提取 + 维度），下方循环按表批量注册。
 * 新增数值类阈值规则只需往表里加一行，不必写编译器——这是本目录里唯一表驱动的模块。
 * min-occurrences 与 repeated-string 共享 min_occurrences 字段，靠 ignore_patterns/
 *   ignore_values 是否存在区分，故表里的判定式带这个判断。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, safeRe, severityLevel, pickDimensions } from './helpers.js';

/* ───────────────────────── 注册：数值六类（原 compileNumericRule 拆分） ───────────────────────── */

/** 数值字段 → kind 映射（一函数一类型，detect 各查各字段）。 */
const numericKinds = [
  ['min-length', (r) => r?.min_length !== undefined, (r) => ({ threshold: Number(r.min_length) }), [DIMENSIONS.可读性]],
  ['max-lines', (r) => r?.max_lines !== undefined && !/(function|函数)/i.test(r?.name || ''), (r) => ({ threshold: Number(r.max_lines) }), [DIMENSIONS.可读性, DIMENSIONS.可维护性]],
  ['max-complexity', (r) => r?.max_complexity !== undefined, (r) => ({ threshold: Number(r.max_complexity) }), [DIMENSIONS.可维护性]],
  ['max-depth', (r) => r?.max_depth !== undefined, (r) => ({ threshold: Number(r.max_depth) }), [DIMENSIONS.可维护性]],
  // min-occurrences 与 repeated-string 共享 min_occurrences/ignore 字段；带 ignore_patterns/ignore_values 走 repeated-string
  ['min-occurrences', (r) => r?.min_occurrences !== undefined && !(Array.isArray(r.ignore_patterns) || Array.isArray(r.ignore_values)), (r) => ({ threshold: Number(r.min_occurrences), min_occurrences: Number(r.min_occurrences), ...(r.min_lines !== undefined ? { minLines: Number(r.min_lines) } : {}) }), [DIMENSIONS.可维护性]],
  ['repeated-string', (r) => r?.min_occurrences !== undefined && (Array.isArray(r.ignore_patterns) || Array.isArray(r.ignore_values)), (r, ctx) => ({
    threshold: Number(r.min_occurrences), min_occurrences: Number(r.min_occurrences),
    ...(r.min_lines !== undefined ? { minLines: Number(r.min_lines) } : {}),
    ignorePatterns: (r.ignore_patterns || []).map((p) => safeRe(p, r?.name || r?.id, ctx.errors)).filter(Boolean),
    ignoreValues: (r.ignore_values || []).map(String),
  }), [DIMENSIONS.可维护性, DIMENSIONS.可读性]],
];

for (const [kind, detect, field, dimensions] of numericKinds) {
  registerCompiler(
    kind,
    detect,
    (r, ctx) => {
      const f = field(r, ctx);
      return ruleOut({
        id: r.id, name: r.name || r.id, kind, severity: r.severity,
        level: severityLevel(r.severity), message: r.description || r.name || '',
        dimensions: pickDimensions(r, dimensions, ctx?.errors),
        extra: {
          ...f,
          exceptions: Array.isArray(r.exceptions) ? r.exceptions : [],
          // 2026-09-13：透传 exts——代码结构类数值规则（嵌套深度/函数长度/命名长度）
          //   只应作用于代码文件，否则 md/json/yml 里的示例代码块与文档结构会被误报。
          exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : undefined,
        },
      });
    },
  );
}
