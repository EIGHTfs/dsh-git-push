/**
 * HTTP 处理层 · 克隆端点（repo-clone / clone-logs / clone-abort / clone-preview / clone-progress）
 *
 * 从 http-handlers.js 的 handleHttp 拆分而来（2026-09-29）。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 */
import {
  startCloneJob, updateCloneJob, finishCloneJob, setCloneJobPhase,
  cloneJobStatus, clearCloneJobResult, getPreview, setPreview, cloneLog, cloneLogs, abortCloneJob,
} from '../../git/clone-jobs.js';
import { resolveToken, cloneViaApi, previewClone, parseGithubOwnerRepo } from '../../git/index.js';
import { join } from 'node:path';

/* ───────── 克隆端点常量 ───────── */
const JOB_ID_RADIX = 36;     // clone 任务 id 的 36 进制（短 id）
const LOG_LIMIT_DEFAULT = 200; // clone-logs 默认条数上限

/** POST /api/git-push/repo-clone —— 手动克隆（后台 job）。 */
export async function handleRepoClone(ctx) {
  const { body, env } = ctx;
  const target = String(body.target || '').trim();
  const dir = String(body.dir || '').trim();
  if (!target) return { status: 400, body: { ok: false, error: '缺少 target（owner/repo 或 GitHub URL）' } };
  if (!dir) return { status: 400, body: { ok: false, error: '缺少目标目录 dir（先用目录选择器选父目录）' } };
  const pr = parseGithubOwnerRepo(target);
  if (!pr) return { status: 400, body: { ok: false, error: `无法解析 target（${target}）：需要 owner/repo 或 GitHub URL` } };
  const dest = join(dir, pr.repo);
  const cfg = env.cfg || {};
  const maxFileMB = Number.isFinite(cfg.maxCloneFileMB) ? cfg.maxCloneFileMB : 10;
  const concurrency = Number.isFinite(cfg.cloneConcurrency) ? cfg.cloneConcurrency : 6;
  const pre = await previewClone({ target, token: resolveToken({ workspaceRoot: env.workspaceRoot }).token, maxFileMB });
  if (!pre.ok) return { status: 400, body: pre };
  const started = startCloneJob({ target, dest, totalFiles: pre.downloadCount, totalBytes: pre.downloadBytes });
  if (!started.ok) {
    cloneLog('reject-busy', { target, dest, runningDest: started.running?.dest });
    return {
      status: 409,
      body: {
        ok: false,
        cause: 'busy',
        retriable: false,
        error: `已有克隆正在进行（${started.running?.dest || '未知目录'}）——请等它结束再试，`
          + '避免两个克隆同时写同一目录。',
        running: started.running || null,
      },
    };
  }
  const jobId = 'clone-' + Date.now().toString(JOB_ID_RADIX);
  (async () => {
    let r;
    try {
      r = await cloneViaApi({
        target, dest,
        token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
        maxFileMB, concurrency,
        onProgress: (p) => updateCloneJob(p),
      });
    } catch (e) {
      cloneLog('clone-throw', { target, dest, error: e?.message || String(e) });
      r = { ok: false, error: `克隆异常: ${e?.message || e}`, cause: 'unknown', retriable: true };
    } finally {
      setCloneJobPhase('done');
    }
    finishCloneJob(r);
  })().catch((e) => {
    cloneLog('clone-bg-throw', { target, dest, error: e?.message || String(e) });
    try { setCloneJobPhase('done'); } catch { /* 忽略 */ }
    try { finishCloneJob({ ok: false, error: `克隆后台异常: ${e?.message || e}`, cause: 'unknown', retriable: true }); } catch { /* 忽略 */ }
  });
  return {
    status: 202,
    body: {
      ok: true, async: true, jobId, target, dest,
      totalFiles: pre.downloadCount, totalBytes: pre.downloadBytes,
      hint: '克隆已在后台运行，轮询 /clone-progress 取进度与终态',
    },
  };
}

/** GET|POST /api/git-push/clone-logs —— 克隆结构化日志。 */
export function handleCloneLogs(ctx) {
  const { body } = ctx;
  const limit = Number.isFinite(body.limit) ? body.limit : LOG_LIMIT_DEFAULT;
  return { status: 200, body: { ok: true, logs: cloneLogs(limit) } };
}

/** POST /api/git-push/clone-abort —— 手动中止当前克隆。 */
export function handleCloneAbort() {
  const aborted = abortCloneJob('manual');
  return { status: 200, body: { ok: true, aborted } };
}

/** POST /api/git-push/clone-preview —— 克隆前预览（下载量/超大文件）。 */
export async function handleClonePreview(ctx) {
  const { body, env } = ctx;
  const target = String(body.target || '').trim();
  if (!target) return { status: 400, body: { ok: false, error: '缺少 target（owner/repo 或 GitHub URL）' } };
  const maxFileMB = Number.isFinite(body.maxFileMB) ? body.maxFileMB
    : (Number.isFinite((env.cfg || {}).maxCloneFileMB) ? env.cfg.maxCloneFileMB : 10);
  const cacheKey = target + '|' + maxFileMB;
  const cached = getPreview(cacheKey);
  if (cached) return { status: 200, body: cached };
  const r = await previewClone({ target, token: resolveToken({ workspaceRoot: env.workspaceRoot }).token, maxFileMB });
  if (r.ok) setPreview(cacheKey, r);
  return { status: r.ok ? 200 : 400, body: r };
}

/** GET|POST /api/git-push/clone-progress —— 轮询克隆进度。 */
export function handleCloneProgress(ctx) {
  const { body } = ctx;
  const st = cloneJobStatus();
  if (st.state === 'done' && body.consume) clearCloneJobResult();
  return { status: 200, body: { ok: true, ...st } };
}