/**
 * 「读改合一」编辑核心（lib/fs/edit-after-read.js）回归测试。
 *
 * 钉子（都是「宁可拒绝，不可误改」的安全属性）：
 *   ① 唯一匹配才改（多处默认拒绝，all:true 才全改）
 *   ② old 未命中 → 拒绝（字面精确匹配，不做正则/模糊）
 *   ③ **读后文件被改动 → 拒绝**（版本比对：mtime/size 变化即拒）
 *   ④ 读失败 / 写失败 / 缺参 → 都返回 ok:false 且带 reason（不抛异常）
 *   ⑤ 成功时返回 replaced / 字节数，便于调用方核对
 *   ⑥ **缺 new 一律拒绝**（缺参报错 ≠ 清空；删除必须显式传 new: ''）
 *   ⑦ **参数名与宿主编辑工具一致**：file_path / old_string / new_string / replace_all 与本工具原名两套都认
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { countOccurrences, editAfterRead } from '../lib/fs/edit-after-read.js';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';

/** 造一个带文件的临时目录。 */
function fixture(content = 'const a = 1;\n') {
  const root = mkdtempTracked('edit-');
  mkdirSync(join(root, 'src'), { recursive: true });
  const file = join(root, 'src', 'a.js');
  writeFileSync(file, content, 'utf8');
  return { root, file };
}

test('countOccurrences：不重叠计数', () => {
  assert.equal(countOccurrences('aaa', 'aa'), 1, '不重叠');
  assert.equal(countOccurrences('abab', 'ab'), 2);
  assert.equal(countOccurrences('abc', ''), 0, '空 needle 记 0');
  assert.equal(countOccurrences('abc', 'z'), 0);
});

test('唯一匹配 → 正常替换，返回字节数', () => {
  const { file } = fixture('const a = 1;\n');
  const r = editAfterRead({ path: file, old: 'const a = 1;', new: 'const answer = 1;' });
  assert.equal(r.ok, true);
  assert.equal(r.replaced, 1);
  assert.ok(r.bytesAfter > r.bytesBefore, '新文本更长');
  assert.equal(readFileSync(file, 'utf8'), 'const answer = 1;\n');
});

test('多处匹配 → 默认拒绝；all:true 才全改', () => {
  const { file } = fixture('x();\nx();\n');
  const deny = editAfterRead({ path: file, old: 'x();', new: 'y();' });
  assert.equal(deny.ok, false);
  assert.match(deny.reason, /出现 2 次/);
  assert.equal(readFileSync(file, 'utf8'), 'x();\nx();\n', '拒绝时不得写入');
  const okAll = editAfterRead({ path: file, old: 'x();', new: 'y();', all: true });
  assert.equal(okAll.ok, true);
  assert.equal(okAll.replaced, 2);
  assert.equal(readFileSync(file, 'utf8'), 'y();\ny();\n');
});

test('old 未命中 / 缺参 / 读失败 → 拒绝且不写', () => {
  const { file } = fixture('const a = 1;\n');
  assert.match(editAfterRead({ path: file, old: '不存在的串', new: 'x' }).reason, /未找到 old/);
  assert.match(editAfterRead({ path: file, old: '' }).reason, /缺少 old/);
  assert.match(editAfterRead({ old: 'a' }).reason, /缺少 path/);
  assert.match(editAfterRead({ path: join(file, 'nope'), old: 'a', new: 'x' }).reason, /读取失败/);
  assert.equal(readFileSync(file, 'utf8'), 'const a = 1;\n', '以上都不得改动文件');
});

test('缺 new 一律拒绝（不得把「参数名写错」变成「内容被删除」）', () => {
  const { file } = fixture('AAA\nBBB\n');
  // 真实事故：调用方用宿主参数名 new_string，本工具读不到 new 而默认空串 ⇒ 内容被删。
  const r = editAfterRead({ path: file, old: 'BBB' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /缺少 new/);
  assert.equal(readFileSync(file, 'utf8'), 'AAA\nBBB\n', '拒绝时不得改动文件');
  // 删除必须显式传空串（只删 'BBB' 这 4 个字符，换行保留 ⇒ 余下 'AAA\n\n'）
  assert.equal(editAfterRead({ path: file, old: 'BBB', new: '' }).ok, true);
  assert.equal(readFileSync(file, 'utf8'), 'AAA\n\n');
});

test('参数名与宿主编辑工具一致（file_path / old_string / new_string / replace_all）', () => {
  const { file } = fixture('AAA\nBBB\nBBB\n');
  const r1 = editAfterRead({ file_path: file, old_string: 'AAA', new_string: 'CCC' });
  assert.equal(r1.ok, true);
  assert.equal(readFileSync(file, 'utf8'), 'CCC\nBBB\nBBB\n');
  const r2 = editAfterRead({ file_path: file, old_string: 'BBB', new_string: 'DDD', replace_all: true });
  assert.equal(r2.ok, true);
  assert.equal(readFileSync(file, 'utf8'), 'CCC\nDDD\nDDD\n');
  // 唯一性校验对别名同样生效
  assert.match(editAfterRead({ file_path: file, old_string: 'DDD', new_string: 'E' }).reason, /出现 2 次/);
});

test('读后文件被改动（版本变化）→ 拒绝写入', () => {
  const { file } = fixture('const a = 1;\n');
  // 注入：第一次 stat 给旧指纹，第二次给新指纹（模拟读后被人改了）
  let call = 0;
  const statFile = () => {
    call += 1;
    return call === 1 ? { mtimeMs: 1000, size: 14 } : { mtimeMs: 2000, size: 20 };
  };
  const r = editAfterRead({ path: file, old: 'const a = 1;', new: 'const b = 2;', statFile });
  assert.equal(r.ok, false);
  assert.match(r.reason, /已被改动/);
  assert.equal(readFileSync(file, 'utf8'), 'const a = 1;\n', '拒绝时不得写入');
});

test('写失败 → 返回 ok:false 带 reason（不抛异常）', () => {
  const { file } = fixture('const a = 1;\n');
  const r = editAfterRead({
    path: file,
    old: 'const a = 1;',
    new: 'const b = 2;',
    writeFile: () => { throw new Error('EACCES 演示'); },
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /写入失败/);
  assert.match(r.reason, /EACCES/);
});
