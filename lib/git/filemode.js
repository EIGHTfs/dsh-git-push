/**
 * Git 执行层 · 权限变动忽略（`core.filemode`）
 *
 * 背景：CIFS/SMB 与部分容器卷会把**新建文件**的权限写成 755/777，而仓库里记录的是 644。
 *   于是 git 认为「每个新文件都被改过」，`git status` 永远一片红——但**内容一个字节都没变**。
 *   正确解法是让 git 不比权限位：`core.filemode=false`。
 *
 * 本模块把这个动作做成可调用的能力（工具 / CLI），并处理一个现实坑：
 *   在 CIFS 上 `git config --local` 会先创建 `.git/config.lock` 再 chmod，**chmod 会 EPERM 失败**
 *   ⇒ 配置根本没写进去。所以写失败时退回**直接改写 `.git/config` 文本**，写完再回读验证。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** `git rev-parse --git-dir` 拿到的可能是相对路径，统一解析成绝对路径。 */
function resolveGitDir(repoPath) {
  try {
    const out = execFileSync('git', ['-C', repoPath, 'rev-parse', '--git-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
    }).trim();
    if (!out) return '';
    return isAbsolute(out) ? out : resolve(repoPath, out);
  } catch {
    return '';
  }
}

/** 读某个 scope 下的 filemode 值（读不到返回 null，调用方按「未设置」处理）。 */
function readConfigValue(repoPath, scope) {
  try {
    const args = scope === 'global'
      ? ['config', '--global', '--get', 'core.filemode']
      : ['-C', repoPath, 'config', '--local', '--get', 'core.filemode'];
    const out = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).trim();
    if (!out) return null;
    return out === 'true';
  } catch {
    return null; // 未设置时 git 退出码 1，不当错误
  }
}

/**
 * 统计「纯权限变动」的文件——即 `git diff --summary` 里 `mode change 100644 => 100755` 这一类。
 * 用来给出可核对的证据：忽略权限后这些会消失，而**内容改动的不受影响**。
 * @param {string} repoPath 仓库路径
 * @returns {{count: number, files: string[]}}
 */
export function modeOnlyChanges(repoPath) {
  try {
    const out = execFileSync('git', ['-C', repoPath, 'diff', '--summary'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    });
    const files = [];
    for (const line of String(out || '').split('\n')) {
      const hit = line.match(/^ mode change \d+ => \d+ (.+)$/);
      if (hit) files.push(hit[1].trim());
    }
    return { count: files.length, files: files };
  } catch {
    return { count: 0, files: [] };
  }
}

/**
 * 读当前生效的 filemode 设置。
 * @param {{repoPath: string}} p
 * @returns {{ok: boolean, error?: string, effective: boolean|null, local: boolean|null,
 *   global: boolean|null, gitDir: string, modeOnly: {count: number, files: string[]}}}
 */
export function readFilemode({ repoPath = '' } = {}) {
  const abs = resolve(repoPath || '.');
  const gitDir = resolveGitDir(abs);
  if (!gitDir) return { ok: false, error: `不是 git 仓库（或 git 不可用）：${abs}`, effective: null, local: null, global: null, gitDir: '', modeOnly: { count: 0, files: [] } };
  const local = readConfigValue(abs, 'local');
  const global = readConfigValue(abs, 'global');
  // 生效值：本地未设置时继承全局；两者都没设置 ⇒ git 默认 true（比权限位）
  const effective = local === null ? (global === null ? true : global) : local;
  return { ok: true, effective: effective, local: local, global: global, gitDir: gitDir, modeOnly: modeOnlyChanges(abs) };
}

/**
 * 直接改写 `.git/config` 文本（`git config` 在 CIFS 上因 config.lock chmod 失败时的退路）。
 * @param {string} configFile .git/config 路径
 * @param {boolean} value 目标值
 * @returns {{ok: boolean, error?: string, backup?: string}}
 */
