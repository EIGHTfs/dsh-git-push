/**
 * 同名常量跨文件重复定义（DRY）测试（2026-10-02 新增，用户建议「加规则」——
 *   MAX_MSG_PREVIEW=80 三处重复定义实测驱动）。
 * ① findConstDefs 多语言提取（JS/Kotlin/Java/Go/Rust/Python）
 * ② 模块级 vs 函数内（函数内 const/val 是局部变量，不是命名常量）
 * ③ checkDuplicateConst 跨文件聚合（同名校同值 ≥2 文件 → 报）
 * ④ 排除：test/fixtures、基础值（0/1/-1/2/3）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('findConstDefs：多语言常量提取', async () => {
  const { findConstDefs } = await import('../lib/checks/dup-const.js');
  const cases = [
    ['js', 'const MAX_MSG_PREVIEW = 80;\nconst X = 1;', ['MAX_MSG_PREVIEW=80']],
    ['kotlin', 'const val MAX_RETRY = 80\nval OK = 2', ['MAX_RETRY=80']],
    ['java', 'public class T { private static final int MAX_MSG_PREVIEW = 80; }', ['MAX_MSG_PREVIEW=80']],
    ['go', 'package p\nconst MAX_MSG_PREVIEW = 80', ['MAX_MSG_PREVIEW=80']],
    ['rust', 'const MAX_MSG_PREVIEW: i32 = 80;', ['MAX_MSG_PREVIEW=80']],
    ['python', 'MAX_MSG_PREVIEW = 80\n', ['MAX_MSG_PREVIEW=80']],
  ];
  for (const [lang, code, expect] of cases) {
    const got = findConstDefs(code).map((d) => `${d.name}=${d.value}`);
    assert.deepEqual(got, expect, `${lang} 提取应得 ${expect.join(',')}，实际 ${got.join(',')}`);
  }
});

test('findConstDefs：只认模块级常量（函数内局部变量不提取）', async () => {
  const { findConstDefs } = await import('../lib/checks/dup-const.js');
  const src = [
    'const MODULE_CONST = 42;',
    'function f() {',
    '  const local = 100;', // 函数内局部变量——不是命名常量
    '  let tmp = 200;',
    '  return local;',
    '}',
  ].join('\n');
  const got = findConstDefs(src).map((d) => `${d.name}=${d.value}`);
  assert.deepEqual(got, ['MODULE_CONST=42'], `只应提取模块级 MODULE_CONST（实际：${got.join(',') || '空'}）`);
});

test('findConstDefs：跳过基础值（0/1/-1/2/3）；字符串常量同样提取（跨文件重复也是 DRY 信号）', async () => {
  const { findConstDefs } = await import('../lib/checks/dup-const.js');
  const got = findConstDefs('const ZERO = 0;\nconst ONE = 1;\nconst REPO_REQUIRED_MSG = "repo 必填";\nconst LIMIT = 50;\n');
  const map = Object.fromEntries(got.map((d) => [d.name, d.value]));
  assert.ok(!('ZERO' in map) && !('ONE' in map), '基础值 0/1 应跳过');
  assert.equal(map.REPO_REQUIRED_MSG, 'repo 必填', '字符串常量应提取（错误文案/URL 跨文件重复同属 DRY 信号）');
  assert.equal(map.LIMIT, '50', '应提取 LIMIT=50（非基础值）');
});

test('checkDuplicateConst：同名校同值跨 ≥2 文件 → 报「应统一单一来源」', async () => {
  const { checkDuplicateConst } = await import('../lib/checks/dup-const.js');
  const fileTexts = [
    { path: 'lib/a.js', text: 'const MAX_MSG_PREVIEW = 80;\n' },
    { path: 'lib/b.js', text: 'const MAX_MSG_PREVIEW = 80;\n' },
    { path: 'lib/c.js', text: 'const OTHER = 30;\n' },
  ];
  const rules = [{ id: 'maintainability/duplicate-constant-def', dimensions: ['可维护性'] }];
  const hits = checkDuplicateConst(fileTexts, rules);
  assert.equal(hits.length, 1, `应报 MAX_MSG_PREVIEW 一组：${hits.map((h) => h.message).join('')}`);
  assert.ok(hits[0].message.includes('MAX_MSG_PREVIEW = 80'), 'message 应指出常量名与值');
  assert.ok(hits[0].message.includes('lib/b.js'), 'message 应列出其他重复文件');
});

test('checkDuplicateConst：排除 test/fixtures 目录', async () => {
  const { checkDuplicateConst } = await import('../lib/checks/dup-const.js');
  const fileTexts = [
    { path: 'lib/a.js', text: 'const TEST_TIMEOUT = 5000;\n' },
    { path: 'test/a.test.js', text: 'const TEST_TIMEOUT = 5000;\n' },
  ];
  const rules = [{ id: 'maintainability/duplicate-constant-def', dimensions: ['可维护性'] }];
  const hits = checkDuplicateConst(fileTexts, rules);
  assert.equal(hits.length, 0, 'test 目录常量重复属于测试夹具，不应报');
});

test('checkDuplicateConst：同值不同名不报（非 DRY 信号）', async () => {
  const { checkDuplicateConst } = await import('../lib/checks/dup-const.js');
  const fileTexts = [
    { path: 'lib/a.js', text: 'const MAX_A = 80;\n' },
    { path: 'lib/b.js', text: 'const MAX_B = 80;\n' },
  ];
  const rules = [{ id: 'maintainability/duplicate-constant-def', dimensions: ['可维护性'] }];
  assert.equal(checkDuplicateConst(fileTexts, rules).length, 0, '同名才报；不同名同值不是变量重复');
});