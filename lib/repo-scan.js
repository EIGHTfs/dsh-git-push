// dsh-git-push v1.42.0 — 仓库扫描 / 状态读取 / diff / package.json 版本（自 core.js 按功能拆分，行为零变化）

import { runGit } from './git-core.js';
import { maskRemoteUrl } from './token-credentials.js';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export function readPkgVersion(repoPath) {
  try {
    const pkgPath = join(repoPath, 'package.json');
    if (!existsSync(pkgPath)) return '';
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return String(pkg.version || '').trim();
  } catch { return ''; }
}

/**
 * 自动打 tag（v1.16.0）：dsh- 前缀项目推送成功后自动打 v<version> tag，便于官方发现。
 * 版本号取 package.json version（readPkgVersion）；仓库名/目录名以 dsh- 开头才打。
 * 用 GitHub Git Data API 建 refs/tags/v<version>（指向 API 侧 commitSha，本地 sha 在 API 通道下与远端不一致）。
 * 已存在同 tag → 跳过（幂等）。
 * @returns {Promise<{ok:boolean, tag?:string, skipped?:string, reason?:string, error?:string}>}
 */

export function findGitDirs(root, depth = 3) {
  let out = '';
  try {
    const r = spawnSync('find', [String(root), '-maxdepth', String(Number(depth) || 3), '-name', '.git', '-type', 'd'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    out = r.stdout || '';
  } catch { /* find 无匹配/不可用返回空 */ }
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
  // v1.40.0：origin 内嵌凭据（https://user:token@...）一律脱敏后再出仓，防 token 进会话/日志
  const remote = maskRemoteUrl(runGit(['remote', 'get-url', 'origin'], repoPath).stdout || '');
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
 * 读取 extraRepos 配置文件（文本文件，每行一个仓库绝对路径，`#` 开头为注释，空行跳过）。
 * 运行时实时读取，修改文件后下次调用即时生效，无需重启。
 * 返回解析后的绝对路径数组（文件不存在/不可读返回空数组）。
 */

export function readExtraReposFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return [];
  try {
    const text = readFileSync(filePath, 'utf8');
    return text.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((p) => resolve(p));
  } catch {
    return [];
  }
}

/**
 * 扫描 root 下所有 git 仓库（按仓库名去重，同名只保留第一个——extracted 副本与顶层同名靠此去重）
 * extraRepos：硬编码补充（find 范围之外的仓库，如 CIFS 只读卷）
 * extraReposFile：配置文件路径（运行时实时读取），与 extraRepos 合并去重
 */

export function scanRepos({ root, depth = 3, extraRepos = [], extraReposFile = '' } = {}) {
  const found = findGitDirs(root, depth);
  const extra = [...extraRepos.map((p) => resolve(p)), ...readExtraReposFile(extraReposFile)];
  const repos = [];
  const seen = new Set();
  for (const repoPath of [...found, ...extra]) {
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
    // v1.40.0：untracked 跳过二进制/大文件（isBinaryOrLarge 原本只服务于 tracked diff 路径）
    if (isBinaryOrLarge(join(repoPath, p))) continue;
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
