/**
 * dsh-git-push — 推送许可自动触发（v1.24.0，v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * 语义：AI 回复含 ✅ 且许可开启（pushOnComplete=true）→ 回合结束对扫描范围内有变更的仓库
 * 逐个走 commitWithAudit（带审计门禁）——不复刻旧插件的无审计旁路。默认关闭，绝不自动推。
 */
import { scanRepos, runGit } from './core.js';
import { extractLastAssistantText, shouldAutoPush, readPermit, writePermit } from './permit.js';

/** 创建推送许可服务：返回 { schedulePermitCheck, runPermitCheck, dispose }。 */
export function createPushPermit(env, { commitWithAudit }) {
  const { log, workspaceRoot, depth, extraRepos, extraReposFile, permitCommitMessage, pushScopeCfg } = env;
  let autoPushRunning = false; // 并发闸：同时只跑一个自动推送
  const permitLastTurns = new Map(); // sessionId -> 已处理 turn（去重）
  const permitTimers = new Map(); // sessionId -> 防抖 timer

  function schedulePermitCheck(session, event) {
    const sessionId = session?.id;
    if (typeof sessionId !== 'string') return;
    const turn = event?.data?.turn ?? 0;
    if (permitLastTurns.get(sessionId) === turn) return;
    const existing = permitTimers.get(sessionId);
    if (existing !== void 0) clearTimeout(existing);
    const timer = setTimeout(() => {
      permitTimers.delete(sessionId);
      runPermitCheck(session, turn).catch((error) => {
        log.warn(`推送许可检查失败 ${sessionId}: ${String(error?.message ?? error)}`);
      });
    }, 800); // 等回合收尾事件落盘
    timer.unref?.();
    permitTimers.set(sessionId, timer);
  }

  /** 一次回合结束检查：检测完成标记 → 许可开启则逐个仓库走带审计的自动推送。 */
  async function runPermitCheck(session, turn) {
    const sessionId = session?.id;
    const state = readPermit(workspaceRoot);
    const text = extractLastAssistantText(session?.events);
    const decision = shouldAutoPush({ text, permitted: state.pushOnComplete });
    writePermit(workspaceRoot, {
      lastAttempt: {
        at: new Date().toISOString(),
        sessionId,
        turn,
        trigger: decision.trigger,
        marker: decision.marker ?? 'none',
        reason: decision.reason,
      },
    });
    permitLastTurns.set(sessionId, turn);
    if (!decision.trigger) {
      log.info(`回合 ${turn} 不触发自动推送: ${decision.reason}`);
      return { trigger: false, reason: decision.reason };
    }
    log.info(`回合 ${turn} 触发自动推送（许可开启，pushScope=${state.pushScope}）`);
    return runPermitAutoPush(session, turn, state);
  }

  /** 实际执行：解析目标仓库 → 逐个 commitWithAudit（审计拦截/失败逐仓记录，不静默）。 */
  async function runPermitAutoPush(session, turn, state) {
    if (autoPushRunning) {
      return { trigger: true, ok: false, reason: '已有自动推送在进行，跳过本次' };
    }
    autoPushRunning = true;
    try {
      const targets = resolvePermitTargets(state.pushScope, session);
      if (targets.error) {
        const msg = `无推送目标: ${targets.error}`;
        log.info(msg);
        return { trigger: true, ok: false, reason: msg };
      }
      const results = [];
      let committed = 0;
      let pushed = 0;
      for (const repoPath of targets.paths) {
        const res = await commitWithAudit({
          repo: repoPath, message: permitCommitMessage, push: true, audit: true, showReadme: false, customIgnorePatterns: env.customIgnorePatterns,
        });
        results.push({
          repo: repoPath,
          ok: !!res.ok,
          committed: !!res.committed,
          pushed: !!res.push?.pushed,
          blocked: !!res.blocked,
          error: res.error || '',
        });
        if (res.ok && res.committed) committed += 1;
        if (res.ok && res.push?.pushed) pushed += 1;
      }
      const summary = `自动推送完成: ${committed} 个仓库提交, ${pushed} 个仓库推送`;
      const current = readPermit(workspaceRoot);
      writePermit(workspaceRoot, {
        ...current,
        lastAutoPush: {
          at: new Date().toISOString(),
          sessionId: session?.id,
          turn,
          summary,
          results,
        },
      });
      log.info(summary);
      return { trigger: true, ok: true, summary, results };
    } finally {
      autoPushRunning = false;
    }
  }

  /** 计算本次自动推送的目标仓库路径列表（pushScope=all → 全部有变更；session → 仅会话 cwd 所在仓库）。 */
  function resolvePermitTargets(pushScope, session) {
    const allChanged = () => scanRepos({ root: workspaceRoot, depth, extraRepos, extraReposFile })
      .filter((r) => r.changes > 0)
      .map((r) => r.path);
    if (pushScope !== 'session') return { paths: allChanged(), error: '' };
    const cwd = session?.header?.cwd;
    if (!cwd) return { paths: [], error: '会话无 cwd' };
    const top = runGit(['rev-parse', '--show-toplevel'], cwd);
    if (top.status === 0 && top.stdout) return { paths: [top.stdout], error: '' };
    const repos = scanRepos({ root: workspaceRoot, depth, extraRepos, extraReposFile });
    const matched = repos.filter((r) => cwd === r.path || cwd.startsWith(r.path + '/'));
    if (matched.length === 0) {
      return { paths: [], error: `会话目录不在任何 git 仓库（${cwd}）` };
    }
    return { paths: matched.map((r) => r.path), error: '' };
  }

  function registerSessionListener(ctx) {
    ctx.on('session/event', (session, event) => {
      if (event?.type !== 'turn/end') return;
      schedulePermitCheck(session, event);
    });
    ctx.effect(() => {
      return () => {
        for (const timer of permitTimers.values()) clearTimeout(timer);
        permitTimers.clear();
      };
    }, 'git-push: permit timers');
  }

  return { schedulePermitCheck, runPermitCheck, registerSessionListener };
}
