/**
 * Git 执行层 · 仓库扫描与展示
 *
 * 职责：扫描工作区的 git 仓库、汇总状态（分支/远端/未提交/活动时间）、
 *   远端 URL 脱敏（maskRemoteUrl 去掉内嵌凭据）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { runGit, runGitAsync } from './exec.js';

/* ───────── 仓库扫描常量 ───────── */
const LS_IGNORED_TIMEOUT_MS = 15_000; // git ls-files --ignored 超时
// 扫描下钻深度默认值：与 lib/plugin/auto-push.js 共用同一来源（lib/audit-defaults.js）
import { DEFAULT_SCAN_DEPTH } from '../audit-defaults.js';

/**
 * 扫描目录下的 git 仓库（1.0.0 接线：git_scan 工具用）。
 * 逐层下钻查找 .git；返回分支/remote/未提交变更数/最近提交。
 * @param {string} root 扫描根目录
 * @param {object} [opts] { depth=20, extraRepos=[], extraReposFile='', maxRepos=200 }
 * 遍历**所有** .git 文件夹——发现 .git 后继续下钻（仓库内嵌套的
 *   submodule/worktree/子仓库也列出），depth 默认提到 20（防爆靠 maxRepos + 排除
 *   node_modules/隐藏目录/.git 自身；Dirent.isDirectory 不跟随符号链接，无环）。
 *   extraReposFile：额外仓库清单文件（每行一个绝对路径，# 开头为注释，运行时实时读取；
 *   文件缺失/不可读静默忽略——不因配置缺失让扫描失败）
 * @returns {Array<object>} 仓库信息列表
 */
export function scanRepos(root = '.', opts = {}) {
  return collectRepoPaths(root, opts).map((p) => describeRepo(p));
}

/**
 * 并发版仓库扫描：与 `scanRepos` **同一 walk、同一字段口径**，只把「逐仓 describe」改成有界并发。
 *
 * 为什么：`describeRepo` 每仓要起 6 次 git 子进程（实测单次约 8ms）；27 仓串行 **2718ms**。
 *   这些都是**只读**命令（rev-parse/remote/status/log/rev-list），并发安全；
 *   有界并发避免把 NAS 打满（低负载纪律）。
 * 并发数：opts.concurrency → 环境变量 DSH_GIT_PUSH_SCAN_CONCURRENCY → 默认 8（不硬编码）。
 * 输出顺序与 `scanRepos` 完全一致（Promise.all 保持下标）。
 * @returns {Promise<Array<object>>}
 */
export async function scanReposAsync(root = '.', opts = {}) {
  const paths = collectRepoPaths(root, opts);
  const limit = Math.max(1, Number(opts.concurrency ?? process.env.DSH_GIT_PUSH_SCAN_CONCURRENCY ?? 8) || 8);
  return mapLimit(paths, limit, (p) => describeRepoAsync(p));
}

/** 有界并发 map（保持输出顺序；**只读任务专用**，写任务禁止并发）。 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 收集仓库根路径（**与描述解耦**）：先走目录树拿路径，再由调用方决定同步或并发去描述。
 * 这样「同步扫描」与「并发扫描」共用同一套遍历 + 忽略清单 + extras 逻辑，不会出现两套口径。
 * @returns {string[]} 仓库绝对路径（顺序 = 遍历顺序 + extras 追加顺序）
 */
