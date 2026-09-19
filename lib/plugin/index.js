/**
 * dsh-git-push — Host 侧接线层（插件注册到 DSH）
 *
 * ⚠️ 本文件的 API 形状**全部对照运行中的真实插件**抄写，禁止凭印象改：
 *
 *   工具注册：
 *     ctx.inject(['tools'], (tctx) => {
 *       const tools = tctx.get('tools');
 *       if (!tools) return;
 *       tools.register(defineTool({ name, description, parameters, output, execute }));
 *     });
 *     工具形状 = { name, description, parameters: { k: { type, description } },
 *                  output: { schema: { type: 'string' }, render }, execute }
 *     · execute 返回**字符串**（通常 JSON.stringify）
 *     · output.render **必须返回块数组** [{ type: 'text', text }]——tool-result 的
 *       block.content 落盘后要求为数组，返回裸字符串会损坏会话日志
 *     · parameters 无 required 标注（必填项在 description 里写明 + execute 内校验）
 *
 *   系统提示词注入：
 *     ctx.inject(['systemPrompt'], (sctx) => {
 *       sctx.get('systemPrompt').section({ name, order, text: () => '同步文本' });
 *     });
 *     · **callback 的返回值不是注册**——必须在 callback 体内调用 section()
 *     · text 必须同步（async 会让模型看到 "[object Promise]"）
 *
 *   HTTP 注册：
 *     ctx.inject(['webServer'], (wctx) => {
 *       wctx.get('webServer').register({ kind: 'prefix', path: '/api/git-push', handler });
 *     });
 *
 *   斜杠命令（用户输入框 /git-audit）：
 *     ctx.inject(['commands'], (cctx) => {
 *       (cctx.commands || cctx.get('commands')).register({ name, description, input, handler });
 *     });
 *     · name 小写，无前导斜杠；handler 返回 { kind:'success'|'error', text }
 *     · 结果只给 UI，不进模型历史
 *
 *   客户端（设置侧边栏 / 插件配置卡）：
 *     **不在这里注册**——DSH 依据 package.json 的 dsh.client + exports["./client"]
 *     自动发现浏览器半侧（见 @deepseek-ai/dsh-client-ui-settings 系列）。
 *
 * 本模块只做「接线」：把 listTools() / callTool() / handleHttp() 挂到 DSH 服务上，
 * 不含业务逻辑，便于用 mock ctx 单测「真 API 是否被调用」。
 */

/**
 * 统一的工具结果渲染器：返回**块数组**（硬约定，见文件头说明）。
 * @param {object} _args
 * @param {unknown} value
 * @returns {Array<{type:string,text:string}>}
 */
export function textRender(_args, value) {
  return [{ type: 'text', text: String(value) }];
}

/**
 * 把简写参数 spec（`{ repo: 'string' }`）规范成 DSH 参数形状（`{ repo: { type, description } }`）。
 * 两种写法都接受：简写字符串（末尾 `?` 仅作提示，不产生 required）与完整对象。
 * @param {Record<string, string|object>} [parameters]
 * @returns {Record<string, {type:string, description:string}>}
 */
export function normalizeParameters(parameters = {}) {
  const out = {};
  for (const [key, spec] of Object.entries(parameters || {})) {
    if (spec && typeof spec === 'object') {
      out[key] = { type: String(spec.type || 'string'), description: String(spec.description || '') };
    } else {
      const raw = String(spec || 'string');
      out[key] = { type: raw.replace(/\?$/, '') || 'string', description: '' };
    }
  }
  return out;
}

/**
 * 把 listTools() 的声明 + callTool 分发器组装成 defineTool 需要的完整规格。
 * @param {Array<{name:string,description:string,parameters?:object}>} tools
 * @param {(name:string,args:object)=>Promise<unknown>} invoke
 * @returns {Array<object>} defineTool 规格数组
 */
export function buildToolSpecs(tools = [], invoke) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: normalizeParameters(tool.parameters),
    output: { schema: { type: 'string' }, render: textRender },
    execute: async (args, exec) => {
      // 2026-09-15：透传 exec 给 invoke（宿主在 execute(args, exec) 注入 exec.agent 等上下文）——
      //   调用方（callTool）需要 exec.agent 作为 jobs.start 的 owner，控制器才能放行该任务。
      const toolOut = await invoke(tool.name, args || {}, exec);
      return typeof toolOut === 'string' ? toolOut : JSON.stringify(toolOut, null, 2);
    },
  }));
}

/** 防御式日志（ctx.log 可能不完整）。 */
function warn(log, msg) {
  try { log?.warn?.(msg); } catch { /* 日志失败不影响接线 */ }
}

/**
 * 注册 agent 工具（每工具独立 try/catch：单个失败不影响其余）。
 * @returns {number} 注册成功的工具数
 */
