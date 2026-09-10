/**
 * dsh-git-push 审计总入口：检查器
 *
 * 消费编译规则（见 lib/rule/registry.js 输出），对文本执行检查，产出统一问题对象。
 * 每个检查器：input = { file, text, compiled rules by kind }，output = findings[]
 * 豁免消费：文件头 dsh-skip-*（整文件免疫）在 audit/index.js 入口统一判断；本层只产出。
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { makeFinding } from './index.js';
import { safeRe } from '../rule/compilers.js';
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
    // 子模式（subPatterns: [{regex, message}]）优先；退回兼容旧结构（pattern/patterns RegExp）
    const subs = Array.isArray(rule.subPatterns) && rule.subPatterns.length ? rule.subPatterns : null;
    const patterns = subs
      ? subs.map((x) => x.regex)
      : [rule.pattern, ...(Array.isArray(rule.patterns) ? rule.patterns : [])].filter(Boolean);
    if (!patterns.length) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < patterns.length; j++) {
        const p = patterns[j];
        if (line && p.test(line)) {
          findings.push(makeFinding({
            file, line: i + 1, rule: rule.id, kind: rule.kind,
            severity: rule.level === 'blocker' ? 'blocker' : rule.severity,
            // 子模式专属 message 优先，缺省回退规则级 message
            message: subs?.[j]?.message || rule.message || rule.name,
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
    // 文件系统上下文类：期望存在同名 test 文件 / 语言包文件（engine 无法读目录时跳过，交调用方仓库级处理）
    if (rule.detectionMethod === 'test-file-exists' || /test-file/i.test(rule.id || '')
      || rule.detectionMethod === 'locale-file-exists' || /locale-file/i.test(rule.id || '')) {
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
  if (grouped['blacklist']) findings = findings.concat(checkBlacklist({ file, text, rules: grouped['blacklist'] }));
  if (grouped['npm-json']) findings = findings.concat(checkNpmJson({ file, text, rules: grouped['npm-json'] }));
  findings = findings.concat(checkEmptyCatch({ file, text }));
  findings = findings.concat(checkSyncFsInFile({ file, text }));
  return findings;
}
/**
 * 注释措辞黑名单检查（comment-wording 分数制）。
 * 逐行累计：黑名单 pattern 命中 +weight，白名单命中 -penalty，additional_features 命中 +weight。
 * 单行累计超阈值（默认 40，规则 extra.threshold 可覆盖）→ 报 warning。
 * severity 走 capSeverity（规则声明 info → 上限 notice，不拦截）。
 */
export function checkBlacklist({ file, text, rules }) {
  const findings = [];
  const lines = text.split('\n');
  for (const rule of rules || []) {
    const black = (rule.blacklist || []).map((b) => ({ re: safeRe(b.pattern, rule.name || rule.id), weight: Number(b.weight) || 0 }))
      .filter((b) => b.re);
    const white = (rule.whitelist || []).map((w) => ({ re: safeRe(w.pattern, rule.name || rule.id), penalty: Number(w.penalty) || 0 }))
      .filter((w) => w.re);
    const feats = (rule.additionalFeatures || []).map((a) => ({ re: safeRe(a.pattern, rule.name || rule.id), weight: Number(a.weight) || 0 }))
      .filter((a) => a.re);
    const threshold = Number(rule.threshold) || 40;
    lines.forEach((line, idx) => {
      let score = 0;
      for (const b of black) if (b.re.test(line)) score += b.weight;
      for (const w of white) if (w.re.test(line)) score -= w.penalty;
      for (const f of feats) if (f.re.test(line)) score += f.weight;
      if (score < threshold) return;
      findings.push(makeFinding({
        file, line: idx + 1, rule: rule.id, kind: 'blacklist',
        severity: capSeverity(rule.severity || 'warning', 'warning'),
        message: `${rule.name || rule.id}（措辞分 ${score} ≥ ${threshold}）`,
        dimensions: rule.dimensions || ['文档'],
        exemptHint: 'dsh-skip-quality（文件头=整文件）',
        scoreImpact: 1,
      }));
    });
  }
  return findings;
}

/**
 * 目录级审计（folder 槽位，1.0.3）。
 * 统计：源码目录总数（排除 excludeDirs）/ 单目录文件数 / 解包特征目录 / .gitignore 覆盖。
 * 由 auditFull 在文件行级检查之外追加调用（目录层规则无法按文件行跑）。
 * @param {object} opts { root, rules, gitignoreText, excludeDirsBase }
 * @returns {Array} findings（每条 file=根目录，line=1）
 */
