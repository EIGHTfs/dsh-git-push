/**
 * Git 执行层 · 进程调用
 *
 * 职责：统一的 git 子进程入口（runGit 走 execFileSync 取 stdout；gitRaw 取原始结果
 *   含 exitCode/stderr，供 blob 上传等需要错误细节的场景）。
 * 所有 git 调用都经过此模块，便于统一超时与错误规整，避免各调用点各写一份。
 */

import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

/* ───────────────────────── git 可执行文件解析 ───────────────────────── */

/**
 * 解析 git 可执行文件路径（不假设 PATH 里一定有 git）。
 *
 * 背景（2026-10-03 实测）：群晖套件用户（服务用户）的 PATH 里没有 git，而本模块此前
 *   直接 `execFileSync('git', ...)` —— 找不到可执行文件时抛 ENOENT，被 catch 规整成
 *   空 stdout 的失败结果，commit 预检又把「空 stdout」当成「游离 HEAD」，
 *   报出 "HEAD 处于 detached 状态" 这种完全误导的结论（真因是 PATH 缺 git）。
 *   改为显式解析 + 明确的缺失提示，避免同类误诊。
 *   优先级：DSH_GIT_BIN 环境变量 → PATH 各目录 → 常见绝对路径。
 */
const GIT_CANDIDATES = ['/var/packages/git/target/bin/git', '/usr/local/bin/git', '/usr/bin/git', '/bin/git'];
let _gitBin;
export function resolveGitBin() {
  if (_gitBin !== undefined) return _gitBin;
  const envBin = process.env.DSH_GIT_BIN;
  if (envBin) { _gitBin = envBin; return _gitBin; }
  for (const dir of String(process.env.PATH || '').split(':')) {
    if (!dir) continue;
    const p = dir.replace(/\/+$/, '') + '/git';
    try { if (existsSync(p) && statSync(p).isFile()) { _gitBin = p; return _gitBin; } } catch { /* 继续找 */ }
  }
  for (const p of GIT_CANDIDATES) {
    try { if (existsSync(p)) { _gitBin = p; return _gitBin; } } catch { /* 继续找 */ }
  }
  _gitBin = '';
  return _gitBin;
}

/** 找不到 git 时的统一提示（调用方原样上抛，不再伪装成业务错误）。 */
export const GIT_MISSING_MSG = '找不到 git 可执行文件：请把 git 加入 PATH，或用 DSH_GIT_BIN 指定其绝对路径';

/* ───────────────────────── 基础：git 执行 ───────────────────────── */

/** git 全局配置参数（每次调用前置；safe.directory 防「不信任目录」误伤工作区，quotepath 保持路径可读）。 */
const GIT_GLOBAL_ARGS = ['-c', 'safe.directory=*', '-c', 'core.filemode=false', '-c', 'core.quotepath=false'];

/** 统一 git 执行（数组参数，零注入面；stderr 保留供排障）。 */
export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {
  const base = GIT_GLOBAL_ARGS;
  const bin = resolveGitBin();
  if (!bin) return { ok: false, stdout: '', stderr: GIT_MISSING_MSG };
  try {
    const out = execFileSync(bin, cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 直通 git 包装器门禁：插件内部 git 调用合法（DSH_GIT_ENFORCE_PASS=1）
      env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1', ...env },
    });
    return { ok: true, stdout: out.trim(), stderr: '' };
  } catch (e) {
    return { ok: false, stdout: '', stderr: String(e?.stderr || e?.message || e).trim() };
  }
}

/**
 * git 原始字节通道（gitRaw 语义）：stdout 保留 Buffer，供 blob 原始内容读取。
 * ⚠️ 禁止用 runGit 读 blob——utf8 解码 + trim 会损坏非 UTF-8 字节/末尾换行（实测：
 * pushViaApi 经 runGit 读 cat-file 上传，17/109 文件 blob sha 与本地不一致，远端内容损坏）。
 * @returns {{status: number|null, stdout: Buffer, stderr: Buffer, error?: string}}
 */
export function gitRaw(args, { cwd = '', timeoutMs = 600_000 } = {}) {
  const base = GIT_GLOBAL_ARGS;
  const bin = resolveGitBin();
  if (!bin) return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: GIT_MISSING_MSG };
  try {
    const r = spawnSync(bin, cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
    });
    return { status: r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0), ...(r.error ? { error: String(r.error.message || r.error) } : {}) };
  } catch (e) {
    return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: String(e?.message || e) };
  }
}

/**
 * 异步版 runGit：与 runGit 参数/返回完全一致，但**不阻塞事件循环**。
 *
 * 新增，用于「列表逐仓并发探测远端」——runGit 走 execFileSync，是同步阻塞的，
 *   在 Promise worker 里调用并不会真正并行（一个 worker 独占事件循环直到子进程结束），
 *   实测 6 仓「并发」仍要 13s（≈ 串行）。改用本函数后各 worker 的子进程才能真正并行等待。
 * 语义与 runGit 保持一致：stdout 同样 trim，失败返回 {ok:false, error} 而不抛。
 */
export function runGitAsync(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {
  const base = GIT_GLOBAL_ARGS;
  const bin = resolveGitBin();
  if (!bin) return Promise.resolve({ ok: false, stdout: '', stderr: GIT_MISSING_MSG });
  return new Promise((resolve) => {
    execFile(bin, cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      // 直通 git 包装器门禁：插件内部 git 调用合法（DSH_GIT_ENFORCE_PASS=1）
      env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1', ...env },
    }, (err, stdout, stderr) => {
      if (err) { resolve({ ok: false, stdout: '', stderr: String(stderr || err.message || err) }); return; }
      resolve({ ok: true, stdout: String(stdout || '').trim(), stderr: String(stderr || '') });
    });
  });
}
