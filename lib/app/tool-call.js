/**
 * 插件入口层 · 工具调用分发
 *
 * callTool 把宿主的工具调用分发到各能力（审计/推送/扫描/账号…），
 *   readTextSafe 是它的读文件兜底（不存在返回空串而非抛错）。
 * 与 HTTP 处理分开：两条入口（工具 / HTTP）的鉴权与返回形态完全不同。
 */

import { existsSync, readFileSync } from 'node:fs';
import { MAX_MSG_PREVIEW } from './constants.js';
import { access } from 'node:fs/promises';
/** blocked 消息预览截断长度（工具返回精简——完整 message 走审计明细）。 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { auditWithScope, auditFull, summarize } from '../audit/index.js';
import { formatAnalysisCoverageLine } from '../audit/analysis-coverage.js';
import { scoreQuality } from '../score/index.js';
import {
  cloneViaApi, previewClone, resolveMaxCloneFileMB, ensureRemoteRepo, setVisibility, maintainRepoIndex, updateRepoIndex, resolveToken, commitAndPush,
  scanRepos, checkGithubAccount, formatGithubAccountBlock, generateSshKey, persistSshPub,
  refreshAccountStatus,
} from '../git/index.js';
import { runAudit } from '../commit-push.js';

/* ───────── 工具调用常量 ───────── */
import { defaultConfig } from '../client/index.js';
import { checkLinks, sumLinkPenalty } from '../link-check/index.js';
import { scanFileIo } from '../../scripts/scan-file-io.mjs';
import { runModuleSplitter } from '../git/module-splitter.js';
// 架构事实导出（工具 arch_json）：四步都在 lib/arch/ 里，这里只做转发
import { exportArchJson } from './handlers/arch-json.js';
import { callIdentityRewrite } from './handlers/identity-rewrite.js';
import { MSG_REPO_REQUIRED } from './constants.js';
import { buildAuditApiGuide } from './inject-text.js';
import { exemptStatsOf, GROUP_BY_KEYS } from './audit-api.js';
import { setLastSlotHitStats } from './slot-stats.js';
import { getDefaultScanRoot } from './scan-root.js';

/**
 * 工具调用分发（薄适配：参数 → 总入口函数）。
 * @param {string} toolName
 * @param {object} args
 * @param {object} env { workspaceRoot, extraRepos }
 * @param {object} cfg 插件配置
 * @param {object} [log]
 * @param {object} [jobs] 宿主 ctx.jobs（dsh-jobs-local 提供）；缺省时 commit+push 同步执行
 * @returns {Promise<object>}
 */
/**
 * git_commit_push 工具实现（从 callTool switch 抽出）：
 * 审计同步即时拦截（保住提交门禁）→ 通过后 commit+push+索引重建注册为宿主官方
 * 后台 job（ctx.jobs）；宿主无 job 控制器时同步执行保底（幂等安全）。
 */
/** commitWithAudit 成功后的推送后置步骤：索引重建 + 账号状态刷新（fire-and-forget，失败静默）。
 * 从 callCommitPush 拆分（削减其行数/复杂度）。 */
async function pushWithPostSteps(args, env, cfg) {
  const r = await commitAndPush({
    repoPath: args.repo,
    message: args.message,
    push: args.push !== false,
    dryRun: args.dryRun === true,
    customIgnorePatterns: args.ignorePatterns || '',
    requirementsConfirmed: args.requirementsConfirmed === true,
    force: args.force === true,
    pushMethod: cfg.pushMethod || 'ssh',
    // 推送门禁——开启时 push 需显式放行（pushConfirmed:true）；未放行返回 PUSH_GATE 拦截
    pushGate: cfg.pushGate === true,
    pushConfirmed: args.pushConfirmed === true,
    // 精确 add 路径（逗号分隔，相对 repo）；空 = git add -A 全量
    paths: String(args.paths || ''),
  });
  if (r?.ok && r?.pushed) {
    try {
      // 统一走 updateRepoIndex（mode='rebuild' 合并不全量覆盖），
      //   返回 indexUpdated 随工具结果透传（AI/UI 可据此触发列表重读）
      const idx = await updateRepoIndex({
        workspaceRoot: env.workspaceRoot,
        token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
        owner: r.push?.owner || 'EIGHTfs',
        mode: 'rebuild',
      });
      if (idx?.ok) r.indexUpdated = true;
    } catch { /* 索引重建失败静默，不阻塞任务结果 */ }
    // 推送成功顺便验证账号并刷新 account-status.json（token/ssh 有效性）——
    //   与本地仓库索引同一时机，fire-and-forget，失败静默。
    try {
      await refreshAccountStatus({ workspaceRoot: env.workspaceRoot });
    } catch { /* 账号状态刷新失败静默 */ }
  }
  return r;
}

