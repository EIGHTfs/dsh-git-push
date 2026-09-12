/**
 * dsh-git-push 规则总入口：yml 装载与解析
 *
 * 统一装载所有 yml 规则槽位（nodejs/npm/html/frontend/comment/dsh/private/structure/version/template 等），
 * 支持 yml 衍生新字段（编译函数按字段指派，见 ./registry.js）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const RULE_YAML_DIR = join(__dirname, '..', 'audit-rules');

/**
 * 核心槽位优先级提示（**不是全量清单，禁止补成全部槽位**）。
 *
 * 槽位集合全动态：放一个 audit-rules-<名>.yml 进目录就自动成为槽位，
 * 无需改代码——见 discoverRuleSlots()。本常量只用于把高频核心槽位排到前面，
 * **只维护核心子集即可**；新增/未列出的槽位由 resolveSlotOrder 按文件名字典序
 * 自动追加到末尾，加槽位零改动（放 yml 即生效）。
 */
export const SLOT_ORDER_HINT = ['nodejs', 'frontend', 'npm', 'comment', 'dsh', 'structure', 'private', 'template'];

/**
 * 强制加载槽位（1.1.0，disabled 无法关闭的安全红线）：
 *   - nodejs：含凭据/硬编码/路径穿越等安全规则（secret-*、cred*、security/*），不可被 yml 关闭
 *   - private：私密文件拦截（独立通道，天然强制）
 * 即使槽位 yml 顶层标 `disabled: true` 也强制加载（环境变量显式列出同样生效）。
 */
export const FORCE_LOAD_SLOTS = new Set(['nodejs', 'private']);

/**
 * 强制加载规则前缀（1.1.0）：规则条目即使标 `disabled: true` 也保留——
 * 凭据/硬编码/私密引用类安全红线不允许被 yml 关闭。
 * 覆盖：secret-*（github-pat/openai-key/keyvalue/email/aws-access-key/generic-token）、
 * credfile-* 与 credref-*（凭据文件/引用）、security/*（路径穿越/硬编码凭据/求值）、
 * npm/npmrc-authtoken（.npmrc 凭据）、dsh/schema-secret-*（schema 凭据字段）。
 * @param {string} ruleId 规则 id
 * @returns {boolean} true=强制加载（无视 disabled）
 */
export function isForceLoadRule(ruleId) {
  return /^(secret-|cred(file|ref)?-|security\/|npm\/npmrc-authtoken|dsh\/schema-secret)/.test(String(ruleId || ''));
}

/**
 * 强制加载槽位内置兜底规则（1.1.0）：文件丢失/被删时安全审计不断档——
 * 凭据/硬编码/路径穿越类最小安全集 + 私密文件清单（与 audit-rules-nodejs.yml /
 * audit-rules-private.yml 语义一致的精简版）。加载时若发现强制槽位文件缺失，
 * 用本兜底合并进规则集并记入 errors（CLI/工具可感知「规则包不完整」）。
 */
export const FORCE_LOAD_FALLBACK = {
  nodejs: [
    {
      id: 'secret-generic-token', name: '疑似凭据 token 硬编码', category: 'security',
      severity: 'error', description: '疑似 token/secret 硬编码（内置兜底，规则文件缺失）',
      pattern: '\\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sk-)[A-Za-z0-9_-]{15,}\\b', fixable: false,
    },
    {
      id: 'security/no-hardcoded-credentials', name: '禁止硬编码凭据', category: 'security',
      severity: 'error', description: '凭据不应硬编码在源代码中（内置兜底，规则文件缺失）',
      patterns: [
        'password\\s*[=:]+\\s*[\'"][^\'"]+[\'"]',
        'secret\\s*[=:]+\\s*[\'"][^\'"]+[\'"]',
        'api[_-]?key\\s*[=:]+\\s*[\'"][^\'"]+[\'"]',
        'token\\s*[=:]+\\s*[\'"][^\'"]+[\'"]',
      ],
      fixable: false,
    },
    {
      id: 'security/no-path-traversal', name: '路径穿越防护', category: 'security',
      severity: 'error', description: '直接使用用户输入作为文件路径存在目录遍历风险（内置兜底，规则文件缺失）',
      fixable: false,
    },
  ],
  private_files: [
    '**/id_ed25519', '**/id_rsa', '**/*.pem', '**/*.key', '**/github-token',
    '**/.git-push-token', '**/.env', '**/.env.*', '**/data/sensitive/**',
    '**/.ssh/**', '**/.dsh/git-push/**', '**/.npmrc',
  ],
};

/**
 * @deprecated 兼容旧调用：等于槽位排序偏好。槽位集合请用 discoverRuleSlots()。
 */
export const RULE_SLOTS = SLOT_ORDER_HINT;

/**
 * 读取单个槽位 yml（纯数据，不做合并）。
 * @returns {{ok:true, data:object, file:string} | {ok:false, error:string}}
 */
export function loadYamlRuleFile(slot, dir = RULE_YAML_DIR) {
  const file = join(dir, `audit-rules-${slot}.yml`);
  try {
    if (!existsSync(file)) return { ok: false, error: `规则文件缺失: ${file}` };
    const data = yamlLoad(readFileSync(file, 'utf8'));
    return { ok: true, data: data || { rules: [] }, file };
  } catch (e) {
    return { ok: false, error: `规则文件解析失败 ${slot}: ${e.message}` };
  }
}

/**
 * 发现目录下的全部规则槽位文件（含新增 yml 自动生效）。
 */
export function discoverRuleSlots(dir = RULE_YAML_DIR) {
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith('audit-rules-') && f.endsWith('.yml'))
      .map((f) => f.replace(/^audit-rules-/, '').replace(/\.yml$/, ''));
  } catch {
    return [];
  }
}

