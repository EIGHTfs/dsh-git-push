/**
 * dsh-git-push — git 核心逻辑（纯函数，可独立单测，不依赖 ctx）
 *
 * 依赖系统 git：认证默认 HTTPS+PAT（2026-08-21 用户确立 token 方案）；
 * remote 格式 https://<user>:<token>@github.com/<owner>/<repo>.git（token 只存
 * 凭据总表/remote 内部，绝不入 md/skill/代码）。SSH remote 仍兼容（备选）。
 * 关键坑（来自 git-commits-viewer 实测）：
 *   1. 每次命令带 `-c safe.directory=<cwd>`（/vol02 CIFS 只读卷 doubtful ownership）
 *   2. stdio 用 pipe/ignore，防止 git 报错刷屏
 *   3. 本地分支可能是 master 而非 main —— push 前取 branch --show-current，不硬编码
 *   4. push 前 fetch + rev-list 检查 ahead/behind，远端领先时不推
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * 测试环境判定（2026-08-20 用户约定：测试环境禁止 git 提交，走任务清单交接主环境提交）。
 * 与 dsh-git-rescue lib/test-home.js 同规则：DSH_HOME 含 `dsh-test-*` 即测试环境。
 * @param {string|null|undefined} dshHome DSH_HOME 路径；未指定时探测 process.env.DSH_HOME
 * @returns {boolean} true=测试环境（禁止提交）
 */
export function isTestEnvHome(dshHome) {
  const home = dshHome || process.env.DSH_HOME || ''
  if (!home) return false
  const norm = String(home).replace(/\\/g, '/')
  return /(^|\/)dsh-test-(home|rc7|clean)([\/-]|$)/.test(norm)
}

/**
 * 测试环境提交门禁：测试环境禁止 commit/push（用户约定 2026-08-20）。
 * 正确姿势：把改动写进 workspace 任务清单文件（如「任务清单-提交-<日期>.md」），
 * 由主环境（非 dsh-test-* DSH_HOME）的会话执行 git 提交推送。
 * @returns {{blocked:boolean, reason?:string}}
 */
export function checkTestEnvCommitGate() {
  if (!isTestEnvHome()) return { blocked: false }
  return {
    blocked: true,
    reason: '测试环境禁止 git 提交（DSH_HOME 含 dsh-test-*）：请把改动写进 workspace 任务清单文件，交接主环境执行 commit+push',
  }
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
 * 确保仓库 .gitignore 屏蔽 npm 下载产物（2026-08-20 用户需求「上传推送检查屏蔽下载的一堆npm包」）。
 * 幂等：只追加缺失条目，不覆盖已有 .gitignore 内容。
 * 覆盖：node_modules/、常见 lock 文件、npm 缓存/日志。
 */
const NPM_IGNORE_LINES = [
  'node_modules/',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'npm-debug.log*',
  '.npm/',
  '.pnpm-store/',
];
export function ensureNpmIgnored(repoPath) {
  const giPath = join(repoPath, '.gitignore');
  let existing = '';
  if (existsSync(giPath)) {
    try { existing = readFileSync(giPath, 'utf8'); } catch (_) { existing = ''; }
  }
  const missing = NPM_IGNORE_LINES.filter((line) => !new RegExp(`(^|\\n)${escapeRegExp(line)}(\\n|$)`).test(existing));
  if (missing.length === 0) return { ok: true, added: [] };
  const append = (existing.endsWith('\n') ? '' : '\n') + '# npm 下载产物（dsh-git-push 自动追加，2026-08-20）\n' + missing.join('\n') + '\n';
  try {
    writeFileSync(giPath, existing + append, 'utf8');
    return { ok: true, added: missing };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), added: [] };
  }
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 一键提交推送：
 *   ensureNpmIgnored → git add -A → 检查变更 → git commit -m message → push 前 fetch + ahead/behind 检查 → push origin <branch>
 * 返回结构化结果；dryRun 只走扫描统计不执行写入。
 */
