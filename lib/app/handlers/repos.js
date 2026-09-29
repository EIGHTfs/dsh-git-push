/**
 * HTTP 处理层 · 仓库列表/扫描端点（repos-local / repos-local-scan / -wait / -refresh / repos-cloud）
 *
 * 从 http-handlers.js 的 handleHttp 拆分而来。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 */
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readAccountStatus, runGit, liveRemoteHead, liveRemoteHeadAsync, listCloudRepos,
  resolveToken, describeRepo,
} from '../../git/index.js';
import {
  readRepoIndexMap, updateRepoIndex,
} from '../../git/repo-index.js';
import { runScan, waitScanDelta } from '../../git/index.js';
import { getDefaultScanRoot } from '../scan-root.js';
import { LIST_LIVE_BUDGET_MS, PROBE_CONCURRENCY, SCAN_WAIT_TIMEOUT_MS } from './http-constants.js';

/** GET/POST /api/git-push/repos-local —— 本地仓库列表（读索引 + live 并发探测远端）。 */
/** 构建本地仓库列表（读索引 → 本地路径探测 → 标记待 remote live 探测）。 */
function buildLocalList(indexMap, root, deadline) {
  return Object.keys(indexMap).map((name) => {
    const entry = indexMap[name];
    const local = entry.path || join(root, name);
    const exists = existsSync(local);
    const out = {
      name,
      path: exists ? local : '',
      exists,
      hasRemote: !!entry.repoUrl,
      remote: entry.repoUrl || '',
      indexed: entry,
      visibility: entry.visibility || '未知',
      defaultBranch: entry.defaultBranch || '',
      cloudPushedAt: entry.pushedAt || '',
      cloudOnly: !!entry.cloudOnly,
      branch: '', ahead: null, behind: null, changed: 0, lastCommit: '',
    };
    if (exists) {
      try {
        const repoState = describeRepo(local);
        out.branch = repoState.branch || '';
        out.changed = repoState.changed || 0;
        out.lastCommit = repoState.lastCommit || '';
        out.localHead = repoState.lastCommit || '';
        out.__needLive = Date.now() < deadline;
        const lc = runGit(['log', '-1', '--format=%cI'], { cwd: local });
        out.localHeadAt = lc.ok ? (lc.stdout || '').trim() : '';
      } catch { /* 非 git 目录 */ }
    }
    return out;
  });
}

/** 并发 live 探测远端（预算内限流），把 ahead/behind/remoteHead 合并回 list。 */
async function applyLiveRemote(list, deadline) {
  const toProbe = list.filter((r) => r.__needLive && r.path && r.branch);
  if (!toProbe.length) {
    for (const r of list) {
      delete r.__needLive;
      if (r.hasRemote && r.path) {
        r.ahead = null; r.behind = null; r.remoteHead = ''; r.remoteHeadAt = '';
        r.synced = false; r.liveSkipped = true;
      }
    }
    return list;
  }
  const results = new Map();
  let cursor = 0;
  const probeStart = Date.now();
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, toProbe.length) }, async () => {
    while (cursor < toProbe.length) {
      const repoProbe = toProbe[cursor]; cursor += 1;
      if (Date.now() > probeStart + deadline) { results.set(repoProbe.name, { live: { ok: false, sha: '' }, elapsed: -1 }); continue; }
      const t0 = Date.now();
      let live = { ok: false, sha: '' };
      try { live = await liveRemoteHeadAsync({ repoPath: repoProbe.path, branch: repoProbe.branch || '' }); } catch { /* 忽略 */ }
      results.set(repoProbe.name, { live, elapsed: Date.now() - t0 });
    }
  });
  await Promise.all(workers);
  for (const r of list) {
    delete r.__needLive;
    if (!r.path) continue;
    const hit = results.get(r.name);
    if (!hit) { if (!r.hasRemote) { /* 无远端 */ } continue; }
    const { live } = hit;
    if (live.ok && live.sha) {
      r.remoteHead = live.sha.slice(0, 7);
      const rc = runGit(['rev-list', '--left-right', '--count', `HEAD...${live.sha}`], { cwd: r.path });
      if (rc.ok) {
        const parts = (rc.stdout || '').trim().split(/\s+/).map(Number);
        r.ahead = Number(parts[0]) || 0;
        r.behind = Number(parts[1]) || 0;
      } else {
        r.ahead = null; r.behind = null; r.remoteHead = '';
      }
      const lt = runGit(['log', '-1', '--format=%cI', live.sha], { cwd: r.path });
      r.remoteHeadAt = lt.ok ? (lt.stdout || '').trim() : '';
      r.synced = r.ahead === 0 && r.behind === 0;
    } else {
      r.ahead = null; r.behind = null; r.remoteHead = ''; r.remoteHeadAt = '';
      r.synced = false; r.liveSkipped = true;
    }
  }
  return list;
}

/** GET/POST /api/git-push/repos-local —— 本地仓库列表（读索引 + live 并发探测远端）。 */
export async function handleReposLocal(ctx) {
  const { query, env, cfg } = ctx;
  const rebuild = query.rebuild === '1' || query.rebuild === 'true';
  const path = String(query.path || '').trim() || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
  const acct = readAccountStatus({ workspaceRoot: env.workspaceRoot });
  const owner = (acct && acct.username) || '';
  let rebuildIndexUpdated = false;
  if (rebuild) {
    const r = await updateRepoIndex({ workspaceRoot: path, token: '', owner: owner || 'EIGHTfs', extraRepos: env.extraRepos, extraReposFile: env.extraReposFile, offline: true, mode: 'rebuild' });
    if (!r.ok) return { status: 500, body: { ok: false, error: '索引重建失败: ' + (r.error || '') } };
    rebuildIndexUpdated = r.indexUpdated === true;
  }
  const indexMap = readRepoIndexMap(env.workspaceRoot);
  let list = [];
  if (indexMap) {
    const deadline = Date.now() + LIST_LIVE_BUDGET_MS;
    list = buildLocalList(indexMap, path, deadline);
    await applyLiveRemote(list, deadline);
    if (owner) list = list.filter((r) => (r.indexed?.owner === owner) || !r.indexed?.owner);
  }
  return { status: 200, body: { ok: true, root: path, count: list.length, repos: list, owner: owner || null, indexedAvailable: !!indexMap, indexUpdated: rebuildIndexUpdated === true } };
}