export function checkFolderRules({ root, rules, gitignoreText = '' }) {
  const findings = [];
  if (!root) return findings;

  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

  // ── 全量目录/文件统计（一次遍历供多规则复用）──
  const dirCounts = { total: 0, byDir: new Map() }; // 单目录文件数
  const signatureHits = [];
  const dirs = [];
  (function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    let fileCount = 0;
    for (const e of entries) {
      if (e.name === '.git') continue;
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) { dirs.push({ dir, name: e.name, full }); walk(full); }
      else fileCount++;
    }
    if (fileCount > 0 || dir !== root) dirCounts.byDir.set(dir, fileCount);
    dirCounts.total++;
  })(root);

  for (const rule of rules || []) {
    const exclude = new Set(rule.excludeDirs || []);
    // 规则 1：源码目录总数 ≤ threshold（排除 excludeDirs）
    if (rule.threshold !== undefined && dirs.length) {
      const sig = rule.id.includes('total-count');
      if (sig) {
        const srcDirs = dirs.filter((d) => !exclude.has(d.name)).length;
        if (srcDirs > rule.threshold) {
          findings.push(makeFinding({
            file: root, line: 1, rule: rule.id, kind: 'folder',
            severity: capSeverity(rule.severity || 'warning', 'warning'),
            message: (rule.message || rule.name || '').replace('{count}', srcDirs).replace('{threshold}', rule.threshold),
            dimensions: rule.dimensions || ['可维护性'],
            exemptHint: 'dsh-skip-size（文件头=整文件）',
            scoreImpact: 1,
          }));
        }
      }
    }
    // 规则 2：单目录文件数 > threshold
    if (rule.id.includes('file-count-per-dir') && rule.threshold !== undefined) {
      for (const [dir, cnt] of dirCounts.byDir) {
        if (cnt <= rule.threshold) continue;
        findings.push(makeFinding({
          file: `${root}/…`, line: 1, rule: rule.id, kind: 'folder',
          severity: capSeverity(rule.severity || 'warning', 'warning'),
          message: (rule.message || '').replace('{path}', dir.replace(root, '')).replace('{count}', cnt).replace('{threshold}', rule.threshold),
          dimensions: rule.dimensions || ['可维护性'],
          exemptHint: 'dsh-skip-size（文件头=整文件）',
          scoreImpact: 1,
        }));
      }
    }
    // 规则 3：解包特征目录
    if (Array.isArray(rule.signatures)) {
      for (const sig of rule.signatures) {
        const pat = String(sig.pattern || '').replace(/\*\*/g, '**').replace(/^\*\*\/?/, '');
        const hit = dirs.find((d) => {
          const rel = d.full.replace(root, '').replace(/^\//, '');
          if (pat.includes('package/package.json')) return rel === 'package' && existsSync(`${d.full}/package.json`);
          const base = pat.split('/')[0];
          return rel === base || rel.startsWith(`${base}/`);
        });
        if (hit) {
          findings.push(makeFinding({
            file: `${root}/…`, line: 1, rule: rule.id, kind: 'folder',
            severity: capSeverity(rule.severity || 'warning', 'warning'),
            message: sig.message || `${rule.name}: ${sig.pattern}`,
            dimensions: rule.dimensions || ['可维护性'],
            exemptHint: 'dsh-skip-size（文件头=整文件）',
            scoreImpact: 1,
          }));
        }
      }
    }
    // 规则 4：.gitignore 覆盖检查
    if (Array.isArray(rule.requiredPatterns) && gitignoreText) {
      const missing = rule.requiredPatterns.filter((p) => !gitignoreText.split('\n').some((l) => l.trim() === p || l.trim() === p.replace(/^\*/, '')));
      if (missing.length) {
        findings.push(makeFinding({
          file: `${root}/.gitignore`, line: 1, rule: rule.id, kind: 'folder',
          severity: capSeverity(rule.severity || 'warning', 'warning'),
          message: (rule.message || rule.name || '').replace('{missing}', missing.join(', ')),
          dimensions: rule.dimensions || ['可维护性'],
          exemptHint: 'dsh-skip-size（文件头=整文件）',
          scoreImpact: 1,
        }));
      }
    }
  }
  return findings;
}

/**
 * npm 结构化检查（npm-json kind，1.0.3）。
 * 对 package.json 做真实解析判定（替代旧项目「命中即提示」弱 pattern）：
 *   - npm/files-missing-lib：main/exports 指向 lib/ 下入口时，files 数组须包含 lib（或对应入口文件）
 *   - npm/undeclared-js-yaml：lib 代码 import 'js-yaml' 时，dependencies 须已声明（文件级仅能验 dependencies 存在性；
 *     import 证据属全仓语义，证据法见规则描述，文件级 fallback 只验「dependencies 含 js-yaml」）
 * 仅对扩展名为 json 且文件名为 package.json 的目标执行。
 */
export function checkNpmJson({ file, text, rules }) {
  const findings = [];
  const base = String(file || '').split(/[/\\]/).pop();
  if (base !== 'package.json') return findings;
  let pkg = null;
  try { pkg = JSON.parse(text); } catch { return findings; } // JSON 语法错误有 syntax 检查器兜底
  for (const rule of rules || []) {
    const sev = rule.severity === 'error' ? 'blocker' : rule.severity || 'warning';
    if (rule.id === 'npm/files-missing-lib') {
      const mainTarget = typeof pkg.main === 'string' ? pkg.main : null;
      const exportsTargets = pkg.exports && typeof pkg.exports === 'object'
        ? Object.values(pkg.exports).filter((v) => typeof v === 'string') : [];
      const targets = [mainTarget, ...exportsTargets].filter(Boolean);
      const entryInLib = targets.some((t) => /^lib\//.test(t));
      const files = Array.isArray(pkg.files) ? pkg.files : null;
      const libCovered = files ? files.some((f) => f === 'lib' || f === 'lib/' || targets.some((t) => f === t)) : true; // files 缺省=npm 默认全含
      if (entryInLib && files && !libCovered) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'npm-json',
          severity: sev,
          message: `${rule.message || rule.name}（main=${mainTarget || 'n/a'}，files 未见 lib）`,
          dimensions: rule.dimensions || ['可部署性'],
          exemptHint: 'dsh-skip-sensitive（文件头=整文件）',
          scoreImpact: sev === 'blocker' ? 2 : 1,
        }));
      }
    } else if (rule.id === 'npm/undeclared-js-yaml') {
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (!deps['js-yaml']) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'npm-json',
          severity: sev,
          message: `${rule.message || rule.name}（dependencies/devDependencies 均未声明 js-yaml）`,
          dimensions: rule.dimensions || ['可部署性'],
          exemptHint: 'dsh-skip-sensitive（文件头=整文件）',
          scoreImpact: sev === 'blocker' ? 2 : 1,
        }));
      }
    }
  }
  return findings;
}
