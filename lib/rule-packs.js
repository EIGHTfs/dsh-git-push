/**
 * dsh-git-push 审计规则引擎（v1.47.0，YAML 化重写）
 *
 * 设计（2026-09-09 确立：规则文件即权重文件）：
 *   - 规则载体 = YAML（lib/audit-rules/*.yml），插件默认自带四份：
 *       nodejs（Node.js 后端代码审计）→ frontend（前端 HTML 审计）→ comment（注释关键词评分）→ template（纯模板/自定义入口）
 *   - 顺序 = 配置 `auditRuleOrder`（默认 [nodejs, frontend, comment, template]），设置侧边栏可排序；
 *     按序加载，后覆盖前（同 id 规则后者覆盖前者；同 blacklist pattern 后者权重覆盖）。
 *   - 这四个文件既是规则文件也是权重文件：规则里的 severity/weight/penalty/threshold 即权重，
 *     侧边栏「调权重」可视化编辑（写 config.auditRuleWeights 覆盖，规则包优先）。
 *   - severity 三级映射（既定规则）：error→blocker（拦截提交）、warning→warning（提醒）、
 *     info→pass（通过：不算警告不拦截，仅报告可见）。
 *   - JSON 规则包形态废弃（替换，非并存）：stripJsonComments/loadRulePackFromFile 等旧 API 删除。
 *
 * 编译产物（引擎消费结构，audit.js 兼容字段名保留）：
 *   {
 *     meta: { name, owner, version, source, order, files },
 *     secretPatterns: [{name, re, message}],      // error 级敏感键值/凭据
 *     credentialFileRes: [RegExp],               // error 级凭据文件路径
 *     credentialRefPatterns: [{name, re, message}], // warning 级文档凭据引用
 *     wordingPatterns: [{name, re}],             // comment.yml blacklist 高分项（≥ 门禁阈值）
 *     docConvPatterns: [{name, re}],             // 文档对话残留
 *     codeQuality: {},                           // 函数行数等阈值型规则
 *     styleRules: [{id,name,severity,kind,threshold,exceptions,re,message}], // 数值型（min_length/max_lines/max_complexity/min_occurrences）
 *     commentScoring: { threshold, thresholdHighlySuspicious, maxScore, blacklist:[{name,re,weight}], whitelist:[{name,re,penalty}], features:[...] },
 *     ignore: [{glob,re,rules:['*'|ids]}],       // 路径豁免
 *     privateFiles: [{glob,re}],                 // v1.48.0 私密拦截清单（强制槽位，git ls-files 全量匹配）
 *     fullScan: null,                            // 兼容字段（评分走 commentScoring）
 *     quality: {...},                            // 文件级评分阈值
 *     errors: []
 *   }
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** YAML 规则目录（插件内置） */
export const RULE_YAML_DIR = join(__dirname, 'audit-rules');
/** 槽位 → 文件名（用户交付命名：audit-rules-<slot>.yml） */
const SLOT_FILE = (slot) => `audit-rules-${slot}.yml`;

/**
 * v1.52.0：槽位动态发现——扫描 RULE_YAML_DIR 下 audit-rules-<slot>.yml 自动得到槽位清单，
 * 不再硬编码（加新规则 yml 即自动成为槽位，无需再改 RULE_SLOTS/DEFAULT_RULE_ORDER/client）。
 * 排序稳定性：目录 readdir 顺序（默认字典序）→ 可配置：顺序由 auditRuleOrder 控制。
 */
export function discoverRuleSlots() {
  let names = [];
  try { names = readdirSync(RULE_YAML_DIR); } catch { return []; }
  return names
    .filter((f) => /^audit-rules-[a-z0-9_-]+\.yml$/.test(f))
    .map((f) => f.replace(/^audit-rules-/, '').replace(/\.yml$/, ''))
    .sort();
}
/** 动态槽位清单（含 private/template；私密拦截强制末尾不参与排序） */
export const RULE_SLOTS = discoverRuleSlots();
/**
 * v1.52.0 动态槽位元数据：{ slot: { name, description } }（读各 yml 的 metadata.name/description 做显示名）。
 * 惰性构建（发现时读文件头）；client 侧显示名从 config.ruleSlotMeta 读取（host 注入），见 plugin-setup。
 */
let _slotMetaCache = null;
export function getRuleSlotMeta() {
  if (_slotMetaCache) return _slotMetaCache;
  const meta = {};
  for (const slot of RULE_SLOTS) {
    const file = join(RULE_YAML_DIR, SLOT_FILE(slot));
    try {
      const d = yamlLoad(readFileSync(file, 'utf8'));
      const m = d?.metadata || {};
      meta[slot] = { name: m.name || slot, description: m.description || '' };
    } catch { meta[slot] = { name: slot, description: '' }; }
  }
  _slotMetaCache = meta;
  return meta;
}
export function clearRuleSlotMetaCache() { _slotMetaCache = null; }
/** 强制加载槽位（v1.48.0 私密拦截审计）：永远末尾合并，用户无法经 auditRuleOrder 移除 */
export const FORCED_SLOTS = ['private'];
/**
 * v1.52.0 默认加载顺序（动态）：全部发现的槽位中排除 template（空模板，不加载）
 * 与 private（强制末尾另行合入）；用户可用 auditRuleOrder 覆盖。
 */
