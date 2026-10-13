/**
 * npm 安装编排（Step 3）：校验 → 加锁 → 调 npm install → 回执 + 日志留痕。
 *
 * 安全默认（用户确认方案时定）：**默认加 `--ignore-scripts`**（装包会执行 postinstall 任意代码），
 *   UI 必须显式勾选才关闭；默认**不全局**（避免污染宿主 node 环境），全局需显式勾选；
 *   registry 与凭据一律走我们自己的 npmrc（--userconfig），不碰用户全局配置。
 */
import { appendFileSync } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { credentialsDir } from '../core/credentials.js';
import { DEFAULT_REGISTRY, NPM_TIMEOUT_MS, normalizeRegistry, resolveNpmBin, runNpm } from './registry.js';
import { npmArgs, writeNpmrc } from './npmrc.js';

export const INSTALL_LOG_FILE = 'npm-install.log';
export const INSTALL_TIMEOUT_MS = 300_000; // 装包比只读探测慢得多（默认 5 分钟；可传参覆盖）

/** 进行中的安装键集合（同一目标 + 同名包集合 ⇒ 视为同一个任务，避免并发重入）。 */
const inFlight = new Set();

/** 供测试/UI 查询：当前是否有安装在跑（返回键列表）。 */
export function installingKeys() {
  return [...inFlight];
}

/** 包名校验（纯函数）：允许 scope 与 @tag/@version；拒绝空、空白、以 - 开头（防选项注入）、路径穿越。 */
export function validatePackageNames(names = []) {
  const list = (Array.isArray(names) ? names : String(names || '').split(/[\s,]+/)).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return { ok: false, error: '未指定包名' };
  const NAME_RE = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[^\s/]+)?$/i;
  for (const n of list) {
    if (n.startsWith('-')) return { ok: false, error: `包名不能以 - 开头（防选项注入）：${n}` };
    if (n.includes('..') || n.includes('/../')) return { ok: false, error: `包名含路径穿越：${n}` };
    if (!NAME_RE.test(n)) return { ok: false, error: `包名不合法：${n}` };
  }
  return { ok: true, names: list };
}

