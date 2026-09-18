#!/usr/bin/env node
// ============================================================
// func-index —— JS 函数索引扫描器
//
// 用途：AI / 开发者改代码前，不用通读整个文件，先跑本脚本
//   生成「函数名 → 起止行号 → 行数 → 同文件调用位置」索引，
//   按需定向读取目标函数，节省大量上下文。
//
// 用法：
//   node scripts/func-index.js <文件.js> [文件2.js ...]        # 扫指定文件，打印摘要
//   node scripts/func-index.js <文件.js> --out index.json      # 输出完整 JSON 索引
//   node scripts/func-index.js <目录>                          # 递归扫目录下 *.js/*.cjs
//   node scripts/func-index.js <文件.js> --name downloadToFile # 只看某函数详情
//
// 识别范围（JS 常见定义形态）：
//   function name(         /  async function name(
//   const name = function( /  let/var name = async function(
//   const name = (..) => { /  const name = async (..) => {
//   module.exports = { 内的 name: function( 方法
//   对象/类内的 name(...) { 方法（宽松模式 --loose）
//
// 调用位置：同文件内 `name(` 出现的行（排除定义行、排除注释行）
// ============================================================
"use strict";

import fs from "node:fs";
import path from "node:path";

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
const targets = [];
let outFile = "";
let nameFilter = "";
let loose = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--out" && argv[i + 1]) { outFile = argv[++i]; continue; }
  if (a === "--name" && argv[i + 1]) { nameFilter = argv[++i]; continue; }
  if (a === "--loose") { loose = true; continue; }
  targets.push(a);
}

// ---------- 括号配对：从 startIndex 行开始找函数体结束行 ----------
// 返回 { end, depth }；depth>0 说明括号未闭合（文件截断等）
function findBlockEnd(lines, startIdx) {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = stripComment(lines[i]);
    for (const ch of line) {
      if (ch === "{") { depth++; started = true; }
      else if (ch === "}") { depth--; }
    }
    if (started && depth <= 0 && i > startIdx) {
      return { end: i, depth };
    }
  }
  return { end: lines.length - 1, depth };
}

// ---------- 去除行内注释（粗略：处理 // 与 /* */，不处理字符串内）----------
function stripComment(line) {
  let s = line;
  // 块注释
  const b = s.indexOf("/*");
  if (b >= 0) { const e = s.indexOf("*/", b + 2); s = e >= 0 ? s.slice(0, b) + s.slice(e + 2) : s.slice(0, b); }
  // 行注释（在引号外才有效——粗略处理：若 // 前有未闭合引号则跳过）
  const quoteRe = /["']/;
  const idx = s.indexOf("//");
  if (idx >= 0) {
    const before = s.slice(0, idx);
    const quotes = (before.match(/'/g) || []).length + (before.match(/"/g) || []).length;
    if (quotes % 2 === 0) s = before;
  }
  return s;
}

// ---------- 识别函数定义 ----------
// 返回 { name, kind, defLine, bodyStart } 或 null
function detectFunction(lines, i, loose) {
  const raw = lines[i];
  const line = stripComment(raw);
  const t = line.trim();

  // 1) function name( / async function name(
  let match = t.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (match) return { name: match[1], kind: "function", defLine: i };

  // 2) const/let/var name = function( / async function(
  match = t.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/);
  if (match) return { name: match[1], kind: "var-function", defLine: i };

  // 3) const name = (..) => { / async (..) => {
  match = t.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=]*?\)\s*=>\s*\{?\s*$/);
  if (match) return { name: match[1], kind: "arrow", defLine: i };

  // 4) module.exports = { ... 内的 name: function( 或 name: (..) => {
  if (loose) {
    match = t.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function\s*\(/);
    if (match) return { name: match[1], kind: "method", defLine: i };
    match = t.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/);
    if (match) return { name: match[1], kind: "method", defLine: i };
  }
  return null;
}

