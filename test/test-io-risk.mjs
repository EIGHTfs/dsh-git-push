/**
 * dsh-git-push — I/O 风险分级测试（2026-09-17）
 *
 * 覆盖 lib/ast/io-risk.js 的 AST 判定、汇总与排序，以及
 * lib/checks/io.js 的 finding 转换；防止后续调整时静默劣化分级准确度。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scanIoRiskAst, summarizeIoRisk, rankIoFixList, RISK_BADGE, RISK_LABEL,
} from '../lib/ast/io-risk.js';
import { checkIoRisk } from '../lib/checks/io.js';

// ---------- 四级判定 ----------

test('io-risk：异步路径中的同步 I/O 判 high', () => {
  const src = 'export async function f() {\n  const x = fs.readFileSync("a");\n}\n';
  const hits = scanIoRiskAst(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].risk, 'high');
  assert.equal(hits[0].type, 'sync');
  assert.equal(hits[0].inAsync, true);
});

test('io-risk：循环内的 I/O 判 high（含异步调用）', () => {
  const src = 'async function f(list) {\n  for (const p of list) { await fs.promises.readFile(p); }\n}\n';
  const hits = scanIoRiskAst(src);
  assert.ok(hits.length >= 1, '应命中');
  assert.equal(hits[0].risk, 'high');
  assert.equal(hits[0].inLoop, true);
});

test('io-risk：顶层同步 I/O 判 low（启动路径），不误判为 high', () => {
  const src = 'const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));\n';
  const hits = scanIoRiskAst(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].risk, 'low');
  assert.equal(hits[0].inStartup, true);
});

test('io-risk：写类操作加权一档（safe 基线上抬为 low）', () => {
  // 异步写 + 无循环 + 非关键路径：基础 safe，写类加权后 low（不阻塞事件循环）
  const src = 'export async function f() {\n  await fs.promises.writeFile("out.txt", "x");\n}\n';
  const hits = scanIoRiskAst(src);
  assert.ok(hits.length >= 1, '应命中');
  assert.equal(hits[0].kind, 'write');
  assert.equal(hits[0].risk, 'low', '写类应加权一档（safe → low）');
  assert.ok(hits[0].reason.includes('加权'), '理由应说明加权来源');

  // 同一文件里的异步读未加权，仍在 safe —— 反证加权只作用于写类
  const both = 'export async function g() {\n'
    + '  await fs.promises.writeFile("o", "x");\n'
    + '  await fs.promises.readFile("i");\n}\n';
  const h2 = scanIoRiskAst(both);
  const w = h2.find((h) => h.kind === 'write');
  const r = h2.find((h) => h.kind === 'read');
  assert.equal(w.risk, 'low');
  assert.equal(r.risk, 'safe');
});

test('io-risk：循环内的同步写判 high', () => {
  const src = 'function f(items) {\n  for (const it of items) { fs.writeFileSync("a", it); }\n}\n';
  const hits = scanIoRiskAst(src);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].risk, 'high');
  assert.equal(hits[0].inLoop, true);
});

test('io-risk：无 I/O 的文件返回空数组（不误报）', () => {
  const hits = scanIoRiskAst('export function add(a, b) { return a + b; }\n');
  assert.equal(hits.length, 0);
});

test('io-risk：解析异常不抛（返回空数组而非崩溃）', () => {
  assert.doesNotThrow(() => scanIoRiskAst('function broken( {{{{'));
});

// ---------- 字段完整性 ----------

test('io-risk：每条命中带齐判定所需字段', () => {
  const hits = scanIoRiskAst('async function f() { await fs.promises.readFile("x"); }\n');
  assert.ok(hits.length >= 1);
  for (const h of hits) {
    assert.equal(typeof h.line, 'number');
    assert.equal(typeof h.call, 'string');
    assert.ok(['sync', 'async'].includes(h.type), 'type 取值合法');
    assert.ok(['read', 'write', 'delete', 'rename', 'meta'].includes(h.kind), 'kind 取值合法');
    assert.ok(['high', 'medium', 'low', 'safe'].includes(h.risk), 'risk 四级取值合法');
    for (const k of ['inAsync', 'inLoop', 'inRequest', 'inStartup']) {
      assert.equal(typeof h[k], 'boolean', `${k} 应为布尔`);
    }
  }
});

// ---------- 汇总 ----------

test('summarizeIoRisk：统计总数、同步数、风险分布与文件排行', () => {
  const hits = [
    { file: 'a.js', type: 'sync', kind: 'read', risk: 'low' },
    { file: 'a.js', type: 'sync', kind: 'write', risk: 'high' },
    { file: 'b.js', type: 'async', kind: 'read', risk: 'high' },
  ];
  const s = summarizeIoRisk(hits);
  assert.equal(s.total, 3);
  assert.equal(s.sync, 2);
  assert.equal(s.byRisk.high, 2);
  assert.equal(s.byRisk.low, 1);
  assert.equal(s.byKind.read, 2);
  assert.equal(s.byKind.write, 1);
  assert.equal(s.byFile[0].file, 'a.js', 'I/O 密集文件应排前');
  assert.equal(s.byFile[0].count, 2);
});

test('summarizeIoRisk：空输入不抛且各计数为 0', () => {
  const s = summarizeIoRisk([]);
  assert.equal(s.total, 0);
  assert.equal(s.sync, 0);
  assert.equal(s.byFile.length, 0);
});

// ---------- 排序 ----------

test('rankIoFixList：按 风险 > 写类 > 同步 排序并带 rank', () => {
  const hits = [
    { file: 'a.js', line: 1, risk: 'low', kind: 'read', type: 'sync' },
    { file: 'b.js', line: 2, risk: 'high', kind: 'write', type: 'sync' },
    { file: 'c.js', line: 3, risk: 'high', kind: 'read', type: 'async' },
  ];
  const ranked = rankIoFixList(hits);
  assert.equal(ranked[0].risk, 'high', '高风险排最前');
  assert.equal(ranked[0].kind, 'write', '同为 high 时写类优先');
  assert.equal(ranked[0].rank, 1, 'rank 从 1 开始');
  assert.equal(ranked[ranked.length - 1].risk, 'low', '低风险垫底');
  // rank 连续
  ranked.forEach((h, i) => assert.equal(h.rank, i + 1));
});

// ---------- finding 转换 ----------

test('checkIoRisk：每条命中转 warning 级 finding（不拦提交）', () => {
  const f = checkIoRisk({ file: 'a.mjs', text: 'async function f() { fs.readFileSync("x"); }' });
  assert.ok(f.length >= 1);
  for (const x of f) {
    assert.equal(x.severity, 'warning');
    assert.equal(x.rule, 'robustness/io-risk');
    assert.equal(x.kind, 'io-risk');
    assert.equal(x.file, 'a.mjs');
    assert.ok(x.dimensions.includes('性能'));
  }
});

test('checkIoRisk：高风险项 scoreImpact 更高（2 vs 1）', () => {
  const high = checkIoRisk({ file: 'a.mjs', text: 'async function f() { fs.readFileSync("x"); }' });
  const low = checkIoRisk({ file: 'a.mjs', text: 'const c = fs.readFileSync("x");' });
  assert.equal(high[0].scoreImpact, 2);
  assert.equal(low[0].scoreImpact, 1);
});

test('checkIoRisk：message 含四级徽标与上下文说明', () => {
  const f = checkIoRisk({ file: 'a.mjs', text: 'async function f() { fs.readFileSync("x"); }' });
  assert.ok(f[0].message.includes('高风险'), '应标高风险');
  assert.ok(f[0].message.includes('异步路径'), '应说明上下文');
});

test('checkIoRisk：无 I/O 文件返回空数组', () => {
  assert.equal(checkIoRisk({ file: 'a.mjs', text: 'export const a = 1;\n' }).length, 0);
});

// ---------- 常量 ----------

test('io-risk：徽标与中文标签四级齐全', () => {
  for (const r of ['high', 'medium', 'low', 'safe']) {
    assert.ok(RISK_BADGE[r], `${r} 应有徽标`);
    assert.ok(RISK_LABEL[r], `${r} 应有中文标签`);
  }
});
