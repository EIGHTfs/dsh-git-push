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
 */

/** 当前 clone 任务（null = 空闲） */
let current = null;

/** 已结束任务的最近结果（供前端在任务结束后仍能取到终态） */
let lastDone = null;

/** 预览缓存：target+maxFileMB → 预览结果（避免每次点 clone 都打一遍 GitHub） */
const previewCache = new Map();
const PREVIEW_TTL_MS = 60_000;

/**
 * 开始一个 clone 任务（覆盖上一个；同一时刻只允许一个）。
 * @param {{target:string, dest:string, totalFiles:number, totalBytes:number}} meta
 */
export function startCloneJob(meta) {
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
  return snapshot();
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
  lastDone = {
    ok: !!result.ok,
    error: result.error || '',
    ...snapshot(),
    finishedAt: Date.now(),
  };
  current = null;
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
  current = null; lastDone = null; previewCache.clear();
}