// ---------- 扫描单文件 ----------
function scanFile(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { return { file, error: e.message }; }
  const lines = text.split("\n");
  const funcs = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

    const hit = detectFunction(lines, i, loose);
    if (!hit) continue;

    // 函数体：若定义行已含 "{"（单行函数），bodyStart 就是本行；否则下一行
    let bodyStart = i;
    const lineNoComment = stripComment(raw);
    if (!lineNoComment.includes("{")) {
      // 找 { 所在行（可能多行签名）
      let j = i;
      let depth = 0;
      while (j < lines.length) {
        const lineText = stripComment(lines[j]);
        depth += (lineText.match(/\{/g) || []).length;
        if (depth > 0) break;
        j++;
      }
      bodyStart = j;
      if (bodyStart >= lines.length) continue; // 找不到 {，跳过
    }

    const { end } = findBlockEnd(lines, bodyStart);
    const bodyLines = end - i + 1;
    funcs.push({
      name: hit.name,
      kind: hit.kind,
      defLine: i + 1,
      endLine: end + 1,
      lines: bodyLines,
    });
  }

  // 同文件调用位置
  const fileText = text;
  for (const f of funcs) {
    f.calls = [];
    const re = new RegExp(`\\b${escapeReg(f.name)}\\s*\\(`, "g");
    let mm;
    while ((mm = re.exec(fileText)) !== null) {
      const lineNo = fileText.slice(0, mm.index).split("\n").length;
      if (lineNo === f.defLine) continue; // 排除定义行本身
      const src = lines[lineNo - 1] || "";
      const t = src.trim();
      if (!t || t.startsWith("//")) continue;
      f.calls.push({ line: lineNo, ctx: t.slice(0, 80) });
    }
  }

  // 按定义行排序
  funcs.sort((a, b) => a.defLine - b.defLine);
  return { file, funcs, totalLines: lines.length };
}

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ---------- 收集目标文件 ----------
function collectFiles(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  if (st.isDirectory()) {
    const out = [];
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        if (name === "node_modules" || name === ".git" || name === ".trash") continue;
        const p = path.join(d, name);
        const s2 = fs.statSync(p);
        if (s2.isDirectory()) walk(p);
        else if (/\.(js|cjs|mjs)$/.test(name)) out.push(p);
      }
    };
    walk(target);
    return out;
  }
  return [];
}

// ---------- 主流程 ----------
if (!targets.length) {
  console.log("用法: node scripts/func-index.js <文件|目录> [--out index.json] [--name 函数名] [--loose]");
  process.exit(0);
}

const files = [];
for (const t of targets) {
  try { files.push(...collectFiles(t)); }
  catch (e) { console.error(`[跳过] ${t}: ${e.message}`); }
}

const results = files.map(scanFile);
const usable = results.filter((r) => r.funcs && r.funcs.length);

console.log(`扫描 ${files.length} 个文件，识别 ${usable.reduce((n, r) => n + r.funcs.length, 0)} 个函数\n`);

for (const r of usable) {
  console.log(`════ ${r.file}（${r.totalLines} 行 · ${r.funcs.length} 个函数）════`);
  for (const f of r.funcs) {
    const callInfo = f.calls.length ? ` · 被调 ${f.calls.length} 处` : "";
    console.log(`  ${String(f.defLine).padStart(5)}-${String(f.endLine).padEnd(5)} ${String(f.lines).padStart(4)} 行  ${f.name}${callInfo}`);
  }
  console.log("");
}

if (outFile) {
  const json = JSON.stringify({ generatedAt: new Date().toISOString(), files: usable }, null, 2);
  // --out 可指向任意路径（含尚不存在的子目录），先确保父目录存在，否则 ENOENT
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, json, "utf8");
  console.log(`索引已写入: ${outFile}`);
}

// --name 过滤：打印指定函数详情
if (nameFilter) {
  for (const r of usable) {
    for (const f of r.funcs) {
      if (f.name === nameFilter) {
        console.log(`\n▶ ${r.file} : ${f.name}（第 ${f.defLine}-${f.endLine} 行，${f.lines} 行）`);
        const lines = fs.readFileSync(r.file, "utf8").split("\n");
        const start = Math.max(0, f.defLine - 1);
        for (let i = start; i < Math.min(f.endLine, start + 50); i++) {
          console.log(`  ${String(i + 1).padStart(5)}| ${lines[i]}`);
        }
        if (f.calls.length) {
          console.log(`\n  调用位置（${f.calls.length} 处）:`);
          for (const call of f.calls) console.log(`    ${call.line}: ${call.ctx}`);
        }
      }
    }
  }
}