/**
 * 把 commit+push 结果映射成宿主后台 job 的 `{status, detail}` —— **不得无条件报「完成」**。
 *
 * 为什么要单独成函数（实测 bug）：job spec 原先无论结果如何都返回
 *   `{ status: 'completed', detail: 'commit+push done' }`，于是推送失败、被推送门禁拦截、
 *   远端 sha 与本地不一致（假成功）、甚至「无变更」全都显示成「commit+push done」——
 *   AI 与用户据此以为推成功了，实际远端没动（历史上 GitHub 返回 500 那次就是这样被误导的）。
 * push.js 内部虽有 verified 三态防线（verified===false → ok:false），但 job 状态把它盖住了。
 *
 * 判据（从结果本身推导，不猜）：
 *   · ok:false（含 blocked 门禁拦截 / push 失败 / 远端核验不一致）→ status:'failed' + 真实原因
 *   · pushed:true 且 verified:false → failed（远端未更新）
 *   · pushed:true 且 verified:null → completed，但detail 写明「远端核验未完成」
 *   · committed:false → completed + 「无变更，跳过提交」（真没东西可提交，不是失败）
 *   · 其余（已提交但未推送，如远端已是最新）→ completed + 如实写明未推送及原因
 * @param {object} r commitPushDoPush 的返回
 * @returns {{status:'completed'|'failed', detail:string}}
 */
export function pushJobOutcome(r = {}) {
  const res = r || {};
  const short = (sha) => String(sha || '').slice(0, 8);
  // 结果里**同时给出本地与远端 HEAD**（比一句 done 直观，且一眼看出通道差异）：
  //   ssh 通道推的就是本地对象 ⇒ 两者相同；api 通道在远端重建提交 ⇒ 两者不同
  //   （见 lib/git/transport.js 的通道说明）。
  const heads = (localSha, remoteSha) => `本地 HEAD ${short(localSha) || '未取到'}｜远端 HEAD ${short(remoteSha) || '未取到'}`;
  if (res.ok === false) {
    const why = res.error || (res.blocked ? '推送被拦截' : '未完成');
    return { status: 'failed', detail: res.blocked ? `未推送（被拦截）：${why}` : `未完成：${why}` };
  }
  const pushInfo = res.push || {};
  if (res.pushed === true) {
    if (pushInfo.verified === false) {
      return { status: 'failed', detail: `远端未更新：${heads(res.commitSha, pushInfo.remoteSha)}（两者不一致）` };
    }
    if (pushInfo.verified === null || pushInfo.verified === undefined) {
      return { status: 'completed', detail: `已提交并推送，但远端核验未完成：${heads(res.commitSha, pushInfo.remoteSha)}${pushInfo.verifyError ? `（${pushInfo.verifyError}）` : '（请自行 ls-remote 复核）'}` };
    }
    return { status: 'completed', detail: `已提交并推送（已核验一致）：${heads(res.commitSha, pushInfo.remoteSha || res.commitSha)}` };
  }
  if (res.committed === false) return { status: 'completed', detail: res.message || '无变更，跳过提交' };
  return { status: 'completed', detail: `已提交，未推送：${heads(res.commitSha, '')}｜原因：${pushInfo.reason || res.message || '未推送'}` };
}

