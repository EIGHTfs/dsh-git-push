/**
 * dsh-git-push — git 核心逻辑（纯函数，可独立单测，不依赖 ctx）
 *
 * 依赖系统 git：本机 git 缺 remote-https，推送一律走 SSH remote
 * （全局 core.sshCommand 已配 UserKnownHostsFile + IdentityFile）。
 * 关键坑（来自 git-commits-viewer 实测）：
 *   1. 每次命令带 `-c safe.directory=<cwd>`（/vol02 CIFS 只读卷 doubtful ownership）
 *   2. stdio 用 pipe/ignore，防止 git 报错刷屏
 *   3. 本地分支可能是 master 而非 main —— push 前取 branch --show-current，不硬编码
 *   4. push 前 fetch + rev-list 检查 ahead/behind，远端领先时不推
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

/** 执行 git，返回 { status, stdout, stderr } */
export function runGit(args, cwd) {
  const r = spawnSync('git', ['-c', `safe.directory=${cwd}`, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

/** 递归/命令式查找 root 下最多 depth 层的 .git 目录（排除 node_modules、.dsh） */
export function findGitDirs(root, depth = 3) {
  let out = '';
  try {
    out = execSync(`find "${root}" -maxdepth ${depth} -name .git -type d 2>/dev/null`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch { /* find 无匹配返回非零，忽略 */ }
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((d) => resolve(dirnameOf(d)))
    .filter((p) => !/\/node_modules\//.test(p) && !/\/\.dsh\//.test(p));
}

function dirnameOf(gitDirPath) {
  // gitDirPath 形如 /a/b/.git → 仓库根 /a/b
  return gitDirPath.replace(/\/\.git$/, '');
}

/** 读取单仓库状态 */
export function readRepoStatus(repoPath) {
  const branch = runGit(['branch', '--show-current'], repoPath).stdout || '(detached)';
  const remote = runGit(['remote', 'get-url', 'origin'], repoPath).stdout || '';
  const shortId = runGit(['rev-parse', '--short', 'HEAD'], repoPath).stdout || '';
  const porcelain = runGit(['status', '--porcelain'], repoPath).stdout;
  const changes = porcelain ? porcelain.split('\n').filter(Boolean) : [];
  const lastActivity = runGit(['log', '-1', '--format=%aI'], repoPath).stdout || '';
  return {
    branch,
    remote,
    shortId,
    changes: changes.length,
    changeLines: changes.slice(0, 20),
    lastActivity,
  };
}

function isRepoEmpty(repoPath) {
  const count = runGit(['rev-list', '--all', '--count'], repoPath);
  return count.status !== 0 || Number(count.stdout || 0) === 0;
}

/**
 * 扫描 root 下所有 git 仓库（按仓库名去重，同名只保留第一个——extracted 副本与顶层同名靠此去重）
 * extraRepos：硬编码补充（find 范围之外的仓库，如 /vol02 只读卷）
 */
export function scanRepos({ root, depth = 3, extraRepos = [] } = {}) {
  const found = findGitDirs(root, depth);
  const repos = [];
  const seen = new Set();
  for (const repoPath of [...found, ...extraRepos.map((p) => resolve(p))]) {
    const name = basename(repoPath);
    if (seen.has(name)) continue;
    seen.add(name);
    if (!existsSync(join(repoPath, '.git'))) continue;
    if (isRepoEmpty(repoPath)) continue;
    repos.push({ name, path: repoPath, ...readRepoStatus(repoPath) });
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 一键提交推送：
 *   git add -A → 检查变更 → git commit -m message → push 前 fetch + ahead/behind 检查 → push origin <branch>
 * 返回结构化结果；dryRun 只走扫描统计不执行写入。
 */
export function commitAndPush({ repoPath, message, push = true, dryRun = false } = {}) {
  if (!repoPath) return { ok: false, error: '缺少 repoPath' };
  if (!existsSync(join(repoPath, '.git'))) {
    return { ok: false, error: `不是 git 仓库: ${repoPath}` };
  }
  if (!message || !message.trim()) {
    return { ok: false, error: 'commit message 不能为空' };
  }
  const branch = runGit(['branch', '--show-current'], repoPath).stdout || '(detached)';
  if (branch === '(detached)') {
    return { ok: false, error: 'HEAD 处于 detached 状态，请先 checkout 分支' };
  }
  const result = { ok: true, repo: repoPath, branch, dryRun, committed: false, steps: [] };

  // add
  if (!dryRun) {
    const add = runGit(['add', '-A'], repoPath);
    if (add.status !== 0) return { ok: false, step: 'git add', error: add.stderr };
  }
  result.steps.push('add');

  // 变更检查
  const porcelain = dryRun ? '' : runGit(['status', '--porcelain'], repoPath).stdout;
  if (!dryRun && !porcelain.trim()) {
    return { ...result, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } };
  }
  if (dryRun) {
    return { ...result, message: `(dry-run) 将提交: ${message}`, dryRunChanges: porcelain ? porcelain.split('\n').filter(Boolean).length : 0, push: { pushed: false, reason: 'dry-run 不推送' } };
  }

  // commit
  const commit = runGit(['commit', '-m', message], repoPath);
  if (commit.status !== 0) {
    if (/nothing to commit|no changes added/.test(commit.stderr)) {
      return { ...result, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } };
    }
    return { ok: false, step: 'git commit', error: commit.stderr };
  }
  result.committed = true;
  result.commitId = runGit(['rev-parse', '--short', 'HEAD'], repoPath).stdout;
  result.steps.push('commit');

  // push
  result.push = { pushed: false, reason: 'push=false' };
  if (push) {
    runGit(['fetch', 'origin', branch], repoPath); // fetch 失败忽略（首次推送可能无 upstream）
    const rc = runGit(['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`], repoPath);
    const [ahead = 0, behind = 0] = (rc.stdout || '0 0').split(/\s+/).map((x) => Number(x) || 0);
    if (behind > 0) {
      result.push = { pushed: false, reason: `远端领先 ${behind} 个提交，先 pull 同步` };
    } else if (ahead === 0) {
      result.push = { pushed: false, reason: '无新提交可推送' };
    } else {
      const p = runGit(['push', 'origin', branch], repoPath);
      if (p.status !== 0) {
        result.push = { pushed: false, reason: p.stderr };
      } else {
        result.push = { pushed: true, pushedTo: `origin/${branch}`, ahead };
      }
    }
  }
  return result;
}

/** 批量提交推送（多个仓库），单个失败不阻断其余 */
export async function commitMany({ repos, message, push = true, dryRun = false }) {
  const results = [];
  for (const repoPath of repos) {
    results.push({ repo: repoPath, ...commitAndPush({ repoPath, message, push, dryRun }) });
  }
  return results;
}

export { readdirSync };
