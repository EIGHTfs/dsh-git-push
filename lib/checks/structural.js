/**
 * 检查层 · 结构类规则
 *
 * 职责：函数长度、复杂度、嵌套深度、文件行数、重复字符串、同步 fs、空 catch。
 * 本层为薄包装：判定逻辑在 lib/ast/*，此处只把结果转成 finding。
 */

import { makeFinding } from '../audit/index.js';
import { checkSyncFs, checkEmptyCatchAst, checkFuncLinesAst, checkFuncDensityAst, checkNameLengthAst, checkComplexityAst, checkNestingDepthAst, checkFileLines, checkRepeatedStringsAst, checkCommentDensityAst, maxFunctionLength } from '../ast/index.js';
import { classifyFunctionPath, analyzeFunctionalScope } from '../ast/scope.js';

/* ───────── 结构检查默认阈值 ───────── */
const FUNC_LINES_DEFAULT = 50;   // 规则未配 threshold 时的函数行数默认阈值
const MAX_LINES_DEFAULT = 500;  // 规则未配 threshold 时的文件行数默认阈值
import { resolveScopeAction } from '../rule/scope.js';
import { capSeverity, HINT_QUALITY } from './common.js';


/** 检查 func-lines：单函数超长（AST 精确行数 + 语句密度互补，单行海量语句也检出）。 */
export function checkFuncLines({ file, text, rules }) {
  const findings = [];
  const rule = rules?.[0];
  if (!rule) return findings;
  const threshold = rule.threshold || FUNC_LINES_DEFAULT;
  const blockThreshold = rule.blockThreshold || threshold * 2;
  // AST 版：括号平衡精确统计函数体行数（修行数启发式假阴性）
  const astHits = checkFuncLinesAst(text, { warn: threshold, block: blockThreshold });
  const fnScope = rule.scopeRules?.length ? analyzeFunctionalScope(text) : new Map(); // P4：闭包双重作用域（public 不豁免）
  for (const hit of astHits) {
    // 作用域豁免（P1）：规则声明 scope_rules 且函数为启动路径（apply/init/main 等）→ exempt；P4：public（被 return/挂 this/exports 暴露）按模块级不豁免
    if (rule.scopeRules?.length && fnScope.get(hit.name) !== 'public' && resolveScopeAction(rule.scopeRules, { path: classifyFunctionPath(hit.name), functionName: hit.name }) === 'exempt') continue;
    findings.push(makeFinding({
      file, line: hit.line, rule: rule.id, kind: 'func-lines',
      severity: hit.level === 'blocker' || rule.level === 'blocker' ? 'blocker' : 'warning',
      // 长度按非注释部分（hit.codeLen）；与总行数不同时才附注释行说明
      message: (hit.commentLines > 0
        ? `单函数 ${hit.codeLen} 行代码（总 ${hit.len} 行，其中注释 ${hit.commentLines} 行，阈值 ${threshold}）——应拆分`
        : `单函数 ${hit.codeLen} 行（阈值 ${threshold}）——应拆分`),
      dimensions: rule.dimensions,
      exemptHint: 'dsh-skip-func-length（文件头=全文件 / 函数定义行=单函数）',
      scoreImpact: hit.level === 'blocker' ? 2 : 1,
    }));
  }
 // 语句密度补充（架构收敛）：**判定全部在 AST 层**（checkFuncDensityAst），
  //   本层只把结果转成 finding，不再自己找函数起点、自己数花括号、自己判行数。
  //   历史违规：此处曾是第二套独立实现（正则找起点 + 手数括号 + 自判行数），与 AST 版各判各的，
  //   既重复报同一函数，又因未剥离字面量把含 `\{` 正则的函数算成 242 行 blocker。
  //   跳过条件：已被行数判定报出的函数（reportedByLines）不再按密度重复报。
  const reportedByLines = new Set(astHits.map((h) => h.line));
  const densityHits = checkFuncDensityAst(text, {
    threshold, blockThreshold, skipLines: reportedByLines,
  });
  for (const d of densityHits) {
    findings.push(makeFinding({
      file, line: d.line, rule: rule.id, kind: 'func-lines',
      severity: d.level === 'blocker' || rule.level === 'blocker' ? 'blocker' : 'warning',
      message: `单函数 ${d.stmtCount} 语句挤在 ${d.bodyLines} 行（平均 ${d.density.toFixed(1)} 条/行，阈值 ${threshold} 条）——单行海量语句应拆分`,
      dimensions: rule.dimensions,
      exemptHint: 'dsh-skip-func-length（文件头=全文件 / 函数定义行=单函数）',
      scoreImpact: d.level === 'blocker' ? 2 : 1,
    }));
  }
  return findings;
}

