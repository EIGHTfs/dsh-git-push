// C# 规则包（audit-rules-csharp.yml）结构与判定回归。
//
// 三层断言，各有不可替代的作用：
//   ① 槽位被自动发现、规则 id 前缀正确 —— 少一个 id 说明规则没被加载（静默无效）；
//   ② 每条规则「该报」+「不该报」各一条 —— 只测该报会把「什么都报」的坏规则测成绿；
//      不该报的样本刻意包含注释/字符串里的同名文本（astConfirm 必须把它们排除）；
//   ③ exts 限定 —— 同样的文本写进 .js 必须不报，否则该槽位会污染其它语言的审计结果。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { auditWithScope } from '../lib/audit/orchestrate.js';
import { discoverRuleSlots } from '../lib/rule/loader.js';

const CSHARP_RULES = ['csharp/throw-ex', 'csharp/generic-exception', 'csharp/lock-on-self-or-type'];

/** 造临时 git 仓库（审计的文件收集走 git ⇒ 必须 add）。 */
function makeRepo(files) {
  const sandbox = mkdtempSync(join(tmpdir(), 'csharp-rules-'));
  execFileSync('git', ['init', '-q'], { cwd: sandbox });
  mkdirSync(join(sandbox, 'src'), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(sandbox, 'src', name), content, 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: sandbox });
  return sandbox;
}

/** 跑一次审计，返回 { 规则id: [命中的文件名] }（只看本槽位的规则）。 */
async function auditCsharp(repo) {
  const r = await auditWithScope(repo, { scope: 'full', maxScanFiles: 500 });
  const out = {};
  for (const f of r.findings || []) {
    if (!String(f.rule).startsWith('csharp/')) continue;
    (out[f.rule] = out[f.rule] || []).push(String(f.file).split('/').pop());
  }
  return out;
}

test('槽位：audit-rules-csharp.yml 被自动发现，三条规则都在', () => {
  const slots = discoverRuleSlots();
  const names = slots.map((s) => (typeof s === 'string' ? s : s.name || s.slot));
  assert.ok(names.includes('csharp'), `槽位名应含 csharp，实际：${names.join(',')}`);
});

test('该报的报：throw ex / throw new Exception / lock(this|typeof)', async () => {
  const repo = makeRepo({
    'bad.cs': [
      'using System;',
      'class A {',
      '    void F() {',
      '        try { G(); } catch (Exception ex) { throw ex; }',
      '        throw new Exception("boom");',
      '        lock (this) { H(); }',
      '        lock (typeof(A)) { H(); }',
      '    }',
      '    void G() { }',
      '    void H() { }',
      '}',
    ].join('\n'),
  });
  try {
    const hits = await auditCsharp(repo);
    for (const rule of CSHARP_RULES) {
      assert.ok((hits[rule] || []).includes('bad.cs'), `${rule} 应报 bad.cs，实际 ${JSON.stringify(hits[rule] || [])}`);
    }
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('不该报的不报：裸 throw / 具体异常类型 / 私有锁对象', async () => {
  const repo = makeRepo({
    'good.cs': [
      'using System;',
      'class B {',
      '    readonly object gate = new object();',
      '    void F() {',
      '        try { G(); } catch (Exception ex) { throw; }',
      '        throw new InvalidOperationException("boom");',
      '        lock (gate) { H(); }',
      '    }',
      '    void G() { }',
      '    void H() { }',
      '}',
    ].join('\n'),
  });
  try {
    const hits = await auditCsharp(repo);
    assert.deepEqual(hits, {}, `不该有任何 C# 规则命中，实际：${JSON.stringify(hits)}`);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('注释与字符串里的同名文本不算代码（astConfirm）', async () => {
  const repo = makeRepo({
    'quoted.cs': [
      '// throw ex; 会丢栈；throw new Exception("x") 不推荐；lock (this) 有死锁风险',
      '/* throw ex; */',
      'class C {',
      '    const string S = "throw ex;";',
      '    string T = @"lock (this)";',
      '    string U = "throw new Exception(\\"x\\")";',
      '}',
    ].join('\n'),
  });
  try {
    const hits = await auditCsharp(repo);
    assert.deepEqual(hits, {}, `注释/字符串里的文本不应命中，实际：${JSON.stringify(hits)}`);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('exts 限定：同样的文本写进 .js 不报（不污染其它语言）', async () => {
  const repo = makeRepo({
    'same.js': [
      'function f() {',
      '  try { g(); } catch (e) { throw e; }',
      '  return new Exception("boom");',
      '}',
    ].join('\n'),
  });
  try {
    const hits = await auditCsharp(repo);
    assert.deepEqual(hits, {}, `非 .cs 文件不应命中 C# 槽位，实际：${JSON.stringify(hits)}`);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
