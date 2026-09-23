#!/usr/bin/env node
/**
 * rules-solo-audit —— yml 规则单启控制变量扫描（2026-09-23，按需运行，非测试常驻）
 *
 * 用途：评估每条 audit-rules-*.yml 规则的有效性与局限——「控制变量法」：
 *   ① 基准：不启用任何规则跑审计（仅剩结构类 finding，如 tree-doc）
 *   ② 循环：每次只启用**一条**规则跑全量审计（其余规则全部不加载）
 *   ③ 对比每规则「单独启用」的 findings 数/涉及文件/样例 → 判断该规则：
 *      有效（能抓住真问题）/ 误报多（噪音）/ 盲区（该抓的没抓到）——结果需 AI + 人工审。
 *
 * 实现：auditFull 支持 rulesetDir 整体替换规则目录——为每条规则在临时目录重建
 *   「单规则 yml」（命名 audit-rules-nodejs.yml 占默认 slot，FORCE_LOAD_SLOTS 兜底不触发），
 *   其余 slot 缺失即不加载 → 审计只跑该规则。规则条目按原 yml 字段格式重建
 *   （JSON 序列化数组切片会丢 `-` 列表项，已实测不可用；手写字段行可行）。
 *
 * 用法：
 *   node scripts/rules-solo-audit.mjs <repo>                      # 全部规则（107 条，耗时较长）
 *   node scripts/rules-solo-audit.mjs <repo> --limit 10           # 前 10 条（小样本）
 *   node scripts/rules-solo-audit.mjs <repo> --ids io-risk,camel  # 指定规则（id 子串匹配）
 *   node scripts/rules-solo-audit.mjs <repo> --out 报告.md [--json]
 *
 * 输出：默认 <repo>/audit-rules-solo/<时间戳>-<仓库名>.md（表格 + 每规则详情/样例）
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { dirname } from 'node:path';
import { loadRuleFiles } from '../lib/rule/loader.js';

/** 规则对象 → 单条 yml 条目（保字段，数组/对象 JSON 内联，字符串引号）。 */
function ruleToYmlEntry(r) {
  const lines = [];
  for (const [k, v] of Object.entries(r)) {
    if (k === '__slot' || v === undefined || v === null) continue;
    lines.push(`    ${k}: ${JSON.stringify(v)}`);
  }
  return `  - ${lines.join('\n')}`;
}

/** 临时 ruleset：metadata + 单条/零条规则（命名占 nodejs 默认 slot）。 */
function makeSoloRuleset(ruleOrNull) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-solo-'));
  const rulesBlock = ruleOrNull ? ruleToYmlEntry(ruleOrNull) : '  # 空规则（基准）';
  const yml = [
    'metadata:',
    '  name: "solo-ruleset"',
    '  version: "1.0"',
    '  language: "javascript"',
    'rules:',
    rulesBlock,
    '',
  ].join('\n');
  writeFileSync(join(dir, 'audit-rules-nodejs.yml'), yml);
  return dir;
}

/** 跑一次全量审计（指定 ruleset），返回 findings 数组。 */
async function auditWithRuleset(repo, rulesetDir) {
  await import('../lib/rule/compilers.js');
  const { auditFull } = await import('../lib/audit/orchestrate.js');
  const r = await auditFull(repo, { rulesetDir });
  return (r.findings || []).filter((f) => f.rule && !f.rule.startsWith('structure/'));
}

/**
 * 主流程：基准（空规则）→ 每规则单启 → 报告。
 * @param {string} repo 目标仓库
 * @param {{limit?: number, ids?: string[], out?: string, json?: boolean}} opts
 */
