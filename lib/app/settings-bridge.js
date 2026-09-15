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
 *   `$DSH_HOME/git-push/config.json`（0600，与 github-token/id_rsa 凭据同级，见
 *   lib/git/credentials.js 的 credentialsDir()）。读写直接走本模块的 JSON 文件操作：
 *   无宿主 scope 依赖、无锁竞争、无 isLoopback 陷阱、重启从文件读回。
 *
 * 用法：
 *   apply.js：启动时 readSettings() 合并进运行期 cfg（注入/审计设置重启保持）
 *   http-handlers.js：GET /api/git-push/settings-get（读）/ POST /api/git-push/settings-set（写）
 */
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { credentialsDir } from '../git/credentials.js';

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
  if (typeof patch.injectSystemPrompt === 'boolean') {
    cfg.injectSystemPrompt = patch.injectSystemPrompt;
    out.changedSystemPrompt = true;
  }
  if (typeof patch.auditEnabled === 'boolean') cfg.auditEnabled = patch.auditEnabled;
  if (typeof patch.injectRequirements === 'boolean') cfg.injectRequirements = patch.injectRequirements;
  if (typeof patch.auditScanScope === 'string' && ['diff', 'full'].includes(patch.auditScanScope)) cfg.auditScanScope = patch.auditScanScope;
  if (typeof patch.auditLevel === 'string' && ['quick', 'standard', 'deep'].includes(patch.auditLevel)) cfg.auditLevel = patch.auditLevel;
  if (typeof patch.auditRuleset === 'string') cfg.auditRuleset = patch.auditRuleset;
  if (typeof patch.weightOverrides === 'string') cfg.weightOverrides = patch.weightOverrides;
  if (Array.isArray(patch.auditRuleOrder)) cfg.auditRuleOrder = patch.auditRuleOrder;
  if (Array.isArray(patch.auditDisabledSlots)) cfg.auditDisabledSlots = patch.auditDisabledSlots;
  if (typeof patch.githubToken === 'string' && patch.githubToken.trim()) cfg.githubToken = patch.githubToken.trim();
  if (typeof patch.sshPub === 'string' && patch.sshPub.trim()) cfg.sshPub = patch.sshPub.trim();
  // 2026-09-15 修复：以下 5 键 settings-set 白名单接受、writeSettingsKey 能落 config.json，
  //   但此前缺少 →cfg 映射，重启后 applySettingsToCfg 不恢复（设置「保存了但不生效」）。
  //   补齐映射（类型收窄，非法值忽略），与 lib/client/index.js SETTINGS_SCHEMA 声明一致。
  if (typeof patch.maxScanFiles === 'number' && Number.isFinite(patch.maxScanFiles)) cfg.maxScanFiles = patch.maxScanFiles;
  if (typeof patch.commitMessage === 'string') cfg.commitMessage = patch.commitMessage;
  if (typeof patch.defaultScanRoot === 'string') cfg.defaultScanRoot = patch.defaultScanRoot;
  if (typeof patch.pushMethod === 'string' && ['ssh', 'api', 'auto'].includes(patch.pushMethod)) cfg.pushMethod = patch.pushMethod;
  if (typeof patch.hardcodeFullScan === 'boolean') cfg.hardcodeFullScan = patch.hardcodeFullScan;
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
    let value = entry.value;
    if (sensitive.has(entry.key)) {
      value = typeof entry.value === 'string' && entry.value.trim()
        ? `(已配置 ${String(entry.value).length} 字符，内容打码)`
        : '(空)';
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      key: entry.key,
      value,
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
  try {
    const file = settingsFilePath(env);
    if (!existsSync(file)) return null;
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
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
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
    const current = readSettings(env) || {};
    const next = { ...current, [key.trim()]: value };
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    return { ok: true, file };
  } catch (e) {
    return { ok: false, code: 'WRITE_FAIL', error: `配置写入失败: ${e?.message || e}` };
  }
}