/**
 * 把 clone 结果映射成 job 的 `{status, detail}` —— 与 pushJobOutcome 同一条原则：
 *   失败就必须报失败，不能一律「clone done」。
 * @param {object} r clone 的返回
 * @returns {{status:'completed'|'failed', detail:string}}
 */
export function cloneJobOutcome(r = {}) {
  const res = r || {};
  if (res.ok === false || res.error) return { status: 'failed', detail: `克隆未完成：${res.error || '未知原因'}` };
  if (res.canceled) return { status: 'failed', detail: '克隆已取消' };
  return { status: 'completed', detail: '克隆完成' };
}

/** 构造宿主后台 job spec（kind=git-push；run 返回取消句柄 + done Promise）。 */
function buildCommitPushJobSpec(repo, doPush) {
  return {
    kind: 'git-push',
    label: `commit+push ${repo}`,
    run: () => {
      const done = (async () => {
        try {
          const r = await doPush();
          // 如实映射：失败/未推送/核验不一致都不许报「完成」（见 pushJobOutcome）
          return { ...pushJobOutcome(r), output: JSON.stringify(r) };
        } catch (e) {
          return { status: 'failed', detail: String((e && e.message) || e) };
        }
      })();
      return { cancel: () => {}, done };
    },
  };
}

/**
 * git_clone 工具实现（2026-10-02 功能：clone 注册宿主后台 job）：
 * 大仓库下载注册为宿主官方后台 job（ctx.jobs）——工具立即返回 jobId（如 git-clone-1），
 * AI 用宿主 job_output/job_list/job_kill 查询/中止；宿主无 job 控制器时同步执行保底。
 * clone 是只读操作无需审计门禁（与 git_commit_push 的差异点）。
 */
// clone 工具的同步/后台共用执行体。
// 修复（实测发现）：此前 `cloneViaApi({ target, dest, branch })` **完全没传 token**，
//   于是工具路径的克隆走**匿名 API**——私有库直接失败、公开库吃匿名限流（60 次/小时），
//   而 HTTP 路径（handlers/clone.js）与预览路径（下方 previewClone）都带了 token ⇒ 两条路径行为不一致。
//   同时也没传 maxFileMB（体积上限），会落到 previewClone/cloneViaApi 各自的默认值。
// 修复方式：把 env/cfg 传进来，按仓库解析 token 并统一体积上限（与 HTTP 路径同口径）。
async function callCloneJob(args, jobs, exec, log, env = {}, cfg = {}) {
  const doClone = () => cloneViaApi({
    target: args.target, dest: args.dest, branch: args.branch,
    token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
    maxFileMB: resolveMaxCloneFileMB(cfg),
  });
  if (!jobs || typeof jobs.start !== 'function') {
    const r = await doClone();
    return { ok: true, async: false, result: r };
  }
  let jobId;
  try {
    const spec = buildCloneJobSpec(args.target, args.dest, doClone);
    // owner 必须是**会话 id 字符串**：宿主 jobs-local.resolveOwner(session) → agents.get(session)；
    //   传 Agent 对象会 agents.get(<object>) → undefined → 抛 "session ... has no live agent"，
    //   再被下方 catch 吞成「同步兜底」→ 后台 job 静默失效（实测回归，见 test/test-task-queue.mjs）。
    // 修复背景：owner 形状错 → jobs.start 抛「no live agent」被吞 → 后台 job 静默降级为同步。
    //   clone / commit_push / 审计历史三处按同一契约一并修。
    if (exec?.agent?.id) spec.owner = exec.agent.id;
    jobId = jobs.start(spec);
  } catch (e) {
    log?.warn?.(`ctx.jobs 不可用，git_clone 降级同步执行：${e?.message || e}`);
    const r = await doClone();
    return { ok: true, async: false, jobFallback: true, result: r };
  }
  return { ok: true, async: true, jobId, hint: '已注册宿主后台 job（clone 下载中，结果完成会自动返回）；如需主动查：job_output ' + jobId };
}