export function getDefaultRuleOrder() {
  return RULE_SLOTS.filter((s) => s !== 'template' && !FORCED_SLOTS.includes(s));
}
/** 兼容旧导出名：默认加载顺序（动态；调用方注意这是快照，重新导入后更新） */
export const DEFAULT_RULE_ORDER = getDefaultRuleOrder();

/** severity → 引擎级别（既定规则：error→blocker 拦截、warning→warning 提醒、info→pass 通过） */
export const SEVERITY_LEVEL_MAP = { error: 'blocker', warning: 'warning', info: 'pass' };
/** 有效 severity 集 */
export const SEVERITIES = Object.keys(SEVERITY_LEVEL_MAP);

/** 安全编译正则：非法 pattern 返回 null（调用方跳过并记 errors，不抛错） */
function safeRe(pattern, name, errors, flags = '') {
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    errors.push(`规则「${name}」正则非法: ${String(e?.message || e).slice(0, 120)}`);
    return null;
  }
}

/**
 * glob 转正则源码（路径豁免用）。
 * 支持：双星跨目录、单星单段、问号单字符、花括号枚举、尾部双星、前缀双星。
 * 示例：双星斜线 dist 斜线双星斜线单星，匹配 dist 前有任意路径或无路径。
 */
export function globToReSource(pattern) {
  let p = String(pattern || '').trim();
  // 1) 花括号展开为正则组（先做，避免被后续转义破坏）
  p = p.replace(/\{([^{}]+)\}/g, (_, inner) => `(${inner.split(',').map((x) => x.trim()).filter(Boolean).join('|')})`);
  // 2) 转义除（星号问号斜杠）外的正则特殊字符（星号问号留待下面语义处理）
  p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // 3) 恢复花括号展开的组括号与管道（刚被转义）
  p = p.replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\|/g, '|');
  // 4) 双星先换哨兵（防后续单星替换污染）
  p = p.replace(/\*\*/g, '\u0000');
  // 5) 单星 → 单层内任意名
  p = p.replace(/\*/g, '[^/]*');
  // 6) 问号 → 单字符
  p = p.replace(/\?/g, '.');
  // 7) 哨兵+斜杠（`**/` 曾出现处）→ 零或多层目录
  p = p.replace(/\u0000\//g, '(?:[^/]+/)*');
  // 8) 残余哨兵（尾随 `**`）→ 任意深度任意名
  p = p.replace(/\u0000/g, '.*');
  return `^${p}$`;
}

/**
 * 读单个 YAML 规则文件 → 解析对象。返回 { ok, data?, error? }。
 * 只做解析与最小形状检查；完整校验走 validateYamlRuleSet。
 */
export function loadYamlRuleFile(slot) {
  const file = join(RULE_YAML_DIR, SLOT_FILE(slot));
  try {
    if (!existsSync(file)) return { ok: false, error: `规则文件不存在: ${file}` };
    const text = readFileSync(file, 'utf8');
    if (text.length > 2 * 1024 * 1024) return { ok: false, error: `规则文件超限(${text.length}B)` };
    const data = yamlLoad(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: `YAML 顶层必须是对象: ${slot}` };
    if (!Array.isArray(data.rules)) return { ok: false, error: `YAML 缺 rules 数组: ${slot}` };
    return { ok: true, data, slot, file };
  } catch (e) {
    return { ok: false, error: `YAML 解析失败(${slot}): ${String(e?.message || e).slice(0, 150)}` };
  }
}

/** 顶层段合并（metadata/severity_map/thresholds/output/dynamic_detection/fullScan/quality：后覆盖前）。 */
function mergeTopLevelSections(merged, d) {
  merged.metadata = { ...merged.metadata, ...(d.metadata || {}) };
  if (d.severity_map && typeof d.severity_map === 'object') merged.severity_map = { ...merged.severity_map, ...d.severity_map };
  if (d.thresholds && typeof d.thresholds === 'object') merged.thresholds = { ...merged.thresholds, ...d.thresholds };
  if (d.output && typeof d.output === 'object') merged.output = { ...merged.output, ...d.output };
  if (d.dynamic_detection && typeof d.dynamic_detection === 'object') merged.dynamic_detection = { ...(merged.dynamic_detection || {}), ...d.dynamic_detection };
  if (d.fullScan && typeof d.fullScan === 'object') merged.fullScan = { ...(merged.fullScan || {}), ...d.fullScan };
  if (d.quality && typeof d.quality === 'object') merged.quality = { ...(merged.quality || {}), ...d.quality };
}

