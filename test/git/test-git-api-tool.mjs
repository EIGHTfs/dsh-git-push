#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * git_api 工具回归测试（2026-10-11 新增）
 *
 * 背景：本插件有 28 条 HTTP API，但此前**没有**任何 agent 工具能直接调它们
 *   （16 个工具全是语义化工具：git_scan / code_audit / …）。新增 `git_api` 后：
 *   · 不传 path ⇒ 列出全部接口（从分发器 case 现读，即路由真相）；
 *   · 传 path ⇒ 内部走 `handleHttp` ——**与浏览器/CLI 同一条代码路径**（不另写一份实现，
 *     避免"工具版与 HTTP 版行为分叉"）。
 * 用法：node test/test-git-api-tool.mjs（退出码 0 = 通过）
 */
import { callTool } from '../../lib/app/tool-call.js';
import { listTools } from '../../lib/app/tools.js';

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  ✅ ' + name);
  else { failed++; console.log('  ❌ ' + name + (extra ? ' —— ' + extra : '')); }
};

console.log('git_api 工具回归');

// ── ① 工具已在注册表里（单一规则源：TOOL_REGISTRY）──
const names = listTools().map((t) => t.name);
ok('git_api 已注册进工具清单', names.includes('git_api'), '实际: ' + names.join(','));
const spec = listTools().find((t) => t.name === 'git_api');
// listTools 的出口字段是 parameters（由注册表 params 经 resolveEntryParams 求值而来）；
//   这里不再写 spec.params 兜底——那个字段在工具 schema 上根本不存在，写它会让断言失去意义。
ok('git_api 的 parameters 含 path/method/query/body', !!spec && ['path', 'method', 'query', 'body'].every((k) => k in (spec.parameters || {})));

// ── ② 不传 path ⇒ 列出全部接口（口径 = 分发器 case，即路由真相）──
const listed = await callTool('git_api', {});
ok('不传 path 返回接口清单', listed.ok === true && Array.isArray(listed.endpoints));
// 不硬编码条数：从分发器源码里数真实 case 数作为期望值（增删端点时该断言自动跟上，
//   硬编码 36 会让「新增一条路由」变成假红——2026-11-14 加 npm-install-progress 时就这样红过一次）
const { readFileSync } = await import('node:fs');
const handlersSrc = readFileSync(new URL('../../lib/app/http-handlers.js', import.meta.url), 'utf8');
const realCaseCount = (handlersSrc.match(/case '\/api\/git-push\//g) || []).length;
ok('接口数与分发器一致', listed.count === realCaseCount,
  `清单 ${listed.count} 条 vs 分发器 ${realCaseCount} 个 case`);
ok('清单里含 status / settings-set / repo-push', ['status', 'settings-set', 'repo-push'].every((e) => listed.endpoints.includes(e)));

// ── ③ 传 path ⇒ 真调通（内部 handleHttp，读接口免 Origin）──
const status = await callTool('git_api', { path: 'status' });
ok('path=status 调通且 HTTP 200', status.ok === true && status.status === 200, 'status=' + status.status);
ok('返回真实业务字段（plugin/version）', !!(status.result && status.result.plugin && status.result.version), JSON.stringify(status.result || {}).slice(0, 80));

// ── ④ 只读接口带 query 也能传（口径：URLSearchParams）──
const slots = await callTool('git_api', { path: 'rule-slots' });
ok('path=rule-slots 调通', slots.ok === true && slots.status === 200, 'status=' + slots.status);

// ── ⑤ 坏 JSON 要报错而不是静默 ──
const bad = await callTool('git_api', { path: 'status', query: '{不是JSON' });
ok('query 非法 JSON 时明确报错', bad.ok === false && /JSON/.test(String(bad.error)), JSON.stringify(bad).slice(0, 80));

console.log(failed === 0 ? '\n结果: 全部通过' : `\n结果: ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
