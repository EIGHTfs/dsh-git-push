/**
 * dsh-git-push 审计总入口：文件收集（gitignore 感知）
 *
 * 修旧项目 P0 教训：git 忽略文件默认排除（listTextFiles 支持 git check-ignore）。
 * - gitIgnoreRoot 为 git 仓库：git check-ignore --stdin 批量判定（Map 缓存）
 * - 非 git 目录：全量收集不报错
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const TEXT_EXT = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'yml', 'yaml', 'md', 'txt', 'html', 'css',
  'sh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'xml', 'toml', 'ini', 'cfg',
  'conf', 'env', 'gitignore', 'npmrc', 'properties', 'sql', 'vue', 'svelte',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.tmp-build', '.tmp-run', 'vendor', 'coverage']);

/** git check-ignore 批量判定缓存（按 repo 根缓存，避免重复 spawn）。 */
const ignoreCache = new Map();

function tryLoadGitIgnoreSet(root) {
  if (ignoreCache.has(root)) return ignoreCache.get(root);
  let set = null;
  try {
    const out = execFileSync('git', ['-C', root, 'check-ignore', '--stdin'], {
      input: '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 10_000,
    });
    set = new Set(); // 空输入无输出
  } catch {
    // git check-ignore 无 --non-matching 时 exit 1 且无输出 → 视为非 git 或收集失败
  }
  ignoreCache.set(root, set);
  return set;
}

/**
 * 递归收集文本文件。
 * @param {string} dir 扫描目录
 * @param {object} opts { depth, gitIgnoreRoot, includeIgnored }
 * @returns {Array<{path, ext, full}>}
 */
export function collectTextFiles(dir, { depth = 10, gitIgnoreRoot = null, includeIgnored = false } = {}) {
  const out = [];
  walk(dir, 0);
  return out;

  function walk(cur, level) {
    if (level > depth) return;
    let entries;
    try { entries = readdirSync(cur); } catch { return; }
    for (const name of entries) {
      const full = join(cur, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(full, level + 1);
        continue;
      }
      if (!st.isFile()) continue;
      const ext = extname(full).replace(/^\./, '');
      const isText = name.endsWith('.gitignore') || name.endsWith('.npmrc') || TEXT_EXT.has(ext);
      if (!isText) continue;
      // gitignore 感知：相对 git 根的路径交给 check-ignore
      if (!includeIgnored && gitIgnoreRoot) {
        const rel = relative(gitIgnoreRoot, full).replace(/\\/g, '/');
        const set = tryLoadGitIgnoreSet(gitIgnoreRoot);
        if (set && set.has(rel)) continue;
      }
      out.push({ path: relative(dir, full).replace(/\\/g, '/'), ext, full });
    }
  }
}

/** 判断目录是否为 git 仓库（有 .git）。 */
export function isGitRepo(dir) {
  return existsSync(join(dir, '.git')) || existsSync(join(dir, '.git', 'HEAD'));
}

/**
 * 收集 git 仓库工作区变动文件（git status --porcelain）。
 * @param {string} repoPath git 仓库目录
 * @returns {Array<{rel, full, status}>|null} 非 git 仓库或 git 失败返回 null（调用方退化为 full）
 * status：A=新增 M=修改 D=删除 R=重命名 ??=未跟踪
 */
export function collectChangedFiles(repoPath) {
  if (!isGitRepo(repoPath)) return null;
  try {
    const out = execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], {
      encoding: 'utf8', timeout: 10_000,
    });
    const files = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2).trim() || 'M';
      let rel = line.slice(3);
      // 引号包裹（含空格/非 ASCII）：取引号内内容（不处理 \ooo 转义，中文文件名原样）
      const quoted = rel.match(/^"((?:[^"\\]|\\.)*)"/);
      if (quoted) rel = quoted[1].replace(/\\([\\"])/g, '$1');
      else if (rel.includes(' -> ')) rel = rel.split(' -> ').pop(); // 重命名取新路径
      if (!rel) continue;
      files.push({ rel, full: join(repoPath, rel), status });
    }
    return files;
  } catch {
    return null; // git 不可用 → 调用方退化为 full
  }
}

/** 读文件（UTF-8，失败返回 null）。 */
export function readText(full) {
  try { return readFileSync(full, 'utf8'); } catch { return null; }
}