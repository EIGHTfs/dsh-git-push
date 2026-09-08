// dsh-git-push v1.42.0 — 版本分组与历史重建（squash/drop/fresh）（自 core.js 按功能拆分，行为零变化）

import { runGit } from './git-core.js';
import { pushViaSsh, parseGithubOwnerRepo, pushViaApi } from './github-api.js';
import { readPkgVersion } from './repo-scan.js';
import { resolveValidGitToken } from './token-credentials.js';
import { join } from 'node:path';

const VERSION_RE = /\bv?(\d+)\.(\d+)\.(\d+)\b/;

/**
 * 从字符串解析版本号三元组 {major, minor, patch}，失败返回 null。
 */

export function parseVersion(str) {
  const m = String(str).match(VERSION_RE);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

function versionToStr(v) { return `${v.major}.${v.minor}.${v.patch}`; }

function cmpVersion(a, b) {
  for (const k of ['major', 'minor', 'patch']) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}

/**
 * 扫描仓库全部提交，按版本号（commit message 中的 X.Y.Z）分组返回。
 * 每组 = 一个版本号 + 其下所有提交（含不含版本号的后续提交直至下个版本号）。
 * 返回 [{ version: {major,minor,patch}, versionStr, label, commits: string[], lastHash, isPatch }]
 */

export function listVersionCommits(repoPath) {
  const log = runGit(['log', '--reverse', '--format=%H|%s'], repoPath);
  if (!log.stdout) return [];
  const groups = [];
  let current = null;
  for (const line of log.stdout.split('\n')) {
    const i = line.indexOf('|');
    if (i < 0) continue;
    const hash = line.slice(0, i);
    const msg = line.slice(i + 1);
    const v = parseVersion(msg);
    if (v) {
      current = { version: v, versionStr: versionToStr(v), hash, label: msg.slice(0, 80), commits: [hash], isPatch: v.patch > 0 };
      groups.push(current);
    } else if (current) {
      current.commits.push(hash);
    } else {
      // 第一个带版本号的提交之前：归入 1.0.0，禁止丢弃
      current = {
        version: { major: 1, minor: 0, patch: 0 },
        versionStr: '1.0.0',
        hash,
        label: '1.0.0 初始提交（标题无版本号的前缀）',
        commits: [hash],
        isPatch: false,
        synthetic: true,
      };
      groups.push(current);
    }
  }
  return groups;
}

/** HEAD / 全历史必须被分组覆盖；最后带 X.Y.Z 的提交后面不能再挂一长串未标号提交。 */

export function rebuildCoverageGuard(repoPath, groups) {
  const allLog = runGit(['log', '--reverse', '--format=%H'], repoPath);
  const all = (allLog.stdout || '').split('\n').filter(Boolean);
  const head = (runGit(['rev-parse', 'HEAD'], repoPath).stdout || '').trim();
  const covered = new Set();
  for (const g of groups) {
    for (const h of g.commits) covered.add(h);
  }
  const missing = all.filter((h) => !covered.has(h));
  const last = groups.length ? groups[groups.length - 1] : null;
  const trailingUnversioned = last ? Math.max(0, last.commits.length - 1) : 0;
  const lastVersionedIsHead = last && last.hash === head;
  return {
    total: all.length,
    covered: covered.size,
    missingCount: missing.length,
    missingHead: !covered.has(head),
    head,
    lastVersion: last ? last.versionStr : null,
    trailingUnversioned,
    lastVersionedIsHead,
  };
}

function refuseSparseVersionScan(repoPath, groups) {
  const cov = rebuildCoverageGuard(repoPath, groups);
  if (cov.missingCount > 0 || cov.missingHead) {
    return {
      ok: false,
      error: `版本扫描会丢掉 ${cov.missingCount} 个提交（HEAD 未覆盖=${cov.missingHead}）。拒绝 squash。`,
      coverage: cov,
    };
  }
  // 标题里最后一个 X.Y.Z 不是 HEAD，且后面还跟了多笔未标号提交 → 会把近期功能并进旧版本
  if (cov.trailingUnversioned >= 5 && !cov.lastVersionedIsHead) {
    return {
      ok: false,
      error: `最后带 X.Y.Z 的提交是 ${cov.lastVersion}，其后还有 ${cov.trailingUnversioned} 个未标版本提交（含 HEAD）。squash 会把近期功能并进 ${cov.lastVersion}。拒绝。请先让 commit 标题与 README 版本表同一号，或改用 fresh。`,
      coverage: cov,
    };
  }
  return null;
}

/** 把补丁版本组 (Z > 0) 并入前一个同 major.minor 的主版本组。返回合并后的主版本组列表。 */

function squashGroups(groups) {
  const result = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.isPatch) continue;
    const merged = { ...g, commits: [...g.commits], mergedFixes: [] };
    let j = i + 1;
    while (j < groups.length && groups[j].isPatch && groups[j].version.major === g.version.major && groups[j].version.minor === g.version.minor) {
      merged.commits.push(...groups[j].commits);
      merged.mergedFixes.push(groups[j].versionStr);
      j++;
    }
    merged.lastHash = merged.commits[merged.commits.length - 1];
    if (merged.mergedFixes.length) merged.label = `${g.versionStr}（含 ${merged.mergedFixes.join('、')} 修复）`;
    result.push(merged);
  }
  return result;
}

