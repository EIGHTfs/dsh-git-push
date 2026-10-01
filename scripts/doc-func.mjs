#!/usr/bin/env node
/**
 * dsh-git-push — 函数列表文档生成器（doc-func：统一替代 functions-doc + func-index 两个旧脚本——函数清单由 AST 真实生成，避免手工维护漂移）
 * dsh-skip-i18n: 用户可见文案硬编码为产品设计
 *
 * 分体式文档三兄弟之一（doc-tree 文件树 / doc-func 函数列表 / doc-version 版本列表）。
 * 扫描项目 JS/ESM 文件提取函数（name/行号/行数/签名），生成 markdown 函数列表，
 * 写入宿主 md（README 有 dshgp-functions 标记块用 README，否则 docs/ 带块 md）。
 *
 * 用法：
 *   node scripts/doc-func.mjs gen   [--root <项目根>]   # 打印函数列表文本（不写文件）
 *   node scripts/doc-func.mjs apply [--root <项目根>]   # 写入宿主 md（自动探测）
 *   node scripts/doc-func.mjs check [--root <项目根>]   # 比对宿主块与最新列表（漂移报错）
 *   --include <glob> 可选限定扫描范围（缺省 lib/ scripts/ test/ 下的 .js/.mjs）
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMarkedHostMd } from './doc-tree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'dshgp-functions';
const MARK_START = `<!-- ${MARKER}:start -->`;
const MARK_END = `<!-- ${MARKER}:end -->`;
/** 默认扫描目录（可 --include 覆盖）。 */
const DEFAULT_SCAN_DIRS = ['lib', 'scripts', 'test'];

/* ─────────── 函数扫描（自包含，原 func-index 逻辑） ─────────── */

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function stripComment(line) {
  return String(line).replace(/\/\/.*$/, '');
}

/** 从 startIndex 找函数体结束行（括号配对）。 */
function findBlockEnd(lines, startIdx) {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = stripComment(lines[i]);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; }
    }
    if (started && depth <= 0 && i > startIdx) return { end: i, depth };
  }
  return { end: lines.length - 1, depth };
}

function detectFunction(lines, i) {
  const t = stripComment(lines[i]).trim();
  let match = t.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (match) return { name: match[1], kind: 'function', defLine: i };
  match = t.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/);
  if (match) return { name: match[1], kind: 'var-function', defLine: i };
  match = t.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^=)]*?\)\s*=>\s*\{?[^;{}]*\}?;?\s*$/);
  if (match) return { name: match[1], kind: 'arrow', defLine: i };
  return null;
}

/** 扫描单文件 → { file, funcs, totalLines }。 */
export function scanFileFuncs(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { return { file, funcs: [], totalLines: 0, error: e.message }; }
  const lines = text.split('\n');
  const funcs = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    const hit = detectFunction(lines, i);
    if (!hit) continue;
    let bodyStart = i;
    if (!stripComment(lines[i]).includes('{')) {
      // 找 { 所在行（多行签名）。arrow 表达式体（如 `() => 1`）无 { → 单行函数直接收尾。
      if (hit.kind === 'arrow') {
        funcs.push({
          name: hit.name, kind: hit.kind,
          defLine: i + 1, endLine: i + 1, lines: 1,
          signature: String(lines[i] || '').trim(),
        });
        continue;
      }
      let j = i; let depth = 0;
      while (j < lines.length) {
        depth += (stripComment(lines[j]).match(/\{/g) || []).length;
        if (depth > 0) break;
        j++;
      }
      bodyStart = j;
      if (bodyStart >= lines.length) continue;
    }
    const { end } = findBlockEnd(lines, bodyStart);
    funcs.push({
      name: hit.name, kind: hit.kind,
      defLine: i + 1, endLine: end + 1, lines: end - i + 1,
      signature: String(lines[i] || '').trim(),
    });
  }
  funcs.sort((a, b) => a.defLine - b.defLine);
  return { file, funcs, totalLines: lines.length };
}

/** 收集扫描文件（root 下 lib/scripts/test 的 .js/.mjs，或 --include 指定目录）。 */
export function collectFuncFiles(root, includeDirs = DEFAULT_SCAN_DIRS) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'docs' || e.name === 'skills') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(js|mjs)$/.test(e.name) && !e.name.endsWith('.min.js')) out.push(full);
    }
  };
  for (const d of includeDirs) walk(join(root, d), 0);
  return out.sort();
}

