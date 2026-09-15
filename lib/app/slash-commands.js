/**
 * 插件入口层 · 用户输入框斜杠命令
 *
 * 官方通道：ctx.inject(['commands']) → commands.register({ name, description, input, handler })。
 * 人在输入框打 /git-audit，直接跑代码、不进模型。
 * 本文件只接 /git-audit（其余工具仍走 agent 工具 / HTTP / 设置页）。
 *
 * 默认仓库 = 当前会话工作区（invocation.agent.session.header.cwd），
 * 与 dsh-session-conductor 分组同一字段：cwd 空 = 未分类，必须写路径。
 * 禁止回落到 DSH 家根（无 .git 会走 auditFull，扫家根会把进程打爆）。
 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { callTool } from './tool-call.js';

const USAGE = '用法: /git-audit [路径] [--full] [--quick|--standard|--deep]';
const EXAMPLE = '示例: /git-audit /path/to/repo --full --deep';

/**
 * 解析 /git-audit 后的 rawInput。
 * 路径可带空格（未加引号时，非 flag 的连续 token 拼成路径）。
 * @param {string} raw
 * @returns {{path:string, scope:'diff'|'full', auditLevel?:string, error?:string}}
 */
export function parseGitAuditInput(raw = '') {
  const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
  let scope = 'diff';
  let auditLevel;
  const pathParts = [];
  for (const t of tokens) {
    if (t === '--full') { scope = 'full'; continue; }
    if (t === '--quick' || t === '--standard' || t === '--deep') {
      auditLevel = t.slice(2);
      continue;
    }
    if (t.startsWith('--')) return { path: '', scope, auditLevel, error: `未知参数 ${t}。${USAGE}` };
    pathParts.push(t);
  }
  return { path: pathParts.join(' '), scope, auditLevel };
}

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
 * 解析审计目标路径。空路径 = 会话 cwd（不是 DSH 家根）。
 * 相对路径接到会话 cwd；无会话 cwd 时相对路径无法解析。
 * @returns {string} 绝对路径或空串
 */
export function resolveAuditRepo(rawPath, { sessionCwd = '' } = {}) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return sessionCwd || '';
  if (isAbsolute(trimmed)) return trimmed;
  if (!sessionCwd) return '';
  return resolve(sessionCwd, trimmed);
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

/**
 * /git-audit handler 主体（可单测，不依赖 cordis）。
 * @returns {Promise<{kind:'success'|'error', text:string}>}
 */
export async function runGitAuditCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {
  const parsed = parseGitAuditInput(rawInput);
  if (parsed.error) return { kind: 'error', text: parsed.error };
  const sessionCwd = sessionCwdOf(invocation);
  if (!parsed.path && !sessionCwd) {
    return { kind: 'error', text: `当前会话未绑定工作区（未分类）。请指定 git 仓库路径。\n${USAGE}\n${EXAMPLE}` };
  }
  if (parsed.path && !isAbsolute(parsed.path) && !sessionCwd) {
    return { kind: 'error', text: `相对路径需要会话工作区。请给绝对路径。\n${USAGE}\n${EXAMPLE}` };
  }
  const target = resolveAuditRepo(parsed.path, { sessionCwd });
  if (!target || !existsSync(target)) return { kind: 'error', text: `路径不存在: ${target || '(空)'}` };
  const repo = findGitRoot(target);
  if (!repo) {
    return { kind: 'error', text: `不是 git 仓库: ${target}。拒绝全量扫非仓库目录（会把进程打爆）。\n${USAGE}\n${EXAMPLE}` };
  }
  const r = await callTool('code_audit', {
    repo,
    scope: parsed.scope,
    auditLevel: parsed.auditLevel,
  }, env, cfg, log);
  if (!r || r.ok === false) return { kind: 'error', text: r?.error || '审计失败' };
  return { kind: 'success', text: formatGitAuditCommandText(r) };
}

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
    try {
      commands.register({
        name: 'git-audit',
        description: '审计当前会话工作区（未分类须写路径；--full 全量）',
        input: { hint: '[路径] [--full] [--quick|--standard|--deep]' },
        handler: (invocation) => runGitAuditCommand({
          rawInput: invocation?.rawInput,
          invocation,
          env,
          cfg,
          log,
        }),
      });
      count += 1;
    } catch (e) {
      try { log?.warn?.(`dsh-git-push: /git-audit 注册失败: ${e?.message || e}`); } catch { /* 日志通道不可用时降级跳过 */ }
    }
  });
  return count;
}