/** commentScoring 缺省骨架。 */
function defaultCommentScoring() {
  return { blacklist: [], whitelist: [], features: [], threshold: 60, thresholdHighlySuspicious: 80, maxScore: 100, suggestions: [] };
}

/** rules 数组合并（同 id 后覆盖前）+ 内嵌 blacklist/whitelist/scoring 提升为合并级 commentScoring（后覆盖前）。 */
function mergeRulesSection(merged, d, slot, errors) {
  for (const rule of d.rules || []) {
    if (!rule || typeof rule !== 'object' || !rule.id) { errors.push(`规则缺 id（${slot}）`); continue; }
    const idx = merged.rules.findIndex((x) => x.id === rule.id);
    if (idx >= 0) merged.rules[idx] = { ...merged.rules[idx], ...rule }; // 后覆盖前
    else merged.rules.push(rule);
    if (Array.isArray(rule.blacklist) && rule.blacklist.length) {
      const cur = merged.commentScoring || defaultCommentScoring();
      const sc = rule.scoring || {};
      if (sc.threshold_suspicious !== undefined) cur.threshold = sc.threshold_suspicious;
      if (sc.threshold_highly_suspicious !== undefined) cur.thresholdHighlySuspicious = sc.threshold_highly_suspicious;
      if (sc.max_score !== undefined) cur.maxScore = sc.max_score;
      if (Array.isArray(rule.suggestions)) cur.suggestions = rule.suggestions;
      mergePatternList(cur.blacklist, rule.blacklist, 'pattern');
      mergePatternList(cur.whitelist, rule.whitelist, 'pattern');
      mergePatternList(cur.features, rule.additional_features, 'name');
      merged.commentScoring = cur;
    }
  }
}

/** 同名 pattern/name 列表合并（后覆盖前）。 */
function mergePatternList(target, items, key) {
  for (const item of items || []) {
    if (!item || !item[key]) continue;
    const i = target.findIndex((x) => x[key] === item[key]);
    if (i >= 0) target[i] = { ...target[i], ...item };
    else target.push(item);
  }
}

/** comment 段（comment.yml 特有）：blacklist/whitelist 同 pattern 后覆盖前。 */
function mergeCommentSection(merged, d) {
  const dC = d.commentScoring || d.scoring_section || null;
  if (!dC || typeof dC !== 'object') return;
  const cur = merged.commentScoring || defaultCommentScoring();
  if (dC.threshold !== undefined) cur.threshold = dC.threshold;
  if (dC.threshold_highly_suspicious !== undefined) cur.thresholdHighlySuspicious = dC.threshold_highly_suspicious;
  if (dC.max_score !== undefined) cur.maxScore = dC.max_score;
  if (Array.isArray(dC.suggestions)) cur.suggestions = dC.suggestions;
  mergePatternList(cur.blacklist, dC.blacklist, 'pattern');
  mergePatternList(cur.whitelist, dC.whitelist, 'pattern');
  mergePatternList(cur.features, dC.features, 'name');
  merged.commentScoring = cur;
}

/**
 * 按 order 加载并合并多个 YAML 规则文件（后覆盖前）。
 * @param {string[]} [order] 槽位顺序，缺省 DEFAULT_RULE_ORDER；未知槽位跳过并记 errors
 * @returns {{ ok: boolean, merged?: object, order?: string[], files?: string[], errors?: string[] }}
 */
export function loadYamlRuleFiles(order) {
  const seq = Array.isArray(order) && order.length ? order.filter((s) => RULE_SLOTS.includes(s)) : [...DEFAULT_RULE_ORDER];
  const errors = [];
  const files = [];
  const merged = { metadata: {}, rules: [], severity_map: {}, thresholds: {}, ignore: [], output: {}, dynamic_detection: null, fullScan: null, quality: null, commentScoring: null, private_files: [] };
  for (const slot of seq) {
    const r = loadYamlRuleFile(slot);
    if (!r.ok) { errors.push(r.error); continue; }
    files.push(r.file);
    const d = r.data;
    // metadata：后覆盖前
    mergeTopLevelSections(merged, d);
    // v1.48.0：private_files（私密拦截清单）跨文件追加——强制槽位永远最后加载，天然后覆盖前
    if (Array.isArray(d.private_files)) merged.private_files.push(...d.private_files);
    // rules：同 id 后覆盖前（comment.yml 形态：规则内嵌 blacklist/whitelist/scoring 提升为合并级 commentScoring）
    mergeRulesSection(merged, d, slot, errors);
    // ignore：追加（跨文件合并，不按内容去重——同文件内重复由校验拒）
    if (Array.isArray(d.ignore)) merged.ignore.push(...d.ignore);
    // comment 段（comment.yml 特有）
    mergeCommentSection(merged, d);
  }
  if (merged.rules.length === 0 && merged.private_files.length === 0) errors.push('合并后无任何规则与私密文件清单');
  return { ok: errors.length === 0 ? true : (merged.rules.length > 0), merged, order: seq, files, errors };
}

