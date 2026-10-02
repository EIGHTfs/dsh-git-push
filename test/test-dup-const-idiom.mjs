// 重复常量规则的「误报」回归：脚本自解析根 / 每脚本一份的命令行对象不算重复定义。
//
// 事故：自审插件自身时 duplicate-constant 报 22 条，大半是 HERE / ROOT / SCRIPT_DIR / args / env
//   这类「各脚本各写一份」的惯用法——脚本要能独立运行（随插件发布、安装副本目录里同样可跑），
//   合并成公共常量反而让脚本依赖 lib 而失去独立性。属规则误报，不是代码 DRY 问题。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkDuplicateConst } from '../lib/checks/dup-const.js';

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

test('脚本自解析根与命令行对象不算重复定义（只报真共享常量）', () => {
  const found = checkDuplicateConst(SCRIPTS, {});
  const names = found.map((f) => String(f.message || '').match(/常量「([^ ]+) /)?.[1]).filter(Boolean);
  assert.ok(!names.some((n) => ['HERE', 'ROOT', 'args', 'env'].includes(n)),
    `脚本惯用法不该报（实得：${names.join(', ')}）`);
  assert.ok(names.includes('MAX'), '同名同值的真常量仍要报（不误杀）');
});

test('lib 内真重复仍会报（不因豁免而漏掉领域常量）', () => {
  const libs = [
    { path: 'lib/ast/a.js', text: 'const FN_BODY_LOOKAHEAD = 20;\n' },
    { path: 'lib/ast/b.js', text: 'const FN_BODY_LOOKAHEAD = 20;\n' },
  ];
  const found = checkDuplicateConst(libs, {});
  assert.equal(found.length, 1, 'lib 内同名同值仍应报出来供提公共常量');
  assert.match(found[0].message, /FN_BODY_LOOKAHEAD/);
});
