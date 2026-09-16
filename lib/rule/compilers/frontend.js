/**
 * 编译层 · 前端与工程约定类 kind（三个）
 *
 * button-bind（按钮是否绑定动作）、magic-number-smart（硬编码魔数，含版本号豁免）、
 *   patch-insert（bundle patch 必须顶层 insert）。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, severityLevel, pickDimensions } from './helpers.js';

/* ───────────────────────── 注册：按钮事件绑定（button-bind，1.0.5 油猴脚本版） ───────────────────────── */

/**
 * 按钮事件绑定交叉比对（油猴脚本/浏览器扩展专用）。
 * 认领条件：显式 kind==='button-bind'，或 category==='button' 且无 patterns/path_pattern（交叉比对型）。
 * 编译产物：保留 id/severity/message/extra（checkButtonBindings 做同文件交叉比对）。
 * 场景：HTML 以字符串内嵌 JS（innerHTML/insertAdjacentHTML/模板字符串/createElement），
 * 事件在 JS 里 addEventListener/onclick= 绑定——不能只看 inline onclick。
 */
registerCompiler(
  'button-bind',
  (r) => r?.kind === 'button-bind' || (r?.category === 'button' && !Array.isArray(r?.patterns) && !r?.pattern && !r?.path_pattern),
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'button-bind', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '',
    dimensions: pickDimensions(r, [DIMENSIONS.可维护性]),
    extra: {
      buttonInsertPatterns: Array.isArray(r?.insertion_patterns) ? r.insertion_patterns : [],
      bindPatterns: Array.isArray(r?.binding_patterns) ? r.binding_patterns : [],
    },
  }),
);

/* ───────────────────────── 注册：硬编码魔数检测（magic-number-smart，1.0.7 版本号豁免版） ───────────────────────── */

/**
 * 智能硬编码魔数检测（用户 2026-09-12 YAML「硬编码魔数检测规则（版本号豁免版）」）。
 * 认领条件：kind==='magic-number-smart'，或 id 含 magic-number-smart。
 * 编译产物：保留 magicHints/legitHints/forceCount 到 extra（checkMagicNumberSmart 消费）。
 * 2026-09-16 合并：readability/magic-number（纯 regex 快速版）已并入本规则——smart 按
 *   「数字 + 上下文 + 豁免清单」精确判定，覆盖运算/比较里的全部数字字面量形态，
 *   版本号/日期/HTTP 状态码/常见合法常量/状态枚举/命名常量值不报。
 */
registerCompiler(
  'magic-number-smart',
  (r) => r?.kind === 'magic-number-smart' || /magic-number-smart/.test(r?.id || ''),
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'magic-number-smart', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '',
    dimensions: pickDimensions(r, [DIMENSIONS.可维护性]),
    extra: {
      magicHints: Array.isArray(r?.magic_number_hints) ? r.magic_number_hints : [],
      legitHints: Array.isArray(r?.legitimate_hints) ? r.legitimate_hints : [],
      forceCount: Number(r?.force_count) || 3,
      // 2026-09-13：透传 exts/excludePaths——魔数检测只对代码文件生效
      //   （README/CSS/JSON 里的版本号、端口、尺寸是正常书写，不构成硬编码魔数）
      exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : undefined,
      excludePaths: Array.isArray(r.exclude_paths) ? r.exclude_paths.map(String) : undefined,
    },
  }),
);

/* ───────────────────────── 注册：patch insert 语义（patch-insert，1.1.1） ───────────────────────── */

/**
 * cordis.patch.yml insert 语义检查（修复误报）。
 * 认领条件：kind==='patch-insert'。
 * 编译产物：透传 exts（只对 yml/yaml 生效）与 message，检查器做语义判定：
 * 仅在「insert 块内的 id 与顶层按 id 覆盖行（非 insert 的 - id 行）同 id」时报，
 * 替代旧「命中 insert: 行即提示」——纯 insert（无覆盖行同 id）不再误报。
 */
registerCompiler(
  'patch-insert',
  (r) => r?.kind === 'patch-insert',
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'patch-insert', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '',
    dimensions: pickDimensions(r, [DIMENSIONS.健壮性, DIMENSIONS.可部署性]),
    extra: {
      exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : ['yml', 'yaml'],
    },
  }),
);