/**
 * 预览重建历史的影响（安全，什么都不改）。
 * 返回结构化 preview 给用户确认。
 */

export function previewRebuildHistory({ repoPath, mode, dropFrom, dropTo }) {
  const groups = listVersionCommits(repoPath);
  if (mode === 'fresh') {
    const before = groups.length || Number(runGit(['rev-list', '--count', 'HEAD'], repoPath).stdout || 0);
    return { ok: true, mode, dryRun: true, before, after: 1, plan: '完全重建：当前文件树作为唯一提交，版本号保持 package.json 不变；旧历史只留 backup 标签。force=true 才覆盖远端' };
  }
  if (!groups.length) return { ok: false, error: '无版本提交可操作' };
  const refuse = refuseSparseVersionScan(repoPath, groups);
  if (refuse) return refuse;
  let keepGroups;
  if (mode === 'squash-bugfixes') {
    keepGroups = squashGroups(groups);
  } else if (mode === 'drop-versions') {
    const f = dropFrom ? parseVersion(dropFrom) : null;
    const t = dropTo ? parseVersion(dropTo) : null;
    if (!f && !t) return { ok: false, error: 'drop-versions 模式需指定 dropFrom 或 dropTo 版本号' };
    keepGroups = groups.filter(g => {
      if (f && cmpVersion(g.version, f) < 0) return true;
      if (t && cmpVersion(g.version, t) > 0) return true;
      if (f && t && cmpVersion(g.version, f) >= 0 && cmpVersion(g.version, t) <= 0) return false;
      if (f && !t && cmpVersion(g.version, f) >= 0) return false;
      return true;
    });
  } else {
    return { ok: false, error: `未知模式: ${mode}` };
  }
  const droppedCount = groups.length - keepGroups.length;
  return {
    ok: true, mode, dryRun: true,
    before: groups.length, after: keepGroups.length, dropped: droppedCount,
    keepGroups: keepGroups.map(g => ({ version: g.versionStr, label: g.label, commits: g.commits.length, mergedFixes: g.mergedFixes })),
  };
}

function commitWithIdentity(repoPath, message) {
  return runGit(commitWithIdentityArgs(repoPath, message), repoPath);
}

/** v1.42.0：身份兜底对齐 fresh 分支——仓库未配置 user.name 时用 -c 注入提交身份（squash/drop 分支提交共用）。 */
function commitWithIdentityArgs(repoPath, message) {
  const identity = runGit(['config', 'user.name'], repoPath).stdout
    ? []
    : ['-c', 'user.name=DSH Agent', '-c', 'user.email=agent@dsh.local'];
  return [...identity, 'commit', '-m', message];
}

/** 覆盖远端当前分支（重建历史用）。API force PATCH；失败回退 SSH --force。 */

