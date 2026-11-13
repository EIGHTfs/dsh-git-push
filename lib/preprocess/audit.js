/**
 * 预处理能力 · 审计（提交前审计）
 *
 * 「预处理」是一类**由外部能力贡献给 git 侧**的东西（提交前检查、结果文案、工具参数），
 * git 侧只认契约、不认实现。本文件是审计这一个预处理的**全部贡献面**，三项能力同处一处：
 *
 *   params       : 它给 git 侧工具贡献的参数（不可用时不出现）
 *   enabled      : 可用性判据（**功能在不在**，不是「默认跑不跑」——后者是 cfg.auditEnabled）
 *   renderResult : 它自己的结果文案（拦截原因 / 查询指引 / 回显 note）
 *
 * 为什么文案要由审计方渲染（而不是 git 侧硬编码）：文案是**审计语义**的一部分
 *   （「几个 blocker」「查询用哪个 API」「私有库只报告不拦截」），git 侧一旦写死，
 *   将来审计拆成独立项目、换引擎、甚至换语言，git 侧都得跟着改文案。
 *
 * 但有三样**刻意留在 git 侧**，不要搬进来（见 lib/preprocess/index.js 的注释与 SPEC §十四）：
 *   ① `blocked` 布尔（job 状态分叉「被拦截 ≠ 执行失败」）；
 *   ② 引擎 spawn 失败的文案（审计引擎不知道自己没被找到）；
 *   ③ 兜底默认文案（预处理不给 renderResult 时不能崩）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PLUGIN_ROOT } from '../core/config.js';
import { buildAuditApiGuide } from '../app/inject-text.js';

/** 预处理 id（与 cfg / 日志 / 未来多预处理并存时的标识）。 */
export const AUDIT_PREPROCESS_ID = 'audit';

/**
 * 审计预处理是否**可用**（可用才让它的参数进入工具签名）。
 *
 * 判据刻意不看 `cfg.auditEnabled`：后者只是「默认跑不跑」的开关（缺省 false），
 *   而「工具签名里该不该出现 audit 参数」取决于**审计这个预处理动作在不在**。
 *   用户关掉 auditEnabled 之后仍可能想临时传 `--audit` 跑一次，此时参数必须还在。
 * @param {object} [cfg] 插件配置（`preCommit.command` 配了自定义引擎即视为可用）
 * @param {boolean} [hasBuiltinEngine] 仅供测试注入「内置引擎是否存在」
 * @returns {boolean}
 */
export function auditPreprocessAvailable(cfg = {}, hasBuiltinEngine) {
  if (cfg && cfg.preCommit && cfg.preCommit.command) return true; // 自定义引擎
  const builtin = typeof hasBuiltinEngine === 'boolean'
    ? hasBuiltinEngine
    : existsSync(join(PLUGIN_ROOT, 'scripts', 'audit-gate.mjs'));
  return builtin;
}

/** 审计专属参数——由审计预处理贡献给 git 侧工具；不可用时不出现在签名里。 */
export const AUDIT_COMMIT_PARAMS = [
  { flag: 'audit', type: 'boolean', desc: '提交前审计（默认取配置）' },
  { flag: 'auditExemptPaths', type: 'array', desc: '本次提交按文件临时豁免审计（数组，相对仓库根）：所列文件的 finding 不参与拦截判定（含 blocker）；仅本次有效，不落盘、不改 .auditignore' },
  { flag: 'auditExemptReason', type: 'string', desc: '豁免理由（可选，仅回显，不作拦截条件）' },
];

/**
 * 把 blocked 列表格式化成可读的「位置（原因）」串。
 * 与历史文案逐字一致（` file:line（rule）`）——这是拦截信息的唯一可读面，改动要慎重。
 * @param {Array<{file?:string,line?:number,rule?:string,message?:string}>} blocked
 * @returns {string[]}
 */
function formatBlocked(blocked = []) {
  return blocked.map((finding) => {
    const where = finding.file ? ` ${finding.file}` + (finding.line ? `:${finding.line}` : '') : '';
    const why = finding.rule || finding.message || '';
    return where + (why ? `（${why}）` : '');
  });
}

/**
 * 渲染审计结果文案（预处理的第三项能力）。
 *
 * `ctx` 由 git 侧传入，含 `{ repoPath, audit:{summary,quality,findings,scope,files}, blocked, exempt?, privateExempt? }`
 *   —— 这是**数据契约**：预处理只读这些字段，不查仓库、不碰网络、不读配置。
 * 返回的三项都可选：不提供即由 git 侧的兜底补上（保证预处理缺项时不崩）。
 * @param {object} ctx
 * @returns {{error?: string, apiGuide?: string, notes?: {exempt?: string, privateExempt?: string}}}
 */
export function auditRenderResult(ctx = {}) {
  const blocked = Array.isArray(ctx.blocked) ? ctx.blocked : [];
  const audit = ctx.audit || {};
  return {
    // 拦截文案：只在真有 blocker 时给（放行时不该出现「拦截」字样）
    error: blocked.length ? `审计拦截：${blocked.length} 个 blocker → ${formatBlocked(blocked).join('；')}` : undefined,
    // 查询指引：明细走聚合 API（不内联 findings 全文）
    apiGuide: buildAuditApiGuide(ctx.repoPath || '', { scope: audit.scope, summary: audit.summary, quality: audit.quality }),
    notes: {
      exempt: '本次提交临时豁免（不落盘、不影响后续提交）；评分仍按全量 findings 计算',
      privateExempt: 'private-repo-report-only（私有库豁免：审计只报告不拦截，明细仍见 blocked）',
    },
  };
}

/** 审计预处理的注册形态（三项能力同处一处，供 lib/preprocess/index.js 汇总）。 */
export const auditPreprocess = {
  id: AUDIT_PREPROCESS_ID,
  params: AUDIT_COMMIT_PARAMS,
  enabled: auditPreprocessAvailable,
  renderResult: auditRenderResult,
};
