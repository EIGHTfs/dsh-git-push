/**
 * `npm pack --json` 输出解析（2026-11-05，外部会话实测反馈）。
 *
 * 背景：`npm pack` 会先跑包里的 `prepack` 脚本，脚本的 stdout 排在 JSON 之前。
 *   历史实现用 `text.search(/[[{]/)` 找「第一个 [ 或 {」，遇到 prepack 首行
 *   `[build] lib/client.js …` 就切错位置 ⇒ JSON.parse 抛错 ⇒ 被当成「清单为空」，
 *   好包被判死（真实 56 个文件）。**与 files 字段、stderr 都无关。**
 *
 * 判据：遍历每个 `[`/`{` 位置逐个试解析，第一个解析成功且不是标量的即为结果。
 *   本测试锁「任意前置污染都能解出来」，并用真实 npm pack 做端到端对照。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { packDryRun, parsePackOutput } from '../lib/npm/publish.js';

const CLEAN = JSON.stringify([{ id: 'demo@1.0.0', filename: 'demo-1.0.0.tgz', size: 1234, files: [{ path: 'package.json' }, { path: 'index.js' }] }]);

test('parsePackOutput：干净 JSON 直接解析', () => {
  const r = parsePackOutput(CLEAN);
  assert.equal(r.ok, true);
  assert.equal(Array.isArray(r.value), true);
  assert.equal(r.value[0].files.length, 2);
});

test('parsePackOutput：前置 prepack 输出（[build] 开头）仍能解出', () => {
  // 复刻实测形态：首行以 `[build]` 开头，JSON 在后面
  const polluted = `[build] lib/client.js ← 33 片段，共 4499 行\n${CLEAN}`;
  const r = parsePackOutput(polluted);
  assert.equal(r.ok, true, '必须跳过 [build] 找到真正的 JSON');
  assert.equal(r.value[0].filename, 'demo-1.0.0.tgz');
});

test('parsePackOutput：前置含成对花括号的日志也不误判', () => {
  const polluted = `[build] {ok: false} done\nnpm notice something\n${CLEAN}`;
  const r = parsePackOutput(polluted);
  assert.equal(r.ok, true);
  assert.equal(r.value[0].size, 1234);
});

test('parsePackOutput：没有 JSON 时明确失败（不是静默当空）', () => {
  assert.equal(parsePackOutput('[build] only logs, no json here').ok, false);
  assert.equal(parsePackOutput('').ok, false);
});

test('parsePackOutput：标量 JSON 不算有效结果（避免把日志里的 1/true 当清单）', () => {
  assert.equal(parsePackOutput('1 2 3').ok, false);
  assert.equal(parsePackOutput('true [build]').ok, false);
});

test('端到端：prepack 会 print 的真包，packDryRun 能拿到文件清单', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-pack-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'dshgp-pack-demo',
      version: '1.0.0',
      description: 'pack parse demo',
      license: 'MIT',
      // prepack 的第一行就像真实仓那样以 `[` 开头，专门触发历史 bug
      scripts: { prepack: 'node prepack.cjs' },
      files: ['index.js', 'prepack.cjs'],
    }, null, 2), 'utf8');
    writeFileSync(join(dir, 'prepack.cjs'), "console.log('[build] emit lib/client.js');\n", 'utf8');
    writeFileSync(join(dir, 'index.js'), 'export const a = 1;\n', 'utf8');

    const r = packDryRun({ dir });
    assert.equal(r.ok, true, `packDryRun 失败：${r.error || ''}｜stdout=${String(r.packStdoutTail || '').slice(0, 200)}`);
    assert.ok(r.files.length >= 2, `应拿到至少 2 个文件，实际 ${r.files.length}：${JSON.stringify(r.files)}`);
    assert.ok(r.files.includes('package.json'), 'package.json 必须在清单里');
    assert.ok(r.filename.includes('dshgp-pack-demo'), `filename 异常：${r.filename}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
