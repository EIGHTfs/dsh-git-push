/**
 * dsh-git-push 审计总入口：检查器（调用层）
 * dsh-skip-i18n: 插件为中文零依赖 CLI（无 i18n 框架需求），用户可见文案硬编码为产品设计
 *
 * 三层职责（改审计逻辑前务必先分清，避免在错误的层里打补丁）：
 *   ① 规则声明 → lib/audit-rules/*.yml（阈值/severity/豁免清单/上下文关键字都在 yml，改阈值先改 yml）
 *   ② 具体实现 → lib/score/ast.js（token 级解析：注释/字符串/模板串感知）、
 *                lib/audit/{collector,glob,index}.js（采集/路径/入口）
 *   ③ 调用包装 → 本文件（checks.js）：把实现结果转成统一的 finding 对象，不重复造检查逻辑。
 *
 * 本文件的检查器标准样式 = 薄包装（调用 lib/ 下的实现，逐个 makeFinding），例如
 * checkEmptyCatch（调 checkEmptyCatchAst）、checkSyncFsInFile（调 checkSyncFs）、
 * checkMagicNumberSmart（调 checkMagicNumberSmartAst）。
 * ⚠️ 凡是在本文件里「自己写正则/逐行扫描」重新实现一遍检查逻辑的，都是错误用法——
 *    逐行文本无法区分代码与注释/字符串，必然误报（历史教训：magic-number 曾在此逐行扫，
 *    注释里的版本号、CSS 字号、i18n 字典值全被误报）。请在 lib/score/ast.js 用 token 级实现。
 *
 * 消费编译规则（见 lib/rule/registry.js 输出），对文本执行检查，产出统一问题对象。
 * 每个检查器：input = { file, text, compiled rules by kind }，output = findings[]
 * 豁免消费：文件头 dsh-skip-*（整文件免疫）在 audit/index.js 入口统一判断；本层只产出。
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { globToRegex } from './glob.js';
import { join } from 'node:path';
import { makeFinding, CODE_EXTS } from './index.js';
import { safeRe } from '../rule/compilers.js';
import {
  checkSyncFs, checkEmptyCatchAst, checkFuncLinesAst, checkNameLengthAst,
  checkComplexityAst, checkNestingDepthAst, checkFileLines, checkRepeatedStringsAst,
  checkMagicNumberSmartAst, makeCodeLineFilter, checkSmallFileReadAst, checkShortFunctionNameAst,
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

/**
 * astConfirm: "magic-number" 的值级精筛集合——返回 checkMagicNumberSmartAst
 * 判定为「真魔数」的行的 Set（版本号/日期/HTTP 状态码/命名常量值/参数默认值/
 * 索引运算 i+1 等豁免行不在其中）。正则初筛出的候选行必须在此集合内才报。
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号集合
 */
function smartHitLines(text) {
  const hits = checkMagicNumberSmartAst(String(text || ''));
  return new Set(hits.map((h) => h.line));
}

/**
 * astConfirmKind: "small-file-read" 的精筛集合——受控小文件读取的行号
 * （读 JSON 数据/配置/缓存，不构成 memory-bomb 风险）。
 * @param {string} text 文件全文
 * @returns {Set<number>} 应豁免的行号集合
 */
function smallFileReadLines(text) {
  return checkSmallFileReadAst(String(text || ''));
}

/**
 * astConfirmKind: "short-func-name" 的精筛集合——token 级判定为「真的过短且非公认
 * 缩写」的函数声明行（i18n 的 tr/t、字典 L 等不在其中）。
 * @param {string} text 文件全文
 * @returns {Set<number>} 允许报的行号集合
 */
