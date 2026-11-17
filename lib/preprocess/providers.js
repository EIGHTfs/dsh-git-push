/**
 * 预处理 provider 注册表（宿主侧）。
 *
 * 为什么要有这一层：**预处理是通用机制，审计只是它的第一个实现**。
 *   将来还会有 lint / 许可证 / 签名校验等 provider。通用层（引擎调用、拦截判定、
 *   HTTP 路由、工具入口）一律面向 `provider` 抽象，不得把某个具体实现的包名写死。
 *
 * provider 契约（外部实现按此对齐，见 audit-sluice 的 manifest）：
 *   - 可执行入口：`<pkg>/<cliRel>`，stdout 单行 JSON + exit 0|1|2
 *   - 可选 manifest：`<pkg>/lib/manifest.js` 导出 preprocessManifest
 *       { id, label, endpoints, actions, defaultOnFail?: 'block'|'warn'|'skip' }
 *     其中 defaultOnFail 是本阶段失败时的默认语义（缺省 = 'block'，即 fail-closed）。
 *     想"失败只警告、继续后续阶段"的实现（例如格式化器）在自己的 manifest 里声明 'warn' 即可 ——
 *     宿主不按 provider 名字猜语义。
 *
 * 解析顺序（与既有行为一致）：环境变量 → 插件 node_modules → 平级 sibling。
 *   环境变量名同样按 provider 生成（`DSH_PREPROCESS_<ID>_CLI`），不再有 audit 专属变量。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 内置 provider 列表。
 *
 * 字段说明：
 *   id          稳定标识（配置键前缀、日志、API 都用它）
 *   label       面向人的名字（只用于展示）
 *   packageName npm 包名（找包用）
 *   cliRel      包内可执行入口相对路径
 * 入口覆盖用环境变量 DSH_PREPROCESS_<ID>_CLI（由 providerEnvName 生成，只有这一个名字）
 */
export const PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'audit',
    label: '审计',
    packageName: 'audit-sluice',
    cliRel: 'cli.mjs',
  }),
  // 将来的 provider 在此追加一条即可；通用层（引擎/拦截/路由/工具）无需改动。
]);

/** 缺省 provider：提交门禁当前只跑审计这一个预处理。 */
export const DEFAULT_PROVIDER_ID = 'audit';

/** 按 id 找 provider 定义（未知 id 返回 null，由调用方决定怎么报错）。 */
export function getProviderDefinition(providerId = DEFAULT_PROVIDER_ID) {
  return PROVIDERS.find((provider) => provider.id === providerId) || null;
}

/** provider 专属的环境变量名（新口径）。 */
export function providerEnvName(providerId) {
  return `DSH_PREPROCESS_${String(providerId).toUpperCase()}_CLI`;
}

/**
 * 解析某个 provider 的可执行入口。
 * @param {string} providerId
 * @returns {{ok: true, path: string, source: string, provider: object} | {ok: false, error: string}}
 */
export function resolveProvider(providerId = DEFAULT_PROVIDER_ID) {
  const definition = getProviderDefinition(providerId);
  if (!definition) {
    return { ok: false, error: `未知的预处理 provider「${providerId}」（已注册：${PROVIDERS.map((p) => p.id).join(' / ')}）` };
  }
  const candidates = [];
  // 1) 显式指定（新变量优先，旧变量兜底）
  const fromEnv = String(process.env[providerEnvName(definition.id)] || '').trim();
  if (fromEnv) candidates.push({ path: fromEnv, source: `env:${providerEnvName(definition.id)}` });
  // 2) 插件自己的 node_modules（npm 安装形态）
  candidates.push({
    path: join(PLUGIN_ROOT, 'node_modules', definition.packageName, definition.cliRel),
    source: 'node_modules',
  });
  // 3) 与本插件平级（开发/并列部署形态）
  candidates.push({
    path: join(PLUGIN_ROOT, '..', definition.packageName, definition.cliRel),
    source: 'sibling',
  });
  for (const candidate of candidates) {
    if (existsSync(candidate.path)) {
      return { ok: true, path: resolve(candidate.path), source: candidate.source, provider: definition };
    }
  }
  return {
    ok: false,
    error: `找不到预处理实现「${definition.label}」（包 ${definition.packageName}/${definition.cliRel}）`
      + `（已查：${candidates.map((c) => c.path).join(' / ')}）。`
      + `修复：把它装到插件 node_modules、与本插件平级放置，或用 ${providerEnvName(definition.id)} 指定入口。`,
  };
}

/**
 * 解析「提交门禁要用的 provider」。
 * 现在只有一个（审计）；将来若支持多预处理串行，这里返回有序列表。
 * @returns {{ok: true, provider: object, path: string, source: string} | {ok: false, error: string}}
 */
export function resolveGateProvider() {
  return resolveProvider(DEFAULT_PROVIDER_ID);
}

export { PLUGIN_ROOT as preprocessPluginRoot };

/**
 * 读取「所有在位 provider 的声明」。
 *
 * 声明来自各包的 `<pkgRoot>/lib/manifest.js`（导出 preprocessManifest）。
 *   **这是唯一的能力真相**：CLI 转发、HTTP 路由、工具入口都靠它找「谁提供了什么」，
 *   宿主不写死任何具体实现的能力清单。
 * 不在位（没装/装坏）的 provider 会被跳过并记一条 reason，不抛错——
 *   热插拔语义要求「少一个扩展不影响其他扩展与主流程」。
 *
 * @returns {Promise<{manifests: Array<{provider: object, root: string, manifest: object}>,
 *                    missing: Array<{provider: object, reason: string}>}>}
 */
