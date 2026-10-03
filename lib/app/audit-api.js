/**
 * 审计结果 API 聚合层
 *
 * 为 `/api/git-push/audit` 端点提供「请求时自定义聚合」：
 *   · 维度：rule（警告类型）/ file（文件名）/ severity / slot（规则包）
 *   · 过滤：severity 白名单（逗号分隔）
 *   · 条数：top 截断（每组最多列前 N 条，0=全部）
 *   · 明细：withFindings=true 时附完整 findings
 *
 * 纯函数设计：findings 进、聚合出，不碰 I/O，便于单测。
 * 与 auditFull/auditWithScope 解耦——本层只消费它们的返回。
 */
import { buildRuleSlotMap } from '../audit/slot.js';
import { MAX_MSG_PREVIEW } from './constants.js';

/** 支持的聚合维度（非法值回落 rule）。 */
export const GROUP_BY_KEYS = ['rule', 'file', 'severity', 'slot'];
// 豁免类型前缀（exemptHint 形态 dsh-skip-<type>（范围）——统计按类型分组）
const EXEMPT_TYPE_RE = /dsh-skip-([a-z-]+)/; // 无 /g：exec 有 lastIndex 状态（多次调用错位）

/**
 * 豁免类型统计（每次审计后输出「本次被豁免的类型与数量」——
 *   审计透明性：dsh-skip-quality/residue/sensitive/size 各豁免多少条）。
 * @param {Array} findings audit findings（含 exemptHint）
 * @returns {{ types: Record<string, number>, total: number }}
 */
export function exemptStatsOf(findings = []) {
  const types = {};
  let total = 0;
  for (const f of findings) {
    const hint = String(f?.exemptHint || '');
    if (!hint) continue;
    total += 1;
    const matched = EXEMPT_TYPE_RE.exec(hint);
    if (matched) {
      const t = matched[1];
      types[t] = (types[t] || 0) + 1;
    } else {
      types.other = (types.other || 0) + 1;
    }
  }
  return { types, total };
}

/** finding 对象聚合键提取（slot 维度用 ruleSlotMap 把 rule id 归到规则包）。 */
function groupKeyOf(finding, groupBy, ruleSlotMap) {
  if (groupBy === 'file') return String(finding.file || '(未知文件)');
  if (groupBy === 'severity') return String(finding.severity || 'notice');
  if (groupBy === 'slot') return ruleSlotMap.get(finding.rule) || '未归类';
  return String(finding.rule || '(未知规则)');
}

/**
 * 解析 severity 过滤参数：「warning,blocker」→ ['warning','blocker']；
 * 空/非法 → null（不过滤）。
 */
export function parseSeverityFilter(raw) {
  if (!raw) return null;
  const list = String(raw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? [...new Set(list)] : null;
}

/**
 * 按指定维度聚合 findings。
 * @param {Array} findings audit findings（含 rule/severity/file）
 * @param {object} opts { groupBy='rule', severityFilter=null, top=0, ruleSlotMap=Map }
 * @returns {{groups: Array<{key, count, sample?: object}>, total: number, filtered: number}}
 *   groups 按 count 降序；severity 过滤后 filtered=通过过滤的条数。
 */
export function aggregateFindings(findings = [], opts = {}) {
  const groupBy = GROUP_BY_KEYS.includes(opts.groupBy) ? opts.groupBy : 'rule';
  const top = Number(opts.top) > 0 ? Math.floor(Number(opts.top)) : 0;
  const severityFilter = parseSeverityFilter(opts.severityFilter);
  const ruleSlotMap = opts.ruleSlotMap instanceof Map ? opts.ruleSlotMap : new Map();

  const buckets = new Map();
  let filtered = 0;
  for (const f of findings) {
    if (severityFilter && !severityFilter.includes(String(f.severity || 'notice').toLowerCase())) continue;
    filtered++;
    const key = groupKeyOf(f, groupBy, ruleSlotMap);
    if (!buckets.has(key)) buckets.set(key, { key, count: 0, sample: null });
    const b = buckets.get(key);
    b.count++;
    if (!b.sample) b.sample = { rule: f.rule, severity: f.severity, file: f.file, line: f.line, message: f.message };
  }

  let groups = [...buckets.values()].sort((a, b2) => b2.count - a.count || String(a.key).localeCompare(String(b2.key)));
  if (top > 0) groups = groups.slice(0, top);
  return { groups, total: findings.length, filtered };
}

/**
 * 执行审计并聚合（HTTP 端点用）。
 * @param {string} repo 仓库根
 * @param {object} params { scope='full', groupBy='rule', severity='', top=0, withFindings=false, rulesetDir='', maxScanFiles=0, slots, disabledSlots, includeIgnored=false, weights={} }
 * @param {object} cfg 插件配置（auditRuleOrder / auditDisabledSlots）
 */
export async function runAuditApi(repo, params = {}, cfg = {}) {
  const { auditFull, auditWithScope } = await import('../audit/index.js');
  const { scoreQuality } = await import('../score/index.js');
  const scope = params.scope === 'diff' ? 'diff' : 'full';
  const auditOpts = {
    scope,
    rulesetDir: params.rulesetDir || '',
    maxScanFiles: params.maxScanFiles ?? cfg.maxScanFiles ?? 0,
    slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined,
    disabledSlots: Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [],
    includeIgnored: params.includeIgnored === true,
  };
  const auditResult = scope === 'diff'
    ? await auditWithScope(repo, auditOpts)
    : await auditFull(repo, auditOpts);

  const { summarize } = await import('../audit/index.js');
  const summary = summarize(auditResult.findings);
  const quality = scoreQuality(auditResult.findings, params.weights || {}, { files: auditResult.files });
  // slot 归属映射（groupBy=slot 用）：与 auditFiles 同源加载规则构建映射——
  //   审计返回不带 compiled，这里按相同 slots/disabledSlots 重新编译一次。
  let ruleSlotMap = new Map();
  if (params.groupBy === 'slot') {
    try {
      const { loadRuleFiles } = await import('../rule/loader.js');
      const { compileAllRules } = await import('../rule/registry.js');
      const loaded = loadRuleFiles(auditOpts.slots, { dir: auditOpts.rulesetDir, disabledSlots: auditOpts.disabledSlots });
      ruleSlotMap = buildRuleSlotMap(compileAllRules(loaded.merged.rules, { errors: [] }));
    } catch { /* slot 映射构建失败退化为空 Map（该维度归「未归类」） */ }
  }

  const agg = aggregateFindings(auditResult.findings, {
    groupBy: params.groupBy,
    severityFilter: params.severity,
    top: params.top,
    ruleSlotMap,
  });

  const out = {
    ok: true,
    repo,
    scope: auditResult.scope || scope,
    files: auditResult.files,
    summary,
    quality: quality.emptyResult ? null : { score: quality.score, level: quality.level },
    groups: agg.groups,
    total: agg.total,
    filtered: agg.filtered,
    // 豁免类型统计（本次被豁免的类型与数量）+ 可用聚合类型（groupBy 维度）+
    //   拦截列表（blocker findings 直接输出——被拦文件/规则，不用再查明细）
    exemptStats: exemptStatsOf(auditResult.findings),
    groupByTypes: GROUP_BY_KEYS,
    blocked: auditResult.findings
      .filter((f) => f.severity === 'blocker')
      .map((f) => ({ file: f.file, line: f.line, rule: f.rule, message: String(f.message || '').slice(0, MAX_MSG_PREVIEW) })),
  };
  if (params.withFindings === true) out.findings = auditResult.findings;
  if (params.withYaml === true) out.yaml = auditResult.yaml;
  return out;
}
