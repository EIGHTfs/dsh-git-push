/**
 * dsh-git-push 审计总入口：文件收集（gitignore 感知）
 *
 * 修旧项目 P0 教训：git 忽略文件默认排除（listTextFiles 支持 git check-ignore）。
 * - gitIgnoreRoot 为 git 仓库：git check-ignore --stdin 批量判定（Map 缓存）
 * - 非 git 目录：全量收集不报错
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const TEXT_EXT = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'yml', 'yaml', 'md', 'txt', 'html', 'css',
  'sh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'xml', 'toml', 'ini', 'cfg',
  'conf', 'env', 'gitignore', 'npmrc', 'properties', 'sql', 'vue', 'svelte',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.tmp-build', '.tmp-run', 'vendor', 'coverage']);
/** 单文件大小上限：超过 1MB 的文件跳过（防止读入大文件拖死扫描进程）。 */
const MAX_FILE_SIZE = 1024 * 1024;

/** git 忽略文件集合缓存（按 repo 根缓存：git 目录存忽略集，非 git 目录存 null）。 */
const ignoreCache = new Map();

/**
 * 收集 git 忽略文件相对路径集合（git check-ignore --stdin 批量判定）。
 * 修复 1.0.4 缺陷：原实现以空 stdin 调用 check-ignore，从未传入文件路径 → 忽略集恒空 → gitignore 感知失效
 * （被忽略文件全被扫入，大仓库性能爆炸 + 私密文件误入）。现按旧项目 full-scan.js 正确实现：
 *   1) git rev-parse 探活（非 git 目录返回 null = 不启用忽略判定）
 *   2) 递归收集全部文件相对路径，一次性喂给 check-ignore --stdin（尊重 .gitignore 全部语法含 negation）
 *   3) 输出 = 被忽略的路径集合；按 repo 根缓存，避免递归重复 spawn
 * @param {string} root git 仓库根目录
 * @returns {Set<string>|null} 被忽略路径集合；非 git 目录/失败返回 null
 */
function tryLoadGitIgnoreSet(root) {
  if (ignoreCache.has(root)) return ignoreCache.get(root);
  let result = null;
  try {
    const probe = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
    });
    if (probe.status !== 0 || String(probe.stdout || '').trim() !== 'true') {
      ignoreCache.set(root, null);
      return null;
    }
    // 收集当前目录全部文件相对路径喂给 check-ignore（只做路径判定，不开新进程）
    const all = [];
    const walk = (dir) => {
      let es;
      try { es = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return; }
      for (const en of es) {
        if (en.isDirectory()) {
          if (SKIP_DIRS.has(en.name)) continue;
          walk(join(dir, en.name));
        } else if (en.isFile()) {
          all.push(relative(root, join(root, dir, en.name)).split(sep).join('/'));
        }
      }
    };
    walk('');
    if (!all.length) {
      result = new Set();
    } else {
      const r = spawnSync('git', ['-C', root, 'check-ignore', '--stdin'], {
        input: all.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000,
      });
      // 不带 --non-matching：stdout 只含被忽略的路径；status 0=有忽略 1=无忽略
      result = new Set((r.stdout || '').split('\n').filter(Boolean));
    }
  } catch {
    result = null;
  }
  ignoreCache.set(root, result);
  return result;
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
      // 1MB 上限：超大文件（会话归档/大 JSON/二进制伪装文本）跳过，防读入拖死进程
      if (st.size > MAX_FILE_SIZE) continue;
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
      // 未跟踪目录（?? dir/）：git status --porcelain 只显示目录本身，需展开为目录内文件，
      // 否则审计漏掉整目录（对齐 v1 getDiff 用 git ls-files --others 展开的行为）。
      if (status === '??' && rel.endsWith('/')) {
        const inside = execFileSync('git', ['-C', repoPath, 'ls-files', '--others', '--exclude-standard', '--', rel], {
          encoding: 'utf8', timeout: 10_000,
        });
        for (const p of inside.split('\n').filter(Boolean)) {
          files.push({ rel: p, full: join(repoPath, p), status });
        }
        continue;
      }
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