/** 单条规则校验：id 唯一 / severity 合法 / pattern(s) 可编译 / 数值型阈值正数。 */
function validateRuleEntry(r, i, ids, errors) {
  const label = r?.id || `#${i}`;
  if (!r || typeof r !== 'object') { errors.push(`规则 ${label} 不是对象`); return; }
  if (!r.id) errors.push(`规则 #${i} 缺少 id`);
  else if (ids.has(r.id)) errors.push(`规则 id 重复: ${r.id}`);
  else ids.add(r.id);
  if (r.severity && !SEVERITIES.includes(r.severity)) errors.push(`规则 ${label} severity 非法: ${r.severity}（允许 ${SEVERITIES.join('|')}）`);
  for (const key of ['pattern']) {
    if (typeof r[key] === 'string') {
      const re = safeRe(r[key], label, errors);
      if (!re) errors.push(`规则 ${label} ${key} 正则非法`);
    }
  }
  if (Array.isArray(r.patterns)) {
    for (const p of r.patterns) {
      if (typeof p === 'string') {
        const re = safeRe(p, label, errors);
        if (!re) errors.push(`规则 ${label} patterns 正则非法`);
      }
    }
  }
  for (const k of ['min_length', 'max_lines', 'max_complexity', 'min_occurrences', 'min_lines']) {
    if (r[k] !== undefined && (!Number.isFinite(r[k]) || r[k] <= 0)) errors.push(`规则 ${label} ${k} 必须是正数`);
  }
}

/** ignore glob 编译性校验。 */
function validateIgnoreList(merged, errors) {
  for (const [i, ig] of (merged.ignore || []).entries()) {
    if (!ig || typeof ig !== 'object' || typeof ig.pattern !== 'string') { errors.push(`ignore[${i}] 需含 pattern`); continue; }
    try {
      new RegExp(globToReSource(ig.pattern));
    } catch (e) { errors.push(`ignore[${i}] glob 非法: ${String(e?.message || e).slice(0, 80)}`); }
  }
}

/** commentScoring 结构校验：数值正数 / 数组类型 / blacklist weight / whitelist penalty。 */
function validateCommentScoring(cs, errors) {
  for (const k of ['threshold', 'thresholdHighlySuspicious', 'maxScore']) {
    if (cs[k] !== undefined && (!Number.isFinite(cs[k]) || cs[k] <= 0)) errors.push(`commentScoring.${k} 必须是正数`);
  }
  for (const arrKey of ['blacklist', 'whitelist', 'features']) {
    if (cs[arrKey] !== undefined && !Array.isArray(cs[arrKey])) errors.push(`commentScoring.${arrKey} 必须是数组`);
  }
  for (const b of cs.blacklist || []) {
    if (!b || typeof b !== 'object' || !b.pattern) { errors.push('commentScoring.blacklist 每项需含 pattern'); continue; }
    if (b.weight !== undefined && (!Number.isFinite(b.weight) || b.weight <= 0)) errors.push(`blacklist「${b.pattern}」weight 必须是正数`);
    safeRe(b.pattern, `blacklist:${b.pattern}`, errors);
  }
  for (const w of cs.whitelist || []) {
    if (!w || typeof w !== 'object' || !w.pattern) { errors.push('commentScoring.whitelist 每项需含 pattern'); continue; }
    if (w.penalty !== undefined && (!Number.isFinite(w.penalty) || w.penalty <= 0)) errors.push(`whitelist「${w.pattern}」penalty 必须是正数`);
    safeRe(w.pattern, `whitelist:${w.pattern}`, errors);
  }
}

/**
 * 校验合并后的 YAML 规则集。返回 { ok, errors }。
 * 校验：metadata 存在；规则 id 唯一（合并后已去重，此处防同文件重复）；severity 合法；
 * pattern(s) 正则可编译；数值型阈值正数；ignore glob 可编译；commentScoring 结构合法。
 */
export function validateYamlRuleSet(merged) {
  const errors = [];
  if (!merged || typeof merged !== 'object') return { ok: false, errors: ['规则集必须是对象'] };
  if (!merged.metadata || typeof merged.metadata !== 'object') errors.push('缺 metadata');
  if (!Array.isArray(merged.rules)) errors.push('rules 必须是非空数组');
  const ids = new Set();
  for (const [i, r] of (merged.rules || []).entries()) validateRuleEntry(r, i, ids, errors);
  validateIgnoreList(merged, errors);
  if (merged.commentScoring) validateCommentScoring(merged.commentScoring, errors);
  return { ok: errors.length === 0, errors };
}

/**
 * 编译合并后的 YAML 规则集 → 引擎消费结构。
 * severity 映射（既定规则）：error→blocker（拦提交）、warning→warning（提醒）、info→pass（通过）。
 * 规则按语义归桶：
 *   - 凭据类（category=security 且 pattern 命中键值/凭据，或 id 含 credential/secret）→ secret/credentialFile/credentialRef
 *   - comment.yml 的 blacklist 高分项 → wordingPatterns（提交门禁 blocker）
 *   - 数值型（min_length/max_lines/max_complexity/min_occurrences）→ styleRules
 *   - 其余 pattern 正则 → 通用 styleRules（regex 型）
 */
