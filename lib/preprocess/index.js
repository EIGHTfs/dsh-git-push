/**
 * 预处理能力汇总层（git 侧只与这一层打交道）
 *
 * 「预处理」= 提交前要跑的外部能力（当前只有审计；将来可能还有 lint / 类型检查 / 安全扫描）。
 * 每个预处理贡献三项能力（见 ./audit.js 头部注释）：`params` / `enabled` / `renderResult`。
 * git 侧不 import 任何具体预处理的实现，只调用本层的三个函数 —— 这样加/去掉一个预处理时，
 * git 侧只需改配置或注册表，不用改代码路径。
 *
 * ── 三样刻意留在 git 侧，**不要**搬进预处理（搬了就会出真问题）──
 *   ① **`blocked` 布尔**：`lib/app/tool-call.js` 的 `pushJobOutcome` 用它决定
 *      「未推送（被拦截）」还是「未完成：<原因>」——这是「被拦截 ≠ 执行失败」的语义分叉，
 *      属 job 状态机，与审计判定无关。预处理只给文案，不决定 job 状态。
 *   ② **引擎 spawn 失败文案**：`lib/commit-push/pre-commit-engine.js` 里的
 *      「找不到引擎命令 / 引擎不可用」。引擎自己没被找到时根本不会执行，
 *      它无法生成「我没被找到」这句话 —— 只有拉起它的 git 侧知道。
 *   ③ **兜底默认文案**：预处理可能不可用、可能没实现 renderResult、可能抛错，
 *      git 侧必须有一份中性兜底（`lib/commit-push.js` 的 `defaultPreprocessRender`），
 *      保证**不崩、不静默丢信息**。本层只负责「合并谁的渲染结果」，不提供兜底文案。
 */

import { auditPreprocess, auditPreprocessAvailable, AUDIT_COMMIT_PARAMS } from './audit.js';

/** 已注册的预处理（当前只有审计；新增时在这里追加，git 侧零改动）。 */
export const PREPROCESSORS = [auditPreprocess];

// 供 command-registry 等历史调用方按原路径继续引用（参数与可用性判据的公开面不变）
export { auditPreprocess, auditPreprocessAvailable, AUDIT_COMMIT_PARAMS };

/**
 * 汇总所有**可用**预处理贡献的参数。
 * @param {object} [cfg] 插件配置
 * @param {boolean} [hasBuiltinEngine] 仅供测试注入
 * @param {Array} [preprocessors] 预处理列表（测试可注入）
 * @returns {Array} 参数 schema 数组
 */
export function preprocessParams(cfg = {}, hasBuiltinEngine, preprocessors = PREPROCESSORS) {
  const out = [];
  for (const pp of preprocessors) {
    const enabled = typeof pp.enabled === 'function' ? pp.enabled(cfg, hasBuiltinEngine) : true;
    if (!enabled) continue;
    if (Array.isArray(pp.params)) out.push(...pp.params);
  }
  return out;
}

/**
 * 让**可用**的预处理渲染自己的结果文案。
 *
 * 合并策略：按注册顺序取第一个提供 `renderResult` 的预处理的结果；
 *   多项都提供时逐字段后者覆盖前者（`error` / `apiGuide` / `notes` 各自独立）。
 *   为什么不是"第一个非空就停"：`notes` 可能只有某一个预处理提供，逐字段合并更不容易丢信息。
 * 失败策略：任何预处理抛错都**吞掉并继续**——渲染文案失败绝不能把提交门禁带崩
 *   （判定已经做完了，这里只是措辞）。
 * @param {object} ctx 数据契约见 lib/preprocess/audit.js 的 auditRenderResult
 * @param {object} [cfg] 插件配置
 * @param {Array} [preprocessors] 预处理列表（测试可注入，传 [] 可验证兜底）
 * @returns {{error?: string, apiGuide?: string, notes?: object}|undefined}
 */
export function renderPreprocessResult(ctx = {}, cfg = {}, preprocessors = PREPROCESSORS) {
  let merged;
  for (const pp of preprocessors) {
    const enabled = typeof pp.enabled === 'function' ? pp.enabled(cfg) : true;
    if (!enabled) continue;
    if (typeof pp.renderResult !== 'function') continue;
    let partial;
    try {
      partial = pp.renderResult(ctx);
    } catch {
      continue; // 渲染失败不阻断：留给兜底文案
    }
    if (!partial || typeof partial !== 'object') continue;
    merged = merged || {};
    if (partial.error !== undefined) merged.error = partial.error;
    if (partial.apiGuide !== undefined) merged.apiGuide = partial.apiGuide;
    if (partial.notes && typeof partial.notes === 'object') merged.notes = { ...(merged.notes || {}), ...partial.notes };
  }
  return merged;
}
