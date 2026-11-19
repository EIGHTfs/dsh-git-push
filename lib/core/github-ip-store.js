/**
 * GitHub 官方 IP 候选清单与「按健康度选 IP」（与 lib/core/mirror-store.js 同一套设计）。
 *
 * 为什么需要：本机 DNS 把 github.com 解析到一个 HTTPS 走不通的地址（实测 57.155.223.240，
 *   请求 10s 超时、curl 返回 000），而 Device Flow 的两个端点只在 github.com 上
 *   （api.github.com 没有 device flow）。用官方 IP 直连能绕过，但**单个 IP 会变**——
 *   写死一个就等于把「换一个 IP 试试」这条唯一退路堵死，所以照镜像清单做候选 + 学习 + 轮换。
 *
 * 与 mirror-store 的关键差异（别照抄那边）：
 *   · 判据是「能不能真的建立并完成一次请求」，不像镜像要校验数据是否被截断/陈旧；
 *   · 全部候选停用时**回退 DNS 直连**（网络正常的环境本来就该走那条），
 *     而不是像镜像那样「宁可不加速」。
 *
 * 清单分两层，理由与镜像完全相同：
 *   · 出厂清单 `github-ip-candidates.json`（随仓库入库，只写「有哪些 IP、优先级」）；
 *   · 学习状态 `<配置目录>/github-ip-state.json`（运行期只写这份）——
 *     否则部署副本被 sync 覆盖、仓库被学习结果弄脏。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 出厂清单位置（随仓库入库，只读种子）。 */
export const IP_SEED_PATH = join(HERE, 'github-ip-candidates.json');
/** 连续失败多少次停用该 IP（可手改状态文件里的 disabled 立即生效）。 */
export const MAX_IP_FAILURES = 3;
/**
 * 停用后的冷却期：到点自动重新纳入候选。
 * 为什么必须有：实测这些 IP 的可用性是**逐个动态变化**的（同网段 .3 不通而 .4 通，几分钟后又
 *   可能互换）。若停用是永久的，一次网络抖动就会让一个本来能用的 IP 永久出局，
 *   等网络恢复反而更慢——这跟「不再尝试」没区别。
 */
export const IP_COOLDOWN_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 5000;
let listCache = { key: '', value: [], at: 0 };
let stateCache = { key: '', value: null, at: 0 };

/** IPv4 粗校验：只接受明确的四段数字（防止把域名/占位符当 IP 写进清单）。 */
export function normalizeIp(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return '';
  return text.split('.').every((part) => Number(part) <= 255) ? text : '';
}

/** 学习状态文件位置（可被 DSH_GIT_PUSH_IP_STATE 覆盖，测试据此指向临时文件）。 */
export function ipStatePath({ configDir = '' } = {}) {
  const override = String(process.env.DSH_GIT_PUSH_IP_STATE || '').trim();
  if (override) return override;
  const dir = configDir || (process.env.DSH_HOME ? join(process.env.DSH_HOME, 'git-push') : '');
  return dir ? join(dir, 'github-ip-state.json') : '';
}

/** 读出出厂清单。文件缺失/损坏 → 空清单（调用方回退直连，不崩）。 */
export function readIpSeed(path = IP_SEED_PATH) {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const list = Array.isArray(raw?.candidates) ? raw.candidates : [];
    return list
      .map((item) => ({ ip: normalizeIp(item?.ip), note: item?.note || '' }))
      .filter((item) => item.ip);
  } catch { return []; }
}

/** 读学习状态（ip → {failures, disabled, lastOkAt, lastError}）。缺失/损坏 → 空表。 */
export function readIpState(path = ipStatePath()) {
  if (!path) return {};
  try {
    if (!existsSync(path)) return {};
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const ips = raw && typeof raw.ips === 'object' && raw.ips ? raw.ips : {};
    const out = {};
    for (const [key, value] of Object.entries(ips)) {
      const ip = normalizeIp(key);
      if (!ip) continue;
      out[ip] = {
        failures: Math.max(0, Math.trunc(Number(value?.failures) || 0)),
        disabled: value?.disabled === true,
        lastOkAt: value?.lastOkAt ?? null,
        lastFailAt: value?.lastFailAt ?? null,
        lastError: value?.lastError ?? null,
      };
    }
    return out;
  } catch { return {}; }
}

