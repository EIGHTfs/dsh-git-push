/**
 * `.auditignore` 的**细粒度豁免**解析与匹配（文件 : 规则）。
 *
 * 为什么需要这一档：`.auditignore` 原先只有「整文件跳过」一种力度，而实际需求常是
 *   「这个文件的其他规则照审，只免某一类」。典型场景：
 *     · 权重/参数表文件（`lib/score/index.js`）：数字是「维度名 → 参数」映射值，
 *       键名已表意，拆成常量反而割裂表格 ⇒ 只想免 magic-number，别的照报；
 *     · 通用字符串数据表（`plugins/x/lib/common-strings.js`）：同理；
 *     · 跨文件看门狗：单文件里看不到超时设置（真实设置在宿主侧），静态分析无法识别。
 *   旧做法只能整文件豁免 ⇒ 连带把可读性/健壮性问题一起藏起来，事实消失、不可追溯。
 *
 * 语法（在现有 gitignore 语法之上**追加**一行后缀，旧条目行为完全不变）：
 *     # 整文件 / 整目录跳过（原有语义）
 *     lib/score/index.js
 *     .archify/*.html
 *
 *     # 细粒度：路径 + " : " + 规则（逗号分隔，支持 slot/* 通配）+ 可选 # 理由
 *     lib/score/index.js : readability/magic-number-smart   # 权重参数表，键名已表意
 *     test/lib/wait-ready.mjs : robustness/*, paths/hardcoded-absolute-path
 *
 * 解析保护（避免与既有写法冲突）：冒号后**每一段都必须形如 `slot/rule`**（允许 `*`），
 *   否则整行按文件模式处理。这样 `C:\Users\x`、`https://x/y`、`a:b` 这类既有内容
 *   不会被误判成细粒度规则。
 *
 * 生效方式：细粒度条目不参与「采集阶段跳过」，而是在 finding 产出后**标记**为
 *   `exempted: true`（不扣分、不进 warning 计数），并在报告里单列一节列出理由——
 *   既保留可追溯性，也不让「已确认豁免」与「未处理」混在一起。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { isIgnoredByRules, parseGitignore } from './gitignore-match.js';

/** 规则段的合法形态：`slot/rule`，允许 `*` 通配（如 `robustness/*`）。 */
const RULE_SEGMENT_RE = /^[a-z][a-z0-9-]*\/[a-z0-9*][a-z0-9*/-]*$/;
/** 细粒度分隔符：冒号**两侧各一个空格**。刻意不用裸 `:` —— Windows 盘符与 URL 都含它。 */
const SEPARATOR = ' : ';

/**
 * 把一行拆成「文件模式 + 规则段 + 理由」。
 * @returns {{filePattern:string, rulePatterns:string[], reason:string}|null} 不是细粒度行时返回 null
 */
export function parseScopedLine(line) {
  const raw = String(line || '');
  if (!raw.trim() || raw.trim().startsWith('#')) return null;
  const at = raw.indexOf(SEPARATOR);
  if (at <= 0) return null;
  // 注意：理由分隔（#）在**规则段内**处理——文件模式里出现 # 是合法 gitignore 字符
  const afterSeparator = raw.slice(at + SEPARATOR.length);
  const hashAt = afterSeparator.indexOf('#');
  const rulePart = (hashAt === -1 ? afterSeparator : afterSeparator.slice(0, hashAt)).trim();
  const reason = hashAt === -1 ? '' : afterSeparator.slice(hashAt + 1).trim();
  const filePattern = raw.slice(0, at).trim();
  if (!filePattern || !rulePart) return null;
  const rulePatterns = rulePart.split(',').map((s) => s.trim()).filter(Boolean);
  if (!rulePatterns.length) return null;
  // 任一段不像规则 id ⇒ 不是细粒度行（防止旧写法被误解析）
  if (!rulePatterns.every((p) => RULE_SEGMENT_RE.test(p))) return null;
  return { filePattern, rulePatterns, reason };
}

