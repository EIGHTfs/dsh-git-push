/**
 * Git 执行层 · 本地仓库「增量扫描运行器」
 *
 * 账号卡片「本地 → 扫描」的运行时（2026-09-16）：
 *   **独立进程后台扫描 + 前端只读新增 diff（非轮询、靠进度文件版本）。**
 *
 * 三要素：
 *   1) spawn 独立进程跑 scripts/scan-repos.mjs（系统级后台，不卡宿主/主进程）；
 *   2) 进程每扫到一个 author(owner) 一致的仓库 → 增量写 scan-live.json
 *      （version 递增 + found 追加），并同步把该仓库并入 dsh-repo-index.json；
 *   3) 宿主用 fs.watchFile 监听 scan-live.json 变化，变化即唤醒 waiters——
 *      前端「等待新版本」请求挂起，直到 version > 已见数或扫描结束才返回新增
 *      （非轮询：有新数据才返回，前端只追加变化部分，不全量重读）。
 *
 * 扫描中不可重复启动：running 标志 + alreadyRunning。
 * 文件：$DSH_HOME/git-push/scan-live.json（{ version, found:[..], done, startedAt }）
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, watchFile, unwatchFile } from 'node:fs';
import { credentialsDir } from './credentials.js';

const LIVE_FILE = 'scan-live.json';
const WATCH_INTERVAL = 300;

/** 扫描运行器模块级单例（跨请求共享状态）。 */
export const scanRunner = {
  running: false,       // 是否有扫描在跑（防重复点击）
  currentScanId: '',
  baseFound: [],        // 启动时已见 found（前端从这之后算新增）
  lastError: '',
  waiters: [],          // [{ resolve }]
};

/** 进度文件路径。 */
export function scanLiveFile({ workspaceRoot = '' } = {}) {
  return join(credentialsDir({ workspaceRoot }), LIVE_FILE);
}

/** 空进度快照（scan-live.json 缺失/损坏时兜底）。 */
function emptyLive() {
  return { version: 0, found: [], startedAt: '', done: false };
}

/** 读当前进度快照。 */
export function readScanLive({ workspaceRoot = '' } = {}) {
  try {
    const p = scanLiveFile({ workspaceRoot });
    if (!existsSync(p)) return emptyLive();
    const snap = JSON.parse(readFileSync(p, 'utf8'));
    return {
      version: Number(snap.version) || 0,
      found: Array.isArray(snap.found) ? snap.found : [],
      startedAt: String(snap.startedAt || ''),
      done: !!snap.done,
    };
  } catch { return emptyLive(); }
}

/** 重置独立进程的进度起点（扫描启动前调用，清空旧 found）。 */
export function resetScanLive({ workspaceRoot = '' } = {}) {
  const p = scanLiveFile({ workspaceRoot });
  try {
    const dir = dirname(p); mkdirSync(dir, { recursive: true });
    const tmpPath = `${p}.${process.pid}.tmp`;
    writeFileSync(tmpPath, JSON.stringify({ version: 0, found: [], startedAt: new Date().toISOString(), done: false }, null, 2) + '\n', 'utf8');
    renameSync(tmpPath, p);
  } catch { /* 尽力而为 */ }
  scanRunner.baseFound = [];
}

/**
 * spawn 独立进程跑离线扫描 scripts/scan-repos.mjs。
 * 立即返回 { ok, started, scanId, baseFound }；已有扫描在跑 → { alreadyRunning: true }。
 * 独立进程每写一次 scan-live.json → fs.watchFile 唤醒 waiters（见 waitScanDelta）。
 */
export function runScan({ root = '', owner = 'EIGHTfs', workspaceRoot = '' } = {}) {
  if (scanRunner.running) return { alreadyRunning: true };
  // 脚本路径：<repo>/scripts/scan-repos.mjs（本文件 <repo>/lib/git/ 上溯两级）
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'scan-repos.mjs');
  if (!existsSync(script)) return { ok: false, error: `扫描脚本不存在: ${script}` };

  resetScanLive({ workspaceRoot });
  scanRunner.running = true;
  scanRunner.currentScanId = `scan-${Date.now()}`;
  scanRunner.lastError = '';
  scanRunner.waiters = [];
  const scanId = scanRunner.currentScanId;

  // detached 独立进程：脱离宿主进程组，宿主退出不影响它继续扫完；offline 隔离网络
  const child = spawn(process.execPath, [script, '--root', String(root || ''), '--owner', String(owner || 'EIGHTfs'), '--max', '200', '--depth', '10'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DSH_GIT_PUSH_OFFLINE: '1' },
  });
  child.unref();
  child.stdout?.on('data', (d) => {
    try { process.stdout?.write(`[scan-repos] ${String(d)}`); } catch { /* 日志尽力而为 */ }
  });
  child.on('exit', (code) => {
    scanRunner.lastError = code === 0 ? '' : `扫描退出码 ${code}`;
    scanRunner.running = false;
    // 扫完等 ~800ms 让最后一个写盘落定，再唤醒等待者收尾
    setTimeout(() => notifyWaiters(), 800);
  });

  // fs.watchFile 监听进度文件变化 → 唤醒等待者（非轮询：文件变才通知）
  const fp = scanLiveFile({ workspaceRoot });
  try { watchFile(fp, { interval: WATCH_INTERVAL }, () => notifyWaiters()); } catch { /* 监听失败则靠超时/进程 exit */ }

  return { ok: true, started: true, scanId, baseFound: scanRunner.baseFound.slice(), running: true };
}

/** 唤醒所有等待者（独立进程写了新进度 / 扫描结束 / 文件变化）。 */
function notifyWaiters() {
  const ws = scanRunner.waiters;
  if (!ws || !ws.length) return;
  scanRunner.waiters = [];
  for (const waiter of ws) waiter.resolve();
}

/**
 * 等待新版本（非轮询）：挂起请求直到 scan-live.json 有新仓库（found 多了）或扫描结束。
 * from 传「已见仓库数」；返回本次新增的仓库名数组（前端只追加这些，不全量重读）。
 */
export async function waitScanDelta({ from = 0, timeoutMs = 60_000, workspaceRoot = '' } = {}) {
  const fromN = Number(from) || 0;
  return new Promise((resolve) => {
    const collect = () => {
      const live = readScanLive({ workspaceRoot });
      return {
        newest: (live.found || []).slice(fromN),
        version: Number(live.version) || 0,
        done: !!live.done,
        running: scanRunner.running,
        timeout: false,
      };
    };
    let settled = false;
    const settle = () => { if (settled) return; settled = true; cleanup(); resolve(collect()); };
    const timeout = setTimeout(() => {
      if (settled) return; settled = true; cleanup();
      const live = readScanLive({ workspaceRoot });
      resolve({ newest: [], version: Number(live.version) || 0, done: !!live.done, running: scanRunner.running, timeout: true });
    }, timeoutMs);
    const cleanup = () => { clearTimeout(timeout); };
    // 立即查一次：已有新增或已 done 则直接返回
    const live = readScanLive({ workspaceRoot });
    if ((live.found || []).length > fromN || live.done) { settle(); return; }
    scanRunner.waiters.push({ resolve: settle });
  });
}

/** 清理 fs 监听（测试/重置用）。正常运行时进程退出自动收敛，不必显式调。 */
export function stopScanWatch({ workspaceRoot = '' } = {}) {
  const fp = scanLiveFile({ workspaceRoot });
  try { unwatchFile(fp); } catch { /* 忽略 */ }
}