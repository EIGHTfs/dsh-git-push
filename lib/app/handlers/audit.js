/**
 * HTTP 处理器 · 审计侧（规则包 / 审计结果聚合 / 规则启停 / 豁免提示）
 *
 * 为什么单独成文件：审计侧 HTTP 面要与 git 侧**物理分家**（对应 `/api/git-audit/*` 前缀）——
 *   否则「审计将来能整体抠走」只是路由上的说法，代码层仍混在 meta.js 里。
 *   本文件只放审计专属 handler 与它们的辅助函数（ruleSlotStats / listRuleSlots）。
 *
 * 路由映射（见 lib/app/http-handlers.js）：
 *   /api/git-audit/{rule-slots,rule-detail,audit,toggle-rule,exempt-hint}
 *   旧 /api/git-push/{同 5 条} 保留一版转发（响应带 Deprecation 头）。
 */
import { discoverRuleSlots, loadYamlRuleFile, resolveSlotOrder, setSlotDisabled, RULE_YAML_DIR } from '../../rule/loader.js';
import { getLastSlotHitStats } from '../slot-stats.js';
import { getDefaultScanRoot } from '../scan-root.js';
import { exemptHintForFinding, exemptMarkerCovers, EXEMPT_MARKERS } from '../../exempt/index.js';

/**
 * 由规则包 yml 解析结果算该槽位的规则条数统计。
 *
 * 为什么单独成函数：这段（rules 过滤 + private_files 计数 + pass 推导）原先内联在
 *   listRuleSlots 的循环里，与「槽位元数据组装」混在一起，把该函数圈复杂度推到 15
 *   （阈值 10，自审 max-cyclomatic-complexity）——拆开后统计口径可单独阅读与复用。
 * 清单驱动槽位（private）用 private_files 条目数计（它们不在 rules 数组里）。
 */
function ruleSlotStats(r) {
  const rules = Array.isArray(r.data.rules) ? r.data.rules : [];
  const listed = Array.isArray(r.data.private_files) ? r.data.private_files.length : 0;
  const total = rules.length + listed;
  const blocker = rules.filter((x) => x && (x.severity === 'blocker' || x.severity === 'error')).length + listed;
  const warning = rules.filter((x) => x && x.severity === 'warning').length;
  return { blocker, warning, pass: Math.max(0, total - blocker - warning), total, source: 'rules' };
}

/** 规则包清单（按规则条数统计；hitStats 参数保留兼容但不再参与计算）。 */
export function listRuleSlots(order, disabledSlots = [], hitStats = null) {
  const discovered = discoverRuleSlots(RULE_YAML_DIR);
  const slotMeta = {};
  for (const slot of discovered) {
    const r = loadYamlRuleFile(slot, RULE_YAML_DIR);
    if (r.ok && r.data?.metadata) {
      slotMeta[slot] = {
        name: r.data.metadata.name || slot,
        description: r.data.metadata.description || '',
        author: r.data.metadata.author || '',
        stats: ruleSlotStats(r),
        disabled: r.data.disabled === true || disabledSlots.includes(slot),
      };
    } else {
      slotMeta[slot] = { name: slot, description: '', author: '', stats: { blocker: 0, warning: 0, pass: 0, total: 0, source: 'rules' }, disabled: disabledSlots.includes(slot) };
    }
  }
  const eff = resolveSlotOrder(order && order.length ? order : undefined, { dir: RULE_YAML_DIR });
  return { discovered, order: eff, meta: slotMeta, forced: ['private'] };
}

/** GET /api/git-push/rule-slots —— 规则包按包规则条数统计。 */
export function handleRuleSlots(ctx) {
  const { cfg } = ctx;
  return { status: 200, body: { ok: true, slots: listRuleSlots(cfg.auditRuleOrder, Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [], getLastSlotHitStats()) } };
}

