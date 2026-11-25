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
import { LIST_LIVE_BUDGET_MS, LIST_LIVE_TTL_MS, PROBE_CONCURRENCY, SCAN_WAIT_TIMEOUT_MS } from './http-constants.js';

/** GET/POST /api/git-push/repos-local —— 本地仓库列表（读索引 + live 并发探测远端）。 */
/** 构建本地仓库列表（读索引 → 本地路径探测 → 标记待 remote live 探测）。 */
function buildLocalList(indexMap, root, deadline, options) {
  // probeLocal=false ⇒ **不 spawn 任何 git**，本地状态取索引里上次扫描/补查记下的快照。
  //   为什么必须能关：这里每仓要跑 describeRepo + git log（4 次同步 spawn），
  //   27 仓在 CIFS 上实测 ≈100s —— 放进 HTTP 请求就等于"打开列表必超时"。
  const probeLocal = !(options && options.probeLocal === false);
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
    // 索引里上次记下的本地状态（扫描/后台补查写入）：请求路径直接用它，零 spawn
    const cachedLocal = (entry.localState && typeof entry.localState === 'object') ? entry.localState : null;
    if (cachedLocal) {
      out.branch = cachedLocal.branch || '';
      out.changed = Number(cachedLocal.changed) || 0;
      out.lastCommit = cachedLocal.lastCommit || '';
      out.localHead = cachedLocal.localHead || cachedLocal.lastCommit || '';
      out.localHeadAt = cachedLocal.localHeadAt || '';
    }
    if (exists && probeLocal) {
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

/**
 * 远端探测是否已超预算。
 *
 * `deadline` 是**绝对时间戳**（调用方算 Date.now() + 预算），所以直接与 now 比。
 * 历史缺陷：判据写成 `now > probeStart + deadline`——deadline 已是绝对时刻，
 * 再加一次起点等于把上限推到几十天后，判据恒为 false，预算彻底失效；
 * 结果所有仓库都要串完 SSH 探测，前端 30s 超时因此频繁触发（界面报 signal timed out）。
 * 抽成独立函数是为了能被测试直接断言（行为可测，而不是只比对源码文本）。
 */
export function isProbeOverBudget(deadline, now = Date.now()) {
  return Number.isFinite(deadline) && now > deadline;
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
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, toProbe.length) }, async () => {
    while (cursor < toProbe.length) {
      const repoProbe = toProbe[cursor]; cursor += 1;
      // 超预算 ⇒ 该仓库标 liveSkipped（本轮不探远端状态），由下一次刷新补上
      if (isProbeOverBudget(deadline)) {
        results.set(repoProbe.name, { live: { ok: false, sha: '' }, elapsed: -1 });
        continue;
      }
      const t0 = Date.now();
      let live = { ok: false, sha: '' };
      // 把**剩余预算**传进单次探测：它内部会摊到每步 git 调用上。
      //   只靠上面的 isProbeOverBudget 不够——那只在「调用前」检查，
      //   单次探测里若有一步不带超时的 git 调用，整个请求仍会穿透整表预算
      //   （实测：DSH 启动后首开「本地」页 → 前端 30s fetch 超时 → signal timed out）。
      const remainBudget = Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0;
      try {
        live = await liveRemoteHeadAsync({
          repoPath: repoProbe.path, branch: repoProbe.branch || '', budgetMs: remainBudget,
        });
      } catch { /* 忽略 */ }
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

/**
 * 用索引里**上次补查到的远端状态**填充列表（纯本地计算，不联网）。
 *
 * 为什么要这么做：ahead/behind 只需要一个已知的远端 sha（本地 rev-list 就能算），
 *   不需要再连一次远端。于是"列表请求"的代价 = 读索引 + 每仓一次本地 git，
 *   与仓库数量线性但都是毫秒级；真正的网络探测交给后台。
 *
 * 没补过的仓库保持 liveSkipped=true（= 真未知，前端据此显示"同步中"而不是"0/0"）。
 * @param {Array<object>} list buildLocalList 的输出
 * @returns {{liveAt: string, stale: boolean}} liveAt=最新一次远端状态时间
 */
function mergeCachedRemote(list) {
  let newestAt = 0;
  let unknown = 0;
  for (const row of list) {
    const entry = row.indexed || {};
    if (!row.path || !row.hasRemote) continue;
    if (!entry.remoteHead) { row.liveSkipped = true; unknown += 1; continue; }
    row.remoteHead = entry.remoteHead;
    row.remoteHeadAt = entry.remoteHeadAt || '';
    // ahead/behind 直接用索引里上次比较的结果 —— **不在请求路径 spawn git**
    //   （每个 spawn 在 CIFS 上 ≈1s，27 仓就能把 500ms 目标打成 100s）
    if (entry.ahead === null || entry.ahead === undefined || entry.behind === null || entry.behind === undefined) {
      row.ahead = null; row.behind = null; row.synced = false; row.liveSkipped = true;
    } else {
      row.ahead = Number(entry.ahead) || 0;
      row.behind = Number(entry.behind) || 0;
      row.synced = entry.synced === true;
    }
    const at = Date.parse(entry.remoteHeadAt || '');
    if (Number.isFinite(at) && at > newestAt) newestAt = at;
  }
  const liveAt = newestAt ? new Date(newestAt).toISOString() : '';
  const missingLocal = list.filter((r) => r.path && !r.lastCommit).length;
  const tooOld = !newestAt || (Date.now() - newestAt) > LIST_LIVE_TTL_MS;
  return { liveAt: liveAt, stale: tooOld || unknown > 0 || missingLocal > 0 };
}

/** 同一时刻只跑一个后台补查任务（多开页面/连续刷新不叠加探测）。 */
let liveRefreshRunning = false;

/**
 * 后台补查远端状态（不阻塞请求）：逐仓探测 → 写回索引 → 下次列表请求就带上了。
 *
 * 为什么放后台：27 仓 × SSH 实测 87s，放在请求里必然把前端 30s 超时打爆。
 *   失败不影响列表：列表继续用上一次的状态，只是 stale 保持为真。
 * @param {Array<object>} list 当前列表（只取有 path+hasRemote 的）
 * @param {object} env 运行环境（workspaceRoot 等）
 * @returns {boolean} 是否真的启动了（已有任务在跑 ⇒ false）
 */
function scheduleLiveRefresh(list, env) {
  if (liveRefreshRunning) return false;
  const targets = list
    .filter((r) => r.path && (r.hasRemote || !r.lastCommit))
    .map((r) => ({ name: r.name, path: r.path, branch: r.branch || '' }));
  if (!targets.length) return false;
  liveRefreshRunning = true;
  void (async () => {
    try {
      for (const target of targets) await refreshOneTarget(target, env);
    } catch { /* 后台补查失败不影响列表：下一次请求仍会看到 stale 并重试 */ } finally {
      liveRefreshRunning = false;
    }
  })();
  return true;
}

/** GET/POST /api/git-push/repos-local —— 本地仓库列表（**只读索引快照**；远端状态后台补）。 */
export async function handleReposLocal(ctx) {
  const { query, env, cfg } = ctx;
  const rebuild = query.rebuild === '1' || query.rebuild === 'true';
  const path = String(query.path || '').trim() || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
  const acct = readAccountStatus({ workspaceRoot: env.workspaceRoot });
  const owner = (acct && acct.username) || '';
  let rebuildIndexUpdated = false;
  if (rebuild) {
    const r = await updateRepoIndex({ workspaceRoot: path, token: '', owner: owner || '', extraRepos: env.extraRepos, extraReposFile: env.extraReposFile, offline: true, mode: 'rebuild' });
    if (!r.ok) return { status: 500, body: { ok: false, error: '索引重建失败: ' + (r.error || '') } };
    rebuildIndexUpdated = r.indexUpdated === true;
  }
  const indexMap = readRepoIndexMap(env.workspaceRoot);
  let list = [];
  let liveAt = '';
  let stale = false;
  if (indexMap) {
    if (query.live === '1') {
      // 显式"现在就同步探测"（排障/测试/手动刷新用）：沿用原先的预算内并发探测。
      //   默认路径**不走这里** —— 27 仓实测 87s，放在默认请求里必然把前端超时打爆。
      const deadline = Date.now() + LIST_LIVE_BUDGET_MS;
      list = buildLocalList(indexMap, path, deadline);
      await applyLiveRemote(list, deadline);
      stale = false;
    } else {
      // 默认：只读索引快照（不联网），远端状态用上次补查结果，本地即可算 ahead/behind
      list = buildLocalList(indexMap, path, 0, { probeLocal: false });
      const cached = mergeCachedRemote(list);
      liveAt = cached.liveAt;
      stale = cached.stale;
    }
    if (owner) list = list.filter((r) => (r.indexed?.owner === owner) || !r.indexed?.owner);
    // 远端状态过期/从未补过 ⇒ 交给后台补，请求立刻返回。
    // ⚠️ 必须延到下一个宏任务再启动：补查函数里第一句是**同步** git spawn（runGit 取分支），
    //   直接调会在返回响应前就阻塞住（实测总耗时 3.9s，其中 3.5s 是这句同步 git）。
    if (stale) setTimeout(() => { scheduleLiveRefresh(list, env); }, 0);
  }
  return {
    status: 200,
    body: {
      ok: true,
      root: path,
      count: list.length,
      repos: list,
      owner: owner || null,
      indexedAvailable: !!indexMap,
      indexUpdated: rebuildIndexUpdated === true,
      // 远端状态的可见性交给前端：liveAt=上次同步时间，stale=正在后台补
      liveAt: liveAt,
      stale: stale,
    },
  };
}

export function handleReposLocalScan(ctx) {
  const { body, env, cfg } = ctx;
  const acct = readAccountStatus({ workspaceRoot: env.workspaceRoot });
  const scanOwner = (acct && acct.username) || '';
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

/**
 * 补查单个仓库的远端状态并回写索引 → 返回要并入响应的条目；name 为空时返回 null（跳过）。
 * 抽出以降低 handleReposLocalRefresh 的嵌套深度（原为 for→try→if→if 四层）。
 */
async function refreshOneTarget(t, env) {
  const name = String(t && t.name || '').trim();
  const repoPath = String(t && t.path || '').trim();
  if (!name) return null;
  try {
    const branch = String(t && t.branch || '') || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout.trim();
    const live = await liveRemoteHead({ repoPath, branch });
    const state = { remoteHead: '', ahead: null, behind: null, remoteHeadAt: '', synced: false };
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
    // 顺手把**本地状态**一起记进索引：列表请求随后就能零 spawn 地渲染分支/未提交数/最近提交。
    //   不记的话，请求路径只能每仓 describeRepo + git log（CIFS 上每仓 ≈4 次慢 spawn）。
    const localState = (function () {
      try {
        const rs = describeRepo(repoPath);
        const lc = runGit(['log', '-1', '--format=%cI'], { cwd: repoPath });
        return {
          branch: rs.branch || branch || '',
          changed: Number(rs.changed) || 0,
          lastCommit: rs.lastCommit || '',
          localHead: rs.lastCommit || '',
          localHeadAt: lc.ok ? (lc.stdout || '').trim() : '',
          at: new Date().toISOString(),
        };
      } catch { return null; }
    })();
    const up = updateRepoIndex({ workspaceRoot: env.workspaceRoot, repoName: name, remoteState: state, localState: localState, mode: 'single' });
    return { name, ok: true, remoteState: state, localState: localState, indexUpdated: up.ok, error: up.error };
  } catch (e) {
    return { name, ok: false, error: String(e?.message || e) };
  }
}

/** POST /api/git-push/repos-local-refresh —— 对 liveSkipped 仓库串行补查远端状态。 */
export async function handleReposLocalRefresh(ctx) {
  const { body, env } = ctx;
  const targets = Array.isArray((body && body.repos)) ? body.repos : [];
  const refreshed = [];
  for (const t of targets) {
    const r = await refreshOneTarget(t, env);
    if (r) refreshed.push(r);
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
    const cloudOwner = (acct && acct.username) || String(r.repos[0]?.fullName || '').split('/')[0] || '';
    const merged = await updateRepoIndex({ workspaceRoot: env.workspaceRoot, owner: cloudOwner, cloudRepos: r.repos, mode: 'merge-cloud' });
    if (merged.ok) indexUpdated = merged.updated || 0;
  }
  return { status: 200, body: { ...r, indexUpdated } };
}