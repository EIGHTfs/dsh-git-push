/**
 * 镜像候选清单与「按健康度选镜像」（模仿 dsh-useful-tools 的 github-mirror 设计）。
 *
 * 为什么需要候选清单：单一镜像被写死（旧实现硬编码 gh-proxy.com）时，一旦该镜像
 *   **返回坏数据**——实测它对一个 8MB 文件给过 total=590454 的截断缓存——整条克隆链路
 *   都会卡在同一处。写死单点没有退路，而「换一个镜像」是唯一能立刻绕开的手段。
 *
 * 与 useful-tools 那套的分工（避免重复建设）：
 *   · useful-tools 的候选清单作用于 **git 层**（`url.<镜像>.insteadOf` 重写）；
 *   · 本模块作用于**插件自己的 HTTP 只读通道**（raw / codeload / api 的 GET），
 *     由 lib/core/endpoints.js 的 withMirror() 拼接前缀。两者各自收口、互不干扰。
 *
 * 清单分两层，刻意分开：
 *   · **出厂清单** `mirror-candidates.json`（随仓库入库）：只写「有哪些镜像、优先级」，
 *     运行期的失败计数不回写它 —— 否则部署副本被 sync 覆盖、仓库被学习结果弄脏；
 *   · **学习状态** `<配置目录>/mirror-state.json`：每个镜像的 failures / disabled /
 *     lastOkAt / lastError。运行期只写这份。
 *
 * 选择策略（mirrorPrefix 每次调用都走这里）：
 *   1. 环境变量 `DSH_GIT_MIRROR_PREFIX` 显式给值 → 用它（人工钉死，最高优先）；
 *      设为 off/none/no/false/0/- → 关闭镜像；
 *   2. 否则取**未停用**且按清单顺序的第一个镜像；
 *   3. 全部停用 → 返回空串（走直连）——宁可不加速，也不用一个已知会返回坏数据的源。
 *
 * 失败累计：连续失败达 MAX_FAILURES(3) 次置 disabled；一次成功清零。
 *   停用不是永久的：`probe` 成功即恢复（见 probeAll）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** raw 基址（用于探测；与 endpoints.js 的 GH_RAW 同值，此处内联以保持单向依赖、避免循环 import）。 */
const PROBE_RAW_BASE = 'https://raw.githubusercontent.com';
/**
 * 进程内缓存：下载是热路径（7374 个文件 ⇒ 每文件都问一次「用哪个镜像」），
 *   每次读两个 JSON 在 CIFS 上会显著拖慢。缓存选择结果与学习状态，写状态时同步刷新。
 *   TTL 只影响「别的进程改了状态本进程多久能看到」，5s 足够（本进程的写入立即生效）。
 */
const CACHE_TTL_MS = 5000;
let pickCache = { key: '', value: '', at: 0 };
let stateCache = { key: '', value: null, at: 0 };
/** 出厂清单位置（随仓库入库，只读种子）。 */
export const SEED_PATH = join(HERE, 'mirror-candidates.json');
/** 连续失败多少次停用（可在状态文件里手改单条 disabled 覆盖）。 */
export const MAX_FAILURES = 3;
/** 显式关闭镜像的取值。 */
const MIRROR_OFF = new Set(['off', 'none', 'no', 'false', '0', '-']);

/** 归一化前缀：去空白、强制以 / 结尾（withMirror 是纯字符串拼接，缺斜杠会拼出坏 URL）。 */
export function normalizeMirror(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  return text.endsWith('/') ? text : `${text}/`;
}

/**
 * 学习状态文件位置。默认在配置目录（与凭据同处），可被
 * `DSH_GIT_MIRROR_STATE` 覆盖——测试据此指向临时文件，不污染真实状态。
 */
export function statePath({ configDir = '' } = {}) {
  const override = String(process.env.DSH_GIT_MIRROR_STATE || '').trim();
  if (override) return override;
  const dir = configDir || (process.env.DSH_HOME ? join(process.env.DSH_HOME, 'git-push') : '');
  return dir ? join(dir, 'mirror-state.json') : '';
}

/** 读出出厂清单。文件缺失/损坏 → 空清单（调用方回退直连，不崩）。 */
export function readSeed(path = SEED_PATH) {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const list = Array.isArray(raw?.candidates) ? raw.candidates : [];
    return list
      .map((it) => ({ mirror: normalizeMirror(it?.mirror), note: it?.note || '' }))
      .filter((it) => it.mirror);
  } catch { return []; }
}

