/**
 * 编译层 · 凭据类 kind（三个，对应原文件「凭据三类」分段）
 *
 * credential-ref（代码里引用凭据变量）、credential-file（凭据文件入库）、
 *   [FUNC]（[FUNC]/secret- 前缀规则的 pattern 批量编译，安全红线类规则用它）。
 * 三者的共同点是「什么算凭据」的判定语汇，拆开会让判定散落多处，故合成一个模块。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, safeRe } from './helpers.js';

/* ───────────────────────── 注册：凭据三类 ───────────────────────── */

registerCompiler(
  'credential-ref',
  (r) => /^credref-/.test(r?.id || ''),
  (r, ctx) => {
    const list = [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter(Boolean)
      .map((p) => safeRe(p, r?.name || r?.id, ctx.errors)).filter(Boolean);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'credential-ref', severity: r.severity,
      // patterns 必须传编译后 RegExp（checks.js 直接 p.test(line)）
      pattern: list[0], patterns: list.length > 1 ? list.slice(1) : undefined,
      message: r.description || r.name || '凭据引用模式',
      dimensions: [DIMENSIONS.安全性],
    });
  },
);

registerCompiler(
  'credential-file',
  (r) => /^credfile-/.test(r?.id || ''),
  (r, ctx) => {
    const re = safeRe(r?.path_pattern || r?.pathPattern || '', r?.name || r?.id, ctx.errors);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'credential-file', severity: r.severity,
      pathPattern: re?.source,
      message: r.description || '凭据文件（路径模式）',
      dimensions: [DIMENSIONS.安全性],
    });
  },
);

registerCompiler(
  '[FUNC]',
  (r) => /^(\[FUNC\]|secret)-/.test(r?.id || ''),
  (r, ctx) => {
    const list = [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter(Boolean)
      .map((p) => safeRe(p, r?.name || r?.id, ctx.errors)).filter(Boolean);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: '[FUNC]', severity: r.severity,
      // patterns 必须传编译后 RegExp（checks.js 直接 p.test(line)）
      pattern: list[0], patterns: list.length > 1 ? list.slice(1) : undefined,
      message: r.description || `疑似敏感信息（${r.name || r.id}）`,
      dimensions: [DIMENSIONS.安全性],
    });
  },
);
