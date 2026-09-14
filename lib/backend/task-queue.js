/**
 * dsh-git-push — 后台任务队列（2026-09-14，方案 B：审计同步、推送后台化）
 *
 * 解决：git_commit_push 原先整体同步 await（审计全仓可能几十秒 + push + 索引重建联网），
 *   AI 调用期间被阻塞干不了别的。改为「审计同步即时拦截 → 通过后 commit+push+索引
 *   丢进进程内后台任务」——工具立即返回 taskId，AI 可继续做别的事，稍后用
 *   git_push_status 工具 / GET /api/git-push/task/<id> 查询任务结果。
 *
 * 生命周期：任务状态存进程内 Map——实例存活期间可查询；实例重启即丢失
 *   （已完成/失败的任务，其结果已在返回/状态里可读，不依赖重启持久化）。
 */
let seq = 0;
const tasks = new Map();

/**
 * 提交一个后台任务，立即返回 task serverId。
 * @param {Function} fn 异步任务体（返回结果对象）
 * @param {{title?: string}} [opts]
 * @returns {string} taskId
 */
export function submitTask(fn, { title = '' } = {}) {
  const id = 't' + String(++seq).padStart(4, '0');
  const t = {
    id,
    title,
    status: 'pending', // pending | running | done | error
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
  tasks.set(id, t);
  Promise.resolve()
    .then(async () => {
      t.status = 'running';
      t.startedAt = Date.now();
      try {
        t.result = (await fn()) ?? null;
        t.status = 'done';
      } catch (e) {
        t.status = 'error';
        t.error = String((e && e.message) || e);
      }
      t.finishedAt = Date.now();
    });
  return id;
}

/** 查询单个任务；不存在返回 null。 */
export function getTask(taskId) {
  return tasks.get(String(taskId)) || null;
}

/** 列出全部任务（按创建时间升序）。 */
export function listTasks() {
  return [...tasks.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** 任务数（供测试占用断言）。 */
export function taskCount() {
  return tasks.size;
}