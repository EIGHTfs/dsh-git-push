/**
 * npm 发包编排（发包 API 与工具的共用实现）。
 *
 * 三条闸门（缺一不可）：
 *   ① 默认 `dryRun=true` —— 只做体检 + `npm publish --dry-run`（打包预演，**不写 registry**）；
 *   ② 真发（`dryRun:false`）必须由上层显式传 `confirm:true`，否则本模块直接拒绝；
 *   ③ 真发前先体检：`private:true` 拦截、同名版本占用检测、`npm pack --dry-run` 文件清单。
 * 凭据：一律 `--userconfig` 指向插件物化的 0600 npmrc（不碰用户全局 ~/.npmrc、token 不进仓库）。
 */
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { credentialsDir, readNpmToken } from '../core/credentials.js';
import { DEFAULT_REGISTRY, NPM_TIMEOUT_MS, normalizeRegistry, runNpm } from './registry.js';
import { npmArgs, writeNpmrc } from './npmrc.js';

export const PUBLISH_LOG_FILE = 'npm-publish.log';
export const PUBLISH_TIMEOUT_MS = 300_000;
/** tag 白名单（防把非法值透传给 npm）。 */
export const PUBLISH_TAGS = ['latest', 'beta', 'next', 'alpha', 'rc', 'dev', 'canary'];

const inFlight = new Set();
/** 进行中的发布键（供 UI/测试查询同款语义）。 */
export function publishingKeys() {
  return [...inFlight];
}

