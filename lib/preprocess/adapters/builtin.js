/**
 * 审计引擎适配器 · 内置自研引擎
 *
 * 适配器是「引擎」与「中间层」之间**唯一**的接缝：中间层只认这个接口，
 * 换引擎（ESLint / Semgrep / 外部进程 / 换语言重写）就是换一个 adapter 实现，
 * 中间层的评分、豁免、文案、门禁一个字节都不用改。
 *
 * ## 接口契约（第三方照这个实现）
 *
 * ```js
 * {
 *   id: 'my-engine',                 // 引擎标识（也用于豁免适配器表 EXEMPT_ENGINE_ADAPTERS 查表）
 *   supportsSuppressed: false,       // 是否支持「声明式豁免」：引擎自己报哪些 finding 被它豁免了
 *   declaredSuppressed(): [],        // 可选。supportsSuppressed=true 时返回 [{file,line,rule}] 或 [{fingerprint}]
 *   async run(repoPath, opts) {      // 必填。产 findings + 声明评分标准
 *     return { findings, files, scoreSpec, audit? };
 *   }
 * }
 * ```
 *
 * 三条硬约束（中间层依赖它们，第三方实现必须遵守）：
 *   1. **只产 findings，不自己算分**——评分归中间层（scoreSpec 只声明 dims/weights）；
 *   2. **findings 必须带 `file` / `line` / `rule` / `severity`**（中间层的豁免、拦截、报告都按这四个字段走）；
 *   3. **不要自己过滤掉被豁免的 finding**——`supportsSuppressed` 的引擎把「豁免了谁」报上来即可，
 *      过滤由中间层统一做（否则中间层看不见「被豁免了什么」，报告里无法追溯）。
 */
import { auditWithScope } from '../../audit/orchestrate.js';
import { getBuiltinScoreSpec } from '../../audit/score-spec.js';

/**
 * 内置自研引擎的适配器。
 *
 * `run` 只做**一件事**：把 `auditWithScope` 的结果整理成统一形态，不做任何判定。
 *   为什么保留 `audit` 原对象透传：中间层之后算分要用 `dimFileCounts` / `dimRuleCounts` /
 *   `summary` / `scope`（这些都是引擎的产物，中间层不重算），透传比逐字段搬运更不容易漏。
 */
export const builtinAdapter = {
  id: 'builtin',

  // 内置引擎的「引擎自报豁免」恒为空：它的豁免（dsh-skip-* / .auditignore / 目录类别）是
  //   在**逐文件审计时**就按真实文件正文判定的（lib/audit/audit-file.js），不走"事后声明"。
  //   声明位保留为 true 是给中间层一个明确信号：这条链路支持声明式，只是内置引擎不用它。
  supportsSuppressed: true,
  declaredSuppressed() {
    return [];
  },

  /**
   * 跑引擎。
   * @param {string} repoPath 仓库绝对路径
   * @param {object} [opts] `{ scope, maxScanFiles, rulesetDir, slots, disabledSlots, ... }`
   * @returns {Promise<{findings: object[], files: number, scoreSpec: object, audit: object}>}
   */
  async run(repoPath, opts = {}) {
    const audit = await auditWithScope(repoPath, {
      scope: opts.scope || 'diff',
      maxScanFiles: opts.maxScanFiles,
      rulesetDir: opts.rulesetDir,
      slots: opts.slots,
      disabledSlots: opts.disabledSlots,
      ...(opts.auditOptions || {}),
    });
    return {
      findings: Array.isArray(audit.findings) ? audit.findings : [],
      files: audit.files,
      scoreSpec: getBuiltinScoreSpec(),
      audit,
    };
  },
};

/** 适配器注册表（当前只有内置；接第三方引擎时在此追加或按 opts.adapter 注入）。 */
export const ADAPTERS = Object.freeze([builtinAdapter]);

/**
 * 按 id 取适配器；未知 id 直接抛错（**不静默退回内置**）。
 *
 * 为什么这里不同于 scoreSpec 的 fail-open：引擎选错是**配置错误**，
 *   静默退回内置会让「以为在跑 Semgrep、其实在跑内置」这种最坏情况发生 —— 必须硬报。
 * @param {string} [adapterId]
 * @returns {object}
 */
export function getAdapter(adapterId) {
  if (!adapterId) return builtinAdapter;
  const found = ADAPTERS.find((adapter) => adapter.id === adapterId);
  if (!found) throw new Error(`未知审计引擎适配器：${adapterId}（已注册：${ADAPTERS.map((a) => a.id).join(' / ')}）`);
  return found;
}