/** 生成函数列表 markdown（宿主块内容）。 */
export function buildFuncListText(root, includeDirs = DEFAULT_SCAN_DIRS) {
  const files = collectFuncFiles(root, includeDirs);
  const lines = [];
  let total = 0;
  for (const f of files) {
    const r = scanFileFuncs(f);
    if (!r.funcs.length) continue;
    total += r.funcs.length;
    const rel = relative(root, f);
    lines.push(`### ${rel}（${r.totalLines} 行 · ${r.funcs.length} 个函数）`);
    lines.push('');
    lines.push('| 函数 | 行号 | 行数 | 签名 |');
    lines.push('|------|------|------|------|');
    for (const fn of r.funcs) {
      lines.push(`| \`${fn.name}\` | ${fn.defLine}-${fn.endLine} | ${fn.lines} | \`${fn.signature.replace(/\|/g, '\\|')}\` |`);
    }
    lines.push('');
  }
  return { text: `## 函数列表\n\n${lines.join('\n')}`, files: files.length, funcs: total };
}

/** 找宿主 md 内的 dshgp-functions 标记块。 */
function findBlock(text) {
  const s = text.indexOf(MARK_START);
  const e = text.indexOf(MARK_END);
  if (s === -1 || e === -1 || e <= s) return null;
  return { start: s, end: e, content: text.slice(s + MARK_START.length, e) };
}

/** 替换/插入标记块。无块时追加到文件尾。 */
export function applyFuncBlock(text, newContent) {
  const block = findBlock(text);
  if (block) return text.slice(0, block.start) + MARK_START + '\n' + newContent + '\n' + MARK_END + text.slice(block.end + MARK_END.length);
  return text.replace(/\s*$/, '\n') + `\n${MARK_START}\n${newContent}\n${MARK_END}\n`;
}

/** 比对宿主块与最新列表。返回 { ok, issues, latest }。 */
export function checkFuncDrift({ hostPath, root, includeDirs = DEFAULT_SCAN_DIRS } = {}) {
  const { text: latest } = buildFuncListText(root, includeDirs);
  const host = existsSync(hostPath) ? readFileSync(hostPath, 'utf8') : '';
  const block = findBlock(host);
  const issues = [];
  if (!block) issues.push({ type: 'no-block', msg: `${basename(hostPath)} 无函数列表标记块（${MARK_START} … ${MARK_END}），先 apply 生成` });
  else {
    const cur = block.content.trim();
    const expected = latest.trim();
    if (cur !== expected) issues.push({ type: 'drift', msg: `函数列表与最新扫描不一致（运行 doc-func.mjs apply 更新）` });
  }
  return { ok: issues.length === 0, issues, latest };
}

/* ─────────── CLI ─────────── */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const rootIdx = args.indexOf('--root');
  const root = rootIdx !== -1 && args[rootIdx + 1] ? resolve(args[rootIdx + 1]) : ROOT;
  const host = findMarkedHostMd(root, MARKER);
  const out = (msg) => console.log(msg);

  if (cmd === 'gen') {
    const r = buildFuncListText(root);
    out(r.text);
    out(`\n（扫描 ${r.files} 文件 · ${r.funcs} 函数；apply 写入 ${relative(root, host) || 'README.md'}）`);
    process.exit(0);
  }
  if (cmd === 'apply') {
    const r = buildFuncListText(root);
    const hostText = existsSync(host) ? readFileSync(host, 'utf8') : '';
    writeFileSync(host, applyFuncBlock(hostText, r.text), 'utf8');
    out(`✅ 已写入函数列表 → ${relative(root, host) || 'README.md'}（${r.files} 文件 · ${r.funcs} 函数）`);
    process.exit(0);
  }
  if (cmd === 'check') {
    const r = checkFuncDrift({ hostPath: host, root });
    if (r.ok) { out(`✅ 函数列表与扫描一致（${relative(root, host) || 'README.md'}）`); process.exit(0); }
    out('❌ 函数列表存在差异：');
    for (const i of r.issues) out('  - ' + i.msg);
    process.exit(1);
  }
  out('用法: node scripts/doc-func.mjs <gen|apply|check> [--root <项目根>]');
  process.exit(1);
}