function shortFuncNameLines(text) {
  return new Set(checkShortFunctionNameAst(String(text || '')).map((h) => h.line));
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
    // 2026-09-13：白名单行豁免——命中 whitelist_patterns 的行不报（修凭据类误报：
    //   GM_cookie API 名 / o.cookie 属性 / "Cookie=" 字符串字面量 / gbCookie 字段名
    //   都不是硬编码凭据值，正则只看文本无法区分「引用」与「赋值」）
    const whitelist = (rule.whitelistPatterns || []).map((w) => new RegExp(w));
    // 2026-09-13：正则初筛 → token 级精筛（规则声明 astConfirm: true 时启用）。
    //   正则只负责快速筛出候选行，无法区分「代码」与「注释/字符串」；对候选行再做
    //   token 判定（lib/score/ast.js 的 makeCodeLineFilter）确认是否真在代码里，
    //   消除「注释里的版本号/日期」「CSS 字号/字符串里的数字」这类误报。
    const candidates = [];
    if (rule.astConfirm) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        if (whitelist.length && whitelist.some((w) => w.test(line))) continue;
        if (patterns.some((p) => { p.lastIndex = 0; return p.test(line); })) candidates.push(i + 1);
      }
    }
    const codeFilter = rule.astConfirm ? makeCodeLineFilter(text, candidates) : null;
    // 2026-09-13：astConfirm: "magic-number" —— 值级精筛。正则初筛出的候选行，
    //   再用 checkMagicNumberSmartAst 判定该数字是否真魔数（版本号/日期/HTTP 状态码/
    //   命名常量值/参数默认值/索引运算 i+1 自动豁免）。只有「正则命中 ∧ smart 判定
    //   是真魔数」的行才报，消除纯 regex 把 i+1/cur-1/常量定义当魔数的大面积误报。
    const magicSmartLines = rule.astConfirm === 'magic-number' ? smartHitLines(text) : null;
    // 2026-09-13：具名精筛 astConfirmKind —— 规则声明「命中后还要 AST 确认什么」。
    //   两种语义：deny = 集合内的行豁免（如 small-file-read 的受控小文件）；
    //   allow = 只有集合内的行才报（如 short-func-name 的 token 级短名判定）。
    let kindFilter = null;
    if (rule.astConfirmKind === 'small-file-read') kindFilter = { mode: 'deny', lines: smallFileReadLines(text) };
    else if (rule.astConfirmKind === 'short-func-name') kindFilter = { mode: 'allow', lines: shortFuncNameLines(text) };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (whitelist.length && whitelist.some((w) => w.test(line))) continue; // 白名单整行豁免
      if (codeFilter && !codeFilter.isCode(i + 1)) continue; // 精筛：注释/字符串行不报
      if (magicSmartLines && !magicSmartLines.has(i + 1)) continue; // 值级精筛：smart 判定非魔数不报
      if (kindFilter?.mode === 'deny' && kindFilter.lines.has(i + 1)) continue; // 命中即豁免（受控小文件等）
      if (kindFilter?.mode === 'allow' && !kindFilter.lines.has(i + 1)) continue; // 仅白名单行可报（token 级精筛）
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
/**
 * semantic 占位规则检查：无法自动判定、需人工确认的规则（安全/a11y/dependency 类）。
 *
 * 语义（2026-09-13 修）：
 *   ① 只对**代码文件**生效——.gitignore/README/yml/json 没有「用户输入路径/依赖/按钮」
 *      可判定语义，逐文件报属纯噪音。
 *   ② **仓库级规则只报一次**——npm audit（dependency/known-vulnerability）、
 *      路径穿越人工核查（security/no-path-traversal）、a11y（button/label）都是
 *      「整个仓库」的属性，不是「某个文件」的属性。逐文件报会在 4 个文件上产出
 *      16 条同义提示（4 文件 × 4 规则），把真实问题淹没。
 *      判定依据：规则只声明 name/description、**无任何可执行字段**（无 pattern/
 *      threshold/kind/detection）→ 本 engine 无法评估，交人工按仓库维度核查一次。
 *      多文件时报在**文件路径字典序最小**的那个文件上（稳定可复现），其余文件静默。
 *   ③ 单文件审计（如 diff 范围的末尾批次）拿不到全仓列表时退回逐文件提示，
 *      由调用方（auditFull/auditChanged）传 repoLevel 去重，保证不丢提示。
 *
 * @param {object} args { file, relPath, rules, repoLevelRules? }
 *   repoLevelRules：调用方判定为「仓库级、已报过」的规则 id 集合（Set），命中则跳过。
 * @returns {Array} findings
 */
