/**
 * 检查层 · 结构类规则
 *
 * 职责：函数长度、复杂度、嵌套深度、文件行数、重复字符串、同步 fs、空 catch。
 * 本层为薄包装：判定逻辑在 lib/ast/*，此处只把结果转成 finding。
 */

import { makeFinding } from '../audit/index.js';
import { checkSyncFs, checkEmptyCatchAst, checkFuncLinesAst, checkFuncDensityAst, checkNameLengthAst, checkComplexityAst, checkNestingDepthAst, checkFileLines, checkRepeatedStringsAst } from '../ast/index.js';
import { capSeverity, HINT_QUALITY } from './common.js';


/** 检查 func-lines：单函数超长（AST 精确行数 + 语句密度互补，单行海量语句也检出）。 */
export function checkFuncLines({ file, text, rules }) {
  const findings = [];
  const rule = rules?.[0];
  if (!rule) return findings;
  const threshold = rule.threshold || 50;
  const blockThreshold = rule.blockThreshold || threshold * 2;
  // AST 版：括号平衡精确统计函数体行数（修行数启发式假阴性）
  const astHits = checkFuncLinesAst(text, { warn: threshold, block: blockThreshold });
  for (const hit of astHits) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule.id, kind: 'func-lines',
      severity: hit.level === 'blocker' || rule.level === 'blocker' ? 'blocker' : 'warning',
      // 2026-09-20：长度按非注释部分（hit.codeLen）；与总行数不同时才附注释行说明
      message: (hit.commentLines > 0
        ? `单函数 ${hit.codeLen} 行代码（总 ${hit.len} 行，其中注释 ${hit.commentLines} 行，阈值 ${threshold}）——应拆分`
        : `单函数 ${hit.codeLen} 行（阈值 ${threshold}）——应拆分`),
      dimensions: rule.dimensions,
      exemptHint: 'dsh-skip-func-length（文件头=全文件 / 函数定义行=单函数）',
      scoreImpact: hit.level === 'blocker' ? 2 : 1,
    }));
  }
  // 语句密度补充（2026-09-17 架构收敛）：**判定全部在 AST 层**（checkFuncDensityAst），
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
      scoreImpact: 0, // 2026-09-23：重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
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
      scoreImpact: 0, // 2026-09-23：重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
    }));
  }
  return findings;
}

/** 检查命名长度（min-length）。 */
export function checkMinLength({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
  const threshold = rule?.threshold || 2;
  for (const hit of checkNameLengthAst(text, { min: threshold })) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule?.id || 'min-length', kind: 'min-length',
      severity: 'warning',
      message: `${hit.type === 'function' ? '函数' : '变量'}名「${hit.name}」过短（< ${threshold}）——应可读命名`,
      dimensions: rule?.dimensions || ['可读性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0, // 2026-09-23：重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
    }));
  }
  return findings;
}

/** 检查圈复杂度（max-complexity）。 */
export function checkComplexity({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
  if (!rule) return findings; // 2026-09-14：规则被 exts/exclude_paths 过滤为空时短路（防 rule.severity 崩溃）
  const threshold = rule?.threshold || 10;
  for (const hit of checkComplexityAst(text, { warn: threshold, block: threshold * 2 })) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule?.id || 'max-complexity', kind: 'max-complexity',
      severity: capSeverity(rule.severity, hit.level),
      message: `函数 ${hit.name} 圈复杂度 ${hit.complexity}（阈值 ${threshold}）——应拆分`,
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
  if (!rule) return findings; // 2026-09-14：规则被 exts/exclude_paths 过滤为空时短路（防 rule.severity 崩溃）
  const threshold = rule?.threshold || 4;
  for (const hit of checkNestingDepthAst(text, { warn: threshold, block: threshold + 2 })) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule?.id || 'max-depth', kind: 'max-depth',
      severity: capSeverity(rule.severity, hit.level),
      message: `嵌套深度 ${hit.depth}（阈值 ${threshold}）——应提取早返回`,
      dimensions: rule?.dimensions || ['可读性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0, // 2026-09-23：重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
    }));
  }
  return findings;
}

/** 检查文件行数（max-lines）。 */
export function checkMaxLines({ file, text, rules }) {
  const rule = (rules || [])[0];
  if (!rule) return []; // 2026-09-14：规则被 exts/exclude_paths 过滤为空时短路（防 rule.severity 崩溃）
  const threshold = rule?.threshold || 500;
  const { lines, codeLines, commentLines, level } = checkFileLines(text, { warn: threshold, block: threshold * 2 });
  if (!level) return [];
  return [makeFinding({
    file, line: 1, rule: rule?.id || 'max-lines', kind: 'max-lines',
    severity: capSeverity(rule.severity, level),
    // 2026-09-20：判定按非注释部分（codeLines）；总行数/注释行数一并展示便于判断拆分空间
    message: `文件 ${codeLines} 行代码（总 ${lines} 行，其中注释 ${commentLines} 行，阈值 ${threshold}）——应拆分模块`,
    dimensions: rule?.dimensions || ['可维护性'],
    exemptHint: 'dsh-skip-size（文件头，文件级属性）',
    scoreImpact: level === 'blocker' ? 2 : 1,
  })];
}

/** 检查重复硬编码串/数值（repeated-string / min-occurrences）。 */
export function checkRepeated({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
  const threshold = rule?.threshold || 3;
  const ignore = rule?.ignoreValues || [];
  for (const hit of checkRepeatedStringsAst(text, { min: threshold, ignore })) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule?.id || 'repeated-string', kind: rule?.kind || 'repeated-string',
      severity: 'warning',
      message: `硬编码文本「${hit.value}」重复 ${hit.count} 次（阈值 ${threshold}）——应配置化`,
      dimensions: rule?.dimensions || ['可维护性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0, // 2026-09-23：重复字面量=「建议配置化」提示，同魔数口径不扣分（避免重复串全项目误扣）
    }));
  }
  return findings;
}
