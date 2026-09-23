/**
 * 设置读写桥 · settings-bridge
 *
 * 背景（2026-09-15 大坑，见 lib/BUGFIX-NOTES-2026-09-14.md「Bug 3」）：
 *   DSH web GUI 的 settings 持久化由 client 侧 `ctx.remote.$host.isLoopback` 决定（ui-settings
 *   src/client/index.ts:58）：经反代地址访问时 isLoopback=false → persistence='memory' →
 *   前端 scope.set 只改页面内存、不发 wire、不写盘、重启全丢；且公共 settings.yaml 存在
 *   **跨实例写锁竞争**（实测 atomic-write: timed out waiting for the writer lock——多个 DSH
 *   实例共享 DSH_HOME 时互抢同一把锁，任何 scope.update 都可能失败）。
 *
 * 结论（用户 2026-09-15 拍板）：**不写公共 settings.yaml**，插件设置自管到插件私有目录
 *   `$DSH_HOME/git-push/config.json`（0600，凭据 token/公钥的唯一真源；SSH 私钥 id_rsa 仍为文件，见
 *   lib/git/credentials.js 的 credentialsDir()）。读写直接走本模块的 JSON 文件操作：
 *   无宿主 scope 依赖、无锁竞争、无 isLoopback 陷阱、重启从文件读回。
 *
 * 用法：
 *   apply.js：启动时 readSettings() 合并进运行期 cfg（注入/审计设置重启保持）
 *   http-handlers.js：GET /api/git-push/settings-get（读）/ POST /api/git-push/settings-set（写）
 */
import { join } from 'node:path';
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { credentialsDir } from '../git/credentials.js';
import { readJson, writeJsonAtomic, updateJsonAtomic } from '../git/atomic-json.js';

/**
 * 把设置快照（config.json 读回 / HTTP settings-set 单键补丁）合并进运行期 cfg。
 * 两处调用点共用同一张「键 → cfg 字段」映射表，避免映射漂移：
 *   - apply.js 启动：readSettings() → applySettingsToCfg(cfg, ...)
 *   - http-handlers settings-set：applySettingsToCfg(cfg, { [key]: value })
 * scope.watch **不再**走本函数（yaml 缺键会用 schema 默认值盖掉 config.json）。
 * 统一类型守卫：boolean 键只在值是 boolean 时写；数组键只在是数组时写；githubToken/sshPub
 * 只接受非空字符串（去空白）。返回 { changedSystemPrompt:boolean }，调用方据此清环境注入缓存。
 * @param {object} cfg 运行期配置对象（原地修改）
 * @param {object} patch 设置快照/补丁
 * @returns {{changedSystemPrompt:boolean}}
 */
export function applySettingsToCfg(cfg, patch) {
  const out = { changedSystemPrompt: false };
  if (!cfg || !patch || typeof patch !== 'object') return out;
  // 2026-09-23 重构：设置键映射表驱动（原 15+ 个 if → 分组循环，降圈复杂度 27→~5）。
  //   语义与原逐键 if 完全一致（类型收窄、枚举白名单、数字钳制），与 SETTINGS_SCHEMA 声明同步。
  const BOOL_KEYS = ['injectSystemPrompt', 'auditEnabled', 'injectRequirements', 'pushGate'];
  const ENUM_KEYS = { auditScanScope: ['diff', 'full'], pushMethod: ['ssh', 'api', 'auto'] };
  const STR_KEYS = ['weightOverrides'];
  const STR_TRIM_KEYS = ['githubToken', 'sshPub'];
  const ARR_KEYS = ['auditRuleOrder', 'auditDisabledSlots'];
  const NUM_KEYS = ['maxScanFiles'];
  // 数值钳制：min/max 边界，floor 先取整（clone 并发数不高于 16）
  const CLAMP_KEYS = {
    maxCloneFileMB: { min: 0 },
    cloneConcurrency: { min: 1, max: 16, floor: true },
  };
  for (const k of BOOL_KEYS) if (typeof patch[k] === 'boolean') cfg[k] = patch[k];
  for (const [k, allowed] of Object.entries(ENUM_KEYS)) {
    if (typeof patch[k] === 'string' && allowed.includes(patch[k])) cfg[k] = patch[k];
  }
  for (const k of STR_KEYS) if (typeof patch[k] === 'string') cfg[k] = patch[k];
  for (const k of STR_TRIM_KEYS) if (typeof patch[k] === 'string' && patch[k].trim()) cfg[k] = patch[k].trim();
  for (const k of ARR_KEYS) if (Array.isArray(patch[k])) cfg[k] = patch[k];
  for (const k of NUM_KEYS) if (typeof patch[k] === 'number' && Number.isFinite(patch[k])) cfg[k] = patch[k];
  for (const [k, c] of Object.entries(CLAMP_KEYS)) {
    if (typeof patch[k] !== 'number' || !Number.isFinite(patch[k])) continue;
    let v = c.floor ? Math.floor(patch[k]) : patch[k];
    if (c.min != null) v = Math.max(c.min, v);
    if (c.max != null) v = Math.min(c.max, v);
    cfg[k] = v;
  }
  if (typeof patch.injectSystemPrompt === 'boolean') out.changedSystemPrompt = patch.injectSystemPrompt;
  return out;
}

