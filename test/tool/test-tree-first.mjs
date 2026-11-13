/**
 * test-tree-first.mjs —— 同族测试合并（test-tree-first-credential.mjs · test-tree-first-funcname.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（top-level test() 不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明（如两个文件都有 ROOT），
 *     不影响 test() 的注册时机与执行顺序；每个 test 名带 `[原文件名]` 前缀便于溯源。
 * 为什么不用 describe：它的回调是 async 函数作用域，会把顶层 await/const/exitCode 挪位（上轮实测 54 失败 / 少 17 条用例）。
 */
import { checkShortFunctionNameAst } from '../../lib/ast/naming.js';
import { auditFull } from '../../lib/audit/index.js';
import '../../lib/rule/compilers.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-tree-first-credential.mjs（块级作用域：只为隔离同名声明，不改求值时机/顺序）──
{
  /**
   * 「有树走树」双向样本回归（防再哑门禁，方向 E3）。
   *
   * 背景：审计引擎长期「有语法树却不建树、不消费」——树解析触发条件只认 astConfirmSpan，
   *   凭据类精筛（credential-value）永远走 token 级，导致两类失灵同时存在：
   *     · 误报：复合右值（"前缀:" + uuid）、函数参数默认值、三元表达式、主题令牌样式值
   *       都被「凭据标识符右侧字符串字面量」判成真硬编码凭据（外部 Python 仓库实测 10 条全误报）。
   *     · 漏报：Python bytes 字面量（SECRET = b"..."）在初筛正则（= 与引号间隔 b 前缀断链）
   *       与 token 精筛（b 被切成 ident，右侧非 str）两处都到不了报告路径，真凭据不报。
   *   修复（方向 E1）：凭据精筛以语法树为主路径（lib/ast/credential.js
   *   credentialLinesFromTree），无树/语法错误回退 token 级（D5 口径不变）。
   *
   * 防再哑职责（一旦树消费链路再次静默退化，本测试当场变红）：
   *   ① 有树路径：报必报（含 bytes 补漏报），不报必不报。
   *   ② 树使用状态进结果（treeUsage）：语法可用文件数与建树数同量级——杜绝「悄悄全回退」。
   *   ③ 无树对照（语法资产缺失）：回退 token 级仍工作，且回退态会**重新出现**主题令牌误报
   *      形态——证明 ① 的干净结果确实来自树路径，而不是规则本身变哑。
   */


  const HERE = dirname(fileURLToPath(import.meta.url));

  // 行号即语义（第 4 行是函数体）。注释刻意不写 `xxx = "yyy"` 形态——
  //   那会命中 [FUNC] 兜底规则的初筛，测试只针对 no-hardcoded-credentials 主规则语义。
  //   报 = 1（ghp_ 直存字面量）、6（bytes 直存字面量，原漏报样本）
  //   不报 = 2（拼接复合右值）、3（参数默认值）、5（主题令牌样式值）、7（三元分支）、
  //         8（字符串+变量拼接，**树独有**排除形态：回退态会报）
  const PY_SRC = [
    'token = "ghp_1234567890ABCDEFGHIJ"',
    'token = "plugin-preset:" + uuid.uuid4().hex',
    'def _icon(name, token="text.secondary"):',
    '    return 1',
    'fill_token = "accent.subtle"',
    'SECRET_KEY = b"Sup3rRealBytesKey01"',
    'token = "text.primary" if enabled else "text.disabled"',
    'password = "Abcdefgh12345!" + suffix',
  ].join('\n');

  const CRED_RULE = 'security/no-hardcoded-credentials';

  async function makeFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'dshgp-treecred-'));
    writeFileSync(join(dir, 'a.py'), PY_SRC);
    return dir;
  }

  function hardLines(res) {
    return res.findings
      .filter((f) => f.rule === CRED_RULE)
      .map((f) => f.line)
      .sort((a, b) => a - b);
  }

  test('[tree-first-credential] ① 有树主路径：报必报（含 bytes）、不报必不报（复合/默认值/三元/主题令牌）', async () => {
    const dir = await makeFixture();
    try {
      const res = await auditFull(dir);
      const lines = hardLines(res);
      assert.deepEqual(lines, [1, 6],
        `期望只报真硬编码 [1,6]（bytes 补漏报），复合右值/默认参数/主题令牌/三元不报；实得 [${lines}]`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[tree-first-credential] ② treeUsage 进审计结果：语法可用且建树数一致（杜绝静默全回退）', async () => {
    const dir = await makeFixture();
    try {
      const res = await auditFull(dir);
      assert.ok(res.treeUsage, '审计结果应携带 treeUsage 统计');
      assert.ok(res.treeUsage.parsed >= 1,
        `有语法就应真建树（parsed≥1），实得 parsed=${res.treeUsage.parsed} fallback=${res.treeUsage.tokenFallback}`);
      // 防再哑核心断言：语法资产完好时，凡「需要树且有语法」的文件都必须建出树（coverage=1）。
      //   ABI 不兼容 / 资产缺失 / 触发条件被改窄，都会让 parseFailed>0 当场变红。
      assert.equal(res.treeUsage.parseFailed, 0,
        `不应有「有语法却没建树」的文件（parseFailed），实得 ${res.treeUsage.parseFailed}`);
      assert.equal(res.treeUsage.coverage, 1,
        `hasGrammar 文件的建树覆盖率应为 1，实得 ${res.treeUsage.coverage}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[tree-first-credential] ③ 无树对照：语法资产缺失 ⇒ 回退 token 级，主题令牌误报形态重现（证明主路径确吃树）', () => {
    const libEntry = join(HERE, '..', '..', 'lib', 'audit', 'index.js');
    const script = [
      `import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';`,
      `import { join } from 'node:path'; import { tmpdir } from 'node:os';`,
      `import { auditFull } from ${JSON.stringify(libEntry)};`,
      `const dir = mkdtempSync(join(tmpdir(), 'dshgp-treecred-fb-'));`,
      `writeFileSync(join(dir, 'a.py'), ${JSON.stringify(PY_SRC)});`,
      `const res = await auditFull(dir);`,
      `const lines = res.findings.filter(f => f.rule === ${JSON.stringify(CRED_RULE)}).map(f => f.line);`,
      `rmSync(dir, { recursive: true, force: true });`,
      `console.log(JSON.stringify({ lines, treeUsage: res.treeUsage }));`,
    ].join('\n');
    const out = // 显式给子进程堆上限：批量子进程带着 --max-old-space-size=1024 跑，子进程会继承它，
    //   全量并发（40 文件）时这条 auditFull 子进程容易被掐死（实测全量里报 Command failed、单跑全过）。
    execFileSync(process.execPath, ['--max-old-space-size=2048', '--input-type=module', '-e', script], {
      env: { ...process.env, DSH_GIT_PUSH_TS_ASSETS: '/nonexistent-tree-assets-' + process.pid },
      encoding: 'utf8',
      timeout: 180000,
    });
    const parsed = JSON.parse(out.trim().split('\n').pop());
    assert.equal(parsed.treeUsage.parsed, 0, '语法资产缺失时不应建树（全回退）');
    // L8 `password = "Abcdefgh12345!" + suffix` 是**树独有**的排除形态：
    //   token 级只看「凭据名右侧第一个 str」即判硬编码（回退态必报）；
    //   语法树上右值是 binary_operator（拼接）而非纯字面量，不报。
    //   因此「回退态报 L8、树态不报 L8」直接证明 ① 的干净结果来自树路径，而非规则变哑。
    //   （L2/L3/L5/L7 由值形状/边界豁免双端共同排除，不承担此证明职责。）
    assert.ok(parsed.lines.includes(8),
      `回退态应重现拼接复合右值误报（L8），树态已排除——若这里不报而 ① 也不报，说明精筛整体变哑；实得 [${parsed.lines}]`);
    assert.ok(parsed.lines.includes(1), '回退态真凭据(L1)仍必须报——回退路径没坏');
  });
}

// ── 原 test-tree-first-funcname.mjs（块级作用域：只为隔离同名声明，不改求值时机/顺序）──
{
  /**
   * short-func-name 树化双向样本回归（方向 E 迁移第二条，2026-11-06）。
   *
   * 现状实测（token 级 checkShortFunctionNameAst）：只认「function 关键字后紧跟 ident」——
   *   · 真短名函数 function ab(...) → 报（既有能力）
   *   · 注释/字符串里的示例 → 不报（既有能力，防回归项）
   *   · 类方法 class A { gh() {} } / 对象方法 { ef() {} } → 完全不报 = 漏报（本测试的靶子）
   * 语法树上三者同族（function_declaration / method_definition 的 name 字段）。
   * token 级要靠「标识符 + ( 」近似会把 ab(x) 调用、{ ef: ... } 属性全卷进来，故走树：
   *   有树走树、无树回退 token 级（D5），与凭据那条同构。
   *
   * 防再哑：③ 用语法资产缺失的子进程跑出回退态 FN（方法短名又不报了），
   *   证明 ② 的干净结果确实来自树路径，而不是规则整体变哑。
   */


  const HERE = dirname(fileURLToPath(import.meta.url));

  // 行号即语义（注释刻意不含 function 短名( 形态，避免初筛把注释行卷进候选）：
  //   报 = 1 真短名函数 ab、12 类方法 gh、17 对象方法 ef
  //   不报 = 4 公认缩写 tr、7 正常命名 getUser、15 调用 ab(1)（不是定义）、19 属性 label
  const JS_SRC = [
    'function ab(a, b) {',
    '  return a + b;',
    '}',
    'function tr(s) {',
    '  return s;',
    '}',
    'function getUser(id) {',
    '  return id;',
    '}',
    'class Panel {',
    '  gh() {',
    '    return 1;',
    '  }',
    '}',
    'const api = ab(1);',
    'const box = {',
    '  ef() {',
    '    return 2;',
    '  },',
    '  label: "x",',
    '};',
  ].join('\n');

  const RULE = 'readability/function-name-too-short';

  async function makeFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'dshgp-fname-'));
    writeFileSync(join(dir, 'a.js'), JS_SRC);
    return dir;
  }

  const hitLines = (res) => res.findings
    .filter((f) => f.rule === RULE)
    .map((f) => f.line)
    .sort((a, b) => a - b);

  test('[tree-first-funcname] token 级现状（红基线记录）：只报 L1，类方法 L11 / 对象方法 L17 是当前已存在的 FN', () => {
    const hits = checkShortFunctionNameAst(JS_SRC).map((h) => h.line);
    assert.deepEqual(hits.sort((a, b) => a - b), [1],
      'token 级只认 function 关键字（L1）；方法短名当前不报——这就是树化要修的漏报');
  });

  test('[tree-first-funcname] 树化主路径：函数定义与类/对象方法短名都报，缩写白名单/正常命名/调用点不报', async () => {
    const dir = await makeFixture();
    try {
      const res = await auditFull(dir);
      const lines = hitLines(res);
      assert.deepEqual(lines, [1, 11, 17],
        '期望报 [1(ab),11(gh 类方法),17(ef 对象方法)]，不报 tr/getUser/调用点/label；实得 [' + lines + ']');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('[tree-first-funcname] 无树对照：语法资产缺失 → 回退 token 级，方法短名漏报重现（证明主路径确吃树）', () => {
    const libEntry = join(HERE, '..', '..', 'lib', 'audit', 'index.js');
    const script = [
      "import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';",
      "import { join } from 'node:path'; import { tmpdir } from 'node:os';",
      "import { auditFull } from " + JSON.stringify(libEntry) + ";",
      "const dir = mkdtempSync(join(tmpdir(), 'dshgp-fname-fb-'));",
      "writeFileSync(join(dir, 'a.js'), " + JSON.stringify(JS_SRC) + ");",
      "const res = await auditFull(dir);",
      "const lines = res.findings.filter(f => f.rule === " + JSON.stringify(RULE) + ").map(f => f.line);",
      "rmSync(dir, { recursive: true, force: true });",
      "console.log(JSON.stringify({ lines, treeUsage: res.treeUsage }));",
    ].join('\n');
    const out = // 同 test-tree-first-credential：子进程显式给堆上限，不要继承批量跑的 1GB 上限
    execFileSync(process.execPath, ['--max-old-space-size=2048', '--input-type=module', '-e', script], {
      env: { ...process.env, DSH_GIT_PUSH_TS_ASSETS: '/nonexistent-fname-assets-' + process.pid },
      encoding: 'utf8',
      timeout: 180000,
    });
    const parsed = JSON.parse(out.trim().split('\n').pop());
    assert.equal(parsed.treeUsage.parsed, 0, '语法资产缺失时不应建树');
    assert.ok(parsed.lines.includes(1), '回退态真短名函数(L1)仍必须报——回退路径没坏');
    assert.ok(!parsed.lines.includes(11) && !parsed.lines.includes(17),
      '回退态应重现方法短名漏报（L11/L17 不报），证明主路径的干净结果来自树；实得 [' + parsed.lines + ']');
  });

  // ── 访问器边界（显式排除，不靠初筛侥幸）──
  //   get ab()/set cd(v) 的 name 是属性名而非「函数名」，且 get/set 配对是极常见惯例；
  //   放宽初筛 pattern 后若不做显式排除，这里会变成误报源。普通/async/生成器方法仍须照报。
  test('[tree-first-funcname] ④ 访问器不报，普通/async/生成器方法仍报（边界钉死）', async () => {
    const { parseText, shortFunctionNamesFromTree } = await import('../../lib/ast/treesitter.js');
    const isShort = (n) => String(n).length <= 2 && !['tr', 't'].includes(n);
    const cases = [
      ['class A { get ab() { return 1 } }', []],
      ['class B { set cd(v) { this.x = v } }', []],
      ['class C { ef() {} }', ['ef']],
      ['class D { async gh() {} }', ['gh']],
      ['class E { *ij() {} }', ['ij']],
    ];
    for (const [src, want] of cases) {
      const t = await parseText(src, 'javascript');
      assert.ok(t, '样本应能建树');
      const got = (shortFunctionNamesFromTree(t, isShort) || []).map((h) => h.name);
      assert.deepEqual(got, want, src);
    }
  });
}
