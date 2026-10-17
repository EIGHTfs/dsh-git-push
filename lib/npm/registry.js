/**
 * npm registry 只读探测（Step 2）：登录态 / registry 归一化 / 包搜索。
 *
 * 约定：一律调 npm CLI 或 registry 官方 search 端点；**短超时**（默认 8s）；只读、不写全局配置；
 *   失败不抛错，规整成 `{ ok:false, error }` 供 UI 显示可读文案（网络不稳时可降级为手输包名）。
 */
import { spawnSync } from 'node:child_process';
import { accessSync, constants as FS } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';
export const NPM_TIMEOUT_MS = 8000;

/** registry 归一化：空/非法 ⇒ 官方源；去掉尾部斜杠。 */
export function normalizeRegistry(v = '') {
  const s = String(v || '').trim();
  if (!s) return DEFAULT_REGISTRY;
  try {
    return new URL(s).toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_REGISTRY;
  }
}

/**
 * 解析 npm 可执行文件（**不写死绝对路径**）：NPM_BIN 环境变量 → PATH 逐目录探测 →
 *   由 `process.execPath` 派生的常见同装位置（`<node>/npm`、`<node>/../.local/bin/npm`、`<node>/../bin/npm`）。
 * 为什么需要：宿主进程的 PATH 未必包含 npm（本机 npm 装在 DSH 包目录下的 `.local/bin`），
 *   直接 `spawnSync('npm')` 会 ENOENT ⇒ whoami 永远失败 ⇒ 账号卡显示「未配置/校验未过」（实测症状）。
 * @returns {string} 可执行文件路径；都找不到时返回 'npm'（交回 spawn 自己按 PATH 找）
 */
export function resolveNpmBin({ env = process.env } = {}) {
  if (env.NPM_BIN) return String(env.NPM_BIN);
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  const probe = (p) => {
    try { accessSync(p, FS.X_OK); return true; } catch { return false; }
  };
  for (const d of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const e of exts) {
      const p = join(d, `npm${e}`);
      if (probe(p)) return p;
    }
  }
  const nodeDir = dirname(String(process.execPath || ''));
  const candidates = [
    join(nodeDir, 'npm'),
    join(nodeDir, '..', '.local', 'bin', 'npm'),
    join(nodeDir, '..', 'bin', 'npm'),
    '/usr/local/bin/npm',
    '/usr/bin/npm',
  ];
  for (const p of candidates) if (probe(p)) return p;
  return 'npm';
}

/**
 * npm 子进程输出上限。默认 1MB 对大项目的 pack 清单偏小 —— 实测撞过 ENOBUFS。
 */
const NPM_MAX_BUFFER = 16 * 1024 * 1024;
// ENOBUFS 重试上限：npm 在大依赖树上（npm ls / npm view 等）输出可能超过 16MB，
//   一旦超限 spawnSync 直接以 ENOBUFS 失败——对调用方表现为「npm 调用失败」，无法自解。
//   故首次超限后**放大缓冲重试一次**，仍失败才如实报错（并把「输出过大」这个真因写进文案）。
const NPM_MAX_BUFFER_LARGE = 128 * 1024 * 1024;

/**
 * 跑一次 npm（短超时，收 stdout/stderr；不抛错）。
 * @param {string[]} args npm 参数
 * @param {{timeoutMs?:number, env?:object, cwd?:string}} [opts]
 *   cwd：**必须在目标包目录里跑的调用要显式传**（`npm pack` / `npm publish` 都以 cwd 为目标包）。
 *        不传就继承宿主进程的工作目录 —— 实测后果是 npm 去错目录找 package.json：
 *        该目录没有 package.json ⇒ ENOENT；有 ⇒ 去 pack 那整棵树 ⇒ 输出撑爆缓冲区 ⇒ ENOBUFS。
 * @returns {{ok:boolean, code:number, stdout?:string, stderr?:string, error?:string}}
 */
