/**
 * dsh-git-push — 任务完成自动推送测试
 * 覆盖：检测纯函数（完成/阻断/未标记/自定义正则/回退默认）+ 自动推送门禁调用链。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCompletion,
  shouldAutoPush,
  compileTriggerPattern,
  extractLastAssistantText,
  DEFAULT_TRIGGER_TEXT,
  DEFAULT_TRIGGER_PATTERN,
} from '../lib/plugin/auto-detect.js';

test('默认触发文本 = 「✅任务完成」', () => {
  assert.equal(DEFAULT_TRIGGER_TEXT, '✅任务完成');
  assert.equal(DEFAULT_TRIGGER_PATTERN.toString(), '/✅任务完成/');
});

test('detectCompletion：含「✅任务完成」→ done', () => {
  const r = detectCompletion('已完成，提交了 X。✅任务完成（项目：test）');
  assert.equal(r.completed, true);
  assert.equal(r.marker, 'done');
});

test('detectCompletion：含 ❌/⚠️ 失败 → blocked（优先于完成标记）', () => {
  const r = detectCompletion('出错了 ❌ 任务未完成，先不提交');
  assert.equal(r.completed, false);
  assert.equal(r.marker, 'blocked');
});

test('detectCompletion：无标记 → none', () => {
  assert.equal(detectCompletion('这是正常回复').marker, 'none');
  assert.equal(detectCompletion('').marker, 'none');
  assert.equal(detectCompletion('   ').marker, 'none');
});

test('shouldAutoPush：许可开关门控（含完成标记但未开启 → 不触发）', () => {
  const on = shouldAutoPush({ text: '✅任务完成', permitted: true });
  const off = shouldAutoPush({ text: '✅任务完成', permitted: false });
  assert.equal(on.trigger, true);
  assert.equal(off.trigger, false);
  assert.match(off.reason, /autoPushEnabled=false/);
});

test('compileTriggerPattern：自定义正则生效', () => {
  const re = compileTriggerPattern('✅(任务完成|已解答)');
  assert.equal(re.test('已完成 ✅已解答'), true);
  assert.equal(re.test('已完成 ✅任务完成'), true);
  assert.equal(re.test('普通回复'), false);
});

test('compileTriggerPattern：空白/非法回退默认', () => {
  assert.equal(compileTriggerPattern('   ').toString(), DEFAULT_TRIGGER_PATTERN.toString());
  assert.equal(compileTriggerPattern('[').toString(), DEFAULT_TRIGGER_PATTERN.toString());
});

test('extractLastAssistantText：取最后一条 assistant 文本', () => {
  const events = [
    { type: 'user/message', data: { message: { content: [{ type: 'text', text: '用户消息' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第一步' }] } } },
    { type: 'tool/message', data: { message: { content: [{ type: 'text', text: '工具输出' }] } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '最终 ✅任务完成' }] } } },
  ];
  assert.equal(extractLastAssistantText(events), '最终 ✅任务完成');
  assert.equal(extractLastAssistantText([]), '');
  assert.equal(extractLastAssistantText(null), '');
  assert.equal(extractLastAssistantText([{ type: 'x' }]), '');
});

// —— 门禁调用链：自动推送走 commitWithAudit，绝不绕过门禁 ——

test('registerAutoPush：关闭时返回 enabled:false 且不注册 session/event 监听', async () => {
  const { registerAutoPush } = await import('../lib/plugin/auto-push.js');
  const onCalls = []; const effectCleanup = [];
  const ctx = {
    get: () => undefined,
    on: (ev, fn) => onCalls.push([ev, fn]),
    effect: (fn) => effectCleanup.push(fn),
  };
  const r = registerAutoPush(ctx, { cfg: { autoPushEnabled: false } });
  assert.equal(r.enabled, false);
  assert.equal(r.wired, false);
  assert.equal(onCalls.length, 0, '关闭时不应注册 session/event 监听');
  assert.equal(effectCleanup.length, 0, '关闭时不应注册 timer 清理');
});

test('registerAutoPush：开启时注册 session/event 监听 + timer 清理 effect', async () => {
  const { registerAutoPush } = await import('../lib/plugin/auto-push.js');
  const onCalls = []; const effectCleanup = [];
  const ctx = {
    get: () => undefined,
    on: (ev, fn) => onCalls.push([ev, fn]),
    effect: (fn) => effectCleanup.push(fn),
  };
  const r = registerAutoPush(ctx, { cfg: { autoPushEnabled: true } });
  assert.equal(r.enabled, true);
  assert.equal(r.wired, true);
  assert.ok(onCalls.some(([ev]) => ev === 'session/event'), '应注册 session/event 监听');
  assert.equal(effectCleanup.length, 1, '应注册 timer 清理 effect');
  assert.match(r.trigger, /✅任务完成/);
});

test('registerAutoPush：开启且自定义触发正则生效', async () => {
  const { registerAutoPush } = await import('../lib/plugin/auto-push.js');
  const ctx = {
    get: () => undefined,
    on: () => {},
    effect: () => () => {},
  };
  const r = registerAutoPush(ctx, { cfg: { autoPushEnabled: true, autoPushTriggerText: '✅(任务完成|已解答)' } });
  assert.ok(/任务完成\|已解答/.test(r.trigger), `trigger 应为自定义正则, got ${r.trigger}`);
});

test('compileTriggerPattern 是 auto-push 的触发源（组合检测）', () => {
  const text = '完成了，推送吧 ✅任务完成';
  const trigger = compileTriggerPattern('✅任务完成');
  const r = shouldAutoPush({ text, permitted: true, opts: { trigger } });
  assert.equal(r.trigger, true);
});