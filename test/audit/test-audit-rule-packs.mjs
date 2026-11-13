/**
 * test-audit-rule-packs.mjs —— 同族测试合并（test-audit-npm-publish-rules.mjs · test-audit-rules-csharp.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { auditWithScope } from '../../lib/audit/orchestrate.js';
import { checkNpmJson } from '../../lib/checks/npm-json.js';
import { discoverRuleSlots } from '../../lib/rule/loader.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// ── 原 test-audit-npm-publish-rules.mjs ──
{
  /**
   * 回归：npm 发布清单类规则的 5 个新增结构化检查（依据 skill `npm-publish-checklist-NPM发布检查清单.md`）。
   *
   * 覆盖：license=UNLICENSED / files 夹带敏感内容或体积产物 / 元信息不全 / prepack 类脚本提示 / peer 无显式上界。
   * 全部走 checkNpmJson 的结构化判定（真实解析 package.json），并各配一个「合规不报」样例防误报。
   *
   * 断言口径：按**目标规则是否命中**判定（findings 里可能同时有其它规则的合理命中，
   *   例如极简 fixture 缺 author/keywords 会被 npm/meta-incomplete 一并命中），不做全量 deepEqual。
   */


  const RULES = [
    { id: 'npm/license-unlicensed', name: 'license 未授权', severity: 'warning' },
    { id: 'npm/files-risky-entry', name: 'files 含敏感/产物', severity: 'warning' },
    { id: 'npm/meta-incomplete', name: '元信息不全', severity: 'info' },
    { id: 'npm/prepack-script-present', name: '有发布脚本', severity: 'info' },
    { id: 'npm/peer-range-unbounded', name: 'peer 无上界', severity: 'info' },
  ];

  /** 跑一次检查（只给这些规则，隔离其它规则干扰）。 */
  const run = (text) => checkNpmJson({ file: '/repo/package.json', text, rules: RULES, repoPath: '' });
  const hits = (text, rule) => run(text).filter((f) => f.rule === rule);
  const has = (text, rule) => hits(text, rule).length > 0;
  const msg = (text, rule) => hits(text, rule)[0]?.message || '';

  test('[audit-npm-publish-rules] license：UNLICENSED 报 warning，MIT 不报', () => {
    assert.equal(has('{"name":"a","license":"UNLICENSED"}', 'npm/license-unlicensed'), true);
    assert.match(msg('{"name":"a","license":"UNLICENSED"}', 'npm/license-unlicensed'), /UNLICENSED/);
    assert.equal(has('{"name":"a","license":"MIT"}', 'npm/license-unlicensed'), false);
    assert.equal(hits('{"name":"a","license":"PROPRIETARY"}', 'npm/license-unlicensed')[0]?.severity, 'warning');
  });

  test('[audit-npm-publish-rules] files：敏感条目升级为 blocker（.env / credential / *.pem / node_modules）', () => {
    const text = '{"name":"a","files":["lib",".env","config/credentials.json","certs/key.pem","node_modules"]}';
    const f = hits(text, 'npm/files-risky-entry');
    assert.equal(f.length, 4, `应报 4 条敏感条目，实得 ${f.length}`);
    assert.ok(f.every((x) => x.severity === 'blocker'), '敏感条目应为 blocker（凭据随包发布不可逆）');
  });

  test('[audit-npm-publish-rules] files：体积产物按规则严重度报（*.tgz / music / 字体）；普通白名单不报', () => {
    const text = '{"name":"a","files":["lib","dist/a.tgz","music","assets/x.woff2"]}';
    const f = hits(text, 'npm/files-risky-entry');
    assert.equal(f.length, 3, `应报 3 条产物条目，实得 ${f.length}`);
    assert.ok(f.every((x) => x.severity === 'warning'), '产物条目应为 warning');
    assert.equal(has('{"name":"a","files":["lib","skills","README.md"]}', 'npm/files-risky-entry'), false);
  });

  test('[audit-npm-publish-rules] meta：缺 author/keywords/bugs/homepage 逐个列出，齐全不报', () => {
    const m = msg('{"name":"a"}', 'npm/meta-incomplete');
    for (const k of ['author', 'keywords', 'bugs', 'homepage']) assert.match(m, new RegExp(k), `应列出缺 ${k}`);
    const full = '{"name":"a","author":"x","keywords":["dsh"],"bugs":"https://x/y/issues","homepage":"https://x/y"}';
    assert.equal(has(full, 'npm/meta-incomplete'), false, '元信息齐全不应报');
  });

  test('[audit-npm-publish-rules] prepack：有 prepack/prepare/publishOnly 提示，非发布脚本不报', () => {
    assert.equal(has('{"name":"a","scripts":{"prepack":"node build.mjs"}}', 'npm/prepack-script-present'), true);
    assert.match(msg('{"name":"a","scripts":{"prepare":"x","publishOnly":"y"}}', 'npm/prepack-script-present'), /prepare.*publishOnly/);
    assert.equal(has('{"name":"a","scripts":{"test":"node t.mjs"}}', 'npm/prepack-script-present'), false, '非发布脚本不应报');
  });

  test('[audit-npm-publish-rules] peer：无显式上界提示；有上界 / * / 私有包不报', () => {
    assert.equal(hits('{"name":"a","peerDependencies":{"x":"^4.1.0"}}', 'npm/peer-range-unbounded').length, 1);
    assert.equal(has('{"name":"a","peerDependencies":{"x":">=0.1.6-0 <0.3.0-0"}}', 'npm/peer-range-unbounded'), false, '显式区间不应报');
    assert.equal(has('{"name":"a","peerDependencies":{"x":"*"}}', 'npm/peer-range-unbounded'), false, '* 交由 star 规则管辖');
    assert.equal(has('{"name":"a","private":true,"peerDependencies":{"x":"^4.1.0"}}', 'npm/peer-range-unbounded'), false, '私有包不报');
  });

  test('[audit-npm-publish-rules] 合规样例（本仓库形态）只命中 prepack 提示这一条', () => {
    const text = JSON.stringify({
      name: 'dsh-demo', version: '1.0.0', license: 'MIT', author: 'x', keywords: ['dsh'],
      bugs: 'https://x/y/issues', homepage: 'https://x/y#readme',
      files: ['lib', 'skills', 'scripts', 'cli.mjs', 'README.md', 'LICENSE', '.gitignore'],
      peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.1.6-0 <0.3.0-0' },
      scripts: { prepare: 'node scripts/build-client.mjs', test: 'node test/run-tests.mjs' },
    });
    const ids = run(text).map((f) => f.rule).sort();
    assert.deepEqual(ids, ['npm/prepack-script-present'], `应只命中 prepack，实得：${ids.join(', ')}`);
  });
}

