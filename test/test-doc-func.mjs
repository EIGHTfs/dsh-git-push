// dsh-git-push 测试：scripts/doc-func.mjs（函数列表生成器，2026-09-29）
/**
 * 覆盖：scanFileFuncs / collectFuncFiles / buildFuncListText / applyFuncBlock /
 * checkFuncDrift（gen/apply/check 闭环 + 宿主探测）。
 * 断言基于真实签名（行为快照：先探实际输出再断言，不臆测）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  scanFileFuncs, collectFuncFiles, buildFuncListText, applyFuncBlock, checkFuncDrift,
} from '../scripts/doc-func.mjs';

const mkTmp = () => mkdtempSync(join(tmpdir(), 'dshgp-docfunc-'));

test('doc-func：scanFileFuncs 提取函数（function/var/arrow）', () => {
  const dir = mkTmp();
  try {
    const f = join(dir, 'a.js');
    writeFileSync(f, 'export function foo() {}\nconst bar = () => {};\nconst baz = function() {};\n');
    const r = scanFileFuncs(f);
    assert.equal(r.funcs.length, 3);
    const names = r.funcs.map((x) => x.name);
    assert.ok(names.includes('foo') && names.includes('bar') && names.includes('baz'));
    assert.ok(r.funcs.every((x) => x.defLine >= 1 && x.lines >= 1));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('doc-func：buildFuncListText 生成表格（含文件标题/行号/签名）', () => {
  const dir = mkTmp();
  try {
    mkdirSync(join(dir, 'lib'), {});
    writeFileSync(join(dir, 'lib/a.js'), 'export function foo() {}\nconst bar = () => 1;\n');
    const r = buildFuncListText(dir, ['lib']);
    assert.match(r.text, /lib\/a\.js/, '应含相对路径标题');
    assert.match(r.text, /\| `foo` \|/, '应含函数行');
    assert.ok(r.text.includes('| 函数 | 行号 | 行数 | 签名 |'), '应含表头');
    assert.ok(r.funcs >= 2, '函数计数');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('doc-func：applyFuncBlock 替换已有块 / 无块追加', () => {
  const dir = mkTmp();
  try {
    const withBlock = '# x\n<!-- dshgp-functions:start -->\nold\n<!-- dshgp-functions:end -->\n';
    const after = applyFuncBlock(withBlock, '## 函数列表\nnew');
    assert.ok(after.includes('new') && !after.includes('old'), '块内容应替换');
    const noBlock = '# x\n';
    const added = applyFuncBlock(noBlock, '## 函数列表\nfresh');
    assert.ok(added.includes('dshgp-functions:start') && added.includes('fresh'), '无块应追加标记块');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('doc-func：checkFuncDrift 无块报 no-block，块不一致报 drift，一致通过', () => {
  const dir = mkTmp();
  try {
    mkdirSync(join(dir, 'lib'), {});
    writeFileSync(join(dir, 'lib/a.js'), 'export function foo() {}\n');
    // 无块
    const host1 = join(dir, 'README.md');
    writeFileSync(host1, '# x\n');
    let r = checkFuncDrift({ hostPath: host1, root: dir, includeDirs: ['lib'] });
    assert.equal(r.ok, false);
    assert.match(JSON.stringify(r.issues), /no-block/);
    // apply 后一致
    const { text } = buildFuncListText(dir, ['lib']);
    writeFileSync(host1, applyFuncBlock(readFileSync(host1, 'utf8'), text), 'utf8');
    r = checkFuncDrift({ hostPath: host1, root: dir, includeDirs: ['lib'] });
    assert.equal(r.ok, true, 'apply 后应无漂移');
    // 加函数 → 漂移
    writeFileSync(join(dir, 'lib/a.js'), 'export function foo() {}\nexport function bar() {}\n');
    r = checkFuncDrift({ hostPath: host1, root: dir, includeDirs: ['lib'] });
    assert.equal(r.ok, false, '新增函数应报漂移');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('doc-func：collectFuncFiles 只收 .js/.mjs 且跳过 node_modules/docs', () => {
  const dir = mkTmp();
  try {
    mkdirSync(join(dir, 'lib/sub'), { recursive: true });
    mkdirSync(join(dir, 'docs'), {});
    mkdirSync(join(dir, 'node_modules'), {});
    writeFileSync(join(dir, 'lib/a.js'), 'const a = 1;\n');
    writeFileSync(join(dir, 'lib/sub/b.mjs'), 'export const b = 2;\n');
    writeFileSync(join(dir, 'docs/x.js'), 'const x = 1;\n');
    writeFileSync(join(dir, 'node_modules/y.js'), 'const y = 1;\n');
    const files = collectFuncFiles(dir, ['lib']);
    assert.equal(files.length, 2, '只收 lib 下 js/mjs');
    assert.ok(files.every((f) => f.includes('lib/')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
