/**
 * HTTP 处理层 · 设置读写端点（settings-get / settings-set）
 *
 * 从 http-handlers.js 的 handleHttp 拆分而来。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 * 设置读写走插件私有 config.json（不写公共 settings.yaml，见 settings-bridge.js 说明）。
 */
import { redactConfig } from '../schema.js';
import { readSettings, writeSettingsKey, writePreCommitEnabled, writeGithubAuthClientId, applySettingsToCfg, appendSettingsLog } from '../settings-bridge.js';
import { persistSshPub, persistGithubToken, persistNpmToken } from '../../git/index.js';

/** GET /api/git-push/settings-get —— 读插件 config.json 设置快照（token/ssh 掩码）。 */
export function handleSettingsGet(ctx) {
  const { env } = ctx;
  const snap = readSettings({ workspaceRoot: env.workspaceRoot });
  return { status: 200, body: { ok: true, settings: redactConfig(snap || {}) } };
}

/** 凭据类设置键：写成功后的回显值必须脱敏（明文只留在 config.json 0600 与凭据文件）。 */
const SENSITIVE_SETTING_KEYS = new Set(['githubToken', 'sshPub', 'npmToken']);

/**
 * 「提交前预处理」总开关的**前端键名**（settings-set 的扁平键）。
 *
 * 为什么需要扁平别名：配置文件里的真身是嵌套的 `preCommit.enabled`（与同块的
 *   command/args/timeoutMs 一起构成引擎配置），而 settings-set 的协议是「一个 key 一个 value」。
 *   前端只认这个扁平键，写盘时翻译成嵌套键级合并（见 writePreCommitEnabled），
 *   避免「改开关把同块的引擎路径一起覆盖掉」。
 */
const PRECOMMIT_ENABLED_KEY = 'preCommitEnabled';

/**
 * Device Flow 的 OAuth clientId 的前端键名（settings-set 的扁平键）。
 *
 * 与 PRECOMMIT_ENABLED_KEY 同因：真身是嵌套的 `githubAuth.clientId`，同块还躺着
 *   mode / login / authorizedAt。扁平键写盘时翻译成键级合并（见 writeGithubAuthClientId），
 *   否则用户改一次 clientId 就把「这份凭据怎么来的」抹掉，界面退回未授权。
 *
 * 注意它**不在** SENSITIVE_SETTING_KEYS 里：clientId 是公开客户端标识（会出现在授权页
 *   URL 里），不是凭据；真正保密的是 access_token，那个只走 githubToken 键。
 */
const GITHUB_AUTH_CLIENT_ID_KEY = 'githubAuthClientId';

/**
 * settings-set 允许写的键（白名单，防越权写入任意字段）。
 *
 * 为什么要显式列全：这条白名单是「前端能改什么」的唯一闸门，少列一个键 = 那个设置
 *   静默存不下来；多列一个键 = 越权面。测试会把它与前端声明逐键比对，改这里必须同步。
 */
export const ALLOWED_SETTING_KEYS = [
  PRECOMMIT_ENABLED_KEY, 'injectSystemPrompt',
  'maxCloneFileMB', 'cloneConcurrency',
  'pushMethod',
  'githubToken', 'sshPub', 'pushGate',
  'npmToken', 'npmRegistry',
  'autoPushEnabled', 'autoPushTriggerText', 'autoPushScope', 'autoPushMessage',
  GITHUB_AUTH_CLIENT_ID_KEY,
];

/**
 * 把扁平设置键翻译成 applySettingsToCfg 认的补丁形状。
 * preCommit / githubAuth 是嵌套块：直接塞扁平键会在运行期 cfg 里制造两处真相
 *   （cfg.preCommitEnabled 与 cfg.preCommit.enabled 各存一份），所以统一翻译成嵌套子键。
 */
function resolveCfgPatch(key, value) {
  if (key === PRECOMMIT_ENABLED_KEY) return { preCommit: { enabled: value } };
  if (key === GITHUB_AUTH_CLIENT_ID_KEY) return { githubAuth: { clientId: String(value ?? '').trim() } };
  return { [key]: value };
}

