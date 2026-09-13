// dsh-skip-sensitive: 测试 fixture 仅演示代码，无真实凭据
/**
 * 2026-09-14 三层审计（L1 正则初筛 / L2 AST 数据流 / 空规则守卫）测试。
 *
 * 场景对照（用户 2026-09-14 三层设计）：
 *   L1 正则：file_patterns 只筛「可能含清空+访问」的候选文件，未命中剔除规则（成本极低）
 *   L2 AST：同函数内清空（clear()/=[]/=null/length=0/splice(0)）后访问（.get()/[0]）才报
 *   L3 运行时：跨文件/闭包/异步盲区（scripts/audit-runtime-check.mjs，此处测 L2 侧判定）
 * 守卫：规则被 L1 剔除/excludes 过滤为空时检查器短路（防 rule.severity 崩溃——修 iwara 触发的崩）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkClearAccessAst } from '../lib/ast/dataflow.js';
import { checkDataflow, filterRulesByFileText, runChecks } from '../lib/audit/checks.js';
import { compileAllRules } from '../lib/rule/registry.js';
import { loadRuleFiles } from '../lib/rule/loader.js';

const RULE = { id: 'dataflow/clear-then-access', kind: 'dataflow', severity: 'warning' };

function hits(text) {
  return checkDataflow({ file: 'dataflow-test.js', text, rules: [RULE] });
}

// ---------- L2：同函数清空后访问 ----------
test('dataflow：clear() 后 get()（同函数）命中', () => {
  const text = 'function f() { cache.clear(); return cache.get(id); }';
  const r = hits(text);
  assert.equal(r.length, 1);
  assert.match(r[0].message, /cache/);
  assert.match(r[0].message, /\.clear\(\)/);
});

test('dataflow：=[] 后 [0] 命中；=null 后 [0] 命中', () => {
  assert.equal(hits('function f() { list = []; return list[0]; }').length, 1);
  assert.equal(hits('function f() { q = null; return q[0]; }').length, 1);
  assert.equal(hits('function f() { q.length = 0; return q[0]; }').length, 1);
});

test('dataflow：声明初始化（var x = []）不算清空', () => {
  const text = 'var allVideos = []; function f() { return allVideos[0]; }';
  assert.equal(hits(text).length, 0);
});

test('dataflow：清空后写回（push/set/重新赋值）撤销', () => {
  assert.equal(hits('function f() { cache.clear(); cache.set("a", 1); return cache.get("a"); }').length, 0);
  assert.equal(hits('function f() { list = []; list = [1, 2]; return list[0]; }').length, 0);
});

test('dataflow：引用传参填充撤销（walkVideos(root, files, 0)）', () => {
  const text = 'function f() { files = []; walkVideos(root, files, 0); return files.length; }';
  assert.equal(hits(text).length, 0);
});

test('dataflow：跨函数不连（顶层清空 → 函数内访问）', () => {
  const text = 'resultsByIndex = new Map(); function skipItem() { resultsByIndex.set(i, x); }';
  assert.equal(hits(text).length, 0);
});

test('dataflow：先访问后清空不命中', () => {
  const text = 'function f() { const x = cache.get("a"); cache.clear(); return x; }';
  assert.equal(hits(text).length, 0);
});

test('dataflow：shift/pop 消费式访问不报（while len 保护模式）', () => {
  const text = 'function pump() { while (queue.length) { const it = queue.shift(); use(it); } }';
  assert.equal(hits(text).length, 0);
});

// ---------- L1：file_patterns 文件内容初筛 ----------
test('L1：file_patterns 命中候选保留，未命中剔除', () => {
  const rule = {
    id: 'dataflow/clear-then-access', kind: 'dataflow', severity: 'warning',
    filePatterns: ['clear\\(', '=\\s*\\[\\]'],
  };
  const grouped = { dataflow: [rule] };
  assert.equal(filterRulesByFileText(grouped, 'cache.clear();').dataflow.length, 1);
  assert.equal(filterRulesByFileText(grouped, 'just a normal file').dataflow.length, 0);
});

test('L1：非法正则退回子串包含（保守放行）', () => {
  const rule = { id: 'x', kind: 'dataflow', filePatterns: ['(unclosed'] };
  const grouped = { dataflow: [rule] };
  assert.equal(filterRulesByFileText(grouped, '(unclosed [').dataflow.length, 1);
  assert.equal(filterRulesByFileText(grouped, 'nothing here').dataflow.length, 0);
});

// ---------- 空规则守卫（防 rule.severity 崩溃） ----------
test('守卫：rules 为空数组检查器短路（不崩）', () => {
  assert.deepEqual(checkDataflow({ file: 'x.js', text: 'cache.clear(); cache.get(1);', rules: [] }), []);
  assert.deepEqual(checkDataflow({ file: 'x.js', text: 'cache.clear();', rules: undefined }), []);
});

test('守卫：runChecks 全链路空规则不崩（L1 剔除 dataflow）', () => {
  const rule = { id: 'dataflow/clear-then-access', kind: 'dataflow', severity: 'warning', filePatterns: ['zzz-not-present'] };
  const grouped = { dataflow: [rule] };
  // L1 剔除 → dataflow 规则空 → 检查器短路；文件不崩
  const out = runChecks({ file: 't.js', relPath: 't.js', text: 'cache.clear(); cache.get(1);', grouped }, { level: 'standard' });
  assert.ok(Array.isArray(out));
});

// ---------- 编译集成：yml 规则能编译成 dataflow kind ----------
test('集成：yml dataflow/clear-then-access 编译成功且带 filePatterns', () => {
  const loaded = loadRuleFiles(['nodejs'], { dir: '', disabledSlots: [] });
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const df = compiled.filter((r) => r.kind === 'dataflow');
  assert.equal(df.length, 1);
  assert.equal(df[0].id, 'dataflow/clear-then-access');
  assert.ok(Array.isArray(df[0].filePatterns) && df[0].filePatterns.length > 0);
});

// ---------- AST 层直接验证（跨语言/跨扩展不误入由 gitignore 层管） ----------
test('ast：checkClearAccessAst 空文本/无函数安全返回空', () => {
  assert.deepEqual(checkClearAccessAst(''), []);
  assert.deepEqual(checkClearAccessAst('const a = 1;'), []);
});