export function commitAndPush({ repoPath, message, push = true, dryRun = false } = {}) {
  if (!repoPath) return { ok: false, error: '缺少 repoPath' };
  // 测试环境提交门禁（2026-08-20 用户约定）：测试环境禁止 commit/push，走任务清单交接主环境
  const gate = checkTestEnvCommitGate();
  if (gate.blocked && !dryRun) {
    return { ok: false, blocked: true, error: gate.reason, repo: repoPath };
  }
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

  // 屏蔽 npm 下载产物（2026-08-20）：确保 .gitignore 覆盖 node_modules / lock 文件，防止「一堆 npm 包」进变更
  const ignoreResult = dryRun ? { ok: true, added: [], skipped: 'dry-run' } : ensureNpmIgnored(repoPath);
  if (!ignoreResult.ok) {
    return { ok: false, step: 'ensureNpmIgnored', error: ignoreResult.error, repo: repoPath };
  }
  if (ignoreResult.added?.length) {
    result.steps.push(`npm-ignore(+${ignoreResult.added.length}条)`);
  }

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

  // commit（仓库无局部 user 配置时用通用身份，避免 "Author identity unknown"）
  const identity = runGit(['config', 'user.name'], repoPath).stdout
    ? []
    : ['-c', 'user.name=DSH Agent', '-c', 'user.email=agent@dsh.local'];
  const commit = runGit([...identity, 'commit', '-m', message], repoPath);
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

/* ------------------------------ 审计用 diff 提取（内置自 dsh-code-audit） ------------------------------ */

/**
 * 解析 git diff 文本，返回变更文件列表：
 * [{ path, addedLines: string[], deleted: number, isBinary: boolean }]
 */
export function parseDiff(diffText) {
  const files = [];
  let current = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/diff --git a\/(.*?) b\/(.*)$/);
      const path = m?.[2]?.replace(/\s+$/, '') ?? '';
      if (current) files.push(current);
      current = { path, addedLines: [], deleted: 0, isBinary: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('Binary files ')) { current.isBinary = true; continue; }
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (/^@@ /.test(line)) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.addedLines.push(line.slice(1));
    else if (line.startsWith('-') && !line.startsWith('---')) current.deleted += 1;
  }
  if (current) files.push(current);
  return files.filter((f) => f.path);
}

/** 获取 repo 相对 HEAD 的变更文件（含 untracked 新文件，untracked 合成进 diff 文本）。 */
export function getDiff(repoPath, { unified = 3 } = {}) {
  const r = runGit(['diff', 'HEAD', `--unified=${unified}`, '--no-color'], repoPath);
  if (r.status !== 0) return { ok: false, error: r.stderr || 'git diff 失败' };
  const files = parseDiff(r.stdout);
  const ut = runGit(['ls-files', '--others', '--exclude-standard'], repoPath);
  let synthetic = '';
  for (const p of ut.stdout.split('\n').filter(Boolean)) {
    if (files.some((f) => f.path === p)) continue;
    try {
      const content = readFileSync(join(repoPath, p), 'utf8');
      const lines = content.split('\n');
      files.push({ path: p, addedLines: lines, deleted: 0, isBinary: false });
      synthetic += `diff --git a/${p} b/${p}\nnew file mode 100644\n`;
      for (const line of lines) synthetic += `+${line}\n`;
    } catch { /* 读不到跳过 */ }
  }
  return { ok: true, diff: r.stdout + synthetic, files };
}

/** 判断文件是否二进制/大文件（按扩展名 + 大小）。 */
export function isBinaryOrLarge(filePath, { maxBytes = 1024 * 1024 } = {}) {
  const bigExt = /\.(fpk|zip|tgz|gz|exe|dll|so|dylib|pem|key|p12|bin|class|jar|apk|ipa|crx|ttf|woff2?|mp4|mov|png|jpg|jpeg|webp|gif)$/i;
  if (bigExt.test(filePath)) return true;
  try {
    return statSync(filePath).size > maxBytes;
  } catch {
    return false;
  }
}

export { readdirSync };
