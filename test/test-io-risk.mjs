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

test('io-risk：循环内异步串行 await 判 low（只慢不阻塞，非请求路径）', () => {
  // 2026-09-20 多维分级：风险不取决于「在不在循环里」——
  //   异步串行 await 只是慢、不阻塞事件循环，非请求路径下从 high 降为 low
  const src = 'async function f(list) {\n  for (const p of list) { await fs.promises.readFile(p); }\n}\n';
  const hits = scanIoRiskAst(src);
  assert.ok(hits.length >= 1, '应命中');
  assert.equal(hits[0].risk, 'low');
  assert.equal(hits[0].inLoop, true);
});

test('io-risk：请求路径上循环内逐个 await 判 high（响应时间线性增长）', () => {
  const src = 'export async function handler(req, res) {\n'
    + '  for (const p of req.body.files) { await fs.promises.readFile(p); }\n'
    + '  res.end("ok");\n}\n';
  const hits = scanIoRiskAst(src);
  const h = hits.find((x) => x.kind === 'read');
  assert.ok(h, '应命中');
  assert.equal(h.inLoop, true, '应判为循环内');
  assert.equal(h.inRequest, true, '应判为请求路径');
  assert.equal(h.risk, 'high', '请求路径 + 循环内串行 await = 高风险');
});

test('io-risk：循环内同步 I/O（边界不可控、非请求路径）判 medium', () => {
  // 同步阻塞 + 边界不可控但不在请求路径 → 中风险（不再是 high）；
  //   用读类验证基础档（写/删类在重复上下文会再加权一档，见写加权测试）
  const src = 'function f(items) {\n  for (const it of items) { fs.readFileSync(it); }\n}\n';
  const hits = scanIoRiskAst(src);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].risk, 'medium');
  assert.equal(hits[0].inLoop, true);
});

test('io-risk：循环内同步 I/O 落在请求路径判 high（三条件齐）', () => {
  const src = 'function handler(req, res) {\n'
    + '  for (const f of req.body.files) { fs.readFileSync(f); }\n'
    + '  res.end("ok");\n}\n';
  const hits = scanIoRiskAst(src);
  const h = hits.find((x) => x.kind === 'read');
  assert.ok(h, '应命中');
  assert.equal(h.risk, 'high', '同步阻塞 + 边界不可控 + 请求路径 = 高风险');
});

test('io-risk：循环内异步 I/O 已 Promise.all 并行判 low（不串行放大）', () => {
  const src = 'async function f(files) {\n'
    + '  for (const p of files) { await Promise.all([fs.promises.readFile(p), fs.promises.stat(p)]); }\n'
    + '}\n';
  const hits = scanIoRiskAst(src);
  const h = hits.find((x) => x.kind === 'read');
  assert.ok(h, '应命中');
  assert.equal(h.inLoop, true, '应判为循环内');
  assert.equal(h.risk, 'low', 'Promise.all 并行 = 可接受（low）');
});

test('io-risk：顶层同步 I/O 判 low（启动路径），不误判为 high', () => {
  const src = 'const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));\n';
  const hits = scanIoRiskAst(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].risk, 'low');
  assert.equal(hits[0].inStartup, true);
});

test('io-risk：写类操作加权一档（仅重复执行的上下文）', () => {
  // 2026-09-18 口径修正：加权只作用于**会重复执行**的上下文（循环内 / 请求路径）。
  //   原先无条件加权，把「启动路径的一次性落盘」「`.tmp` + rename 标准原子写」
  //   这类*正确做法*也升了一档（实测 25 条 atomic-json/account-status 等被误报中风险）。
  //   异步写不阻塞、不重复，本身无风险，保持 safe 才是准确的。
  //
  // 加权机制仍在，用「循环内」（不依赖请求路径识别）验证：
  //   循环内的异步写 = 基础 high（循环内）；改用循环内的**异步**写拿基础 safe 观察抬升——
  //   但异步写不在重复上下文……故直接用「请求路径 + 异步 I/O」这一支：
  //   异步读在请求路径 = medium；异步写在请求路径 = medium→high（加权）。
  const both = 'export async function handler(req, res) {\n'
    + '  await fs.promises.writeFile("o", "x");\n'
    + '  await fs.promises.readFile("i");\n'
    + '  res.end(String(req.url));\n}\n';
  const hits = scanIoRiskAst(both);
  const w = hits.find((h) => h.kind === 'write');
  const r = hits.find((h) => h.kind === 'read');
  assert.ok(w && r, '应同时命中写与读');
  assert.equal(w.inRequest, true, '应判为请求路径');
  assert.equal(w.risk, 'high', '请求路径的写应加权一档（medium → high）');
  assert.ok(w.reason.includes('加权'), '理由应说明加权来源');
  // 同上下文里的读未加权 —— 反证加权只作用于写/删/改名
  assert.equal(r.risk, 'medium', '同类上下文下的读不加权，停在基础档');
});