export function registerTools(ctx, { defineTool, tools, invoke, log } = {}) {
  if (typeof ctx?.inject !== 'function') return 0;
  if (typeof defineTool !== 'function') {
    warn(log, 'dsh-git-push: @deepseek-ai/dsh-tools 不可用，工具未注册');
    return 0;
  }
  let count = 0;
  ctx.inject(['tools'], (tctx) => {
    const registry = tctx?.get?.('tools');
    if (!registry?.register) {
      warn(log, 'dsh-git-push: tools 服务不可用，工具未注册');
      return;
    }
    for (const spec of buildToolSpecs(tools, invoke)) {
      try {
        registry.register(defineTool(spec));
        count += 1;
      } catch (e) {
        warn(log, `dsh-git-push: 工具 ${spec.name} 注册失败: ${e?.message || e}`);
      }
    }
  });
  return count;
}

/**
 * 注册系统提示词段落（text 必须是同步函数）。
 * @param {Array<{name:string, order:number, text:()=>string}>} sections
 * @returns {number} 注册段数
 */
export function registerContext(ctx, { sections = [], log } = {}) {
  if (typeof ctx?.inject !== 'function') return 0;
  let count = 0;
  ctx.inject(['systemPrompt'], (sctx) => {
    const sp = sctx?.get?.('systemPrompt');
    if (!sp?.section) {
      warn(log, 'dsh-git-push: systemPrompt 服务不可用，注入未生效');
      return;
    }
    for (const section of sections) {
      try {
        sp.section({
          name: section.name,
          order: section.order,
          text: () => String(section.text() ?? ''),
        });
        count += 1;
      } catch (e) {
        warn(log, `dsh-git-push: 注入段 ${section.name} 失败: ${e?.message || e}`);
      }
    }
  });
  return count;
}

/**
 * 注册上下文注入（agent/pre-step）：每个 agent 首次 step 注入一次环境信息。
 *
 * 2026-09-20：环境注入（工作区目录 + 工具安装路径 + skill 总入口）从 systemPrompt
 *   section 迁到这里——工具探测结果不再每步注入系统提示词，改为上下文首条 user 消息
 *   注入（参考 dsh-skill-scoreboard v1.4.0 的相同时机与形态：WeakSet 防重复 +
 *   createUserMessage 追加消息 + source 标记 plugin instructions）。
 *
 * 与 A 通道的分工：使用/阅读/要求清单仍走 systemPrompt.section（每步组装都带）；
 *   环境信息体积小且只需一次，走 pre-step。总开关 injectSystemPrompt 同时门控两通道。
 *
 * 注入失败 / 无内容 / 被拒 / 已中止时原样放行，不影响主链路。
 * @param {object} ctx DSH 上下文（需 ctx.on）
 * @param {object} o { envInjectText: ()=>string 同步, log }
 * @returns {boolean} 是否已接线
 */
export function registerPreStepInjection(ctx, { envInjectText, log } = {}) {
  if (typeof ctx?.on !== 'function' || typeof envInjectText !== 'function') return false;
  const injectedAgents = new WeakSet();
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision?.kind === 'reject' || signal?.aborted) return decision;
    if (!agent || injectedAgents.has(agent)) return decision;
    injectedAgents.add(agent);
    try {
      const text = String(envInjectText() ?? '');
      if (!text) return decision;
      const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
      if (typeof createUserMessage !== 'function') {
        warn(log, 'dsh-git-push: @deepseek-ai/dsh-llm 的 createUserMessage 不可用，上下文注入跳过');
        return decision;
      }
      const msg = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'dsh-git-push', form: 'instructions' },
      });
      return { ...decision, messages: [...(decision.messages || []), msg] };
    } catch (e) {
      warn(log, `dsh-git-push: 上下文注入失败: ${e?.message || e}`);
      return decision;
    }
  });
  return true;
}

/**
 * 注册 HTTP 前缀路由（真实 API：webServer.register({kind:'prefix', path, handler})）。
 * @returns {boolean} 是否已接线
 */
export function registerHttp(ctx, { path = '/api/git-push', handler, log } = {}) {
  if (typeof ctx?.inject !== 'function') return false;
  let wired = false;
  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx?.get?.('webServer');
    if (!webServer?.register) {
      warn(log, 'dsh-git-push: webServer 服务不可用，HTTP 端点未注册');
      return;
    }
    try {
      webServer.register({ kind: 'prefix', path, handler });
      wired = true;
    } catch (e) {
      warn(log, `dsh-git-push: HTTP 注册失败: ${e?.message || e}`);
    }
  });
  return wired;
}

/**
 * 动态加载 defineTool（工作区自测环境没有 DSH 依赖，故不静态 import）。
 * 运行时（装在 profile 内）一定解析得到；解析不到时返回 null 并告警，插件其余部分照常。
 * 测试注入点：setDefineToolOverride(fn) 供单测喂 mock（见 test-plugin.mjs）。
 * @returns {Promise<Function|null>}
 */
let defineToolOverride = null;
export function setDefineToolOverride(fn) { defineToolOverride = fn; }
export async function loadDefineTool(log) {
  if (defineToolOverride) return defineToolOverride;
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    return typeof mod?.defineTool === 'function' ? mod.defineTool : null;
  } catch (e) {
    warn(log, `dsh-git-push: 加载 @deepseek-ai/dsh-tools 失败: ${e?.message || e}`);
    return null;
  }
}