function writeFilemodeToConfigText(configFile, value) {
  if (!existsSync(configFile)) return { ok: false, error: `找不到 ${configFile}` };
  const backup = `${configFile}.bak-${Date.now()}`;
  try {
    // 备份必须用「读 + 写」而不是 copyFileSync：CIFS 上 copy 会去 chmod 目标文件 ⇒ EPERM（实测）。
    const originalText = readFileSync(configFile, 'utf8');
    writeFileSync(backup, originalText, 'utf8');
    const text = originalText;
    const lines = text.split('\n');
    const want = `\tfilemode = ${value ? 'true' : 'false'}`;
    let coreIndex = -1;
    let filemodeIndex = -1;
    let inCore = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*\[/.test(line)) {
        inCore = /^\s*\[core\]\s*$/i.test(line);
        if (inCore && coreIndex < 0) coreIndex = i;
        continue;
      }
      if (inCore && /^\s*filemode\s*=/.test(line)) { filemodeIndex = i; break; }
    }
    if (filemodeIndex >= 0) lines[filemodeIndex] = want;
    else if (coreIndex >= 0) lines.splice(coreIndex + 1, 0, want);
    else lines.push('[core]', want);
    writeFileSync(configFile, lines.join('\n'), 'utf8');
    return { ok: true, backup: backup };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * 设置 filemode（默认写到仓库本地配置；`scope:'global'` 写 `~/.gitconfig`）。
 *
 * 顺序：先走 `git config`（标准路径）；失败或写后回读不一致 ⇒ 退回直接改写 `.git/config`
 *   （CIFS 上 `config.lock` 的 chmod 会 EPERM，标准路径写不进去 - 实测）。
 * @param {{repoPath: string, scope?: 'local'|'global', value?: boolean}} p
 * @returns {{ok: boolean, error?: string, effective: boolean|null, backup?: string,
 *   modeOnly: {count: number, files: string[]}, via: string}}
 */
export function setFilemode({ repoPath = '', scope = 'local', value = false } = {}) {
  const abs = resolve(repoPath || '.');
  const gitDir = resolveGitDir(abs);
  if (!gitDir) return { ok: false, error: `不是 git 仓库（或 git 不可用）：${abs}`, effective: null, modeOnly: { count: 0, files: [] }, via: 'none' };
  const scopeFlag = scope === 'global' ? '--global' : '--local';
  let via = 'git-config';
  try {
    const args = scope === 'global'
      ? ['config', '--global', 'core.filemode', value ? 'true' : 'false']
      : ['-C', abs, 'config', '--local', 'core.filemode', value ? 'true' : 'false'];
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 });
  } catch { /* 标准路径失败 ⇒ 下面回读会发现并走退路 */ }

  // 回读验证：写没写进去以回读为准，不信"命令没报错"
  let current = readConfigValue(abs, scope === 'global' ? 'global' : 'local');
  let backup = '';
  if (current !== value && scope !== 'global') {
    const fallback = writeFilemodeToConfigText(join(gitDir, 'config'), value);
    if (!fallback.ok) {
      return { ok: false, error: `两种写法都失败：${fallback.error || '未知'}`, effective: readFilemode({ repoPath: abs }).effective, modeOnly: modeOnlyChanges(abs), via: 'failed' };
    }
    backup = fallback.backup || '';
    via = 'direct-.git/config';
    current = readConfigValue(abs, 'local');
  }
  const state = readFilemode({ repoPath: abs });
  if (state.effective !== value) {
    return { ok: false, error: `写入后回读仍不是 ${value}（当前 ${String(state.effective)}）`, effective: state.effective, modeOnly: state.modeOnly, via: via };
  }
  return { ok: true, effective: state.effective, modeOnly: state.modeOnly, via: via, ...(backup ? { backup: backup } : {}) };
}

/** 插件配置目录无关的默认仓库：调用方不传 repo 时用 cwd。 */
export function defaultRepoPath() {
  return process.cwd();
}

/** 供 CLI/工具共用的一段人话说明（避免两处文案漂移）。 */
export function filemodeHint(value) {
  return value === false
    ? '已忽略权限位（core.filemode=false）：CIFS 上新建文件的 777/755 不再算作改动'
    : '当前会**比较权限位**：CIFS/容器卷上新文件权限与仓库记录不同时，git 会把它们都算成改动';
}

/** 目录名（诊断用，避免调用方自己拼路径）。 */
export function configFileOf(repoPath) {
  const gitDir = resolveGitDir(resolve(repoPath || '.'));
  return gitDir ? join(gitDir, 'config') : '';
}

/** 保留导出：resolve + dirname 供调用方拼备份路径时使用。 */
export const _internals = { resolve, dirname };
