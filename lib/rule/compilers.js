/**
 * 规则编译器注册表 · 纯引用文件（1.1.4 起）
 *
 * 本文件历史上是一个 459 行的单文件注册表（16 段 registerCompiler 声明 + 5 个助手
 *   全挤在一起，新增一个 kind 要在几百行文件里找位置）。
 * 1.1.4 按「域」拆到同目录 compilers/ 下各模块，本文件退化为纯再导出：
 *   实现全在 lib/rule/compilers/*.js，本文件不含任何实现。
 *
 * 保留本文件只为让 `from './rule/compilers.js'` 这类既有 import 路径继续有效。
 * 新增一个 kind 的编译器 → 写进 lib/rule/compilers/ 对应域模块。
 *
 * 注意注册是**副作用**（模块加载时调 registerCompiler）：compilers/index.js 里
 *   的 import 顺序 = 原文件注册顺序，改动顺序会影响 listRegisteredKinds() 输出次序。
 */
import './compilers/index.js';

export { safeRe, DIMENSIONS, listRegisteredKinds } from './compilers/index.js';
