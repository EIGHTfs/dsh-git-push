/**
 * 分层位置（三层审计架构）② 具体实现 lib/ast/*（token 级判定）：
 *   shell 相关精筛——cd 到动态路径、写操作目标命中 .gitignore。
 * 调用包装在 lib/checks/common.js（转成应报行集合后由 regex.js 消费）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeCodeLineFilter } from './code-lines.js';

/**
 * astConfirmKind: "shell-cd-dynamic" 的精筛——cd 到动态路径（$VAR / $(cmd)）且无失败兜底的行。
 * 报出条件（全部满足才报）：
 *   ① 候选行在代码里（注释/字符串内不报）
 *   ② 含 cd 命令且目标含 $（变量/命令替换 → 目录运行时才知道，可能不存在）
 *   ③ 非脚本自我定位（`cd "$(dirname "$0")"` / `"${BASH_SOURCE[0]%/*}"`——目录必然存在，豁免）
 *   ④ 同行无 `||` 兜底（cd ... || exit/return/echo）
 *   ⑤ 非 `&&` 链结尾（cd x && ... 失败即断链）
 * @param {string} text 文件全文
 * @returns {Set<number>} 应报的行号集合
 */
export function shellCdDynamicLines(text) {
  const t = String(text || '');
  const lines = t.split('\n');
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] && /(?:^|[;&])\s*cd\s+\S+/.test(lines[i])) candidates.push(i + 1);
  }
  if (!candidates.length) return new Set();
  const codeFilter = makeCodeLineFilter(t, candidates);
  const out = new Set();
  for (const ln of candidates) {
    const line = lines[ln - 1];
    const match = /(?:^|[;&])\s*cd\s+(\S+)/.exec(line);
    if (!match) continue;
    const target = match[1];
    if (!target.includes('$')) continue; // ② 字面量路径（仓库内存在性由人工/仓库级判定）
    if (/dirname|BASH_SOURCE|%\/\*/.test(target)) continue; // ③ 自我定位豁免
    if (!codeFilter.isCode(ln)) continue; // ① 注释/字符串内不报
    if (/\|\|/.test(line.slice(match.index))) continue; // ④ 有兜底
    if (/&&/.test(line.slice(match.index))) continue; // ⑤ && 链（cd 失败即断链）
    out.add(ln);
  }
  return out;
}

/* ────────────────── .gitignore 解析（轻量版，够规则判定用） ────────────────── */

/** 解析 .gitignore：逐行 → { negate, re }（! 取反 / 目录尾 / glob 通配）。 */
function parseGitignore(text) {
  const patterns = [];
  for (const raw of String(text || '').split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) { negate = true; line = line.slice(1).trim(); }
    if (!line) continue;
    const dirOnly = line.endsWith('/');
    const anchored = line.startsWith('/');
    line = line.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!line) continue;
    let re = '';
    for (const ch of line) {
      if (ch === '*') re += '[^/]*';
      else if (ch === '?') re += '[^/]';
      else if (ch === '.') re = re + '\\.';
      else if ('/\\^$+{}()|'.includes(ch)) re += '\\' + ch;
      else re += ch;
    }
    const tail = dirOnly ? '(?:/|$)' : '(?:/|$)';
    // 含 / 或前导 / 的模式相对仓库根匹配；否则匹配任意层级 basename
    const body = (anchored || line.includes('/')) ? `(?:^|.*/)${re}${tail}` : `(?:^|.*/)${re}${tail}`;
    patterns.push({ negate, re: new RegExp(body) });
  }
  return patterns;
}

/** 目标是否被规则忽略（最后一个匹配生效；! 取反恢复）。 */
function isIgnored(target, patterns) {
  let ignored = false;
  for (const { negate, re } of patterns) {
    if (re.test(target)) ignored = !negate;
  }
  return ignored;
}

/** 从行里提取写操作的目标路径（node 字面量 / shell 命令参数）。 */
function extractWriteTarget(line) {
  const match = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync)\s*\(\s*['"]([^'"]+)['"]/.exec(line);
  if (match && match[2]) return match[2];
  const sh = /(?:^|[;&])\s*mkdir\s+(?:-p\s+)?['"]?([^'"\s]+)['"]?/.exec(line);
  if (sh) return sh[1];
  return '';
}

/**
 * astConfirmKind: "write-into-gitignored" 的精筛——写文件/目录的目标路径命中仓库
 * .gitignore（产出目录被忽略、可能不存在）的行。
 * 依赖仓库上下文 repoPath（读 .gitignore）；无 repoPath（单文件审计）或 .gitignore
 * 不存在时返回空集合（不报——没有仓库上下文不臆测）。
 * 豁免：node_modules 内写入（安装产物）、/tmp 前缀（临时目录）、.gitignore 中 ! 取反。
 * @param {string} text 文件全文
 * @param {string} [repoPath] 仓库根目录（auditFile 传入的 opts.repoPath）
 * @returns {Set<number>} 应报的行号集合
 */
export function writeIntoGitignoredLines(text, repoPath = '') {
  const t = String(text || '');
  if (!t || !repoPath) return new Set();
  const gi = resolve(join(String(repoPath), '.gitignore'));
  if (!existsSync(gi)) return new Set();
  let giText = '';
  try { giText = readFileSync(gi, 'utf8'); } catch { return new Set(); }
  const patterns = parseGitignore(giText);
  if (!patterns.length) return new Set();
  const lines = t.split('\n');
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] && extractWriteTarget(lines[i])) candidates.push(i + 1);
  }
  if (!candidates.length) return new Set();
  const codeFilter = makeCodeLineFilter(t, candidates);
  const out = new Set();
  for (const ln of candidates) {
    const line = lines[ln - 1];
    const target = extractWriteTarget(line);
    if (!target || !codeFilter.isCode(ln)) continue;
    if (/node_modules/.test(target) || /^\/?tmp\b/.test(target)) continue; // 豁免
    if (isIgnored(target, patterns)) out.add(ln);
  }
  return out;
}
