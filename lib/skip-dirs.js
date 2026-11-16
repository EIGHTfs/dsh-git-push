/**
 * 统一「无条件跳过目录」名单（宿主侧只剩硬编码基线）。
 *
 * 历史：本模块原设计是「硬编码基线（node_modules/.git）+ 从审计规则 yml 的 exclude_dirs 取黑名单」。
 *   审计实现与规则 yml 已整体迁入独立包（audit-sluice）⇒ 宿主读不到 yml，yml 那半段已删除。
 *   需要按规则排除目录的场景属于审计侧职责，不该再回到宿主。
 *
 * 消费方：lib/git/sensitive.js（敏感文件扫描时剪枝）。
 */

/**
 * 跳过目录基线。
 *   - `node_modules` / `.git`：任何仓库都该跳
 *   - `node_modules.orig` / `node_modules.bak`：安装/降级留下的完整副本，
 *     里面同样是依赖代码，扫它既慢又会产生大量无关敏感命中
 * 其余目录（dist/build/vendor/.dsh/.trash…）不写死——需要时由调用方显式传参。
 */
export const SKIP_DIRS = new Set(['node_modules', 'node_modules.orig', 'node_modules.bak', '.git']);

/**
 * 最终跳过目录集合。
 * 保留函数形态（而非直接导出 Set）是为了调用方不必关心「以后会不会再合并别的来源」。
 */
export function getSkipSet() {
  return new Set(SKIP_DIRS);
}
