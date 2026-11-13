/**
 * dsh-git-push — 审计提交总入口（commitWithAudit）
 * dsh-skip-i18n: 插件为中文零依赖，用户可见文案硬编码为产品设计
 *
 * git_commit_push 工具的核心逻辑抽成独立函数：
 *   - 供 lib/index.js 的 callTool('git_commit_push') 复用（单一实现）
 *   - 供外部插件（dsh-session-conductor 自动推送）动态 import 调用——
 *     自动推送带审计门禁（blocker 拦截 + 敏感扫描 + .gitignore），不再裸 commit+push
 * 返回结构含 audit 摘要，调用方（工具/外部插件）可据此判断「被阻断」。
 */
// 审计的结果文案改由「预处理能力」渲染（lib/preprocess/）：git 侧只留兜底逻辑与中性默认文案。
//   为什么 git 侧不再自己生成这份指引：那是**审计措辞**（查询用哪个 API、明细去哪看），
//   属于审计预处理自己的语义，搬进 lib/preprocess/audit.js 的 renderResult 里。
import { renderPreprocessResult } from './preprocess/index.js';

// 审计内核（auditWithScope / scoreQuality）不再在本文件直接 import —— 提交门禁改为
//   调「可配置的审计引擎子进程」（lib/commit-push/pre-commit-engine.js），这是解耦点：
//   换引擎（含换语言重写）只改配置，git 侧零改动。
//   ⚠️ 文档漂移检查器的接线也随之搬进引擎入口（scripts/audit-gate.mjs 里 import 一次）；
//   宿主自己的工具/HTTP 侧仍由 lib/app/tool-call.js 接线，不依赖本文件。
import { runPreCommitEngine } from './commit-push/pre-commit-engine.js';
import { commitAndPush } from './git/index.js';
import { defaultConfig } from './client/index.js';
import { MAX_MSG_PREVIEW } from './app/constants.js';
import { isSampleExemptDir } from './exempt/index.js';
import { resolveRepoVisibility } from './git/index.js';

/**
 * 预处理渲染的**兜底文案**（刻意留在 git 侧）。
 *
 * 为什么在 git 侧而不是预处理里：预处理可能不可用、没实现 `renderResult`、甚至渲染时抛错，
 *   这时代码仍在 git 侧往下走 —— 兜底是 git 侧的安全网，不能依赖被兜底对象自己提供。
 * 为什么措辞中性（写「提交前检查」而不是「审计」）：具体措辞属预处理的语义，
 *   已搬进 lib/preprocess/audit.js；这里只保证「有 blocker 时能说清是哪几处」。
 * @param {object} ctx 与 renderPreprocessResult 同一个 ctx
 * @returns {{error?: string, apiGuide: string, notes: {exempt: string, privateExempt: string}}}
 */
export function defaultPreprocessRender(ctx = {}) {
  const blocked = Array.isArray(ctx.blocked) ? ctx.blocked : [];
  const list = blocked.map((finding) => {
    const where = finding.file ? ` ${finding.file}` + (finding.line ? `:${finding.line}` : '') : '';
    const why = finding.rule || finding.message || '';
    return where + (why ? `（${why}）` : '');
  });
  return {
    error: blocked.length ? `提交前检查拦截：${blocked.length} 项 → ${list.join('；')}` : undefined,
    apiGuide: '',
    notes: {
      exempt: '本次提交的临时豁免（不落盘、不影响后续提交）',
      privateExempt: '私有库：检查结果只报告不拦截',
    },
  };
}

/**
 * 同步执行审计门禁（不跑 git）。供 git_commit_push 后台化方案复用：审计同步即时
 *   拦截，通过后再把 commit+push 丢后台。返回 { ok, blocked?, error?, audit }。
 * @param {object} p { repoPath, audit?, rulesetDir?, slots?, cfg?, visibility? }
 *   （删除 auditLevel——审计固定完整流程，不留强度参数）
 *   visibility：远端可见性（private|public|unknown）——private 时审计只报告不拦截
 *   （README「④ 私有库豁免」）；缺省按 origin 探测，探测失败按 unknown（保守拦截）。
 *   显式传入可免网络探测（测试/已知场景）。
 */
