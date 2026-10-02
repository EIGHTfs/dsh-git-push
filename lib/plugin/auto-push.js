/**
 * dsh-git-push — 任务完成自动推送（内置自 dsh-task-completion，功能并入本插件——自动推送能力从独立模块并入，随插件版本走）
 *
 * 把 task-completion-report skill 的「AI 输出 ✅任务完成 = 交付结束」约定固化为代码管道：
 *   1. 监听 `session/event` 的 `turn/end`（AI 回合结束）
 *   2. 提取最后一条 assistant 回复，检测完成标记（默认「✅任务完成」，UI 可自定义）
 *   3. 自动推送入口开关 autoPushEnabled（默认关）开启时，auto 触发 commit+push
 *   4. **commit+push 复用 git-push 完整门禁 commitWithAudit**（L0 审计 blocker 拦截、
 *      requirements 清单、pushGate 显式放行）——绝不裸提交自行绕过门禁
 *
 * 触发面：
 *   - 自动：turn/end 检测到「✅任务完成」且许可开 → 调 commitWithAudit（并发闸 + 回合去重 + 防抖）
 *   - 工具 / HTTP 由插件既有注册面承载（push_auto_status / push_auto_config）
 *
 * 配置（Config/settings-bridge，UI 门禁开关旁）：
 *   autoPushEnabled:      自动推送许可（默认 false = 关，AI 回复完成任务不自动推）
 *   autoPushTriggerText:  完成检测文本/正则（默认「✅任务完成」）
 *   autoPushScope:        'session'（默认，仅会话 cwd 仓库）| 'all'（workspace 全部有变更仓库）
 *   autoPushMessage:      自动提交 message（默认 'chore(ai): 任务完成自动提交'）
 */

import { extractLastAssistantText, shouldAutoPush, compileTriggerPattern } from './auto-detect.js';
import { scanRepos } from '../git/repos.js';
import { runGit } from '../git/exec.js';

/* ───────── 自动推送常量 ───────── */
const AUTO_PUSH_SETTLE_MS = 800;  // 回合结束后等收尾落盘的防抖时长
const DEFAULT_SCAN_DEPTH = 20;    // 扫描仓库下钻深度默认值

/** 触发面开关（默认全关——保守：自动推送与审计都不默认开，需用户经 UI 显式开启）。 */

/**
 * 注册自动推送：监听回合结束 → 检测 → 门禁提交。
 * @param {object} ctx DSH 上下文（需 ctx.on；日志走内置 ctx.logger——宿主无 log 服务）
 * @param {object} p { cfg, onPushAfterCommit? }
 * @param {object} p.cfg 插件运行期 cfg（autoPushEnabled / autoPushTriggerText / autoPushScope / autoPushMessage / workspaceRoot / extraRepos）
 * @param {(r:object)=>void} [p.onPushAfterCommit] 推送/拦截后回调（写 lastAutoPush 记录）
 * @returns {{ enabled:boolean, wired:boolean }}
 */
