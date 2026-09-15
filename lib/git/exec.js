/**
 * Git 执行层 · 进程调用
 *
 * 职责：统一的 git 子进程入口（runGit 走 execFileSync 取 stdout；gitRaw 取原始结果
 *   含 exitCode/stderr，供 blob 上传等需要错误细节的场景）。
 * 所有 git 调用都经过此模块，便于统一超时与错误规整，避免各调用点各写一份。
 */

import { execFileSync, spawnSync } from 'node:child_process';

/* ───────────────────────── 基础：git 执行 ───────────────────────── */

/** 统一 git 执行（数组参数，零注入面；stderr 保留供排障）。 */
export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {
  const base = ['-c', 'safe.directory=*', '-c', 'core.filemode=false', '-c', 'core.quotepath=false'];
  try {
    const out = execFileSync('git', cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
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
 * ⚠️ 禁止用 runGit 读 blob——utf8 解码 + trim 会损坏非 UTF-8 字节/末尾换行（2026-09-11 实测：
 * pushViaApi 经 runGit 读 cat-file 上传，17/109 文件 blob sha 与本地不一致，远端内容损坏）。
 * @returns {{status: number|null, stdout: Buffer, stderr: Buffer, error?: string}}
 */
export function gitRaw(args, { cwd = '', timeoutMs = 600_000 } = {}) {
  const base = ['-c', 'safe.directory=*', '-c', 'core.filemode=false', '-c', 'core.quotepath=false'];
  try {
    const r = spawnSync('git', cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
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
