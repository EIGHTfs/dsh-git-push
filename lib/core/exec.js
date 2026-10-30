/**
 * Git 执行层 · 进程调用
 *
 * 职责：统一的 git 子进程入口（runGit 走 execFileSync 取 stdout；gitRaw 取原始结果
 *   含 exitCode/stderr，供 blob 上传等需要错误细节的场景）。
 * 所有 git 调用都经过此模块，便于统一超时与错误规整，避免各调用点各写一份。
 */

import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter as pathDelimiter, join } from 'node:path';

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
const GIT_CANDIDATES = [
  // POSIX 常见位置
  '/var/packages/git/target/bin/git', '/usr/local/bin/git', '/usr/bin/git', '/bin/git',
  // Windows 常见安装位置（Git for Windows 的 cmd\ 目录；PATH 未配置时兜底）
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
];

/**
 * 组装「到哪找 git」的搜索计划（纯函数，便于跨平台单测）。
 *
 * 为什么单独成函数：Windows 的 PATH 用 `;` 分隔、可执行名是 `git.exe` ——
 *   旧实现写死 `split(':')` + 候选名 `git`，在 Windows 上会把整串 PATH 当成一个目录，
 *   于是永远找不到 git，报出「找不到 git 可执行文件」这种**看起来像环境问题**的误导结论
 *   （实际是解析方式不对）。
 * @param {string} pathValue PATH 值
 * @param {{delimiter?:string, platform?:string}} [opts] 可注入，便于单测
 * @returns {{dirs:string[], names:string[]}}
 */
export function gitSearchPlan(pathValue, { delimiter = pathDelimiter, platform = process.platform } = {}) {
  const dirs = String(pathValue || '')
    .split(delimiter)
    .map((d) => d.trim().replace(/[\\/]+$/, ''))
    .filter(Boolean);
  const names = platform === 'win32' ? ['git.exe', 'git.cmd', 'git.bat', 'git'] : ['git'];
  return { dirs, names };
}

