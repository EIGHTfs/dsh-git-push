#!/usr/bin/env node
/**
 * 变量重命名位置定位（2026-09-30，按作用域聚合——对单字母变量人工重命名有帮助）
 *
 * 核心（对齐「按绑定聚合非按名字」方法论，零依赖 token 级近似）：
 *   - 同名但不同作用域的变量语义不同，必须分开重命名——
 *     本工具按 (作用域, 变量名) 聚合：声明点 + 该函数作用域内全部引用行
 *   - 作用域 = 函数区间（复用 lib/ast/scope.js collectFnLineRanges——近似 Babel scope.uid）
 *   - 遮蔽场景：内层函数区间与外层分开（不同函数 = 不同作用域组）
 *
 * 用法：
 *   node scripts/rename-locator.mjs <file> [--name x] [--all-len] [--json]
 *     --name x     只输出变量名 x 的分组（默认输出所有 <2 字符短变量）
 *     --all-len    输出所有长度变量（默认只 <2 单字符）
 *     --json       JSON 输出（供脚本消费）
 *
 * 输出示例：
 *   x @ processUser：声明 L2 · 引用 L3          （一次改完这个函数内全部 x）
 *   x @ calculate：声明 L6 · 引用 L7            （另一个 x，独立一组）
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { tokenize } from '../lib/ast/tokenizer.js';
import { collectFnLineRanges } from '../lib/ast/scope.js';

/** 所在函数名（行号 → 函数名；模块顶层 '(module)'）。 */
function fnNameAtLine(src, line) {
  const m = String(src).split('\n')[line - 1]?.match(/function\s+([A-Za-z_$][\w$]*)/);
  return m ? m[1] : '(anonymous)';
}

/**
 * 按作用域聚合短变量引用位置。
 * @param {string} src 文件全文
 * @param {object} [opts] { name?: string, minLen?: number（默认 2——<2 即单字符） }
 * @returns {Array<{name:string, scopeName:string, declLine:number, refs:number[], count:number}>}
 */
export function locateVariables(src = '', opts = {}) {
  const tokens = tokenize(src);
  const fnRanges = collectFnLineRanges(src);
  const scopeOf = (line) => {
    for (const [s, e] of fnRanges) if (line >= s && line <= e) return fnNameAtLine(src, s);
    return '(module)';
  };
  const minLen = opts.minLen ?? 2;
  const groups = [];
  const seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !['const', 'let', 'var'].includes(t.value)) continue;
    const nx = tokens[i + 1];
    if (!(nx && nx.type === 'ident')) continue;
    if (opts.name) {
      if (nx.value !== opts.name) continue;
    } else if (minLen > 0 && nx.value.length >= minLen) continue;
    const scopeName = scopeOf(nx.line);
    const key = `${nx.value}@${scopeName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // 该作用域区间（函数范围或模块顶层）
    const sRange = fnRanges.find(([s, e]) => nx.line >= s && nx.line <= e);
    const refs = [];
    for (let j = 0; j < tokens.length; j++) {
      const tj = tokens[j];
      if (tj.type !== 'ident' || tj.value !== nx.value) continue;
      // 跳过声明关键字后的声明位（tokens[j-1] 是 const/let/var）
      if (tokens[j - 1] && ['const', 'let', 'var'].includes(tokens[j - 1].value)) continue;
      const inScope = sRange
        ? (tj.line >= sRange[0] && tj.line <= sRange[1])
        : !fnRanges.some(([s, e]) => tj.line >= s && tj.line <= e);
      if (inScope) refs.push(tj.line);
    }
    groups.push({ name: nx.value, scopeName, declLine: nx.line, refs: [...new Set(refs)].sort((a, b) => a - b), count: 1 + new Set(refs).size });
  }
  return groups.sort((a, b) => a.declLine - b.declLine);
}

function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) { console.error('用法: node scripts/rename-locator.mjs <file> [--name x] [--all-len] [--json]'); process.exitCode = 1; return; }
  const ni = argv.indexOf('--name'); const name = ni >= 0 ? argv[ni + 1] : undefined;
  const allLen = argv.includes('--all-len');
  const json = argv.includes('--json');
  let src;
  try { src = readFileSync(file, 'utf8'); } catch (e) { console.error(`读文件失败: ${e.message}`); process.exitCode = 1; return; }
  const groups = locateVariables(src, name ? { name } : { minLen: allLen ? 0 : 2 });
  if (json) { console.log(JSON.stringify({ file, groups }, null, 2)); return; }
  if (!groups.length) { console.log(`${file}: 无${name ? `变量 ${name}` : '单字符短变量'}（按函数作用域分组）`); return; }
  console.log(`${file} 变量重命名位置（按作用域分组——同名不同函数各自独立）：`);
  for (const g of groups) {
    console.log(`  ${g.name} @ ${g.scopeName}：声明 L${g.declLine} · 引用 ${g.refs.map((r) => `L${r}`).join(' ') || '（无）'}`);
  }
}

if (basename(process.argv[1] || '') === 'rename-locator.mjs') main(); // 入口判断：basename 精确（endsWith 会误匹配 test-rename-locator.mjs）