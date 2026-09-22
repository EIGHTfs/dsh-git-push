#!/usr/bin/env node
/**
 * functions-doc —— 函数文档生成器（2026-09-23）。
 *
 * 用途：读 functions-index.json（由 scripts/func-index.js --out 生成，含 name/kind/defLine/
 *   signature/**comment**——comment 为人工补注释载体），生成 `docs/函数/<文件>.md` 函数文档：
 *   索引表（函数/kind/行/签名）+ 每函数注释节。
 * 流程：functions analyze（func-index 扫）→ 人工/AI 在 functions-index.json 补 comment → 本脚本 apply。
 * 文件已删除 → 文档归档 docs/函数/_archived/（人工注释不静默丢）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 读 functions-index.json（func-index --out 产物）。 */
export function loadFunctionsIndex(root = ROOT) {
  const p = join(root, 'functions-index.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** 渲染单文件函数文档（md 文本）。 */
function renderFileDoc(entry = {}, { archived = false } = {}) {
  const rel = String(entry.file || '');
  const L = [];
  L.push(`# 函数索引 · ${rel}`, '');
  if (archived) L.push('> ⚠ 源文件已删除，本文档归档（人工注释保留）', '');
  const funcs = Array.isArray(entry.funcs) ? entry.funcs : [];
  L.push(`共 ${funcs.length} 个函数：`, '');
  L.push('| 函数 | kind | 行 | 签名（前 60 字） |');
  L.push('|---|---|---|---|');
  for (const f of funcs) L.push(`| ${f.name} | ${f.kind} | L${f.defLine} | \`${String(f.signature || '').slice(0, 60)}\` |`);
  L.push('');
  for (const f of funcs) {
    L.push(`## ${f.name}（L${f.defLine}）`, '');
    L.push(`\`${f.signature || ''}\``, '');
    L.push(String(f.comment || '').trim() ? String(f.comment).trim() : '（无注释，待补）', '');
    L.push('');
  }
  return L.join('\n') + '\n';
}

/**
 * apply：读 functions-index.json → 生成 docs/函数/<文件>.md。
 * 文件已删除 → 归档 docs/函数/_archived/<文件>.md（注释保留）。
 * @param {string} root 项目根
 * @param {{outDir?: string, skipEmpty?: boolean, archive?: boolean}} [opts] skipEmpty=跳过无注释函数
 * @returns {{ok: boolean, outDir?: string, written?: string[], archived?: string[], error?: string}}
 */
export function applyFunctionsDocs(root = ROOT, { outDir = 'docs/函数', skipEmpty = false, archive = true } = {}) {
  const idx = loadFunctionsIndex(root);
  if (!idx || !Array.isArray(idx.files)) {
    return { ok: false, error: 'functions-index.json 不存在或结构异常（先跑 functions analyze / func-index --out）' };
  }
  const outRoot = join(root, outDir);
  const written = [];
  const archived = [];
  for (const entry of idx.files) {
    const rel = String(entry.file || '').replace(/\\/g, '/');
    if (!rel) continue;
    const srcFull = join(root, rel);
    if (!existsSync(srcFull)) {
      // 源文件已删：归档（保留人工注释）
      if (!archive) continue;
      const dest = join(outRoot, '_archived', rel + '.md');
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, renderFileDoc(entry, { archived: true }), 'utf8');
      archived.push(rel);
      continue;
    }
    const funcs = (Array.isArray(entry.funcs) ? entry.funcs : [])
      .filter((f) => !(skipEmpty && !String(f.comment || '').trim()));
    const dest = join(outRoot, rel + '.md');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, renderFileDoc({ ...entry, funcs }, {}), 'utf8');
    written.push(rel);
  }
  return { ok: true, outDir: outRoot, written, archived };
}

/* ───────────────────────── CLI（仅直接运行时） ───────────────────────── */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => !a.startsWith('--')) || ROOT;
  const skipEmpty = args.includes('--skip-empty');
  const r = applyFunctionsDocs(resolve(rootArg), { skipEmpty });
  if (!r.ok) { console.error(`❌ ${r.error}`); process.exit(1); }
  console.log(`✅ 已生成 ${r.written.length} 个文件函数文档 → ${r.outDir}${r.archived.length ? `（归档 ${r.archived.length}）` : ''}`);
}