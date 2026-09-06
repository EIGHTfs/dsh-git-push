/** dsh-skip-sensitive dsh-git-push 推送许可单测（v1.24.0，纯函数 + JSON 文件持久化） */
import {
  extractLastAssistantText,
  detectCompletion,
  shouldAutoPush,
  readPermit,
  writePermit,
  setPermit,
  permitFilePath,
  DEFAULT_PERMIT,
} from '../lib/permit.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

const root = mkdtempSync(join(tmpdir(), 'git-push-permit-'));
try {
  // ---------- extractLastAssistantText ----------
  const textEvent = (text, seq) => ({ type: 'assistant/message', seq, data: { message: { content: [{ type: 'text', text }] } } });
  ok(extractLastAssistantText([textEvent('hello', 1)]) === 'hello', '提取单条 assistant 文本');
  ok(extractLastAssistantText([textEvent('a', 1), textEvent('b', 2)]) === 'b', '取最后一条');
  ok(extractLastAssistantText([textEvent('a', 1), { type: 'turn/end', seq: 2 }]) === 'a', '忽略非 assistant 事件');
  ok(extractLastAssistantText(undefined) === '' && extractLastAssistantText([]) === '', '空输入返回空串');

  // ---------- detectCompletion ----------
  ok(detectCompletion('✅ 任务完成').completed === true, '✅ 任务完成 → completed');
  ok(detectCompletion('✅ 已解答').completed === true, '✅ 已解答 → completed');
  ok(detectCompletion('❌ 失败').completed === false, '❌ → 不完成');
  ok(detectCompletion('⚠️ 未完成').completed === false, '⚠️ 未完成 → 不完成');
  ok(detectCompletion('❌ 部分失败，但有 ✅ 任务完成').completed === false, '❌ 优先于 ✅（阻断）');
  ok(detectCompletion('正常回复').completed === false, '无标记 → 不完成');
  ok(detectCompletion('  ').completed === false, '空白 → 不完成');
  ok(detectCompletion('✅ 任务完成', { trigger: /完成/ }).completed === true, '自定义 trigger 生效');

  // ---------- shouldAutoPush ----------
  ok(shouldAutoPush({ text: '✅ 任务完成', permitted: true }).trigger === true, '许可开 + ✅ → 触发');
  ok(shouldAutoPush({ text: '✅ 任务完成', permitted: false }).trigger === false, '许可关 + ✅ → 不触发');
  const denied = shouldAutoPush({ text: '✅ 任务完成', permitted: false });
  ok(denied.reason.includes('许可'), '许可关时 reason 说明许可未开启');
  ok(shouldAutoPush({ text: '❌ 失败', permitted: true }).trigger === false, '❌ 即使许可开也不触发');
  ok(shouldAutoPush({ text: '普通回复', permitted: true }).trigger === false, '无标记不触发');
  ok(shouldAutoPush({ text: '', permitted: true }).trigger === false, '空文本不触发');

  // ---------- 状态持久化 ----------
  ok(permitFilePath(root).endsWith(join('.dsh', 'git-push-permit.json')), '状态文件路径落 .dsh/git-push-permit.json');
  const init = readPermit(root);
  ok(init.pushOnComplete === false && init.pushScope === 'all', '默认关闭、scope=all');
  ok(readPermit(join(root, 'no-such-dir'))?.pushOnComplete === false, '目录不存在返回默认');

  const w1 = writePermit(root, { lastAttempt: { at: '2026-09-06T00:00:00Z', sessionId: 's1', turn: 1, trigger: false, marker: 'none', reason: '测试' } });
  ok(w1.ok === true && w1.state.lastAttempt?.reason === '测试', 'writePermit 写状态成功');
  ok(readPermit(root).lastAttempt?.sessionId === 's1', 'readPermit 读回持久化状态');

  const s1 = setPermit(root, true);
  ok(s1.ok && s1.state.pushOnComplete === true, 'setPermit 开启许可');
  ok(readPermit(root).pushOnComplete === true && readPermit(root).lastAttempt === null, '开启后历史记录清空');
  ok(readPermit(root).pushScope === 'all', 'scope 保持默认');

  const s2 = setPermit(root, false, { pushScope: 'session' });
  ok(s2.ok && s2.state.pushOnComplete === false && s2.state.pushScope === 'session', 'setPermit 关闭 + 改 scope');

  // 损坏文件回退默认（不抛）
  mkdirSync(join(root, '.dsh'), { recursive: true });
  writeFileSync(join(root, '.dsh', 'git-push-permit.json'), '{broken json', 'utf8');
  ok(readPermit(root).pushOnComplete === false, '损坏 JSON 回退默认不抛');

  // DEFAULT_PERMIT 是纯净默认（不被上次写污染）
  ok(DEFAULT_PERMIT.pushOnComplete === false, 'DEFAULT_PERMIT 恒定默认');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);