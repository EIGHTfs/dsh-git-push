#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * dual-scan.mjs — 双扫描比对（用户定稿：每次写完同时跑旧项目扫描 + 重构版扫描，比对重构区）
 *
 * 1) 重构版 v2：本仓 lib/audit/index.js 的 auditFull（scope=full，全量文件）
 * 2) 旧项目（1.0.3 起）：../dsh-git-push/cli.mjs audit <root> --json
 *    ⚠ diff 语义：旧 audit 只审 git 新增行，工作树干净时返回 0 是设计行为（提交门禁视角），不是失败
 * 3) 旧项目 full-scan（1.0.4 增）：全仓对话残留扫描，工作树干净时唯一可比的旧侧通道
 *
 * 差异口径（已知边界）：v2=全量 vs 旧 audit=新增行，基线不同，diff 数量只作提示；
 * 收敛看「旧 full-scan warn」与 v2 自身 comment/blacklist 桶——v2 已自动豁免
 * audit-rules-*.yml 规则定义示范词（旧 full-scan 无豁免机制，规则定义文件命中属旧项目边界）。
 *
 * 输出：
 *   - summary 对照表（blocker / warning / notice / total）
 *   - 差异 top 清单（旧项目报而 v2 不报 或 反之，按 rule/kind 前缀归并）
 *   - exit 0 = 两侧都 0 blocker；exit 1 = 任一侧有 blocker
 *
 * 用法：
 *   node scripts/dual-scan.mjs [root]        # 默认扫本仓根
 *   node scripts/dual-scan.mjs <绝对路径>    # 扫指定重构区
 *   node scripts/dual-scan.mjs --json        # JSON 输出（机器可读）
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { auditFull } from '../lib/audit/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const json = process.argv.includes('--json');
const positional = process.argv.filter((a) => !a.startsWith('-'));
const target = resolve(positional[2] ?? ROOT);

/** 旧项目规则审计（走其 CLI 的 --json）。语义 = git 新增行（diff）：旧项目 audit 只审
 * addedLines，工作树干净时返回 0。这是设计行为（提交门禁视角），不是扫描失败。 */
function scanOld(root) {
  const oldCli = join(ROOT, '..', 'dsh-git-push', 'cli.mjs');
  if (!existsSync(oldCli)) return { ok: false, error: `旧项目 CLI 不存在: ${oldCli}` };
  try {
    const args = [oldCli, 'audit', root, '--json'];
    const out = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, data: JSON.parse(out) };
  } catch (e) {
    // execFileSync 抛错时 stdout 可能已含 JSON
    const out = e?.stdout?.toString?.() || '';
    try { return { ok: true, data: JSON.parse(out) }; } catch { /* 不是 JSON */ }
    return { ok: false, error: e?.message || String(e), stderr: (e?.stderr || '').toString().slice(0, 400) };
  }
}

/** 旧项目全仓残留扫描（full-scan，分数制黑加白减，只读报告）。与旧 audit 的 diff 语义互补：
 * 审计看「新增行」，full-scan 看「存量对话措辞残留」——工作树干净时它是唯一可比的旧侧通道。 */
function scanOldFullScan(root) {
  const oldCli = join(ROOT, '..', 'dsh-git-push', 'cli.mjs');
  if (!existsSync(oldCli)) return { ok: false, error: `旧项目 CLI 不存在: ${oldCli}` };
  try {
    const args = [oldCli, 'full-scan', root, '--json'];
    const out = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const d = JSON.parse(out);
    return { ok: true, data: { warnCount: d.warnCount, threshold: d.threshold, hits: d.hits || [] } };
  } catch (e) {
    const out = e?.stdout?.toString?.() || '';
    try { const d = JSON.parse(out); return { ok: true, data: { warnCount: d.warnCount, threshold: d.threshold, hits: d.hits || [] } }; } catch { /* 不是 JSON */ }
    return { ok: false, error: e?.message || String(e) };
  }
}

/** v2 全量扫描（本仓引擎，直接调函数避免 CLI 无 --json） */
function scanV2(root) {
  const r = auditFull(root);
  return { summary: r.summary, findings: r.findings, quality: r.quality };
}

/** 按规则前缀归并差异：旧项目 rule 形如 style:readability/max-file-length，v2 kind 形如 max-lines */
function bucket(findings, keyOf) {
  const m = new Map();
  for (const f of findings) {
    const k = keyOf(f);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function main() {
  const old = scanOld(target);
  const v2 = scanV2(target);
  const out = { target, v2: null, old: null, diff: null, blocked: false };
  const oldFS = scanOldFullScan(target);

  if (v2) out.v2 = { summary: v2.summary, quality: v2.quality?.score ?? v2.quality?.level ?? null };
  if (old.ok) out.old = { summary: old.data.summary, quality: old.data.quality };

  // 差异：旧项目按 rule 前缀、v2 按 kind，归一化为「短名」（去掉 style:/readability/ 等前缀段）
  const short = (k) => String(k).split('/').pop();
  const oldBuckets = old.ok ? bucket(old.data.findings || [], (f) => short(f.rule)) : new Map();
  const v2Buckets = v2 ? bucket(v2.findings, (f) => short(f.kind || f.rule)) : new Map();
  const diff = [];
  const keys = new Set([...oldBuckets.keys(), ...v2Buckets.keys()]);
  for (const k of keys) {
    const o = oldBuckets.get(k) || 0;
    const v = v2Buckets.get(k) || 0;
    if (o !== v) diff.push({ kind: k, old: o, v2: v });
  }
  diff.sort((a, b) => Math.abs(b.old - b.v2) - Math.abs(a.old - a.v2));
  out.diff = diff.slice(0, 30);

  out.blocked = (out.v2?.summary?.blocker ?? 0) > 0 || (out.old?.summary?.blocker ?? 0) > 0;

  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`双扫描比对: ${target}`);
    console.log(`  v2（重构版）: ${JSON.stringify(out.v2?.summary)} quality=${out.v2?.quality ?? '—'}`);
    console.log(`  旧项目      : ${JSON.stringify(out.old?.summary)} quality=${out.old?.quality ?? '—'}`);
    if (!old.ok) console.log(`  ⚠ 旧项目 audit 失败: ${old.error}`);
    if (oldFS.ok) {
      console.log(`  旧项目 full-scan（全仓残留）: ${oldFS.data.warnCount} warn（阈值 ${oldFS.data.threshold}）`);
      for (const h of oldFS.data.hits || []) console.log(`    ${h.file}:${h.line} score=${h.score} ${h.hits?.join('/') ?? ''}`);
    } else {
      console.log(`  ⚠ 旧项目 full-scan 失败: ${oldFS.error}`);
    }
    console.log(`  差异（数量不同的规则前缀，top ${out.diff.length}）:`);
    if (!out.diff.length) console.log('    （无差异）');
    for (const d of out.diff) console.log(`    ${d.kind.padEnd(28)} 旧=${d.old}  v2=${d.v2}`);
    console.log(out.blocked ? '  ❌ 存在 blocker（任一侧）' : '  ✅ 两侧 0 blocker');
  }
  process.exitCode = out.blocked ? 1 : 0;
}

main();
