/**
 * Git 执行层 · 仓库扫描与展示
 *
 * 职责：扫描工作区的 git 仓库、汇总状态（分支/远端/未提交/活动时间）、
 *   远端 URL 脱敏（maskRemoteUrl 去掉内嵌凭据）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { runGit } from './exec.js';

/**
 * 扫描目录下的 git 仓库（1.0.0 接线：git_scan 工具用）。
 * 逐层下钻查找 .git；返回分支/remote/未提交变更数/最近提交。
 * @param {string} root 扫描根目录
 * @param {object} [opts] { depth=20, extraRepos=[], extraReposFile='', maxRepos=200 }
 *   2026-09-14：遍历**所有** .git 文件夹——发现 .git 后继续下钻（仓库内嵌套的
 *   submodule/worktree/子仓库也列出），depth 默认提到 20（防爆靠 maxRepos + 排除
 *   node_modules/隐藏目录/.git 自身；Dirent.isDirectory 不跟随符号链接，无环）。
 *   extraReposFile：额外仓库清单文件（每行一个绝对路径，# 开头为注释，运行时实时读取；
 *   文件缺失/不可读静默忽略——不因配置缺失让扫描失败）
 * @returns {Array<object>} 仓库信息列表
 */
export function scanRepos(root = '.', { depth = 20, extraRepos = [], extraReposFile = '', maxRepos = 200 } = {}) {
  const out = [];
  const seen = new Set();
  // 2026-09-16 修复：扫描**尊重 .gitignore**——被 git 忽略的目录（如 NAS 仓的 src/、assets/、
  //   build/master-build/ 官方源码/产物）不再被当独立仓库登记。
  //   实现：每进入一个仓库根（含 .git 的目录）时，用**一次** `git ls-files --others --ignored
  //   --exclude-standard --directory` 拿到该仓库下所有「被忽略的目录」集合，walk 时整棵跳过
  //   ——单次 git 调用、无逐目录 spawn，性能可控。
  const ignoredCache = new Map(); // repoRoot → Set(绝对路径，被忽略的目录)
  const loadIgnoredDirs = (repoRoot) => {
    if (ignoredCache.has(repoRoot)) return ignoredCache.get(repoRoot);
    const set = new Set();
    try {
      const r = runGit(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], { cwd: repoRoot, timeoutMs: 15_000 });
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
      if (!seen.has(dir)) { seen.add(dir); out.push(describeRepo(dir)); }
      loadIgnoredDirs(dir); // 该仓库的忽略清单（整仓一次）
      // 记录后继续下钻：遍历所有 .git 文件夹（子文件夹/仓库内嵌套仓库都算）
    }
    for (const e of entries) {
      // 跳过 node_modules / 隐藏目录（含 .git 自身）
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const child = join(dir, e.name);
      // 2026-09-16：被 git 忽略的目录整棵跳过（不入仓列表）
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
    const d = String(extra || '').trim();
    if (!d || seen.has(d) || !existsSync(d)) continue;
    seen.add(d);
    out.push(describeRepo(d));
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

/** 读取单个仓库的状态摘要（git_scan 输出项）。remote 一律脱敏防 token 泄漏。
 * 2026-09-14 扩展 ahead/behind/hasRemote/upstream：账号卡片「本地仓库领先 → 手动 push」
 *   需要区分「领先/落后/同步/未跟踪上游」；ahead/behind 为 null = 无法判定（无上游）。
 */
export function describeRepo(repoPath = '') {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath }).stdout.trim() || '(空仓)';
  const remote = maskRemoteUrl(runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout.trim());
  const status = runGit(['status', '--porcelain'], { cwd: repoPath }).stdout;
  const changed = status ? status.split('\n').filter(Boolean).length : 0;
  const last = runGit(['log', '-1', '--format=%h %s'], { cwd: repoPath }).stdout.trim();
  const hasRemote = !!remote;
  let upstream = '';
  const up = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: repoPath });
  if (up.status === 0 && up.stdout.trim()) upstream = up.stdout.trim();
  let ahead = null, behind = null;
  // 2026-09-14：无 @{u} 但有远端（本地 init/未 -u 常见）时，用 origin/<当前分支> 做比较
  //   基准——账号卡片仍能显示「领先/落后」、手动 push 可用；远端无同名分支（无法比较）
  //   时 ahead/behind 保持 null（前端显示「未跟踪上游」）。
  const base = upstream || (hasRemote && branch && !branch.startsWith('(') ? `origin/${branch}` : '');
  if (base) {
    const rc = runGit(['rev-list', '--left-right', '--count', `HEAD...${base}`], { cwd: repoPath });
    if (rc.ok) {
      const parts = (rc.stdout || '').trim().split(/\s+/).map(Number);
      ahead = Number(parts[0]) || 0;
      behind = Number(parts[1]) || 0;
    }
  }
  return { name: basename(repoPath), path: repoPath, branch, remote, changed, lastCommit: last, hasRemote, upstream, ahead, behind };
}