/** 检查 sync-fs：async 路径中的 fs 同步调用（AST 级，修 named import 假阴性）。 */
export function checkSyncFsInFile({ file, text }) {
  const findings = [];
  for (const hit of checkSyncFs(text)) {
    findings.push(makeFinding({
      file, line: hit.line, rule: 'quality/sync-fs', kind: 'sync-fs',
      severity: 'warning',
      message: `async 路径中的同步 fs 调用 ${hit.call}（${hit.via}）——阻塞事件循环，应换异步版`,
      dimensions: ['性能'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0, // 重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
    }));
  }
  return findings;
}

/** 检查空 catch（AST 级括号平衡：多行空块/仅注释块均命中）。 */
export function checkEmptyCatch({ file, text }) {
  const findings = [];
  for (const hit of checkEmptyCatchAst(text)) {
    findings.push(makeFinding({
      file, line: hit.line, rule: 'quality/empty-catch', kind: 'empty-catch',
      severity: 'warning',
      message: '空 catch 静默吞错——应加 log 或注释原因',
      dimensions: ['健壮性', '可观测性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0, // 重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
    }));
  }
  return findings;
}

/** 检查命名长度（min-length）。 */
export function checkMinLength({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
 // 空规则短路（修复）：filterRulesByExt 裁剪后 min-length 可能是**空数组**
  //   （truthy）——如 JS 文件只剩 exts=[java,kt]/[py] 的 java/python 规则时数组被裁空，
  //   但 dispatch 的 `if (grouped['min-length'])` 对空数组仍真 → 本检查器拿空 rules 照跑
  //   （threshold 默认 2）→ 对当前文件报「裸 min-length 短名」（rule.id 空 → fallback），
  //   Pawchive test/tools 实测 27 条全为此根因。与 checkComplexity/checkMaxLines 同短路。
  if (!rule) return findings;
  const threshold = rule?.threshold || 2;
  for (const hit of checkNameLengthAst(text, { min: threshold })) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule?.id || 'min-length', kind: 'min-length',
      severity: 'warning',
      message: `${hit.type === 'function' ? '函数' : '变量'}名「${hit.name}」过短（< ${threshold}）——应可读命名`,
      dimensions: rule?.dimensions || ['可读性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0, // 重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
    }));
  }
  return findings;
}

/** 检查圈复杂度（max-complexity）。 */
export function checkComplexity({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
  if (!rule) return findings; // 规则被 exts/exclude_paths 过滤为空时短路（防 rule.severity 崩溃）
  const threshold = rule?.threshold || 10;
 // blocker 阈值：yml 可配 block_complexity（如 50），缺省 = threshold*2
  const blockThreshold = rule?.block || threshold * 2;
  const fnScope2 = rule.scopeRules?.length ? analyzeFunctionalScope(text) : new Map(); // P4
  for (const hit of checkComplexityAst(text, { warn: threshold, block: blockThreshold })) {
    // 作用域豁免（P1）：启动路径函数豁免圈复杂度；P4：public 不豁免
    if (rule.scopeRules?.length && fnScope2.get(hit.name) !== 'public' && resolveScopeAction(rule.scopeRules, { path: classifyFunctionPath(hit.name), functionName: hit.name }) === 'exempt') continue;
 // 分档提示（用户口径）：11~20 中等 / 21~50 高风险应拆分 / 50+ 极难维护（拦）
    const grade = hit.complexity > blockThreshold
      ? '极难维护（几乎不可测）'
      : (hit.complexity > 20 ? '高风险' : '中等（开始难测）');
    findings.push(makeFinding({
      file, line: hit.line, rule: rule?.id || 'max-complexity', kind: 'max-complexity',
      severity: capSeverity(rule.severity, hit.level),
      message: `函数 ${hit.name} 圈复杂度 ${hit.complexity}（阈值 ${threshold}，${grade}）`
        + (hit.level === 'blocker' ? '——极难维护，应拆分（拦提交）' : '——应拆分'),
      dimensions: rule?.dimensions || ['可维护性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: hit.level === 'blocker' ? 2 : 1,
    }));
  }
  return findings;
}

/** 检查嵌套深度（max-depth）。 */
export function checkDepth({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
  if (!rule) return findings; // 规则被 exts/exclude_paths 过滤为空时短路（防 rule.severity 崩溃）
  const threshold = rule?.threshold || 4;
  for (const hit of checkNestingDepthAst(text, { warn: threshold, block: threshold + 2 })) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule?.id || 'max-depth', kind: 'max-depth',
      severity: capSeverity(rule.severity, hit.level),
      message: `嵌套深度 ${hit.depth}（阈值 ${threshold}）——应提取早返回`,
      dimensions: rule?.dimensions || ['可读性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0, // 重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
    }));
  }
  return findings;
}

