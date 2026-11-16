// 审计默认值（单一来源）——规则 yml 未声明阈值时各方共用的缺省值。
//
// 为什么单独成模块：同一默认值此前在「检查层（lib/checks/*）」与「规则编译层（lib/rule/compilers/*）」
//   各写一份，两处必须永远相等——改一处漏另一处就会出现「编译器按 50 收口、检查器按 80 判定」
//   这类静默不一致（自审 maintainability/duplicate-constant-def 报出的正是这类真重复）。
//   按架构：lib/checks 与 lib/rule 都属实现层，公共缺省值放在 lib 根下做单一来源。

/** 函数行数默认阈值（yml 未配 max_lines/threshold 时）。 */
export const FUNC_LINES_DEFAULT = 50;

/** 仓库扫描下钻深度默认值（lib/git/repos.js 的 scanRepos 与 lib/plugin/auto-push.js 共用）。 */
export const DEFAULT_SCAN_DEPTH = 20;

/** 文件健康度评分基准与分档（yml 未配时）。 */
export const HEALTH_BASE_SCORE = 10;
export const HEALTH_MIN_SCORE = 0.1;
export const HEALTH_WARN_SCORE = 9;
export const HEALTH_BLOCK_SCORE = 5;