let _gitBin;
export function resolveGitBin() {
  if (_gitBin !== undefined) return _gitBin;
  const envBin = process.env.DSH_GIT_BIN;
  if (envBin) { _gitBin = envBin; return _gitBin; }
  // PATH 分隔符与可执行名按平台取（Windows 是 ';' 与 git.exe）
  const { dirs, names } = gitSearchPlan(process.env.PATH || '');
  for (const dir of dirs) {
    for (const name of names) {
      const p = join(dir, name);
      try { if (existsSync(p) && statSync(p).isFile()) { _gitBin = p; return _gitBin; } } catch { /* 继续找 */ }
    }
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

/** git 全局配置参数（每次调用前置；safe.directory 防「不信任目录」误伤工作区，quotepath 保持路径可读）。
 *  ⚠ 必须 export：透传通道（wrapped-git.js）也要带上，否则同一条 git 命令
 *    「插件内部调用成功、AI 透传调用却因 dubious ownership 失败」（2026-10-03 实测）。 */
import { mirrorGitConfigEnv } from './endpoints.js'; // ESM 允许 import 置于顶层任意位置，此处靠近使用点便于对照
/** 会走网络的**只读** git 动词：这些命令注入镜像 insteadOf；push 等写操作**绝不注入**（见 mirrorGitConfigEnv 的 mode）。 */
export const GIT_READ_VERBS = new Set(['fetch', 'clone', 'pull', 'ls-remote', 'submodule']);
export const GIT_GLOBAL_ARGS = ['-c', 'safe.directory=*', '-c', 'core.filemode=false', '-c', 'core.quotepath=false'];

/** 统一 git 执行（数组参数，零注入面；stderr 保留供排障）。 */
export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {}, noMirror = false } = {}) {
  const base = GIT_GLOBAL_ARGS;
  const bin = resolveGitBin();
  if (!bin) return { ok: false, stdout: '', stderr: GIT_MISSING_MSG };
  // 只读的网络动词注入镜像（与 http 层同口径：默认走 gh-proxy）；
  //   写操作（push 等）不在集合里 ⇒ 不注入 ⇒ 推送一律直连（凭据与写入不经第三方）。
  //   noMirror：调用方已判定目标仓库是私有/未知 ⇒ 不注入——镜像看不到私有库，注入必失败。
  const mirrorEnv = {};
  if (!noMirror && GIT_READ_VERBS.has(String(args[0] || ''))) mirrorGitConfigEnv(mirrorEnv, { mode: 'read' });
  try {
    const out = execFileSync(bin, cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 直通 git 包装器门禁：插件内部 git 调用合法（DSH_GIT_ENFORCE_PASS=1）
      env: { ...process.env, ...mirrorEnv, DSH_GIT_ENFORCE_PASS: '1', ...env },
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
export function runGitAsync(args, { cwd = '', timeoutMs = 120_000, env = {}, noMirror = false } = {}) {
  const base = GIT_GLOBAL_ARGS;
  const bin = resolveGitBin();
  if (!bin) return Promise.resolve({ ok: false, stdout: '', stderr: GIT_MISSING_MSG });
  // 与 runGit 同口径：只读网络动词注入镜像，push 等写操作不注入（见 GIT_READ_VERBS）。
  //   此前只有同步版注入，异步版仍直连 ⇒ 并发探测远端那类调用绕过镜像。
  //   noMirror：目标仓库私有/未知时不注入（镜像看不到私有库）。
  const mirrorEnv = {};
  if (!noMirror && GIT_READ_VERBS.has(String(args[0] || ''))) mirrorGitConfigEnv(mirrorEnv, { mode: 'read' });
  return new Promise((resolve) => {
    execFile(bin, cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      // 直通 git 包装器门禁：插件内部 git 调用合法（DSH_GIT_ENFORCE_PASS=1）
      env: { ...process.env, ...mirrorEnv, DSH_GIT_ENFORCE_PASS: '1', ...env },
    }, (err, stdout, stderr) => {
      if (err) { resolve({ ok: false, stdout: '', stderr: String(stderr || err.message || err) }); return; }
      resolve({ ok: true, stdout: String(stdout || '').trim(), stderr: String(stderr || '') });
    });
  });
}

/* ─────────────────── 流式执行：按「无进展」判停摆 ─────────────────── */

/**
 * 流式 git 执行：**只判「有没有进展」，不设固定总时长**。
 *
 * 为什么需要：`runGit` 是 execFileSync + 死超时（默认 120s）。对大仓库的 `git fetch`
 *   来说这必然半途而废 —— 实测 6.9GB / 7374 文件的仓库，fetch 要跑十几分钟以上，
 *   但它其实一直在正常下载（`--progress` 的百分比行持续刷新）。真正该防的不是"慢"，
 *   是"卡住不动"：所以这里改成**只要有输出就把看门狗往后推**，
 *   连续 `stallLimit` 完全没有输出才判定停摆并结束进程。
 *
 * 与 runGit 的关系：语义一致（同前置参数、同镜像注入、同 DSH_GIT_ENFORCE_PASS 门禁），
 *   区别只在于**超时判据**与"必须流式读 stderr 才能看见进度"。
 *
 * @param {string[]} args git 参数（自动前置 GIT_GLOBAL_ARGS）
 * @param {{cwd?:string, env?:object, noMirror?:boolean, stallMs?:number,
 *          onProgress?:(line:string)=>void}} [o]
 *        stallMs：连续多少毫秒无任何输出算停摆（未传则读 DSH_GIT_FETCH_STALL_MS，再缺省 300000 = 5 分钟）
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string, stalled:boolean, ms:number}>}
 *        `stalled=true` 表示是按"停摆"结束的（不是 git 自己报错）——
 *        调用方据此提示"可重试续传"，别把它当成仓库/网络错误。
 */
export function runGitStream(args, { cwd = '', env = {}, noMirror = false, stallMs, onProgress } = {}) {
  const base = GIT_GLOBAL_ARGS;
  const bin = resolveGitBin();
  if (!bin) return Promise.resolve({ ok: false, stdout: '', stderr: GIT_MISSING_MSG, stalled: false, ms: 0 });
  const mirrorEnv = {};
  if (!noMirror && GIT_READ_VERBS.has(String(args[0] || ''))) mirrorGitConfigEnv(mirrorEnv, { mode: 'read' });
  // 停摆阈值优先级：显式传参 > 环境变量 > 默认 5 分钟。
  //   默认值依据「fetch 带 --progress、正常下载会持续刷行」估计；若现场遇到长时间静默
  //   但仍在工作的阶段（大 pack 解压/校验无进度行），可用 DSH_GIT_FETCH_STALL_MS 放宽，
  //   不必改代码重发版——这类阈值只能在真实大仓库上才调得准。
  const groupKill = process.platform !== 'win32';
  const envStall = Number(process.env.DSH_GIT_FETCH_STALL_MS);
  const stallLimit = Number(stallMs) > 0 ? Number(stallMs) : (envStall > 0 ? envStall : 300_000);
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
        stdio: ['ignore', 'pipe', 'pipe'],
        // detached：让 git 自成进程组。git fetch 会再派生 git-remote-https 这类传输子进程，
        //   只结束直接子进程时孙进程可能仍占着连接、把下载拖在后台；按进程组结束才真停下。
        //   Windows 无进程组语义，退回单进程结束。
        detached: groupKill,
        env: { ...process.env, ...mirrorEnv, DSH_GIT_ENFORCE_PASS: '1', ...env },
      });
    } catch (e) {
      resolve({ ok: false, stdout: '', stderr: String(e?.message || e), stalled: false, ms: 0 });
      return;
    }
    let stdoutBuf = '';
    let stderrTail = '';
    let lastActivity = Date.now();
    let stalled = false;
    let settled = false;
    const feed = (chunk, isErr) => {
      lastActivity = Date.now();
      const text = String(chunk);
      if (!isErr) { stdoutBuf = (stdoutBuf + text).slice(-1024 * 1024); return; }
      // 进度行用 \r 覆盖刷新：按换行/回车切开逐段回调，末段落进 tail 供失败时示错
      stderrTail = (stderrTail + text).slice(-8192);
      if (typeof onProgress === 'function') {
        for (const line of text.split(/[\r\n]+/)) {
          const t = line.trim();
          if (!t) continue;
          // 回调由调用方提供（进度推送/日志），它抛错会变成 data 事件的未捕获异常
          //   ⇒ 常驻宿主进程被一个进度回调带走。进度只是观测信息，绝不能因它中断传输。
          try { onProgress(t); } catch { /* 进度回调失败不影响执行 */ }
        }
      }
    };
    child.stdout && child.stdout.on('data', (c) => feed(c, false));
    child.stderr && child.stderr.on('data', (c) => feed(c, true));
    // 看门狗只量"距上次输出多久"；没有总时长上限（慢≠异常，卡住才是）
    const tickMs = Math.min(5000, Math.max(1000, Math.floor(stallLimit / 4)));
    // 结束整个进程组（含 git 派生的传输子进程）；组的创建见 spawn 的 detached
    const signal = (sig) => {
      try {
        if (groupKill && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        try { child.kill(sig); } catch { /* 已退出 */ }
      }
    };
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity <= stallLimit) return;
      stalled = true;
      signal('SIGTERM');
      // 宽限 3 秒仍未退出则强杀，避免残留子进程挂住调用方的 job
      const killer = setTimeout(() => { signal('SIGKILL'); }, 3000);
      if (killer && typeof killer.unref === 'function') killer.unref();
    }, tickMs);
    const finish = (code, errMsg) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      const ok = !stalled && code === 0;
      const errText = stalled
        ? `连续 ${Math.round(stallLimit / 1000)}s 无任何进展，已结束（可重试续传，已下载部分不丢）`
        : String(errMsg || stderrTail.trim() || `git 退出码 ${code}`);
      resolve({ ok, stdout: ok ? stdoutBuf.trim() : '', stderr: ok ? '' : errText, stalled, ms: Date.now() - startedAt });
    };
    child.on('error', (e) => finish(null, String(e?.message || e)));
    child.on('close', (code) => finish(code, ''));
  });
}
