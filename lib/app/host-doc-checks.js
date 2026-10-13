/**
 * 宿主文档漂移检查器的接线模块（审计包边界，2026-10-13）。
 *
 * 边界规则：`lib/audit/**` 与 `lib/core/**` 不得 import 仓库脚本（`scripts/**`）——
 *   「目录树漂移 / 函数列表漂移」这两个检查器属于**宿主侧**能力，由宿主在加载时注入给审计（见
 *   lib/audit/orchestrate.js 的 setHostDocChecks）。
 *
 * 用法：宿主入口加一行 `import '<相对路径>/host-doc-checks.js';` 即完成接线（本模块导入即安装，幂等）。
 *   当前三处宿主入口：lib/app/tool-call.js（插件工具调用）、lib/commit-push.js（提交门禁）、cli.mjs（独立 CLI）。
 *   未接线的环境（例如别人只依赖审计子路径）：审计自动跳过这两类漂移 finding，其余检查不受影响。
 */
import { checkDrift, findMarkedHostMd } from '../../scripts/doc-tree.mjs';
import { checkFuncDrift } from '../../scripts/doc-func.mjs';
import { setHostDocChecks } from '../audit/orchestrate.js';

/** 本宿主提供的检查器集合（供测试直接比对）。 */
export const HOST_DOC_CHECKS = { checkDrift, findMarkedHostMd, checkFuncDrift };

/** 显式接线（默认已由模块导入自动执行；单独调用用于测试或自定义注入）。 */
export function installHostDocChecks(checks = HOST_DOC_CHECKS) {
  setHostDocChecks(checks);
  return true;
}

installHostDocChecks();
