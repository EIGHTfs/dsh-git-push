/**
 * 插件入口层 · 常量
 *
 * name（插件名，宿主用它标识 loader 行）、GIT_PUSH_SETTINGS_NS（设置命名空间，
 *   落 settings.yaml 的键前缀）、MSG_REPO_REQUIRED（未指定仓库时的统一提示）。
 */

/** git 工具共用参数错误文案（单处定义，多处复用）。 */
export const MSG_REPO_REQUIRED = 'repo 必填';

export const name = 'dsh-git-push';

export const GIT_PUSH_SETTINGS_NS = 'git-push';

/** blocked 消息预览截断长度（审计输出精简——完整 message 走 /audit 明细）。多入口共用，单处定义。 */
export const MAX_MSG_PREVIEW = 80;

/**
 * 提交前预处理引擎默认超时（毫秒，10 分钟）。
 * 单处定义的原因：schema 默认值（lib/app/schema.js 的 preCommit.timeoutMs）与运行期兜底
 *   （lib/commit-push/pre-commit-engine.js）必须永远相等——两处各写一份数字，改一处漏另一处
 *   就会出现「配置显示 10 分钟、实际跑 5 分钟」这种自相矛盾的静默不一致。
 * 取值理由：大仓全量审计可达分钟级，但引擎卡死必须能被判定，不能无限等。
 */
export const PRE_COMMIT_TIMEOUT_MS_DEFAULT = 600000;
