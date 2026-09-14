/**
 * Git 执行层 · 仓库扫描与展示
 *
 * 职责：扫描工作区的 git 仓库、汇总状态（分支/远端/未提交/活动时间）、
 *   远端 URL 脱敏（maskRemoteUrl 去掉内嵌凭据）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './exec.js';

/**
 * 扫描目录下的 git 仓库（1.0.0 接线：git_scan 工具用）。
 * 逐层下钻查找 .git；返回分支/remote/未提交变更数/最近提交。
 * @param {string} root 扫描根目录
 * @param {object} [opts] { depth=3, extraRepos=[], extraReposFile='', maxRepos=200 }
 *   extraReposFile：额外仓库清单文件（每行一个绝对路径，# 开头为注释，运行时实时读取；
 *   文件缺失/不可读静默忽略——不因配置缺失让扫描失败）
 * @returns {Array<object>} 仓库信息列表
 */
export function scanRepos(root = '.', { depth = 3, extraRepos = [], extraReposFile = '', maxRepos = 200 } = {}) {
  const out = [];
  const seen = new Set();
  const walk = (dir, level) => {
    if (out.length >= maxRepos || level > depth) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === '.git')) {
      if (!seen.has(dir)) { seen.add(dir); out.push(describeRepo(dir)); }
      return; // 仓库内不再下钻
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(join(dir, e.name), level + 1);
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
  if (hasRemote && upstream) {
    const rc = runGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`], { cwd: repoPath });
    if (rc.status === 0) {
      const parts = (rc.stdout || '').trim().split(/\s+/).map(Number);
      ahead = Number(parts[0]) || 0;
      behind = Number(parts[1]) || 0;
    }
  }
  return { path: repoPath, branch, remote, changed, lastCommit: last, hasRemote, upstream, ahead, behind };
}