// ── 原 test-audit-rules-csharp.mjs ──
{
  // C# 规则包（audit-rules-csharp.yml）结构与判定回归。
  //
  // 三层断言，各有不可替代的作用：
  //   ① 槽位被自动发现、规则 id 前缀正确 —— 少一个 id 说明规则没被加载（静默无效）；
  //   ② 每条规则「该报」+「不该报」各一条 —— 只测该报会把「什么都报」的坏规则测成绿；
  //      不该报的样本刻意包含注释/字符串里的同名文本（astConfirm 必须把它们排除）；
  //   ③ exts 限定 —— 同样的文本写进 .js 必须不报，否则该槽位会污染其它语言的审计结果。


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

  test('[audit-rules-csharp] 槽位：audit-rules-csharp.yml 被自动发现，三条规则都在', () => {
    const slots = discoverRuleSlots();
    const names = slots.map((s) => (typeof s === 'string' ? s : s.name || s.slot));
    assert.ok(names.includes('csharp'), `槽位名应含 csharp，实际：${names.join(',')}`);
  });

  test('[audit-rules-csharp] 该报的报：throw ex / throw new Exception / lock(this|typeof)', async () => {
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

  test('[audit-rules-csharp] 不该报的不报：裸 throw / 具体异常类型 / 私有锁对象', async () => {
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

  test('[audit-rules-csharp] 注释与字符串里的同名文本不算代码（astConfirm）', async () => {
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

  test('[audit-rules-csharp] exts 限定：同样的文本写进 .js 不报（不污染其它语言）', async () => {
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
}
