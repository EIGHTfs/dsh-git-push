/**
 * 规则编译器注册表 · 统一出口
 *
 * 本目录是「规则包 → 可执行检查」的编译层：每个模块负责一类 kind 的编译，
 *   模块加载时调 registerCompiler 完成注册（副作用注册）。
 *   index.js 的 import 顺序 = 原文件里的注册顺序，保证 listRegisteredKinds() 次序不变。
 *
 * 分层位置（四层审计架构中「规则」→「实现」之间）：
 *   lib/audit-rules/*.yml  规则内容（阈值/严重度/豁免清单，改规则只动 yml）
 *   lib/rule/*             规则加载、编译、注册（本目录：把 yml 的 kind 编译成检查函数）
 *   lib/ast/* · lib/checks/*   token 级实现与检查包装
 *   lib/audit/*            采集与编排
 *
 * 本文件只做再导出与副作用 import：调用方继续 `from './rule/compilers.js'` 导入，路径稳定。
 * 新增一个 kind 的编译器 → 往对应域模块加一段 registerCompiler 即可，不必动本文件。
 */

import './credential.js';
import './func.js';
import './numeric-kinds.js';
import './regex.js';
import './link-semantic.js';
import './structure.js';
import './frontend.js';
import './file-health.js';
import './dataflow.js'; // 2026-09-14：三层审计 L2——数据流 kind（clear-then-access）

export { safeRe, DIMENSIONS } from './helpers.js';
export { listRegisteredKinds } from './list-kinds.js';
