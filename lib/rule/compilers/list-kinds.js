/**
 * 编译层 · 注册表查询
 *
 * listRegisteredKinds 输出已注册 kind 清单（供自检/文档/UI 展示）。
 * 与注册动作分离成独立模块，避免查询方 import 整个注册表造成副作用。
 */

/** 注册表最终导出（供 ruleset 统计用）。 */
export function listRegisteredKinds() {
  // 延迟 import 避免循环（registry.js 不反向依赖 compilers）
  return import('../registry.js').then((m) => m.RULE_COMPILERS.map((e) => e.kind));
}