export function handleReposLocalScan(ctx) {
  const { body, env, cfg } = ctx;
  const acct = readAccountStatus({ workspaceRoot: env.workspaceRoot });
  const scanOwner = (acct && acct.username) || 'EIGHTfs';
  const scanRoot = String((body && body.path) || '').trim() || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
  const r = runScan({ root: scanRoot, owner: scanOwner, workspaceRoot: env.workspaceRoot });
  if (r.ok === false) return { status: 500, body: { ok: false, error: r.error || '扫描启动失败' } };
  if (r.alreadyRunning) return { status: 200, body: { ok: false, running: true, error: '扫描进行中，不能重复扫描' } };
  return { status: 200, body: { ok: true, started: true, scanId: r.scanId, running: true } };
}

/** GET|POST /api/git-push/repos-local-scan-wait —— 挂起等待新仓库 diff。 */
export async function handleReposLocalScanWait(ctx) {
  const { query, body, env } = ctx;
  const from = Number((query && query.from) || (body && body.from) || 0);
  const scanDelta = await waitScanDelta({ from, timeoutMs: SCAN_WAIT_TIMEOUT_MS, workspaceRoot: env.workspaceRoot });
  return { status: 200, body: { ok: true, newest: scanDelta.newest, version: scanDelta.version, done: scanDelta.done, running: scanDelta.running, timeout: scanDelta.timeout } };
}

/** POST /api/git-push/repos-local-refresh —— 对 liveSkipped 仓库串行补查远端状态。 */
export async function handleReposLocalRefresh(ctx) {
  const { body, env } = ctx;
  const targets = Array.isArray((body && body.repos)) ? body.repos : [];
  const refreshed = [];
  for (const t of targets) {
    const name = String(t && t.name || '').trim();
    const repoPath = String(t && t.path || '').trim();
    if (!name) continue;
    try {
      const branch = String(t && t.branch || '') || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout.trim();
      const live = await liveRemoteHead({ repoPath, branch });
      let state = { remoteHead: '', ahead: null, behind: null, remoteHeadAt: '', synced: false };
      if (live.ok && live.sha) {
        state.remoteHead = live.sha.slice(0, 7);
        state.remoteKnown = true;
        const rc = runGit(['rev-list', '--left-right', '--count', `HEAD...${live.sha}`], { cwd: repoPath });
        if (rc.ok) {
          const parts = (rc.stdout || '').trim().split(/\s+/).map(Number);
          state.ahead = Number(parts[0]) || 0;
          state.behind = Number(parts[1]) || 0;
          state.compareOk = true;
        } else {
          state.compareOk = false;
          state.compareHint = '本地缺少远端提交对象，执行 git fetch 后即可比较领先/落后';
        }
        const lt = runGit(['log', '-1', '--format=%cI', live.sha], { cwd: repoPath });
        state.remoteHeadAt = lt.ok ? (lt.stdout || '').trim() : '';
        state.synced = state.ahead === 0 && state.behind === 0;
      } else {
        state.remoteKnown = false;
        state.compareOk = false;
        state.error = live.error || '远端不可达';
      }
      const up = updateRepoIndex({ workspaceRoot: env.workspaceRoot, repoName: name, remoteState: state, mode: 'single' });
      refreshed.push({ name, ok: true, remoteState: state, indexUpdated: up.ok, error: up.error });
    } catch (e) {
      refreshed.push({ name, ok: false, error: String(e?.message || e) });
    }
  }
  return { status: 200, body: { ok: true, count: refreshed.length, refreshed } };
}

/** GET /api/git-push/repos-cloud —— 云端仓库列表 + 本地存在标记 + 索引合并。 */
export async function handleReposCloud(ctx) {
  const { env, cfg } = ctx;
  const r = await listCloudRepos({ token: resolveToken({ workspaceRoot: env.workspaceRoot }).token });
  let indexUpdated = 0;
  if (r && r.ok && Array.isArray(r.repos)) {
    const indexMap = readRepoIndexMap(env.workspaceRoot);
    const root = getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
    await Promise.all(r.repos.map(async (repo) => {
      const repoName = String(repo.name || '').trim();
      let local = indexMap && indexMap[repoName] ? (indexMap[repoName].path || '') : '';
      if (!local && repoName) local = join(root, repoName);
      let localExists = false;
      if (local) {
        try { await access(local); localExists = true; } catch { localExists = false; }
      }
      repo.localExists = localExists;
      repo.localPath = localExists ? local : '';
    }));
    const acct = readAccountStatus({ workspaceRoot: env.workspaceRoot });
    const cloudOwner = (acct && acct.username) || String(r.repos[0]?.fullName || '').split('/')[0] || 'EIGHTfs';
    const merged = await updateRepoIndex({ workspaceRoot: env.workspaceRoot, owner: cloudOwner, cloudRepos: r.repos, mode: 'merge-cloud' });
    if (merged.ok) indexUpdated = merged.updated || 0;
  }
  return { status: 200, body: { ...r, indexUpdated } };
}