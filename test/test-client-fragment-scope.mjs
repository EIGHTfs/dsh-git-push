// 客户端分片作用域推导测试（C8：源码分片 + 构建产物）。
//
// 守住的判据（都是**推导**而非写死文件名，换仓库/换目录要自动成立）：
//   ① 未显式声明时，按入口推导分片目录：任一份 exports["./client"] 入口 → `<入口目录>/<入口名>-parts/`
//   ② 显式声明 `dsh.client.fragments` 时以它为准（字符串或数组，目录形式统一补尾斜杠）
//   ③ 分片目录必须是**前缀形式**（供 dispatch 用 startsWith 匹配目录下任意分片）
//   ④ 无 package.json / 无客户端声明 ⇒ 空集（不抛异常）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveDshClientFragments, resolveDshClientEntries } from '../lib/audit/client-entry.js';

/** 造一个含指定 package.json 的临时仓库根。 */
function fakeRepo(pkg) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-frag-'));
  if (pkg !== null) writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  return dir;
}
const clean = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } };

test('未显式声明时按入口推导分片目录（lib/client.js → lib/client-parts/）', () => {
  const dir = fakeRepo({ name: 'p', exports: { './client': './lib/client.js' } });
  try {
    assert.deepEqual([...resolveDshClientEntries(dir)], ['lib/client.js']);
    assert.deepEqual([...resolveDshClientFragments(dir)], ['lib/client-parts/']);
  } finally { clean(dir); }
});

test('显式声明 dsh.client.fragments 优先（数组 / 字符串两种形态）', () => {
  const a = fakeRepo({ name: 'p', exports: { './client': './lib/client.js' }, dsh: { client: { fragments: ['web/parts', './ui/pieces/'] } } });
  const b = fakeRepo({ name: 'p', exports: { './client': './lib/client.js' }, dsh: { client: { fragments: 'web/parts' } } });
  try {
    assert.deepEqual([...resolveDshClientFragments(a)].sort(), ['ui/pieces/', 'web/parts/']);
    assert.deepEqual([...resolveDshClientFragments(b)], ['web/parts/']);
  } finally { clean(a); clean(b); }
});

test('分片目录是前缀形式（目录下任意分片都应命中）', () => {
  const dir = fakeRepo({ name: 'p', exports: { './client': './dist/bundle.js' } });
  try {
    const prefixes = [...resolveDshClientFragments(dir)];
    assert.deepEqual(prefixes, ['dist/bundle-parts/']);
    assert.ok(prefixes.some((p) => 'dist/bundle-parts/00-loader.js'.startsWith(p)), '分片文件应命中所推前缀');
    assert.ok(!prefixes.some((p) => 'dist/bundle.js'.startsWith(p)), '产物本身不应算分片');
  } finally { clean(dir); }
});

test('无 package.json / 无客户端声明 ⇒ 空集（不抛）', () => {
  const none = fakeRepo(null);
  const bare = fakeRepo({ name: 'p' });
  try {
    assert.deepEqual([...resolveDshClientFragments(none)], []);
    assert.deepEqual([...resolveDshClientFragments(bare)], []);
    assert.deepEqual([...resolveDshClientFragments('')], []);
  } finally { clean(none); clean(bare); }
});

test('本仓库实际生效：lib/client-parts/ 被推导为分片目录', () => {
  const ROOT = join(import.meta.dirname, '..');
  const prefixes = [...resolveDshClientFragments(ROOT)];
  assert.ok(prefixes.includes('lib/client-parts/'), `本仓库应推导出 lib/client-parts/，实际：${prefixes.join(' / ') || '(空)'}`);
  // 抽查：真实分片文件命中所推前缀，产物本身不命中
  assert.ok(prefixes.some((p) => 'lib/client-parts/00-loader.js'.startsWith(p)));
  assert.ok(!prefixes.some((p) => 'lib/client.js'.startsWith(p)));
  mkdirSync(join(ROOT, 'lib', 'client-parts'), { recursive: true }); // 确保目录存在（幂等，不写文件）
});
