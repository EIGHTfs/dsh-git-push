/**
 * 注释豁免工具（exempt）：把「手写 dsh-skip-* 注释」变成工具操作。
 *
 * 解决的问题（历史痛点）：
 *   ① 记不住哪个 finding 该写哪个标记、写文件头还是行尾；
 *   ② 写了标记却不生效（提示与实际行为不符，曾一次查出 24 种组合）；
 *   ③ 标记散落各文件，无法盘点/清理。
 *
 * 动作：add（加）/ remove（删）/ list（盘点）/ check（校验真生效）。
 * 标记映射单一真源：直接读同进程 lib/exempt/index.js 的 EXEMPT_MARKERS，不复制。
 *
 * 写入格式与手写完全一致（审计侧零改动）：
 *   header → 文件头前 3 行内追加 `// dsh-skip-<x>: <reason>`
 *   line   → 该行行尾追加 ` // dsh-skip-<x>`
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';

import { EXEMPT_MARKERS, exemptHintForFinding, exemptMarkerCovers } from './index.js';
import { auditFull } from '../audit/orchestrate.js';

/** 跑一次审计找 rule 对应的 finding kind（豁免判定按 kind，如 max-nesting-depth → max-depth）。 */
async function findRuleKind(repoPath, ruleId) {
  try {
    const full = await auditFull(repoPath, { scope: 'full', maxScanFiles: 2000 });
    const hit = (full.findings || []).find((f) => f.rule === ruleId);
    return hit ? String(hit.kind || '') : '';
  } catch {
    return '';
  }
}

/** 读文件（UTF-8）；不存在返回 null。 */
function readText(file) {
  try { return existsSync(file) ? readFileSync(file, 'utf8') : null; } catch { return null; }
}

/** 路径归一：相对仓库根、去 ./、防越界。返回 { ok, abs?, rel?, error? }。 */
function resolveTarget(repoPath, p) {
  const root = resolve(repoPath);
  const rel = String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!rel) return { ok: false, error: '缺少 path' };
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return { ok: false, error: `path 必须是相对仓库根（收到绝对路径：${rel}）` };
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) return { ok: false, error: `path 越界（解析后不在仓库内：${rel}）` };
  return { ok: true, abs, rel };
}

/** 由 rule/marker 推导写入参数；返回 { ok, marker?, scope?, reason?, error? }。 */
function resolveMarker({ rule = '', marker = '', scope = '', kind = '' }) {
  const wantMarker = String(marker || '').trim();
  const wantRule = String(rule || '').trim();
  if (!wantMarker && !wantRule) return { ok: false, error: '需要 rule（用于推导标记）或显式 marker' };
  // 反查「真能豁免该 rule 的标记」（与豁免判定同一口径）
  //   豁免判定按 finding 的 kind（如 max-nesting-depth → max-depth）——kind 由 addExempt 跑审计拿到；
  //   拿不到时退回 id 最后一段（仅兜底，可能对不上，会如实报「没有标记能豁免」）。
  const kindUsed = kind || (wantRule ? String(wantRule).split('/').pop() : '');
  const hint = wantRule ? exemptHintForFinding({ rule: wantRule, kind: kindUsed }) : null;
  const resolved = wantMarker || (hint && hint.marker) || '';
  if (!resolved) return { ok: false, error: `没有任何标记能豁免 rule「${wantRule}」（应改代码，或走 .auditignore / 豁免槽位）` };
  const meta = EXEMPT_MARKERS[resolved];
  if (!meta) return { ok: false, error: `未知标记「${resolved}」；可用：${Object.keys(EXEMPT_MARKERS).join(', ')}` };
  // 显式 marker 与 rule 推导冲突 ⇒ 以推导为准并报错（防写错标记）
  if (wantMarker && hint && hint.marker !== wantMarker) {
    return { ok: false, error: `标记「${wantMarker}」不能豁免 rule「${wantRule}」，正确标记是「${hint.marker}」` };
  }
  // 显式 marker 但没给 rule：用 marker 的元数据判定范围
  const finalScope = String(scope || '').trim() || (meta.lineLevel ? 'header' : 'header');
  if (finalScope === 'line' && meta.lineLevel !== true) {
    return { ok: false, error: `标记「${resolved}」不支持行级（lineLevel=false），只能用 scope=header` };
  }
  if (finalScope !== 'header' && finalScope !== 'line') {
    return { ok: false, error: `scope 只能是 header 或 line（收到 ${finalScope}）` };
  }
  return { ok: true, marker: resolved, scope: finalScope, hint: hint ? hint.hint : (meta.hint || '') };
}

/** 是否已有同一标记（header：前 3 行；line：指定行）。 */
function hasMarker(lines, marker, scope, line) {
  const re = new RegExp(`dsh-skip-${marker.replace(/^dsh-skip-/, '')}\\b`);
  if (scope === 'header') return lines.slice(0, 3).some((l) => re.test(l));
  const idx = Number(line) - 1;
  return idx >= 0 && idx < lines.length && re.test(lines[idx]);
}

/** 生成 header 注释行。 */
function headerComment(marker, reason) {
  return `// ${marker}${reason ? `: ${String(reason).replace(/\s+/g, ' ').trim()}` : ''}`;
}

/**
 * add：给指定文件（或行）加豁免注释。
 * @returns {{ok, results?:Array, error?}}
 */
