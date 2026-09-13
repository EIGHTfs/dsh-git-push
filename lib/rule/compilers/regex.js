/**
 * 编译层 · 正则类 kind（两个）
 *
 * regex（正文正则，按 ext 作用域跑）、path-regex（路径正则）。
 * 两者都是「模式串命中即报」，差别只在匹配对象是文件内容还是文件路径。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, safeRe, severityLevel } from './helpers.js';

/* ───────────────────────── 注册：正则两类 ───────────────────────── */

registerCompiler(
  'regex',
  (r) => Array.isArray(r?.patterns) || typeof r?.pattern === 'string',
  (r, ctx) => {
    // 子模式支持（文档 §13 承诺「可直接落地」）：patterns 条目可为字符串或对象 {id,pattern,message}
    const list = [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])]
      .map((p) => {
        if (typeof p === 'string') return { regex: safeRe(p, r?.name || r?.id, ctx.errors), message: null };
        if (p && typeof p === 'object' && typeof p.pattern === 'string') {
          return { regex: safeRe(p.pattern, r?.name || r?.id, ctx.errors), message: p.message || null };
        }
        return null;
      })
      .filter((x) => x && x.regex);
    if (!list.length) return null; // 无有效 pattern → 编译失败交调用方
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'regex', severity: r.severity,
      level: severityLevel(r.severity),
      // 每个条目带 regex + 可选专属 message（checks.js 对 RegExp 条目的向后兼容）
      pattern: list[0].regex, patterns: list.map((x, i) => (i === 0 ? x.regex : x.regex)), // 保持 RegExp 主键兼容
      message: r.description || r.name || '',
      dimensions: [DIMENSIONS.可读性],
      // subPatterns 走 extra 展开（ruleOut 只白名单 id/name/kind/... 顶层字段 + extra）
      extra: {
        subPatterns: list,
        exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : undefined,
        // 2026-09-13：路径级排除——按 relPath 前缀过滤（如 client-node-builtin-require
        //   只查浏览器侧，排除 server/ test/ lib/ 等 Node 目录，修纯正则误伤）
        excludePaths: Array.isArray(r.exclude_paths) ? r.exclude_paths.map(String) : undefined,
        // 2026-09-13：白名单行豁免——命中 whitelist_patterns 的行不报（修凭据类误报：
        //   字段引用/API 名/字符串字面量 ≠ 硬编码凭据值）
        whitelistPatterns: Array.isArray(r.whitelist_patterns) ? r.whitelist_patterns.map(String) : undefined,
        // 2026-09-13：正则初筛 → AST 精筛开关——声明后正则只筛候选行，再由 token 级
        //   判定确认命中行确实是代码行，注释/字符串里的内容不再误报。
        //   astConfirm: true → 用 makeCodeLineFilter（行级：是否代码行）；
        //   astConfirm: "magic-number" → 用 checkMagicNumberSmartAst（值级：该数字
        //     是否真魔数——版本号/日期/HTTP 状态码/命名常量值/参数默认值/索引运算
        //     i+1 等自动豁免，修纯 regex 把索引运算当魔数的大面积误报）。
        astConfirm: r.astConfirm === true || r.astConfirm === 'magic-number' ? r.astConfirm : undefined,
        // 2026-09-13：具名精筛（供子模式规则声明「命中后还要 AST 确认什么」）——
        //   如 performance/memory-bomb 的 small-file-read：确认读的是否受控小文件。
        astConfirmKind: typeof r.ast_confirm_kind === 'string' ? r.ast_confirm_kind
          : (typeof r.astConfirmKind === 'string' ? r.astConfirmKind : undefined),
        examples: r.examples || undefined, // G6 认领：bad/good 示例展示字段
      },
    });
  },
);

registerCompiler(
  'path-regex',
  (r) => r?.kind === 'path-regex' || (r?.path_pattern && !/^credfile-/.test(r?.id || '')),
  (r, ctx) => {
    const re = safeRe(r.path_pattern, r?.name || r?.id, ctx.errors);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'path-regex', severity: r.severity,
      level: severityLevel(r.severity), pathPattern: re?.source,
      message: r.description || r.name || '',
      dimensions: [DIMENSIONS.可读性, DIMENSIONS.可维护性],
    });
  },
);
