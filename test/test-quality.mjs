/**
 * 评分总入口测试（1.1.5）：AST 级质量检查器（sync-fs named import / empty-catch 多行 /
 * func-lines 坏样本 100% 检出）+ scoreQuality / countByDimension / qualityWeights 覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, checkSyncFs, checkEmptyCatchAst, checkFuncLinesAst } from '../lib/score/ast.js';
import { DEFAULT_WEIGHTS, countByDimension, scoreQuality } from '../lib/score/index.js';
import { checkSyncFsInFile, checkEmptyCatch } from '../lib/audit/checks.js';

// ---------- tokenizer ----------
test('tokenize：ident/punct/str/comment/tmpl 分类', () => {
  const toks = tokenize('const x = "hi"; // c\n`tpl`');
  const types = toks.map((t) => t.type);
  assert.ok(types.includes('ident'));
  assert.ok(types.includes('str'));
  assert.ok(types.includes('comment'));
  assert.ok(types.includes('tmpl'));
});

test('tokenize：行号正确', () => {
  const toks = tokenize('a\nb\nc');
  assert.equal(toks.find((t) => t.value === 'b').line, 2);
  assert.equal(toks.find((t) => t.value === 'c').line, 3);
});

test('tokenize：块注释整段保留', () => {
  const toks = tokenize('/* multi\nline */ x');
  const c = toks.find((t) => t.type === 'comment');
  assert.ok(c && c.value.includes('multi'));
});

// ---------- checkSyncFs（修 named import 假阴性） ----------
test('sync-fs：fs 前缀调用在 async 函数内命中', () => {
  const hits = checkSyncFs('async function a() { const s = fs.readFileSync("x"); }');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].call, 'readFileSync');
  assert.equal(hits[0].via, 'fs-prefix');
});

test('sync-fs：named import 直调在 async 内命中（旧项目假阴性）', () => {
  const hits = checkSyncFs('import { readFileSync, writeFileSync } from "node:fs";\nasync function a() { readFileSync("x"); }');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].call, 'readFileSync');
  assert.equal(hits[0].via, 'named-import');
});

test('sync-fs：顶层（非 async）调用不命中', () => {
  const hits = checkSyncFs('const s = fs.readFileSync("x");');
  assert.equal(hits.length, 0);
});

test('sync-fs：同步函数内调用不命中', () => {
  const hits = checkSyncFs('function a() { const s = fs.readFileSync("x"); }');
  assert.equal(hits.length, 0);
});

test('sync-fs：async 内多个不同同步函数均命中', () => {
  const hits = checkSyncFs('async function a() { fs.readdirSync("d"); fs.statSync("f"); }');
  assert.equal(hits.length, 2);
});

test('sync-fs：字符串字面量里的 fs.readFileSync 不误报', () => {
  const hits = checkSyncFs('async function a() { const t = "fs.readFileSync(fake)"; }');
  assert.equal(hits.length, 0);
});

test('sync-fs：模板串里的调用不误报', () => {
  const hits = checkSyncFs('async function a() { const t = `x ${fs.readFileSync} y`; }');
  assert.equal(hits.length, 0);
});

test('sync-fs：async 箭头函数也命中', () => {
  const hits = checkSyncFs('const f = async () => { fs.writeFileSync("x", "y"); };');
  assert.equal(hits.length, 1);
});

// ---------- checkEmptyCatchAst（修多行空块假阴性） ----------
test('empty-catch：单行空 catch 命中', () => {
  const hits = checkEmptyCatchAst('try { a(); } catch (e) {}');
  assert.equal(hits.length, 1);
});

test('empty-catch：多行空 catch 命中（旧项目假阴性）', () => {
  const hits = checkEmptyCatchAst('try {\n  a();\n} catch (e) {\n\n}');
  assert.equal(hits.length, 1);
});

test('empty-catch：仅注释 catch 命中', () => {
  const hits = checkEmptyCatchAst('try { a(); } catch (e) {\n  // 忽略\n}');
  assert.equal(hits.length, 1);
});

test('empty-catch：有实质语句的 catch 不命中', () => {
  const hits = checkEmptyCatchAst('try { a(); } catch (e) { console.error(e); }');
  assert.equal(hits.length, 0);
});

test('empty-catch：正常 try/catch/finally 不误报', () => {
  const hits = checkEmptyCatchAst('try { a(); } catch (e) { b(); } finally { c(); }');
  assert.equal(hits.length, 0);
});