/**
 * 解析生效槽位顺序（**全动态**：槽位集合由目录内的规则文件决定）。
 *
 * 规则：
 *   1) 槽位集合 = 目录里实际存在的 `audit-rules-<名>.yml`（放文件即生效，无需改代码）
 *   2) 顺序 = 配置若给了顺序则按配置；否则按 SLOT_ORDER_HINT 偏好排序，未列出的按字典序追加
 *   3) 配置声明的槽位若文件不存在 → 静默跳过（不报缺失，方便先写配置后放文件）
 *   4) template 槽位默认不加载（模板保持为空，不进默认装载）
 *
 * @param {string[]|string} [order] 配置指定的槽位顺序（数组或逗号分隔字符串）
 * @param {object} [opts] { dir, includeTemplate=false }
 * @returns {string[]} 最终槽位顺序
 */
export function resolveSlotOrder(order = null, { dir = RULE_YAML_DIR, includeTemplate = false } = {}) {
  const discovered = discoverRuleSlots(dir);
  const allowed = new Set(discovered);
  let configured = order;
  if (!configured && process.env.DSH_GIT_PUSH_RULE_SLOTS) {
    configured = String(process.env.DSH_GIT_PUSH_RULE_SLOTS);
  }
  if (typeof configured === 'string') {
    configured = configured.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const hasConfig = Array.isArray(configured) && configured.length > 0;
  const seen = new Set();
  const out = [];
  const push = (slot) => {
    if (!slot || seen.has(slot)) return;
    // 强制加载槽位（nodejs/private）：即使目录里文件缺失也进入装载列表（loadRuleFiles 兜底），
    // 保证安全红线不因规则包被删/目录指向错误而静默消失
    if (!allowed.has(slot) && !FORCE_LOAD_SLOTS.has(slot)) return;
    if (slot === 'template' && !includeTemplate) return;
    seen.add(slot);
    out.push(slot);
  };
  if (hasConfig) {
    // 配置顺序优先（配置里没有但目录存在的，随后按偏好补上）
    for (const slot of configured) push(slot);
  }
  // 动态发现：按排序偏好排，未列在偏好里的按字典序追加
  const hintRest = SLOT_ORDER_HINT.filter((s) => !seen.has(s));
  for (const slot of hintRest) push(slot);
  for (const slot of [...discovered].sort()) push(slot);
  return out;
}

/**
 * 按顺序装载并合并多个槽位（后覆盖前）。
 * @param {string[]|string} [order] 槽位顺序（缺省走 resolveSlotOrder 配置驱动解析）
 *
 * disabled 机制（1.1.0）：
 *   1) 文件级：yml 顶层 `disabled: true` → 整槽位默认不加载（如 audit-rules-i18n.yml 默认关）。
 *      例外：环境变量 DSH_GIT_PUSH_RULE_SLOTS 显式列出该槽位 → 强制加载（用户明确要开）。
 *   2) 规则级：单条规则 `disabled: true` → 该条规则不编译（合并时直接过滤，无需删/改文件）。
 */
export function loadRuleFiles(order = null, opts = {}) {
  const dir = opts.dir || RULE_YAML_DIR;
  const slots = Array.isArray(order) ? order : resolveSlotOrder(order, { dir });
  // 显式列出的槽位集合：调用方显式传 order 或环境变量 DSH_GIT_PUSH_RULE_SLOTS
  const explicit = new Set(
    Array.isArray(order)
      ? order
      : String(process.env.DSH_GIT_PUSH_RULE_SLOTS || '')
          .split(',').map((s) => s.trim()).filter(Boolean),
  );
  const errors = [];
  const files = [];
  const merged = { metadata: {}, rules: [], severity_map: {}, thresholds: {}, ignore: [], private_files: [] };
  for (const slot of slots) {
    const r = loadYamlRuleFile(slot, dir);
    if (!r.ok) {
      // 强制加载槽位（nodejs/private）文件缺失 → 内置兜底，安全审计不断档 + 显式记录
      if (FORCE_LOAD_SLOTS.has(slot)) {
        if (slot === 'nodejs') merged.rules.push(...FORCE_LOAD_FALLBACK.nodejs);
        else merged.private_files.push(...FORCE_LOAD_FALLBACK.private_files);
        errors.push(`强制加载槽位 ${slot} 规则文件缺失（${r.error}）——已用内置兜底规则集，建议恢复 audit-rules-${slot}.yml`);
        continue;
      }
      errors.push(r.error); continue;
    }
    // 文件级 disabled：yml 顶层 disabled:true 且未被显式列出且非强制加载槽位 → 跳过整槽位
    if (r.data?.disabled === true && !explicit.has(slot) && !FORCE_LOAD_SLOTS.has(slot)) continue;
    files.push(r.file);
    const d = r.data;
    if (d?.metadata && !merged.metadata.name) merged.metadata = d.metadata;
    // 规则级 disabled：合并前过滤 disabled:true 条目（安全红线规则 isForceLoadRule 强制保留）
    merged.rules.push(...(Array.isArray(d?.rules)
      ? d.rules.filter((x) => x?.disabled !== true || isForceLoadRule(x.id))
      : []));
    Object.assign(merged.severity_map, d?.severity_map || {});
    Object.assign(merged.thresholds, d?.thresholds || {});
    merged.ignore.push(...(Array.isArray(d?.ignore) ? d.ignore : []));
    // v1.48.0：私密拦截清单跨文件追加（强制槽位 private.yml 永远最后加载 → 天然追加）
    if (Array.isArray(d?.private_files)) merged.private_files.push(...d.private_files);
  }
  return { ok: errors.length === 0, merged, order: slots, files, errors };
}