/** 目标包信息：读目录里的 package.json（不存在/非法 ⇒ 明确报错，不猜）。 */
export function readPackageInfo(dir = '') {
  const d = String(dir || '').trim();
  if (!d) return { ok: false, error: '未指定目录' };
  try {
    if (!existsSync(d) || !statSync(d).isDirectory()) return { ok: false, error: `不是目录：${d}` };
    const p = join(d, 'package.json');
    if (!existsSync(p)) return { ok: false, error: `目录里没有 package.json：${p}` };
    const pkg = JSON.parse(readFileSync(p, 'utf8'));
    const name = String(pkg.name || '').trim();
    const version = String(pkg.version || '').trim();
    if (!name || !version) return { ok: false, error: 'package.json 缺 name 或 version' };
    return { ok: true, dir: d, name, version, private: pkg.private === true, files: Array.isArray(pkg.files) ? pkg.files : [] };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** 该包在 registry 上已发布的版本列表（网络失败 ⇒ ok:false + error，不阻断本地体检）。 */
export async function fetchPublishedVersions({ name, registry = DEFAULT_REGISTRY, timeoutMs = NPM_TIMEOUT_MS } = {}) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, versions: [], error: '包名为空' };
  const base = normalizeRegistry(registry);
  // scoped 包路径：@scope/name ⇒ @scope%2Fname（其余按原名）
  const path = n.startsWith('@') ? n.replace('/', '%2F') : encodeURIComponent(n);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/${path}`, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (res.status === 404) return { ok: true, versions: [], error: '' }; // 包还没发过
    if (!res.ok) return { ok: false, versions: [], error: `registry 返回 ${res.status}` };
    const j = await res.json();
    return { ok: true, versions: Object.keys(j?.versions || {}), error: '' };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return { ok: false, versions: [], error: aborted ? `查询超时（${timeoutMs}ms）` : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** 打包预演：`npm pack --dry-run --json`（拿到真实打进包的文件清单与体积）。 */
export function packDryRun({ dir, registry = DEFAULT_REGISTRY, workspaceRoot = '', token = '', timeoutMs = PUBLISH_TIMEOUT_MS } = {}) {
  try {
    const merged = { ...process.env };
    const rc = writeNpmrc({ workspaceRoot, registry, token });
    if (!rc.ok) return { ok: false, error: rc.error || 'npmrc 写入失败' };
    const r = runNpm(['pack', '--dry-run', '--json', ...npmArgs({ npmrcFile: rc.file, registry })], { timeoutMs, env: merged });
    if (!r.ok) return { ok: false, error: r.error || 'npm pack --dry-run 失败', stdout: r.stdout };
    let info = null;
    try {
      // npm 可能先打 notice 行再打 JSON ⇒ 从第一个 [ / { 处截取，稳健解析（实测 --json 会夹 notice）
      const text = String(r.stdout || '');
      const at = text.search(/[[{]/);
      const j = JSON.parse(at >= 0 ? text.slice(at) : text);
      info = Array.isArray(j) ? j[0] : j;
    } catch { /* 非 JSON 输出：保留 stdout 供排查 */ }
    return { ok: true, files: (info && Array.isArray(info.files)) ? info.files.map((f) => f.path) : [], size: (info && info.size) || 0, filename: (info && info.filename) || '' };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** 追加发布日志（0600 目录内，留痕不落库）。 */
function appendPublishLog(line, { workspaceRoot = '' } = {}) {
  try {
    const file = join(credentialsDir({ workspaceRoot }), PUBLISH_LOG_FILE);
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
    return file;
  } catch {
    return '';
  }
}

/**
 * 发包主流程（async：含 registry 占用查询）。
 * @param {object} o { dir, registry, workspaceRoot, dryRun=true, tag='latest', otp='', confirm=false, skipPreflight=false }
 * @returns {Promise<object>} 回执：{ ok, dryRun, blocked?, name, version, packList, versionTaken, ... }
 */
export async function publishPackage({
  dir = '', registry = DEFAULT_REGISTRY, workspaceRoot = '',
  dryRun = true, tag = 'latest', otp = '', confirm = false, timeoutMs = PUBLISH_TIMEOUT_MS,
} = {}) {
  const info = readPackageInfo(dir);
  if (!info.ok) return { ok: false, error: info.error };
  if (!dryRun && confirm !== true) {
    return { ok: false, blocked: 'need-confirm', error: '真实发布会写入 registry 且不可撤销：需同时传 confirm:true 与 dryRun:false' };
  }
  const tg = String(tag || 'latest').trim() || 'latest';
  if (!PUBLISH_TAGS.includes(tg)) return { ok: false, error: `不支持的 tag：${tg}（允许：${PUBLISH_TAGS.join(' / ')}）` };
  const reg = normalizeRegistry(registry);

  const key = `${info.dir}|${info.name}@${info.version}`;
  if (inFlight.has(key)) return { ok: false, error: `同一版本正在发布中：${info.name}@${info.version}` };
  inFlight.add(key);
  try {
    const token = (() => { try { return readNpmToken({ workspaceRoot }); } catch { return ''; } })();
    // 体检①：private:true 会被 npm 拒绝（提前给结论，省一次网络）
    if (info.private) return { ok: false, blocked: 'private-true', name: info.name, version: info.version, error: 'package.json 标了 private:true ⇒ npm publish 会被拒绝（去掉该字段或改用私有 registry）' };
    // 体检②：同名版本是否已存在
    const pub = await fetchPublishedVersions({ name: info.name, registry: reg, timeoutMs: NPM_TIMEOUT_MS });
    const versionTaken = pub.ok && pub.versions.includes(info.version);
    if (versionTaken) {
      return { ok: false, blocked: 'version-taken', name: info.name, version: info.version, versions: pub.versions, error: `${info.name}@${info.version} 已存在于 registry ⇒ 先升版本号再发` };
    }
    // 体检③：打包预演（真实文件清单）
    const pack = packDryRun({ dir: info.dir, registry: reg, workspaceRoot, token, timeoutMs });
    if (!pack.ok) return { ok: false, blocked: 'pack-failed', name: info.name, version: info.version, error: pack.error, packStdout: String(pack.stdout || '').slice(-2000) };
    if (!pack.files.length) return { ok: false, blocked: 'empty-pack', name: info.name, version: info.version, error: 'npm pack 清单为空（检查 files 字段）' };

    const rc = writeNpmrc({ workspaceRoot, registry: reg, token });
    if (!rc.ok) return { ok: false, error: rc.error || 'npmrc 写入失败' };
    const args = ['publish', ...npmArgs({ npmrcFile: rc.file, registry: reg }), '--tag', tg];
    if (dryRun) args.push('--dry-run');
    if (otp) args.push('--otp', String(otp));

    const logPath = appendPublishLog(`publish START dryRun=${dryRun} ${info.name}@${info.version} tag=${tg} files=${pack.files.length}`, { workspaceRoot });
    const r = runNpm(args, { timeoutMs, env: { NO_UPDATE_NOTIFIER: '1' } });
    appendPublishLog(`publish END dryRun=${dryRun} ok=${r.ok} code=${r.code} err=${String(r.error || '').slice(0, 200)}`, { workspaceRoot });
    return {
      ok: !!r.ok,
      dryRun: !!dryRun,
      name: info.name,
      version: info.version,
      tag: tg,
      registry: reg,
      packList: pack.files,
      packSize: pack.size,
      tarball: pack.filename,
      published: !dryRun && !!r.ok,
      registryQuery: { ok: pub.ok, error: pub.error || '' },
      stdout: String(r.stdout || '').slice(-4000),
      stderr: String(r.stderr || '').slice(-4000),
      logPath,
      error: r.ok ? '' : (r.error || 'npm publish 失败'),
    };
  } finally {
    inFlight.delete(key);
  }
}