export async function addExempt({ repoPath = '', path: p, line, scope = '', rule = '', marker = '', reason = '', dryRun = false } = {}) {
  const paths = Array.isArray(p) ? p : [p];
  if (!paths.length) return { ok: false, error: '缺少 path' };
  if (paths.length > 1 && line !== undefined) return { ok: false, error: '多文件时不允许 line（行号无法跨文件对齐）——改用 scope=header 或逐个调用' };
  // 先跑一次审计拿 rule 的 finding kind（豁免判定按 kind，如 max-nesting-depth → max-depth）
  const kind = String(rule || '').trim() ? await findRuleKind(repoPath, String(rule).trim()) : '';
  const m = resolveMarker({ rule, marker, scope, kind });
  if (!m.ok) return { ok: false, error: m.error };
  if (m.scope === 'line' && line === undefined) return { ok: false, error: 'scope=line 时必须给 line（1-based 行号）' };

  // ① 先全部校验（原子：任一失败则一个都不写）
  const plans = [];
  const results = [];
  for (const one of paths) {
    const t = resolveTarget(repoPath, one);
    if (!t.ok) { results.push({ path: String(one), ok: false, error: t.error }); continue; }
    const text = readText(t.abs);
    if (text === null) { results.push({ path: t.rel, ok: false, error: '文件不存在' }); continue; }
    const lines = text.split('\n');
    if (m.scope === 'line') {
      const idx = Number(line) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= lines.length) { results.push({ path: t.rel, ok: false, error: `line ${line} 越界（文件共 ${lines.length} 行）` }); continue; }
      const row = lines[idx];
      if (/\/\*/.test(row) && !/\*\//.test(row)) { results.push({ path: t.rel, ok: false, error: '该行在块注释内，建议 scope=header' }); continue; }
      if (/^\s*(\/\/|\*)/.test(row)) { results.push({ path: t.rel, ok: false, error: '该行是注释行，无法行尾追加，建议 scope=header' }); continue; }
      if (hasMarker(lines, m.marker, 'line', line)) { results.push({ path: t.rel, ok: true, unchanged: true }); continue; }
      const next = [...lines];
      next[idx] = `${row} // ${m.marker}`;
      plans.push({ abs: t.abs, rel: t.rel, next: next.join('\n') });
      results.push({ path: t.rel, ok: true, changed: true, line: Number(line), marker: m.marker });
    } else {
      if (hasMarker(lines, m.marker, 'header')) { results.push({ path: t.rel, ok: true, unchanged: true }); continue; }
      const next = [headerComment(m.marker, reason), ...lines];
      plans.push({ abs: t.abs, rel: t.rel, next: next.join('\n') });
      results.push({ path: t.rel, ok: true, changed: true, marker: m.marker, scope: 'header' });
    }
  }
  const failed = results.filter((r) => r.ok === false);
  if (failed.length) return { ok: false, error: `校验失败（${failed.length} 个文件），未写入任何文件`, results };
  // ② 统一写盘
  if (dryRun) return { ok: true, dryRun: true, results };
  for (const plan of plans) writeFileSync(plan.abs, plan.next, 'utf8');
  return { ok: true, results };
}

/** remove：移除指定文件的豁免（指定 marker 或该文件全部 dsh-skip）。 */
export function removeExempt({ repoPath = '', path: p, marker = '', dryRun = false } = {}) {
  const paths = Array.isArray(p) ? p : [p];
  const results = [];
  for (const one of paths) {
    const t = resolveTarget(repoPath, one);
    if (!t.ok) { results.push({ path: String(one), ok: false, error: t.error }); continue; }
    const text = readText(t.abs);
    if (text === null) { results.push({ path: t.rel, ok: false, error: '文件不存在' }); continue; }
    const re = marker ? new RegExp(`\\s*//\\s*dsh-skip-${marker.replace(/^dsh-skip-/, '')}(?::[^\\n]*)?`, 'g') : /\s*\/\/\s*dsh-skip-[a-z]+(?::[^\n]*)?/g;
    const next = text.replace(re, '');
    if (next === text) { results.push({ path: t.rel, ok: true, unchanged: true }); continue; }
    if (!dryRun) writeFileSync(t.abs, next, 'utf8');
    results.push({ path: t.rel, ok: true, changed: true });
  }
  const failed = results.filter((r) => r.ok === false);
  if (failed.length) return { ok: false, error: `校验失败（${failed.length} 个文件）`, results };
  return { ok: true, dryRun, results };
}

/** list：盘点仓库内所有 dsh-skip 标记（按文件 × 标记 × 位置）。 */
export function listExempt({ repoPath = '', root = '' } = {}) {
  const base = resolve(root || repoPath);
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.trash') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (!/\.(js|mjs|cjs|ts|tsx|jsx|py|md)$/.test(e.name)) continue;
      const text = readText(full);
      if (!text) continue;
      const lines = text.split('\n');
      lines.forEach((row, i) => {
        const m = row.match(/dsh-skip-([a-z]+)/);
        if (!m) return;
        out.push({ file: relative(base, full).split(sep).join('/'), line: i + 1, marker: `dsh-skip-${m[1]}`, scope: i < 3 ? 'header' : 'line' });
      });
    }
  };
  walk(base, 0);
  return { ok: true, total: out.length, items: out };
}

/** check：校验每条标记是否真的能豁免（用同一判定器对 rule 反查，识别死标记/写错标记）。 */
export function checkExempt({ repoPath = '', root = '' } = {}) {
  const listed = listExempt({ repoPath, root });
  const issues = [];
  for (const it of listed.items) {
    const meta = EXEMPT_MARKERS[it.marker];
    if (!meta) { issues.push({ ...it, issue: 'unknown-marker', hint: '标记不在注册表里（拼写错误？）' }); continue; }
    // 用标记的 blocked 反查：该标记能豁免哪些 rule 前缀——至少应有一个（否则标记形同虚设）
    if (!Array.isArray(meta.blocked) || !meta.blocked.length) issues.push({ ...it, issue: 'dead-marker', hint: '该标记没有可豁免的 blocked 类型' });
  }
  return { ok: issues.length === 0, total: listed.total, issues };
}