export function compileYamlRuleSet(merged, { order = DEFAULT_RULE_ORDER, files = [], source = 'yaml' } = {}) {
  const errors = [];
  const out = {
    meta: {
      name: merged?.metadata?.name || 'yaml-rules',
      owner: merged?.metadata?.author || 'EIGHTfs',
      version: String(merged?.metadata?.version ?? '0'),
      source,
      order: [...order],
      files,
    },
    secretPatterns: [],
    credentialFileRes: [],
    credentialRefPatterns: [],
    wordingPatterns: [],
    docConvPatterns: [],
    codeQuality: {},
    styleRules: [],
    semanticRules: [],
    commentScoring: null,
    ignore: [],
    privateFiles: [],
    fullScan: null,
    quality: compileQualitySection(merged?.quality),
    errors,
  };
  compileRuleBuckets(out, merged, errors);
  compileCommentScoring(out, merged, errors);
  compileDocConvAndIgnore(out, merged, errors);
  compilePrivateFiles(out, merged, errors);
  return out;
}

/**
 * v1.48.0：私密文件清单编译（私密拦截审计）。
 * 来源 = 合并后 private_files（各槽位 private_files 追加；private 强制槽位最后加载天然后覆盖前）。
 * 缺省兜底：内置私密清单（与 yml 缺省同源，防文件缺失时门禁失效）。
 * 输出 out.privateFiles: [{ glob, re }]，供 audit.js 以 git ls-files 全量匹配。
 */
const DEFAULT_PRIVATE_FILES = [
  '**/id_ed25519', '**/id_rsa', '**/*.pem', '**/*.key',
  '**/github-token', '**/.git-push-token', '**/.env', '**/.env.*',
  '**/data/sensitive/**', '**/.ssh/**', '**/.dsh/git-push/**', '**/.npmrc',
];
function compilePrivateFiles(out, merged, errors) {
  const globs = Array.isArray(merged?.private_files) && merged.private_files.length
    ? merged.private_files
    : DEFAULT_PRIVATE_FILES;
  for (const glob of globs) {
    if (typeof glob !== 'string' || !glob.trim()) continue;
    const re = safeRe(globToReSource(glob.trim()), `private_files:${glob}`, errors);
    if (re) out.privateFiles.push({ glob: glob.trim(), re });
  }
}

/** 规则 id 前缀命中判定。 */
function ruleIdPrefix(prefix) {
  return new RegExp(`^${prefix}[-/]`, 'i');
}