/** 读学习状态（mirror → {failures, disabled, lastOkAt, lastError}）。缺失/损坏 → 空表。 */
export function readState(path = statePath()) {
  if (!path) return {};
  try {
    if (!existsSync(path)) return {};
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const mirrors = raw && typeof raw.mirrors === 'object' && raw.mirrors ? raw.mirrors : {};
    const out = {};
    for (const [k, v] of Object.entries(mirrors)) {
      const key = normalizeMirror(k);
      if (!key) continue;
      out[key] = {
        failures: Math.max(0, Math.trunc(Number(v?.failures) || 0)),
        disabled: v?.disabled === true,
        lastOkAt: v?.lastOkAt ?? null,
        lastError: v?.lastError ?? null,
      };
    }
    return out;
  } catch { return {}; }
}

/** 原子写学习状态（失败静默：状态是加速用的元数据，写不进去不影响下载主流程）。 */
export function writeState(state, path = statePath()) {
  if (!path) return { ok: false, error: '状态路径不可用' };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, note: '镜像健康度学习结果（运行期自动维护，可手改 disabled 立即生效）', mirrors: state }, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
    return { ok: true, path };
  } catch (e) { return { ok: false, error: String((e?.message) || e) }; }
}

/**
 * 合并出厂清单与学习状态，产出按优先级排序的候选视图。
 * @returns {Array<{mirror:string, note:string, failures:number, disabled:boolean, lastOkAt:string|null, lastError:string|null}>}
 */
export function listCandidates({ seedPath = SEED_PATH, stateFile = statePath() } = {}) {
  const state = readState(stateFile);
  return readSeed(seedPath).map((it) => {
    const st = state[it.mirror] || {};
    return {
      mirror: it.mirror,
      note: it.note,
      failures: st.failures || 0,
      // 状态里的 disabled 可以与清单叠加：手工把状态文件改成 disabled:true 也能立刻停用
      disabled: st.disabled === true,
      lastOkAt: st.lastOkAt ?? null,
      lastError: st.lastError ?? null,
    };
  });
}

/** 当前应使用的镜像前缀（含环境变量优先级与关闭语义）。空串 = 直连。 */
export function pickMirror({ seedPath, stateFile } = {}) {
  const raw = String(process.env.DSH_GIT_MIRROR_PREFIX ?? '').trim();
  if (raw && MIRROR_OFF.has(raw.toLowerCase())) return '';   // 显式关闭
  if (raw) return normalizeMirror(raw);                       // 显式钉死
  const key = `${seedPath || SEED_PATH}|${stateFile || statePath()}`;
  const now = Date.now();
  if (pickCache.key === key && now - pickCache.at < CACHE_TTL_MS) return pickCache.value;
  const usable = listCandidates({ seedPath, stateFile }).find((it) => !it.disabled);
  const value = usable ? usable.mirror : '';
  pickCache = { key, value, at: now };
  return value;
}

/** 清空进程内缓存（测试与状态变更后强制重读）。 */
export function invalidateMirrorCache() {
  pickCache = { key: '', value: '', at: 0 };
  stateCache = { key: '', value: null, at: 0 };
}

/**
 * 记录一次实际使用的成败（由下载器在「数据校验通过/失败」后调用）。
 *
 * 为什么以**数据校验**而不是 HTTP 状态为判据：坏镜像的表现是 HTTP 200/206 一切正常、
 *   但内容被截断或陈旧 —— 只有 total/sha 校验才能识别。故调用点放在 clone-download。
 * @param {string} mirror 实际使用的镜像前缀
 * @param {{ok:boolean, error?:string, stateFile?:string}} o
 * @returns {{ok:boolean, state?:object, disabled?:boolean}}
 */
