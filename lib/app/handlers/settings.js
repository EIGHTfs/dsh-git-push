/**
 * HTTP 处理层 · 设置读写端点（settings-get / settings-set）
 *
 * 从 http-handlers.js 的 handleHttp 拆分而来。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 * 设置读写走插件私有 config.json（不写公共 settings.yaml，见 settings-bridge.js 说明）。
 */
import { redactConfig } from '../schema.js';
import { readSettings, writeSettingsKey, writePreCommitEnabled, applySettingsToCfg, appendSettingsLog } from '../settings-bridge.js';
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
];

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
  const r = key === PRECOMMIT_ENABLED_KEY
    ? await writePreCommitEnabled(body.value, { workspaceRoot: env.workspaceRoot })
    : await writeSettingsKey(key, body.value, { workspaceRoot: env.workspaceRoot });
  appendSettingsLog({ key, value: body.value, via: 'http-settings-set', ok: r.ok, error: r.error }, { workspaceRoot: env.workspaceRoot });
  if (!r.ok) {
    return { status: r.code === 'BAD_KEY' ? 400 : 500, body: { ok: false, code: r.code || 'SETTINGS_WRITE', error: r.error } };
  }
  // 写盘成功后同步内存 cfg（即时生效；config.json 才是真源）
  try {
    applySettingsToCfg(cfg, key === PRECOMMIT_ENABLED_KEY
      ? { preCommit: { enabled: body.value } }
      : { [key]: body.value });
  } catch (e) {
    log?.warn?.(`settings-set cfg 同步跳过：${e?.message || e}`);
  }
  // 回显脱敏：凭据类键**不回传明文**（与 README「接口不回传明文」一致）。
  //   写成功与否由 ok 字段表达；前端 save() 只看 ok，不依赖回显值回填输入框。
  const echoValue = SENSITIVE_SETTING_KEYS.has(key)
    ? (String(body.value ?? '').trim() ? '(已保存)' : '(空)')
    : body.value;
  return { status: 200, body: { ok: true, key, value: echoValue, note: '设置已写入插件私有配置（config.json）' } };
}