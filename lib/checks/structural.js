/**
 * 检查层 · 结构类规则
 *
 * 职责：函数长度、复杂度、嵌套深度、文件行数、重复字符串、同步 fs、空 catch。
 * 本层为薄包装：判定逻辑在 lib/ast/*，此处只把结果转成 finding。
 */

import { makeFinding } from '../audit/index.js';
import { checkSyncFs, checkEmptyCatchAst, checkFuncLinesAst, checkNameLengthAst, checkComplexityAst, checkNestingDepthAst, checkFileLines, checkRepeatedStringsAst } from '../ast/index.js';
import { capSeverity, HINT_QUALITY } from './common.js';

/** 语句密度门槛（条/行）：低于此值说明语句正常铺开分布，不算「单行海量语句」。 */
const STATEMENT_DENSITY_MIN = 3;

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
      message: `单函数 ${hit.len} 行（阈值 ${threshold}）——应拆分`,
      dimensions: rule.dimensions,
      exemptHint: 'dsh-skip-func-length（文件头=全文件 / 函数定义行=单函数）',
      scoreImpact: hit.level === 'blocker' ? 2 : 1,
    }));
  }
  // 语句密度兜底：只针对「单行/极少行堆海量语句」（如 200 连 i++; 挤在一行）——
  //   AST 行数=1 不超阈值，故按**语句密度**（语句数 ÷ 函数体行数）补报。
  // 2026-09-13 误报修复：旧实现只判「语句总数 > 阈值」，对任何 AST 未覆盖的函数无条件
  //   套用 → 把 DSH 客户端 bundle 的单入口工厂 `factory: (require) => { ... }`（整个插件
  //   体都在这个箭头函数里，横跨上千行、语句数自然过百，密度却不到 1）误报为 blocker，
  //   且文案写成「单行海量语句」与实际结构不符。现加密度门槛：只有语句显著挤在少数行
  //   （平均每行 > STATEMENT_DENSITY_MIN 条）才报，长而正常的函数交由 max-file-length 反映。
  const lines = text.split('\n');
  const fnStarts = [];
  lines.forEach((line, i) => {
    if (/\bfunction\s*\w*\s*\(/.test(line) || /=>\s*\{/.test(line)) fnStarts.push(i);
  });
  const astLines = new Set(astHits.map((h) => h.line));
  for (const start of fnStarts) {
    let depth = 0, end = start;
    for (let i = start; i < lines.length; i++) {
      depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      if (depth <= 0 && i > start) { end = i; break; }
    }
    const bodyLines = Math.max(1, end - start + 1);
    const stmtCount = lines.slice(start, end + 1).reduce((n, l) => n + (l.match(/;/g) || []).length, 0);
    const density = stmtCount / bodyLines;
    if (stmtCount > threshold && density > STATEMENT_DENSITY_MIN && !astLines.has(start + 1)) {
      findings.push(makeFinding({
        file, line: start + 1, rule: rule.id, kind: 'func-lines',
        severity: stmtCount > blockThreshold ? 'blocker' : 'warning',
        message: `单函数 ${stmtCount} 语句挤在 ${bodyLines} 行（平均 ${density.toFixed(1)} 条/行，阈值 ${threshold} 条）——单行海量语句应拆分`,
        dimensions: rule.dimensions,
        exemptHint: 'dsh-skip-func-length（文件头=全文件 / 函数定义行=单函数）',
        scoreImpact: stmtCount > blockThreshold ? 2 : 1,
      }));
    }
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
      scoreImpact: 1,
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
      scoreImpact: 1,
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
      scoreImpact: 1,
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
      scoreImpact: 1,
    }));
  }
  return findings;
}

/** 检查文件行数（max-lines）。 */
export function checkMaxLines({ file, text, rules }) {
  const rule = (rules || [])[0];
  if (!rule) return []; // 2026-09-14：规则被 exts/exclude_paths 过滤为空时短路（防 rule.severity 崩溃）
  const threshold = rule?.threshold || 500;
  const { lines, commentLines, level } = checkFileLines(text, { warn: threshold, block: threshold * 2 });
  if (!level) return [];
  return [makeFinding({
    file, line: 1, rule: rule?.id || 'max-lines', kind: 'max-lines',
    severity: capSeverity(rule.severity, level),
    // 2026-09-15：注释行单独统计——大文件判定仍按总行数，信息里附注释行便于判断拆分空间
    message: `文件 ${lines} 行（其中注释 ${commentLines} 行，阈值 ${threshold}）——应拆分模块`,
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
      scoreImpact: 1,
    }));
  }
  return findings;
}
