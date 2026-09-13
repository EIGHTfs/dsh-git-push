/**
 * Git 执行层 · .gitignore
 *
 * 职责：产物/依赖忽略兜底（DEFAULT_IGNORE_PATTERNS）与 .gitignore 补齐。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSampleExemptDir } from '../exempt/index.js';
import { scanSensitiveFiles } from './sensitive.js';

/**
 * 基线忽略项（与仓库内容无关，恒定排除）。
 * node_modules 是依赖目录、node_modules.orig 是安装/备份残留副本，
 * 两者都属机器本地产物，不应进入版本库（也避免链接/占位混入插件树）。
 */
export const DEFAULT_IGNORE_PATTERNS = ['node_modules/', 'node_modules.orig/'];

/**
 * 把基线忽略项 + 自定义忽略追加进 .gitignore（幂等：已存在行不重复写）。
 * 敏感文件扫描只报告（files），不写入 .gitignore、不解除跟踪（2026-09-12 用户指令）。
 * @param {string} repoPath 仓库根
 * @param {{customIgnorePatterns?: string|string[]}} [opts]
 *   customIgnorePatterns：逗号/换行分隔的 gitignore pattern 或字符串数组（用户自定义忽略）
 * @returns {{added:number, files:string[], baseline:number, custom:number, tracked:string[], unstaged:string[]}}
 *   added 追加总行数 / files 敏感文件路径（只报告）/ baseline 基线补入数 / custom 自定义补入数 /
 *   tracked 恒空（不再解除跟踪）/ unstaged 恒空
 */
export function ensureGitignore(repoPath, { customIgnorePatterns = '' } = {}) {
  const files = scanSensitiveFiles(repoPath);
  const giPath = join(repoPath, '.gitignore');
  let existing = '';
  try { existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''; } catch { /* 忽略 */ }
  const lines = existing.split('\n').map((l) => l.trim());
  let added = 0;
  let baseline = 0;
  let custom = 0;
  let sampleExempted = 0;
  const additions = [];
  // 1) 基线忽略项（node_modules / node_modules.orig）
  for (const pat of DEFAULT_IGNORE_PATTERNS) {
    const bare = pat.replace(/\/$/, '');
    if (lines.includes(pat) || lines.includes(bare)) continue;
    additions.push(pat);
    baseline++;
    added++;
  }
  // 2) 扫描出的敏感文件（内容级 + 文件名黑名单）——只报告不动作：不动 .gitignore、不解除跟踪
  //（2026-09-12 用户指令：扫描到敏感文件不改动 git 忽略配置，由仓库方自行决定处理）
  for (const h of files) {
    const rel = h.path;
    if (isSampleExemptDir(repoPath, rel)) { sampleExempted++; continue; }
    // 已跟踪不解除、未跟踪不追加——敏感文件照常留在工作区，仅经 files 报告
  }
  // 3) 自定义忽略 pattern（幂等追加）
  const customList = (Array.isArray(customIgnorePatterns) ? customIgnorePatterns : String(customIgnorePatterns || '').split(/[\n,]/))
    .map((s) => s.trim()).filter(Boolean);
  for (const line of customList) {
    if (lines.includes(line)) continue;
    additions.push(line);
    custom++;
    added++;
  }
  if (added) {
    const block = `${existing.endsWith('\n') || !existing ? '' : '\n'}${additions.join('\n')}\n`;
    try { writeFileSync(giPath, existing + block, 'utf8'); } catch { /* 写失败不抛 */ }
  }
  return { added, files: files.map((h) => h.path), baseline, custom, tracked: [], unstaged: [], sampleExempted };
}
