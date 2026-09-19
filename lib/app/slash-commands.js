/**
 * 插件入口层 · 用户输入框斜杠命令
 *
 * 官方通道：ctx.inject(['commands']) → commands.register({ name, description, input, handler })。
 * 人在输入框打 /git-audit 等命令，直接跑代码、不进模型。
 *
 * ── 只注册「只读」命令 ──
 * 这里挂的每条命令都零副作用：不写文件、不改远端、不发提交。写类操作
 *   （git_commit_push / git_remote_create / git_set_visibility / git_gen_readme）
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
export function findGitRoot(dir) {
  if (!dir) return '';
  let cur = resolve(dir);
  for (let i = 0; i < 20; i++) {
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
 * @param {string} raw
 * @param {string[]} flags 允许的 flag（如 ['--full','--json']）
 * @param {string} usage
 */
export function parseCommandInput(raw = '', flags = [], usage = '') {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  const opts = {};
  const pathParts = [];
  for (const t of tokens) {
    if (t.startsWith('--')) {
      if (!flags.includes(t)) return { path: '', opts, error: `未知参数 ${t}。${usage}` };
      opts[t.slice(2)] = true;
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

/* ───────────────────────── /git-audit ───────────────────────── */

const AUDIT_USAGE = '用法: /git-audit [路径] [--full] [--force]';
const AUDIT_EXAMPLE = '示例: /git-audit /path/to/repo --full；/git-audit /path/to/dir --force（非 git 目录强制全量扫描）';

/** 兼容旧名（外部/测试可能仍在用）。 */
export function parseGitAuditInput(raw = '') {
  const parsed = parseCommandInput(raw, ['--full', '--force'], AUDIT_USAGE);
  if (parsed.error) return { path: '', scope: 'diff', error: parsed.error };
  return { path: parsed.path, scope: parsed.opts.full ? 'full' : 'diff', force: parsed.opts.force === true };
}

/** 兼容旧名。 */
export function resolveAuditRepo(rawPath, opts) {
  return resolveTargetPath(rawPath, opts);
}

/**
 * 把 code_audit 结果收成输入框可显示的短文本（含 blocker 文件列表）。
 * @param {object} r callTool('code_audit') 返回值
 */
export function formatGitAuditCommandText(r = {}) {
  if (!r || r.ok === false) return r?.error || '审计失败';
  const lines = [String(r.block || '').trim()].filter(Boolean);
  const findings = Array.isArray(r.findings) ? r.findings : [];
  const blockers = findings.filter((f) => f && (f.severity === 'blocker' || f.level === 'blocker'));
  if (blockers.length) {
    lines.push('拦截文件：');
    for (const f of blockers.slice(0, 20)) {
      const loc = f.line ? `${f.file}:${f.line}` : String(f.file || '');
      const rule = f.rule ? `（${f.rule}）` : '';
      lines.push(`  ${loc}${rule}`);
    }
    if (blockers.length > 20) lines.push(`  …另有 ${blockers.length - 20} 条`);
  }
  return lines.join('\n') || '审计完成（无摘要）';
}

/** /git-audit handler 主体（可单测，不依赖 cordis）。 */
export async function runGitAuditCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {
  const parsed = parseGitAuditInput(rawInput);
  if (parsed.error) return { kind: 'error', text: parsed.error };
  const sessionCwd = sessionCwdOf(invocation);
  if (!parsed.path && !sessionCwd) {
    return { kind: 'error', text: `当前会话未绑定工作区（未分类）。请指定 git 仓库路径。\n${AUDIT_USAGE}\n${AUDIT_EXAMPLE}` };
  }
  if (parsed.path && !isAbsolute(parsed.path) && !sessionCwd) {
    return { kind: 'error', text: `相对路径需要会话工作区。请给绝对路径。\n${AUDIT_USAGE}\n${AUDIT_EXAMPLE}` };
  }
  const target = resolveTargetPath(parsed.path, { sessionCwd });
  if (!target || !existsSync(target)) return { kind: 'error', text: `路径不存在: ${target || '(空)'}` };
  let repo = findGitRoot(target);
  if (!repo) {
    // 非 git 目录默认拒绝（全量扫非仓库目录可能打爆进程）；--force 显式放行——
    //   code_audit 工具对非 git 目录自动走 auditFull（scope 强制 full，不依赖 git 元数据）
    if (!parsed.force) {
      return rejectRepo(AUDIT_USAGE, AUDIT_EXAMPLE, `不是 git 仓库: ${target}。拒绝全量扫非仓库目录（会把进程打爆）；加 --force 强制扫描。`);
    }
    repo = target;
  }
  const r = await callTool('code_audit', { repo, scope: parsed.scope }, env, cfg, log);
  if (!r || r.ok === false) return { kind: 'error', text: r?.error || '审计失败' };
  return { kind: 'success', text: formatGitAuditCommandText(r) };
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
  if (target && !existsSync(target)) return { kind: 'error', text: `路径不存在: ${target}` };
  // 不传 root → 用插件配置的默认扫描根（与 git_scan 工具同源）
  const args = target ? { root: target } : {};
  const r = await callTool('git_scan', args, env, cfg, log);
  if (!r || r.ok === false) return { kind: 'error', text: r?.error || '扫描失败' };
  return { kind: 'success', text: formatGitScanCommandText(r) };
}

/* ───────────────────────── /git-io-scan ───────────────────────── */

const IOSCAN_USAGE = '用法: /git-io-scan [路径] [--write]';
const IOSCAN_EXAMPLE = '示例: /git-io-scan --write';

/**
 * 把 I/O 扫描结果收成输入框可显示的短文本。
 * 数据形态：{ total, sync, byRisk:{high,medium,low,safe}, files:[{file,count}], items:[...] }
 */
export function formatIoScanCommandText(r = {}) {
  if (!r || r.ok === false) return r?.error || 'I/O 扫描失败';
  const total = Number(r.total) || 0;
  if (!total) return `扫描根: ${r.root || '(会话工作区)'}\n未发现文件 I/O 调用。`;
  const b = r.byRisk || {};
  const lines = [
    `扫描根: ${r.root || '(会话工作区)'}`,
    `文件 I/O 调用 ${total} 处（同步 ${r.sync || 0} / 异步 ${total - (r.sync || 0)}）`,
    '',
    '风险分布：',
    `  🔴 高 ${b.high || 0}   🟠 中 ${b.medium || 0}   🟡 低 ${b.low || 0}   🟢 安全 ${b.safe || 0}`,
  ];
  const items = Array.isArray(r.items) ? r.items : [];
  const top = items.filter((h) => h.risk === 'high').slice(0, 10);
  if (top.length) {
    lines.push('', '高风险（改造优先级）：');
    for (const h of top) {
      const ctxs = [];
      if (h.inAsync) ctxs.push('异步路径');
      if (h.inLoop) ctxs.push('循环内');
      if (h.inRequest) ctxs.push('请求路径');
      lines.push(`  ${h.file}:${h.line}  ${h.call || h.op || ''}  ${ctxs.join('+') || '—'}`);
    }
    const highTotal = b.high || 0;
    if (highTotal > top.length) lines.push(`  …另有 ${highTotal - top.length} 处高危`);
  }
  return lines.join('\n');
}

/**
 * /git-io-scan handler：扫描脚本里读写文件的调用与路径。
 * 复用 scripts/scan-file-io.mjs（AST 四级分级，与审计 io-risk 同标准），
 *   不另写一套扫描逻辑。
 */
export async function runGitIoScanCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {
  const parsed = parseCommandInput(rawInput, ['--write'], IOSCAN_USAGE);
  if (parsed.error) return { kind: 'error', text: parsed.error };
  const sessionCwd = sessionCwdOf(invocation);
  const target = resolveTargetPath(parsed.path, { sessionCwd });
  if (parsed.path && !target) {
    return { kind: 'error', text: `相对路径需要会话工作区。请给绝对路径。\n${IOSCAN_USAGE}` };
  }
  if (target && !existsSync(target)) return { kind: 'error', text: `路径不存在: ${target}` };
  const r = await callTool('io_scan', { repo: target || sessionCwd, writeOnly: parsed.opts.write === true }, env, cfg, log);
  if (!r || r.ok === false) return { kind: 'error', text: r?.error || 'I/O 扫描失败' };
  return { kind: 'success', text: formatIoScanCommandText(r) };
}

/* ───────────────────────── /link-check ───────────────────────── */

const LINK_USAGE = '用法: /link-check [文件或目录]';
const LINK_EXAMPLE = '示例: /link-check README.md';

/** 把链接检查结果收成短文本。 */
export function formatLinkCheckCommandText(r = {}) {
  if (!r || r.ok === false) return r?.error || '链接检查失败';
  const findings = Array.isArray(r.findings) ? r.findings : [];
  if (!findings.length) return `共检查链接 ${r.count || 0} 个，全部有效。`;
  const bad = findings.filter((f) => f && f.ok === false);
  const lines = [`共检查 ${r.count || findings.length} 个链接，其中 ${bad.length} 个无效：`, ''];
  for (const f of bad.slice(0, 20)) {
    lines.push(`  ✗ ${f.url || f.link || '(空)'}${f.error ? `  — ${f.error}` : ''}`);
  }
  if (bad.length > 20) lines.push(`  …另有 ${bad.length - 20} 个`);
  return lines.join('\n');
}

export async function runLinkCheckCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {
  const parsed = parseCommandInput(rawInput, [], LINK_USAGE);
  if (parsed.error) return { kind: 'error', text: parsed.error };
  const sessionCwd = sessionCwdOf(invocation);
  const target = resolveTargetPath(parsed.path, { sessionCwd }) || env.workspaceRoot || '';
  if (target && !existsSync(target)) return { kind: 'error', text: `路径不存在: ${target}` };
  const r = await callTool('link_check', { path: target }, env, cfg, log);
  if (!r || r.ok === false) return { kind: 'error', text: r?.error || '链接检查失败' };
  return { kind: 'success', text: formatLinkCheckCommandText(r) };
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
  for (const f of willDownload.slice(0, 15)) {
    const size = f.size != null ? `${(f.size / 1024 / 1024).toFixed(1)}MB` : '';
    lines.push(`  下载 ${f.path || f}  ${size}`);
  }
  if (willDownload.length > 15) lines.push(`  …另有 ${willDownload.length - 15} 个`);
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
  { name: 'git-audit', description: '审计当前会话工作区（未分类须写路径；--full 全量）', input: { hint: '[路径] [--full]' }, run: runGitAuditCommand },
  { name: 'git-scan', description: '列出各仓库分支/未提交/未推送（只读）', input: { hint: '[路径]' }, run: runGitScanCommand },
  { name: 'git-io-scan', description: '扫描脚本里读写文件的调用与路径，标四级风险（只读）', input: { hint: '[路径] [--write]' }, run: runGitIoScanCommand },
  { name: 'link-check', description: '检查文档内链接有效性（只读）', input: { hint: '[文件或目录]' }, run: runLinkCheckCommand },
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
