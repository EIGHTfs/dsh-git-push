/**
 * test-dup.mjs —— 同族测试合并（test-dup-code.mjs · test-dup-const.mjs · test-dup-const-idiom.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { collectDupCodeCandidates, findDuplicateBodies } from '../../lib/ast/dup-code.js';
import { checkDuplicateCode } from '../../lib/checks/dup-code.js';
import { checkDuplicateConst } from '../../lib/checks/dup-const.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// ── 原 test-dup-code.mjs ──
{
  // dsh-git-push 测试：重复代码检测（maintainability/no-duplicate-code，该抽公共函数）
  /**
   * 覆盖：lib/ast/dup-code.js 的 collectDupCodeCandidates / findDuplicateBodies +
   *   lib/checks/dup-code.js 的 checkDuplicateCode。
   * 判定标准（量化判定标准）：
   *   · 同一归一化结构 ≥3 处 + 函数体 ≥5 行 → 报（该抽公共函数）
   *   · 2 处 / 不足 5 行 / test 夹具 / 参数 >5 / 布尔 flag → 不报
   *   · severity 恒 warning（只提示不拦截）
   */


  // ---------- AST 层 ----------

  test('[dup-code] dup-code：同一结构 3 个函数体被识别为重复（归一化哈希）', () => {
    const src = `
  function parseUser(row) {
    const name = String(row.name || '').trim();
    const age = Number(row.age) || 0;
    if (name && age > 0) return { name, age };
    return null;
  }
  function parseOrder(row) {
    const name = String(row.name || '').trim();
    const age = Number(row.age) || 0;
    if (name && age > 0) return { name, age };
    return null;
  }
  function parseItem(row) {
    const name = String(row.name || '').trim();
    const age = Number(row.age) || 0;
    if (name && age > 0) return { name, age };
    return null;
  }
  `;
    const cands = collectDupCodeCandidates(src, 'demo.js');
    assert.equal(cands.length, 3, `应提取 3 个函数体（实际 ${cands.length}）`);
    const dups = findDuplicateBodies([cands]);
    assert.equal(dups.length, 1, `应发现 1 组重复（实际 ${dups.length}）`);
    assert.equal(dups[0].instances.length, 3, '重复实例数应为 3');
    assert.ok(dups[0].lines >= 5, `函数体行数应 ≥5（实际 ${dups[0].lines}）`);
  });

  test('[dup-code] dup-code：归一化——变量名不同但结构相同仍算重复', () => {
    const a = `
  function alpha(x) {
    const total = Number(x) || 0;
    const scaled = total * 2;
    if (scaled > 100) return scaled;
    return total;
  }
  `;
    const b = `
  function beta(y) {
    const count = Number(y) || 0;
    const scaled = count * 2;
    if (scaled > 100) return scaled;
    return count;
  }
  `;
    const ca = collectDupCodeCandidates(a, 'a.js');
    const cb = collectDupCodeCandidates(b, 'b.js');
    assert.equal(ca.length, 1, `a.js 应提取 1 个候选（实际 ${ca.length}）`);
    assert.equal(cb.length, 1, `b.js 应提取 1 个候选（实际 ${cb.length}）`);
    assert.equal(ca[0].hash, cb[0].hash, '变量名不同应归一化为同一 hash');
  });

  test('[dup-code] dup-code：字符串内容不同 → 结构不同 → 不算重复', () => {
    const a = `
  function alpha() {
    const msg = 'hello world';
    const upper = msg.toUpperCase();
    return upper.length;
  }
  `;
    const b = `
  function beta() {
    const msg = 'goodbye cruel world';
    const upper = msg.toUpperCase();
    return upper.length;
  }
  `;
    const ca = collectDupCodeCandidates(a, 'a.js');
    const cb = collectDupCodeCandidates(b, 'b.js');
    assert.equal(ca.length, 1, `a.js 应提取 1 个候选（实际 ${ca.length}）`);
    assert.equal(cb.length, 1, `b.js 应提取 1 个候选（实际 ${cb.length}）`);
    assert.notEqual(ca[0].hash, cb[0].hash, '字符串内容不同不应归为同一结构');
  });

  test('[dup-code] dup-code：不足 5 行的函数不报（不值得抽）', () => {
    const src = `
  function one(x) { return x + 1; }
  function two(x) { return x + 1; }
  function three(x) { return x + 1; }
  `;
    const cands = collectDupCodeCandidates(src, 'demo.js');
    assert.equal(cands.length, 0, '单行函数不应成为候选（<5 行）');
  });

  test('[dup-code] dup-code：2 处重复不报（观察档）', () => {
    const src = `
  function alpha(x) {
    const total = Number(x) || 0;
    return total > 0 ? total : 0;
  }
  function beta(y) {
    const count = Number(y) || 0;
    return count > 0 ? count : 0;
  }
  `;
    const cands = collectDupCodeCandidates(src, 'demo.js');
    const dups = findDuplicateBodies([cands]);
    assert.equal(dups.length, 0, '仅 2 处重复不应报（≥3 才抽）');
  });

  // ---------- checks 层 ----------

  test('[dup-code] dup-code：checkDuplicateCode 跨文件聚合 ≥3 处 → finding（severity warning）', () => {
    const mk = (fnName) => `
  function ${fnName}(row) {
    const name = String(row.name || '').trim();
    const age = Number(row.age) || 0;
    if (name && age > 0) return { name, age };
    return null;
  }
  `;
    const fileTexts = [
      { path: 'src/a.js', text: mk('parseA') },
      { path: 'src/b.js', text: mk('parseB') },
      { path: 'src/c.js', text: mk('parseC') },
    ];
    const findings = checkDuplicateCode(fileTexts, [{ id: 'maintainability/no-duplicate-code', severity: 'warning', dimensions: ['可维护性'] }]);
    assert.equal(findings.length, 1, `应有 1 条 finding（实际 ${findings.length}）`);
    assert.equal(findings[0].severity, 'warning', 'severity 恒 warning（最高只警告不拦截）');
    assert.ok(findings[0].message.includes('重复'), 'message 应说明重复（实际 ' + findings[0].message + '）');
  });

  test('[dup-code] dup-code：test 夹具目录不报', () => {
    const mk = (fnName) => `
  function ${fnName}(row) {
    const name = String(row.name || '').trim();
    const age = Number(row.age) || 0;
    if (name && age > 0) return { name, age };
    return null;
  }
  `;
    const fileTexts = [
      { path: 'test/a.test.js', text: mk('parseA') },
      { path: 'test/b.test.js', text: mk('parseB') },
      { path: 'test/c.test.js', text: mk('parseC') },
    ];
    const findings = checkDuplicateCode(fileTexts, [{ id: 'maintainability/no-duplicate-code', severity: 'warning' }]);
    assert.equal(findings.length, 0, 'test/ 夹具不应报重复');
  });

  test('[dup-code] dup-code：布尔 flag 参数 / 参数过多 → 不报（伪公共）', () => {
    const mk = (fnName, params) => `
  function ${fnName}(${params}) {
    const a = Number(x) || 0;
    const b = Number(y) || 0;
    if (a > 0 && b > 0) return a + b;
    return 0;
  }
  `;
    // 3 个带布尔 flag 的相同结构
    const fileTexts = [
      { path: 'src/a.js', text: mk('fA', 'x, y, force') },
      { path: 'src/b.js', text: mk('fB', 'x, y, force') },
      { path: 'src/c.js', text: mk('fC', 'x, y, force') },
    ];
    const findings = checkDuplicateCode(fileTexts, [{ id: 'maintainability/no-duplicate-code', severity: 'warning' }]);
    assert.equal(findings.length, 0, '布尔 flag 参数的伪公共函数不应报');
  });
}