/** 目标目录校验（纯函数 + 一次 stat）：必须存在且是目录。 */
export function validateDest(dest = '') {
  const d = String(dest || '').trim();
  if (!d) return { ok: false, error: '未指定安装目录' };
  try {
    if (!existsSync(d)) return { ok: false, error: `目录不存在：${d}` };
    if (!statSync(d).isDirectory()) return { ok: false, error: `不是目录：${d}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  return { ok: true, dest: d };
}

/** 拼 npm install 参数（纯函数，便于测试断言安全默认值）。 */
export function buildInstallArgs({ names = [], global = false, dest = '', ignoreScripts = true } = {}) {
  const args = ['install', ...names, '--no-audit', '--no-fund'];
  if (ignoreScripts) args.push('--ignore-scripts'); // 安全默认：不执行 postinstall
  if (global) args.push('-g');
  else if (dest) args.push('--prefix', dest);
  return args;
}

/** 追加安装日志（0600 目录内，留痕不落库）。 */
function appendInstallLog(line, { workspaceRoot = '' } = {}) {
  try {
    const file = join(credentialsDir({ workspaceRoot }), INSTALL_LOG_FILE);
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
    return file;
  } catch {
    return '';
  }
}

/**
 * 安装一个或多个包。
 * @param {object} o { names, dest, global, ignoreScripts, registry, workspaceRoot, timeoutMs }
 * @returns {{ok:boolean, code?:number, names?:string[], dest?:string, global?:boolean, ignoreScripts?:boolean,
 *            stdout?:string, stderr?:string, logPath?:string, error?:string}}
 */
export function installPackages({
  names = [], dest = '', global = false, ignoreScripts = true,
  registry = DEFAULT_REGISTRY, workspaceRoot = '', timeoutMs = INSTALL_TIMEOUT_MS, env = {},
} = {}) {
  const v = validatePackageNames(names);
  if (!v.ok) return { ok: false, error: v.error };
  if (!global) {
    const d = validateDest(dest);
    if (!d.ok) return { ok: false, error: d.error };
  }
  const reg = normalizeRegistry(registry);
  const key = `${global ? 'global' : dest}|${v.names.slice().sort().join(',')}`;
  if (inFlight.has(key)) return { ok: false, error: `同一目标正在安装中：${v.names.join(', ')}` };

  inFlight.add(key);
  try {
    const rc = writeNpmrc({ workspaceRoot, registry: reg });
    if (!rc.ok) return { ok: false, error: rc.error || 'npmrc 写入失败' };
    const args = [...npmArgs({ npmrcFile: rc.file, registry: reg }),
      ...buildInstallArgs({ names: v.names, global, dest, ignoreScripts })];
    const logPath = appendInstallLog(`install START names=${v.names.join(',')} global=${global} ignoreScripts=${ignoreScripts} dest=${global ? '(global)' : dest}`, { workspaceRoot });
    const r = runNpm(args, { timeoutMs, env: { NO_UPDATE_NOTIFIER: '1', ...env } });
    appendInstallLog(`install END ok=${r.ok} code=${r.code} err=${(r.error || '').slice(0, 200)}`, { workspaceRoot });
    return {
      ok: !!r.ok,
      code: r.code,
      names: v.names,
      dest: global ? '' : dest,
      global: !!global,
      ignoreScripts: !!ignoreScripts,
      stdout: String(r.stdout || '').slice(-4000),
      stderr: String(r.stderr || '').slice(-4000),
      logPath,
      error: r.ok ? '' : (r.error || 'npm install 失败'),
    };
  } finally {
    inFlight.delete(key);
  }
}

/** 当前可用的 npm 超时（导出便于 UI/测试引用同一常量）。 */
export { NPM_TIMEOUT_MS };

/* ═══════════ 异步安装 + 进度（照 GitHub 克隆的进度模型：后台跑 + 前端轮询取进度/终态）═══════════ */

/** 进行中的异步安装状态（内存单例：同一时刻只跟一个，避免输出串台）。 */
let asyncInstall = null;

/**
 * 启动异步安装（spawn，不阻塞事件循环 ⇒ 前端可以边跑边轮询进度）。
 * 与 `installPackages`（同步版，工具/CLI 用）并存：HTTP/UI 走本函数，工具走同步版。
 * @returns {{ok:boolean, started?:boolean, name?:string, logPath?:string, error?:string, hint?:string}}
 */
export function startInstall({
  names = [], dest = '', global = false, ignoreScripts = true,
  registry = DEFAULT_REGISTRY, workspaceRoot = '', timeoutMs = INSTALL_TIMEOUT_MS,
} = {}) {
  const v = validatePackageNames(names);
  if (!v.ok) return { ok: false, error: v.error };
  if (!global) {
    const d = validateDest(dest);
    if (!d.ok) return { ok: false, error: d.error };
  }
  if (asyncInstall && asyncInstall.state === 'running') {
    return { ok: false, error: `已有安装在运行：${asyncInstall.name}（可先用 /npm-install-progress 看进度）` };
  }
  const reg = normalizeRegistry(registry);
  const rc = writeNpmrc({ workspaceRoot, registry: reg });
  if (!rc.ok) return { ok: false, error: rc.error || 'npmrc 写入失败' };
  const args = [
    ...npmArgs({ npmrcFile: rc.file, registry: reg }),
    ...buildInstallArgs({ names: v.names, global, dest, ignoreScripts }),
  ];
  const bin = resolveNpmBin({ env: process.env });
  const logPath = appendInstallLog(`install(async) START names=${v.names.join(',')} global=${global} dest=${global ? '(global)' : dest} ignoreScripts=${ignoreScripts}`, { workspaceRoot });
  let child;
  try {
    child = spawn(bin, args, { env: { ...process.env, NO_UPDATE_NOTIFIER: '1' }, cwd: global ? undefined : dest });
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  asyncInstall = {
    name: v.names.join(', '), dest, global: !!global, ignoreScripts: !!ignoreScripts,
    startedAt: Date.now(), state: 'running', lines: [], code: null, error: '', logPath,
  };
  const push = (buf) => {
    for (const raw of String(buf).split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      asyncInstall.lines.push(t);
      if (asyncInstall.lines.length > 300) asyncInstall.lines.shift(); // 环形缓冲，防长输出吃内存
    }
  };
  child.stdout?.on('data', push);
  child.stderr?.on('data', push);
  const timer = setTimeout(() => {
    try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
    if (asyncInstall) { asyncInstall.state = 'timeout'; asyncInstall.error = `安装超时（${timeoutMs}ms）已终止`; }
  }, timeoutMs);
  child.on('close', (code) => {
    clearTimeout(timer);
    if (!asyncInstall || asyncInstall.state === 'timeout') return;
    asyncInstall.state = code === 0 ? 'done' : 'failed';
    asyncInstall.code = typeof code === 'number' ? code : -1;
    if (code !== 0) asyncInstall.error = `npm install 退出码 ${code}`;
    appendInstallLog(`install(async) END state=${asyncInstall.state} code=${asyncInstall.code}`, { workspaceRoot });
  });
  child.on('error', (e) => {
    clearTimeout(timer);
    if (!asyncInstall) return;
    asyncInstall.state = 'failed';
    asyncInstall.error = String(e?.message || e);
  });
  return { ok: true, started: true, name: asyncInstall.name, logPath, hint: '已开始安装；轮询 /api/git-push/npm-install-progress 取进度与终态（consume:true 取走后复位）' };
}

/**
 * 读取安装进度（对应 GitHub 克隆的 `/clone-progress`）。
 * @param {{consume?:boolean}} o consume=true 且已到终态 ⇒ 返回后复位（下次为 idle）
 */
export function installProgress({ consume = false } = {}) {
  if (!asyncInstall) return { ok: true, state: 'idle' };
  const a = asyncInstall;
  const progress = {
    state: a.state, name: a.name, dest: a.dest, global: a.global, ignoreScripts: a.ignoreScripts,
    startedAt: a.startedAt, elapsedMs: Date.now() - a.startedAt,
    lines: a.lines.slice(-40), tail: a.lines.slice(-6).join('\n'),
    code: a.code, error: a.error, logPath: a.logPath,
  };
  if (a.state !== 'running' && consume) asyncInstall = null;
  return { ok: true, progress };
}