export function collectRepoPaths(root = '.', { depth = DEFAULT_SCAN_DEPTH, extraRepos = [], extraReposFile = '', maxRepos = 200 } = {}) {
  const out = [];
  const seen = new Set();
  // 修复：扫描**尊重 .gitignore**——被 git 忽略的目录（如 NAS 仓的 src/、assets/、
  //   build/master-build/ 官方源码/产物）不再被当独立仓库登记。
  //   实现：每进入一个仓库根（含 .git 的目录）时，用**一次** `git ls-files --others --ignored
  //   --exclude-standard --directory` 拿到该仓库下所有「被忽略的目录」集合，walk 时整棵跳过
  //   ——单次 git 调用、无逐目录 spawn，性能可控。
  const ignoredCache = new Map(); // repoRoot → Set(绝对路径，被忽略的目录)
  const loadIgnoredDirs = (repoRoot) => {
    if (ignoredCache.has(repoRoot)) return ignoredCache.get(repoRoot);
    const set = new Set();
    try {
      const r = runGit(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], { cwd: repoRoot, timeoutMs: LS_IGNORED_TIMEOUT_MS });
      if (r.ok) {
        for (const line of (r.stdout || '').split('\n')) {
          const t = line.trim().replace(/\/+$/, '');
          if (t) set.add(join(repoRoot, t));
        }
      }
    } catch { /* 取不到忽略清单则不跳过（保守） */ }
    ignoredCache.set(repoRoot, set);
    return set;
  };
  // 判断某绝对路径是否落在任一「被忽略目录」之下（含自身）
  const isIgnored = (abs) => {
    for (const [, set] of ignoredCache) {
      if (set.has(abs)) return true;
      for (const ig of set) {
        if (abs.startsWith(ig + '/')) return true;
      }
    }
    return false;
  };
  const walk = (dir, level) => {
    if (out.length >= maxRepos || level > depth) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === '.git')) {
      if (!seen.has(dir)) { seen.add(dir); out.push(dir); }
      loadIgnoredDirs(dir); // 该仓库的忽略清单（整仓一次）
      // 记录后继续下钻：遍历所有 .git 文件夹（子文件夹/仓库内嵌套仓库都算）
    }
    for (const e of entries) {
      // 跳过 node_modules / 隐藏目录（含 .git 自身）
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const child = join(dir, e.name);
      // 被 git 忽略的目录整棵跳过（不入仓列表）
      if (isIgnored(child)) continue;
      walk(child, level + 1);
    }
  };
  walk(String(root || '.'), 0);
  // 清单文件追加（# 注释 / 空行跳过；读不到就忽略）
  const extras = [...(extraRepos || [])];
  if (extraReposFile) {
    try {
      for (const line of readFileSync(extraReposFile, 'utf8').split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#')) extras.push(t);
      }
    } catch { /* 清单文件缺失/不可读：忽略 */ }
  }
  for (const extra of extras) {
    const extraPath = String(extra || '').trim();
    if (!extraPath || seen.has(extraPath) || !existsSync(extraPath)) continue; // dsh-skip-residue（extraRepos 清单条数少）
    seen.add(extraPath);
    out.push(extraPath);
  }
  return out;
}

/**
 * 脱敏 remote URL：userinfo 内嵌凭据（https://user:token@...）→ user:****@；
 * query 参数 token/access_token/private_token=xxx → ****。防 token 进会话/日志/HTTP 输出。
 */
export function maskRemoteUrl(url = '') {
  const s = String(url || '');
  if (!s) return '';
  const masked = s.replace(/^(https?:\/\/)([^/@\s]*)@/i, (m, proto, userinfo) => {
    if (!userinfo) return m;
    const i = userinfo.indexOf(':');
    return i >= 0 ? `${proto}${userinfo.slice(0, i)}:****@` : `${proto}****@`;
  });
  return masked.replace(/([?&](?:token|access_token|private_token)=)[^&\s]+/gi, '$1****');
}

/**
 * 解析仓库摘要（**纯函数**，同步/并发两条取数路径共用同一套字段与判定口径）。
 *
 * 为什么抽出来：`describeRepo`（同步）与 `describeRepoAsync`（并发）必须给出**完全相同**的字段；
 *   历史教训是"两处各写一份解析"必然漂移。取数方式不同，判定与字段一律走这里。
 * @param {string} repoPath 仓库绝对路径
 * @param {{branch:string,remote:string,status:string,last:string,upOk:boolean,upOut:string,rcOk:boolean,rcOut:string}} raw
 */