/** 构造 clone 后台 job spec（kind=git-clone；run 返回取消句柄 + done Promise）。 */
function buildCloneJobSpec(target, dest, doClone) {
  return {
    kind: 'git-clone',
    label: `clone ${target}${dest ? ` → ${dest}` : ''}`,
    run: () => {
      const done = (async () => {
        try {
          const r = await doClone();
          // 与 commit+push 同一条原则：失败必须报失败（见 cloneJobOutcome）
          return { ...cloneJobOutcome(r), output: JSON.stringify(r) };
        } catch (e) {
          return { status: 'failed', detail: String((e && e.message) || e) };
        }
      })();
      return { cancel: () => {}, done };
    },
  };
}

/**
 * git_commit_push 工具实现（从 callTool switch 抽出）：
 * 审计同步即时拦截（保住提交门禁）→ 通过后 commit+push+索引重建注册为宿主官方
 * 后台 job（ctx.jobs）；宿主无 job 控制器时同步执行保底（幂等安全）。
 */
async function callCommitPush(args, env, cfg, log, jobs, exec) {
  const repo = args.repo;
  if (!repo) return { ok: false, error: MSG_REPO_REQUIRED };
  // 后台化（官方 job）：审计同步即时拦截（保住提交门禁），
  //   blocker 命中 → 立即返回拦截、不执行任何 git 操作；审计通过 → commit+push
  //   +索引重建注册为宿主官方后台 job（ctx.jobs，dsh-jobs-local），工具立即返回
  //   jobId（如 git-push-1），AI 用宿主自带 job_output/job_list/job_kill 查询。
  const auditGate = await runAudit({
    repoPath: repo,
    audit: args.audit,
    // 不再透传 auditLevel——审计固定走完整流程（正则初筛 + AST 语义检查）
    rulesetDir: args.ruleset,
    slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined,
    cfg,
  });
  if (!auditGate.ok) return auditGate; // { ok:false, blocked:true, audit }
  const doPush = () => pushWithPostSteps(args, env, cfg);
  // 宿主未提供 ctx.jobs（如脱离 DSH 的 CLI/测试环境）→ 同步执行保底
  if (!jobs || typeof jobs.start !== 'function') {
    const r = await doPush();
    return { ok: true, async: false, result: r };
  }
  // 修复：job 控制器**存在但不对当前执行主体服务**时，jobs.start() 会抛
  //   「no job controller serves this agent」——此前未捕获 → 工具报错退出、无法降级，
  //   结果只能人工手推（实测：宿主组合里 dsh-tool-jobs 未挂载到执行会话，start 即抛）。
  //   现在捕获该异常回退同步执行（与「无 ctx.jobs」同一保底路径）。
  // 追加：**必须把 owner 传给 jobs.start**——servesOwner 按 owner 的 scope 链
  //   找控制器（tool-jobs 挂在执行会话组合 = scoped 控制器），不传 owner（undefined）时只查
  //   全局层控制器，scoped 控制器不服务 unowned 任务 → 仍抛错。exec.agent 即当前执行主体。
  let jobId;
  try {
    const spec = buildCommitPushJobSpec(repo, doPush);
    // exec.agent 缺失（CLI/测试环境）时不传 owner（unowned，仍走全局控制器或降级）
    // owner 必须是**会话 id 字符串**：宿主 jobs-local.resolveOwner(session) → agents.get(session)；
    //   传 Agent 对象会 agents.get(<object>) → undefined → 抛 "session ... has no live agent"，
    //   再被下方 catch 吞成「同步兜底」→ 后台 job 静默失效（实测回归，见 test/test-task-queue.mjs）。
    // 修复背景：owner 形状错 → jobs.start 抛「no live agent」被吞 → 后台 job 静默降级为同步。
    //   clone / commit_push / 审计历史三处按同一契约一并修。
    if (exec?.agent?.id) spec.owner = exec.agent.id;
    jobId = jobs.start(spec);
  } catch (e) {
    // 控制器不可用 → 同步执行降级（同一 doPush，幂等安全）
    log?.warn?.(`ctx.jobs 不可用，git_commit_push 降级同步执行：${e?.message || e}`);
    const r = await doPush();
    return { ok: true, async: false, jobFallback: true, result: r };
  }
  return { ok: true, async: true, jobId, audit: auditGate.audit, hint: '已注册宿主后台 job（结果完成会自动返回，无需特意查询）；如需主动查：job_output ' + jobId };
}

