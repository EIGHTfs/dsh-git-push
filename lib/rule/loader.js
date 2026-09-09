/**
 * dsh-git-push-v2 规则总入口：yml 装载与解析
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

/** 规则槽位（排除 template 默认不加载）。 */
export const RULE_SLOTS = [
  'nodejs', 'npm', 'html', 'frontend', 'comment', 'dsh', 'private', 'structure', 'version',
];

/**
 * 读取单个槽位 yml（纯数据，不做合并）。
 * @returns {{ok:true, data:object, file:string} | {ok:false, error:string}}
 */
export function loadYamlRuleFile(slot) {
  const file = join(RULE_YAML_DIR, `audit-rules-${slot}.yml`);
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
 * 按顺序装载并合并多个槽位（后覆盖前）。
 * @param {string[]} order 槽位顺序
 */
export function loadRuleFiles(order = RULE_SLOTS) {
  const errors = [];
  const files = [];
  const merged = { metadata: {}, rules: [], severity_map: {}, thresholds: {}, ignore: [] };
  for (const slot of order) {
    const r = loadYamlRuleFile(slot);
    if (!r.ok) { errors.push(r.error); continue; }
    files.push(r.file);
    const d = r.data;
    if (d?.metadata && !merged.metadata.name) merged.metadata = d.metadata;
    merged.rules.push(...(Array.isArray(d?.rules) ? d.rules : []));
    Object.assign(merged.severity_map, d?.severity_map || {});
    Object.assign(merged.thresholds, d?.thresholds || {});
    merged.ignore.push(...(Array.isArray(d?.ignore) ? d.ignore : []));
  }
  return { ok: errors.length === 0, merged, order, files, errors };
}