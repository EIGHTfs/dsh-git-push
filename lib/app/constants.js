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
