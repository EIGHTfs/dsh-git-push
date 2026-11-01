/**
 * 发布前冒烟的门禁逻辑测试（不触网、不装包）。
 *
 * 背景：`npm publish --dry-run` 只回答「哪些文件会进包」，不回答「装上能不能用」。
 *   我们真实踩过的两类问题都藏在那一步之后：依赖漏声明/子路径依赖缺失、
 *   `exports` 收窄后内部路径 `import('pkg/lib/x.js')` 直接 ERR_PACKAGE_PATH_NOT_EXPORTED。
 *   故发布前要真装一次并**按公开面逐个 import**。
 *
 * 本测试锁「公开面推导」这条规则：
 *   · exports 对象的每个子路径都要验（`.` / `./audit`），但 `./package.json` 除外（只能读取）；
 *   · 浏览器端入口（如 `./client`）在 Node 里 import 必然失败，必须识别出来跳过而不是当失败；
 *   · 没有 exports 时退化为包名根入口。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entrySpecsOf, isBrowserEntry } from '../lib/npm/smoke.js';

test('entrySpecsOf：exports 对象 → 逐个子路径（跳过 ./package.json）', () => {
  const pkg = {
    name: 'demo',
    exports: { '.': './lib/index.js', './audit': './lib/audit/public.js', './package.json': './package.json' },
  };
  assert.deepEqual(entrySpecsOf(pkg), ['demo', 'demo/audit']);
});

test('entrySpecsOf：exports 是字符串 → 只有根入口', () => {
  assert.deepEqual(entrySpecsOf({ name: 'demo', exports: './index.js' }), ['demo']);
});

test('entrySpecsOf：无 exports → 根入口', () => {
  assert.deepEqual(entrySpecsOf({ name: 'demo', main: './index.js' }), ['demo']);
});

test('entrySpecsOf：没有 name → 空（冒烟会直接判失败）', () => {
  assert.deepEqual(entrySpecsOf({}), []);
});

test('isBrowserEntry：client/browser 类入口要跳过（Node 里必然 window is not defined）', () => {
  assert.equal(isBrowserEntry('./client'), true);
  assert.equal(isBrowserEntry('./client/index'), true);
  assert.equal(isBrowserEntry('./browser'), true);
  assert.equal(isBrowserEntry('./audit'), false);
  assert.equal(isBrowserEntry('./lib/client.js'), true);
  assert.equal(isBrowserEntry('.'), false);
});