// ── 原 test-dup-const.mjs ──
{
  /**
   * 同名常量跨文件重复定义（DRY）测试（2026-10-02 新增，用户建议「加规则」——
   *   MAX_MSG_PREVIEW=80 三处重复定义实测驱动）。
   * ① findConstDefs 多语言提取（JS/Kotlin/Java/Go/Rust/Python）
   * ② 模块级 vs 函数内（函数内 const/val 是局部变量，不是命名常量）
   * ③ checkDuplicateConst 跨文件聚合（同名校同值 ≥2 文件 → 报）
   * ④ 排除：test/fixtures、基础值（0/1/-1/2/3）
   */

  test('[dup-const] findConstDefs：多语言常量提取', async () => {
    const { findConstDefs } = await import('../../lib/checks/dup-const.js');
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

  test('[dup-const] findConstDefs：只认模块级常量（函数内局部变量不提取）', async () => {
    const { findConstDefs } = await import('../../lib/checks/dup-const.js');
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

  test('[dup-const] findConstDefs：跳过基础值（0/1/-1/2/3）；字符串常量同样提取（跨文件重复也是 DRY 信号）', async () => {
    const { findConstDefs } = await import('../../lib/checks/dup-const.js');
    const got = findConstDefs('const ZERO = 0;\nconst ONE = 1;\nconst REPO_REQUIRED_MSG = "repo 必填";\nconst LIMIT = 50;\n');
    const map = Object.fromEntries(got.map((d) => [d.name, d.value]));
    assert.ok(!('ZERO' in map) && !('ONE' in map), '基础值 0/1 应跳过');
    assert.equal(map.REPO_REQUIRED_MSG, 'repo 必填', '字符串常量应提取（错误文案/URL 跨文件重复同属 DRY 信号）');
    assert.equal(map.LIMIT, '50', '应提取 LIMIT=50（非基础值）');
  });

  test('[dup-const] checkDuplicateConst：同名校同值跨 ≥2 文件 → 报「应统一单一来源」', async () => {
    const { checkDuplicateConst } = await import('../../lib/checks/dup-const.js');
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

  test('[dup-const] checkDuplicateConst：排除 test/fixtures 目录', async () => {
    const { checkDuplicateConst } = await import('../../lib/checks/dup-const.js');
    const fileTexts = [
      { path: 'lib/a.js', text: 'const TEST_TIMEOUT = 5000;\n' },
      { path: 'test/a.test.js', text: 'const TEST_TIMEOUT = 5000;\n' },
    ];
    const rules = [{ id: 'maintainability/duplicate-constant-def', dimensions: ['可维护性'] }];
    const hits = checkDuplicateConst(fileTexts, rules);
    assert.equal(hits.length, 0, 'test 目录常量重复属于测试夹具，不应报');
  });

  test('[dup-const] checkDuplicateConst：同值不同名不报（非 DRY 信号）', async () => {
    const { checkDuplicateConst } = await import('../../lib/checks/dup-const.js');
    const fileTexts = [
      { path: 'lib/a.js', text: 'const MAX_A = 80;\n' },
      { path: 'lib/b.js', text: 'const MAX_B = 80;\n' },
    ];
    const rules = [{ id: 'maintainability/duplicate-constant-def', dimensions: ['可维护性'] }];
    assert.equal(checkDuplicateConst(fileTexts, rules).length, 0, '同名才报；不同名同值不是变量重复');
  });
}

// ── 原 test-dup-const-idiom.mjs ──
{
  // 重复常量规则的「误报」回归：脚本自解析根 / 每脚本一份的命令行对象不算重复定义。
  //
  // 事故：自审插件自身时 duplicate-constant 报 22 条，大半是 HERE / ROOT / SCRIPT_DIR / args / env
  //   这类「各脚本各写一份」的惯用法——脚本要能独立运行（随插件发布、安装副本目录里同样可跑），
  //   合并成公共常量反而让脚本依赖 lib 而失去独立性。属规则误报，不是代码 DRY 问题。


  // 构造两个「脚本」文件，各自解析自己的根（真实写法：dirname(fileURLToPath(import.meta.url))）
  const SCRIPTS = [
    {
      path: 'scripts/a.mjs',
      text: [
        "import { dirname, resolve } from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        'const HERE = dirname(resolve("x"));',
        'const ROOT = resolve("y");',
        'const args = process.argv.slice(2);',
        'const env = { ...process.env };',
        'const MAX = 20;',
      ].join('\n'),
    },
    {
      path: 'scripts/b.mjs',
      text: [
        "import { dirname, resolve } from 'node:path';",
        "import { fileURLToPath } from 'node:url';",
        'const HERE = dirname(resolve("x"));',
        'const ROOT = resolve("y");',
        'const args = process.argv.slice(2);',
        'const env = { ...process.env };',
        'const MAX = 20;',
      ].join('\n'),
    },
  ];

  test('[dup-const-idiom] 脚本自解析根与命令行对象不算重复定义（脚本间同名常量也不报）', () => {
    const found = checkDuplicateConst(SCRIPTS, {});
    const names = found.map((f) => String(f.message || '').match(/常量「([^ ]+) /)?.[1]).filter(Boolean);
    assert.ok(!names.some((n) => ['HERE', 'ROOT', 'args', 'env'].includes(n)),
      `脚本惯用法不该报（实得：${names.join(', ')}）`);
    // 两个 scripts/ 下的文件各写一份 MAX 也不报：脚本要能单独运行（随插件发布、安装副本里同样可跑），
    //   强行合并会让脚本依赖 lib 而失去独立性——真共享常量只在 lib 内部判定（见下一条测试）
    assert.ok(!names.includes('MAX'), `脚本间同名常量不该报（实得：${names.join(', ')}）`);
  });

  test('[dup-const-idiom] lib 内真重复仍会报（不因豁免而漏掉领域常量）', () => {
    const libs = [
      { path: 'lib/ast/a.js', text: 'const FN_BODY_LOOKAHEAD = 20;\n' },
      { path: 'lib/ast/b.js', text: 'const FN_BODY_LOOKAHEAD = 20;\n' },
    ];
    const found = checkDuplicateConst(libs, {});
    assert.equal(found.length, 1, 'lib 内同名同值仍应报出来供提公共常量');
  });

  test('[dup-const-idiom] 首 token 判不了内容的常量不报（对象/数组字面量、new 构造）', () => {
    // 实测背景：WRITE_METHODS 在 lib/ast（数组方法 push/add/set）与 lib/http（HTTP 方法 POST/PUT）
    //   是两个完全不同的域，仅名字撞车被报；SKIP_DIRS 在 lib/score 与 lib/skip-dirs 内容也不同；
    //   auditExt = { ... } 各扩展脚本行为完全不同。检查器只取首 token（`{`/`[`/`new`）判不了内容。
    const cases = [
      ['WRITE_METHODS', "const WRITE_METHODS = new Set(['push', 'add']);", "const WRITE_METHODS = new Set(['POST', 'PUT']);"],
      ['SKIP_DIRS', "const SKIP_DIRS = new Set(['a']);", "const SKIP_DIRS = new Set(['b']);"],
      ['auditExt', 'const auditExt = { name: "a" };', 'const auditExt = { name: "b" };'],
    ];
    for (const [name, a, b] of cases) {
      const found = checkDuplicateConst([
        { path: `lib/x/${name.toLowerCase()}-a.js`, text: `${a}\n` },
        { path: `lib/y/${name.toLowerCase()}-b.js`, text: `${b}\n` },
      ], {});
      assert.equal(found.length, 0, `${name} 首 token 判不了内容，不该报（实得 ${found.length} 条）`);
    }
  });
}
