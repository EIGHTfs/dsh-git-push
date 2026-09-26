/**
 * HTTP 处理层 · 仓库动作端点（repo-visibility / repo-push / repo-commit）
 *
 * 从 http-handlers.js 的 handleHttp 拆分而来（2026-09-29）。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 */
import { join } from 'node:path';
import { pushCurrentBranch, resolveToken, githubFetch, setVisibility, refreshAccountStatus, detectRepoVisibility, runGit, parseGithubOwnerRepo } from '../../git/index.js';
import { updateRepoIndex } from '../../git/repo-index.js';
import { commitWithAudit } from '../../commit-push.js';

/* ───────── 仓库动作常量 ───────── */
const COMMIT_SHA_MAX_LEN = 40; // commit sha 展示截断长度

/** GET|POST /api/git-push/repo-visibility —— 云端仓库私有/公开切换（GET 只读查状态）。 */
export async function handleRepoVisibility(ctx) {
  const { req, query, body, env } = ctx;
  if (String(req.method || 'GET').toUpperCase() === 'GET') {
    const owner = String(query.owner || '').trim();
    const repo = String(query.repo || '').trim();
    if (!owner || !repo) return { status: 400, body: { ok: false, code: 'BAD_INPUT', message: '缺 owner/repo' } };
    const tok = resolveToken({ workspaceRoot: env.workspaceRoot }).token;
    if (!tok) return { status: 400, body: { ok: false, code: 'NO_TOKEN', message: '未配置 token' } };
    const res = await githubFetch(`/repos/${owner}/${repo}`, { token: tok, method: 'GET' });
    if (res.status !== 200) return { status: 400, body: { ok: false, error: res.json?.message || res.error || `HTTP ${res.status}` } };
    return { status: 200, body: { ok: true, owner, repo, visibility: res.json?.private ? 'private' : 'public' } };
  }
  const owner = String((body && body.owner) || '').trim();
  const repo = String((body && body.repo) || '').trim();
  const visibility = String((body && body.visibility) || '').toLowerCase();
  if (!owner || !repo) return { status: 400, body: { ok: false, code: 'BAD_INPUT', message: '缺 owner/repo' } };
  if (!['public', 'private'].includes(visibility)) return { status: 400, body: { ok: false, code: 'BAD_VIS', message: 'visibility 必须为 public 或 private' } };
  const r = await setVisibility({ owner, repo, visibility, token: resolveToken({ workspaceRoot: env.workspaceRoot }).token });
  if (!r.ok) return { status: 400, body: { ok: false, code: 'VIS_FAIL', error: r.error } };
  return { status: 200, body: { ok: true, owner: r.owner, repo: r.repo, visibility: r.visibility } };
}

/** POST /api/git-push/repo-push —— 手动推送（领先 + 工作树干净才允许）。 */
export async function handleRepoPush(ctx) {
  const { body, env, cfg } = ctx;
  const path = String(body.path || '').trim();
  if (!path) return { status: 400, body: { ok: false, error: '缺少仓库路径 path' } };
  const r = await pushCurrentBranch({ repoPath: path, pushMethod: cfg.pushMethod || 'ssh' });
  if (r.ok) {
    const repoName = String(path).split('/').filter(Boolean).pop() || '';
    // 索引更新串行：全量重建在前，精确回写在后；SSH 无 commitSha 时回退本地 HEAD
    (async () => {
      await updateRepoIndex({
        workspaceRoot: env.workspaceRoot,
        token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
        owner: r.push?.owner || 'EIGHTfs',
        mode: 'rebuild',
      }).catch(() => { /* fire-and-forget */ });
      let visibility = '';
      try {
        const dv = await detectRepoVisibility({ repoPath: path, token: resolveToken({ workspaceRoot: env.workspaceRoot }).token });
        if (dv.visibility === 'private') visibility = '私有';
        else if (dv.visibility === 'public') visibility = '公开';
      } catch { /* 可见性查不到不覆盖 */ }
      const localHead = runGit(['rev-parse', 'HEAD'], { cwd: path }).stdout.trim();
      const headSha = String(r.push?.commitSha || '').slice(0, COMMIT_SHA_MAX_LEN) || localHead;
      updateRepoIndex({
        workspaceRoot: env.workspaceRoot,
        repoName,
        remoteState: {
          remoteHead: headSha,
          ahead: 0,
          behind: 0,
          remoteHeadAt: new Date().toISOString(),
          synced: true,
          visibility,
        },
        mode: 'single',
      });
    })().catch(() => { /* 索引更新失败不阻断 */ });
    refreshAccountStatus({ workspaceRoot: env.workspaceRoot }).catch(() => { /* 静默 */ });
  }
  const error = r.error || r.push?.reason || undefined;
  return { status: r.ok ? 200 : 400, body: { ...r, error, repoIndex: r.ok ? 'updating' : undefined, indexUpdated: r.ok === true } };
}

/** POST /api/git-push/repo-commit —— UI 手动提交（只 commit 不 push，走审计门禁）。 */
export async function handleRepoCommit(ctx) {
  const { body, path: _path, cfg } = ctx;
  const path = String(body.path || '').trim();
  const message = String(body.message || '').trim();
  if (!path) return { status: 400, body: { ok: false, error: '缺少仓库路径 path' } };
  if (!message) return { status: 400, body: { ok: false, error: '缺少 commit message（先输入提交说明）' } };
  const r = await commitWithAudit({
    repoPath: path,
    message,
    push: false,
    audit: true,
    requirementsConfirmed: true,
    pushMethod: cfg.pushMethod || 'ssh',
    pushGate: false,
    pushConfirmed: true,
  });
  if (!r.ok) {
    const findings = r.audit?.findings || [];
    const blockers = findings.filter((f) => f.severity === 'blocker').slice(0, 3)
      .map((f) => `${f.file}:${f.line} ${f.rule}`);
    return {
      status: 200,
      body: {
        ok: false,
        blocked: !!r.blocked,
        error: r.error || '提交失败',
        summary: r.audit?.summary,
        blockers,
        warnings: [],
        warningCount: 0,
        commitSha: '',
      },
    };
  }
  const findings = r.audit?.findings || [];
  const warnings = findings.filter((f) => f.severity === 'warning');
  return {
    status: 200,
    body: {
      ok: true,
      blocked: false,
      commitSha: String(r.commitSha || '').slice(0, 7),
      summary: r.audit?.summary,
      blockers: [],
      warningCount: warnings.length,
      warnings: warnings.slice(0, 3).map((f) => `${f.file}:${f.line} ${f.rule}`),
    },
  };
}