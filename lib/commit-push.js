/**
 * dsh-git-push — 提交总入口（提交前预处理门禁 + commit + push）
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
import * as auditClient from './app/preprocess-client.js';

// 审计内核（auditWithScope / scoreQuality）不再在本文件直接 import —— 提交门禁改为
//   调「可配置的审计引擎子进程」（lib/commit-push/pre-commit-engine.js），这是解耦点：
//   换引擎（含换语言重写）只改配置，git 侧零改动。
//   ⚠️ 文档漂移检查器的接线也随之搬进引擎入口（审计包 CLI 里 import 一次）；
//   宿主自己的工具/HTTP 侧仍由 lib/app/tool-call.js 接线，不依赖本文件。
import { runPreCommitPipeline, resolvePreCommitEnabled } from './commit-push/pre-commit-engine.js';
import { commitAndPush } from './git/index.js';
import { defaultConfig } from './client/index.js';
import { resolveRepoVisibility } from './git/index.js';

/** 拦截清单里单条 message 的截断长度（字符）：回执要短，完整内容仍在 audit.findings 里。 */
const BLOCKED_MESSAGE_PREVIEW_CHARS = 80;


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
 * 同步执行提交前预处理门禁（不跑 git）。供 git_commit_push 后台化方案复用：门禁同步即时
 *   拦截，通过后再把 commit+push 丢后台。返回 { ok, blocked?, error?, audit }。
 * 命名说明：本函数是**预处理通用入口**（审计只是当前唯一的 provider），
 *   返回里的 `audit` 字段是该 provider 的结果体，字段名沿用既有对外契约。
 * @param {object} p { repoPath, audit?, rulesetDir?, cfg?, visibility?, auditExemptPaths?, auditExemptReason? }
 *   （删除 auditLevel——审计固定完整流程，不留强度参数）
 *   visibility：远端可见性（private|public|unknown）——private 时审计只报告不拦截
 *   （README「④ 私有库豁免」）；缺省按 origin 探测，探测失败按 unknown（保守拦截）。
 *   显式传入可免网络探测（测试/已知场景）。
 */
