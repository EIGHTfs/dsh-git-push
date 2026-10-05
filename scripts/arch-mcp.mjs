#!/usr/bin/env node
// MCP server（stdio 传输，零依赖手写 JSON-RPC 2.0）——把本插件的**事实导出**能力暴露给任意 MCP 客户端。
//
// 为什么要 MCP：DSH 自身是 MCP 客户端（packages/mcp/mcp-client，支持 stdio 传输），
//   而 MCP 是跨 agent 的通用协议——Claude Desktop / Cursor / 其它 agent 都能直接接上。
//   这样「事实导出」不只服务本插件，而是成为可被任意 agent 调用的事实源。
//
// 设计红线（与架构图同一条）：**只导出事实，不编拓扑**。工具返回的每个模块/边都能反查到真实文件。
//
// 用法（stdio，客户端会自己拉起）：
//   node scripts/arch-mcp.mjs
// 手动自测：
//   printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node scripts/arch-mcp.mjs
import { createInterface } from 'node:readline';

import { extractArchFacts } from '../lib/arch/extract.js';

const SERVER_INFO = { name: 'dsh-git-push-arch', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

// 暴露的工具（全部是**事实导出**，不接受任何「让 AI 决定拓扑」的参数）
const TOOLS = [
  {
    name: 'arch_facts',
    description: '提取仓库架构事实（模块/文件/函数/复杂度/依赖边）。只导出代码里已存在的事实，不生成拓扑。',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', description: '仓库绝对路径' },
        maxFiles: { type: 'integer', description: '最多扫描文件数（大仓库限流用）' },
      },
      required: ['repoPath'],
    },
  },
  {
    name: 'arch_modules',
    description: '只列模块清单与每个模块的事实（文件数/函数数/最大复杂度/最长函数），不含依赖边。',
    inputSchema: {
      type: 'object',
      properties: { repoPath: { type: 'string', description: '仓库绝对路径' } },
      required: ['repoPath'],
    },
  },
];

/** 把工具调用结果包成 MCP 的 content 结构（文本形式返回 JSON）。 */
function textResult(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

/** 处理一个 JSON-RPC 请求，返回响应对象（通知类请求返回 null）。 */
async function handleRequest(req) {
  const { id, method, params } = req || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (method === 'initialize') {
    return ok({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method === 'notifications/initialized') return null; // 通知无需响应
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `未知工具：${name}`);
    if (!args.repoPath) return fail(-32602, '缺少必填参数 repoPath');
    const facts = await extractArchFacts(args.repoPath, { maxFiles: args.maxFiles || 4000 });
    if (name === 'arch_modules') return ok(textResult({ sourceRoot: facts.sourceRoot, modules: facts.modules, totals: facts.totals }));
    return ok(textResult(facts));
  }
  return fail(-32601, `不支持的方法：${method}`);
}

function main() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const text = String(line || '').trim();
    if (!text) return;
    let req;
    try { req = JSON.parse(text); } catch { return; } // 非法行直接忽略（MCP 客户端可能发心跳）
    handleRequest(req)
      .then((res) => { if (res) process.stdout.write(`${JSON.stringify(res)}\n`); })
      .catch((e) => {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32603, message: String(e?.message || e) } })}\n`);
      });
  });
}

if (process.argv[1] && process.argv[1].endsWith('arch-mcp.mjs')) main();