/** 检查文件行数（max-lines）。 */
export function checkMaxLines({ file, text, rules }) {
  const rule = (rules || [])[0];
  if (!rule) return []; // 规则被 exts/exclude_paths 过滤为空时短路（防 rule.severity 崩溃）
  const threshold = rule?.threshold || MAX_LINES_DEFAULT;
  const { lines, codeLines, commentLines, level } = checkFileLines(text, { warn: threshold, block: threshold * 2 });
  if (!level) return [];
 // 聚合型 vs 臃肿型（用户设计）：先罚函数再考虑文件——函数是执行单元、
  //   文件是组织单元。文件超行数但最大函数 ≤ 50 行（聚合型：函数都合规，文件大只是
  //   函数多/数据多）→ 降级 info（提示不扣分）；文件超行数且存在 > 50 行函数（臃肿型:
  //   文件大是因为藏着大函数）→ 保持 warning/blocker（先拆函数再拆文件）。
  const maxFuncLen = maxFunctionLength(text);
  const FUNC_COMPLIANT_LIMIT = 50;
  // 聚合型需「有函数且都合规」：无函数的纯脚本/数据文件（顶层语句堆叠）没有「函数多」
  //   作证据，不豁免（保持 warning——脚本型大文件同样是拆模块债务）。
  if (maxFuncLen > 0 && maxFuncLen <= FUNC_COMPLIANT_LIMIT) {
    return [makeFinding({
      file, line: 1, rule: rule?.id || 'max-lines', kind: 'max-lines',
      severity: 'info',
      message: `文件 ${codeLines} 行代码（总 ${lines} 行，其中注释 ${commentLines} 行，阈值 ${threshold}）——`
        + `最大函数仅 ${maxFuncLen} 行，函数都合规，属聚合型（函数多而非函数长），文件边界只是导航成本，可接受`,
      dimensions: rule?.dimensions || ['可维护性'],
      exemptHint: 'dsh-skip-size（文件头，文件级属性）',
      scoreImpact: 0,
    })];
  }
  return [makeFinding({
    file, line: 1, rule: rule?.id || 'max-lines', kind: 'max-lines',
    severity: capSeverity(rule.severity, level),
    // 判定按非注释部分（codeLines）；总行数/注释行数一并展示便于判断拆分空间
    message: `文件 ${codeLines} 行代码（总 ${lines} 行，其中注释 ${commentLines} 行，阈值 ${threshold}）——`
      + `最大函数 ${maxFuncLen} 行（臃肿型：文件大因藏着超大函数），应拆分`,
    dimensions: rule?.dimensions || ['可维护性'],
    exemptHint: 'dsh-skip-size（文件头，文件级属性）',
    scoreImpact: level === 'blocker' ? 2 : 1,
  })];
}

/** 检查注释冗余密度（comment-density，，评审规则①）。
 * 变量即注释——语义明确的代码里变量名已表达内容，额外的行注释不加深理解；
 * 应只保留隐性约束/复杂设计/外部契约/非显然决策的**块注释**，减少行注释。
 * 判定：行注释行数 ÷ 有效代码行数 > 阈值（规则 threshold 或默认 0.4）→ 提示。
 * 块注释（斜杠星号、JSDoc、docstring）不计入（设计说明保留）；只 warning 不拦截。
 */
export function checkCommentDensity({ file, text, rules }) {
  const rule = (rules || [])[0];
  if (!rule) return [];
  const threshold = rule?.threshold != null ? rule.threshold : 0.4;
  const hits = checkCommentDensityAst(text, { warn: threshold });
  if (!hits.length) return [];
  const h = hits[0];
  return [makeFinding({
    file, line: 1, rule: rule?.id || 'comment-density', kind: 'comment-density',
    severity: capSeverity(rule.severity, 'warning'),
    message: `行注释 ${h.commentLines} 行 ÷ 代码 ${h.codeLines} 行 = ${(h.ratio * 100).toFixed(0)}%（阈值 ${Math.round(threshold * 100)}%）——语义明确的代码变量即注释，行注释过多可能复述代码；只保留解释「为什么」的块注释`,
    dimensions: rule?.dimensions || ['可读性'],
    exemptHint: 'dsh-skip-quality（文件头=整文件）',
    scoreImpact: 1,
  })];
}

/** 检查重复硬编码串/数值（repeated-string / min-occurrences，两 kind 合并去重，）。 */
export function checkRepeated({ file, text, rules }) {
  const findings = [];
  // 多个规则（repeated-string + min-occurrences）合并传入时：
  //   · 阈值取最小（任一规则达到即报，不放过）
  //   · ignore 集合并
  //   · 同一文本只报一条（取第一条命中规则的 id）——修「同一文本被两个 kind 双报」
  const thresholds = (rules || []).map((r) => Number(r.threshold) || 3);
  const threshold = thresholds.length ? Math.min(...thresholds) : 3;
  const ignore = [...new Set((rules || []).flatMap((r) => r.ignoreValues || []))];
  const seen = new Set();
  for (const hit of checkRepeatedStringsAst(text, { min: threshold, ignore })) {
    if (seen.has(hit.value)) continue; // 同文本只报一次
    seen.add(hit.value);
    const rule = (rules || []).find((r) => Number(r.threshold || 3) <= hit.count) || (rules || [])[0];
    findings.push(makeFinding({
      file, line: hit.line, rule: rule?.id || 'repeated-string', kind: rule?.kind || 'repeated-string',
      severity: 'warning',
      message: `硬编码文本「${hit.value}」重复 ${hit.count} 次（阈值 ${threshold}）——应配置化`,
      dimensions: rule?.dimensions || ['可维护性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0, // 重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
    }));
  }
  return findings;
}
