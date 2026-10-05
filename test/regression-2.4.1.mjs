// 2.4.1 回归测试：锁定本版修掉的缺陷（学习第 2 条：版本化回归，一个版本一个文件）。
//
// 本版（2.4.1，纯优化）修掉的问题清单：
//   ① 多行模板字符串跨行 tokenize 缺失 ⇒ 帮助文本正文被当代码，占位符 `[--depth N]` 的 N
//      产出 ident，被 readability/variable-min-length 误报 3 条
//   ② duplicate-constant 三类误报：脚本自解析根（HERE/ROOT/__dirname/args/env）、
//      首 token 判不了内容的常量（对象/数组字面量、new Set(...)）、独立脚本与 lib 的同名常量
//   ③ exemptHint 与实际豁免行为不一致：正则类 finding 一律提示 residue（安全类应 sensitive）；
//      blacklist/comment-density/file-health/min-occurrences 的 kind 不在任何标记的 blocked 里；
//      residue/style 的 rule 前缀细分分支缺 kind === 'regex' 前置
//   ④ clone 链路三修：git_clone 工具漏传 token（走匿名 API）、工作树内防护排在联网之后、
//      「占用中」互斥用按 dest 判定（换目录即绕过）
//   ⑤ 公共常量单一来源：FUNC_LINES_DEFAULT / DEFAULT_SCAN_DEPTH / HEALTH_* / FN_BODY_LOOKAHEAD
//      此前在检查层与编译层各写一份
//
// 说明：逐条修复各自也有专项测试（test-tokenizer-multiline-template / test-dup-const-idiom /
//   test-exempt-hint-classify / test-clone-token / test-audit-defaults）；本文件是**版本级汇总入口**——
//   即使专项测试将来被重构或改名，这一版的行为基线仍在此处可查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokenize, clearTokenCache } from '../lib/ast/tokenizer.js';
import { checkDuplicateConst } from '../lib/checks/dup-const.js';
import { pickExemptHint } from '../lib/checks/regex.js';
import { exemptForFinding } from '../lib/exempt/index.js';
import { FUNC_LINES_DEFAULT, DEFAULT_SCAN_DEPTH, HEALTH_BASE_SCORE } from '../lib/audit-defaults.js';
import { FN_BODY_LOOKAHEAD } from '../lib/ast/consts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('2.4.1① 多行模板正文不再产出 ident（帮助文本占位符不被当变量名）', () => {
  clearTokenCache();
  const src = ['const H = `用法:', '  scan <root> [--depth N]', '`;', 'const N = 1;'].join('\n');
  const all = tokenize(src);
  const nIdents = all.filter((t) => t.value === 'N' && t.type === 'ident');
  assert.equal(nIdents.length, 1, '只有第 4 行真变量是 ident');
  assert.equal(nIdents[0].line, 4);
  assert.deepEqual(all.filter((t) => t.type === 'tmpl').map((t) => t.line), [1, 2, 3], '模板跨行产出 tmpl');
});

test('2.4.1② duplicate-constant：脚本惯用法与判不了内容的常量不报，lib 内真重复仍报', () => {
  const scripts = [
    { path: 'scripts/a.mjs', text: "const HERE = dirname(resolve('x'));\nconst args = process.argv;\nconst MAX = 20;\n" },
    { path: 'scripts/b.mjs', text: "const HERE = dirname(resolve('x'));\nconst args = process.argv;\nconst MAX = 20;\n" },
  ];
  assert.equal(checkDuplicateConst(scripts, {}).length, 0, '脚本间同名常量不报（脚本要能独立运行）');
  const newSets = [
    { path: 'lib/ast/a.js', text: "const WRITE_METHODS = new Set(['push']);\n" },
    { path: 'lib/http/b.js', text: "const WRITE_METHODS = new Set(['POST']);\n" },
  ];
  assert.equal(checkDuplicateConst(newSets, {}).length, 0, 'new Set 首 token 判不了内容，不报');
  const real = [
    { path: 'lib/ast/a.js', text: 'const FN_BODY_LOOKAHEAD = 20;\n' },
    { path: 'lib/ast/b.js', text: 'const FN_BODY_LOOKAHEAD = 20;\n' },
  ];
  assert.equal(checkDuplicateConst(real, {}).length, 1, 'lib 内同名同值仍报（不误杀）');
});

