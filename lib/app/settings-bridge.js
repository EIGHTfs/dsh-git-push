/**
 * 设置读写桥 · settings-bridge
 *
 * 背景（历史大坑：无 Origin 的桌面端请求曾被 403 挡住，表现为「页面能开、保存永不生效」）：
 *   DSH web GUI 的 settings 持久化由 client 侧 `ctx.remote.$host.isLoopback` 决定（ui-settings
 *   src/client/index.ts:58）：经反代地址访问时 isLoopback=false → persistence='memory' →
 *   前端 scope.set 只改页面内存、不发 wire、不写盘、重启全丢；且公共 settings.yaml 存在
 *   **跨实例写锁竞争**（实测 atomic-write: timed out waiting for the writer lock——多个 DSH
 *   实例共享 DSH_HOME 时互抢同一把锁，任何 scope.update 都可能失败）。
 *
 * 结论：**不写公共 settings.yaml**——插件设置自管到插件私有目录（设置命名空间独立，避免与宿主配置互相污染）
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
// 设置键映射表（模块级常量：与每次调用无关，放外面避免重复构造，也让 applySettingsToCfg 更短）
//   语义：类型收窄 / 枚举白名单 / 数字钳制，与 SETTINGS_SCHEMA 声明同步。
// 边界：本表只收**本插件自己的设置键**。「怎么审」（扫描范围/权重/规则包/文件上限）
//   归预处理实现自己的配置，不在这里；宿主只保留「提交前预处理开不开」
//   （preCommit.enabled，见下方 applyPreCommitBlock）。
const BOOL_KEYS = ['injectSystemPrompt', 'pushGate', 'autoPushEnabled'];
const ENUM_KEYS = { pushMethod: ['ssh', 'api', 'auto'], autoPushScope: ['session', 'all'] };
const STR_KEYS = ['autoPushTriggerText', 'autoPushMessage', 'npmRegistry'];
const STR_TRIM_KEYS = ['githubToken', 'sshPub', 'npmToken'];
// 数值钳制：min/max 边界，floor 先取整（clone 并发数不高于 16）
const CLAMP_KEYS = {
  maxCloneFileMB: { min: 0 },
  cloneConcurrency: { min: 1, max: 16, floor: true },
};
// 嵌套块 githubAuth 的已知子键（Device Flow 元数据，**不含 token**）：
//   定成模块级常量与上面的键表同风格，且新加子键时只有这一处要改（三段逻辑共用）。
const GITHUB_AUTH_BLOCK_FIELDS = ['clientId', 'scope', 'mode', 'login', 'authorizedAt'];

/**
 * 嵌套块 `preCommit` 的键级合并（只认已知子键 + 类型守卫）。
 *
 * 为什么单独处理：`preCommit` 是嵌套对象，若走「整键覆盖」的通用路径，
 *   前端只改 `enabled` 这一项时会把同块的 `command` / `args` / `timeoutMs` 一起抹掉
 *   （用户手配的引擎位置凭空消失，而且看不出是被谁清的）。
 *
 * 两个入口都给同一件事赋值，来源不同不能互相覆盖：
 *   · `patch.preCommitEnabled` —— settings-set 单键写入（前端开关，扁平键名）
 *   · `patch.preCommit`        —— 启动时把整份 config.json 合并进 cfg（嵌套原样）
 * 单键写入优先：它是用户刚做的动作，文件里的旧嵌套值是更早的状态。
 */
function applyPreCommitBlock(cfg, patch) {
  const flatEnabled = typeof patch.preCommitEnabled === 'boolean' ? patch.preCommitEnabled : null;
  const block = (patch.preCommit && typeof patch.preCommit === 'object') ? patch.preCommit : null;
  const blockEnabled = typeof block?.enabled === 'boolean' ? block.enabled : null;
  const enabled = flatEnabled ?? blockEnabled;
  const cur = (cfg.preCommit && typeof cfg.preCommit === 'object') ? cfg.preCommit : {};
  const next = { ...cur };
  if (enabled !== null) next.enabled = enabled;
  if (typeof block?.command === 'string') next.command = block.command;
  if (Array.isArray(block?.args)) next.args = block.args.map((rawArg) => String(rawArg));
  if (typeof block?.timeoutMs === 'number' && Number.isFinite(block.timeoutMs)) next.timeoutMs = block.timeoutMs;
  if (enabled === null && blockEnabled === null && typeof block?.command !== 'string'
    && !Array.isArray(block?.args) && typeof block?.timeoutMs !== 'number') return;
  cfg.preCommit = next;
}

