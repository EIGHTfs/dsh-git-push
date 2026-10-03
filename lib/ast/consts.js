// AST 判定层公共常量（单一来源）。
//
// 为什么单独成模块：同一常量此前在 lib/ast 的多个文件各写一份（如 FN_BODY_LOOKAHEAD 在
//   brace.js 与 control-flow.js），两处必须永远相等——漏改一处会出现「括号匹配按 20 回看、
//   控制流按别的值回看」这类静默不一致（自审 maintainability/duplicate-constant-def 报的真重复）。

/**
 * 找函数体起始 `{` 时向后回看的 token 数。
 * 函数签名可能很长（多行形参/默认值/泛型/装饰器），回看窗口太小会找不到 `{` 而漏判函数体，
 * 太大则可能越过边界把下一个块的 `{` 当成函数体——20 是实测能覆盖本仓库全部形态的值。
 */
export const FN_BODY_LOOKAHEAD = 20;