export function runNpm(args = [], { timeoutMs = NPM_TIMEOUT_MS, env = {}, cwd = '', maxBuffer } = {}) {
  const merged = { ...process.env, ...env };
  // 关键：npm 的入口是 `#!/usr/bin/env node` 脚本 ⇒ 子进程 PATH 里必须有 node，
  //   否则即使找到 npm 也会报「env: 'node': No such file or directory」（最小 PATH 宿主实测）。
  //   插到 PATH **末尾**：既保证 node 可找到，又不覆盖调用方/测试注入的 PATH 优先级
  //   （插最前会在 GitHub runner 上让 nodeDir 自带的真 npm 抢先于测试注入的假 npm）。
  const nodeDir = dirname(String(process.execPath || ''));
  if (nodeDir && !String(merged.PATH || '').split(delimiter).includes(nodeDir)) {
    merged.PATH = `${merged.PATH || ''}${delimiter}${nodeDir}`;
  }
  const bin = resolveNpmBin({ env: merged });
  // maxBuffer 可注入：默认 16MB；测试传极小值（如 1）即可**确定性触发** ENOBUFS 走重试分支 ✓
  const runNpmBuf = (buf) => spawnSync(bin, args, {
    encoding: 'utf8', timeout: timeoutMs, env: merged, maxBuffer: buf,
    ...(cwd ? { cwd } : {}),
  });
  const first = Number.isFinite(maxBuffer) && maxBuffer > 0 ? maxBuffer : NPM_MAX_BUFFER;
  let r = runNpmBuf(first);
  if (r.error && r.error.code === 'ENOBUFS') r = runNpmBuf(NPM_MAX_BUFFER_LARGE);
  if (r.error) {
    const timedOut = r.error.code === 'ETIMEDOUT';
    return { ok: false, code: -1, bin, error: timedOut ? `npm 超时（${timeoutMs}ms）` : `npm 调用失败（${bin}）：${String(r.error.message || r.error)}` };
  }
  const stdout = String(r.stdout || '').trim();
  const stderr = String(r.stderr || '').trim();
  return {
    ok: r.status === 0,
    code: typeof r.status === 'number' ? r.status : -1,
    bin,
    stdout,
    stderr,
    error: r.status === 0 ? '' : (stderr || stdout || `npm 退出码 ${r.status}`),
  };
}

/** 解析 `npm whoami` 输出（纯函数）：取最后一行非空文本（npm 会先打日志再打用户名）。 */
export function parseWhoami(text = '') {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

/** 登录态：`npm whoami`；未登录/无 token 时返回 ok:false + 可读错误。 */
export function whoami({ npmArgs = [], timeoutMs = NPM_TIMEOUT_MS, env = {} } = {}) {
  const r = runNpm(['whoami', ...npmArgs], { timeoutMs, env });
  if (!r.ok) return { ok: false, user: '', error: r.error || 'npm whoami 失败' };
  const user = parseWhoami(r.stdout);
  return user ? { ok: true, user, error: '' } : { ok: false, user: '', error: 'npm whoami 无输出' };
}

/**
 * 列出某账号名下的包（对齐 GitHub 的「云端仓库列表」）。
 * 端点口径：registry 官方 search 支持 `text=maintainer:<user>` 与 `text=author:<user>`；
 *   两路结果合并去重（同名取先到的 latest），失败/无结果返回空数组 + error（不抛错）。
 * ⚠️ 覆盖范围：公开包。私有/需鉴权的包 Search 端点看不到 ⇒ 由前端提供「手输包名安装」兜底。
 */
export async function listOwnedPackages(user, { registry = DEFAULT_REGISTRY, timeoutMs = NPM_TIMEOUT_MS, size = 50 } = {}) {
  const who = String(user || '').trim();
  if (!who) return { ok: false, results: [], error: '未获取到登录用户名（先配置 npm token 并刷新）' };
  const queries = [`maintainer:${who}`, `author:${who}`];
  const seen = new Map();
  let lastErr = '';
  for (const q of queries) {
    const r = await searchPackages(q, { registry, timeoutMs, size });
    if (!r.ok) { lastErr = r.error || lastErr; continue; }
    for (const p of r.results) if (!seen.has(p.name)) seen.set(p.name, p);
  }
  const results = [...seen.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return { ok: true, results, error: results.length ? '' : (lastErr || `未在 registry 找到 ${who} 名下的公开包`) };
}
export async function searchPackages(q, { registry = DEFAULT_REGISTRY, timeoutMs = NPM_TIMEOUT_MS, size = 20 } = {}) {
  const text = String(q || '').trim();
  if (!text) return { ok: false, results: [], error: '搜索词为空' };
  const base = normalizeRegistry(registry);
  const n = Math.max(1, Math.min(50, Number(size) || 20));
  const url = `${base}/-/v1/search?text=${encodeURIComponent(text)}&size=${n}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, results: [], error: `registry 返回 ${res.status}` };
    const j = await res.json();
    const results = (Array.isArray(j?.objects) ? j.objects : [])
      .map((o) => ({
        name: o?.package?.name || '',
        version: o?.package?.version || '',
        description: o?.package?.description || '',
        date: o?.package?.date || '',
        npmUrl: o?.package?.links?.npm || '',
      }))
      .filter((x) => x.name);
    return { ok: true, results, error: '' };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return { ok: false, results: [], error: aborted ? `搜索超时（${timeoutMs}ms）` : String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}
