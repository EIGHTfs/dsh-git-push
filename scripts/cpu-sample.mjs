#!/usr/bin/env node
/**
 * CPU 现场采样器（独立脚本，按需启动；零依赖、只读 /proc）。
 *
 * 用途：CPU 异常（如经常 50%+）时**现场**抓证据——事后采样复现不出来，
 *   必须在「异常正在发生」的那一刻记录：哪个进程、什么命令行、系统总占用、
 *   是否 chrome/headless 在跑、宿主进程内存等。
 *
 * 为什么不做成插件常驻任务：30s 常驻采样虽便宜，但平时没人看，反而多一份常驻逻辑；
 *   按需启动最省事，也不给宿主添负担。
 *
 * 用法：
 *   node scripts/cpu-sample.mjs                     # 默认 120 秒、每 5 秒一次
 *   node scripts/cpu-sample.mjs --seconds 300 --interval 2 --top 8
 *   node scripts/cpu-sample.mjs --out /tmp/cpu.jsonl --high 40
 *
 * 输出：① 控制台一行一样本（系统% + Top 进程）② JSONL 明细（每样本一行，含命令行）
 *      ③ 结束打印汇总（峰值、Top 常客、chrome 出现次数）与 JSONL 路径。
 *
 * 判定口径：进程 CPU% = 该进程 tick 增量 / 全机 tick 增量 × 100（= 占整机百分比，
 *   与 top 的聚合口径一致）；系统% = 1 - idle 增量/总增量。
 */
import { readdirSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { cpus, loadavg, hostname } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const SECONDS = Math.max(5, Number(arg('seconds', 120)) || 120);
const INTERVAL = Math.max(1, Number(arg('interval', 5)) || 5);
const TOP = Math.max(3, Number(arg('top', 6)) || 6);
const HIGH = Number(arg('high', 40)) || 40;
const OUT = String(arg('out', '') || '') || `/tmp/cpu-sample-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
const NCPU = cpus().length || 1;

/** 读 /proc/stat 的 cpu 汇总行 → { total, idle }（单位：tick）。 */
function cpuTotals() {
  try {
    const line = readFileSync('/proc/stat', 'utf8').split('\n')[0] || '';
    const f = line.trim().split(/\s+/).slice(1).map(Number);
    const total = f.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const idle = (f[3] || 0) + (f[4] || 0); // idle + iowait
    return { total, idle };
  } catch { return { total: 0, idle: 0 }; }
}

/** 读某进程累计 CPU tick（utime+stime）。comm 可能含空格/括号 ⇒ 取最后一个 ')' 之后解析。 */
function procTicks(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = s.slice(s.lastIndexOf(')') + 2).trim().split(/\s+/);
    // rest[0] = state ⇒ utime 是第 12 个字段（1-based 14）⇒ rest 下标 11、12
    return (Number(rest[11]) || 0) + (Number(rest[12]) || 0);
  } catch { return null; }
}

/** 某进程常驻内存 MB（statm 第 2 项 = resident pages）。 */
function procRssMB(pid) {
  try {
    const f = readFileSync(`/proc/${pid}/statm`, 'utf8').trim().split(/\s+/);
    return Math.round(((Number(f[1]) || 0) * 4096) / 1048576);
  } catch { return 0; }
}

/** 进程名与命令行（cmdline 为 NUL 分隔；截断到 160 字符）。 */
function procInfo(pid) {
  let comm = '';
  let cmd = '';
  try { comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { /* 进程可能已退出 */ }
  try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' '); } catch { /* 同上 */ }
  return { comm, cmd: cmd.slice(0, 160) };
}

/** 枚举 /proc 下的数字目录（= 进程）。 */
function pids() {
  try { return readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch { return []; }
}

/** 内存概况（MB）。 */
function memMB() {
  try {
    const t = readFileSync('/proc/meminfo', 'utf8');
    const get = (k) => Number((t.match(new RegExp(`^${k}:\\s+(\\d+) kB`, 'm')) || [])[1] || 0) / 1024;
    return { total: Math.round(get('MemTotal')), available: Math.round(get('MemAvailable')) };
  } catch { return { total: 0, available: 0 }; }
}

let prev = null; // { t: {total,idle}, pids: Map<pid, ticks> }
let hostPid = null;
const samples = [];

function detectHostPid() {
  for (const p of pids()) {
    const { cmd } = procInfo(p);
    if (cmd.includes('packages/DeepSeekHarness-NAS/target/bin/node')) return Number(p);
  }
  return null;
}

/** 采一次样并返回记录（纯读，不抛错）。 */
function sampleOnce() {
  const now = cpuTotals();
  const cur = new Map();
  for (const p of pids()) {
    const t = procTicks(p);
    if (t !== null) cur.set(p, t);
  }
  const rec = {
    t: new Date().toISOString(),
    ncpu: NCPU,
    systemPct: null,
    load: loadavg().map((x) => Number(x.toFixed(2))),
    mem: memMB(),
    host: null,
    chrome: 0,
    browsersvc: 0,
    top: [],
  };
  if (prev && now.total > prev.t.total) {
    const dTot = now.total - prev.t.total;
    const dIdle = now.idle - prev.t.idle;
    rec.systemPct = Number((100 * (1 - dIdle / dTot)).toFixed(1));
    const list = [];
    for (const [pid, ticks] of cur) {
      const old = prev.pids.get(pid);
      if (old === undefined) continue; // 新进程首个样本跳过（无基线）
      const d = ticks - old;
      if (d <= 0) continue;
      const pct = Number(((100 * d) / dTot).toFixed(1));
      if (pct < 0.2) continue;
      const info = procInfo(pid);
      list.push({ pid: Number(pid), pct, rssMB: procRssMB(pid), ...info });
    }
    list.sort((a, b) => b.pct - a.pct);
    rec.top = list.slice(0, TOP);
    rec.chrome = list.filter((x) => /chrome|headless/i.test(x.comm)).length;
    rec.browsersvc = list.filter((x) => /browsersvc/i.test(x.cmd) && !/cpu-sample/.test(x.cmd)).length;
    if (hostPid === null) hostPid = detectHostPid();
    const h = hostPid ? list.find((x) => x.pid === hostPid) : null;
    rec.host = h ? { pid: h.pid, pct: h.pct, rssMB: h.rssMB } : (hostPid ? { pid: hostPid, pct: 0, rssMB: procRssMB(hostPid) } : null);
  }
  prev = { t: now, pids: cur };
  return rec;
}

function line(rec) {
  const hi = rec.systemPct !== null && rec.systemPct >= HIGH;
  const head = `${rec.t.slice(11, 19)}  系统 ${rec.systemPct === null ? '--' : `${rec.systemPct}%`}  load ${rec.load[0]}  mem ${rec.mem.available}/${rec.mem.total}MB  chrome ${rec.chrome}  browsersvc ${rec.browsersvc}`;
  const tops = rec.top.slice(0, 4).map((x) => `${x.comm}:${x.pct}%`).join('  ');
  return `${hi ? '⚠️ 高占用 ' : '         '}${head}${tops ? `  |  ${tops}` : ''}`;
}

// ── 主流程 ──
console.log(`CPU 现场采样器 · 主机 ${hostname()} · ${NCPU} 核 · 每 ${INTERVAL}s 一次 · 共 ${SECONDS}s · 高占用阈值 ${HIGH}%`);
console.log(`输出 JSONL：${OUT}`);
sampleOnce(); // 建立基线（首样本无百分比）
let n = 0;
const timer = setInterval(() => {
  const rec = sampleOnce();
  n += 1;
  samples.push(rec);
  console.log(line(rec));
  try { appendFileSync(OUT, `${JSON.stringify(rec)}\n`); } catch { /* 写失败不影响采样 */ }
  if (n * INTERVAL >= SECONDS) finish();
}, INTERVAL * 1000);

function finish() {
  clearInterval(timer);
  const withPct = samples.filter((s) => s.systemPct !== null);
  const peak = withPct.reduce((m, s) => Math.max(m, s.systemPct), 0);
  const counter = new Map();
  for (const s of withPct) for (const x of s.top) counter.set(x.comm, (counter.get(x.comm) || 0) + x.pct);
  const regulars = [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([c, v]) => `${c}(${Math.round(v)}%)`);
  const chromeHits = withPct.filter((s) => s.chrome > 0).length;
  console.log('\n── 汇总 ──');
  console.log(`样本数 ${withPct.length} · 系统峰值 ${peak}% · 平均 ${withPct.length ? (withPct.reduce((a, s) => a + s.systemPct, 0) / withPct.length).toFixed(1) : 0}%`);
  console.log(`chrome/headless 出现样本数：${chromeHits}/${withPct.length}`);
  console.log(`Top 常客（按累计 %）：${regulars.join(' · ') || '(无)'}`);
  console.log(`明细：${OUT}`);
  process.exit(0);
}

// Ctrl-C 也能出汇总
process.on('SIGINT', finish);
