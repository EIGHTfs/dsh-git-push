/**
 * HTTP 处理层 · 共享常量（从 http-handlers.js 拆分：list 预算/探测并发/扫描等待）
 */
/** 本地列表 SSH live 探测整表共享预算（并发异步后为**上界**，超预算即跳过标 liveSkipped）。 */
export const LIST_LIVE_BUDGET_MS = 15_000;
/** 远端探测并发度。与 SSH 默认 MaxSessions 兼容，且不超过 GitHub 连接容忍度。 */
export const PROBE_CONCURRENCY = 4;
/**
 * 本地扫描长轮询的单次挂起上限（毫秒）。
 *
 * **必须小于前端 fetch 超时**（`dshgp_FETCH_TIMEOUT_MS` = 30s，取 80% 余量 ⇒ ≤24s）。
 *   为什么：这是长轮询语义——服务端「挂起到有新进度或到点」才返回，到点返回
 *   `{timeout:true, running:true}`，前端据此再发起下一轮，推进由 `done` 事件驱动。
 *   若服务端挂得比前端超时还久，前端会先 abort（`signal timed out`），
 *   长轮询变成假失败——原先取 60s 正是这个错误（客户端 30s 必先炸）。
 *   `test/test-repos-live-budget.mjs` 有断言守着这条关系。
 */
export const SCAN_WAIT_TIMEOUT_MS = 20_000;
