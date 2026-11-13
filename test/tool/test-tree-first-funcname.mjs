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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import '../../lib/rule/compilers.js';
import { auditFull } from '../../lib/audit/index.js';
import { checkShortFunctionNameAst } from '../../lib/ast/naming.js';

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

test('token 级现状（红基线记录）：只报 L1，类方法 L11 / 对象方法 L17 是当前已存在的 FN', () => {
  const hits = checkShortFunctionNameAst(JS_SRC).map((h) => h.line);
  assert.deepEqual(hits.sort((a, b) => a - b), [1],
    'token 级只认 function 关键字（L1）；方法短名当前不报——这就是树化要修的漏报');
});

test('树化主路径：函数定义与类/对象方法短名都报，缩写白名单/正常命名/调用点不报', async () => {
  const dir = await makeFixture();
  try {
    const res = await auditFull(dir);
    const lines = hitLines(res);
    assert.deepEqual(lines, [1, 11, 17],
      '期望报 [1(ab),11(gh 类方法),17(ef 对象方法)]，不报 tr/getUser/调用点/label；实得 [' + lines + ']');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('无树对照：语法资产缺失 → 回退 token 级，方法短名漏报重现（证明主路径确吃树）', () => {
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
test('④ 访问器不报，普通/async/生成器方法仍报（边界钉死）', async () => {
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