/**
 * code_audit 工具实现（从 callTool switch 抽出）：
 * 权重 = 显式传参 > cfg.weightOverrides > 默认；history 走宿主后台 job（无控制器同步降级）；
 * 结果带 block 可读总结 + slotStats 供侧边栏规则包命中数。
 */
/**
 * 构造工具侧审计参数（code_audit 共用；从两处重复提取）。
 * scope 由调用方决定（history=full / 默认 diff+full 判断）。
 */
function buildAuditOpts(args, cfg, scope) {
  return {
    scope,
    rulesetDir: args.ruleset || '',
    maxScanFiles: cfg.maxScanFiles,
    slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined,
    disabledSlots: Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [],
    includeIgnored: args.includeIgnored === true,
    // 分析覆盖率信息项（默认开；coverage:false 关闭——大仓库省一次读取+解析）
    coverage: args.coverage !== false,
  };
}

/**
 * history 模式：历史提交审计（逐提交快照全量 + 落盘报告），宿主后台 job 串行；
 * 与 CLI `audit --history` 同一实现 runHistoryAudit；jobs 缺失/不服务时同步降级。
 */
async function runHistoryAuditTool(args, env, cfg, jobs, exec, weights) {
  const repo = args.repo;
  const { runHistoryAudit } = await import('../audit/history.js');
  const { resolveReportDir } = await import('../audit/history-report.js');
  const auditOpts = buildAuditOpts(args, cfg, 'full');
  const reportDir = resolveReportDir(repo, args.outDir || '');
  const doHistory = async () => {
    const r = await runHistoryAudit(repo, { since: args.since, until: args.until, outDir: reportDir, auditOpts, weights });
    return { status: r.ok ? 'completed' : 'failed', detail: r.ok ? 'history audit done' : String(r.error || 'failed'), output: JSON.stringify(r) };
  };
  if (!jobs || typeof jobs.start !== 'function') {
    const r = await doHistory();
    return { ok: true, async: false, result: r, reportDir };
  }
  try {
    const spec = {
      kind: 'git-push',
      label: `history-audit ${repo}`,
      run: () => { const done = doHistory(); return { cancel: () => {}, done }; },
    };
    // owner 必须是**会话 id 字符串**：宿主 jobs-local.resolveOwner(session) → agents.get(session)；
    //   传 Agent 对象会 agents.get(<object>) → undefined → 抛 "session ... has no live agent"，
    //   再被下方 catch 吞成「同步兜底」→ 后台 job 静默失效（实测回归，见 test/test-task-queue.mjs）。
    // 修复背景：owner 形状错 → jobs.start 抛「no live agent」被吞 → 后台 job 静默降级为同步。
    //   clone / commit_push / 审计历史三处按同一契约一并修。
    if (exec?.agent?.id) spec.owner = exec.agent.id;
    const jobId = jobs.start(spec);
    return { ok: true, async: true, jobId, reportDir, hint: '历史审计后台 job 已注册（结果完成会自动返回，无需特意查询）；如需主动查：job_output ' + jobId };
  } catch (e) {
    const r = await doHistory();
    return { ok: true, async: false, jobFallback: true, result: r, reportDir };
  }
}