export async function runRulesSoloAudit(repo, opts = {}) {
  const rules = loadRuleFiles().merged.rules || [];
  const picked = opts.ids && opts.ids.length
    ? rules.filter((r) => opts.ids.some((s) => r.id.toLowerCase().includes(s.toLowerCase())))
    : rules;
  const limited = opts.limit && opts.limit > 0 ? picked.slice(0, opts.limit) : picked;
  if (!limited.length) return { ok: false, error: '没有匹配的规则（--ids 子串匹配不到，或规则集为空）' };

  // ① 基准：空规则
  const baseDir = makeSoloRuleset(null);
  let base = [];
  try { base = await auditWithRuleset(repo, baseDir); } finally { rmSync(baseDir, { recursive: true, force: true }); }

  // ② 全量对照（一次全量审计，按规则分组 = 每规则真实命中数，控制变量基准的另一参照）
  let fullFindings = [];
  try { fullFindings = await auditWithRuleset(repo, ''); } catch { fullFindings = []; }
  const fullByRule = new Map();
  for (const f of fullFindings) {
    if (!fullByRule.has(f.rule)) fullByRule.set(f.rule, []);
    fullByRule.get(f.rule).push(f);
  }

  // ③ 每规则单启
  const rows = [];
  for (let i = 0; i < limited.length; i += 1) {
    const rule = limited[i];
    const dir = makeSoloRuleset(rule);
    let solo = [];
    try { solo = await auditWithRuleset(repo, dir); } catch (e) { solo = []; }
    finally { rmSync(dir, { recursive: true, force: true }); }
    const byFile = new Set(solo.map((f) => f.file));
    const fullHits = fullByRule.get(rule.id) || [];
    rows.push({
      id: rule.id, name: rule.name || '', severity: rule.severity || '', category: rule.category || '',
      desc: (rule.description || '').slice(0, 80),
      findings: solo.length, files: byFile.size,
      fullHits: fullHits.length, fullFiles: new Set(fullHits.map((f) => f.file)).size,
      baseDelta: solo.length - base.length,
      samples: (solo.length ? solo : fullHits).slice(0, 3).map((f) => `${f.file}${f.line ? ':' + f.line : ''} — ${String(f.message || '').slice(0, 70)}`),
    });
  }

  const report = {
    generatedAt: new Date().toISOString(), repo, baseFindings: base.length,
    rulesScanned: limited.length, rows,
  };
  if (opts.json) return { ok: true, ...report };

  // md 报告
  const L = [];
  L.push(`# 规则单启控制变量审计 · ${basename(repo)}`, '');
  L.push(`> 生成：${report.generatedAt} ｜ 基准（无规则）findings：${base.length} ｜ 扫描规则：${report.rulesScanned} 条`);
  L.push('> 说明：全量命中 = 完整规则集下该规则的 findings 数（真实命中，可靠参照）；单启 = 只启用该规则的审计结果（执行链局限时可能为 0，以全量列为准）。findings 越多噪音越大；0 且该抓的没抓 = 盲区。**需 AI + 人工审有效性与局限**。', '');
  L.push('', '| 规则 | severity | 全量命中 | 单启 | vs 基准 | 说明 |');
  L.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    const delta = r.baseDelta > 0 ? `+${r.baseDelta}` : String(r.baseDelta);
    L.push(`| ${r.id} | ${r.severity} | ${r.fullHits} | ${r.findings} | ${delta} | ${r.name || r.desc} |`);
  }
  L.push('');
  for (const r of rows) {
    L.push(`### ${r.id}（${r.severity}）`, '');
    L.push(`${r.desc}`, '');
    L.push(`全量命中 ${r.fullHits} 条 / 单启 ${r.findings} 条（vs 基准 ${r.baseDelta}）`, '');
    if (r.findings === 0 && r.fullHits > 0) L.push('> ⚠ 单启未产出（执行链与完整规则集耦合的已知局限）——请以「全量命中」列为准做人工审，并核对样例。', '');
    if (r.samples.length) {
      L.push('样例：', '');
      for (const s of r.samples) L.push(`- \`${s}\``);
    } else {
      L.push('样例：（无 finding——该规则对当前仓库无命中，需人工判断是「仓库干净」还是「规则盲区」）', '');
    }
    L.push('');
  }
  return { ok: true, md: L.join('\n'), rows, baseFindings: base.length, rulesScanned: limited.length };
}

/* ───────────────────────── CLI（仅直接运行时） ───────────────────────── */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const repo = args.find((a) => !a.startsWith('--')) || process.cwd();
  const limitArg = args.find((a) => a.startsWith('--limit'));
  const idsArg = args.find((a) => a.startsWith('--ids'));
  const outArg = args.find((a) => a.startsWith('--out'));
  const isJson = args.includes('--json');
  const limit = limitArg ? Number(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1] || 0) : 0;
  const ids = idsArg ? (idsArg.split('=')[1] || args[args.indexOf(idsArg) + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
  const out = outArg ? (outArg.split('=')[1] || args[args.indexOf(outArg) + 1] || '') : '';
  const r = await runRulesSoloAudit(resolve(repo), { limit, ids, out, json: isJson });
  if (!r.ok) { console.error(`❌ ${r.error}`); process.exit(1); }
  if (isJson) { console.log(JSON.stringify({ ok: true, repo, baseFindings: r.baseFindings, rulesScanned: r.rulesScanned, rows: r.rows }, null, 2)); process.exit(0); }
  const target = out
    ? resolve(out)
    : join(resolve(repo), 'audit-rules-solo', `${new Date().toISOString().replace(/[:.]/g, '-')}-${basename(repo)}.md`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, r.md, 'utf8');
  console.log(`✅ 规则单启审计完成：${r.rulesScanned} 条规则 / 基准 ${r.baseFindings} findings → ${target}`);
  console.log('（结果需 AI + 人工审：逐条判断规则有效性与局限）');
}
