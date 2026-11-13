/**
 * 插件入口层 · 工具定义（单源：从注册表生成——不再手写双源）
 *
 * listTools 由 lib/app/command-registry.js 的 TOOL_REGISTRY 生成——
 *   name/description/parameters 单一规则源：增删工具只改注册表一处，
 *   CLI 命令 / 宿主工具 schema / 帮助文档自动对齐（方案 B，免维护）。
 */

import { TOOL_REGISTRY, resolveEntryParams } from './command-registry.js';

/**
 * 注册表 params（{flag,type,desc,...}）→ 宿主工具 parameters 对象格式。
 * @param {Array|Function} params 数组，或 (cfg) => 数组 的函数形态（参数按配置动态组装）
 * @param {object} [cfg] 函数形态时传入
 */
function paramsToParameters(params = [], cfg) {
  const list = typeof params === 'function' ? (params(cfg || {}) || []) : (params || []);
  const out = {};
  for (const p of list) {
    // 参数类型 → JSON schema：**只产出宿主认的标量类型**（boolean / string / array）——
    //   实测宿主校验不认 anyOf、也不认 JSON Schema 的「类型数组」写法（都按 string 处理 ✗，
    //   报 invalid arguments: "x" must be a string）⇒ 复杂形态一律拆成独立参数 ✓
    if (p.type === 'array') {
      out[p.flag] = { type: 'array', description: p.desc || '' };
    } else {
      out[p.flag] = { type: p.type === 'boolean' ? 'boolean' : 'string', description: p.desc || '' };
    }
  }
  return out;
}

/** 工具清单（名 + 说明 + 参数 spec——由注册表生成，单源；lib/plugin/normalizeParameters 转 DSH 形状注册）。 */
export function listTools(cfg, hasBuiltinEngine) {
  return TOOL_REGISTRY.map((t) => ({
    name: t.name,
    description: t.description,
    // 用 resolveEntryParams：函数形态的 params 按当前 cfg 求值 ⇒ 未启用的预处理参数不出现在签名里
    // hasBuiltinEngine 只为测试注入（生产不传 ⇒ 真实文件存在性判断）；必须透传，否则「不可用态」测不出来
    parameters: paramsToParameters(resolveEntryParams(t, cfg, hasBuiltinEngine), cfg),
  }));
}