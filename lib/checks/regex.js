/**
 * 检查层 · 正则类规则
 *
 * 职责：跑 compiled regex/path-regex/blacklist 规则，把命中转成 finding。
 * 正则只做初筛；需要语义确认的规则在此消费 astConfirm 精筛集合（见 common.js），
 *   避免「正则命中即报」造成误报。
 */

import { makeCodeLineFilter, checkMagicNumberSmartAst } from '../ast/index.js';

import { makeFinding } from '../audit/index.js';
import { safeRe } from '../rule/compilers.js';
import { capSeverity } from './common.js';
import { credentialValueLines, placeholderCredentialLines, shortFuncNameLines, smallFileReadLines, smartHitLines, shellCdDynamicLines, writeIntoGitignoredLines } from './common.js';

/** 检查文本是否符合 regex 型规则（regex / secret / credential-ref）。
 * @param {object} args { file, text, rules, source? , repoPath? } repoPath：仓库根（写目标命中 .gitignore 的精筛需要） */
export function checkRegexRules({ file, text, rules, source = '新增行', repoPath = '' }) {
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
    //   token 判定（lib/ast/code-lines.js 的 makeCodeLineFilter）确认是否真在代码里，
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
    // 2026-09-16：readability/magic-number（唯一声明 astConfirm: magic-number 的规则）已合并进
    //   magic-number-smart；本分支保留机制（自定义规则包可复用），当前无内置规则消费。
    const magicSmartLines = rule.astConfirm === 'magic-number' ? smartHitLines(text) : null;
    // 2026-09-13：具名精筛 astConfirmKind —— 规则声明「命中后还要 AST 确认什么」。
    //   两种语义：deny = 集合内的行豁免（如 small-file-read 的受控小文件）；
    //   allow = 只有集合内的行才报（如 short-func-name 的 token 级短名判定）。
    let kindFilter = null;
    if (rule.astConfirmKind === 'small-file-read') kindFilter = { mode: 'deny', lines: smallFileReadLines(text) };
    else if (rule.astConfirmKind === 'short-func-name') kindFilter = { mode: 'allow', lines: shortFuncNameLines(text) };
    else if (rule.astConfirmKind === 'credential-value') kindFilter = { mode: 'allow', lines: credentialValueLines(text) };
    // 前缀型密钥串（ghp_/sk-/AKIA）的占位符精筛：命中行是「演示值/占位文案」时豁免
    else if (rule.astConfirmKind === 'placeholder-credential') kindFilter = { mode: 'deny', lines: placeholderCredentialLines(text) };
    // 2026-09-14：shell 健壮性精筛（folder/cd-to-maybe-missing：cd 到动态路径且无兜底）
    else if (rule.astConfirmKind === 'shell-cd-dynamic') kindFilter = { mode: 'allow', lines: shellCdDynamicLines(text) };
    // 2026-09-14：目录健壮性精筛（folder/write-into-gitignored-dir：写目标命中 .gitignore，需 repoPath 上下文）
    else if (rule.astConfirmKind === 'write-into-gitignored') kindFilter = { mode: 'allow', lines: writeIntoGitignoredLines(text, repoPath) };
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
      for (const wEntry of white) if (wEntry.re.test(line)) score -= wEntry.penalty;
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
