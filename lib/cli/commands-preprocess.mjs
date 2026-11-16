/**
 * CLI 命令 · 预处理域（从「所有在位 provider 的声明」里找能力并转发）。
 *
 * 为什么不是写死 `audit`：预处理是通用机制，审计只是第一个实现。
 *   本命令只做三件事：① 问 providers 层「谁声明了这个 action」 ② 找不到就说清有哪些可用
 *   ③ 找到就 spawn 那个 provider 的 CLI 并把退出码原样透传（脚本可判定失败）。
 *
 * HTTP 侧（/api/preprocess/<action>）用的是同一个查找函数（findActionProvider / findEndpointProvider），
 *   所以 CLI 与 HTTP 的能力面天然一致，不会一边有、一边没有。
 */
import { spawn } from 'node:child_process';

import { findActionProvider, listDeclaredCapabilities, resolveProvider } from '../preprocess/providers.js';

/**
 * 列出当前可用的预处理能力（供 help / 报错提示）。
 * @returns {Promise<string>} 多行文本
 */
export async function describePreprocessCapabilities() {
  const caps = await listDeclaredCapabilities();
  const lines = [];
  if (caps.actions.length === 0) {
    lines.push('当前没有任何在位 provider 声明 action（预处理扩展未安装）');
  } else {
    lines.push('可用预处理动作：');
    for (const action of caps.actions) {
      const params = Array.isArray(action.params) ? action.params.length : 0;
      lines.push(`  ${action.action}  [${action.provider}]  ${params} 个参数  ${action.desc || ''}`.trimEnd());
    }
  }
  for (const miss of caps.missing) {
    lines.push(`  · ${miss.provider.id} 不可用：${miss.reason}`);
  }
  return lines.join('\n');
}

/**
 * 执行一次预处理转发。
 * @param {string[]} positional 命令名之后的参数：第一个是 action，其余原样转发
 * @returns {Promise<number>} 退出码（0 成功 / 1 被拦 / 2 参数或执行错误）
 */
export async function cmdPreprocess(positional = []) {
  const [action, ...forwardArgs] = positional;
  if (!action) {
    console.error(await describePreprocessCapabilities());
    console.error('\n用法：preprocess <action> [参数…]');
    return 2;
  }
  const hit = await findActionProvider(action);
  if (!hit) {
    const caps = await listDeclaredCapabilities();
    const known = caps.actions.map((item) => item.action);
    console.error(`没有 provider 声明动作「${action}」${known.length ? `（可用：${known.join(' / ')}）` : '（当前没有任何 provider 在位）'}`);
    console.error(await describePreprocessCapabilities());
    return 2;
  }
  const resolved = resolveProvider(hit.provider.id);
  if (!resolved.ok) {
    console.error(resolved.error);
    return 2;
  }
  // 转发：provider 自己的 CLI 认得同样的 action 名（声明与实现同名，避免映射表漂移）
  const child = spawn(process.execPath, [resolved.path, action, ...forwardArgs], { stdio: 'inherit' });
  return await new Promise((resolvePromise) => {
    child.on('error', (error) => {
      console.error(`启动预处理实现失败：${error?.message || error}`);
      resolvePromise(2);
    });
    child.on('close', (code, signal) => {
      if (signal) { console.error(`预处理实现被信号中断：${signal}`); resolvePromise(2); return; }
      resolvePromise(typeof code === 'number' ? code : 2);
    });
  });
}