test('2.4.1③ 豁免提示与实际行为一致（安全类→sensitive；blacklist 写 quality 真能豁免）', () => {
  assert.match(pickExemptHint({ id: 'security/no-credential-in-url', kind: 'regex' }), /dsh-skip-sensitive/);
  assert.match(pickExemptHint({ id: 'readability/max-lines', kind: 'regex' }), /dsh-skip-style/);
  assert.match(pickExemptHint({ id: 'nodejs/no-console-log', kind: 'regex' }), /dsh-skip-residue/);
  const quality = '<!-- dsh-skip-quality -->\n正文\n';
  for (const kind of ['blacklist', 'comment-density', 'file-health', 'magic-number-smart']) {
    assert.equal(exemptForFinding({ kind, rule: 'x/y', line: 2 }, quality), true, `${kind} 写 quality 应豁免`);
  }
  assert.equal(exemptForFinding({ kind: 'min-occurrences', rule: 'docs/x', line: 1 }, '<!-- dsh-skip-style -->\n正文\n'), true,
    'min-occurrences（非 regex kind）写 style 应豁免（细分分支已加 kind===regex 前置）');
  assert.equal(exemptForFinding({ kind: 'regex', rule: 'readability/max-lines', line: 3 }, '<!-- dsh-skip-residue -->\n正文\n'), false,
    '风格规则不该被 residue 豁免（细分仍生效）');
});

test('2.4.1④ clone 链路：工具执行体带 token、防护在联网之前、互斥用全局 snapshot', () => {
  const toolCall = readFileSync(join(ROOT, 'lib/app/tool-call.js'), 'utf8');
  const fn = toolCall.slice(toolCall.indexOf('async function callCloneJob'), toolCall.indexOf('async function callCommitPush'));
  assert.match(fn, /token:\s*resolveToken\(/, 'clone 工具必须传 token（否则走匿名 API）');
  assert.match(fn, /maxFileMB:\s*resolveMaxCloneFileMB\(/, '体积上限统一解析');
  assert.match(toolCall, /callCloneJob\(\{[^}]*\},\s*jobs,\s*exec,\s*log,\s*env,\s*cfg\)/, '调用点必须传 env/cfg');

  const clone = readFileSync(join(ROOT, 'lib/git/clone.js'), 'utf8');
  const guardAt = clone.indexOf('const hostRoot = enclosingGitRoot(targetDir)');
  const netAt = clone.indexOf("const meta = await api('')");
  assert.ok(guardAt > 0 && netAt > 0 && guardAt < netAt, '工作树内防护必须排在首次网络调用之前');

  const handler = readFileSync(join(ROOT, 'lib/app/handlers/clone.js'), 'utf8');
  assert.match(handler, /const runningJob = snapshot\(\)/, '互斥判定用全局 snapshot（按 dest 判会被换目录绕过）');
});

test('2.4.1⑤ 公共常量单一来源（值一致且不再各写一份）', () => {
  assert.equal(FUNC_LINES_DEFAULT, 50);
  assert.equal(DEFAULT_SCAN_DEPTH, 20);
  assert.equal(HEALTH_BASE_SCORE, 10);
  assert.equal(FN_BODY_LOOKAHEAD, 20);
  for (const [file, pattern] of [
    ['lib/checks/structural.js', /^const FUNC_LINES_DEFAULT = 50/m],
    ['lib/rule/compilers/func.js', /^const FUNC_LINES_DEFAULT = 50/m],
    ['lib/git/repos.js', /^const DEFAULT_SCAN_DEPTH = 20/m],
    ['lib/ast/brace.js', /^const FN_BODY_LOOKAHEAD = 20/m],
  ]) {
    assert.ok(!pattern.test(readFileSync(join(ROOT, file), 'utf8')), `${file} 不应再本地定义该常量`);
  }
});