async function callCodeAudit(args, env, cfg, log, jobs, exec) {
  const repo = args.repo;
  if (!repo) return { ok: false, error: MSG_REPO_REQUIRED };
  // 修复：权重来源 = 工具参数显式传参 > 侧边栏保存的 cfg.weightOverrides（config.json
  //   回读）> 默认权重表。此前只认 args.weights——侧边栏权重设置保存了但审计完全无视（假保存）。
  const weightSrc = args.weights || (typeof cfg.weightOverrides === 'string' ? cfg.weightOverrides : '');
  let weights = {};
  if (weightSrc) {
    try { weights = JSON.parse(weightSrc); } catch { /* 非法 JSON 回退默认权重 */ }
  }
  if (args.history === true) return runHistoryAuditTool(args, env, cfg, jobs, exec, weights);
  return runStandardAuditTool(args, env, cfg, log, weights);
}

/** standard 模式：diff/full 审计 + 评分 + block 总结。 */
async function runStandardAuditTool(args, env, cfg, log, weights) {
  const repo = args.repo;
  const auditOpts = buildAuditOpts(args, cfg, 'diff');
  // existsSync → fs.promises.access 异步化（消除 io-risk 高风险警告；语义不变）
  let isGitDir = true;
  try { await access(join(repo, '.git')); } catch { isGitDir = false; }
  const fullScope = args.scope === 'full' || !isGitDir;
  const auditResult = fullScope
    ? await auditFull(repo, auditOpts)
    : await auditWithScope(repo, auditOpts);
  const summary = summarize(auditResult.findings);
  // 0 文件（空目录/diff 0 变动）不评分——scoreQuality 返回 emptyResult 防满分
  const quality = scoreQuality(auditResult.findings, weights, { files: auditResult.files });
  // 审计后直接输出豁免类型统计 + 聚合类型 + 拦截列表（blocker 详情不用查 API）
  const exemptStats = exemptStatsOf(auditResult.findings);
  const blocked = auditResult.findings
    .filter((f) => f.severity === 'blocker')
    .map((f) => ({ file: f.file, line: f.line, rule: f.rule, message: String(f.message || '').slice(0, MAX_MSG_PREVIEW) }));
  // 审计输出改为「级别数量 + 评分 + API 查询用法」——审计明细由聚合 API
  //   （/api/git-push/audit）查询，不再内联输出 findings/审计内容（有聚合 API 消费审计结果）。
  const apiGuide = buildAuditApiGuide(repo, { scope: auditResult.scope, summary, quality, exemptStats, blocked, groupByTypes: GROUP_BY_KEYS });
  // 分析覆盖率由审计编排层统一计算（CLI 与工具同一口径，见 lib/audit/orchestrate.js），这里只做透传与展示。
  const analysisCoverage = auditResult.analysisCoverage || null;
  // 缓存按规则包命中数供给 HTTP /rule-slots（侧边栏规则包列表显示实际命中数）
  if (auditResult.slotStats) setLastSlotHitStats(auditResult.slotStats, repo);
  log?.info?.(`code_audit ${repo} → ${quality.emptyResult ? '未评分(0 文件)' : quality.score + '/' + quality.level}（blocker ${summary.blocker} / warning ${summary.warning} / notice ${summary.notice}）`);
  // 参数 includeFindings=true 时返回全量审计结果（findings+yaml——恢复 1.11.5 前的直接全量输出；
  //   默认 false 保持精简 apiGuide——审计明细走聚合 API）
  const withFindings = args.includeFindings === true;
  const out = { ok: true, scope: auditResult.scope, files: auditResult.files, summary, quality, exemptStats, blocked, groupByTypes: GROUP_BY_KEYS, apiGuide, slotStats: auditResult.slotStats };
  if (analysisCoverage) {
    out.analysisCoverage = analysisCoverage;
    out.apiGuide = `${apiGuide}\n${formatAnalysisCoverageLine(analysisCoverage)}`;
  }
  if (withFindings) {
    out.findings = auditResult.findings;
    if (auditResult.yaml) out.yaml = auditResult.yaml;
  }
  return out;
}