export function checkSemantic({ file, relPath, rules, repoLevelRules }) {
  const findings = [];
  const target = String(relPath || file || '');
  // ① 非代码文件没有可判定的语义对象
  const ext = target.split('.').pop().toLowerCase();
  if (!CODE_EXTS.has(ext)) return findings;
  for (const rule of rules || []) {
    // 文件系统上下文类：期望存在同名 test 文件 / 语言包文件（engine 无法读目录时跳过，交调用方仓库级处理）
    if (rule.detectionMethod === 'test-file-exists' || /test-file/i.test(rule.id || '')
      || rule.detectionMethod === 'locale-file-exists' || /locale-file/i.test(rule.id || '')) {
      continue; // 需文件系统上下文，由 auditFull 层处理（避免此处臆测）
    }
    // ② 仓库级规则已报过 → 本文件不再重复
    if (repoLevelRules && repoLevelRules.has(rule.id)) continue;
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

/**
 * 判定规则是否为「仓库级语义占位」——无任何可执行检测字段、需人工按仓库维度核查。
 * 这类规则只应报一次（否则每文件一条同义提示）。
 * 判定：semantic kind 且既无 pattern(s)、无 threshold / min 长度 / max 深度等数值字段、
 *   无 detectionMethod、无 blacklist/whitelist 等清单字段。
 * @param {object} rule 编译后规则对象
 * @returns {boolean}
 */
export function isRepoLevelSemanticRule(rule) {
  if (!rule || rule.kind !== 'semantic') return false;
  if (rule.detectionMethod) return false;
  const hasPattern = rule.pattern !== undefined || (Array.isArray(rule.patterns) && rule.patterns.length > 0);
  const numericFields = ['threshold', 'minLength', 'maxDepth', 'maxLines', 'maxComplexity', 'minOccurrences', 'minLines'];
  const hasNumeric = numericFields.some((k) => rule[k] !== undefined && rule[k] !== null);
  const listFields = ['blacklist', 'whitelist', 'additionalFeatures', 'requiredPatterns'];
  const hasList = listFields.some((k) => Array.isArray(rule[k]) && rule[k].length > 0);
  return !hasPattern && !hasNumeric && !hasList;
}

/**
 * cordis.patch.yml insert 语义检查（patch-insert kind）。
 * 旧实现是 regex「命中 insert: 行即提示」——纯 insert（只新建、不覆盖任何行）
 * 也会被报，如 dsh-skill-scoreboard 的 patch（insert 新建 skill-scoreboard loader，
 * 基座没有同名行可覆盖）被误报成 duplicate-id 风险。
 * 语义判定：解析 yml 文本——
 *   1) insert 块（`- insert:` 后缩进列表）内的 id 集合
 *   2) 顶层（缩进 0）`- id:` 覆盖行的 id 集合
 *   3) 仅当两集合有交集（insert 新建的 id 与按 id 覆盖行同 id）才报 duplicate-id 双挂风险
 * 纯 insert 或 id 无交集 → 不报。
 * @param {object} p { file, text, rules } rules=编译后的 patch-insert 规则
 * @returns {Array} findings
 */
export function checkPatchInsert({ file, text, rules }) {
  const findings = [];
  const lines = String(text || '').split('\n');
  const insertIds = [];   // { id, line }
  const overrideIds = []; // { id, line }
  let inInsert = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue; // 空行/注释（README 对照示例多为注释，不算）
    if (/^- id:\s*["']?([^"'\s]+)["']?\s*$/.test(t) && /^- id:/.test(raw)) {
      // 缩进 0 的 - id 行 = 顶层覆盖已有 loader 行（无论当前是否在 insert 块内，都终结 insert 块）
      const id = t.match(/^- id:\s*["']?([^"'\s]+)["']?\s*$/)[1];
      overrideIds.push({ id, line: i + 1 });
      inInsert = false;
      continue;
    }
    if (inInsert && /^\s+- id:\s*["']?([^"'\s]+)["']?\s*$/.test(raw)) {
      const id = raw.trim().match(/^- id:\s*["']?([^"'\s]+)["']?\s*$/)[1];
      insertIds.push({ id, line: i + 1 });
      continue;
    }
    if (/^- insert:\s*$/.test(t)) { inInsert = true; continue; }
    // 离开 insert 块：insert 块内列表项以缩进（空格开头）为特征；缩进 0 的非 insert 行结束块
    if (inInsert && !/^\s/.test(raw)) inInsert = false;
  }
  for (const rule of rules || []) {
    for (const ins of insertIds) {
      if (overrideIds.some((o) => o.id === ins.id)) {
        findings.push(makeFinding({
          file, line: ins.line, rule: rule.id, kind: 'patch-insert',
          severity: rule.level === 'blocker' ? 'blocker' : rule.severity || 'warning',
          message: `${rule.message || rule.name}（insert 新建 id「${ins.id}」与顶层覆盖行同 id，会 duplicate-id 双挂）`,
          dimensions: rule.dimensions || ['健壮性'],
          exemptHint: HINT_QUALITY,
          scoreImpact: 1,
        }));
      }
    }
  }
  return findings;
}

/** 全量检查器调度：对单文件跑所有已编译规则 + 内置检查（质量类走 AST 级）。
 * @param {object} opts { level: 'quick'|'standard'|'deep'（缺省 standard 全量） }
 * quick 档跳过 AST/语义重检查（分析成本高）：func-lines/complexity/depth/
 * max-lines/repeated-string/semantic/credential-file/min-length，保留正则/
 * 黑名单/路径/内置轻检——适合大仓冒烟、快速门禁。
 * deep 档当前引擎与 standard 等效（全量），为未来追加深度检查预留。 */
/**
 * 规则 exts 过滤：规则声明 `exts` 时仅对匹配扩展名的文件生效。
 * 编译产物里 exts 存在 `rule.extra.exts`（regex 编译器已透传），此处消费——
 * 修复 dsh/patch-insert-unique-id 等在 README/md 等非目标文件上的误报
 * （例：patch 语义规则只查 yml/yaml，README 里的 insert 示例代码块不再命中）。
 * @param {object} grouped 按 kind 分组的编译规则
 * @param {string} relPath 相对路径（用于取扩展名）
 * @returns {object} 过滤后的 grouped（规则数组已按 exts 裁剪）
 */
export function filterRulesByExt(grouped, relPath) {
  const ext = String(relPath || '').split('.').pop().toLowerCase();
  const out = {};
  for (const [kind, rules] of Object.entries(grouped || {})) {
    if (!Array.isArray(rules)) { out[kind] = rules; continue; }
    out[kind] = rules.filter((r) => {
      const exts = r?.exts ?? r?.extra?.exts; // ruleOut 展开后 exts 在顶层；兼容 extra 形式
      if (!Array.isArray(exts) || exts.length === 0) return true; // 未声明 exts = 不限文件
      return exts.includes(ext);
    });
  }
  return out;
}

/**
 * 2026-09-13：路径级规则过滤——规则声明 exclude_paths 时，按 relPath 前缀排除。
 * 与 filterRulesByExt 分离：exts 只按扩展名，区分不了「同是 .js 的 server/client」；
 * 需要排除整目录（如 client-node-builtin-require 只查浏览器侧，排除 server/ test/ lib/）。
 * 路径匹配：relPath 以任一 exclude 前缀开头即跳过该规则（前缀兼容有无尾斜杠）。
 */
export function filterRulesByPath(grouped, relPath) {
  const p = String(relPath || '');
  const out = {};
  for (const [kind, rules] of Object.entries(grouped || {})) {
    if (!Array.isArray(rules)) { out[kind] = rules; continue; }
    out[kind] = rules.filter((r) => {
      const excludes = r?.excludePaths ?? r?.extra?.excludePaths;
      if (!Array.isArray(excludes) || excludes.length === 0) return true; // 未声明 = 不限路径
      const norm = (s) => String(s || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
      const rel = norm(p);
      return !excludes.some((e) => {
        const ee = norm(e);
        return ee && (rel === ee || rel.startsWith(ee + '/') || rel.startsWith(ee));
      });
    });
  }
  return out;
}

export function runChecks({ file, relPath, text, grouped }, opts = {}) {
  const quick = opts.level === 'quick';
  // exts 过滤：规则声明目标扩展名时按当前文件裁剪（如 patch 规则只查 yml/yaml）
  grouped = filterRulesByExt(grouped, relPath || file || '');
  // 2026-09-13：路径级过滤——exclude_paths 声明排除的目录整规则跳过（如 server/ lib/ test/）
  grouped = filterRulesByPath(grouped, relPath || file || '');
  let findings = [];
  if (grouped['[FUNC]']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['[FUNC]'] }));
  if (grouped['credential-ref']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['credential-ref'] }));
  if (grouped['regex']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['regex'] }));
  if (grouped['path-regex']) findings = findings.concat(checkPathRegexRules({ file, relPath, rules: grouped['path-regex'] }));
  if (!quick && grouped['func-lines']) findings = findings.concat(checkFuncLines({ file, text, rules: grouped['func-lines'] }));
  // 此前 9 个 kind 编译后无人消费（死桶）
  if (!quick && grouped['credential-file']) findings = findings.concat(checkCredentialFiles({ file, relPath, rules: grouped['credential-file'] }));
  if (!quick && grouped['min-length']) findings = findings.concat(checkMinLength({ file, text, rules: grouped['min-length'] }));
  if (!quick && grouped['max-complexity']) findings = findings.concat(checkComplexity({ file, text, rules: grouped['max-complexity'] }));
  if (!quick && grouped['max-depth']) findings = findings.concat(checkDepth({ file, text, rules: grouped['max-depth'] }));
  if (!quick && grouped['max-lines']) findings = findings.concat(checkMaxLines({ file, text, rules: grouped['max-lines'] }));
  // 1.0.13：文件健康度矩阵（行数/大小/行长三维评分）
  if (!quick && grouped['file-health']) findings = findings.concat(checkFileHealth({ file, relPath, text, rules: grouped['file-health'] }));
  if (!quick && grouped['repeated-string']) findings = findings.concat(checkRepeated({ file, text, rules: grouped['repeated-string'] }));
  if (!quick && grouped['min-occurrences']) findings = findings.concat(checkRepeated({ file, text, rules: grouped['min-occurrences'] }));
  if (!quick && grouped['semantic']) findings = findings.concat(checkSemantic({ file, relPath, rules: grouped['semantic'], repoLevelRules: opts?.repoLevelRules }));
  if (grouped['blacklist']) findings = findings.concat(checkBlacklist({ file, text, rules: grouped['blacklist'] }));
  if (grouped['npm-json']) findings = findings.concat(checkNpmJson({ file, text, rules: grouped['npm-json'], repoHasJsYamlImport: opts?.repoHasJsYamlImport, repoPath: opts?.repoPath }));
  // patch insert 语义检查（yml 文件 insert/覆盖 id 冲突才报）
  if (grouped['patch-insert']) findings = findings.concat(checkPatchInsert({ file, text, rules: grouped['patch-insert'] }));
  // 1.0.5：按钮事件绑定交叉比对（油猴脚本/扩展——HTML 在 JS 字符串，事件在 JS 绑定）
  if (grouped['button-bind']) findings = findings.concat(checkButtonBindings({ file, text, rules: grouped['button-bind'] }));
  // 1.0.7：硬编码魔数检测（版本号豁免版——版本号/日期/HTTP 状态码/常见合法常量/状态枚举自动豁免）
  if (grouped['magic-number-smart']) findings = findings.concat(checkMagicNumberSmart({ file, text, rules: grouped['magic-number-smart'] }));
  findings = findings.concat(checkEmptyCatch({ file, text }));
  findings = findings.concat(checkSyncFsInFile({ file, text }));
  return findings;
}
/**
 * 注释措辞黑名单检查（comment-wording）。
 * 两种模式（2026-09-13 约定：关键词取消分数制）：
 *   - blocker 模式（规则 severity=blocker）：白名单命中 → 该行豁免不拦截；黑名单任一命中 → 直接 blocker。
 *     不再计分/不再累计阈值——白名单放行、黑名单拦截，二值判定。
 *   - 普通模式（其余规则）：保留历史分数制（blacklist 加分 + whitelist 减分 + additional_features 加分，
 *     单行超阈值报 warning/notice）。
 */
