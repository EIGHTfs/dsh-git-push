/**
 * clone 任务：预览与进度（内存态）
 *
 * 为什么单独成文件：http-handlers.js 已 600 行（超单文件 400 行上限），不宜再加逻辑；
 *   且预览/进度是「一次 clone 的临时状态」，与请求处理无关，独立后也便于单测。
 *
 * 设计取舍：
 *   - 进度是**内存态**：进程重启即丢。符合语义——clone 任务随进程存亡，
 *     留一份持久化的「上次进度」只会误导（重试时已重新开始）。
 *   - 单任务模型：本插件一次只跑一个 clone（前端也是串行点击），
 *     多任务会引入任务 id 与并发写同一目录的冲突，收益不抵复杂度。
 *   - 进度按**字节**统计而非文件数：大文件占绝对多数耗时，
 *     按文件数会出现「95% 卡住很久」的错觉。
 *
 * 2026-09-18 修「报错停止了、其实还在下载」：
 *   原先「单任务模型」只写在注释里，代码并无约束——startCloneJob 直接覆盖 current，
 *   于是第二次 clone 能与第一次并存。实测后果：两次并发写同一 dest，
 *   第二次进清理分支时第一次仍在写 -> rmdir 报 ENOTEMPTY（「创建目录失败」），
 *   而**第一次没人去停**，任务被标记为 done/失败之后 worker 仍继续下载（孤儿协程），
 *   .dsh-parts 字节数持续增长、文件句柄不释放。
 *   现补三件事：① 目录级互斥（已有任务在跑则拒绝新请求）；② 中止句柄随任务管理；
 *   ③ 结构化日志，便于事后定位。
 */

/** 当前 clone 任务（null = 空闲） */
let current = null;

/** 已结束任务的最近结果（供前端在任务结束后仍能取到终态） */
let lastDone = null;

/** 预览缓存：target+maxFileMB → 预览结果（避免每次点 clone 都打一遍 GitHub） */
const previewCache = new Map();
const PREVIEW_TTL_MS = 60_000;

/** 进行中任务的 dest -> AbortController，用于「中止在跑的下载」 */
const inflight = new Map();

/** clone 日志环形缓冲（最近 N 条，供排查；内存态，随进程存亡） */
const LOG_MAX = 200;
const logBuffer = [];

/**
 * 记一条 clone 日志。刻意同时写 stderr：插件在宿主进程内跑，
 *   出问题时用户能直接从实例日志看到，而不必先猜到有这个端点。
 * @param {string} event 事件名（start/refuse/abort/cleanup/...）
 * @param {object} detail 结构化细节
 */
export function cloneLog(event, detail = {}) {
  const entry = { at: new Date().toISOString(), event, ...detail };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_MAX) logBuffer.shift();
  try {
    // eslint-disable-next-line no-console
    console.error('[dsh-git-push:clone]', JSON.stringify(entry));
  } catch { /* 日志失败绝不影响主流程 */ }
  return entry;
}

/** 取最近日志（默认全量，最多 LOG_MAX 条）。 */
export function cloneLogs(limit = LOG_MAX) {
  return logBuffer.slice(-limit);
}

/**
 * 判断某目录是否已有 clone 在跑。
 * @param {string} dest 目标目录
 * @returns {boolean}
 */
export function isCloneInFlight(dest) {
  return inflight.has(String(dest || ''));
}

/**
 * 开始一个 clone 任务。
 *
 * 2026-09-18：原先直接覆盖 current，注释说的「同一时刻只允许一个」并无代码支撑。
 *   现改为**拒绝**而非覆盖：已有任务在跑时返回 { ok:false, reason:'busy' }，
 *   由调用方回 409 并如实说明「另一个 clone 正在进行」。
 * @param {{target:string, dest:string, totalFiles:number, totalBytes:number}} meta
 * @returns {{ok:boolean, reason?:string, running?:object, progress?:object}}
 */
export function startCloneJob(meta) {
  const dest = String(meta.dest || '');
  const busy = snapshot();
  if (busy) {
    cloneLog('refuse', { target: meta.target, dest, reason: 'another-clone-running', runningDest: busy.dest });
    return { ok: false, reason: 'busy', running: busy };
  }
  const controller = new AbortController();
  inflight.set(dest, controller);
  current = {
    target: meta.target,
    dest: meta.dest,
    totalFiles: meta.totalFiles || 0,
    totalBytes: meta.totalBytes || 0,
    done: 0,
    transferred: 0,
    failed: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    // 进度停滞检测：调用方据此判定「卡死」——比绝对超时合理，
    //   30MB 单文件传输慢但进度在涨，不该被判超时
    lastProgressAt: Date.now(),
    phase: 'downloading',
  };
  cloneLog('start', { target: meta.target, dest, totalFiles: current.totalFiles, totalBytes: current.totalBytes });
  return { ok: true, progress: snapshot() };
}

