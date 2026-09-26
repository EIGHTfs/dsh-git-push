/**
 * HTTP 处理层 · 共享常量（从 http-handlers.js 拆分：list 预算/探测并发/扫描等待）
 */
/** 本地列表 SSH live 探测整表共享预算（并发异步后为**上界**，超预算即跳过标 liveSkipped）。 */
export const LIST_LIVE_BUDGET_MS = 15_000;
/** 远端探测并发度。与 SSH 默认 MaxSessions 兼容，且不超过 GitHub 连接容忍度。 */
export const PROBE_CONCURRENCY = 4;
/** 本地扫描等待超时（毫秒）。 */
export const SCAN_WAIT_TIMEOUT_MS = 60_000;