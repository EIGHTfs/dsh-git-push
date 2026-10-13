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
 * 跑一次 npm（短超时，收 stdout/stderr；不抛错）。
 * @returns {{ok:boolean, code:number, stdout?:string, stderr?:string, error?:string}}
 */
export function runNpm(args = [], { timeoutMs = NPM_TIMEOUT_MS, env = {} } = {}) {
  const merged = { ...process.env, ...env };
  // 关键：npm 的入口是 `#!/usr/bin/env node` 脚本 ⇒ 子进程 PATH 里必须有 node，
  //   否则即使找到 npm 也会报「env: 'node': No such file or directory」（最小 PATH 宿主实测）。
  //   这里把当前进程的 node 目录放到 PATH 最前，保证 npm 一定能起来。
  const nodeDir = dirname(String(process.execPath || ''));
  if (nodeDir) merged.PATH = `${nodeDir}${delimiter}${merged.PATH || ''}`;
  const bin = resolveNpmBin({ env: merged });
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: timeoutMs, env: merged });
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