test('io-risk：启动路径的一次性写不加权（原子写不应被误升档）', () => {
  // 标准原子写：`.tmp` + rename。执行一次即结束，不存在「反复 + 不可逆」叠加。
  const src = 'const tmpPath = `${p}.tmp`;\n'
    + 'writeFileSync(tmpPath, JSON.stringify(doc), "utf8");\n'
    + 'renameSync(tmpPath, p);\n';
  const hits = scanIoRiskAst(src);
  assert.ok(hits.length >= 2, '应命中写与改名');
  for (const h of hits) {
    assert.equal(h.inStartup, true, '应判为启动路径');
    assert.equal(h.risk, 'low', `${h.call} 一次性执行不应加权（期望 low，实际 ${h.risk}）`);
    assert.ok(!h.reason.includes('加权'), '理由不应含加权');
  }
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

test('checkIoRisk：高风险计分、低风险仅提示（severity=info 且不计分）', () => {
  const high = checkIoRisk({ file: 'a.mjs', text: 'async function f() { fs.readFileSync("x"); }' });
  const med = checkIoRisk({ file: 'a.mjs', text: 'function h(req, res) { fs.readFileSync("x"); }' }); // 数据读写请求路径 = 中风险（元数据 existsSync 已降 low）
  const low = checkIoRisk({ file: 'a.mjs', text: 'const c = fs.readFileSync("x");' });
  assert.equal(high[0].scoreImpact, 2, '高风险计 2');
  assert.equal(high[0].severity, 'warning', '高风险按 warning 展示');
  assert.equal(med[0].scoreImpact, 1, '中风险计 1');
  assert.equal(med[0].severity, 'warning', '中风险按 warning 展示');
  // 低风险（启动路径一次性同步 I/O）是提示而非缺陷：展示为 info，且不拉低评分
  assert.equal(low[0].scoreImpact, 0, '低风险不计分');
  assert.equal(low[0].severity, 'info', '低风险按 info 展示');
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

// ---------- 2026-09-23：元数据操作档（io-risk 优化，对照诊断「97% 误报」） ----------
//   请求路径的 existsSync/statSync/readdirSync/mkdir 等元数据/查询/幂等目录操作 → low（微秒级，
//   不搬运数据内容）；数据读写（readFileSync）请求路径保持 medium；循环内不受本档豁免。

test('io-risk：请求路径元数据操作（existsSync/statSync）降 low', () => {
  const hits = scanIoRiskAst('const fs = require("fs");\nfunction h(req, res) {\n  if (fs.existsSync("/data/x")) { res.end("ok"); }\n}\n');
  const h = hits.find((x) => x.call === 'existsSync');
  assert.ok(h, '应识别 existsSync');
  assert.equal(h.risk, 'low', `元数据操作应 low，得 ${h.risk}`);
  assert.ok(h.reason.includes('元数据'), '应说明元数据操作');
});

test('io-risk：请求路径数据读写（readFileSync）保持 medium', () => {
  const hits = scanIoRiskAst('const fs = require("fs");\nfunction h(req, res) {\n  const data = fs.readFileSync("/data/big.txt");\n  res.end(data);\n}\n');
  const h = hits.find((x) => x.call === 'readFileSync');
  assert.ok(h);
  assert.equal(h.risk, 'medium', `数据读写请求路径应 medium，得 ${h.risk}`);
});

test('io-risk：循环内元数据操作不受 meta 档豁免（仍按循环分级）', () => {
  const hits = scanIoRiskAst('const fs = require("fs");\nfor (const f of files) {\n  const s = fs.statSync(f);\n}\n');
  const h = hits.find((x) => x.call === 'statSync');
  assert.ok(h, '应识别循环内 statSync');
  assert.notEqual(h.risk, 'low', `循环内元数据操作应按循环分级（非 low 豁免），得 ${h.risk}`);
});

test('io-risk：请求路径 rename（同卷改名）不升 high', () => {
  const hits = scanIoRiskAst('const fs = require("fs");\nfunction h(req, res) {\n  fs.renameSync("/data/a", "/data/.trash/a");\n  res.end("ok");\n}\n');
  const h = hits.find((x) => x.call === 'renameSync');
  assert.ok(h);
  assert.notEqual(h.risk, 'high', `同卷 rename 不应因 repeated 加权升 high，得 ${h.risk}`);
});
