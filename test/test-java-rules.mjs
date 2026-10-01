/**
 * Java/Kotlin 语言路由与专项规则测试（2026-10-06）：
 * ① AST 层 lib/ast/lang.js——javaKtFuncRanges（方法签名+括号配对）、detectLang；
 * ② checkNameLengthAst 的 Java/Kotlin 分支（类型+短名声明、fun 函数名）；
 * ③ checkComplexityAst 的 Java/Kotlin 路由（按方法区间数分支点）；
 * ④ audit-rules-java.yml 编译 → 对 Java/Kotlin 样本真正产出 findings（exts 限定）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- AST 层：方法范围 ----------
test('javaKtFuncRanges：Java 方法/构造器识别（不含调用）', async () => {
  const { javaKtFuncRanges } = await import('../lib/ast/lang.js');
  const java = [
    'package com.example;',
    'public class Foo {',
    '    public Foo() { }',                    // 构造器
    '    private void helper(int x) {',        // 方法
    '        int y = x + 1;',
    '    }',
    '    public void convert(Item item) {',    // 方法
    '        helper(1);',                      // 调用（不误识）
    '        if (item != null) {',
    '            System.out.println(item);',
    '        }',
    '    }',
    '    void topCall() { }',                  // 无修饰符方法
    '}',
  ].join('\n');
  const ranges = javaKtFuncRanges(java);
  assert.equal(ranges.length, 4, `应识别 4 个方法（构造器/helper/convert/topCall）：${JSON.stringify(ranges)}`);
  assert.equal(ranges[0].name, 'Foo', '构造器名=类名');
  assert.equal(ranges[1].name, 'helper');
  assert.equal(ranges[2].name, 'convert');
});

test('javaKtFuncRanges：Kotlin fun 识别（含返回值类型/默认参数）', async () => {
  const { javaKtFuncRanges } = await import('../lib/ast/lang.js');
  const kt = [
    'package com.example',
    'class Kt {',
    '    private fun shortName() {',
    '        val x = 1',
    '    }',
    '    fun bar(a: Int): String {',
    '        val s = "hello"',
    '        return s',
    '    }',
    '}',
    'fun topLevel(x: Int = 1) {',
    '    println(x)',
    '}',
  ].join('\n');
  const ranges = javaKtFuncRanges(kt);
  assert.equal(ranges.length, 3, `应识别 3 个 fun：${JSON.stringify(ranges)}`);
  assert.equal(ranges[0].name, 'shortName');
  assert.equal(ranges[1].name, 'bar');
  assert.equal(ranges[2].name, 'topLevel');
});

test('javaKtFuncRanges：JS 文件不误伤（零命中）', async () => {
  const { javaKtFuncRanges } = await import('../lib/ast/lang.js');
  const js = 'function foo() { const x = bar(1); return x; }\nconst y = baz(2);\nif (a) { c(); }\nobj.method(3);';
  assert.equal(javaKtFuncRanges(js).length, 0, 'JS 不应被 Java 方法识别');
});

test('detectLang：内容启发式识别 Java/Kotlin/Python/JS', async () => {
  const { detectLang } = await import('../lib/ast/lang.js');
  assert.equal(detectLang('public class Foo { private void bar() {} }'), 'java');
  assert.equal(detectLang('package x\nclass Kt { fun foo() {} }'), 'kotlin');
  assert.equal(detectLang('def f(x):\n    return x'), 'python');
  assert.equal(detectLang('function foo() { return 1; }'), 'js');
});

// ---------- AST 层：短名 ----------
test('checkNameLengthAst：Java 类型+短名声明识别（去重）', async () => {
  const { checkNameLengthAst } = await import('../lib/ast/naming.js');
  const java = [
    'public class Foo {',
    '    private int q;',                    // 字段 q（非豁免）
    '    public void bar(String s) {',       // s 豁免
    '        int w = 5;',                    // 局部 w
    '        String ok = "a";',
    '    }',
    '}',
  ].join('\n');
  const hits = checkNameLengthAst(java, { min: 2 });
  assert.deepEqual(hits.map((h) => h.name).sort(), ['q', 'w'], `应报 q/w 且不重复：${JSON.stringify(hits)}`);
});

test('checkNameLengthAst：Kotlin fun 短函数名识别', async () => {
  const { checkNameLengthAst } = await import('../lib/ast/naming.js');
  // f 在默认豁免集（i/j/k/f/x/y/z 等常用单字母），用非豁免短名 q
  const kt = 'class Kt { fun q() { } fun show() { } }';
  const hits = checkNameLengthAst(kt, { min: 2 });
  assert.ok(hits.some((h) => h.name === 'q' && h.type === 'function'), `应报 fun q：${JSON.stringify(hits)}`);
  assert.ok(!hits.some((h) => h.name === 'show'), 'show 不应报');
});

// ---------- AST 层：复杂度 ----------
test('checkComplexityAst：Java 按方法区间数分支点（when 计入）', async () => {
  const { checkComplexityAst } = await import('../lib/ast/control-flow.js');
  const java = [
    'public class Complex {',
    '    public void manyBranches(int a) {',
    '        if (a > 0) {',
    '            for (int i = 0; i < a; i++) {',
    '                if (i % 2 == 0 && a > 10) {',
    '                    do { a--; } while (a > 5);',
    '                }',
    '            }',
    '        }',
    '    }',
    '    public void simple(int b) {',
    '        int c = b + 1;',
    '    }',
    '}',
  ].join('\n');
  const hits = checkComplexityAst(java, { warn: 3, block: 10 });
  assert.equal(hits.length, 1, `应只报 manyBranches：${JSON.stringify(hits)}`);
  assert.equal(hits[0].name, 'manyBranches');
  assert.ok(hits[0].complexity >= 5, '分支点（if/for/if/&&/do/while）应计入');
});

// ---------- 规则联动（audit-rules-java.yml） ----------
test('java 规则编译：7 条全部落到正确 kind + exts 限定 [java,kt]', async () => {
  const { loadRuleFiles } = await import('../lib/rule/loader.js');
  const { compileAllRules } = await import('../lib/rule/registry.js');
  await import('../lib/rule/compilers.js');
  const loaded = loadRuleFiles(['nodejs', 'java', 'python']);
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const javaRules = compiled.filter((r) => r.slot === 'java');
  const map = Object.fromEntries(javaRules.map((r) => [r.id, r.kind]));
  assert.deepEqual(map, {
    'java/variable-min-length': 'min-length',
    'java/magic-number': 'magic-number-smart',
    'java/max-nesting-depth': 'max-depth',
    'java/max-function-length': 'func-lines',
    'java/max-file-length': 'max-lines',
    'java/comment-density': 'comment-density',
    'java/max-cyclomatic-complexity': 'max-complexity',
  });
  for (const r of javaRules) assert.deepEqual(r.exts, ['java', 'kt'], `${r.id} 应限定 exts=[java,kt]`);
});

test('auditFile：Java 长方法触发 java/max-function-length（func-lines 生效）', async () => {
  const { auditFile } = await import('../lib/audit/audit-file.js');
  const { loadRuleFiles } = await import('../lib/rule/loader.js');
  const { compileAllRules } = await import('../lib/rule/registry.js');
  await import('../lib/rule/compilers.js');
  const loaded = loadRuleFiles(['nodejs', 'java', 'python']);
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const grouped = {};
  for (const r of compiled) (grouped[r.kind] ||= []).push(r);
  const lines = ['public class LongMethod {', '    public void tooLong() {'];
  for (let i = 0; i < 55; i++) lines.push(`        int v${i} = ${i};`);
  lines.push('    }', '}');
  const findings = auditFile({ file: 'src/LongMethod.java', relPath: 'src/LongMethod.java', text: lines.join('\n'), grouped }, { level: 'full', repoPath: '.' });
  assert.ok(findings.some((f) => f.rule === 'java/max-function-length'), '55 行方法应触发 java/max-function-length');
  assert.ok(findings.some((f) => f.rule === 'java/magic-number'), '魔数规则对 Java 生效');
});

test('auditFile：JS 文件不受 java 规则影响（exts 过滤）', async () => {
  const { auditFile } = await import('../lib/audit/audit-file.js');
  const { loadRuleFiles } = await import('../lib/rule/loader.js');
  const { compileAllRules } = await import('../lib/rule/registry.js');
  await import('../lib/rule/compilers.js');
  const loaded = loadRuleFiles(['nodejs', 'java', 'python']);
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const grouped = {};
  for (const r of compiled) (grouped[r.kind] ||= []).push(r);
  const js = 'function add(a, b) { return a + b; }\nconst x = 1;';
  const findings = auditFile({ file: 'src/a.js', relPath: 'src/a.js', text: js, grouped }, { level: 'full', repoPath: '.' });
  assert.ok(!findings.some((f) => f.rule && f.rule.startsWith('java/')), 'JS 文件不应触发 java/* 规则');
});

// ---------- 复杂度口径（2026-10-02 用户标准） ----------
test('checkComplexityAst：do-while 计 1（do 不进分支集合）', async () => {
  const { checkComplexityAst } = await import('../lib/ast/control-flow.js');
  const dw = 'function f() { do { x(); } while (a); }';
  const hits = checkComplexityAst(dw, { warn: 1, block: 50 });
  assert.equal(hits[0]?.complexity, 2, 'do-while 应计 2（基数1+while1），do 不重复计');
});

test('checkComplexityAst：带标签 break/continue +1，普通 break 不计', async () => {
  const { checkComplexityAst } = await import('../lib/ast/control-flow.js');
  const lb = 'function g() { outer: for (let i=0;i<3;i++) { for (let j=0;j<3;j++) { if (j>1) break outer; } } }';
  const hits = checkComplexityAst(lb, { warn: 1, block: 50 });
  assert.equal(hits[0]?.complexity, 5, '带标签 break 计 5（基数1+for2+if1+break1）');
  // 普通 break（switch case 收尾）不计；default 不是 case 分支也不计
  const sw = 'function h(x) { switch (x) { case 1: break; case 2: break; default: break; } }';
  const hits2 = checkComplexityAst(sw, { warn: 1, block: 50 });
  assert.equal(hits2[0]?.complexity, 3, 'switch 计 3（基数1+case2），普通 break 与 default 不计');
});

test('checkComplexityAst：else if 每分支 +1', async () => {
  const { checkComplexityAst } = await import('../lib/ast/control-flow.js');
  const ei = 'function h(a) { if (a===1) return 1; else if (a===2) return 2; else if (a===3) return 3; return 0; }';
  const hits = checkComplexityAst(ei, { warn: 1, block: 50 });
  assert.equal(hits[0]?.complexity, 4, 'else if 计 4（基数1+if×3）');
});

test('max-complexity 规则：threshold 10 / block 50 编译透传 + severity blocker', async () => {
  const { loadRuleFiles } = await import('../lib/rule/loader.js');
  const { compileAllRules } = await import('../lib/rule/registry.js');
  await import('../lib/rule/compilers.js');
  const loaded = loadRuleFiles();
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  for (const id of ['maintainability/max-cyclomatic-complexity', 'java/max-cyclomatic-complexity', 'python/max-cyclomatic-complexity']) {
    const r = compiled.find((x) => x.id === id);
    assert.ok(r, id + ' 应编译');
    assert.equal(r.threshold, 10, id + ' warning 阈值应为 10');
    assert.equal(r.block, 50, id + ' blocker 阈值应为 50');
    assert.equal(r.severity, 'blocker', id + ' severity 应为 blocker（cap 后 10-50 warning / 50+ blocker）');
  }
});

test('checkComplexity：分档——良好不报/中等/高风险/极难维护 blocker', async () => {
  const { loadRuleFiles } = await import('../lib/rule/loader.js');
  const { compileAllRules } = await import('../lib/rule/registry.js');
  const { checkComplexity } = await import('../lib/checks/structural.js');
  await import('../lib/rule/compilers.js');
  const loaded = loadRuleFiles();
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const nr = compiled.find((r) => r.id === 'maintainability/max-cyclomatic-complexity');
  const mk = (n) => ['function f() {', ...Array.from({ length: n }, (_, i) => `if (v${i} > ${i}) { w${i}(); }`), '}'].join('\n');
  assert.equal(checkComplexity({ file: 'ok.js', relPath: 'ok.js', text: mk(9), rules: [nr] }).length, 0, '9 分支（10）良好不报');
  const mid = checkComplexity({ file: 'mid.js', relPath: 'mid.js', text: mk(11), rules: [nr] })[0];
  assert.equal(mid.severity, 'warning', '11 分支（12）中等 warning');
  assert.ok(mid.message.includes('中等'), 'message 应标中等');
  const hi = checkComplexity({ file: 'hi.js', relPath: 'hi.js', text: mk(25), rules: [nr] })[0];
  assert.equal(hi.severity, 'warning', '25 分支（26）高风险 warning');
  assert.ok(hi.message.includes('高风险'), 'message 应标高风险');
  const mon = checkComplexity({ file: 'mon.js', relPath: 'mon.js', text: mk(60), rules: [nr] })[0];
  assert.equal(mon.severity, 'blocker', '60 分支（61）极难维护 blocker（拦提交）');
  assert.ok(mon.message.includes('极难维护'), 'message 应标极难维护');
});
test('checkMaxLines：聚合型（文件大但函数都合规）降级 info', async () => {
  const { checkMaxLines } = await import('../lib/checks/structural.js');
  const lines = ['public class Agg {'];
  for (let i = 0; i < 10; i++) {
    lines.push(`    public void f${i}() {`);
    for (let j = 0; j < 8; j++) lines.push(`        int v = ${j};`);
    lines.push('    }');
  }
  lines.push('}');
  const rule = { id: 'java/max-file-length', threshold: 50, severity: 'warning' };
  const f = checkMaxLines({ file: 'Agg.java', text: lines.join('\n'), rules: [rule] });
  assert.equal(f.length, 1, '超行数应产出一条');
  assert.equal(f[0].severity, 'info', '聚合型应降级 info');
  assert.equal(f[0].scoreImpact, 0, '聚合型不扣分');
});

test('checkMaxLines：臃肿型（文件大因藏超大函数）保持 warning', async () => {
  const { checkMaxLines } = await import('../lib/checks/structural.js');
  const lines = ['public class Fat {', '    public void big() {'];
  for (let i = 0; i < 80; i++) lines.push(`        int v${i} = ${i};`);
  lines.push('    }', '}');
  const rule = { id: 'java/max-file-length', threshold: 50, severity: 'warning' };
  const f = checkMaxLines({ file: 'Fat.java', text: lines.join('\n'), rules: [rule] });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning', '臃肿型保持 warning');
  assert.ok(f[0].message.includes('臃肿型'), 'message 应说明臃肿型');
});

test('checkMaxLines：无函数纯脚本超长不豁免（保持 warning）', async () => {
  const { checkMaxLines } = await import('../lib/checks/structural.js');
  const top = [];
  for (let i = 0; i < 120; i++) top.push(`const v${i} = ${i};`);
  const rule = { id: 'nodejs/max-lines', threshold: 50, severity: 'warning' };
  const f = checkMaxLines({ file: 'top.js', text: top.join('\n'), rules: [rule] });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, 'warning', '无函数脚本超长不豁免');
});
