/**
 * 插件入口层 · 用户输入框斜杠命令
 *
 * 官方通道：ctx.inject(['commands']) → commands.register({ name, description, input, handler })。
 * 人在输入框打 /git-scan 等命令，直接跑代码、不进模型。
 * 注：审计类斜杠命令（/git-audit、/git-io-scan、/link-check）已随审计能力迁出宿主。
 *
 * ── 只注册「只读」命令 ──
 * 这里挂的每条命令都零副作用：不写文件、不改远端、不发提交。写类操作
 *   （git_commit_push / git_remote_create / git_set_visibility）
 *   刻意不挂——输入框一条命令就改远端太危险，仍走 agent 工具（有审计与门禁）。
 *   唯一的例外是 /git-clone-preview：它只读远端树并回报「将下载什么」，不落盘。
 *
 * 默认仓库 = 当前会话工作区（invocation.agent.session.header.cwd），
 * 与 dsh-session-conductor 分组同一字段：cwd 空 = 未分类，必须写路径。
 * 禁止回落到 DSH 家根（无 .git 会走 auditFull，扫家根会把进程打爆）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { callTool } from './tool-call.js';

/* ───────────────────────── 通用工具 ───────────────────────── */

/** 路径不存在时的统一前缀（多个斜杠命令共用）。 */
const ERR_PATH_NOT_FOUND = '路径不存在: ';

/** 会话工作区路径。空 = 指挥家「未分类」（header.cwd 缺失）。 */
export function sessionCwdOf(invocation) {
  const cwd = invocation?.agent?.session?.header?.cwd;
  return typeof cwd === 'string' && cwd.trim() ? cwd.trim() : '';
}

/**
 * 从 dir 向上找含 .git 的仓库根。找不到返回空串。
 * @param {string} dir
 * @returns {string}
 */
/** git 仓库向上探测的最大深度（超过即放弃，防深目录逐级 existsSync 拖慢）。 */
const GIT_ROOT_MAX_DEPTH = 20;
const PREVIEW_LIST_MAX = 15;     // /git-clone-preview 预览列表条数上限（防刷屏）
const LIST_PRINT_MAX = 20;       // 通用列表打印上限（拦截文件/坏链接等，防刷屏）

