/**
 * 编译层 · 数据流类 kind（三层审计 L2 的 yml 侧，2026-09-14）
 *
 * 认领条件：yml 显式声明 kind: "dataflow"。
 * 编译产物：kind=dataflow 的规则对象，携带 filePatterns（L1 文件内容初筛正则，
 *   由 lib/checks/filter.js 的 filterRulesByFileText 消费——未命中 = 非候选文件，
 *   该规则剔除，不进 L2 AST 精查）与 severity/dimensions。
 *
 * 铁律：加字段 = 加函数 + registerCompiler 一行注册；compileRule 主体永不修改。
 *   filePatterns 是「规则作用域」的一部分（内容级），与 exts（扩展名级）、
 *   exclude_paths（路径级）并列，三者都在 filter 层消费。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, severityLevel, pickDimensions } from './helpers.js';

registerCompiler(
  'dataflow',
  (r) => r?.kind === 'dataflow',
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'dataflow', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '',
    dimensions: pickDimensions(r, [DIMENSIONS.健壮性]),
    extra: {
      // L1 文件内容初筛（filterRulesByFileText 消费）：纯正则扫文件文本，
      //   任一命中即候选文件进 L2；未声明 = 不做初筛（全文都算候选）。
      //   字符串条目按子串包含匹配（免转义），RegExp 条目按 test 匹配。
      filePatterns: Array.isArray(r.file_patterns) ? r.file_patterns.map((p) => {
        if (p && typeof p.source === 'string') return new RegExp(p.source); // yml 里 /re/ 字面量形态
        return String(p);
      }) : undefined,
      // L2 判定参数（传给 lib/ast/dataflow.js 的 checkClearAccessAst；缺省用内置默认）
      clearMethods: Array.isArray(r.clear_methods) ? r.clear_methods : undefined,
      accessMethods: Array.isArray(r.access_methods) ? r.access_methods : undefined,
    },
  }),
);