export function checkBlacklist({ file, text, rules }) {
  const findings = [];
  const lines = text.split('\n');
  for (const rule of rules || []) {
    const black = (rule.blacklist || []).map((b) => ({ re: safeRe(b.pattern, rule.name || rule.id), weight: Number(b.weight) || 0, pattern: b.pattern }))
      .filter((b) => b.re);
    const white = (rule.whitelist || []).map((w) => ({ re: safeRe(w.pattern, rule.name || rule.id), penalty: Number(w.penalty) || 0 }))
      .filter((w) => w.re);
    const feats = (rule.additionalFeatures || []).map((a) => ({ re: safeRe(a.pattern, rule.name || rule.id), weight: Number(a.weight) || 0 }))
      .filter((a) => a.re);
    const threshold = Number(rule.threshold) || 40;

    // —— blocker 模式：白名单豁免 + 黑名单直拦（取消分数制）——
    if (rule.severity === 'blocker') {
      lines.forEach((line, idx) => {
        if (white.some((w) => w.re.test(line))) return; // 白名单命中 → 整行豁免
        const hit = black.find((b) => b.re.test(line));
        if (!hit) return;
        findings.push(makeFinding({
          file, line: idx + 1, rule: rule.id, kind: 'blacklist',
          severity: 'blocker',
          message: `${rule.name || rule.id}（命中黑名单词「${hit.pattern}」）`,
          dimensions: rule.dimensions || ['文档'],
          exemptHint: 'dsh-skip-quality（文件头=整文件）',
          scoreImpact: 2,
        }));
      });
      continue;
    }

    // —— 普通模式：历史分数制 ——
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
    // 2026-09-13 修误报：旧实现要求 .gitignore **含全部** required_patterns
    //   （node_modules/dist/build/coverage/*.log/.env）——纯 JS 零依赖插件没有构建
    //   产物，dist/build/coverage/.env 根本不存在，报「缺少忽略项」属误报。
    //   正确语义：只报「仓库里**实际存在**的产物目录/文件」还没被忽略的项。
    if (Array.isArray(rule.requiredPatterns) && gitignoreText) {
      const lines = gitignoreText.split('\n').map((l) => l.trim());
      const isIgnored = (p) => lines.some((l) => l === p || l === p.replace(/^\*/, '') || l.replace(/\/$/, '') === p);
      const missing = rule.requiredPatterns.filter((p) => {
        if (isIgnored(p)) return false;                 // 已忽略 → 无需报
        // 未忽略：仅当该项在仓库里实际存在时才报（不存在则本项目本就不需要忽略它）
        const probe = p.replace(/^\*/, '').replace(/^\//, '');
        const hitDir = dirs.some((d) => {
          const rel = d.full.replace(root, '').replace(/^\//, '');
          return rel === probe || rel.startsWith(`${probe}/`);
        });
        const hitFile = existsSync(join(root, probe));
        return hitDir || hitFile;
      });
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
 * 对 package.json 做真实解析判定（替代「命中即提示」弱 pattern）：
 *   - npm/files-missing-lib：main/exports 指向 lib/ 下入口时，files 数组须包含 lib（或对应入口文件）
 *   - npm/undeclared-js-yaml：lib 代码 import 'js-yaml' 时，dependencies 须已声明（文件级仅能验 dependencies 存在性；
 *     import 证据属全仓语义，证据法见规则描述，文件级 fallback 只验「dependencies 含 js-yaml」）
 * 仅对扩展名为 json 且文件名为 package.json 的目标执行。
 */
/**
 * 在 package.json 文本里定位某个键（或含某个值的行）的行号，供 finding 定位。
 * 找不到时回退第 1 行。
 * @param {string} text package.json 全文
 * @param {string} key 键名（如 'files'）
 * @param {string} [valueHint] 值片段（用于定位具体条目行）
 * @returns {number} 1-based 行号
 */
function findJsonKeyLine(text, key, valueHint) {
  const lines = String(text || '').split('\n');
  if (valueHint) {
    const i = lines.findIndex((l) => l.includes(valueHint));
    if (i >= 0) return i + 1;
  }
  const j = lines.findIndex((l) => new RegExp(`"${key}"\\s*:`).test(l));
  return j >= 0 ? j + 1 : 1;
}

export function checkNpmJson({ file, text, rules, repoHasJsYamlImport, repoPath }) {
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
      // 规则语义 =「import 了 js-yaml 但未声明依赖」。全仓没有任何
      // js-yaml import/require 时（零依赖项目），文件级 fallback 不应报——
      // 否则每个零依赖插件的 package.json 都被误报 blocker（纯净安装根本不会
      // 出现 Cannot find module 'js-yaml'，因为没有代码引用它）。
      if (repoHasJsYamlImport && !deps['js-yaml']) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'npm-json',
          severity: sev,
          message: `${rule.message || rule.name}（dependencies/devDependencies 均未声明 js-yaml）`,
          dimensions: rule.dimensions || ['可部署性'],
          exemptHint: 'dsh-skip-sensitive（文件头=整文件）',
          scoreImpact: sev === 'blocker' ? 2 : 1,
        }));
      }
    } else if (rule.id === 'npm/license-field-check') {
      // 2026-09-13：真实判定——license 字段缺失才报。
      //   旧实现是 pattern「命中 "version" 行即提示核对」，任何 package.json 都命中
      //   → 对已声明 license 的包恒定误报（规则名/描述与实际判定不符）。
      const lic = pkg.license;
      const hasLicense = (typeof lic === 'string' && lic.trim() !== '')
        || (Array.isArray(lic) && lic.length > 0);
      if (!hasLicense) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'npm-json',
          severity: sev,
          message: `${rule.message || rule.name}（package.json 缺 license 字段）`,
          dimensions: rule.dimensions || ['可部署性'],
          exemptHint: 'dsh-skip-sensitive（文件头=整文件）',
          scoreImpact: sev === 'blocker' ? 2 : 1,
        }));
      }
    } else if (rule.id === 'npm/repository-field-check') {
      // 2026-09-13：真实判定——repository 字段缺失才报（旧实现命中 "homepage" 即报）。
      const repo = pkg.repository;
      const hasRepo = (typeof repo === 'string' && repo.trim() !== '')
        || (repo && typeof repo === 'object' && typeof repo.url === 'string' && repo.url.trim() !== '');
      if (!hasRepo) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'npm-json',
          severity: sev,
          message: `${rule.message || rule.name}（package.json 缺 repository 字段）`,
          dimensions: rule.dimensions || ['可部署性'],
          exemptHint: 'dsh-skip-sensitive（文件头=整文件）',
          scoreImpact: sev === 'blocker' ? 2 : 1,
        }));
      }
    } else if (rule.id === 'npm/files-suspicious-entry') {
      // 2026-09-13：真实判定——files 数组里逐条核对路径是否存在。
      //   旧实现是 pattern「命中 "files": [ 或 "audit-rules" 即报」，任何有 files
      //   白名单的包都报（规则本意是查「条目路径写错导致漏打包」）。
      const files = Array.isArray(pkg.files) ? pkg.files : null;
      if (files && files.length) {
        const repoRoot = repoPath;
        for (const entry of files) {
          if (typeof entry !== 'string' || !entry.trim()) continue;
          if (!repoRoot) break; // 无仓库根时不做判定（避免臆测路径）
          const clean = entry.replace(/^\.\//, '').replace(/\/$/, '');
          const abs = join(repoRoot, clean);
          if (!existsSync(abs)) {
            const line = findJsonKeyLine(text, 'files', entry);
            findings.push(makeFinding({
              file, line, rule: rule.id, kind: 'npm-json',
              severity: sev,
              message: `${rule.message || rule.name}（files 条目「${entry}」在仓库中不存在）`,
              dimensions: rule.dimensions || ['可部署性'],
              exemptHint: 'dsh-skip-sensitive（文件头=整文件）',
              scoreImpact: sev === 'blocker' ? 2 : 1,
            }));
            break; // 同一 package.json 只报一次（避免逐条刷屏）
          }
        }
      }
    }
  }
  return findings;
}