export function findGitRoot(dir) {
  if (!dir) return '';
  let cur = resolve(dir);
  for (let i = 0; i < GIT_ROOT_MAX_DEPTH; i++) {
    if (existsSync(join(cur, '.git'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return '';
    cur = parent;
  }
  return '';
}

/**
 * 解析目标路径。空路径 = 会话 cwd（不是 DSH 家根）。
 * 相对路径接到会话 cwd；无会话 cwd 时相对路径无法解析。
 * @returns {string} 绝对路径或空串
 */
export function resolveTargetPath(rawPath, { sessionCwd = '' } = {}) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return sessionCwd || '';
  if (isAbsolute(trimmed)) return trimmed;
  if (!sessionCwd) return '';
  return resolve(sessionCwd, trimmed);
}

/**
 * 通用参数解析：抽出路径与已知 flag。
 * 非 flag 的连续 token 拼成路径（允许带空格未加引号）。
 * flag 兼容单横线：`-full`/`--full` 等价（用户常敲单横线，缺路径时避免被当路径报「路径不存在」）。
 * @param {string} raw
 * @param {string[]} flags 允许的 flag（如 ['--full','--json']）
 * @param {string} usage
 */
export function parseCommandInput(raw = '', flags = [], usage = '') {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const opts = {};
  const pathParts = [];
  for (const t of tokens) {
    // 横线参数（--full / -full 均识别；未知横线参数报用法，不当路径）
    if (/^--?[a-zA-Z]/.test(t)) {
      const canon = (t.startsWith('--') ? t : `-${t}`);
      if (!flags.includes(canon) && !flags.includes(t)) return { path: '', opts, error: `未知参数 ${t}。${usage}` };
      const flagName = canon.replace(/^-+/, ''); // --full / -full → full
      opts[flagName] = true;
      continue;
    }
    pathParts.push(t);
  }
  return { path: pathParts.join(' '), opts };
}

/** 把「不是 git 仓库」这类拒绝理由统一成带用法的错误。 */
function rejectRepo(usage, example, detail) {
  return { kind: 'error', text: `${detail}\n${usage}${example ? '\n' + example : ''}` };
}

/* ───────────────────────── /git-scan ───────────────────────── */

const SCAN_USAGE = '用法: /git-scan [路径]';
const SCAN_EXAMPLE = '示例: /git-scan /volume1/.../工作区';

/** 把扫描结果收成输入框可显示的短文本。 */
export function formatGitScanCommandText(r = {}) {
  if (!r || r.ok === false) return r?.error || '扫描失败';
  const repos = Array.isArray(r.repos) ? r.repos : [];
  if (!repos.length) return `扫描根: ${r.root}\n未发现 git 仓库。`;
  const lines = [`扫描根: ${r.root}`, `共 ${repos.length} 个仓库：`, ''];
  for (const x of repos) {
    const dirty = Number(x.changed) || 0;
    const ahead = Number(x.ahead) || 0;
    const mark = dirty || ahead ? '●' : '○';
    const parts = [`${mark} ${x.name}`, `[${x.branch || '(空仓)'}]`];
    if (dirty) parts.push(`未提交 ${dirty}`);
    if (ahead) parts.push(`未推送 ${ahead}`);
    lines.push('  ' + parts.join('  '));
  }
  const dirtyCount = repos.filter((x) => Number(x.changed) > 0).length;
  if (dirtyCount) lines.push('', `其中 ${dirtyCount} 个仓库有未提交改动。`);
  return lines.join('\n');
}

export async function runGitScanCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {
  const parsed = parseCommandInput(rawInput, [], SCAN_USAGE);
  if (parsed.error) return { kind: 'error', text: parsed.error };
  const sessionCwd = sessionCwdOf(invocation);
  const target = resolveTargetPath(parsed.path, { sessionCwd });
  if (parsed.path && !target) {
    return { kind: 'error', text: `相对路径需要会话工作区。请给绝对路径。\n${SCAN_USAGE}` };
  }
  if (target && !existsSync(target)) return { kind: 'error', text: `${ERR_PATH_NOT_FOUND}${target}` };
  // 不传 root → 用插件配置的默认扫描根（与 git_scan 工具同源）
  const args = target ? { root: target } : {};
  const r = await callTool('git_scan', args, env, cfg, log);
  if (!r || r.ok === false) return { kind: 'error', text: r?.error || '扫描失败' };
  return { kind: 'success', text: formatGitScanCommandText(r) };
}

/* ───────────────────────── /git-account ───────────────────────── */

const ACCOUNT_USAGE = '用法: /git-account';

export async function runGitAccountCommand({ env = {}, cfg = {}, log = null } = {}) {
  const r = await callTool('git_account_check', {}, env, cfg, log);
  if (!r || r.ok === false) return { kind: 'error', text: r?.error || '账号校验失败' };
  return { kind: 'success', text: String(r.block || '账号校验完成（无摘要）') };
}

/* ───────────────────────── /git-clone-preview ───────────────────────── */

const PREVIEW_USAGE = '用法: /git-clone-preview <owner/repo 或 URL> [--branch 名]';
const PREVIEW_EXAMPLE = '示例: /git-clone-preview EIGHTfs/dsh-git-push';

/**
 * 把 clone 预览收成短文本（只读：不下载、不落盘）。
 */
export function formatClonePreviewCommandText(r = {}) {
  if (!r || r.ok === false) return r?.error || '预览失败';
  const willDownload = Array.isArray(r.willDownload) ? r.willDownload : (Array.isArray(r.download) ? r.download : []);
  const skipped = Array.isArray(r.skipped) ? r.skipped : [];
  const lines = [
    `${r.owner || ''}/${r.repo || ''}${r.branch ? ` @ ${r.branch}` : ''}`,
    `将下载 ${willDownload.length} 个文件 · 约 ${r.downloadMB != null ? r.downloadMB + ' MB' : '(未知)'}`,
  ];
  for (const f of willDownload.slice(0, PREVIEW_LIST_MAX)) { // 预览列表条数上限（防刷屏）
    const size = f.size != null ? `${(f.size / 1024 / 1024).toFixed(1)}MB` : '';
    lines.push(`  下载 ${f.path || f}  ${size}`);
  }
  if (willDownload.length > PREVIEW_LIST_MAX) lines.push(`  …另有 ${willDownload.length - PREVIEW_LIST_MAX} 个`);
  if (skipped.length) {
    lines.push(`跳过 ${skipped.length} 个（超体积上限）：`);
    for (const f of skipped.slice(0, 10)) {
      const size = f.size != null ? `${(f.size / 1024 / 1024).toFixed(1)}MB` : '';
      lines.push(`  跳过 ${f.path || f}  ${size}`);
    }
  }
  if (!willDownload.length) lines.push('', '⚠ 所有文件都会被跳过——继续克隆将得到空仓库。');
  return lines.join('\n');
}

export async function runGitClonePreviewCommand({ rawInput = '', env = {}, cfg = {}, log = null } = {}) {
  const parsed = parseCommandInput(rawInput, ['--branch'], PREVIEW_USAGE);
  if (parsed.error) return { kind: 'error', text: parsed.error };
  const tokens = String(rawInput || '').trim().split(/\s+/).filter(Boolean);
  const bi = tokens.indexOf('--branch');
  const branch = bi >= 0 ? (tokens[bi + 1] || '') : '';
  const target = parsed.path || branch ? parsed.path : '';
  if (!target) return { kind: 'error', text: `请给 owner/repo 或 URL。\n${PREVIEW_USAGE}\n${PREVIEW_EXAMPLE}` };
  const r = await callTool('git_clone_preview', { target, branch }, env, cfg, log);
  if (!r || r.ok === false) return { kind: 'error', text: r?.error || '预览失败' };
  return { kind: 'success', text: formatClonePreviewCommandText(r) };
}

/* ───────────────────────── 注册 ───────────────────────── */

/**
 * 命令清单。每条都零副作用（不写文件、不改远端）。
 * keep: 便于测试断言注册集合，避免漏挂/多挂。
 */
export const SLASH_COMMANDS = [
  { name: 'git-scan', description: '列出各仓库分支/未提交/未推送（只读）', input: { hint: '[路径]' }, run: runGitScanCommand },
  { name: 'git-account', description: '校验 GitHub 账号与凭据（只读）', input: { hint: '' }, run: runGitAccountCommand },
  { name: 'git-clone-preview', description: '预览 clone 将下载/跳过哪些文件，不落盘（只读）', input: { hint: '<owner/repo> [--branch 名]' }, run: runGitClonePreviewCommand },
];

/**
 * 注册斜杠命令。commands 服务缺失时静默跳过（无 UI 的宿主不挂命令适配器）。
 * @returns {number} 注册成功条数
 */
export function registerSlashCommands(ctx, { env = {}, cfg = {}, log = null } = {}) {
  if (typeof ctx?.inject !== 'function') return 0;
  let count = 0;
  ctx.inject(['commands'], (cctx) => {
    const commands = cctx?.commands || cctx?.get?.('commands');
    if (!commands?.register) {
      try { log?.warn?.('dsh-git-push: commands 服务不可用，斜杠命令未注册'); } catch { /* 日志失败不影响接线 */ }
      return;
    }
    for (const cmd of SLASH_COMMANDS) {
      try {
        commands.register({
          name: cmd.name,
          description: cmd.description,
          input: cmd.input,
          handler: (invocation) => cmd.run({ rawInput: invocation?.rawInput, invocation, env, cfg, log }),
        });
        count += 1;
      } catch (e) {
        try { log?.warn?.(`dsh-git-push: /${cmd.name} 注册失败: ${e?.message || e}`); } catch { /* 日志通道不可用时降级跳过 */ }
      }
    }
  });
  return count;
}
