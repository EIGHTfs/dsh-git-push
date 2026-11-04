// 冒烟「选哪些公开面去 import」的单测（lib/npm/smoke.js 的 selectImportSpecs）
//
// 【为什么要钉死】冒烟是发布前的最后一道门禁：选错目标会把**完全正常的包**判成坏包
// （实测事故：exports 里登记了 `./cordis.patch.yml`，冒烟对它 import 得到
//  ERR_UNKNOWN_FILE_EXTENSION，发布被拦），选漏了又会让门禁形同虚设
// （实测事故：`"."` 出口被跳过 ⇒ 主入口从来没被测过）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectImportSpecs } from '../lib/npm/smoke.js';

test('exports 含资源文件与浏览器入口时，只挑主入口与 JS 子入口', () => {
  // 与 dsh-session-conductor 的真实 package.json 同形
  const pkg = {
    name: 'demo-plugin',
    main: 'lib/index.js',
    exports: {
      '.': { default: './lib/index.js' },
      './client': './lib/client.js',
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
  };
  const { nodeEntries, browserEntries } = selectImportSpecs(pkg);
  assert.deepEqual(nodeEntries, ['demo-plugin'], '主入口必须被测；.yml 资源不能进 import 列表');
  assert.deepEqual(browserEntries, ['demo-plugin/client'], '客户端入口归到 browserEntries，只列不加载');
});

test('没有 exports 但有 main：按包名 import 主入口', () => {
  const { nodeEntries, browserEntries } = selectImportSpecs({ name: 'demo', main: 'index.js' });
  assert.deepEqual(nodeEntries, ['demo']);
  assert.deepEqual(browserEntries, []);
});

test('纯 CLI 包（只有 bin）：没有库入口，不产生 import 目标', () => {
  const { nodeEntries } = selectImportSpecs({ name: 'demo-cli', bin: { demo: 'bin/demo.js' } });
  assert.deepEqual(nodeEntries, [], '没有 main/exports 时不该去 import 包名');
});

test('exports 全是非 JS 资源：一个都不 import', () => {
  const pkg = {
    name: 'assets-only',
    exports: {
      './style.css': './dist/style.css',
      './data.json': './dist/data.json',
      './tpl.yml': './dist/tpl.yml',
    },
  };
  const { nodeEntries } = selectImportSpecs(pkg);
  assert.deepEqual(nodeEntries, []);
});

test('带扩展名的 JS 子入口照常被测；条件导出取 import/default', () => {
  const pkg = {
    name: 'demo2',
    exports: {
      '.': { import: './esm/index.mjs', require: './cjs/index.cjs' },
      './tools.mjs': './lib/tools.mjs',
      './deep': { node: { default: './lib/deep.js' } },
      './readme.md': './README.md',
    },
  };
  const { nodeEntries } = selectImportSpecs(pkg);
  assert.deepEqual(nodeEntries, ['demo2', 'demo2/tools.mjs', 'demo2/deep']);
});

test('缺 name 时返回空清单，不抛错', () => {
  assert.deepEqual(selectImportSpecs({ main: 'index.js' }), { nodeEntries: [], browserEntries: [] });
  assert.deepEqual(selectImportSpecs(undefined), { nodeEntries: [], browserEntries: [] });
});