/** GET /api/git-push/rule-detail —— 单个规则包的规则明细 + severity 统计。 */
export function handleRuleDetail(ctx) {
  const { query } = ctx;
  const slot = String(query.slot || '');
  if (!slot) return { status: 400, body: { ok: false, code: 'SLOT_REQUIRED', error: '缺少规则包名 slot' } };
  const r = loadYamlRuleFile(slot, RULE_YAML_DIR);
  if (!r.ok) return { status: 404, body: { ok: false, code: 'SLOT_NOT_FOUND', error: r.error } };
  const rules = Array.isArray(r.data?.rules) ? r.data.rules : [];
  const detail = rules.map((rule) => ({
    id: rule.id || '',
    name: rule.name || rule.id || '',
    category: rule.category || '',
    severity: rule.severity || 'notice',
    description: rule.description || '',
    author: rule.author || r.data.metadata?.author || '',
  }));
  const count = (sev) => detail.filter((x) => x.severity === sev).length;
  const stats = {
    blocker: count('blocker') + count('error'),
    warning: count('warning'),
    pass: rules.length - count('blocker') - count('error') - count('warning'),
    total: rules.length,
  };
  return { status: 200, body: { ok: true, slot, meta: { name: r.data?.metadata?.name || slot, description: r.data?.metadata?.description || '', author: r.data?.metadata?.author || '' }, stats, rules: detail } };
}

/** POST/GET /api/git-push/audit —— 审计结果 API（请求时聚合）。 */
export async function handleAudit(ctx) {
  const { query, body, env, cfg } = ctx;
  const { runAuditApi } = await import('../audit-api.js');
  const params = { ...query, ...body };
  const repo = String(params.repo || '').trim()
    || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
  if (!repo) return { status: 400, body: { ok: false, code: 'REPO_REQUIRED', error: '缺 repo 参数且无法推断默认扫描根' } };
  try {
    const r = await runAuditApi(repo, params, cfg);
    return { status: 200, body: r };
  } catch (e) {
    return { status: 500, body: { ok: false, code: 'AUDIT_FAIL', error: `审计失败: ${e?.message || e}` } };
  }
}

/** POST /api/git-push/toggle-rule —— 启用/禁用规则包（改 yml disabled）。 */
export function handleToggleRule(ctx) {
  const { body } = ctx;
  const slot = String(body.slot || '');
  const want = body.disabled === true;
  if (!slot) return { status: 400, body: { ok: false, code: 'SLOT_REQUIRED', error: '缺少规则包名 slot' } };
  const r = setSlotDisabled(slot, want);
  if (!r.ok) return { status: 400, body: { ok: false, code: 'SLOT_TOGGLE_FAIL', error: r.error || '切换失败' } };
  return { status: 200, body: { ok: true, slot, disabled: r.disabled, message: want ? '已禁用' : '已启用' } };
}

/**
 * GET /api/git-push/exempt-hint —— 豁免标记查询（只读）。
 *
 * 入参 query：rule（规则名，如 maintainability/max-complexity）、kind（可选 finding kind）。
 * 出参：{ ok, rule, kind, marker, hint, lineLevel, candidates }。
 *
 * 为什么要有这个端点：豁免标记注册表（EXEMPT_MARKERS）是**单一真源**，外部工具（如
 * dsh-useful-tools 的 exempt 工具）需要「该写哪个标记」时来查，而不是复制一份注册表
 * ——复制必然漂移（历史上「提示与实际行为不符」的 24 种组合就是这么来的）。
 */
export function handleExemptHint(ctx) {
  const rule = String(ctx.query?.rule || '').trim();
  const kind = String(ctx.query?.kind || '').trim();
  const finding = { rule, kind };
  const hit = exemptHintForFinding(finding);
  const meta = hit ? EXEMPT_MARKERS[hit.marker] : null;
  const candidates = Object.entries(EXEMPT_MARKERS).map(([marker, m]) => ({
    marker,
    lineLevel: m.lineLevel === true,
    dimensions: m.dimensions || [],
    hint: m.hint || '',
    covers: Boolean(rule || kind) && exemptMarkerCovers(marker, finding),
  }));
  return {
    status: 200,
    body: {
      ok: true,
      rule,
      kind,
      marker: hit ? hit.marker : null,
      hint: hit ? hit.hint : '无任何标记可豁免该 finding（应改代码，或走 .auditignore / 豁免槽位）',
      lineLevel: meta ? meta.lineLevel === true : false,
      candidates,
    },
  };
}
