/**
 * AST 实现层 · 统一出口
 *
 * 分层位置（三层审计架构第二层）：
 *   ① 规则声明 → lib/audit-rules/*.yml（阈值、豁免清单、上下文关键字）
 *   ② 具体实现 → lib/ast/*（本目录，token 级解析：字符串/模板串/注释感知）
 *   ③ 调用包装 → lib/checks/*（把 AST 判定转成 finding，不重复造逻辑）
 *   ④ 编排调度 → lib/audit/*（收集文件、跑检查、汇总）
 *
 * 命名说明：本目录叫 ast/ 但实现是 **token 级**而非真正的语法树——
 *   Node 无内置 JS AST，零依赖约束下 token 级已足够覆盖「注释/字符串里的内容不算代码」
 *   这类判定。命名取「比正则更精确的语法级判定」之意，与逐行正则形成对照。
 *
 * 本文件只做再导出、不含实现：
 *   调用方既可 `import { tokenize } from '../ast/index.js'`（出口稳定），
 *   也可直接引具体模块（如 '../ast/tokenizer.js'）以获得更窄的依赖面。
 */

export { tokenize, clearTokenCache } from './tokenizer.js';
export { matchBrace, isBlockParen, matchingOpen, collectInnerFnRanges } from './brace.js';
export { checkSyncFs, checkEmptyCatchAst, checkComplexityAst, checkNestingDepthAst } from './control-flow.js';
export { checkFuncLinesAst, checkFileLines, checkRepeatedStringsAst } from './size.js';
export { checkNameLengthAst, checkShortFunctionNameAst, checkSmallFileReadAst } from './naming.js';
export { makeCodeLineFilter, codeStringLiterals } from './code-lines.js';
export { shellCdDynamicLines, writeIntoGitignoredLines } from './shell.js';
export { checkMagicNumberSmartAst } from './magic-number.js';
export {
  isMeaningfulCredentialValue,
  checkPlaceholderCredentialAst,
  checkCredentialRefAst,
} from './credential.js';
// 2026-09-14：三层审计 L2——数据流检查（同函数清空后访问）
export { checkClearAccessAst } from './dataflow.js';
