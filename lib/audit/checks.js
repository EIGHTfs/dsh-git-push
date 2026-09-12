/**
 * dsh-git-push 审计总入口：检查器
 *
 * 消费编译规则（见 lib/rule/registry.js 输出），对文本执行检查，产出统一问题对象。
 * 每个检查器：input = { file, text, compiled rules by kind }，output = findings[]
 * 豁免消费：文件头 dsh-skip-*（整文件免疫）在 audit/index.js 入口统一判断；本层只产出。
 */
import { makeFinding } from './index.js';
import {
  checkSyncFs, checkEmptyCatchAst, checkFuncLinesAst, checkNameLengthAst,
  checkComplexityAst, checkNestingDepthAst, checkFileLines, checkRepeatedStringsAst,
} from '../score/ast.js';

/** 质量类检查的豁免提示（文件头=整文件豁免）。单处定义，多处复用，避免重复字面量。 */
export const HINT_QUALITY = 'dsh-skip-quality（文件头=整文件）';


/**
 * 规则声明的 severity 是上限：检查器内部风险升级不得超过规则自身声明。
 * （修正：max-complexity 规则声明 warning，不应因内部 block 阈值而升为 blocker）
 * @param {string} ruleSeverity yml 声明的 severity
 * @param {string} internalLevel 检查器内部评估等级
 * @returns {string} 最终 severity
 */
export function capSeverity(ruleSeverity, internalLevel) {
  const rank = { notice: 0, info: 0, warning: 1, error: 2, blocker: 2 };
  const declared = rank[ruleSeverity] ?? 1;
  const internal = rank[internalLevel] ?? 1;
  const final = Math.min(declared, internal);
  return final >= 2 ? (ruleSeverity === 'error' ? 'error' : 'blocker') : (final === 1 ? 'warning' : 'notice');
}

/** 按 kind 分组编译规则。 */
export function groupByKind(compiled) {
  const g = {};
  for (const r of compiled || []) {
    (g[r.kind] ||= []).push(r);
  }
  return g;
}

/** 检查文本是否符合 regex 型规则（regex / secret / credential-ref）。 */
export function checkRegexRules({ file, text, rules, source = '新增行' }) {
  const findings = [];
  const lines = text.split('\n');
  for (const rule of rules || []) {
    const patterns = [rule.pattern, ...(Array.isArray(rule.patterns) ? rule.patterns : [])].filter(Boolean);
    if (!patterns.length) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const p of patterns) {
        if (line && p.test(line)) {
          findings.push(makeFinding({
            file, line: i + 1, rule: rule.id, kind: rule.kind,
            severity: rule.level === 'blocker' ? 'blocker' : rule.severity,
            message: rule.message || rule.name,
            dimensions: rule.dimensions,
            exemptHint: rule.kind === '[FUNC]' || rule.kind === 'credential-ref'
              ? 'dsh-skip-sensitive（行尾=本行 / 文件头=整文件）' : 'dsh-skip-residue（行尾=本行）',
            scoreImpact: rule.level === 'blocker' ? 2 : 1,
          }));
          break; // 同规则一行只报一次
        }
      }
    }
  }
  return findings;
}