export async function listProviderManifests() {
  const manifests = [];
  const missing = [];
  for (const definition of PROVIDERS) {
    const resolved = resolveProvider(definition.id);
    if (!resolved.ok) { missing.push({ provider: definition, reason: resolved.error }); continue; }
    const root = dirname(resolved.path);
    const manifestFile = join(root, 'lib', 'manifest.js');
    if (!existsSync(manifestFile)) {
      missing.push({ provider: definition, reason: `缺少声明文件 ${manifestFile}` });
      continue;
    }
    try {
      const loaded = await import(pathToFileURL(manifestFile).href);
      const manifest = loaded.preprocessManifest || loaded.default;
      if (!manifest || typeof manifest !== 'object') {
        missing.push({ provider: definition, reason: `${manifestFile} 未导出 preprocessManifest` });
        continue;
      }
      manifests.push({ provider: definition, root, manifest });
    } catch (error) {
      missing.push({ provider: definition, reason: `加载 ${manifestFile} 失败：${error?.message || error}` });
    }
  }
  return { manifests, missing };
}

/**
 * 从所有在位 provider 的声明里，找到「声明了这个 action 的那个」。
 * CLI 的 `preprocess <action>` 与 HTTP 的 `/api/preprocess/<action>` 都走这里，
 *   两边口径自然一致（同一份声明、同一套查找）。
 * @param {string} action
 * @returns {Promise<{provider: object, root: string, manifest: object, action: object} | null>}
 */
export async function findActionProvider(action) {
  const name = String(action || '').trim();
  if (!name) return null;
  const { manifests } = await listProviderManifests();
  for (const entry of manifests) {
    const declared = Array.isArray(entry.manifest.actions) ? entry.manifest.actions : [];
    const hit = declared.find((item) => item && item.action === name);
    if (hit) return { ...entry, action: hit };
  }
  return null;
}

/**
 * 从所有在位 provider 的声明里，找到「声明了这个 HTTP 子端点的那个」。
 * 与 findActionProvider 同源（同一份 manifest），只是查 endpoints 而不是 actions。
 * @param {string} subPath 子端点路径，如 'rule-slots'
 * @param {string} [method] HTTP 方法（给了就一并匹配）
 */
export async function findEndpointProvider(subPath, method) {
  const target = String(subPath || '').replace(/^\/+/, '');
  const { manifests } = await listProviderManifests();
  for (const entry of manifests) {
    const declared = Array.isArray(entry.manifest.endpoints) ? entry.manifest.endpoints : [];
    const hit = declared.find((item) => item && item.path === target
      && (!method || String(item.method || 'GET').toUpperCase() === String(method).toUpperCase()));
    if (hit) return { ...entry, endpoint: hit };
  }
  return null;
}

/** 所有已声明能力的汇总（供 help / 路由清单展示）。 */
export async function listDeclaredCapabilities() {
  const { manifests, missing } = await listProviderManifests();
  return {
    actions: manifests.flatMap((entry) => (entry.manifest.actions || []).map((action) => ({
      provider: entry.provider.id, root: entry.root, ...action,
    }))),
    endpoints: manifests.flatMap((entry) => (entry.manifest.endpoints || []).map((endpoint) => ({
      provider: entry.provider.id, root: entry.root, ...endpoint,
    }))),
    missing,
  };
}

/**
 * 各在位 provider 的「阶段参数 → CLI flag」映射缓存（**同步读**）。
 *
 * 为什么需要缓存：工具调用是同步取参数的场景多、且引擎组 argv 时不方便再 await；
 *   在 apply() 里先 `await primeCommitContributions()` 预热一次，之后同步读。
 *
 * 宿主只关心 flagMap（键名到 CLI 参数的翻译），**不认识任何具体键名**——
 *   像 exemptPaths 这类名字完全由实现方在自己的 manifest 里定义。
 * @type {{flagMap: object, providers: string[]}|null}
 */
let commitContributionCache = null;

/**
 * 预热：合并各在位 provider 声明的 `cliFlagMap`。
 * @returns {Promise<{flagMap: object, providers: string[]}>}
 */
export async function primeCommitContributions() {
  const flagMap = {};
  const providers = [];
  try {
    const { manifests } = await listProviderManifests();
    for (const item of manifests) {
      const manifest = item.manifest || {};
      providers.push(item.provider.id);
      if (manifest.cliFlagMap && typeof manifest.cliFlagMap === 'object') {
        Object.assign(flagMap, manifest.cliFlagMap);
      }
    }
  } catch {
    // 读不到声明不影响主流程：阶段参数会被忽略（不会静默变语义，stage 回执里可见 ok/跳过原因）
  }
  commitContributionCache = { flagMap: flagMap, providers: providers };
  return commitContributionCache;
}

/**
 * 同步读缓存；未预热时返回空映射（等价「没有安装任何预处理实现」）。
 * @returns {{flagMap: object, providers: string[]}}
 */
export function getCommitContributions() {
  return commitContributionCache || { flagMap: {}, providers: [] };
}