export async function runAudit({ repoPath = '', audit, rulesetDir, slots, cfg: extCfg, visibility: extVisibility, exemptPaths = [], exemptReason = '' } = {}) {
  const cfg = extCfg || defaultConfig();
  const doAudit = audit ?? cfg.auditEnabled;
  if (!doAudit) return { ok: true, audit: null };
  // ⚠️ auditRuleOrder 的语义是「槽位**加载顺序**」（见 schema 描述），**不是白名单** ✗。
  //   历史缺陷：这里把它当 slots 传下去，而 loadRuleFiles 把 slots 当「只加载列出的包」用，
  //   于是清单外的规则包（python/cpp/go/java/php/rust/swift/template…）被**静默丢弃** ✗——
  //   实测：一个 105 个 .py 的项目上 7 条 python/* 规则零命中、连 python 槽位都不存在；
  //   把该字段置空后同一项目 60 条 → 197 条、python/* 命中 0 → 5 ✓。
  //   现在只保留显式传入的 slots（API/工具级白名单）；配置里的顺序不再当白名单（禁用请用 auditDisabledSlots ✓）。
  const slotOrder = Array.isArray(slots) && slots.length ? slots : undefined;
  // 修复：提交前审计同样消费侧边栏权重覆盖（cfg.weightOverrides，config.json 回读），
  //   与 code_audit 工具同源——此前传空权重，评分恒用默认权重表（侧边栏权重设置对提交审计无效）。
  //   权重在 git 侧解析（配置语义留在插件侧），再序列化传给引擎：引擎只做「解析 → 用」。
  let auditWeights = {};
  if (typeof cfg.weightOverrides === 'string' && cfg.weightOverrides.trim()) {
    try { auditWeights = JSON.parse(cfg.weightOverrides) || {}; } catch { /* 非法 JSON 回退默认 */ }
  }
  // ── 解耦点：审计与评分不再在进程内跑，改为调配置化引擎子进程 ──
  //   传给引擎的东西只有「本来就在传的选项」：scope / maxScanFiles / rulesetDir /
  //   slots / disabledSlots / weights。maxScanFiles 每次都必须传：它的默认值是 3000，
  //   而加载层把 0 当「不限」，漏传会让大仓门禁退化成全量扫描。
  const engineRes = await runPreCommitEngine({
    repoPath: repoPath || '.',
    scope: cfg.auditScanScope || 'diff',
    rulesetDir: rulesetDir || '', // 自定规则目录已从设置移除，只认显式传参（工具 ruleset 参数）
    weights: auditWeights,
    maxScanFiles: cfg.maxScanFiles,
    slots: slotOrder,
    disabledSlots: Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [],
    cfg,
  });
  // 引擎不可用（崩/超时/退出码 2/输出不合契约）一律 fail-closed：拒绝提交并给出可诊断原因。
  //   绝不在这里「当作没有 blocker 放行」——那等于把红线交给「恰好没跑起来」。
  if (!engineRes.ok) return { ok: false, blocked: false, error: engineRes.error, audit: null };
  const engineAudit = engineRes.audit || {};
  const findings = Array.isArray(engineAudit.findings) ? engineAudit.findings : [];
  const auditOut = {
    summary: engineAudit.summary,
    quality: engineAudit.quality,
    // 引擎溯源（新增字段，只增不改）：出问题时能一眼看到「用的哪个引擎、退出码几」，
    //   不必去翻配置或日志。既有文案（apiGuide / 拦截 error）保持原样不动。
    engine: {
      command: engineRes.engine?.command || '',
      exitCode: engineRes.engine?.exitCode ?? null,
      blocked: engineRes.engine?.exitCode === 1,
    },
  };
  // 本次提交的按文件临时豁免（auditExemptPaths）：列入的文件 finding 一律不参与拦截判定（含 blocker），
  //   仅本次有效、不落盘、不改 .auditignore；评分仍用全量 findings（豁免不影响打分基数）。
  //   语义按需求方定稿：豁免即豁免，不设「只允许 warning/notice」的限制，也不按规则类别过滤。
  const exemptSet = new Set((Array.isArray(exemptPaths) ? exemptPaths : [])
    .map((p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim())
    .filter(Boolean));
  const isExemptFile = (f) => exemptSet.size > 0 && exemptSet.has(String(f.file || '').replace(/\\/g, '/').replace(/^\.\//, ''));
  const exemptFindings = exemptSet.size ? findings.filter((f) => isExemptFile(f)) : [];
  // 只算非示例目录的 blocker（示例目录内的 blocker 是规则演示，不拦真实提交）
  const blocked = findings.filter((f) => f.severity === 'blocker' && !isSampleExemptDir(repoPath || '.', f.file) && !isExemptFile(f));
  auditOut.blocked = blocked.map((f) => ({ file: f.file, line: f.line, rule: f.rule, message: (f.message || '').slice(0, MAX_MSG_PREVIEW) }));
  if (exemptSet.size) {
    // 回显（记录而非判断）：本次豁免了哪些文件、命中哪些规则、共几条 finding
    auditOut.exempt = {
      files: [...exemptSet],
      count: exemptFindings.length,
      rules: [...new Set(exemptFindings.map((f) => f.rule).filter(Boolean))],
      ...(exemptReason ? { reason: String(exemptReason) } : {}),
      // note 由预处理渲染填（见下方 renderPreprocessResult）；这里不写死措辞
    };
  }
  // ── 结果文案：交给「可用预处理」渲染，git 侧只保留兜底 ──
  //   数据契约（ctx）：repoPath + audit{summary,quality,findings,scope,files} + blocked + exempt
  //   兜底：预处理不可用 / 没实现 renderResult / 渲染抛错 时用中性默认（defaultRenderResult），
  //   保证「预处理不给也不崩」——但默认文案刻意不含审计措辞（那属预处理语义）。
  const renderCtx = {
    repoPath,
    audit: {
      summary: engineAudit.summary,
      quality: auditOut.quality,
      findings,
      scope: engineAudit.scope,
      files: engineAudit.files,
    },
    blocked: auditOut.blocked,
    ...(auditOut.exempt ? { exempt: auditOut.exempt } : {}),
  };
  const fallbackRender = defaultPreprocessRender(renderCtx);
  const rendered = renderPreprocessResult(renderCtx, cfg);
  auditOut.apiGuide = rendered?.apiGuide ?? fallbackRender.apiGuide;
  if (auditOut.exempt) auditOut.exempt.note = rendered?.notes?.exempt ?? fallbackRender.notes.exempt;

  if (blocked.length > 0) {
    // 【修复】私有库豁免（README「④ 私有库豁免」）：远端可见性 = private → 审计只报告不拦截。
    // 修复背景：私有库被拦的回归——
    //   此前拦截判定只看「示例目录」、没有可见性分级，
    //   comment / docs / security 等槽位规则不受 private 槽位（凭据 glob）约束，私有留痕仓库被拦。
    //   承诺原文：「私密文件与工作留痕（留痕记录/凭据/笔记）在私有仓库可正常提交推送，
    //   不需要额外豁免标记」。此前拦截判定只看「示例目录」、没有任何可见性分级，而
    //   conv-*/docs/security 等槽位规则不受 private 槽位（凭据 glob）的可见性分级约束 →
    //   私有留痕仓库被上百条 conv-* blocker 拦下（实测回归：ai-work-archive 192 条）。
    //   visibility 可由调用方注入（p.visibility，测试/已知场景免探测）；缺省按 origin 探测。
    //   探测失败 / 非 private 一律保守拦截——公开库与不可判定场景不放松红线。
    let visibility = extVisibility;
    if (visibility === undefined) {
      // 统一收口（lib/git/visibility.js，与 push.js 同一入口）：token 缺失 / 非 GitHub origin /
      //   探测失败 → unknown → 保守拦截（不放松公开库红线）。
      visibility = (await resolveRepoVisibility(repoPath)).visibility;
    }
    if (visibility === 'private') {
      auditOut.privateExempt = {
        visibility,
        blockedCount: blocked.length,
        note: rendered?.notes?.privateExempt ?? fallbackRender.notes.privateExempt,
      };
      return { ok: true, audit: auditOut };
    }
    // 拦截文案由预处理渲染（含「几个 blocker + 逐条位置原因」）；
    //   `blocked: true` 这个**布尔**留在 git 侧——它决定 job 状态分叉（被拦截 ≠ 执行失败）。
    return {
      ok: false,
      blocked: true,
      error: rendered?.error ?? fallbackRender.error ?? `提交前检查拦截：${blocked.length} 项`,
      audit: auditOut,
    };
  }
  return { ok: true, audit: auditOut };
}

/**
 * 带审计门禁的提交推送（git_commit_push 工具旧同步实现，仍保留供外部插件/批量复用）。
 * @param {object} p
 *   { repoPath, message, push?, dryRun?, audit?, rulesetDir? }
 *   audit 缺省取插件配置 auditEnabled；rulesetDir 只认显式传参（设置项已移除）。
 * @returns {Promise<object>} 审计放行 → commitAndPush 结果（含 audit 摘要）；
 *   blocker 命中 → { ok:false, blocked:true, audit }，不执行 git 操作
 */
export async function commitWithAudit({
  repoPath = '',
  message = '',
  push = true,
  dryRun = false,
  audit,
  rulesetDir,
  slots,
  customIgnorePatterns = '',
  requirementsConfirmed = false,
  force = false,
  pushMethod,
  pushGate = false,
  pushConfirmed = false,
  paths = '', // 精确 add 路径（逗号分隔，相对 repoPath）；空 = git add -A
} = {}) {
  const cfg = defaultConfig();
  const a = await runAudit({ repoPath, audit, rulesetDir, slots });
  // blocked 用 runAudit 的真实结论（缺省仍按拦截处理，保持旧行为）：
  //   审计判定拦截 = true；引擎不可用 = false（那是「没跑起来」，不是「审计不通过」，
  //   工具侧据此显示「未完成：<原因>」而不是「推送被拦截」）。
  if (!a.ok) return { ok: false, blocked: a.blocked ?? true, error: a.error, audit: a.audit };
  // 推送通道缺省取插件配置（默认 ssh：推本地 HEAD、远端 sha 与本地一致）
  const r = await commitAndPush({ repoPath, message, push, dryRun, customIgnorePatterns, requirementsConfirmed, force, pushMethod: pushMethod || cfg.pushMethod || 'ssh', pushGate, pushConfirmed, paths });
  return { ok: r.ok !== false, ...r, audit: a.audit };
}

/**
 * 批量提交推送（D16 commitMany）：对每个仓库依次 commitAndPush，返回逐仓结果数组。
 * 注意：仅做提交推送（不含审计门禁）——审计请用 commitWithAudit 逐仓调用。
 * @param {{repos: string[], message: string, push?: boolean, dryRun?: boolean, requirementsConfirmed?: boolean, customIgnorePatterns?: string}} opts
 * @returns {Promise<Array<{repo: string, ...commitAndPush 结果}>>}
 */
export async function commitMany({ repos = [], message = '', push = true, dryRun = false, requirementsConfirmed = false, customIgnorePatterns = '' } = {}) {
  const results = [];
  for (const repoPath of repos) {
    results.push({ repo: repoPath, ...(await commitAndPush({ repoPath, message, push, dryRun, customIgnorePatterns, requirementsConfirmed })) });
  }
  return results;
}