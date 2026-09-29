/**
 * dsh-git-push — 任务完成自动推送 · 检测层（纯函数，可独立单测）
 *
 * 对应 task-completion-report skill 的硬性约定（集成定制）：
 *   AI 回复含「✅任务完成」→ 视为完成（= 自动推送授权信号）；
 *   ❌ 失败 / ⚠️ 未完成 → 明确不触发（阻断，宁可不动）。
 * 触发文本可在 UI 门禁开关旁自定义（autoPushTriggerPattern，正则字符串），
 * 默认「✅任务完成」（与通用 ✅ 相比更严格：只有明确写「任务完成」才算交付结束）。
 *
 * 本模块只做检测合成判断，不含 git 操作（git 在 auto-push.js）。
 */

/** 默认触发模式：回复含「✅任务完成」即视为完成（默认文案） */
export const DEFAULT_TRIGGER_TEXT = '✅任务完成';
export const DEFAULT_TRIGGER_PATTERN = /✅任务完成/;

/** 默认阻断模式：回复含失败/未完成标记时不触发 */
export const DEFAULT_BLOCK_PATTERN = /❌|⚠️\s*(未完成|失败)/;

/**
 * 从会话事件流提取最后一条 assistant 消息文本。
 * @param {Array} events - session.events（DSH 事件数组，assistant/message 类型含 data.message.content 块）
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
 * 把用户自定义触发文本编译成正则（默认「✅任务完成」）。
 * 只接受字符串；为空时回退默认。非法正则回退默认（不抛——自动推送不能因
 * 配置写错而崩溃）。
 * @param {string} [text] 自定义触发文本（支持正则语法，如 `✅(任务完成|已解答)`）
 * @returns {RegExp}
 */
export function compileTriggerPattern(text) {
  const raw = typeof text === 'string' && text.trim() ? text.trim() : DEFAULT_TRIGGER_TEXT;
  try {
    return new RegExp(raw);
  } catch {
    return DEFAULT_TRIGGER_PATTERN;
  }
}

/**
 * 检测一段 AI 回复文本是否构成「任务完成」（→ 可触发自动推送）。
 * @param {string} text - AI 回复全文
 * @param {object} [opts]
 * @param {RegExp} [opts.trigger] - 完成触发正则（默认 DEFAULT_TRIGGER_PATTERN）
 * @param {RegExp} [opts.block] - 阻断正则（默认 DEFAULT_BLOCK_PATTERN）
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
    return { completed: true, marker: 'done', reason: '回复含完成标记（✅任务完成）' };
  }
  return { completed: false, marker: 'none', reason: '回复无完成标记' };
}

/**
 * 是否应触发自动推送（检测 + 许可开关合成判断）。
 * @param {object} args
 * @param {string} args.text - AI 回复文本
 * @param {boolean} args.permitted - 自动推送许可开关（cfg.autoPushEnabled）
 * @param {object} [args.opts] - detectCompletion 选项
 */
export function shouldAutoPush({ text, permitted, opts } = {}) {
  const det = detectCompletion(text, opts);
  if (!det.completed) return { trigger: false, ...det };
  if (!permitted) {
    return { trigger: false, completed: true, marker: det.marker, reason: '回复含完成标记，但自动推送未开启（autoPushEnabled=false）' };
  }
  return { trigger: true, completed: true, marker: det.marker, reason: '回复含完成标记且自动推送开启，触发自动推送' };
}