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
    execute: async (args) => {
      const result = await invoke(tool.name, args || {});
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
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
