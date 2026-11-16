/**
 * HTTP 处理器 · 审计侧（规则包 / 审计结果聚合 / 规则启停 / 豁免提示）
 *
 * 拆包后：**审计实现归 audit-sluice**，本文件只做 HTTP 整形（ctx → 包参数 → `{status, body}`）。
 * 判定/聚合/规则加载一律经 `lib/app/preprocess-client.js` 调包；宿主不再持有实现副本。
 * 注意：这些 handler（含 `listRuleSlots`）在本批**改为异步**——预处理实现是动态 import 加载的，
 *   调用方（http-handlers / 外部导出）请 await。
 */

import * as auditClient from '../preprocess-client.js';
import { getDefaultScanRoot } from '../scan-root.js';

/** 调预处理实现；包不可用 → 503（HTTP 要给可诊断状态，不是 500 一坨栈）。 */
async function withHostApi(handler) {
  try {
    const api = await auditClient.hostApi();
    return await handler(api);
  } catch (e) {
    return { status: 503, body: { ok: false, code: 'AUDIT_PACKAGE_UNAVAILABLE', message: `预处理实现不可用：${e?.message || e}` } };
  }
}

/**
 * 规则包清单（按规则条数统计）。**异步**（预处理实现动态加载）。
 * @param {string[]} [order] 规则包顺序
 * @param {string[]} [disabledSlots] 禁用清单
 * @param {object|null} [hitStats] 命中统计（仅回显）
 * @returns {Promise<object>}
 */
export async function listRuleSlots(order, disabledSlots = [], hitStats = null) {
  const api = await auditClient.hostApi();
  return api.listRuleSlots(order, disabledSlots, hitStats);
}

/** GET /api/preprocess/rule-slots */
export async function handleRuleSlots(ctx) {
  const { cfg } = ctx;
  return withHostApi(async (api) => ({
    status: 200,
    body: {
      ok: true,
      slots: api.listRuleSlots(
        cfg.auditRuleOrder,
        Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [],
        api.getLastSlotHitStats(),
      ),
    },
  }));
}

/** GET /api/preprocess/rule-detail */
export async function handleRuleDetail(ctx) {
  const slot = String(ctx.query.slot || '');
  if (!slot) return { status: 400, body: { ok: false, error: 'slot 必填（规则包名，如 nodejs）' } };
  return withHostApi(async (api) => {
    const detail = api.ruleDetail(slot);
    if (!detail) return { status: 404, body: { ok: false, error: `规则包不存在：${slot}` } };
    return { status: 200, body: { ok: true, slot, ...detail } };
  });
}

/** GET|POST /api/preprocess/audit（请求时聚合，不落盘） */
export async function handleAudit(ctx) {
  const { query, body, env, method } = ctx;
  const params = method === 'POST' ? { ...query, ...(body || {}) } : query;
  const repo = String(params.repo || getDefaultScanRoot(env, { defaultScanRoot: '' }));
  if (!repo) return { status: 400, body: { ok: false, error: 'repo 必填（仓库绝对路径）' } };
  return withHostApi(async (api) => {
    const result = await api.auditAggregate({
      repo,
      scope: params.scope === 'diff' ? 'diff' : 'full',
      groupBy: String(params.groupBy || 'rule'),
      severity: String(params.severity || ''),
      top: Number(params.top) || 20,
    });
    if (result?.ok === false) return { status: 400, body: { ok: false, error: result.error } };
    return { status: 200, body: result };
  });
}

/** POST /api/preprocess/toggle-rule */
export async function handleToggleRule(ctx) {
  const slot = String(ctx.body?.slot || '');
  if (!slot) return { status: 400, body: { ok: false, error: 'slot 必填' } };
  return withHostApi(async (api) => ({
    status: 200,
    body: { ok: true, slot, disabled: api.toggleRule(slot, ctx.body?.disabled === true) },
  }));
}

/** GET /api/preprocess/exempt-hint */
export async function handleExemptHint(ctx) {
  const { query } = ctx;
  const finding = { rule: String(query.rule || ''), kind: String(query.kind || ''), file: String(query.file || ''), line: Number(query.line) || 0 };
  if (!finding.rule && !finding.kind) return { status: 400, body: { ok: false, error: 'rule 或 kind 必填（用于推导豁免标记）' } };
  return withHostApi(async (api) => ({
    status: 200,
    body: {
      ok: true,
      rule: finding.rule,
      kind: finding.kind,
      marker: (api.exemptHintForFinding(finding) || {}).marker || null,
      hint: (api.exemptHintForFinding(finding) || {}).hint || '无任何标记可豁免该 finding（应改代码，或走 .auditignore / 豁免槽位）',
      candidates: Object.keys(api.EXEMPT_MARKERS).map((marker) => ({ marker, covers: api.exemptMarkerCovers(marker, finding) })),
    },
  }));
}
