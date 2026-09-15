/**
 * dsh-git-push · 插件入口（宿主 main 指向本文件）
 *
 * 本文件只做再导出：实现全在 lib/app/*.js，本文件不含实现。
 * 宿主要的是 name / Config / apply 这几个符号，再导出对 ESM 完全透明——
 *   但**不要**把本文件写成空壳之外的东西：宿主 main 指向它，加载失败整插件不生效。
 *
 * lib/app/ 模块划分：
 *   schema.js      配置 schema（含宿主无 schemastery 时的最小兜底）
 *   constants.js   插件名 / 设置命名空间 / 统一提示常量
 *   slot-stats.js  槽位命中统计（模块级可变状态集中处）
 *   tools.js       暴露给宿主的工具声明
 *   inject-text.js 注入文本（开发者要求清单 / 审计结果块 / README 提醒）
 *   tool-call.js   工具调用分发（含读文件兜底）
 *   http-handlers.js  HTTP 路由与规则包列表
 *   apply.js      插件装载入口（注册编排）
 */

export { Config } from './schema.js';
export { MSG_REPO_REQUIRED, name, GIT_PUSH_SETTINGS_NS } from './constants.js';
export { setLastSlotHitStats, getLastSlotHitStats, getLastSlotHitMeta } from './slot-stats.js';
export { listTools } from './tools.js';
export { README_CHECK_HINT, buildRequirementsInjectionText, formatAuditBlock } from './inject-text.js';
export { callTool } from './tool-call.js';
export { adaptHttpHandler, listRuleSlots, handleHttp } from './http-handlers.js';
export { apply } from './apply.js';
export { parseGitAuditInput, sessionCwdOf, findGitRoot, resolveAuditRepo, runGitAuditCommand, registerSlashCommands } from './slash-commands.js';

import { routeRequest, readJsonBody } from '../http/index.js';
export { routeRequest, readJsonBody };
