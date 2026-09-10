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
 * 槽位排序偏好（**只是顺序参考，不决定"有哪些槽位"**）。
 *
 * 槽位全动态：**放一个 audit-rules-<名>.yml
 * 进目录就自动成为槽位**，不需要改代码。
 * 因此：槽位集合 = discoverRuleSlots()（目录实际文件）；
 *       本常量仅用于给常见槽位排个优先级，未列出的按文件名字典序排在后面。
 */
export const SLOT_ORDER_HINT = ['nodejs', 'frontend', 'npm', 'version', 'dsh', 'comment', 'structure', 'private', 'docs', 'template'];

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
    if (!slot || seen.has(slot) || !allowed.has(slot)) return;
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
 */
export function loadRuleFiles(order = null, opts = {}) {
  const dir = opts.dir || RULE_YAML_DIR;
  const slots = Array.isArray(order) ? order : resolveSlotOrder(order, { dir });
  const errors = [];
  const files = [];
  const merged = { metadata: {}, rules: [], severity_map: {}, thresholds: {}, ignore: [], private_files: [] };
  for (const slot of slots) {
    const r = loadYamlRuleFile(slot, dir);
    if (!r.ok) { errors.push(r.error); continue; }
    files.push(r.file);
    const d = r.data;
    if (d?.metadata && !merged.metadata.name) merged.metadata = d.metadata;
    merged.rules.push(...(Array.isArray(d?.rules) ? d.rules : []));
    Object.assign(merged.severity_map, d?.severity_map || {});
    Object.assign(merged.thresholds, d?.thresholds || {});
    merged.ignore.push(...(Array.isArray(d?.ignore) ? d.ignore : []));
    // v1.48.0：私密拦截清单跨文件追加（强制槽位 private.yml 永远最后加载 → 天然追加）
    if (Array.isArray(d?.private_files)) merged.private_files.push(...d.private_files);
  }
  return { ok: errors.length === 0, merged, order: slots, files, errors };
}