/**
 * 私密文件拦截检查（private 槽位，1.0.4，T1-T33 考古验收）。
 * git ls-files 列全部跟踪文件 × private_files glob 匹配，按远端可见性分级：
 *   visibility=public → blocker（私钥/凭据已可被任何人获取，禁止推送）
 *   visibility=private|unknown → warning（私有边界内仅提醒，转公开前须先移除）
 * @param {object} p { root, visibility, privateFiles[] } visibility: 'public'|'private'|'unknown'
 * @returns {Array} findings
 */
export function checkPrivateFiles({ root, visibility = 'unknown', privateFiles = [] }) {
  const findings = [];
  if (!root || !Array.isArray(privateFiles) || privateFiles.length === 0) return findings;
  let tracked;
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    tracked = out.split('\n').filter(Boolean);
  } catch { return findings; } // 非 git 仓库 / git 不可用 → 跳过
  if (!tracked.length) return findings;
  const compiled = privateFiles
    .map((g) => ({ glob: g, re: globToRegex(g) }))
    .filter((x) => x.re);
  const hits = [];
  for (const p of tracked) {
    for (const pf of compiled) {
      if (pf.re.test(p)) { hits.push(p); break; }
    }
  }
  if (!hits.length) return findings;
  const publicGate = visibility === 'public';
  for (const p of hits) {
    findings.push(makeFinding({
      file: p, line: 1, rule: publicGate ? 'private-file-public' : 'private-file-in-repo',
      kind: 'private-files',
      severity: publicGate ? 'blocker' : 'warning',
      message: publicGate
        ? `仓库跟踪私密文件 ${p} 且远端公开（public）——私钥/凭据已可被任何人获取，禁止推送；请移除该文件或转为私有仓库`
        : `仓库跟踪私密文件 ${p}（远端 ${visibility === 'private' ? '私有' : '未确认'}）；私有边界内仅提醒，若未来转公开请先移除`,
      dimensions: ['安全性', '可部署性'],
      exemptHint: 'dsh-skip-sensitive（文件头=整文件）',
      scoreImpact: publicGate ? 1 : 0,
    }));
  }
  return findings;
}