/**
 * 把一个 `.auditignore` 文本拆成两部分。
 * @param {string} text 文件原文
 * @returns {{wholeText:string, scoped:Array<{filePattern:string, rulePatterns:string[], reason:string, rules:object[]}>}}
 *   wholeText = **去掉细粒度行**后的文本（供采集阶段使用：这些文件不能被整文件跳过）
 */
export function splitAuditIgnore(text = '') {
  const scoped = [];
  const kept = [];
  for (const line of String(text).split('\n')) {
    const hit = parseScopedLine(line);
    if (!hit) { kept.push(line); continue; }
    let rules = [];
    try { rules = parseGitignore(hit.filePattern); } catch { rules = []; }
    if (!rules.length) { kept.push(line); continue; }   // 文件模式解析不出 ⇒ 退回整行（保守）
    scoped.push({ ...hit, rules });
  }
  return { wholeText: kept.join('\n'), scoped };
}

/** 规则模式（可含 `*`）是否命中某条 finding 的规则 id。 */
export function ruleMatches(pattern, ruleId) {
  const p = String(pattern || '');
  const id = String(ruleId || '');
  if (!p || !id) return false;
  if (!p.includes('*')) return p === id;
  // 只支持 `*`（不引入正则元字符，避免用户写 `[` 造成非法正则）
  const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(id);
}

/**
 * 判断某条 finding 是否被细粒度豁免覆盖。
 * @param {Array} scoped splitAuditIgnore 的 scoped 结果
 * @param {string} relPath 相对仓库根的路径（/ 分隔）
 * @param {string} ruleId finding 的 rule
 * @returns {{hit:boolean, reason:string, filePattern:string}}
 */
export function matchScopedExemption(scoped, relPath, ruleId) {
  const path = String(relPath || '').replace(/\\/g, '/');
  for (const it of Array.isArray(scoped) ? scoped : []) {
    if (!it.rules?.length) continue;
    if (!isIgnoredByRules(it.rules, path, false)) continue;
    if (!it.rulePatterns.some((p) => ruleMatches(p, ruleId))) continue;
    return { hit: true, reason: it.reason || '', filePattern: it.filePattern };
  }
  return { hit: false, reason: '', filePattern: '' };
}

/** 文本里是否存在细粒度条目（采集阶段据此决定要不要换 excludesFile）。 */
export function hasScopedEntries(text = '') {
  return splitAuditIgnore(text).scoped.length > 0;
}

/**
 * 把细粒度豁免应用到 findings 上：**标记而非丢弃**。
 *
 * 为什么不丢弃：丢弃会让「已确认豁免」与「未处理」在报告里无法区分（这正是要解决的问题）。
 *   标记后计分/汇总跳过它们，但报告能单列一节列出「豁免了哪条、为什么」。
 * @param {Array} findings 统一问题对象（原地修改）
 * @param {string} root 仓库根
 * @returns {{total:number, byRule:Record<string,number>}}
 */
export function applyScopedExemptions(findings = [], root = '') {
  const byRule = {};
  let total = 0;
  let scoped = [];
  try {
    const p = join(root, '.auditignore');
    if (existsSync(p)) scoped = splitAuditIgnore(readFileSync(p, 'utf8')).scoped;
  } catch { scoped = []; }
  if (!scoped.length) return { total, byRule };
  for (const f of findings) {
    if (f.exempted) continue;
    const raw = String(f.file || '');
    const rel = raw ? (raw.startsWith('/') ? relative(root, raw) : raw).replace(/\\/g, '/') : '';
    if (!rel) continue;
    const hit = matchScopedExemption(scoped, rel, f.rule);
    if (!hit.hit) continue;
    f.exempted = true;
    f.exemptBy = 'auditignore';
    f.exemptReason = hit.reason;
    total += 1;
    byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  }
  return { total, byRule };
}
