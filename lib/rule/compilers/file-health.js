/**
 * 编译层 · 文件健康度 kind
 *
 * file-health：体量/结构/文档三维分级加权算健康分（与单条阈值规则的「超了就报」不同，
 *   它是矩阵评分，故单独成模块）。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, severityLevel, pickDimensions } from './helpers.js';

/* ───────────────────────── 注册：文件健康度矩阵（file-health，1.0.13） ───────────────────────── */

/**
 * 文件健康度矩阵评分（2026-09-12 确立算法）。
 * 三维独立分级：行数（≤200/201-400/401-800/801-1500/>1500）、大小 KB（≤30/31-100/101-300/301-1000/>1000）、
 * 单行最大长度（≤120/121-200/201-300/301-500/>500）→ 0~4 级；
 * 加权等级 = 行数×0.40 + 大小×0.35 + 行长×0.25；扣分按等级表线性插值（0→0, 1→1.0, 2→2.5, 3→4.5, 4→7.0）；
 * score = max(0.1, 10 - penalty)；score≥9 pass / 7≤score<9 warning / 5≤score<7 warning / score<5 blocker。
 * 豁免：*.generated.* 与 *.min.* 与 locales/ 整文件跳过；constants/ 行数等级强制 0；routes/ 行数阈值放宽。
 * 认领条件：kind==='file-health'。规则条目可覆盖参数（weight_lines/weight_size/weight_line_length/base_score）。
 */
registerCompiler(
  'file-health',
  (r) => r?.kind === 'file-health',
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'file-health', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '',
    dimensions: pickDimensions(r, [DIMENSIONS.可维护性, DIMENSIONS.可读性]),
    extra: {
      // 权重（合计 1.0；规则条目可覆盖）
      weightLines: r.weight_lines !== undefined ? Number(r.weight_lines) : 0.40,
      weightSize: r.weight_size !== undefined ? Number(r.weight_size) : 0.35,
      weightLineLength: r.weight_line_length !== undefined ? Number(r.weight_line_length) : 0.25,
      baseScore: r.base_score !== undefined ? Number(r.base_score) : 10,
      // 等级边界（可覆盖：lines_levels/size_levels/line_length_levels 各 4 个阈值分隔点）
      lineLevels: Array.isArray(r.lines_levels) ? r.lines_levels.map(Number) : [200, 400, 800, 1500],
      sizeLevels: Array.isArray(r.size_levels) ? r.size_levels.map(Number) : [30, 100, 300, 1000],
      lengthLevels: Array.isArray(r.line_length_levels) ? r.line_length_levels.map(Number) : [120, 200, 300, 500],
      // 扣分表（level 0~4）
      penalties: Array.isArray(r.level_penalties) ? r.level_penalties.map(Number) : [0, 1.0, 2.5, 4.5, 7.0],
      // 豁免（路径包含命中即按规则处理）
      exemptSkip: ['generated.', '.min.', '/locales/', 'locales/'],
      exemptConstants: ['/constants/', 'constants/'],
      exemptRoutes: ['/routes/', 'routes/'],
      // 2026-09-13：只对代码文件评健康度——md/txt/json/yml 文档的「行数/行长」不是
      //   代码健康问题（README 表格行天然超长、文档天然几百行），对文档评会误报。
      exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : undefined,
      // 阈值：warning 与 blocker 分界（score<warnScore 报 warning，<blockScore 报 blocker）
      warnScore: r.warn_score !== undefined ? Number(r.warn_score) : 9,
      blockScore: r.block_score !== undefined ? Number(r.block_score) : 5,
    },
  }),
);