/**
 * 嵌套块 `githubAuth` 的键级合并（只认已知子键 + 类型守卫）。
 *
 * 为什么单独处理：与 preCommit 同因——整块覆盖会把同块的 mode / login / authorizedAt
 *   一起抹掉。那三项是「这份凭据是怎么来的」的证据，改一次 clientId 就被清空的话，
 *   界面会退回「未授权」状态，用户被迫白走一遍 Device Flow。
 *
 * 两个入口给同一件事赋值，来源不同不能互相覆盖：
 *   · `patch.githubAuthClientId` —— settings-set 单键写入（前端扁平键名）
 *   · `patch.githubAuth`         —— 启动时把整份 config.json 合并进 cfg（嵌套原样）
 * 单键写入优先：它是用户刚做的动作，文件里的旧嵌套值是更早的状态。
 */
function applyGithubAuthBlock(cfg, patch) {
  const flatClientId = typeof patch.githubAuthClientId === 'string' ? patch.githubAuthClientId.trim() : null;
  const block = (patch.githubAuth && typeof patch.githubAuth === 'object') ? patch.githubAuth : null;
  const blockFields = GITHUB_AUTH_BLOCK_FIELDS;
  const hasBlockField = !!block && blockFields.some((field) => typeof block[field] === 'string');
  if (flatClientId === null && !hasBlockField) return;
  const next = (cfg.githubAuth && typeof cfg.githubAuth === 'object') ? { ...cfg.githubAuth } : {};
  if (block) {
    for (const field of blockFields) if (typeof block[field] === 'string') next[field] = block[field];
  }
  if (flatClientId !== null) next.clientId = flatClientId;
  cfg.githubAuth = next;
}

/**
 * 按类型把 patch 里的键写进 cfg（布尔 / 枚举 / 字符串 / 去空白字符串 / 数组 / 有限数字）。
 *
 * 为什么单独成函数：原 applySettingsToCfg 把这六类循环与下面的钳制循环全放在一起，
 *   圈复杂度 26（阈值 10，自审 max-cyclomatic-complexity 高风险）。
 */
function applyTypedKeys(cfg, patch) {
  for (const k of BOOL_KEYS) if (typeof patch[k] === 'boolean') cfg[k] = patch[k];
  for (const [k, allowed] of Object.entries(ENUM_KEYS)) {
    if (typeof patch[k] === 'string' && allowed.includes(patch[k])) cfg[k] = patch[k];
  }
  for (const k of STR_KEYS) if (typeof patch[k] === 'string') cfg[k] = patch[k];
  for (const k of STR_TRIM_KEYS) if (typeof patch[k] === 'string' && patch[k].trim()) cfg[k] = patch[k].trim();
}

/** 数值键钳制：非有限数字跳过；floor 先取整，再按 min/max 收敛。 */
function applyClampedNumbers(cfg, patch) {
  for (const [k, c] of Object.entries(CLAMP_KEYS)) {
    if (typeof patch[k] !== 'number' || !Number.isFinite(patch[k])) continue;
    let v = c.floor ? Math.floor(patch[k]) : patch[k];
    if (c.min != null) v = Math.max(c.min, v);
    if (c.max != null) v = Math.min(c.max, v);
    cfg[k] = v;
  }
}

