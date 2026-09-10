/**
 * dsh-git-push 审计总入口：检查器
 *
 * 消费编译规则（见 lib/rule/registry.js 输出），对文本执行检查，产出统一问题对象。
 * 每个检查器：input = { file, text, compiled rules by kind }，output = findings[]
 * 豁免消费：文件头 dsh-skip-*（整文件免疫）在 audit/index.js 入口统一判断；本层只产出。
 */
import { makeFinding } from './index.js';

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
  for (const rule of rules) {
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
            exemptHint: rule.kind === 'secret' || rule.kind === 'credential-ref'
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
  for (const rule of rules) {
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

/** 检查 func-lines：单函数超长（按函数体起止粗算行数）。 */
export function checkFuncLines({ file, text, rules }) {
  const findings = [];
  const rule = rules?.[0];
  if (!rule) return findings;
  const lines = text.split('\n');
  // 简易函数边界扫描：function 关键字 / 箭头函数开头 → 到下一个顶层大括号平衡
  const fnStarts = [];
  lines.forEach((line, i) => {
    if (/\bfunction\s*\w*\s*\(/.test(line) || /=>\s*\{/.test(line)) fnStarts.push(i);
  });
  const threshold = rule.threshold || 50;
  const blockThreshold = rule.blockThreshold || threshold * 2;
  // 逐函数估算长度：从 start 到最近的 '}'（括号深度回 0）
  for (const start of fnStarts) {
    let depth = 0, end = start;
    for (let i = start; i < lines.length; i++) {
      depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      if (depth <= 0 && i > start) { end = i; break; }
    }
    const len = end - start + 1;
    // 语句密度：函数体内分号计数（识别单行海量语句的超长函数，如 fixture 的 200 连 i++;）
    const stmtCount = lines.slice(start, end + 1).reduce((n, l) => n + (l.match(/;/g) || []).length, 0);
    const effective = Math.max(len, stmtCount);
    if (effective > threshold) {
      const isBlocker = effective > blockThreshold;
      findings.push(makeFinding({
        file, line: start + 1, rule: rule.id, kind: 'func-lines',
        severity: isBlocker ? 'blocker' : rule.level === 'blocker' ? 'blocker' : 'warning',
        message: `单函数 ${len} 行 / ${stmtCount} 语句（阈值 ${threshold}）${isBlocker ? '，超 block 阈值' : ''}——应拆分`,
        dimensions: rule.dimensions,
        exemptHint: 'dsh-skip-func-length（文件头=全文件 / 函数定义行=单函数）',
        scoreImpact: isBlocker ? 2 : 1,
      }));
    }
  }
  return findings;
}

/** 检查空 catch（首行无注释无 log）。 */
export function checkEmptyCatch({ file, text }) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/catch\s*\([^)]*\)\s*\{\s*$/.test(line)) {
      // 下一行空/结束 → 静默
      const next = lines[i + 1]?.trim() || '';
      const n2 = lines[i + 2]?.trim() || '';
      if (next === '}' || (next === '' && n2 === '}')) {
        findings.push(makeFinding({
          file, line: i + 1, rule: 'quality/empty-catch', kind: 'empty-catch',
          severity: 'warning',
          message: '空 catch 静默吞错——应加 log 或注释原因',
          dimensions: ['健壮性', '可观测性'],
          exemptHint: 'dsh-skip-quality（文件头=整文件）',
          scoreImpact: 1,
        }));
      }
    }
  }
  return findings;
}

/** 全量检查器调度：对单文件跑所有已编译规则 + 内置检查。 */
export function runChecks({ file, relPath, text, grouped }) {
  let findings = [];
  if (grouped['secret']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['secret'] }));
  if (grouped['credential-ref']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['credential-ref'] }));
  if (grouped['regex']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['regex'] }));
  if (grouped['path-regex']) findings = findings.concat(checkPathRegexRules({ file, relPath, rules: grouped['path-regex'] }));
  if (grouped['func-lines']) findings = findings.concat(checkFuncLines({ file, text, rules: grouped['func-lines'] }));
  findings = findings.concat(checkEmptyCatch({ file, text }));
  return findings;
}