async function forcePushRebuilt({ repoPath, branch, workspaceRoot = '' }) {
  const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
  const pr = parseGithubOwnerRepo(originUrl);
  if (!originUrl || !pr) return { pushed: false, reason: '无 origin，无法强制推送' };
  const tokenInfo = await resolveValidGitToken({ repoPath, workspaceRoot });
  let apiPushed = null;
  if (tokenInfo.token) {
    try {
      apiPushed = await pushViaApi({ repoPath, branch, token: tokenInfo.token, force: true });
    } catch (e) {
      apiPushed = { ok: false, pushed: false, reason: 'API 强制推送异常: ' + (e?.message || e) };
    }
  } else {
    apiPushed = { ok: false, pushed: false, reason: '无 GitHub token' };
  }
  if (apiPushed?.ok && apiPushed.pushed) {
    return { pushed: true, method: 'api', commitSha: apiPushed.commitSha, pushedTo: `api.github.com/${pr.owner}/${pr.repo}` };
  }
  const apiReason = apiPushed?.reason || 'api.github.com 推送失败';
  const sshPushed = pushViaSsh({ repoPath, branch, owner: pr.owner, repo: pr.repo, force: true });
  if (sshPushed.ok && sshPushed.pushed) {
    return { pushed: true, method: 'ssh', fallbackFrom: 'api', apiReason, pushedTo: `ssh.github.com:443/${pr.owner}/${pr.repo}` };
  }
  return { pushed: false, reason: `API 失败（${apiReason}）；SSH 回退失败（${sshPushed.reason || '未知'}）` };
}

/**
 * 重建 git 历史。模式说明：
 *   squash-bugfixes — 补丁版本 (Z>0) 并入前一个主版本，只保留主版本提交点
 *   drop-versions   — 删除指定版本区间的所有提交 (dropFrom ~ dropTo)
 *   fresh           — 当前文件树作为唯一提交；不改 package.json 版本号
 * 破坏性操作前打 backup-<timestamp> tag。force=true 才覆盖远端（用户已同意 force push）。
 */
/** fresh 模式：当前文件树 orphan 重建为唯一提交（版本号不变），force=true 才覆盖远端。 */

async function rebuildHistoryFresh({ repoPath, mode, dryRun, force, workspaceRoot }) {
  const groups = listVersionCommits(repoPath);
  const before = groups.length || runGit(['rev-list', '--count', 'HEAD'], repoPath).stdout;
  if (dryRun) {
    return { ok: true, mode, dryRun: true, before, after: 1, plan: '完全重建：当前文件树作为唯一提交，版本号保持不变；force=true 才覆盖远端' };
  }
  const backupTag = `backup-${Date.now()}`;
  runGit(['tag', '-f', backupTag], repoPath);
  const branch = runGit(['branch', '--show-current'], repoPath).stdout || 'master';
  const pkgVer = readPkgVersion(repoPath) || 'unknown';
  // orphan：保留 remote / backup tag，不 git rm .git（那只会从索引删路径，删不掉目录）。
  runGit(['add', '-A'], repoPath);
  const orphan = runGit(['checkout', '--orphan', 'rebuild-fresh'], repoPath);
  if (orphan.status !== 0) return { ok: false, error: `orphan 失败: ${orphan.stderr}` };
  runGit(['add', '-A'], repoPath);
  const c = commitWithIdentity(repoPath, `feat: v${pkgVer} 重建历史（覆盖旧提交）`);
  if (c.status !== 0) return { ok: false, error: `提交失败: ${c.stderr}` };
  runGit(['branch', '-M', 'rebuild-fresh', branch], repoPath);
  const result = { ok: true, mode, before, after: 1, backupTag, branch, repo: repoPath, version: pkgVer, force: !!force };
  if (force) result.push = await forcePushRebuilt({ repoPath, branch, workspaceRoot });
  else result.push = { pushed: false, reason: 'force=false，只改本地；覆盖远端需 force=true' };
  return result;
}

/** squash-bugfixes / drop-versions 共用：计算保留的版本组；拦截（无组/未知模式/全被过滤）时返回 { ret }。 */

