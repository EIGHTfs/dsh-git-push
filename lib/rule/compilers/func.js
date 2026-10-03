/**
 * 编译层 · 函数行数 kind
 *
 * func-lines（单函数行数阈值）：yml 里 max_lines 且 name 含函数语义时走这里。
 * 与 numeric-kinds 的 max-lines 区分：max-lines 管整文件行数。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, severityLevel, pickDimensions } from './helpers.js';

/* ───────── 函数行数默认阈值 ───────── */
// 与 lib/checks/structural.js 共用同一来源（lib/audit-defaults.js）——两处必须永远相等，
//   各写一份会出现「编译器按 50 收口、检查器按别的值判定」的静默不一致（自审 duplicate-constant 报的真重复）
import { FUNC_LINES_DEFAULT } from '../../audit-defaults.js';

/* ───────────────────────── 注册：函数行数 ───────────────────────── */

registerCompiler(
  'func-lines',
  (r) => r?.id === 'func-lines' || (r?.max_lines !== undefined && /(function|函数|方法)/i.test(r?.name || '')),
  (r) => {
    const threshold = Number(r.max_lines) || FUNC_LINES_DEFAULT;
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'func-lines', severity: r.severity,
      level: severityLevel(r.severity), threshold,
      message: r.description || '单函数超长难读，应拆分',
      dimensions: pickDimensions(r, [DIMENSIONS.可读性, DIMENSIONS.可维护性]),
      extra: {
        blockThreshold: threshold * 2 || 100,
        // 透传 exts（函数长度只对代码文件有意义）
        exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : undefined,
      },
    });
  },
);