/** 原子写学习状态（失败静默：这是连接用的元数据，写不进去不该影响授权主流程）。 */
export function writeIpState(state, path = ipStatePath()) {
  if (!path) return { ok: false, error: '状态路径不可用' };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, note: 'GitHub IP 健康度学习结果（运行期自动维护，可手改 disabled 立即生效）', ips: state }, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
    return { ok: true, path };
  } catch (error) { return { ok: false, error: String(error?.message || error) }; }
}

/** 合并清单与状态，产出按优先级排序的候选视图。 */
export function listIpCandidates({ seedPath = IP_SEED_PATH, stateFile = ipStatePath() } = {}) {
  const state = readIpState(stateFile);
  return readIpSeed(seedPath).map((item) => {
    const st = state[item.ip] || {};
    return {
      ip: item.ip,
      note: item.note,
      failures: st.failures || 0,
      disabled: st.disabled === true,
      lastOkAt: st.lastOkAt ?? null,
      lastFailAt: st.lastFailAt ?? null,
      lastError: st.lastError ?? null,
    };
  });
}

/**
 * 本次请求该按什么顺序试哪些 IP（空数组 = 没有可用 IP，调用方回退 DNS 直连）。
 *
 * 顺序：环境变量钉死值 → 清单里未停用的（原顺序）。**不用 round-robin**：
 * 已经能通的 IP 就是最快的，每次轮换只会让每个请求都承担一次探活成本；
 * 「轮换」在这里的含义是**失败即换下一个**，而不是平均分配。
 */
export function usableGithubIps({ seedPath, stateFile } = {}) {
  const pinned = normalizeIp(process.env.DSH_GIT_PUSH_GITHUB_IP);
  if (pinned) return [pinned];
  const key = `${seedPath || IP_SEED_PATH}|${stateFile || ipStatePath()}`;
  const now = Date.now();
  if (listCache.key === key && now - listCache.at < CACHE_TTL_MS) return [...listCache.value];
  const candidatesList = listIpCandidates({ seedPath, stateFile });
  const healthy = [];
  const coolingDown = [];
  for (const item of candidatesList) {
    if (!item.disabled) { healthy.push(item.ip); continue; }
    // 停用到期的重新纳入，但排在健康 IP 之后：先试已知能用的，别让刚失败过的抢占首选位
    const failedAt = Date.parse(item.lastFailAt || '') || 0;
    if (failedAt && now - failedAt >= IP_COOLDOWN_MS) coolingDown.push(item.ip);
  }
  const ips = [...healthy, ...coolingDown];
  listCache = { key, value: ips, at: now };
  return [...ips];
}

/** 清空进程内缓存（测试与状态变更后强制重读）。 */
export function invalidateIpCache() {
  listCache = { key: '', value: [], at: 0 };
  stateCache = { key: '', value: null, at: 0 };
}

/**
 * 记录一次实际建连的成败：成功清零，连续失败达 MAX_IP_FAILURES 即停用。
 * @param {string} ip 实际使用的 IP
 * @param {{ok:boolean, error?:string, stateFile?:string}} outcome
 */
export function recordIpOutcome(ip, { ok, error = '', stateFile = ipStatePath() } = {}) {
  const key = normalizeIp(ip);
  if (!key) return { ok: false };
  const cacheKey = stateFile || ipStatePath();
  const now = Date.now();
  const state = (stateCache.key === cacheKey && stateCache.value && now - stateCache.at < CACHE_TTL_MS)
    ? stateCache.value
    : readIpState(stateFile);
  const current = state[key] || { failures: 0, disabled: false, lastOkAt: null, lastError: null };
  const at = new Date().toISOString();
  const next = ok
    ? { failures: 0, disabled: false, lastOkAt: at, lastFailAt: current.lastFailAt ?? null, lastError: null }
    : {
      failures: current.failures + 1,
      disabled: current.failures + 1 >= MAX_IP_FAILURES,
      lastOkAt: current.lastOkAt ?? null,
      lastFailAt: at,
      lastError: String(error || '建连失败').slice(0, 300),
    };
  state[key] = next;
  // 无变化不写盘：成功且此前干净时直接返回，避免每次授权都写一次状态文件
  if (ok && current.failures === 0 && current.disabled !== true) {
    stateCache = { key: cacheKey, value: state, at: now };
    return { ok: true, state: next, disabled: false };
  }
  const written = writeIpState(state, stateFile);
  stateCache = { key: cacheKey, value: state, at: now };
  listCache = { key: '', value: [], at: 0 };   // 状态变了，下次取候选重新计算
  return { ok: written.ok, state: next, disabled: next.disabled === true };
}