export function registerAutoPush(ctx, { cfg = {}, onPushAfterCommit } = {}) {
  const log = ctx?.get?.('log');
  const enabled = cfg.autoPushEnabled === true;
  if (!enabled) {
    return { enabled: false, wired: false };
  }
  // 编译触发正则（用户自定义 / 默认「✅任务完成」）
  const trigger = compileTriggerPattern(cfg.autoPushTriggerText);
  const scope = cfg.autoPushScope === 'all' ? 'all' : 'session';

  let autoPushRunning = false; // 并发闸：同时只跑一个
  const lastTurns = new Map(); // sessionId -> 已处理 turn（去重）
  const timers = new Map(); // sessionId -> debounce timer

  function schedule(session, event) {
    const sessionId = session?.id;
    if (typeof sessionId !== 'string') return;
    const turn = event?.data?.turn ?? 0;
    if (lastTurns.get(sessionId) === turn) return; // 同回合只查一次
    const existing = timers.get(sessionId);
    if (existing !== void 0) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(sessionId);
      runCheck(session, turn).catch((e) => log?.warn?.(`自动推送检查失败 ${sessionId}: ${String(e?.message ?? e)}`));
    }, AUTO_PUSH_SETTLE_MS); // 等回合收尾落盘
    timer.unref?.();
    timers.set(sessionId, timer);
  }

  async function runCheck(session, turn) {
    const sessionId = session?.id;
    const text = extractLastAssistantText(session?.events);
    const decision = shouldAutoPush({ text, permitted: true, opts: { trigger } });
    lastTurns.set(sessionId, turn);
    if (!decision.trigger) {
      return { trigger: false, reason: decision.reason };
    }
    if (autoPushRunning) {
      return { trigger: true, ok: false, reason: '已有自动推送在进行，跳过本次' };
    }
    autoPushRunning = true;
    try {
      return await runAutoPush(session, turn, log);
    } finally {
      autoPushRunning = false;
    }
  }

  /** 解析本次自动推送的目标仓库路径（session 模式优先会话 cwd 所在仓库）。 */
  function resolveTargets(session) {
    const workspaceRoot = cfg.workspaceRoot || process.cwd();
    const scan = () => scanRepos(workspaceRoot, {
      depth: cfg.scanDepth || DEFAULT_SCAN_DEPTH,
      extraRepos: Array.isArray(cfg.extraRepos) ? cfg.extraRepos : [],
    }).filter((r) => r.changes > 0).map((r) => r.path);
    if (scope !== 'session') return { paths: scan(), error: '' };
    // session 模式：取会话 cwd 所在仓库
    const cwd = session?.header?.cwd || session?.header?.workspaceRoot;
    if (!cwd) return { paths: [], error: '会话无 cwd' };
    const top = runGit(['rev-parse', '--show-toplevel'], { cwd });
    if (top.status === 0 && top.stdout) {
      return { paths: [top.stdout.trim()], error: '' };
    }
    return { paths: [], error: `会话目录不在 git 仓库（${cwd}）` };
  }

  /** 对一个仓库执行带门禁的自动提交（复用 commitWithAudit：审计 blocker 拦截 + requirements + pushGate）。 */
  async function gateCommit(repoPath) {
    // commit+push 走 commit-push.js 的 commitWithAudit——完整门禁（L0 审计 / requirements /
    //   pushGate）与 git_commit_push 同源，绝不裸提交。审计 audit=true 强制开启（自动推送不因
    //   手动开关 auditEnabled=false 而绕过审计——交付门禁对自动通道更高）。
    // requirementsConfirmed=true：自动推送是用户「开启 autoPushEnabled」显式授权的自动化通道，
    //   不再要求 AI 回合内手动核对清单（那会破坏自动化）；门禁仍拦真实 blocker（token/敏感
    //   信息/语法错误）。pushConfirmed=true 同理（用户开开关即显式授权推送）。
    const { commitWithAudit } = await import('../commit-push.js');
    const message = cfg.autoPushMessage || 'chore(ai): 任务完成自动提交';
    return commitWithAudit({ repoPath, message, push: true, audit: true, requirementsConfirmed: true, pushGate: cfg.pushGate === true, pushConfirmed: true });
  }

  async function runAutoPush(session, turn, log2) {
    const targets = resolveTargets(session);
    if (!targets.paths.length) {
      const msg = `无推送目标: ${targets.error || '会话目录无变更仓库'}`;
      log2?.info?.(msg);
      return { trigger: true, ok: false, reason: msg };
    }
    const results = [];
    let committed = 0, pushed = 0;
    for (const repoPath of targets.paths) {
      const res = await gateCommit(repoPath);
      results.push({ repo: repoPath, ...res });
      if (res.ok) committed += 1;
      if (res.ok && res.push?.pushed) pushed += 1;
    }
    const summary = `自动推送完成: ${committed} 提交, ${pushed} 推送（目标 ${targets.paths.length}）`;
    const outcome = { trigger: true, ok: results.some((r) => r.ok), summary, results };
    onPushAfterCommit?.(outcome);
    log2?.info?.(summary);
    return outcome;
  }

  // 回合结束 → 防抖检查
  ctx?.on?.('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return;
    schedule(session, event);
  });

  ctx?.effect?.(() => () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }, 'git-push: auto-push timers');

  return { enabled: true, wired: true, trigger: trigger.toString() };
}