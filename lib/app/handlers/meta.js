/**
 * HTTP 处理层 · 元信息/只读端点（status/scan/browse/tools/tool-probes/rule-slots/rule-detail/audit/toggle-rule）
 *
 * 从 http-handlers.js 的 handleHttp 巨型 switch 拆分而来（2026-09-29）。
 * 统一签名：handleXxx(ctx) → { status, body }；ctx = { req, query, body, env, cfg, path, method }。
 */
import { VERSION } from '../../self/index.js';
import { scanRepos, browseDir } from '../../git/index.js';
import { getDefaultScanRoot } from '../scan-root.js';
import { collectToolPaths } from '../../context/index.js';
import { redactConfig } from '../schema.js';
import { getLastSlotHitStats } from '../slot-stats.js';
import { listTools } from '../tools.js';
import { discoverRuleSlots, loadYamlRuleFile, resolveSlotOrder, setSlotDisabled, RULE_YAML_DIR } from '../../rule/loader.js';
import { name } from '../constants.js';

/** GET /api/git-push/status —— 插件信息 + 脱敏配置（token/ssh 打码）。 */
export function handleStatus(ctx) {
  const { env, cfg } = ctx;
  return { status: 200, body: { ok: true, plugin: name, version: VERSION, workspaceRoot: env.workspaceRoot, config: redactConfig(cfg) } };
}

/** GET /api/git-push/scan —— 本地仓库扫描清单。 */
export function handleScan(ctx) {
  const { env } = ctx;
  return { status: 200, body: { ok: true, repos: scanRepos(env.workspaceRoot || '.', { extraRepos: env.extraRepos }) } };
}

/** GET /api/git-push/browse —— 目录浏览（路径选择器）。 */
export function handleBrowse(ctx) {
  const { query, env } = ctx;
  const r = browseDir(String(query.path || ''), { root: env.workspaceRoot });
  return { status: r.ok ? 200 : 400, body: r.ok ? { ok: true, path: r.path, parent: r.parent, dirs: r.dirs } : { ok: false, error: r.error } };
}

/** GET /api/git-push/tools —— 插件自身工具定义清单（agent 工具）。 */
export function handleTools() {
  return { status: 200, body: { ok: true, tools: listTools() } };
}

/** GET /api/git-push/tool-probes —— 本机各工具实测路径/版本（真实探测）。 */
export function handleToolProbes() {
  return { status: 200, body: { ok: true, probes: collectToolPaths(null) } };
}

/** 规则包清单（按规则条数统计；hitStats 参数保留兼容但不再参与计算）。 */
export function listRuleSlots(order, disabledSlots = [], hitStats = null) {
  const discovered = discoverRuleSlots(RULE_YAML_DIR);
  const slotMeta = {};
  for (const slot of discovered) {
    const r = loadYamlRuleFile(slot, RULE_YAML_DIR);
    if (r.ok && r.data?.metadata) {
      const rules = Array.isArray(r.data.rules) ? r.data.rules : [];
      // 清单驱动槽位（private）用 private_files 条目数计
      const listed = Array.isArray(r.data.private_files) ? r.data.private_files.length : 0;
      const ruleCount = rules.length + listed;
      const ruleBlocker = rules.filter((x) => x && (x.severity === 'blocker' || x.severity === 'error')).length + listed;
      const ruleWarning = rules.filter((x) => x && x.severity === 'warning').length;
      const stats = {
        blocker: ruleBlocker,
        warning: ruleWarning,
        pass: Math.max(0, ruleCount - ruleBlocker - ruleWarning),
        total: ruleCount,
        source: 'rules',
      };
      slotMeta[slot] = {
        name: r.data.metadata.name || slot,
        description: r.data.metadata.description || '',
        author: r.data.metadata.author || '',
        stats,
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