/**
 * 回显值：凭据类打码；OAuth clientId 明文回显（公开客户端标识，理由见 GITHUB_AUTH_CLIENT_ID_KEY），
 *   设置页输入框据此回填用户刚填的值，不必再打一次 settings-get。
 */
function resolveEchoValue(key, rawValue) {
  if (SENSITIVE_SETTING_KEYS.has(key)) return String(rawValue ?? '').trim() ? '(已保存)' : '(空)';
  if (key === GITHUB_AUTH_CLIENT_ID_KEY) return String(rawValue ?? '').trim();
  return rawValue;
}

/** POST /api/git-push/settings-set —— 写单个设置键（白名单防越权）。 */
export async function handleSettingsSet(ctx) {
  const { body, env, cfg } = ctx;
  const log = ctx.cfg?.log || ctx.log || { warn: () => {} };
  const key = String(body.key || '');
  // 白名单：仅允许前端设置卡片声明的键（凭据走这里 + 下方同步 cfg）
  if (!ALLOWED_SETTING_KEYS.includes(key)) return { status: 400, body: { ok: false, error: `不支持的设置键: ${key || '(空)'}` } };
  // 凭据落插件目录（github-token / *.pub / npmToken 一律 0600，绝不入库）
  if (key === 'githubToken') {
    const r = persistGithubToken(body.value, { workspaceRoot: env.workspaceRoot });
    if (!r.ok) return { status: 400, body: { ok: false, error: `token 持久化失败: ${r.error || '未知错误'}` } };
  } else if (key === 'sshPub') {
    const r = persistSshPub(body.value, { workspaceRoot: env.workspaceRoot });
    if (!r.ok) return { status: 400, body: { ok: false, error: `公钥持久化失败: ${r.error || '未知错误'}` } };
  } else if (key === 'npmToken') {
    // npmToken 与 githubToken 落在同一个 config.json：persistNpmToken 内部走 updateJsonAtomic（原子读改写），
    //   不会覆盖 githubToken / sshPub（禁止「先读整份再写整份」的两步写）。
    const r = persistNpmToken(body.value, { workspaceRoot: env.workspaceRoot });
    if (!r.ok) return { status: 400, body: { ok: false, error: `npm token 持久化失败: ${r.error || '未知错误'}` } };
  }
  // 嵌套块走专用写路径（键级合并）；其余键仍走通用整键写入
  let r;
  if (key === PRECOMMIT_ENABLED_KEY) {
    r = await writePreCommitEnabled(body.value, { workspaceRoot: env.workspaceRoot });
  } else if (key === GITHUB_AUTH_CLIENT_ID_KEY) {
    r = await writeGithubAuthClientId(body.value, { workspaceRoot: env.workspaceRoot });
  } else {
    r = await writeSettingsKey(key, body.value, { workspaceRoot: env.workspaceRoot });
  }
  appendSettingsLog({ key, value: body.value, via: 'http-settings-set', ok: r.ok, error: r.error }, { workspaceRoot: env.workspaceRoot });
  if (!r.ok) {
    return { status: r.code === 'BAD_KEY' || r.code === 'BAD_CLIENT_ID' ? 400 : 500, body: { ok: false, code: r.code || 'SETTINGS_WRITE', error: r.error } };
  }
  // 写盘成功后同步内存 cfg（即时生效；config.json 才是真源）
  try {
    applySettingsToCfg(cfg, resolveCfgPatch(key, body.value));
  } catch (e) {
    log?.warn?.(`settings-set cfg 同步跳过：${e?.message || e}`);
  }
  // 回显脱敏：**凭据类**键（token/公钥）不裸传明文；非凭据键照原值回显，
  //   其中 OAuth clientId 明文回显是有意为之（公开客户端标识，见 GITHUB_AUTH_CLIENT_ID_KEY）。
  //   写成功与否由 ok 字段表达；前端 save() 只看 ok，不依赖回显值回填输入框。
  const echoValue = resolveEchoValue(key, body.value);
  return { status: 200, body: { ok: true, key, value: echoValue, note: '设置已写入插件私有配置（config.json）' } };
}