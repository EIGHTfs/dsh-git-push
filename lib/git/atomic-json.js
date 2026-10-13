/**
 * 兼容壳（审计↔git 边界澄清第一期，2026-10-13）：
 * 实现已迁至 lib/core/atomic-json.js，本文件只做一行再导出，让既有消费方零改动。
 * 新代码请直接 import '../core/atomic-json.js'。
 */
export * from '../core/atomic-json.js';