export async function runPreprocess({
  repoPath = '', audit, rulesetDir, cfg: extCfg, visibility: extVisibility,
  auditExemptPaths = [], auditExemptReason = '',
  stages = null,                               // 本次调用的预处理链（覆盖配置）
  ...unknownKeys                               // 未知参数一律报错：
}) {                                           //   参数名与工具参数（auditExemptPaths 等）曾不一致，
  const unknown = Object.keys(unknownKeys);    //   传错名过去是**静默无效且不报错**（实测踩到），
  if (unknown.length) {                        //   这个校验把它变成立刻可见的错误。
    throw new Error(`runPreprocess 收到未知参数：${unknown.join(', ')}（可用：repoPath/audit/rulesetDir/cfg/visibility/auditExemptPaths/auditExemptReason/stages）`);
  }
  const cfg = extCfg || defaultConfig();
  // 跑不跑预处理是**宿主自己的门禁策略**（preCommit.enabled）；旧版开关键由
  //   resolvePreCommitEnabled 一次性读回并标注来源，避免「本来开着的门禁悄悄关掉」。
  const switchState = resolvePreCommitEnabled(cfg);
  const doAudit = audit ?? switchState.enabled;
  // 沿用旧配置键时把来源透出：否则「配置里写着开、实际按新键缺省关」这种偏差
  //   只能靠用户自己发现。只在真的沿用了旧键时才带这个字段（正常路径返回值不变）。
  const preprocessSwitchMeta = switchState.source === 'legacy'
    ? { enabledFrom: 'legacy', note: '本次沿用旧版开关键的值；新键为 preCommit.enabled，迁移后旧键可删除' }
    : null;
  if (!doAudit) return { ok: true, audit: null, ...(preprocessSwitchMeta ? { preprocessSwitch: preprocessSwitchMeta } : {}) };
  // ── 解耦点：审计与评分不再在进程内跑，改为调配置化引擎子进程 ──
  //   这次调用只传「宿主才知道的调用上下文」：仓库路径 / 可见性 / 本次临时豁免。
  //   **不传审计自己的配置**（扫描范围 / 权重 / 规则槽位 / 文件数上限）——
  //   那些已随分家搬进预处理实现自己的 config.json，由它读自己的配置当默认值。
  //   宿主一旦还替它传，就等于两包仍在共享一份配置（耦合），只是换了个字段名而已。
  const engineRes = await runPreCommitPipeline({
    repoPath: repoPath || '.',
    rulesetDir: rulesetDir || '', // 调用方显式指定的规则目录（工具 ruleset 参数），不是配置
    // 可见性：显式传入时直接给引擎；未传则留空（引擎按 unknown 保守处理，gitpush 稍后按需探测）
    visibility: extVisibility,
    // 临时豁免：**参数名映射**（工具参数 auditExemptPaths → 审计包 --exempt-paths）
    exemptPaths: Array.isArray(auditExemptPaths) ? auditExemptPaths : [],
    exemptReason: auditExemptReason || '',
    stages: Array.isArray(stages) && stages.length ? stages : null,   // 调用参数 > 配置（见 resolveStages）
    cfg,
  });
  // 引擎不可用（崩/超时/退出码 2/输出不合契约）一律 fail-closed：拒绝提交并给出可诊断原因。
  //   绝不在这里「当作没有 blocker 放行」——那等于把红线交给「恰好没跑起来」。
  // 例外：预处理实现不在位（preprocessSkipped）——那是「扩展没插」，不是「引擎坏了」。
  //   按热插拔语义放行主流程，但必须把「本次未做预处理」透出给调用方（不静默）。
  //   字段名刻意用 preprocess* 而不是 audit*：预处理是通用机制，审计只是它的一个实现。
  // 阶段链的 additive 回执（只有配了 preCommit.stages 才会有这两个字段；
  //   单命令/单阶段模式不追加任何字段 ⇒ 与升级前逐字段一致）
  const stageMeta = {
    ...(Array.isArray(engineRes.preprocessStages) ? { preprocessStages: engineRes.preprocessStages } : {}),
    ...(Array.isArray(engineRes.preprocessWarnings) && engineRes.preprocessWarnings.length
      ? { preprocessWarnings: engineRes.preprocessWarnings } : {}),
  };
  if (!engineRes.ok) {
    return {
      ok: false,
      blocked: false,
      error: engineRes.error,
      audit: null,
      // 失败在被拦的那个阶段之前可能已经跑过几个阶段（例如 format 成功、audit 崩了）：
      //   把已跑阶段的回执带上，用户才知道"哪些阶段做过事"
      ...(Object.keys(stageMeta).length ? { preprocessStages: stageMeta.preprocessStages || [], ...(stageMeta.preprocessWarnings ? { preprocessWarnings: stageMeta.preprocessWarnings } : {}) } : {}),
    };
  }
  if (engineRes.preprocessSkipped) {
    return {
      ok: true,
      blocked: false,
      audit: null,
      preprocessSkipped: engineRes.preprocessSkipped,
      skipReason: engineRes.skipReason || '',
      ...stageMeta,
    };
  }
  const engineAudit = engineRes.audit || {};
  const findings = Array.isArray(engineAudit.findings) ? engineAudit.findings : [];
  const auditOut = {
    // 阶段链回执（additive）：每个阶段跑了多久、成败、onFail 语义、跳过的原因
    ...stageMeta,
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
  // ── 拦截结论：**直接用审计包的**（拆包后它才是权威）──
  //   豁免四类（代码标记 / 测试夹具 / 示例目录 / 临时豁免）加私有库降级都在包内完成，
  //   gitpush 这层不再重复实现一遍 —— 两份实现并存时最危险的是「某一天两边算得不一样」，
  //   而那时门禁到底拦不拦取决于走了哪条分支，几乎无法排查。
  // 拦截结论**只认审计包的**：宿主不再有第二套豁免/拦截实现
  auditOut.blocked = Array.isArray(engineAudit.blocked) ? engineAudit.blocked : [];
  // 示例目录豁免条数（summary.blocker 与 blocked 的差值来源之一），原样透传供排查
  if (Number.isFinite(Number(engineAudit.sampleExemptCount))) auditOut.sampleExemptCount = Number(engineAudit.sampleExemptCount);
  // exempt 回显：审计包自己给；它没给时这里按同一语义构造（记录而非判断：
  //   豁免了哪些文件、命中哪些规则、共几条 finding），保证回显字段不因实现更换而消失。
  if (engineAudit.exempt) {
    auditOut.exempt = engineAudit.exempt;
  } else {
    const exemptSet = new Set((Array.isArray(auditExemptPaths) ? auditExemptPaths : [])
      .map((value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim())
      .filter(Boolean));
    if (exemptSet.size) {
      const isExemptFile = (finding) => exemptSet.has(String(finding.file || '').replace(/\\/g, '/').replace(/^\.\//, ''));
      const exemptFindings = findings.filter(isExemptFile);
      auditOut.exempt = {
        files: [...exemptSet],
        count: exemptFindings.length,
        rules: [...new Set(exemptFindings.map((finding) => finding.rule).filter(Boolean))],
        ...(auditExemptReason ? { reason: String(auditExemptReason) } : {}),
      };
    }
  }
  if (engineAudit.privateExempt) {
    auditOut.privateExempt = engineAudit.privateExempt;
    // 私有库时审计包把结论归零（blocked: []，理由见批 B 契约）；但**对外形态保持旧样**：
    //   `audit.blocked` 历来是「报告用的原始清单」（audit-api / code_audit / 报告都读它），
    //   归零会让这些消费方以为「这个私有库一条问题都没有」，丢掉「本来有几条会拦」的可观测性。
    //   拦截结论由 `ok` / `blocked` 布尔表达（私有库恒 false/true），清单只作报告。
    if (!Array.isArray(engineAudit.blocked) || engineAudit.blocked.length === 0) {
      // 私有库时包把 blocked 归零，但报告形态仍给原始清单（租户侧读取 audit.blocked 展示）
      auditOut.blocked = findings.filter((f) => f.severity === 'blocker' || f.severity === 'error')
        .map((f) => ({ file: f.file, line: f.line, rule: f.rule, message: String(f.message || '').slice(0, BLOCKED_MESSAGE_PREVIEW_CHARS) }));
    }
  }
  const blocked = auditOut.blocked;

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
  const rendered = await (async () => { try { const api = await auditClient.hostApi(); return api.renderAuditResult(renderCtx, cfg); } catch { return undefined; } })();
  auditOut.apiGuide = rendered?.apiGuide ?? fallbackRender.apiGuide;
  if (auditOut.exempt) auditOut.exempt.note = rendered?.notes?.exempt ?? fallbackRender.notes.exempt;

  if (blocked.length > 0 && !auditOut.privateExempt) {
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
 *   audit 缺省取预处理开关（preCommit.enabled）；rulesetDir 只认显式传参。
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
  customIgnorePatterns = '',
  force = false,
  pushMethod,
  pushGate = false,
  pushConfirmed = false,
  paths = '', // 精确 add 路径（逗号分隔，相对 repoPath）；空 = git add -A
  stages = null, // 本次调用的预处理链（覆盖配置里的 preCommit.stages）
} = {}) {
  const cfg = defaultConfig();
  const a = await runPreprocess({ repoPath, audit, rulesetDir, stages });
  // blocked 用 runPreprocess 的真实结论（缺省仍按拦截处理）：
  //   审计判定拦截 = true；引擎不可用 = false（那是「没跑起来」，不是「审计不通过」，
  //   工具侧据此显示「未完成：<原因>」而不是「推送被拦截」）。
  if (!a.ok) return { ok: false, blocked: a.blocked ?? true, error: a.error, audit: a.audit };
  // 推送通道缺省取插件配置（默认 ssh：推本地 HEAD、远端 sha 与本地一致）
  const r = await commitAndPush({ repoPath, message, push, dryRun, customIgnorePatterns, force, pushMethod: pushMethod || cfg.pushMethod || 'ssh', pushGate, pushConfirmed, paths });
  return { ok: r.ok !== false, ...r, audit: a.audit };
}

/**
 * 批量提交推送（D16 commitMany）：对每个仓库依次 commitAndPush，返回逐仓结果数组。
 * 注意：仅做提交推送（不含审计门禁）——审计请用 commitWithAudit 逐仓调用。
 * @param {{repos: string[], message: string, push?: boolean, dryRun?: boolean, customIgnorePatterns?: string}} opts
 * @returns {Promise<Array<{repo: string, ...commitAndPush 结果}>>}
 */
export async function commitMany({ repos = [], message = '', push = true, dryRun = false, customIgnorePatterns = '' } = {}) {
  const results = [];
  for (const repoPath of repos) {
    results.push({ repo: repoPath, ...(await commitAndPush({ repoPath, message, push, dryRun, customIgnorePatterns })) });
  }
  return results;
}