// ---------- checkFuncLinesAst（AST 精确行数） ----------
test('func-lines：超 warn 阈值命中', () => {
  const src = 'function longFn() {\n' + '  x();\n'.repeat(60) + '}';
  const hits = checkFuncLinesAst(src, { warn: 50, block: 100 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, 'warning');
  assert.equal(hits[0].len, 62);
});

test('func-lines：超 block 阈值 → blocker', () => {
  const src = 'function hugeFn() {\n' + '  x();\n'.repeat(120) + '}';
  const hits = checkFuncLinesAst(src, { warn: 50, block: 100 });
  assert.equal(hits[0].level, 'blocker');
});

test('func-lines：短函数不命中', () => {
  const hits = checkFuncLinesAst('function ok() { return 1; }', { warn: 50, block: 100 });
  assert.equal(hits.length, 0);
});

test('func-lines：嵌套函数分别计数', () => {
  const src = 'function outer() {\n  function inner() {\n    return 1;\n  }\n}';
  const hits = checkFuncLinesAst(src, { warn: 50, block: 100 });
  assert.equal(hits.length, 0); // 都不超阈值
});

test('func-lines：字符串里的 function 不误报', () => {
  const hits = checkFuncLinesAst('const t = "function fake() {}";', { warn: 50, block: 100 });
  assert.equal(hits.length, 0);
});

// ---------- 坏样本锚定（同 fixture 100% 检出） ----------
test('坏样本文件：三类质量检查 100% 检出（同 fixture 锚定）', () => {
  const bad = [
    'import { readFileSync } from "node:fs";',
    'async function load() {',
    '  const s = readFileSync("/etc/passwd");', // named-import sync（旧项目漏）
    '  try {',
    '    fs.readdirSync(".");',                 // fs-prefix sync
    '  } catch (err) {',                        // 多行空 catch（旧项目漏）
    '    ',
    '  }',
    '}',
    'function longFn() {',
    ...Array.from({ length: 60 }, () => '  x();'),
    '}',
  ].join('\n');
  const syncHits = checkSyncFs(bad);
  assert.equal(syncHits.length, 2, `sync-fs 应命中 2 处（named-import + fs-prefix），实际 ${syncHits.length}`);
  const catchHits = checkEmptyCatchAst(bad);
  assert.equal(catchHits.length, 1, '多行空 catch 应命中');
  const funcHits = checkFuncLinesAst(bad, { warn: 50, block: 100 });
  assert.equal(funcHits.length, 1, '超长函数应命中');
});

// ---------- 检查器接入审计（finding 形状） ----------
test('checkSyncFsInFile：产出统一 finding（rule/kind/dimensions/exemptHint）', () => {
  const f = checkSyncFsInFile({ file: 'a.mjs', text: 'async function a() { fs.readFileSync("x"); }' });
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'quality/sync-fs');
  assert.equal(f[0].kind, 'sync-fs');
  assert.equal(f[0].severity, 'warning');
  assert.ok(f[0].dimensions.includes('性能'));
  assert.ok(f[0].exemptHint.includes('dsh-skip-quality'));
});

test('checkEmptyCatch：多行空块经审计入口命中', () => {
  const f = checkEmptyCatch({ file: 'a.js', text: 'try { a(); } catch (e) {\n\n}' });
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'empty-catch');
});

// ---------- scoreQuality / countByDimension ----------
test('countByDimension：warning 计 1 / blocker 计 2', () => {
  const counts = countByDimension([
    { dimensions: ['性能'], severity: 'warning' },
    { dimensions: ['性能'], severity: 'blocker' },
    { dimensions: ['健壮性'], severity: 'warning' },
  ]);
  assert.equal(counts['性能'], 3);
  assert.equal(counts['健壮性'], 1);
});

test('countByDimension：未知维度忽略', () => {
  const counts = countByDimension([{ dimensions: ['不存在维度'], severity: 'warning' }]);
  assert.equal(counts['不存在维度'], undefined);
});

test('scoreQuality：零问题 → 100 分 A', () => {
  const r = scoreQuality([]);
  assert.equal(r.score, 100);
  assert.equal(r.level, 'A');
});

test('scoreQuality：qualityWeights 覆盖生效（权重可调）', () => {
  const w = { ...DEFAULT_WEIGHTS, '安全性': 0, '性能': 100 };
  const r = scoreQuality([{ dimensions: ['性能'], severity: 'warning' }], w);
  assert.equal(r.weights['性能'], 100);
  assert.equal(r.weights['安全性'], 0);
});

test('scoreQuality：level 分级与单维度扣分上限（权重占比生效）', () => {
  // 单维度全扣：性能权重 10% → 全扣后 90 分（验证权重覆盖生效，非 bug）
  const heavy = [];
  for (let i = 0; i < 30; i++) heavy.push({ dimensions: ['性能'], severity: 'blocker' });
  assert.equal(scoreQuality(heavy).score, 90);
  // 跨维度压分：10 维度各 3 个 blocker → 每维 counts=6，分数显著下降
  const dims = ['可读性', '可维护性', '健壮性', '安全性', '性能', '测试覆盖', '可观测性', '可部署性', '文档', '开发者体验'];
  const all = [];
  for (const d of dims) for (let i = 0; i < 3; i++) all.push({ dimensions: [d], severity: 'blocker' });
  const r = scoreQuality(all);
  assert.ok(r.score < 70, `跨维度 blocker 应 <70，实际 ${r.score}`);
  assert.ok(r.level === 'D' || r.level === 'C');
});

test('scoreQuality：dimensions 汇总齐全（10 键）', () => {
  const r = scoreQuality([]);
  assert.equal(Object.keys(r.dims).length, 10);
  assert.equal(Object.keys(r.counts).length, 10);
});

test('scoreQuality：返回 counts 供审计展示', () => {
  const r = scoreQuality([{ dimensions: ['安全性'], severity: 'warning' }]);
  assert.equal(r.counts['安全性'], 1);
});