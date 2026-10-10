#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * scan-hardcoded-paths.mjs — 硬编码绝对路径的 dry-run 展示与改写（**调用审计引擎**）
 *
 * ⚠️ 本脚本**不含任何检测逻辑**（曾自带一份 PATTERNS，已删除 ✗ —— 同一事实两份实现必然分叉）。
 *    检测的唯一来源是审计引擎：
 *      · 规则声明（正则初筛）：lib/audit-rules/audit-rules-paths.yml → paths/hardcoded-absolute-path
 *      · 精筛实现（fs 可访问性 + 相对路径换算）：lib/checks/hardcoded-path.js
 *    本脚本只做三件事：① 跑引擎拿 findings（确认哪些文件/行被规则判为硬编码路径）；
 *    ② 展示 dry-run 表（可访问 ⇒ 附相对路径；不可访问 ⇒ 仅警告）；③ `--write` 时才改写。
 *
 * 用法：
 *   node scripts/scan-hardcoded-paths.mjs [--root <目录>] [--write] [--json] [--quiet]
 *   --write 才写盘（默认 dry-run）；--json 机器可读。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardcodedAbsPathHits, describeHardcodedAbsPath } from '../lib/checks/hardcoded-path.js';
import { auditFull } from '../lib/audit/orchestrate.js';

/** 本脚本只服务这一条规则（口径与引擎一致）。 */
export const RULE_ID = 'paths/hardcoded-absolute-path';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = '') => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

/**
 * 跑审计引擎，取本规则的 findings（**引擎是检测的唯一来源**）。
 * @returns {Promise<Array<{file:string,line:number,message:string}>>}
 */
export async function engineFindings(root) {
  const abs = resolve(root);
  const res = await auditFull(abs, { scope: 'full' });
  const out = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === 'object') {
      const id = x.ruleId || x.id || x.rule;
      if (id && String(id).includes('hardcoded-absolute-path')) {
        out.push({ file: String(x.file || ''), line: Number(x.line) || 0, message: String(x.message || '') });
      }
      Object.values(x).forEach(walk);
    }
  };
  walk(res?.findings || res);
  return out;
}

/**
 * 组装 dry-run 报告：以**引擎 findings** 判定"哪些行是问题"，用**引擎精筛实现**取详情
 *   （可访问性 + 相对路径），两者同源 ⇒ 不会出现"脚本说有问题、审计说没问题"的分叉。
 */
export async function scanHardcodedPaths(root) {
  const abs = resolve(root);
  const findings = await engineFindings(abs);
  const byFile = new Map();
  for (const f of findings) {
    const p = f.file ? (f.file.startsWith('/') ? f.file : join(abs, f.file)) : '';
    if (!p || !existsSync(p)) continue;
    if (!byFile.has(p)) byFile.set(p, new Set());
    byFile.get(p).add(f.line);
  }
  const hits = [];
  for (const [file, lines] of byFile) {
    const text = readFileSync(file, 'utf8');
    // 同一行可能被多条模式命中（如 `file:///volume9/x` 同时命中 file-url 与 posix）⇒
    //   同一行只保留**最具体**（raw 最长）的那条，避免一行报两次、计数虚高。
    const byLine = new Map();
    for (const h of hardcodedAbsPathHits(text, file, abs)) {
      if (!lines.has(h.line)) continue;
      const prev = byLine.get(h.line);
      if (!prev || h.raw.length > prev.raw.length) byLine.set(h.line, h);
    }
    for (const h of byLine.values()) hits.push({ ...h, file, relFile: relative(abs, file) || file });
  }
  return { root: abs, findings: findings.length, hits };
}

/** CLI 主流程。 */
async function main() {
  const ROOT = resolve(val('--root', process.cwd()));
  const WRITE = has('--write');
  const JSON_OUT = has('--json');
  const QUIET = has('--quiet');
  const { hits } = await scanHardcodedPaths(ROOT);
  const accessible = hits.filter((h) => h.accessible);
  const inaccessible = hits.filter((h) => !h.accessible);
  const byOs = hits.reduce((a, h) => ((a[h.os] = (a[h.os] || 0) + 1), a), {});

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: hits.length === 0, root: ROOT, total: hits.length, accessible: accessible.length, inaccessible: inaccessible.length, byOs, hits }, null, 2));
    process.exit(hits.length ? 1 : 0);
  }
  if (!QUIET) console.log(`扫描根：${ROOT}（检测来源：审计引擎 ${RULE_ID}）`);
  if (!hits.length) { console.log('硬编码绝对路径 ✅ 未发现'); process.exit(0); }
  for (const h of hits) {
    console.log(`⚠️  ${h.relFile}:${h.line}  [${h.os}] ${h.raw}`);
    console.log(`    ${h.accessible ? '→ 可访问 ⇒ dry-run 相对路径：' + (h.relative || '.') : '（本机不可访问 ⇒ 仅警告，无法换算）'}`);
  }
  console.log(`\n汇总：命中 ${hits.length} · 可访问 ${accessible.length} · 不可访问 ${inaccessible.length} · 分类 ${JSON.stringify(byOs)}`);
  if (!WRITE) { console.log('（dry-run：未写入任何文件；要真改加 --write）'); process.exit(hits.length ? 1 : 0); }

  let changed = 0;
  const byFile = new Map();
  for (const h of accessible) if (h.relative) { if (!byFile.has(h.file)) byFile.set(h.file, []); byFile.get(h.file).push(h); }
  for (const [file, list] of byFile) {
    let text = readFileSync(file, 'utf8');
    for (const h of list) {
      if (!text.includes(h.raw)) continue;
      console.log(`   改写 ${relative(ROOT, file)}: ${h.raw} → ${h.relative}   （${describeHardcodedAbsPath(h)}）`);
      text = text.split(h.raw).join(h.relative);
      changed += 1;
    }
    writeFileSync(file, text, 'utf8');
  }
  console.log(`✅ --write 完成：改写 ${changed} 处`);
  process.exit(0);
}

// ⚠️ 入口判断必须用 fileURLToPath：`new URL(...).pathname` 是 URL 编码的（含中文路径时是 %E5%B7%A5…），
//   与 process.argv[1] 永不相等 ⇒ main() 静默不执行（实测踩到）。
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