/* ═══════════════ 按钮事件绑定检查（button-bind，2026-09-11 油猴脚本版） ═══════════════ */

/**
 * 油猴脚本/浏览器扩展按钮事件绑定交叉比对（同文件内）。
 * 场景：HTML 以字符串形式内嵌在 JS（innerHTML=/insertAdjacentHTML/模板字符串/createElement），
 * 事件在 JS 里用 addEventListener/onclick= 赋值绑定——不能只看 HTML 里有没有 inline onclick。
 *
 * 三步：
 *   1. 从 JS 文本提取「HTML 字符串中的按钮」（inline onclick 降级 info 不计为绑定证据）
 *   2. 从同一文本提取「绑定证据」：addEventListener('click' / .onclick= 赋值 / 自定义 on* 函数调用 pattern
 *   3. 交叉比对：按钮 id/class/text 能在绑定证据中找到 → 已绑定；找不到 → unbound warning
 *
 * 只报 warning 不阻断（手工确认绑定方式），inline onclick 场景报 info 建议。
 * 输入规则约定（yml 声明 kind: button-bind，或 category: 'button' 无 patterns）：
 *   - rule.extra.buttonInsertPatterns / bindPatterns 可选覆盖（默认内置油猴常用模式）
 * @param {object} opts { file, text, rules }
 * @returns {Array} findings
 */