function parseRepoInfo(repoPath, raw) {
  const branch = String(raw.branch || '').trim() || '(空仓)';
  const remote = maskRemoteUrl(String(raw.remote || '').trim());
  const status = String(raw.status || '');
  const changed = status ? status.split('\n').filter(Boolean).length : 0;
  const last = String(raw.last || '').trim();
  const hasRemote = !!remote;
  let upstream = '';
  if (raw.upOk && String(raw.upOut || '').trim()) upstream = String(raw.upOut).trim();
  let ahead = null, behind = null;
  // 无 @{u} 但有远端（本地 init/未 -u 常见）时，用 origin/<当前分支> 做比较
  //   基准——账号卡片仍能显示「领先/落后」、手动 push 可用；远端无同名分支（无法比较）
  //   时 ahead/behind 保持 null（前端显示「未跟踪上游」）。
  const base = upstream || (hasRemote && branch && !branch.startsWith('(') ? `origin/${branch}` : '');
  if (base && raw.rcOk) {
    const parts = String(raw.rcOut || '').trim().split(/\s+/).map(Number);
    ahead = Number(parts[0]) || 0;
    behind = Number(parts[1]) || 0;
  }
  return { name: basename(repoPath), path: repoPath, branch, remote, changed, lastCommit: last, hasRemote, upstream, ahead, behind };
}

/** 读取单个仓库的状态摘要（git_scan 输出项）。remote 一律脱敏防 token 泄漏。
 * 扩展 ahead/behind/hasRemote/upstream：账号卡片「本地仓库领先 → 手动 push」
 *   需要区分「领先/落后/同步/未跟踪上游」；ahead/behind 为 null = 无法判定（无上游）。
 */
export function describeRepo(repoPath = '') {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath }).stdout;
  const remote = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout;
  const status = runGit(['status', '--porcelain'], { cwd: repoPath }).stdout;
  const last = runGit(['log', '-1', '--format=%h %s'], { cwd: repoPath }).stdout;
  const up = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: repoPath });
  const upOk = up.status === 0;
  const upOut = up.stdout;
  // base 判定与 parseRepoInfo 保持一致（只读一次），决定是否再取 rev-list
  const probe = parseRepoInfo(repoPath, { branch, remote, status, last, upOk, upOut, rcOk: false, rcOut: '' });
  let rcOk = false, rcOut = '';
  const base = probe.upstream || (probe.hasRemote && probe.branch && !probe.branch.startsWith('(') ? `origin/${probe.branch}` : '');
  if (base) {
    const rc = runGit(['rev-list', '--left-right', '--count', `HEAD...${base}`], { cwd: repoPath });
    rcOk = !!rc.ok; rcOut = rc.stdout;
  }
  return parseRepoInfo(repoPath, { branch, remote, status, last, upOk, upOut, rcOk, rcOut });
}

/**
 * 并发版仓库摘要：与 `describeRepo` **同字段同判定**，只是用异步 git（`runGitAsync`）取数。
 *
 * 为什么需要：`runGit` 走 execFileSync，**在 Promise 里调用并不会真正并行**（一个 worker 独占事件循环
 *   直到子进程结束）。实测 27 仓串行 2718ms；改用异步取数后各仓的子进程才能真正并行等待。
 * 只读命令，故可安全并发（写操作禁止并发）。
 */
export async function describeRepoAsync(repoPath = '') {
  const [branch, remote, status, last, up] = await Promise.all([
    runGitAsync(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath }),
    runGitAsync(['remote', 'get-url', 'origin'], { cwd: repoPath }),
    runGitAsync(['status', '--porcelain'], { cwd: repoPath }),
    runGitAsync(['log', '-1', '--format=%h %s'], { cwd: repoPath }),
    runGitAsync(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: repoPath }),
  ]);
  const raw = {
    branch: branch.stdout, remote: remote.stdout, status: status.stdout, last: last.stdout,
    upOk: up.status === 0, upOut: up.stdout, rcOk: false, rcOut: '',
  };
  const probe = parseRepoInfo(repoPath, raw);
  const base = probe.upstream || (probe.hasRemote && probe.branch && !probe.branch.startsWith('(') ? `origin/${probe.branch}` : '');
  if (base) {
    const rc = await runGitAsync(['rev-list', '--left-right', '--count', `HEAD...${base}`], { cwd: repoPath });
    raw.rcOk = !!rc.ok; raw.rcOut = rc.stdout;
  }
  return parseRepoInfo(repoPath, raw);
}
