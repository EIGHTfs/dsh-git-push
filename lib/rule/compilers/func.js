/**
 * 编译层 · 函数行数 kind
 *
 * func-lines（单函数行数阈值）：yml 里 max_lines 且 name 含函数语义时走这里。
 * 与 numeric-kinds 的 max-lines 区分：max-lines 管整文件行数。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, severityLevel } from './helpers.js';

/* ───────────────────────── 注册：函数行数 ───────────────────────── */

registerCompiler(
  'func-lines',
  (r) => r?.id === 'func-lines' || (r?.max_lines !== undefined && /(function|函数)/i.test(r?.name || '')),
  (r) => {
    const threshold = Number(r.max_lines) || 50;
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'func-lines', severity: r.severity,
      level: severityLevel(r.severity), threshold,
      message: r.description || '单函数超长难读，应拆分',
      dimensions: [DIMENSIONS.可读性, DIMENSIONS.可维护性],
      extra: {
        blockThreshold: threshold * 2 || 100,
        // 2026-09-13：透传 exts（函数长度只对代码文件有意义）
        exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : undefined,
      },
    });
  },
);
