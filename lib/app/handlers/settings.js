/**
 * HTTP 处理层 · 设置读写端点（settings-get / settings-set）
 *
 * 从 http-handlers.js 的 handleHttp 拆分而来（2026-09-29）。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 * 设置读写走插件私有 config.json（不写公共 settings.yaml，见 settings-bridge.js 说明）。
 */
import { redactConfig } from '../schema.js';
import { readSettings, writeSettingsKey, applySettingsToCfg, appendSettingsLog } from '../settings-bridge.js';
import { persistSshPub, persistGithubToken } from '../../git/index.js';

/** GET /api/git-push/settings-get —— 读插件 config.json 设置快照（token/ssh 掩码）。 */
export function handleSettingsGet(ctx) {
  const { env } = ctx;
  const snap = readSettings({ workspaceRoot: env.workspaceRoot });
  // 同步 apply 后 cfg（settings-set 写盘后内存 cfg 即时更新；读侧也对齐
  //   ——部分字段如 auditEnabled 在 status/settings-get 都读 cfg，需与内存一致）
  return { status: 200, body: { ok: true, settings: redactConfig(snap || {}) } };
}

/** POST /api/git-push/settings-set —— 写单个设置键（白名单防越权）。 */
export async function handleSettingsSet(ctx) {
  const { body, env, cfg } = ctx;
  const log = ctx.cfg?.log || ctx.log || { warn: () => {} };
  const key = String(body.key || '');
  // 白名单：仅允许前端设置卡片声明的键（凭据走这里 + 下方同步 cfg）
  const allowedKeys = new Set([
    'auditEnabled', 'injectRequirements', 'injectSystemPrompt', 'auditScanScope',
    'maxScanFiles', 'weightOverrides',
    'maxCloneFileMB', 'cloneConcurrency',
    'pushMethod', 'auditRuleOrder', 'auditDisabledSlots',
    'githubToken', 'sshPub', 'pushGate',
    'autoPushEnabled', 'autoPushTriggerText', 'autoPushScope', 'autoPushMessage',
  ]);
  if (!allowedKeys.has(key)) return { status: 400, body: { ok: false, error: `不支持的设置键: ${key || '(空)'}` } };
  // 凭据落插件目录（github-token / *.pub 0600）
  if (key === 'githubToken') {
    const r = persistGithubToken(body.value, { workspaceRoot: env.workspaceRoot });
    if (!r.ok) return { status: 400, body: { ok: false, error: `token 持久化失败: ${r.error || '未知错误'}` } };
  } else if (key === 'sshPub') {
    const r = persistSshPub(body.value, { workspaceRoot: env.workspaceRoot });
    if (!r.ok) return { status: 400, body: { ok: false, error: `公钥持久化失败: ${r.error || '未知错误'}` } };
  }
  const r = await writeSettingsKey(key, body.value, { workspaceRoot: env.workspaceRoot });
  appendSettingsLog({ key, value: body.value, via: 'http-settings-set', ok: r.ok, error: r.error }, { workspaceRoot: env.workspaceRoot });
  if (!r.ok) {
    return { status: r.code === 'BAD_KEY' ? 400 : 500, body: { ok: false, code: r.code || 'SETTINGS_WRITE', error: r.error } };
  }
  // 写盘成功后同步内存 cfg（即时生效；config.json 才是真源）
  try {
    applySettingsToCfg(cfg, { [key]: body.value });
  } catch (e) {
    log?.warn?.(`settings-set cfg 同步跳过：${e?.message || e}`);
  }
  return { status: 200, body: { ok: true, key, value: body.value, note: '设置已写入插件私有配置（config.json）' } };
}