/** 编译凭据引用规则（credref-*）→ out.credentialRefPatterns。返回是否已处理。 */
function compileCredRefRule(out, r, label, message, errors) {
  if (!ruleIdPrefix('credref').test(r?.id || '')) return false;
  for (const p of [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter(Boolean)) {
    const re = safeRe(p, label, errors);
    if (re) out.credentialRefPatterns.push({ name: label, re, message: message || '' });
  }
  return true;
}

/** 编译凭据文件规则（credfile-*）→ out.credentialFileRes。返回是否已处理。 */
function compileCredFileRule(out, r, label, errors) {
  if (!ruleIdPrefix('credfile').test(r?.id || '')) return false;
  const re = safeRe(r?.path_pattern || r?.pathPattern || '', label, errors);
  if (re) out.credentialFileRes.push(re);
  return true;
}

/** 编译凭据（secret-*）规则 → out.secretPatterns。返回是否已处理。 */
function compileSecretRule(out, r, label, message, errors) {
  if (!ruleIdPrefix('secret').test(r?.id || '')) return false;
  for (const p of [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter(Boolean)) {
    const re = safeRe(p, label, errors);
    if (re) out.secretPatterns.push({ name: label, re, message: message || `疑似敏感信息（${label}）` });
  }
  return true;
}

/** 编译 func-lines → out.codeQuality。返回是否已处理。 */
function compileFuncLinesRule(out, r, label, level, message) {
  if (r?.id !== 'func-lines' && !(r?.max_lines && /function/i.test(r?.name || ''))) return false;
  out.codeQuality['func-lines'] = {
    id: r.id, level, threshold: Number(r.max_lines) || 50, blockThreshold: Number(r.max_lines) * 2 || 100,
    message: message || '单函数超长难读，应拆分',
  };
  return true;
}

/** 编译数值型/重复字符串规则 → out.styleRules。返回是否已处理。 */
function compileNumericRule(out, r, label, severity, level, message, errors) {
  const hasNumeric = r?.min_length !== undefined || r?.max_lines !== undefined || r?.max_complexity !== undefined || r?.min_occurrences !== undefined || r?.max_depth !== undefined;
  if (!hasNumeric) return false;
  // v1.58.0：规则带 ignore_patterns / ignore_values（重复硬编码字符串白名单）→ 走 repeated-string 类型
  const isRepeatedString = Array.isArray(r.ignore_patterns) || Array.isArray(r.ignore_values);
  out.styleRules.push({
    id: r.id, name: label, severity, level,
    kind: isRepeatedString ? 'repeated-string'
      : r.min_length !== undefined ? 'min-length' : r.max_lines !== undefined ? 'max-lines' : r.max_complexity !== undefined ? 'max-complexity' : r.max_depth !== undefined ? 'max-depth' : 'min-occurrences',
    threshold: r.min_length ?? r.max_lines ?? r.max_complexity ?? r.max_depth ?? r.min_occurrences,
    exceptions: Array.isArray(r.exceptions) ? r.exceptions : [],
    min_occurrences: r.min_occurrences,
    ignorePatterns: Array.isArray(r.ignore_patterns) ? r.ignore_patterns.map((p) => safeRe(p, label, errors)).filter(Boolean) : [],
    ignoreValues: Array.isArray(r.ignore_values) ? r.ignore_values.map(String) : [],
    message,
    fixable: r.fixable === true,
  });
  return true;
}

/** 编译纯正则规则 → out.styleRules（regex / path-regex 型）。返回是否已处理。 */
function compileRegexRule(out, r, label, severity, level, message, errors) {
  // 纯正则（通用）→ styleRules regex 型；v1.55.0：kind: path-regex 的规则对文件路径校验（目录结构/命名，不走新增行）
  const patterns = [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter((p) => typeof p === 'string');
  if (!patterns.length) return false;
  const res = patterns.map((p) => safeRe(p, label, errors)).filter(Boolean);
  if (res.length) {
    out.styleRules.push({
      id: r.id, name: label, severity, level,
      kind: r.kind === 'path-regex' ? 'path-regex' : 'regex',
      patterns: res, message, fixable: r.fixable === true,
      // v1.51.0：exts 目标文件类型过滤（如 ['json'] / ['npmrc']）——npm 审计规则只扫 package.json 等，
      // 避免对全部代码文件扫 json 专属模式（json/yml 默认不在 styleCode，exts 显式放行）
      exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : undefined,
    });
  }
  return true;
}

/** 编译语义规则（无 pattern 也无数值）→ out.semanticRules；不匹配则记跳过错误。 */
function compileSemanticRule(out, r, label, severity, level, message, errors) {
  // 无 pattern 也无数值的规则：语义规则桶（静态不可直接正则，交由引擎专用检查器或声明式提示）
  if (r?.detection_method || r?.category === 'security' || r?.category === 'accessibility' || /\b(路径穿越|path-traversal|test-file|测试|known-vulnerability|漏洞依赖|label|可访问名称)\b/i.test(r?.name || '') || /testing\//i.test(r?.id || '') || /dependency\//i.test(r?.id || '')) {
    out.semanticRules.push({
      id: r.id, name: label, severity, level, message,
      detectionMethod: r.detection_method || null,
      fixable: r.fixable === true,
    });
    return;
  }
  out.errors.push(`规则「${label}」既无 pattern/patterns 也无数值阈值，已跳过（如需静态检测请补 pattern，或归入语义规则命名）`);
}

/** 规则主循环：凭据 / 数值 / 正则 / 语义分桶（凭据前缀优先，避免 credref-plain-secret 被 /secret/i 抢走） */
function compileRuleBuckets(out, merged, errors) {
  // 评分类规则（已提升进 commentScoring）不再进 styleRules
  const commentScoringRuleIds = new Set();
  for (const r of merged?.rules || []) {
    if (Array.isArray(r?.blacklist) && r.blacklist.length) commentScoringRuleIds.add(r.id);
  }
  for (const r of merged?.rules || []) {
    const label = r?.name || r?.id || '(unnamed)';
    const severity = String(r?.severity || 'warning');
    const level = SEVERITY_LEVEL_MAP[severity] || 'warning';
    const message = r?.description || r?.name || '';
    if (commentScoringRuleIds.has(r?.id)) continue;
    if (compileCredRefRule(out, r, label, message, errors)) continue;
    if (compileCredFileRule(out, r, label, errors)) continue;
    if (compileSecretRule(out, r, label, message, errors)) continue;
    if (compileFuncLinesRule(out, r, label, level, message)) continue;
    if (compileNumericRule(out, r, label, severity, level, message, errors)) continue;
    if (compileRegexRule(out, r, label, severity, level, message, errors)) continue;
    compileSemanticRule(out, r, label, severity, level, message, errors);
  }
}

/** commentScoring（comment.yml 黑/白名单评分段 → fullScan 兼容 + 独立字段 + 门禁措辞） */
function compileCommentScoring(out, merged, errors) {
  const cs = merged?.commentScoring;
  if (!cs || !(cs.blacklist?.length || cs.whitelist?.length)) return;
  out.commentScoring = {
    threshold: Number(cs.threshold) > 0 ? Number(cs.threshold) : 60,
    thresholdHighlySuspicious: Number(cs.thresholdHighlySuspicious) > 0 ? Number(cs.thresholdHighlySuspicious) : 80,
    maxScore: Number(cs.maxScore) > 0 ? Number(cs.maxScore) : 100,
    blacklist: (cs.blacklist || []).map((b) => {
      const re = safeRe(b.pattern, `blacklist:${b.pattern}`, errors, b.flags || '');
      return re ? { name: String(b.pattern).slice(0, 24), re, weight: Number(b.weight) > 0 ? Number(b.weight) : 40 } : null;
    }).filter(Boolean),
    whitelist: (cs.whitelist || []).map((w) => {
      const re = safeRe(w.pattern, `whitelist:${w.pattern}`, errors, w.flags || '');
      return re ? { name: String(w.pattern).slice(0, 24), re, penalty: Number(w.penalty) > 0 ? Number(w.penalty) : 30 } : null;
    }).filter(Boolean),
    features: (cs.features || []).map((f) => {
      const re = f.pattern ? safeRe(f.pattern, `feature:${f.name}`, errors, f.flags || '') : null;
      return { name: String(f.name || ''), re, weight: Number(f.weight) > 0 ? Number(f.weight) : 10 };
    }),
    suggestions: Array.isArray(cs.suggestions) ? cs.suggestions : [],
  };
  out.fullScan = {
    threshold: out.commentScoring.threshold,
    thresholdHighlySuspicious: out.commentScoring.thresholdHighlySuspicious,
    maxScore: out.commentScoring.maxScore,
    keywords: out.commentScoring.blacklist.map((b) => ({ name: b.name, re: b.re, score: b.weight })),
    protectWords: out.commentScoring.whitelist.map((w) => ({ name: w.name, re: w.re, score: w.penalty })),
    signals: { number: 20, quote: 20, context: 20, short: 10 }, // 与 FULLSCAN_DEFAULTS 一致
  };
  // comment.yml blacklist 高分项（≥ 40）→ 提交门禁措辞规则（blocker）
  for (const b of out.commentScoring.blacklist) {
    if (b.weight >= 40) out.wordingPatterns.push({ name: b.name, re: b.re });
  }
}

/** docConvPatterns + ignore glob 编译 */
function compileDocConvAndIgnore(out, merged, errors) {
  // docConvPatterns：兼容字段（合并规则里 category=documentation 或 id 含 conv- 的 pattern）
  for (const r of merged?.rules || []) {
    if (/^conv[-/]/i.test(r?.id || '') || /doc-conversation/i.test(r?.id || '')) {
      for (const p of [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter(Boolean)) {
        const re = safeRe(p, r?.name || r?.id, errors);
        if (re) out.docConvPatterns.push({ name: r?.name || r?.id, re });
      }
    }
  }
  // ignore glob 编译
  for (const ig of merged?.ignore || []) {
    if (!ig || typeof ig.pattern !== 'string') continue;
    const re = safeRe(globToReSource(ig.pattern), `ignore:${ig.pattern}`, errors);
    if (re) out.ignore.push({ glob: ig.pattern, re, rules: Array.isArray(ig.rules) ? ig.rules : ['*'] });
  }
}

/** 编译 quality 段（文件级评分阈值；缺省=内置基准） */
function compileQualitySection(q) {
  return {
    funcLinesWarn: Number(q?.funcLinesWarn) || 50,
    funcLinesBlock: Number(q?.funcLinesBlock) || 100,
    fileLinesBase: Number(q?.fileLinesBase) || 200,
    fileLinesRate: Number(q?.fileLinesRate) || 0.05,
    fileLinesCap: Number(q?.fileLinesCap) || 40,
    fileKbBase: Number(q?.fileKbBase) || 30,
    fileKbRate: Number(q?.fileKbRate) || 0.2,
    fileKbCap: Number(q?.fileKbCap) || 30,
  };
}

/** 进程内编译缓存（按 order+files 键；clearRulePackCache 测试清理） */
const _cache = new Map();

/**
 * 获取编译后规则集（带缓存）。装载失败返回 errors 标记的兜底空规则集。
 * @param {object|string} choice { order?, weights? } 或 order 数组 / ''（缺省）
 *   weights：{ [slot]: { blacklist: { [pattern]: newWeight } } } 或扁平 { [pattern]: weight }
 *   —— 侧边栏「调权重」写回（设计需求；pattern 权重覆盖生效，参与进门禁判定）
 */
export function getCompiledRulePack(choice = {}) {
  // choice: 空/'' → 默认顺序；字符串 'a,b' → 逗号分隔顺序；数组 ['a','b'] → 直接顺序
  const c = Array.isArray(choice) ? { order: choice }
    : typeof choice === 'string'
      ? (choice.trim() ? { order: choice.split(',').map((s) => s.trim()).filter(Boolean) } : {})
      : (choice || {});
  const userOrder = Array.isArray(c.order) && c.order.length ? c.order.filter((s) => RULE_SLOTS.includes(s)) : [...DEFAULT_RULE_ORDER];
  // v1.48.0：强制槽位（private 私密拦截）永远末尾合入——即使 auditRuleOrder 排空/未含，也不能被移除
  const order = [...userOrder.filter((s) => !FORCED_SLOTS.includes(s)), ...FORCED_SLOTS];
  const weights = c.weights || {};
  const key = order.join(',') + '|w:' + JSON.stringify(weights);
  if (_cache.has(key)) return _cache.get(key);
  const loaded = loadYamlRuleFiles(order);
  const v = loaded.ok ? validateYamlRuleSet(loaded.merged) : { ok: false, errors: [] };
  const compiled = (loaded.ok && v.ok)
    ? compileYamlRuleSet(loaded.merged, { order: loaded.order, files: loaded.files, source: 'yaml' })
    : compileYamlRuleSet({ metadata: { name: '(load-failed)', author: '(unknown)', version: '0' }, rules: [] }, { order, files: [], source: 'yaml' });
  if (!loaded.ok || !v.ok) compiled.errors = [...compiled.errors, ...(loaded.errors || []), ...(v.errors || [])];
  applyWeightOverrides(compiled, weights);
  _cache.set(key, compiled);
  return compiled;
}

/**
 * v1.47.0：侧边栏「调权重」写回生效——按 pattern 覆盖 commentScoring.blacklist/whitelist 权重，
 * 并同步刷新 fullScan.keywords（门槛判定：权重 ≥ 40 → 进门禁 wordingPatterns）。
 * 不会改写 YAML 文件本体（改的是编译结果；规则文件仍是权威基线）。
 */
function applyWeightOverrides(compiled, weights) {
  if (!compiled?.commentScoring || !weights || typeof weights !== 'object') return;
  const wl = weights.blacklist || weights;
  if (!wl || typeof wl !== 'object') return;
  const patternToName = new Map(compiled.commentScoring.blacklist.map((b) => [b.re.source, b.name]));
  for (const [pattern, weight] of Object.entries(wl)) {
    const n = Number(weight);
    if (!Number.isFinite(n) || n <= 0) continue;
    const entry = compiled.commentScoring.blacklist.find((b) => b.re.source === pattern || b.name === pattern);
    if (!entry) continue;
    entry.weight = n;
    const name = entry.name || patternToName.get(pattern) || pattern;
    const kw = compiled.fullScan?.keywords?.find((k) => k.name === name);
    if (kw) kw.score = n;
  }
  // 进门禁判定刷新：权重 ≥ 40 进 wordingPatterns（blocker 措辞门禁）
  const gateNames = new Set(compiled.commentScoring.blacklist.filter((b) => b.weight >= 40).map((b) => b.name));
  compiled.wordingPatterns = compiled.commentScoring.blacklist
    .filter((b) => gateNames.has(b.name))
    .map((b) => ({ name: b.name, re: b.re }));
}

/** 清空规则集缓存（测试用）。 */
export function clearRulePackCache() {
  _cache.clear();
}

/** 解析「规则集选择」字符串 → 新语义：逗号分隔槽位顺序；空 → 缺省顺序。保留函数名兼容旧调用。 */
export function resolveRulesetChoice(cfg) {
  const s = String(cfg || '').trim();
  let order;
  if (!s || s === 'builtin' || s === 'eightfs' || s === 'default' || s === 'yaml') order = [...DEFAULT_RULE_ORDER];
  else {
    order = s.split(',').map((x) => x.trim()).filter(Boolean);
    order = order.filter((x) => RULE_SLOTS.includes(x));
  }
  // v1.48.0：强制槽位（private）永远末尾合入——resolveRulesetChoice 也走强制合并，防止绕过门禁
  return { source: 'yaml', order: [...order.filter((s2) => !FORCED_SLOTS.includes(s2)), ...FORCED_SLOTS] };
}

/** 兼容旧名：装载规则集（异步签名保留；实际同步完成）。 */
export async function loadRulePack(choice = {}) {
  const c = typeof choice === 'string' ? resolveRulesetChoice(choice) : (choice || { source: 'yaml' });
  let order = Array.isArray(c.order) && c.order.length ? c.order : [...DEFAULT_RULE_ORDER];
  // v1.48.0：强制槽位（private）永远末尾合入——loadRulePack 直接传 order 时也要强制，防止绕过门禁
  order = [...order.filter((s) => !FORCED_SLOTS.includes(s)), ...FORCED_SLOTS];
  const loaded = loadYamlRuleFiles(order);
  if (!loaded.ok) return { ok: false, error: (loaded.errors || []).join('；') || '规则集装载失败' };
  const v = validateYamlRuleSet(loaded.merged);
  if (!v.ok) return { ok: false, error: `规则集校验失败: ${v.errors.join('；')}` };
  return { ok: true, pack: loaded.merged, source: 'yaml', order: loaded.order, files: loaded.files };
}