/** 测试注入点：覆盖 config.json 路径（单测指向临时目录，避免污染真实配置）。 */
let settingsFileOverride = null;
export function setSettingsFileOverride(path) {
  settingsFileOverride = path;
}

/** 插件的设置文件路径（默认 $DSH_HOME/git-push/config.json）。 */
export function settingsFilePath({ workspaceRoot = '' } = {}) {
  if (settingsFileOverride) return settingsFileOverride;
  return join(credentialsDir({ workspaceRoot }), 'config.json');
}

/**
 * UI 提交日志文件（与 config.json 同级，0600，重启可见）。
 * 用途（2026-09-15）：设置侧边栏每次写设置都追加一行——验证「UI 提交确实发生且落盘」，
 *   与 config.json 内容互为证据（用户安装重启后拷问「提交为什么丢」时先看这里）。
 * @param {{workspaceRoot?:string}} [env]
 */
export function settingsLogFilePath({ workspaceRoot = '' } = {}) {
  const base = settingsFileOverride || join(credentialsDir({ workspaceRoot }), 'config.json');
  return join(base, '..', 'settings-ui.log');
}

/**
 * 追加一条 UI 设置提交日志（凭据值打码，不写明文；失败静默不影响写盘）。
 * @param {{key:string, value:unknown, via?:string, ok?:boolean, error?:string}} entry
 * @param {{workspaceRoot?:string}} [env]
 */
export function appendSettingsLog(entry, env = {}) {
  try {
    const file = settingsLogFilePath(env);
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
    const sensitive = new Set(['githubToken', 'sshPub']);
    let logValue = entry.value;
    if (sensitive.has(entry.key)) {
      logValue = typeof entry.value === 'string' && entry.value.trim()
        ? `(已配置 ${String(entry.value).length} 字符，内容打码)`
        : '(空)';
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      key: entry.key,
      value: logValue,
      via: entry.via || 'http',
      ok: entry.ok !== false,
      ...(entry.error ? { error: entry.error } : {}),
    });
    appendFileSync(file, line + '\n', { mode: 0o600 });
    return true;
  } catch {
    return false; // 日志失败绝不阻断设置写入
  }
}

/**
 * 读当前设置快照（config.json；文件不存在/坏 JSON 返回 null，不抛）。
 * @param {{workspaceRoot?:string}} [env]
 * @returns {object|null}
 */
export function readSettings(env = {}) {
  return readJson(settingsFilePath(env));
}

/**
 * 写单个设置键（config.json 原子写回；与 client persistence / 宿主锁无关）。
 * @param {string} key 设置键（非空字符串）
 * @param {unknown} value json 值
 * @param {{workspaceRoot?:string}} [env]
 * @returns {{ok:boolean, code?:string, error?:string}}
 */
export async function writeSettingsKey(key, value, env = {}) {
  try {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, code: 'BAD_KEY', error: '设置键无效' };
    const file = settingsFilePath(env);
    const w = updateJsonAtomic(file, (cur) => ({ ...cur, [key.trim()]: value }));
    return w.ok ? { ok: true, file: w.file } : { ok: false, code: 'WRITE_FAIL', error: `配置写入失败: ${w.error || '未知'}` };
  } catch (e) {
    return { ok: false, code: 'WRITE_FAIL', error: `配置写入失败: ${e?.message || e}` };
  }
}