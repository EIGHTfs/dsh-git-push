/**
 * dsh-git-push — AI 回复推送许可（v1.24.0 整合 dsh-task-completion）
 *
 * 语义（沿用 task-completion-report skill）：
 *   AI 回复输出 ✅（任务完成/已解答）→ 视为完成（= 提交推送授权意向）；
 *   ❌ 失败 / ⚠️ 未完成 → 明确不触发。
 *
 * 推送许可（pushOnComplete，默认 false）：
 *   关闭（默认）→ 只记录 lastAttempt，绝不自动推送；
 *   开启 → 回合结束检测到 ✅ 时，对扫描范围内有变更的仓库逐个走**带审计门禁**的提交推送
 *         （dsh-git-push commitWithAudit：L0 审计 + 敏感扫描 + npm ignore + ahead/behind 检查）。
 *
 * 与 dsh-task-completion（EIGHTfs/dsh-task-completion，已下线）的差异，逐条避坑：
 *   1. 不复刻无审计的 lib/git.js 复制实现——自动推送一律走 commitWithAudit
 *   2. 不引入 storage-domain 新依赖——状态用 JSON 文件持久化（{workspaceRoot}/.dsh/git-push-permit.json）
 *   3. 触发检测保持「❌/⚠️ 优先于 ✅」的保守方向
 * 本文件只含纯函数 + 状态读写（可独立单测，不依赖 ctx）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 默认触发模式：回复含 ✅ 即视为完成 */
export const DEFAULT_TRIGGER_PATTERN = /✅/;

/** 默认阻断模式：回复含失败/未完成标记时不触发（❌/⚠️ 优先于 ✅） */
export const DEFAULT_BLOCK_PATTERN = /❌|⚠️\s*(未完成|失败)/;

/** 默认推送许可状态 */
export const DEFAULT_PERMIT = {
  pushOnComplete: false,
  pushScope: 'all',
  lastAttempt: null,
  lastAutoPush: null,
};

/**
 * 从会话事件流提取最后一条 assistant 消息文本（同 dsh-task-completion detect.js 已验证结构）。
 * @param {Array} events - session.events
 * @returns {string} 最后一条非空 assistant 文本；无则 ''
 */
export function extractLastAssistantText(events) {
  if (!Array.isArray(events)) return '';
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type !== 'assistant/message') continue;
    const content = event.data?.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((block) => block?.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');
    if (text.trim()) return text;
  }
  return '';
}

/**
 * 检测一段 AI 回复文本是否构成「任务完成」（→ 可触发自动推送）。
 * @returns {{completed: boolean, marker: 'done'|'blocked'|'none', reason: string}}
 */
export function detectCompletion(text, { trigger = DEFAULT_TRIGGER_PATTERN, block = DEFAULT_BLOCK_PATTERN } = {}) {
  if (!text || !text.trim()) {
    return { completed: false, marker: 'none', reason: '无回复文本' };
  }
  if (block.test(text)) {
    return { completed: false, marker: 'blocked', reason: '回复含失败/未完成标记，不触发' };
  }
  if (trigger.test(text)) {
    return { completed: true, marker: 'done', reason: '回复含完成标记（✅）' };
  }
  return { completed: false, marker: 'none', reason: '回复无完成标记' };
}

/**
 * 检测 + 许可开关合成判断：是否应触发自动推送。
 * @param {object} args { text, permitted, opts? }
 * @returns {{trigger: boolean, completed: boolean, marker, reason}}
 */
export function shouldAutoPush({ text, permitted, opts } = {}) {
  const det = detectCompletion(text, opts);
  if (!det.completed) return { trigger: false, ...det };
  if (!permitted) {
    return { trigger: false, completed: true, marker: det.marker, reason: '回复含完成标记，但推送许可未开启（pushOnComplete=false）' };
  }
  return { trigger: true, completed: true, marker: det.marker, reason: '回复含完成标记且推送许可开启，触发自动推送' };
}

/* ------------------------------ 状态持久化（JSON 文件，零新依赖） ------------------------------ */

/**
 * 许可状态文件路径：{workspaceRoot}/.dsh/git-push-permit.json。
 * workspaceRoot 的 .dsh 目录是 DSH 运行配置目录，归属自然；文件缺失即默认关闭。
 */
export function permitFilePath(workspaceRoot) {
  return join(workspaceRoot || '.', '.dsh', 'git-push-permit.json');
}

/** 读取许可状态（文件缺失/损坏 → 默认值，绝不抛）。 */
export function readPermit(workspaceRoot) {
  const file = permitFilePath(workspaceRoot);
  try {
    if (!existsSync(file)) return { ...DEFAULT_PERMIT };
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { ...DEFAULT_PERMIT, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_PERMIT };
  }
}

/** 写许可状态（原子：先写 tmp 再 rename；父目录缺失自动创建）。 */
export function writePermit(workspaceRoot, patch) {
  const file = permitFilePath(workspaceRoot);
  try {
    const next = { ...readPermit(workspaceRoot), ...patch, updatedAt: new Date().toISOString() };
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    renameSync(tmp, file);
    return { ok: true, state: next };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 设置推送许可开关；同时清空历史记录。 */
export function setPermit(workspaceRoot, enabled, { pushScope } = {}) {
  return writePermit(workspaceRoot, {
    pushOnComplete: !!enabled,
    lastAttempt: null,
    lastAutoPush: null,
    ...(pushScope ? { pushScope } : {}),
  });
}