export function applySettingsToCfg(cfg, patch) {
  const out = { changedSystemPrompt: false };
  if (!cfg || !patch || typeof patch !== 'object') return out;
  applyTypedKeys(cfg, patch);
  applyClampedNumbers(cfg, patch);
  applyPreCommitBlock(cfg, patch);
  applyGithubAuthBlock(cfg, patch);
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
 * 用途：设置侧边栏每次写设置都追加一行——验证「UI 提交确实发生且落盘」，
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
    const sensitive = new Set(['githubToken', 'sshPub', 'npmToken']);
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
 * HTTP 拒绝日志文件（与 settings-ui.log 同级，0600）。
 * 用途：写请求被鉴权前置拒掉时留痕——这类拒绝发生在 handler 之前，
 *   settings-ui.log 里本来一条都不会有，用户只看到「保存失败」而查不到原因。
 * @param {{workspaceRoot?:string}} [env]
 */
export function httpRejectLogFilePath({ workspaceRoot = '' } = {}) {
  return join(settingsLogFilePath({ workspaceRoot }), '..', 'http-rejects.log');
}

/**
 * 追加一条 HTTP 拒绝日志（失败静默，绝不阻断请求处理）。
 *
 * 打码口径：query 里凡键名疑似凭据（token / secret / password / key / auth）一律替换为
 *   `(已省略)`——拒绝日志是给用户/排查者看的，不能反过来成为泄漏通道。
 * @param {{method?:string, url?:string, origin?:string, host?:string, code?:string, status?:number}} entry
 * @param {{workspaceRoot?:string}} [env]
 */
export function appendHttpRejectLog(entry = {}, env = {}) {
  try {
    const file = httpRejectLogFilePath(env);
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
    const SECRET_KEY_RE = /(token|secret|passwd|password|key|auth|cookie)/i;
    const rawUrl = String(entry.url || '');
    const [pathOnly, queryText = ''] = rawUrl.split('?');
    let query = '';
    if (queryText) {
      const pairs = queryText.split('&').map((pair) => {
        const eq = pair.indexOf('=');
        const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
        const decodedKey = (() => { try { return decodeURIComponent(rawKey); } catch { return rawKey; } })();
        return SECRET_KEY_RE.test(decodedKey) ? `${rawKey}=(已省略)` : pair;
      });
      query = `?${pairs.join('&')}`;
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      method: String(entry.method || ''),
      url: pathOnly + query,
      origin: String(entry.origin || '(无)'),
      host: String(entry.host || '(无)'),
      code: String(entry.code || ''),
      status: Number(entry.status) || 0,
    });
    appendFileSync(file, line + '\n', { mode: 0o600 });
    return true;
  } catch {
    return false; // 日志失败绝不阻断请求处理
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
 * @param {unknown} jsonValue 设置值（json 值）
 * @param {{workspaceRoot?:string}} [env]
 * @returns {{ok:boolean, code?:string, error?:string}}
 */
export async function writeSettingsKey(key, jsonValue, env = {}) {
  try {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, code: 'BAD_KEY', error: '设置键无效' };
    const file = settingsFilePath(env);
    const updated = updateJsonAtomic(file, (cur) => ({ ...cur, [key.trim()]: jsonValue }));
    return updated.ok ? { ok: true, file: updated.file } : { ok: false, code: 'WRITE_FAIL', error: `配置写入失败: ${updated.error || '未知'}` };
  } catch (e) {
    return { ok: false, code: 'WRITE_FAIL', error: `配置写入失败: ${e?.message || e}` };
  }
}

/**
 * GitHub OAuth App 的 client_id 形态（宽松匹配）。
 *
 * 为什么宽松：真实取值不止一种形态——老式 20 位十六进制、`Iv1.<hex>`、新版 `Iv23li…` 都见过，
 *   而 GitHub 随时可能再加新前缀。校验过严会把合法值挡在门外，症状是「填了却保存不了」，
 *   且报错看起来像格式提示、实际是插件自己不认。这里只排除明显不是 client_id 的输入
 *   （空白、含空格/斜杠/中文、过短、超长）。
 * 为什么允许空串：空 = 清空配置，是用户主动撤销 clientId 的合法动作。
 */
const OAUTH_CLIENT_ID_RE = /^[A-Za-z0-9._-]{8,120}$/;

/** client_id 形态校验（settings 写入口与 HTTP handler 共用同一口径，避免两处漂移）。 */
export function isPlausibleOAuthClientId(value) {
  return OAUTH_CLIENT_ID_RE.test(String(value ?? '').trim());
}

/**
 * 写 Device Flow 的 OAuth clientId（`githubAuth.clientId`，嵌套块里的**单个子键**）。
 *
 * 为什么不复用 writeSettingsKey：那条是「整键覆盖」，前端只改 clientId 时会把同块的
 *   mode / login / authorizedAt 一起换掉——界面会退回「未授权」，用户被迫重走一遍授权
 *   （与 writePreCommitEnabled 对 preCommit.enabled 的处理同因）。
 *
 * 为什么它**不是**密钥、可以明文回显：clientId 是 Device Flow 的**公开客户端标识**，
 *   它本来就会出现在浏览器里、拼进授权页 URL（verification_uri_complete），拿到它也换不到
 *   任何凭据——真正保密的是永不下发的 access_token（那个仍然只走 githubToken 键）。
 *   所以它不进 SECRET_CONFIG_FIELDS、回显不打码；这条注释也是给后人看的：别因为
 *   「名字带 auth」就照抄 token 的处理方式，也别反过来把 token 类字段当明文。
 *
 * @param {unknown} rawClientId 前端提交的 clientId（空串=清空）
 * @param {{workspaceRoot?:string}} [env]
 * @returns {Promise<{ok:boolean, code?:string, error?:string, file?:string, value?:string}>}
 */
export async function writeGithubAuthClientId(rawClientId, env = {}) {
  const clientId = String(rawClientId ?? '').trim();
  // 写入口不止 HTTP 一条（工具/CLI 也会调），落盘前自己守住形态底线，不依赖调用方先校验。
  if (clientId && !isPlausibleOAuthClientId(clientId)) {
    return {
      ok: false, code: 'BAD_CLIENT_ID',
      error: 'clientId 形态不对：应形如 Iv1.xxxxxxxx 或 20 位十六进制（只允许字母、数字、. _ -，长度 8~120）',
    };
  }
  try {
    const file = settingsFilePath(env);
    const updated = updateJsonAtomic(file, (current) => {
      const block = current && typeof current.githubAuth === 'object' && current.githubAuth !== null
        ? current.githubAuth
        : {};
      return { ...current, githubAuth: { ...block, clientId } };
    });
    return updated.ok
      ? { ok: true, file: updated.file, value: clientId }
      : { ok: false, code: 'WRITE_FAIL', error: `配置写入失败: ${updated.error || '未知'}` };
  } catch (e) {
    return { ok: false, code: 'WRITE_FAIL', error: `配置写入失败: ${e?.message || e}` };
  }
}

/**
 * 写「提交前预处理」总开关（`preCommit.enabled`，嵌套块里的**单个子键**）。
 *
 * 为什么不复用 writeSettingsKey：那条是「整键覆盖」，key 写 `preCommit` 会把同块的
 *   command / args / timeoutMs 一起换掉——用户手配的引擎位置会凭空消失且无提示。
 *   这里做键级合并（atomic 读改写，不引入第二条写路径）。
 * @param {boolean} enabled
 * @param {{workspaceRoot?:string}} [env]
 * @returns {{ok:boolean, code?:string, error?:string}}
 */
export async function writePreCommitEnabled(enabled, env = {}) {
  if (typeof enabled !== 'boolean') return { ok: false, code: 'BAD_VALUE', error: 'preCommit.enabled 只接受布尔值' };
  try {
    const file = settingsFilePath(env);
    const updated = updateJsonAtomic(file, (cur) => {
      const block = (cur && typeof cur.preCommit === 'object' && cur.preCommit !== null) ? cur.preCommit : {};
      return { ...cur, preCommit: { ...block, enabled } };
    });
    return updated.ok ? { ok: true, file: updated.file } : { ok: false, code: 'WRITE_FAIL', error: `配置写入失败: ${updated.error || '未知'}` };
  } catch (e) {
    return { ok: false, code: 'WRITE_FAIL', error: `配置写入失败: ${e?.message || e}` };
  }
}