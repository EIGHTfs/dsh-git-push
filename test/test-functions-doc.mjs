/**
 * functions 函数索引/文档测试（2026-09-23）：
 *   applyFunctionsDocs（生成 docs/函数/*.md / 删除归档 / comment 生效 / 无注释待补 / skipEmpty）
 *   + func-index --out 输出含 signature/comment 槽位。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { applyFunctionsDocs } from '../scripts/functions-doc.mjs';

function makeIndexRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-fn-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

test('func-index --out：输出含 signature/comment 槽位（ESM export 函数识别）', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-fi-'));
  try {
    writeFileSync(join(root, 'a.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
    const out = join(root, 'index.json');
    const script = fileURLToPath(new URL('../scripts/func-index.js', import.meta.url));
    execFileSync(process.execPath, [script, root, '--out', out], { encoding: 'utf8' });
    const idx = JSON.parse(readFileSync(out, 'utf8'));
    const f = idx.files[0].funcs[0];
    assert.equal(f.name, 'add', '应识别 export function');
    assert.equal(f.kind, 'function');
    assert.equal(typeof f.signature, 'string', '输出应含 signature（定义行原文）');
    assert.equal(f.comment, '', '输出应含 comment 槽位（人工补注释载体）');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('applyFunctionsDocs：生成文档 + comment 生效 + 无注释待补', () => {
  const root = makeIndexRoot({
    'functions-index.json': JSON.stringify({
      generatedAt: 'x',
      files: [{
        file: 'lib/a.js',
        funcs: [
          { name: 'add', kind: 'function', defLine: 1, signature: 'export function add(a,b)', comment: '两数相加' },
          { name: 'helper', kind: 'arrow', defLine: 5, signature: 'const helper = () => {', comment: '' },
        ],
      }],
    }),
    'lib/a.js': 'export function add(a,b){return a+b;}\nconst helper = () => {};\n',
  });
  try {
    const r = applyFunctionsDocs(root);
    assert.equal(r.ok, true);
    assert.equal(r.written.length, 1);
    const md = readFileSync(join(root, 'docs/函数/lib/a.js.md'), 'utf8');
    assert.ok(md.includes('两数相加'), 'comment 应写入文档');
    assert.ok(md.includes('（无注释，待补）'), '无注释函数应标待补');
    assert.ok(md.includes('add') && md.includes('helper'), '函数表应含两个函数');
    // skipEmpty：跳过无注释函数
    const r2 = applyFunctionsDocs(root, { skipEmpty: true });
    const md2 = readFileSync(join(root, 'docs/函数/lib/a.js.md'), 'utf8');
    assert.ok(!md2.includes('helper'), 'skipEmpty 应跳过无注释函数');
    void r2;
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('applyFunctionsDocs：源文件删除 → 归档 _archived（人工注释保留）', () => {
  const root = makeIndexRoot({
    'functions-index.json': JSON.stringify({
      generatedAt: 'x',
      files: [{ file: 'lib/gone.js', funcs: [{ name: 'old', kind: 'function', defLine: 1, signature: 'function old(){}', comment: '删除文件保留的注释' }] }],
    }),
    // 注意：不创建 lib/gone.js（源文件已删）
  });
  try {
    const r = applyFunctionsDocs(root);
    assert.equal(r.written.length, 0);
    assert.deepEqual(r.archived, ['lib/gone.js']);
    const arc = join(root, 'docs/函数/_archived/lib/gone.js.md');
    assert.ok(existsSync(arc), '应生成归档文档');
    assert.ok(readFileSync(arc, 'utf8').includes('删除文件保留的注释'), '归档应保留人工注释');
  } finally { rmSync(root, { recursive: true, force: true }); }
});