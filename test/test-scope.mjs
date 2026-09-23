import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- 作用域判断 · 最小实验（2026-09-23 方案 Step 1 + 3 + 4 最小版） ----------

// 机制层：lib/rule/scope.js（scope_rules 规范化 + action 解析）
import { normalizeScopeRules, resolveScopeAction } from '../lib/rule/scope.js';

test('scope_rules：yml 透传字段规范化（未知 action 降 warn）', () => {
  const rule = {
    id: 'robustness/no-sync-fs',
    scope_rules: [
      { scope: 'startup', action: 'exempt' },
      { scope: 'request', action: 'block', reason: '请求路径禁止同步 I/O' },
      { scope: 'loop', action: 'block' },
      { scope: 'test', action: 'exempt' },
      { scope: 'unknown', action: 'bad-action' }, // 非法 → 降 warn
    ],
  };
  const rules = normalizeScopeRules(rule);
  assert.equal(rules.length, 5);
  assert.equal(rules[0].action, 'exempt');
  assert.equal(rules[4].action, 'warn', '未知 action 默认 warn（保守提示）');
});

test('scope_rules：resolveScopeAction 按 scopeInfo 维度取 action', () => {
  const scopeRules = normalizeScopeRules({
    scope_rules: [
      { scope: 'startup,test', action: 'exempt' },
      { scope: 'request', action: 'block' },
      { scope: '*', action: 'warn' },
    ],
  });
  assert.equal(resolveScopeAction(scopeRules, { path: 'startup' }), 'exempt');
  assert.equal(resolveScopeAction(scopeRules, { path: 'request' }), 'block');
  assert.equal(resolveScopeAction(scopeRules, { path: 'background', lexical: 'function' }), 'warn', '* 兜底');
  assert.equal(resolveScopeAction(scopeRules, {}), 'warn');
  assert.equal(resolveScopeAction([], { path: 'request' }), null, '无 scope_rules → null（规则默认行为）');
  assert.equal(resolveScopeAction(null, { path: 'request' }), null);
});

// 作用域分类器：lib/ast/scope.js（module/function/loop + 模块常量赋值）
import { classifyLineScope, isModuleConstAssignment } from '../lib/ast/scope.js';

test('scope：声明行号归类（module/function/loop）', () => {
  const src = 'const MAX = 3\nfunction f() {\n  const x = 1;\n  for (let i = 0; i < 5; i++) {\n    const y = 2;\n  }\n}\n';
  const moduleDecl = classifyLineScope(src, 1);
  assert.equal(moduleDecl.scope, 'module');
  assert.equal(moduleDecl.inLoop, false);
  const fnDecl = classifyLineScope(src, 3);
  assert.equal(fnDecl.scope, 'function');
  assert.equal(fnDecl.inLoop, false);
  const loopDecl = classifyLineScope(src, 5);
  assert.equal(loopDecl.scope, 'function');
  assert.equal(loopDecl.inLoop, true, '循环内声明应标 inLoop');
});

test('scope：模块顶层命名常量赋值判定（magic 豁免依据）', () => {
  assert.equal(isModuleConstAssignment('const MAX_RETRY = 3\n', 1), true);
  assert.equal(isModuleConstAssignment('const API_URL = 3000\n', 1), true);
  assert.equal(isModuleConstAssignment('function f() {\n  const x = 3;\n}\n', 2), false, '函数内不豁免');
  assert.equal(isModuleConstAssignment('const lower = 3\n', 1), false, '小写非命名常量风格不豁免');
});

// magic-number 接入：模块常量赋值豁免（端到端）
import { checkMagicNumberSmart } from '../lib/checks/magic-number.js';

test('magic-number：模块顶层命名常量不报，函数内/循环内仍按规则', () => {
  const rule = { id: 'readability/magic-number-smart' };
  // 用非 COMMON 值（45000/777）验证豁免路径真实生效
  const src = 'const TIMEOUT_MS = 45000\nexport const BACKOFF = 777\nfunction f() {\n  const x = 45000;\n  wait(45000);\n}\n';
  const f = checkMagicNumberSmart({ file: 'a.js', text: src, rules: [rule] });
  const lines = f.map((x) => x.line);
  assert.ok(!lines.includes(1), '模块顶层 TIMEOUT_MS 不报');
  assert.ok(!lines.includes(2), '模块顶层 BACKOFF 不报');
  assert.ok(lines.includes(4) || lines.includes(5), '函数内魔数仍报（line 4/5）');
});
