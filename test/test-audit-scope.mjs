/**
 * 审计「作用域」与「凭据占位符」回归测试（2026-09-13）。
 *
 * 覆盖三类已修复的真实误报缺陷：
 *   ① 规则作用域字段（exts / astConfirmKind）声明后被静默忽略
 *   ② 前缀型密钥串（ghp_/sk-/AKIA）把文档与演示数据里的占位符报成真泄漏
 *   ③ HTML 规则包跑在非 HTML 文件上（.mjs 里生成网页的模板字符串被当真实网页）
 *
 * 这些缺陷的共同特征：只在实际跑审计时才暴露，且报出的都是 error/blocker 级，
 *   会把提交门禁卡死——故用确定性断言锁住，不依赖仓库当前状态。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkPlaceholderCredentialAst, isMeaningfulCredentialValue } from '../lib/ast/index.js';
import { loadRuleFiles } from '../lib/rule/loader.js';
import { compileAllRules } from '../lib/rule/registry.js';
import { filterRulesByExt } from '../lib/audit/checks.js';
import '../lib/rule/compilers.js'; // 副作用：注册编译器

/* ───────────── ① 凭据占位符判据 ───────────── */

test('凭据占位符：空值/掩码/占位文案/演示数据不算真凭据', () => {
  const placeholders = [
    '', '   ', 'xxxxx', '****', '<your-token>',
    'your-token-here', 'CHANGE_ME', 'TODO', 'placeholder',
    'example', 'exampleToken123', 'demo-value', 'sampleKey', 'testtoken',
    'dummy', 'fakeToken', 'none', 'null', 'undefined',
  ];
  for (const v of placeholders) {
    assert.equal(isMeaningfulCredentialValue(v), false, `应判为占位符：${JSON.stringify(v)}`);
  }
});

test('凭据占位符：带 scheme 前缀的演示值也判为占位符（剥前缀后判定）', () => {
  // 这是原缺陷：值以 ghp_ 开头而非 example 开头，匹配不到 `example.*` 就被报成真泄漏
  for (const v of ['ghp_exampleToken12345', 'ghp_ExampleToken12345', 'ghp_testtokenplaceholder123']) {
    assert.equal(isMeaningfulCredentialValue(v), false, `应判为占位符：${v}`);
  }
});

test('凭据占位符：真凭据形状仍判为真（剥前缀不放过真密钥）', () => {
  const reals = [
    'ghp_9fA2kLm3QpR7sT1uV5wX8yZ0aB4cD6eF8gH2',
    'sk-proj-a1B2c3D4e5F6g7H8i9J0k1L2',
    'AKIA3XQZ7PLMN2KJ8VWY',
    // 正对照：scheme 段里带占位词但整体是真检出形状 —— 不做分段判定，必须照报。
    //   （仓库测试夹具就用这个形状证明「非豁免目录的 blocker 会拦截提交」）
    'sk-test-abcdef1234567890abcdef',
  ];
  for (const v of reals) {
    assert.equal(isMeaningfulCredentialValue(v), true, `应判为真凭据：${v}`);
  }
});

test('占位符精筛：只豁免占位符所在行，真凭据行照报', () => {
  const text = [
    "const doc = '测试用占位符 ghp_testtokenplaceholder123 而已';", // 第 1 行：占位符
    "const real = 'ghp_9fA2kLm3QpR7sT1uV5wX8yZ0aB4cD6eF8gH2';",   // 第 2 行：真形状
    'const none = 1;',                                          // 第 3 行：无命中
  ].join('\n');
  const exempt = checkPlaceholderCredentialAst(text);
  assert.ok(exempt.has(1), '占位符行应进豁免集');
  assert.ok(!exempt.has(2), '真凭据行不应被豁免');
  assert.ok(!exempt.has(3), '无命中行不应进豁免集');
});

/* ───────────── ② 规则作用域字段透传 ───────────── */

test('作用域：compileAllRules 统一透传 exts（含原本漏传的 blacklist/semantic 等 kind）', () => {
  const compiled = compileAllRules(loadRuleFiles().merged.rules, { errors: [] });
  const withExts = compiled.filter((r) => Array.isArray(r.exts) && r.exts.length);
  assert.ok(withExts.length > 0, '应有规则声明并携带 exts');
  // 归一化：小写、无前导点
  for (const r of withExts) {
    for (const e of r.exts) {
      assert.equal(e, String(e).toLowerCase().replace(/^\./, ''), `exts 应归一化：${e}`);
    }
  }
  // blacklist kind 曾漏传：comment 包的该规则声明了 exts 就必须带上
  const bl = compiled.find((r) => r.id === 'documentation/comment-suspicious-detection');
  assert.ok(bl, '应加载到 comment 包的 blacklist 规则');
  assert.ok(Array.isArray(bl.exts) && bl.exts.length > 0, 'blacklist kind 也应携带 exts');
  assert.ok(!bl.exts.includes('json'), '该规则不应作用于 json（配置文件非注释载体）');
});

test('作用域：compileAllRules 统一透传 astConfirmKind（含原本漏传的 [FUNC] kind）', () => {
  const compiled = compileAllRules(loadRuleFiles().merged.rules, { errors: [] });
  const pat = compiled.find((r) => r.id === 'secret-github-pat');
  assert.ok(pat, '应加载到 secret-github-pat 规则');
  assert.equal(pat.kind, '[FUNC]', '该规则编译为 [FUNC] kind（原缺陷点）');
  assert.equal(pat.astConfirmKind, 'placeholder-credential', '[FUNC] kind 也应携带 astConfirmKind');
});

test('作用域：filterRulesByExt 按文件扩展名裁剪（HTML 规则不落到 .mjs）', () => {
  const grouped = {
    regex: [
      { id: 'html-only', exts: ['html', 'htm'] },
      { id: 'js-only', exts: ['js', 'mjs'] },
      { id: 'unscoped' },
    ],
  };
  const forMjs = filterRulesByExt(grouped, 'assets/preview-gen.mjs').regex.map((r) => r.id);
  assert.ok(!forMjs.includes('html-only'), '.mjs 不应命中 HTML 规则');
  assert.ok(forMjs.includes('js-only'), '.mjs 应命中 JS 规则');
  assert.ok(forMjs.includes('unscoped'), '未声明 exts 的规则不受限');
  const forHtml = filterRulesByExt(grouped, 'index.html').regex.map((r) => r.id);
  assert.ok(forHtml.includes('html-only'), '.html 应命中 HTML 规则');
  assert.ok(!forHtml.includes('js-only'), '.html 不应命中 JS 规则');
});