/**
 * 取当前任务的中止信号（下载器消费它；清理同目录残留前会先 abort）。
 * @returns {AbortSignal|null}
 */
export function cloneAbortSignal() {
  if (!current) return null;
  return inflight.get(current.dest)?.signal || null;
}

/**
 * 中止当前任务的下载。
 *
 * 为什么必须有：清理残留目录（rmSync）与下载 worker 并发时会互相踩——
 *   边删边写导致 rmdir 报 ENOTEMPTY，且 worker 无人取消会变成孤儿继续下载。
 *   故清理前先 abort，让 worker 在下一个检查点退出。
 * @param {string} why 中止原因（写进日志）
 * @returns {boolean} 是否确实中止了一个任务
 */
export function abortCloneJob(why = 'unspecified') {
  const dest = current?.dest;
  if (!dest) return false;
  const c = inflight.get(dest);
  if (!c) return false;
  cloneLog('abort', { dest, why });
  c.abort(new Error(`clone aborted: ${why}`));
  inflight.delete(dest);
  return true;
}

/**
 * 更新进度（下载器的 onProgress 直接接这里）。
 * @param {{done:number,total:number,transferred:number,totalBytes:number,failed:number}} p
 */
export function updateCloneJob(p) {
  if (!current) return;
  const before = current.transferred;
  current.done = p.done ?? current.done;
  current.transferred = p.transferred ?? current.transferred;
  current.failed = p.failed ?? current.failed;
  if (p.total) current.totalFiles = p.total;
  if (p.totalBytes) current.totalBytes = p.totalBytes;
  current.updatedAt = Date.now();
  // 只有真的传了字节才算「有进展」，避免空转重置停滞计时
  if (current.transferred > before) current.lastProgressAt = Date.now();
}

/** 标记任务进入 git init/commit 阶段（此阶段无字节进度，前端文案要跟着变） */
export function setCloneJobPhase(phase) {
  if (current) { current.phase = phase; current.updatedAt = Date.now(); current.lastProgressAt = Date.now(); }
}

/** 结束任务：记终态，清 current */
export function finishCloneJob(result) {
  const snap = snapshot();
  lastDone = {
    ok: !!result.ok,
    error: result.error || '',
    ...snap,
    finishedAt: Date.now(),
  };
  // inflight 必须随之释放，否则 abort 句柄泄漏、后续同名 dest 会被误判为「仍在跑」
  if (current?.dest) inflight.delete(current.dest);
  current = null;
  cloneLog(result.ok ? 'finish-ok' : 'finish-fail', {
    dest: snap?.dest,
    target: snap?.target,
    done: snap?.done,
    totalFiles: snap?.totalFiles,
    transferred: snap?.transferred,
    failed: snap?.failed,
    elapsedMs: snap ? Date.now() - snap.startedAt : undefined,
    error: result.error || '',
  });
  return lastDone;
}

/**
 * 取当前进度快照（含停滞秒数，供前端判断是否卡死）。
 * @returns {object|null}
 */
export function snapshot() {
  if (!current) return null;
  return {
    target: current.target,
    dest: current.dest,
    phase: current.phase,
    done: current.done,
    totalFiles: current.totalFiles,
    transferred: current.transferred,
    totalBytes: current.totalBytes,
    failed: current.failed,
    elapsedMs: Date.now() - current.startedAt,
    stalledMs: Date.now() - current.lastProgressAt,
    // 百分比：按字节；总量未知时退回文件数
    percent: current.totalBytes > 0
      ? Math.min(99, Math.floor((current.transferred / current.totalBytes) * 100))
      : (current.totalFiles > 0 ? Math.min(99, Math.floor((current.done / current.totalFiles) * 100)) : 0),
  };
}

/**
 * 查询任务状态：进行中返回进度；已结束返回终态；都没有则 idle。
 */
export function cloneJobStatus() {
  const cur = snapshot();
  if (cur) return { state: 'running', progress: cur };
  if (lastDone) return { state: 'done', result: lastDone };
  return { state: 'idle' };
}

/** 清除终态（前端取走后调用，避免旧结果被反复读到） */
export function clearCloneJobResult() {
  lastDone = null;
}

/** 预览缓存读写 */
export function getPreview(key) {
  const hit = previewCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PREVIEW_TTL_MS) { previewCache.delete(key); return null; }
  return hit.data;
}

export function setPreview(key, data) {
  previewCache.set(key, { at: Date.now(), data });
  // 简单上限：预览是短命缓存，超过 20 条清最早的一半
  if (previewCache.size > 20) {
    const keys = [...previewCache.keys()].slice(0, 10);
    for (const k of keys) previewCache.delete(k);
  }
  return data;
}

/** 测试用：重置全部内存态 */
export function __resetCloneJobs() {
  current = null; lastDone = null; previewCache.clear(); inflight.clear(); logBuffer.length = 0;
}
