/**
 * dsh-git-push 审计总入口：检查器
 *
 * 消费编译规则（见 lib/rule/registry.js 输出），对文本执行检查，产出统一问题对象。
 * 每个检查器：input = { file, text, compiled rules by kind }，output = findings[]
 * 豁免消费：文件头 dsh-skip-*（整文件免疫）在 audit/index.js 入口统一判断；本层只产出。
 */
import { makeFinding } from './index.js';
import { checkSyncFs, checkEmptyCatchAst, checkFuncLinesAst } from '../score/ast.js';

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
      exemptHint: 'dsh-skip-quality（文件头=整文件）',
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
      exemptHint: 'dsh-skip-quality（文件头=整文件）',
      scoreImpact: 1,
    }));
  }
  return findings;
}

/** 全量检查器调度：对单文件跑所有已编译规则 + 内置检查（质量类走 AST 级）。 */
export function runChecks({ file, relPath, text, grouped }) {
  let findings = [];
  if (grouped['secret']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['secret'] }));
  if (grouped['credential-ref']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['credential-ref'] }));
  if (grouped['regex']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['regex'] }));
  if (grouped['path-regex']) findings = findings.concat(checkPathRegexRules({ file, relPath, rules: grouped['path-regex'] }));
  if (grouped['func-lines']) findings = findings.concat(checkFuncLines({ file, text, rules: grouped['func-lines'] }));
  findings = findings.concat(checkEmptyCatch({ file, text }));
  findings = findings.concat(checkSyncFsInFile({ file, text }));
  return findings;
}