/** 检查 path-regex 型规则（对文件路径校验）。 */
export function checkPathRegexRules({ file, relPath, rules }) {
  const findings = [];
  for (const rule of rules || []) {
    const re = rule.pathPattern ? new RegExp(rule.pathPattern) : null;
    if (re && re.test(relPath)) {
      findings.push(makeFinding({
        file, line: 1, rule: rule.id, kind: 'path-regex',
        severity: rule.level === 'blocker' ? 'blocker' : rule.severity,
        message: `${rule.message || rule.name}（命中路径 ${relPath}）`,
        dimensions: rule.dimensions,
        exemptHint: 'dsh-skip-sensitive（文件头=整文件）',
        scoreImpact: rule.level === 'blocker' ? 2 : 1,
      }));
    }
  }
  return findings;
}

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
  // 语句密度兜底：单行海量语句（如 200 连 i++;）AST 行数=1 不超阈值，按语句数补报
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
    const stmtCount = lines.slice(start, end + 1).reduce((n, l) => n + (l.match(/;/g) || []).length, 0);
    if (stmtCount > threshold && !astLines.has(start + 1)) {
      findings.push(makeFinding({
        file, line: start + 1, rule: rule.id, kind: 'func-lines',
        severity: stmtCount > blockThreshold ? 'blocker' : 'warning',
        message: `单函数 ${stmtCount} 语句（阈值 ${threshold}）——单行海量语句应拆分`,
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


/** 检查文件路径规则（credential-file：私钥/凭据文件路径命中）。 */
export function checkCredentialFiles({ file, relPath, rules }) {
  const findings = [];
  const target = String(relPath || file || '');
  const base = target.split(/[/\\]/).pop() || '';
  for (const rule of rules || []) {
    const pats = rule.patterns || (rule.pattern ? [rule.pattern] : []);
    for (const p of pats) {
      let re;
      try { re = p instanceof RegExp ? p : new RegExp(String(p), 'i'); } catch { continue; }
      if (re.test(target) || re.test(base)) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'credential-file',
          severity: capSeverity(rule.severity, 'blocker'),
          message: rule.message || `凭据/私钥类文件：${base}`,
          dimensions: rule.dimensions || ['安全性'],
          exemptHint: 'dsh-skip-sensitive（文件头=整文件 / 行尾=本行）',
          scoreImpact: 2,
        }));
        break;
      }
    }
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
  const threshold = rule?.threshold || 500;
  const { lines, level } = checkFileLines(text, { warn: threshold, block: threshold * 2 });
  if (!level) return [];
  return [makeFinding({
    file, line: 1, rule: rule?.id || 'max-lines', kind: 'max-lines',
    severity: capSeverity(rule.severity, level),
    message: `文件 ${lines} 行（阈值 ${threshold}）——应拆分模块`,
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

/** 检查语义规则（semantic：占位消费——无静态可判定性时按路径/命名提示，不做臆测）。 */
export function checkSemantic({ file, relPath, rules }) {
  const findings = [];
  const target = String(relPath || file || '');
  for (const rule of rules || []) {
    // 测试文件缺失类：期望存在同名 test 文件（engine 无法读目录时跳过，交调用方）
    if (rule.extra?.detectionMethod === 'test-file-exists' || /test-file/i.test(rule.id || '')) {
      continue; // 需文件系统上下文，由 auditFull 层处理（避免此处臆测）
    }
    findings.push(makeFinding({
      file, line: 1, rule: rule.id, kind: 'semantic',
      severity: 'notice',
      message: rule.message || rule.name || '语义规则提示（需人工确认）',
      dimensions: rule.dimensions || ['健壮性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0,
    }));
  }
  return findings;
}

/** 全量检查器调度：对单文件跑所有已编译规则 + 内置检查（质量类走 AST 级）。 */
export function runChecks({ file, relPath, text, grouped }) {
  let findings = [];
  if (grouped['[FUNC]']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['[FUNC]'] }));
  if (grouped['credential-ref']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['credential-ref'] }));
  if (grouped['regex']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['regex'] }));
  if (grouped['path-regex']) findings = findings.concat(checkPathRegexRules({ file, relPath, rules: grouped['path-regex'] }));
  if (grouped['func-lines']) findings = findings.concat(checkFuncLines({ file, text, rules: grouped['func-lines'] }));
  // 1.1.0 补齐：此前 9 个 kind 编译后无人消费（死桶，旧项目被批评的同一问题）
  if (grouped['credential-file']) findings = findings.concat(checkCredentialFiles({ file, relPath, rules: grouped['credential-file'] }));
  if (grouped['min-length']) findings = findings.concat(checkMinLength({ file, text, rules: grouped['min-length'] }));
  if (grouped['max-complexity']) findings = findings.concat(checkComplexity({ file, text, rules: grouped['max-complexity'] }));
  if (grouped['max-depth']) findings = findings.concat(checkDepth({ file, text, rules: grouped['max-depth'] }));
  if (grouped['max-lines']) findings = findings.concat(checkMaxLines({ file, text, rules: grouped['max-lines'] }));
  if (grouped['repeated-string']) findings = findings.concat(checkRepeated({ file, text, rules: grouped['repeated-string'] }));
  if (grouped['min-occurrences']) findings = findings.concat(checkRepeated({ file, text, rules: grouped['min-occurrences'] }));
  if (grouped['semantic']) findings = findings.concat(checkSemantic({ file, relPath, rules: grouped['semantic'] }));
  findings = findings.concat(checkEmptyCatch({ file, text }));
  findings = findings.concat(checkSyncFsInFile({ file, text }));
  return findings;
}