export function recordOutcome(mirror, { ok, error = '', stateFile = statePath() } = {}) {
  const key = normalizeMirror(mirror);
  if (!key) return { ok: false };
  const cacheKey = stateFile || statePath();
  const now = Date.now();
  const state = (stateCache.key === cacheKey && stateCache.value && now - stateCache.at < CACHE_TTL_MS)
    ? stateCache.value
    : readState(stateFile);
  const cur = state[key] || { failures: 0, disabled: false, lastOkAt: null, lastError: null };
  const at = new Date().toISOString();
  const next = ok
    ? { failures: 0, disabled: false, lastOkAt: at, lastError: null }
    : {
      failures: cur.failures + 1,
      disabled: cur.failures + 1 >= MAX_FAILURES,
      lastOkAt: cur.lastOkAt ?? null,
      lastError: String(error || '数据校验失败').slice(0, 300),
    };
  state[key] = next;
  // 无变化不写盘：成功且此前无失败记录（下载主流程的常见情形）时直接返回，
  //   否则 7374 个文件会触发 7374 次状态写盘，在 CIFS 上是纯浪费。
  if (ok && cur.failures === 0 && cur.disabled !== true) {
    // 状态无实质变化（累计失败仍是 0、未停用）⇒ 不写盘、也不清选择缓存：
    //   下载主流程每个文件都会走到这里，清缓存会让「选镜像」重新读两份 JSON。
    stateCache = { key: cacheKey, value: state, at: now };
    return { ok: true, state: next, disabled: false };
  }
  const written = writeState(state, stateFile);
  stateCache = { key: cacheKey, value: state, at: now };
  pickCache = { key: '', value: '', at: 0 };   // 状态变了，下一次选择重新计算
  return { ok: written.ok, state: next, disabled: next.disabled === true };
}

/**
 * 主动探测候选（HTTP HEAD 一个必存在的公开文件；带 Range 校验返回的总长是否与声明一致）。
 *
 * 为什么不只判 HTTP 状态：坏镜像恰恰是「状态正常、内容不对」。这里用 Range 请求读回
 *   `content-range` 的 total 与 `content-length` 交叉验证，能识别出「声明长度异常」的缓存。
 * @param {{mirror?:string, stateFile?:string, fetchImpl?:Function, timeoutMs?:number,
 *          probeUrl?:string, expectedBytes?:number}} o
 *        expectedBytes：已知文件字节数；给了就严格校验，不给只判「有响应且非 0 长」。
 */
export async function probeMirror({
  mirror, stateFile = statePath(), fetchImpl = globalThis.fetch, timeoutMs = 8000,
  probeUrl = `${PROBE_RAW_BASE}/octocat/Hello-World/main/README`, expectedBytes = 0,
} = {}) {
  const prefix = normalizeMirror(mirror);
  if (!prefix) return { ok: false, error: '镜像前缀为空', mirror: '' };
  const url = prefix + probeUrl;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method: 'GET', headers: { 'User-Agent': 'dsh-git-push', Range: 'bytes=0-1023' }, signal: ctrl.signal });
    if (!r.ok && r.status !== 206) return { ok: false, mirror: prefix, error: `HTTP ${r.status}` };
    const len = Number(r.headers?.get?.('content-length')) || 0;
    const cr = String(r.headers?.get?.('content-range') || '');
    const total = Number(/\/(\d+)\s*$/.exec(cr)?.[1]) || 0;
    // 声明总长与已知字节数不符 = 该源缓存坏了（这次事故的典型形态），直接判不健康
    if (expectedBytes > 0 && total > 0 && total !== expectedBytes) {
      return { ok: false, mirror: prefix, error: `声明总长 ${total} ≠ 期望 ${expectedBytes}`, total };
    }
    if (!len && !total) return { ok: false, mirror: prefix, error: '响应无长度信息' };
    return { ok: true, mirror: prefix, total: total || null, len };
  } catch (e) {
    return { ok: false, mirror: prefix, error: String((e?.message) || e) };
  } finally { clearTimeout(timer); }
}

/**
 * 探测全部候选并把结果写回学习状态（成功清零并恢复，失败累计）。
 * @returns {Promise<Array<{mirror:string, ok:boolean, error?:string}>>}
 */
export async function probeAll({ seedPath, stateFile = statePath(), fetchImpl, timeoutMs, expectedBytes } = {}) {
  const list = listCandidates({ seedPath, stateFile });
  const results = [];
  for (const c of list) {
    const r = await probeMirror({ mirror: c.mirror, stateFile, fetchImpl, timeoutMs, expectedBytes });
    recordOutcome(c.mirror, { ok: r.ok, error: r.error, stateFile });
    results.push({ mirror: c.mirror, ok: r.ok, error: r.error });
  }
  return results;
}