export function checkButtonBindings({ file, text, rules }) {
  const findings = [];
  if (!text) return findings;

  const btns = [];
  const binds = new Set();
  let hasDelegation = false;

  // ── 1. 提取 HTML 字符串中的按钮 ──
  // innerHTML='...' 或 innerHTML="..."（含模板字符串反引号）
  const htmlChunks = [];
  const chunkRe = /(?:innerHTML|outerHTML|insertAdjacentHTML\s*\([^)]*\))\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  let m;
  while ((m = chunkRe.exec(text)) !== null) {
    htmlChunks.push({ html: m[1], start: m.index });
  }
  // 模板字符串里的 <button ...>...</button>（不局限于 innerHTML 赋值）
  const tplChunks = [];
  const tplRe = /`[^`]*<button[^`]*`/g;
  while ((m = tplRe.exec(text)) !== null) tplChunks.push({ html: m[0], start: m.index });

  const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button\s*>|<input\b[^>]*type\s*=\s*['"](?:button|submit)['"][^>]*>/gi;
  // JSX/React 事件属性（onClick=/onChange= 等驼峰 on[A-Z]）→ 声明式绑定，视为已绑定（防 React 代码误报 unbound）
  const jsxEventRe = /\bon[A-Z][\w]*\s*=\s*[\{'"`]/;
  for (const chunk of [...htmlChunks, ...tplChunks]) {
    let bm;
    while ((bm = btnRe.exec(chunk.html)) !== null) {
      const attrs = bm[1] || '';
      const line = text.slice(0, chunk.start + bm.index).split('\n').length;
      btns.push({
        line,
        id: (attrs.match(/\bid=["']([^"']+)["']/i) || [])[1] || '',
        class: (attrs.match(/\bclass=["']([^"']+)["']/i) || [])[1] || '',
        text: (bm[2] || '').replace(/<[^>]*>/g, '').trim().slice(0, 30),
        hasInline: /\bonclick\s*=/.test(attrs),
        jsxBound: jsxEventRe.test(attrs), // React 声明式事件（onClick 等驼峰）
      });
    }
  }
  // createElement('button') 创建的按钮：后续调用 addEventListener 才算绑定
  const created = [];
  const createRe = /createElement\s*\(\s*['"](button|input)['"]\s*\)/g;
  while ((m = createRe.exec(text)) !== null) {
    created.push({ line: text.slice(0, m.index).split('\n').length, tag: m[1] });
  }

  // ── 2. 提取绑定证据（选择器引用 + 绑定调用 + 事件委托）──
  // 覆盖：getElementById / querySelector / querySelectorAll（含属性选择器）/ jQuery $() / .onclick= / .addEventListener('click'
  const bindRe = /(?:getElementById\s*\(\s*['"]([^'"]+)['"]|querySelector(?:All)?\s*\(\s*['"]([^'"]+)['"]|\$\s*\(\s*['"]([^'"]+)['"]|\.addEventListener\s*\(\s*['"]click['"]|\.onclick\s*=|\.on\s*\(\s*['"\]click['"])/g;
  while ((m = bindRe.exec(text)) !== null) {
    for (const sel of [m[1], m[2], m[3]]) {
      if (sel) binds.add(sel);
      if (sel && sel.startsWith('#')) binds.add(sel.slice(1)); // #id 同时存 id
      if (sel && sel.startsWith('.')) binds.add(sel); // .class 已存；供 class 匹配
    }
    if (m[0].includes('addEventListener') || m[0].includes('.onclick') || m[0].includes('.on(')) binds.add('__has_click_handler__');
  }
  // 事件委托识别（更宽）：父级 .addEventListener('click' + e.target.closest('选择器') 任一出现即视为委托面
  // 覆盖：document.body.addEventListener('click' / container.addEventListener('click' / ev.target.closest('.btn') 分发
  const delegationRe = /\.addEventListener\s*\(\s*['"]click['"]|\.closest\s*\(\s*['"][^'"]+['"]\)/g;
  if (delegationRe.test(text)) hasDelegation = true;
  // 委托分发选择器（ev.target.closest('.mm-retry-btn')）也入 binds——按 class 匹配绑定面
  const closestRe = /\.closest\s*\(\s*['"]([^'"]+)['"]\)/g;
  while ((m = closestRe.exec(text)) !== null) {
    if (m[1]) binds.add(m[1]);
    if (m[1] && m[1].startsWith('#')) binds.add(m[1].slice(1));
  }
  // 属性选择器引用（querySelectorAll("button[data-dl]")）→ 按钮 data-* 匹配用
  const attrSelRe = /querySelector(?:All)?\s*\(\s*['"]([^'"]*(?:\[[a-z-]+\][^'"]*)?)['"]\)/g;
  while ((m = attrSelRe.exec(text)) !== null) {
    const ms = m[1]?.match(/\[([a-z][\w-]*)\]/g) || [];
    for (const at of ms) binds.add(at); // [data-dl] 等原样存入
  }

  // ── 3. 交叉比对 ──
  for (const btn of btns) {
    // JSX/React 声明式事件：onClick 等驼峰属性 = 已绑定（React 虚拟 DOM 内声明式，非油猴场景）
    if (btn.jsxBound) continue;
    // inline onclick：有绑定但建议改（info）
    if (btn.hasInline) {
      findings.push(makeFinding({
        file, line: btn.line, rule: 'button/inline-binding-in-string', kind: 'button-bind',
        severity: 'notice',
        message: `油猴脚本 HTML 字符串中的按钮含 inline onclick（行 ${btn.line}）：通常无法访问闭包作用域且易违反 CSP，建议改 addEventListener/事件委托`,
        dimensions: ['可读性'], exemptHint: 'dsh-skip-quality（文件头=整文件）', scoreImpact: 0,
      }));
      continue;
    }
    // 事件委托覆盖：父级监听了 click（含 closest 分发）→ 默认视为已覆盖
    if (hasDelegation) continue;
    let matched = false;
    if (btn.id && (binds.has(btn.id) || binds.has(`#${btn.id}`))) matched = true;
    if (!matched && btn.class) {
      for (const cls of btn.class.split(/\s+/)) {
        if (cls && binds.has(`.${cls}`)) { matched = true; break; }
      }
    }
    if (!matched && created.length) {
      // createElement 按钮：要求同一文件存在 addEventListener/onclick 痕迹
      matched = binds.has('__has_click_handler__');
    }
    if (!matched) {
      findings.push(makeFinding({
        file, line: btn.line, rule: 'button/unbound', kind: 'button-bind',
        severity: 'warning',
        message: `按钮「${btn.text || btn.id || '(无文本)'}」（行 ${btn.line}）在 HTML 字符串中但未在 JS 中找到绑定证据——若通过事件委托/封装函数绑定请加豁免标记`,
        dimensions: ['可维护性'], exemptHint: 'dsh-skip-quality（文件头=整文件）', scoreImpact: 1,
      }));
    }
  }
  // createElement('button'/'input') 创建的按钮：文件无任何点击绑定痕迹 → 未绑定
  if (created.length && !binds.has('__has_click_handler__')) {
    const lineNos = [...new Set(created.map((c) => c.line))].sort((a, b) => a - b);
    findings.push(makeFinding({
      file, line: lineNos[0], rule: 'button/create-element-binding', kind: 'button-bind',
      severity: 'warning',
      message: `createElement('${created[0].tag}') 创建了按钮（行 ${lineNos.join('/')}）但同文件未找到 addEventListener/onclick 绑定——请在 appendChild 前绑定事件`,
      dimensions: ['可维护性'], exemptHint: 'dsh-skip-quality（文件头=整文件）', scoreImpact: 1,
    }));
  }
  return findings;
}

/* ───────────────────────── 硬编码魔数检测（kind=magic-number-smart，实现见 lib/score/ast.js） ───────────────────────── */

/**
 * 硬编码魔数检测（薄包装）：具体实现在 lib/score/ast.js 的 checkMagicNumberSmartAst（token 级），
 * 本函数只把命中结果转成统一 finding 对象。
 *
 * 规则声明在 lib/audit-rules/audit-rules-nodejs.yml（readability/magic-number-smart）。
 * token 级实现从根上区分「代码里的数字字面量」与「注释/字符串里的数字」——
 * 注释版本号（// v1.8.0）、CSS 字号、i18n 字典值不再误报，无需任何「跳过行」补丁。
 */
export function checkMagicNumberSmart({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
  if (!rule) return findings;
  const opts = {
    magicHints: rule.magicHints,
    legitHints: rule.legitHints,
    forceCount: rule.forceCount,
  };
  for (const hit of checkMagicNumberSmartAst(text, opts)) {
    findings.push(makeFinding({
      file, line: hit.line, rule: rule.id || 'readability/magic-number-smart', kind: 'magic-number-smart',
      severity: rule.severity || 'warning',
      message: `硬编码魔数「${hit.raw}」（${hit.count >= (rule.forceCount || 3) ? `文件内出现 ${hit.count} 次，疑似魔数` : '出现在 timeout/limit/size 等数值上下文'}）——建议提取为命名常量并注释含义；版本号/日期/HTTP 状态码/常见合法常量/注释与字符串内数字自动豁免`,
      dimensions: rule.dimensions || ['可维护性'], exemptHint: 'dsh-skip-quality（文件头=整文件）', scoreImpact: 1,
    }));
  }
  return findings;
}


/** 文件健康度矩阵评分（1.0.13）：行数×40% + 大小×35% + 行长×25% → 加权等级 → 插值扣分 → score/10。
 * 豁免：generated./.min./locales/ 跳过；constants/ 行数等级强制 0；routes/ 行数阈值放宽（等级-1，最小0）。
 * 输出：score<blockScore → blocker；score<warnScore → warning；否则 pass（不产出 finding）。
 * 诊断 message 含三维等级/得分/verdict/优先处理维度，可直接展示。 */
export function checkFileHealth({ file, relPath, text, rules }) {
  const findings = [];
  const rule = rules?.[0];
  if (!rule) return findings;
  const x = rule; // ruleOut 把 extra 展开进 rule 顶层（无 rule.extra 属性）
  const rel = relPath || file || '';
  // 豁免判定：相对路径可能是 'constants/table.js' 或 '/constants/table.js'，模式统一匹配两种形态
  const relNorm = rel.startsWith('/') ? rel : '/' + rel;
  // 跳过类（generated/min/locales）——先试精确（如 .generated. 可命中文件名），再试带斜杠（目录形态）
  if ((x.exemptSkip || []).some((p) => p.includes('/') ? relNorm.includes(p) : rel.includes(p))) return findings;
  // 行数豁免类（constants）：行数等级强制 0
  const constMode = (x.exemptConstants || []).some((p) => p.includes('/') ? relNorm.includes(p) : rel.includes(p));
  // 行数阈值放宽类（routes）：行数等级减 1
  const routesMode = (x.exemptRoutes || []).some((p) => p.includes('/') ? relNorm.includes(p) : rel.includes(p));

  const lines = text.split('\n');
  const lineCount = lines.length;
  const sizeKb = Buffer.byteLength(text, 'utf8') / 1024;
  let maxLen = 0;
  for (const ln of lines) { if (ln.length > maxLen) maxLen = ln.length; }

  const levelOf = (val, levels) => {
    for (let i = 0; i < levels.length; i++) if (val <= levels[i]) return i;
    return levels.length;
  };
  let linesLevel = levelOf(lineCount, x.lineLevels || [200, 400, 800, 1500]);
  const sizeLevel = levelOf(sizeKb, x.sizeLevels || [30, 100, 300, 1000]);
  const lenLevel = levelOf(maxLen, x.lengthLevels || [120, 200, 300, 500]);
  if (constMode) linesLevel = 0;                       // constants：行数豁免
  if (routesMode) linesLevel = Math.max(0, linesLevel - 1); // routes：行数阈值放宽

  const w = {
    lines: x.weightLines !== undefined ? x.weightLines : 0.40,
    size: x.weightSize !== undefined ? x.weightSize : 0.35,
    len: x.weightLineLength !== undefined ? x.weightLineLength : 0.25,
  };
  const weighted = linesLevel * w.lines + sizeLevel * w.size + lenLevel * w.len;
  // 扣分插值：penalties[i] 对应等级 i；小数等级按相邻线性插值
  const penalties = x.penalties || [0, 1.0, 2.5, 4.5, 7.0];
  const lo = Math.floor(weighted);
  const hi = Math.min(lo + 1, penalties.length - 1);
  const frac = weighted - lo;
  const penalty = penalties[lo] + (penalties[hi] - penalties[lo]) * frac;
  const base = x.baseScore !== undefined ? x.baseScore : 10;
  const score = Math.max(0.1, base - penalty);

  const warnScore = x.warnScore !== undefined ? x.warnScore : 9;
  const blockScore = x.blockScore !== undefined ? x.blockScore : 5;
  if (score >= warnScore) return findings; // 健康：不产出

  // 优先处理维度 = 等级最高的维度（并列取首个）
  const dims = [['行数', linesLevel], ['大小', sizeLevel], ['行长', lenLevel]].sort((a, b) => b[1] - a[1]);
  const top = dims[0];
  const sev = score < blockScore ? 'blocker' : 'warning';
  const label = ['优秀', '良好', '警戒', '危险', '严重'];
  // 2026-09-13 修 bug：总分标签曾硬编码「🟠 危险」，导致 8.4/10（刚低于 warn_score 9 的
  //   提示阈值）也被写成「危险」，与规则文档「score≥9 健康，<9 提示拆分，<5 blocker」不符。
  //   现按分数区间给档：<block_score 严重 / <(block+warn)/2 危险 / 其余 提示（轻度）。
  const mid = (blockScore + warnScore) / 2;
  const scoreTag = score < blockScore ? '🔴 严重' : (score < mid ? '🟠 危险' : '🟡 提示');
  findings.push(makeFinding({
    file, line: 1, rule: rule.id || 'maintainability/file-health', kind: 'file-health',
    severity: sev,
    message: `文件健康度 ${score.toFixed(1)}/10（${scoreTag}）：`
      + `行数 ${lineCount}→L${linesLevel}(${label[linesLevel]})、大小 ${sizeKb.toFixed(1)}KB→L${sizeLevel}(${label[sizeLevel]})、`
      + `最大行长 ${maxLen}→L${lenLevel}(${label[lenLevel]})；优先处理：${top[0]}（L${top[1]}）`,
    dimensions: rule.dimensions || ['可维护性', '可读性'],
    exemptHint: 'dsh-skip-quality（文件头=整文件）', scoreImpact: sev === 'blocker' ? 2 : 1,
  }));
  return findings;
}

