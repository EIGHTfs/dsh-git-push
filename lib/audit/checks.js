/**
 * 审计检查器入口（纯引用文件）
 *
 * ⚠️ 本文件**只写引用**，不含任何实现——保留它只为两点：
 *   ① 调用方（lib/audit/index.js 与各测试）继续 `from './checks.js'` 导入，路径稳定；
 *   ② 作为「检查层」的显式入口，一眼看出检查器从哪来。
 *
 * 实现已按职责分到两个目录：
 *   lib/ast/*      具体实现（token 级解析：注释/字符串/模板串感知）
 *   lib/checks/*   调用包装（把 AST 判定转成统一 finding；调度在 checks/dispatch.js）
 *
 * 加/改检查逻辑请去对应目录，不要在本文件实现（此处已无实现可加）。
 * 三层架构：① 规则声明 lib/audit-rules/*.yml → ② 实现 lib/ast/* → ③ 包装 lib/checks/*；
 *          本文件与 lib/audit/index.js 属编排层。
 */

export * from '../checks/index.js';
