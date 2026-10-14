/**
 * 插件入口层 · 工具定义（单源：从注册表生成——不再手写双源）
 *
 * listTools 由 lib/app/command-registry.js 的 TOOL_REGISTRY 生成——
 *   name/description/parameters 单一规则源：增删工具只改注册表一处，
 *   CLI 命令 / 宿主工具 schema / 帮助文档自动对齐（方案 B，免维护）。
 */

import { TOOL_REGISTRY } from './command-registry.js';

/** 注册表 params（{flag,type,desc,...}）→ 宿主工具 parameters 对象格式。 */
function paramsToParameters(params = []) {
  const out = {};
  for (const p of params) {
    // 参数类型 → JSON schema：boolean 直通；schemaType='message' 的（message 参数）额外接受
    //   数组与对象形态（元素为字符串或结构化条目），以支持「传数组」的新用法 ✓
    if (p.schemaType === 'message') {
      out[p.flag] = {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object' }] } },
          { type: 'object' },
        ],
        description: p.desc || '',
      };
    } else {
      out[p.flag] = { type: p.type === 'boolean' ? 'boolean' : 'string', description: p.desc || '' };
    }
  }
  return out;
}

/** 工具清单（名 + 说明 + 参数 spec——由注册表生成，单源；lib/plugin/normalizeParameters 转 DSH 形状注册）。 */
export function listTools() {
  return TOOL_REGISTRY.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: paramsToParameters(t.params),
  }));
}