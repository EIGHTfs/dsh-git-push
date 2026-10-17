/** exempt 工具回归：add/remove/list/check（离线，临时目录）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { addExempt, removeExempt, listExempt, checkExempt } from '../lib/exempt/tool.js';

function makeRepo() {
  return mkdtempSync(join(tmpdir(), 'dshgp-exempt-'));
}

test('add：header 模式按 rule 自动选标记并写入文件头', async () => {
  const dir = makeRepo();
  try {
    const f = join(dir, 'a.js');
    writeFileSync(f, 'const a = 1;\n');
    const r = await addExempt({ repoPath: dir, path: 'a.js', rule: 'maintainability/max-complexity', reason: '天然多分支' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(readFileSync(f, 'utf8'), /^\/\/ dsh-skip-complexity: 天然多分支/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('add：显式 marker 与 rule 冲突 ⇒ 拒绝并给正确标记', async () => {
  const dir = makeRepo();
  try {
    const f = join(dir, 'a.js');
    writeFileSync(f, 'x\n');
    const r = await addExempt({ repoPath: dir, path: 'a.js', marker: 'dsh-skip-size', rule: 'maintainability/max-complexity' });
    assert.equal(r.ok, false);
    assert.match(r.error, /dsh-skip-complexity/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('add：line 越界拒绝（且不写入）', async () => {
  const dir = makeRepo();
  try {
    const f = join(dir, 'a.js');
    writeFileSync(f, 'a\nb\n');
    const r = await addExempt({ repoPath: dir, path: 'a.js', rule: 'maintainability/max-complexity', scope: 'line', line: 99 });
    assert.equal(r.ok, false);
    assert.equal(readFileSync(f, 'utf8'), 'a\nb\n', '校验失败时不应写盘');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('remove：幂等（没有标记也返回 unchanged）', () => {
  const dir = makeRepo();
  try {
    const f = join(dir, 'a.js');
    writeFileSync(f, 'x\n');
    const r1 = removeExempt({ repoPath: dir, path: 'a.js' });
    assert.equal(r1.ok, true);
    assert.equal(r1.results[0].unchanged, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('list：盘点文件里的 dsh-skip 标记', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'a.js'), '// dsh-skip-complexity: x\nconst a = 1;\n');
    writeFileSync(join(dir, 'b.js'), 'const b = 1; // dsh-skip-quality\n');
    const r = listExempt({ repoPath: dir });
    assert.equal(r.ok, true);
    assert.equal(r.total, 2);
    assert.ok(r.items.some((i) => i.marker === 'dsh-skip-complexity'));
    assert.ok(r.items.some((i) => i.marker === 'dsh-skip-quality'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check：未知标记被判为 issue', () => {
  const dir = makeRepo();
  try {
    writeFileSync(join(dir, 'a.js'), '// dsh-skip-nonsense: x\nconst a = 1;\n');
    const r = checkExempt({ repoPath: dir });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.issue === 'unknown-marker'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
