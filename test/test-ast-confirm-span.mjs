// 列级精筛回归（方案 A）：命中**落在字符串/注释区间内** ⇒ 不报；**真实代码** ⇒ 必须仍报。
//
// 背景（实测遗留误报）：行级判定只能回答「这一行有没有代码 token」，回答不了
//   「正则命中的那一处是不是在字符串里」。于是
//     const hang = await provider.execute(session, { script: 'while (true) {}', timeoutMs: 700 });
//   这一行（含 ident，行级判为代码）让 performance/busy-wait-loop 把字符串字面量里的
//   while(true) 当成真实死循环报出 ✗。
// 本测试是**双向**的：负例（字符串/注释）必须不报 ✓，正例（真实死循环）必须仍报 ✓
//   —— 只测负例会把「整体失效」当成修好（假绿）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeCodeSpanFilter } from '../lib/ast/code-lines.js';
import { auditWithScope } from '../lib/audit/orchestrate.js';

test('makeCodeSpanFilter：字符串/注释内的命中不算代码，真实代码算（列级）', () => {
  const lines = [
    "const hang = await provider.execute(session, { script: 'while (true) {}', timeoutMs: 700 });",
    'while (true) { doWork(); }',
    '// while (true) {} 这里只是说明',
  ];
  const text = lines.join('\n');
  const f = makeCodeSpanFilter(text, [1, 2, 3], { file: 'a.mjs' });
  const col = (n, needle) => lines[n - 1].indexOf(needle) + 1;

  assert.equal(f.isCodeHit(1, col(1, 'while')), false, '字符串字面量内的 while(true) 不得算代码');
  assert.equal(f.isCodeHit(2, col(2, 'while')), true, '真实 while(true) 必须算代码');
  assert.equal(f.isCodeHit(3, col(3, 'while')), false, '注释里的 while(true) 不得算代码');
  // 拿不到列 ⇒ 退化为行级判定（第 2 行是代码行 ⇒ 放行，绝不因缺列而误杀）
  assert.equal(f.isCodeHit(2, Number.NaN), true);
  // 行级判定仍是同一份（向后兼容）
  assert.equal(f.isCode(2), true);
  assert.equal(f.isCode(3), false);
});

test('端到端：字符串里的 while(true) 不报，真实死循环仍报（双向）', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-span-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(join(tmp, 'src/str.mjs'), "export const s = { script: 'while (true) {}' };\n", 'utf8');
    // 正例必须用规则 pattern 认可的形态（**空循环体** `while (true) {}`），
    //   与字符串内那处**文本完全同形** —— 这样负例/正例的差别只剩「在不在字符串里」，
    //   测的才是列级判定本身（写成 `{ tick(); }` 非空体则规则本就不匹配 ⇒ 假红）。
    writeFileSync(join(tmp, 'src/real.mjs'), 'export function f() { while (true) {} }\n', 'utf8');
    // 必须**跟踪**这两个文件：审计的文件收集走 git（未跟踪文件收不到 ⇒ 断言会「0 命中」假红）
    execFileSync('git', ['add', '-A'], { cwd: tmp });

    const r = await auditWithScope(tmp, { scope: 'full', maxScanFiles: 1000, disabledSlots: [] });
    const hits = (r.findings || []).filter((x) => x.rule === 'performance/busy-wait-loop');
    const files = hits.map((h) => String(h.file).replace(/\\/g, '/'));
    assert.ok(!files.some((f) => f.endsWith('src/str.mjs')), '字符串字面量内的 while(true) 不得报出');
    assert.ok(files.some((f) => f.endsWith('src/real.mjs')), '真实 while(true) 必须仍报（防整体失效）');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