function rebuildHistoryKeepGroups({ repoPath, mode, dropFrom, dropTo, groups }) {
  if (!groups.length) return { ret: { ok: false, error: '无版本提交可操作' } };
  const refuse = refuseSparseVersionScan(repoPath, groups);
  if (refuse) return { ret: refuse };
  let keepGroups;
  if (mode === 'squash-bugfixes') {
    keepGroups = squashGroups(groups);
  } else if (mode === 'drop-versions') {
    const f = dropFrom ? parseVersion(dropFrom) : null;
    const t = dropTo ? parseVersion(dropTo) : null;
    if (!f && !t) return { ret: { ok: false, error: 'drop-versions 模式需指定 dropFrom 或 dropTo' } };
    keepGroups = groups.filter(g => {
      if (f && cmpVersion(g.version, f) < 0) return true;
      if (t && cmpVersion(g.version, t) > 0) return true;
      if (f && t && cmpVersion(g.version, f) >= 0 && cmpVersion(g.version, t) <= 0) return false;
      if (f && !t && cmpVersion(g.version, f) >= 0) return false;
      return true;
    });
  } else {
    return { ret: { ok: false, error: `未知模式: ${mode}` } };
  }
  if (keepGroups.length === 0) return { ret: { ok: false, error: '没有符合条件的版本组保留。请检查版本号或模式' } };
  return { keepGroups };
}

/** squash-bugfixes / drop-versions 模式：按保留版本组 orphan 重建提交序列，force=true 才覆盖远端。 */

async function rebuildHistorySelective({ repoPath, mode, dryRun, dropFrom, dropTo, force, workspaceRoot }) {
  const groups = listVersionCommits(repoPath);
  const kept = rebuildHistoryKeepGroups({ repoPath, mode, dropFrom, dropTo, groups });
  if (kept.ret) return kept.ret;
  const { keepGroups } = kept;

  if (dryRun) {
    return {
      ok: true, mode, dryRun: true,
      before: groups.length, after: keepGroups.length, dropped: groups.length - keepGroups.length,
      keepGroups: keepGroups.map(g => ({ version: g.versionStr, label: g.label, commits: g.commits.length })),
    };
  }

  const backupTag = `backup-${Date.now()}`;
  runGit(['tag', '-f', backupTag], repoPath);
  const branch = runGit(['branch', '--show-current'], repoPath).stdout || 'master';
  runGit(['checkout', '--orphan', 'rebuild-tmp'], repoPath);

  for (const g of keepGroups) {
    const lastHash = g.commits[g.commits.length - 1];
    runGit(['read-tree', lastHash], repoPath);
    // v1.42.0：身份兜底对齐 fresh 分支——仓库未配置 user.name 时用 -c 注入提交身份，避免 commit 失败
    runGit(commitWithIdentityArgs(repoPath, g.label), repoPath);
  }

  runGit(['branch', '-M', 'rebuild-tmp', branch], repoPath);
  const resultVersion = readPkgVersion(repoPath) || '(package.json 不存在)';
  const result = {
    ok: true, mode, before: groups.length, after: keepGroups.length, dropped: groups.length - keepGroups.length,
    backupTag, branch, repo: repoPath, version: resultVersion, force: !!force,
  };
  if (force) result.push = await forcePushRebuilt({ repoPath, branch, workspaceRoot });
  else result.push = { pushed: false, reason: 'force=false，只改本地；覆盖远端需 force=true' };
  return result;
}

export async function rebuildHistory({ repoPath, mode, dryRun = false, dropFrom, dropTo, force = false, workspaceRoot = '' } = {}) {
  if (!repoPath) return { ok: false, error: '缺少 repoPath' };

  if (mode === 'fresh') {
    return await rebuildHistoryFresh({ repoPath, mode, dryRun, force, workspaceRoot });
  }

  // squash-bugfixes / drop-versions
  return await rebuildHistorySelective({ repoPath, mode, dryRun, dropFrom, dropTo, force, workspaceRoot });
}

/* ------------------------------ 规范化 README 生成（v1.8.0 / v1.23.0 模板在 User 仓） ------------------------------ */

/** 插件内置默认骨架：User 仓没有 readme-template.md 时才用。 */