export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig(), log = null, jobs = null, exec = null) {
  switch (toolName) {
    case 'git_scan': {
      const root = args.root || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
      const pathList = String(args.paths || '').split(',').map((str) => str.trim()).filter(Boolean);
      const extraReposFile = args.extraReposFile || env.extraReposFile || '';
      const repos = scanRepos(root, {
        extraRepos: [...(env.extraRepos || []), ...pathList],
        extraReposFile,
      });
      return { ok: true, root, count: repos.length, paths: pathList, extraReposFile, repos };
    }
    case 'git_commit_push':
      return callCommitPush(args, env, cfg, log, jobs, exec);
    case 'code_audit':
      return callCodeAudit(args, env, cfg, log, jobs, exec);
    case 'git_gen_readme': {
      // README 生成已抽为独立脚本 scripts/readme-gen.mjs，插件不再内置此工具。
      return { ok: false, error: 'git_gen_readme 已移除：请用 `node scripts/readme-gen.mjs <repo> [--write <path>]`（见插件 skill 文档组织节）' };
    }
    case 'git_clone': {
      if (!args.target) return { ok: false, error: 'target 必填' };
      // 2026-10-02 功能：clone 注册宿主后台 job（同 git_commit_push）——大仓库下载
      //   不阻塞工具调用，立即返回 jobId；宿主 job 完成自动回传。宿主无 job 控制器时同步执行保底。
      // env/cfg 必须传下去：clone 要按仓库解析 token（否则走匿名 API，私有库失败、公开库吃限流）
      //   与统一体积上限（与 HTTP 路径同口径）。
      return callCloneJob({ target: args.target, dest: args.dest, branch: args.branch }, jobs, exec, log, env, cfg);
    }
    case 'git_remote_create':
      if (!args.repo) return { ok: false, error: MSG_REPO_REQUIRED };
      return ensureRemoteRepo({ repoPath: args.repo, visibility: args.visibility || 'private', dryRun: args.dryRun === true });
    case 'git_identity_rewrite':
      // 提交身份历史改写：默认 dryRun 只报告，真改写要先 dryRun:false/write，推送要 push:true
      return callIdentityRewrite(args, env, cfg);
    case 'git_set_visibility':
      if (!args.repo || !args.visibility) return { ok: false, error: 'repo 与 visibility 必填' };
      return setVisibility({ repoPath: args.repo, visibility: args.visibility });
    case 'arch_json': {
      // 事实导出：lib/arch/* 四步（extract → aggregate → to-json → validate）
      //   不在此重写任何判定——组件/连线/校验都复用那几个模块，避免两套口径漂移。
      const repoPath = args.repoPath || env.workspaceRoot;
      if (!repoPath) return { ok: false, error: 'repoPath 必填（或用会话工作区）' };
      return await exportArchJson({ repoPath, maxFiles: args.maxFiles, allowDangling: args.allowDangling });
    }
    case 'io_scan': {
      // 复用 scripts/scan-file-io.mjs（AST 四级分级，与审计 robustness/io-risk 同标准）
      //   不在此另写扫描逻辑，避免两套判定漂移。
      const root = args.repo || env.workspaceRoot;
      if (!root) return { ok: false, error: 'repo 必填（或用会话工作区）' };
      const hits = scanFileIo({
        targets: [root],
        writeOnly: args.writeOnly === true,
      });
      const byRisk = { high: 0, medium: 0, low: 0, safe: 0 };
      for (const hit of hits) if (byRisk[hit.risk] != null) byRisk[hit.risk] += 1;
      const sync = hits.filter((hit) => hit.type === 'sync').length;
      return { ok: true, root, total: hits.length, sync, byRisk, items: hits };
    }
    case 'git_clone_preview': {
      if (!args.target) return { ok: false, error: 'target 必填' };
      return previewClone({
        target: args.target,
        branch: args.branch,
        token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
        maxFileMB: resolveMaxCloneFileMB(cfg),
      });
    }
    case 'link_check': {
      const path = args.path || env.workspaceRoot;
      const links = await checkLinks({ file: path, text: readTextSafe(path) });
      return { ok: true, count: links.length, penalty: sumLinkPenalty(links), findings: links };
    }
    case 'edit_after_read': {
      // 读改合一：自己读当前文件 → 校验（唯一性 / 读后是否被改动）→ 字面替换 → 写回。
      //   动态 import 避免在文件顶部再添一行导入（本 case 已在 async 函数内，await 可用）。
      const { editAfterRead } = await import('../fs/edit-after-read.js');
      const r = editAfterRead({ path: args.path, old: args.old, new: args.new ?? '', all: args.all === true });
      return r.ok
        ? { ok: true, path: r.path, replaced: r.replaced, bytesBefore: r.bytesBefore, bytesAfter: r.bytesAfter }
        : { ok: false, path: r.path, reason: r.reason };
    }
    case 'module_splitter': {
      // 巨型单文件拆分（复用 scripts/module-splitter.py，python3 零依赖）。
      // python3 调用逻辑抽到 lib/git/module-splitter.js（与 cli cmdModuleSplitter 共用），
      //   此处只做参数映射与结果返回。
      const command = String(args.command || '').trim();
      const target = String((command === 'analyze' ? args.file : args.plan) || '').trim();
      if (!target) {
        return { ok: false, error: command === 'analyze' ? 'analyze 需要 file（待拆 .js 路径）' : `${command} 需要 plan（plan.json 文件路径）` };
      }
      if (!existsSync(target)) return { ok: false, error: `目标不存在：${target}` };
      const r = runModuleSplitter({ sub: command, target, dryRun: args.dryRun === true });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, command: r.sub, target: r.target, dryRun: r.dryRun, output: r.output };
    }
    case 'git_account_check': {
      if (args.sshPub) persistSshPub(String(args.sshPub), { workspaceRoot: env.workspaceRoot });
      const accountInfo = await checkGithubAccount({ workspaceRoot: env.workspaceRoot, token: String(args.token || '') });
      return { ok: true, ...accountInfo, block: formatGithubAccountBlock(accountInfo) };
    }
    case 'git_cred_env': {
      // 凭据传递——输出环境变量前缀（SSH 私钥路径 / HTTPS askpass 脚本），
      //   AI 执行任意外部 git 命令时粘贴使用，全程不输出 token/私钥明文。
      const { buildCredEnv } = await import('../git/cred-env.js');
      const r = buildCredEnv({ workspaceRoot: env.workspaceRoot });
      return { ok: true, ...r };
    }
    case 'git_gen_ssh_key': {
      const r = generateSshKey(String(args.email || ''), { workspaceRoot: env.workspaceRoot, force: args.force === true });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, email: r.email, privateKey: r.privateKey, pubFile: r.pubFile, pub: r.pub, note: '公钥已写入插件配置目录 *.pub，可复制粘贴到 GitHub → Settings → SSH and GPG keys' };
    }
    case 'git_sluice': {
      // 浅包装 git 透传——AI 直接调用任意 git 命令（凭据自动注入）。
      //   args 参数串按 shell 规则拆分（引号包裹的路径含空格不受影响），
      //   与 CLI git-sluice git <参数> 同实现（lib/git/wrapped-git.js runWrappedGitCapture）。
      const { runWrappedGitCapture } = await import('../git/wrapped-git.js');
      const argv = shellSplit(String(args.args || ''));
      if (argv.length === 0) return { ok: false, error: 'args 必填：git 参数串（如 "status --short"）' };
      const r = runWrappedGitCapture(argv, { workspaceRoot: env.workspaceRoot });
      return { ok: r.ok, status: r.status, stdout: r.stdout, stderr: r.stderr, command: ['git', ...argv].join(' ') };
    }
    default:
      return { ok: false, error: `未知工具: ${toolName}` };
  }
}

/** 按 shell 规则拆分参数串（支持单双引号包裹含空格的路径）。 */
function shellSplit(input) {
  const out = [];
  let cur = '';
  let quote = ''; // '' | '"' | "'"
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 读文件（失败返回空串，link_check 用）。 */
function readTextSafe(path = '') {
  try {
    return readFileSync(path, 'utf8');
  } catch { return ''; }
}
