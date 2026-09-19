/**
 * 上下文注入自检脚本（2026-09-20，配合 1.5.2 工具探测改上下文注入）
 *
 * 真实调用 apply() 并触发 agent/pre-step，验证环境信息按上下文注入：
 *   - 工作区跑：验证接线正确 + 无 DSH 依赖时降级不崩（@deepseek-ai/dsh-llm 解析不到 → 注入跳过）
 *   - 安装副本跑（profiles/.../node_modules/dsh-git-push）：完整验证注入 user 消息
 *     （工作区目录 + 工具安装路径（实测）+ skill 总入口，source 标记 plugin instructions）
 *
 * 用法：node scripts/verify-prestep.mjs
 * 退出码：0 = 接线与（可注入时）注入全部符合预期；1 = 断言失败
 */
import { apply } from '../lib/app/apply.js';
import { setDefineToolOverride } from '../lib/plugin/index.js';

/** 简易断言计数（不引测试框架）。 */
const results = [];
function check(name, ok) { results.push([name, !!ok]); if (!ok) console.log('  ❌', name); }

// 1) defineTool 喂 mock（工作区无 DSH 依赖；安装副本同样可喂）
setDefineToolOverride((spec) => spec);

// 2) mock DSH ctx：tools/systemPrompt/webServer 服务 + agent/pre-step 事件捕获
const sections = [];
const events = {};
const registered = [];
const ctx = {
  get: (k) => (k === 'log' ? { info: () => {}, warn: (...a) => console.log('  [warn]', ...a) } : undefined),
  inject: (keys, fn) => {
    if (keys[0] === 'tools') fn({ get: (k) => (k === 'tools' ? { register: (t) => registered.push(t) } : undefined) });
    if (keys[0] === 'systemPrompt') fn({ get: (k) => (k === 'systemPrompt' ? { section: (s) => sections.push(s) } : undefined) });
    if (keys[0] === 'webServer') fn({ get: (k) => (k === 'webServer' ? { register: () => {} } : undefined) });
  },
  on: (name, handler) => { events[name] = handler; },
};

// 3) 真实调用 apply
await apply(ctx, { workspaceRoot: process.cwd() });
setDefineToolOverride(null);

console.log('== 注册统计 ==');
console.log('systemPrompt sections:', sections.map((s) => s.name).join(', ') || '(空)');
console.log('agent/pre-step 接线:', typeof events['agent/pre-step'] === 'function' ? '✅ 是' : '❌ 否');
console.log('工具注册数:', registered.length);

// 环境段不应再注册为 systemPrompt section（2026-09-20 迁出）
check('systemPrompt 不含环境段（dsh-git-push-env 已迁出）', !sections.some((s) => s.name === 'dsh-git-push-env'));
check('systemPrompt 保留功能用法段', sections.some((s) => s.name === 'dsh-git-push-usage'));
check('agent/pre-step 已接线', typeof events['agent/pre-step'] === 'function');
check('工具已注册', registered.length >= 8);

if (typeof events['agent/pre-step'] !== 'function') {
  console.log('\n❌ 未接线，退出（exit 1）');
  process.exit(1);
}

// 4) 构造「首次 step」decision 并触发 pre-step
const decision = {
  kind: 'next',
  messages: [{ role: 'user', content: [{ type: 'text', text: '（原有消息）' }] }],
};
const agent = { id: 'verify-agent-1', session: { id: 'verify-session' } };
const first = await events['agent/pre-step']({ agent, signal: undefined }, async () => decision);
const count1 = first.messages.length;
const injected = count1 > 1 ? first.messages[count1 - 1] : null;

console.log('\n== 首次触发 ==');
check('首次触发追加 1 条注入消息', count1 === 2);
if (injected) {
  check('注入消息 role=user', injected.role === 'user');
  check('注入消息 source 标记（plugin/dsh-git-push/instructions）',
    injected.source?.kind === 'plugin' && injected.source?.plugin === 'dsh-git-push' && injected.source?.form === 'instructions');
}

// 5) 再次触发同一 agent：WeakSet 防重复，不应再追加
const second = await events['agent/pre-step']({ agent, signal: undefined }, async () => decision);
check('二次触发不重复注入（回到原 1 条）', second.messages.length === 1);

// 6) 注入正文内容校验（注入成功时）
if (injected) {
  const text = injected.content?.[0]?.text || '';
  console.log('\n== 注入上下文正文 ==\n----------------------------------------');
  console.log(text);
  console.log('----------------------------------------');
  check('含工作区根目录', /工作区根目录/.test(text));
  check('含当前工作目录 cwd', /当前工作目录 cwd/.test(text));
  check('含工具安装路径', /工具：/.test(text));
  check('含 git 实测路径', /git=/.test(text));
  check('含 skill 总入口', /skills/.test(text));
} else {
  console.log('\n（未注入：当前运行环境无 @deepseek-ai/dsh-llm 依赖，属预期降级；')
  console.log('  在安装副本 profiles/.../node_modules/dsh-git-push 下运行可完整验证注入）');
}

// 7) 汇总
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n== 结果：${results.length - failed}/${results.length} 通过 ==`);
process.exit(failed ? 1 : 0);
