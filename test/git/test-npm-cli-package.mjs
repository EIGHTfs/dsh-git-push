/**
 * 发布前彩排要按「包的真实形态」验证（2026-11-02，外部会话实测反馈）。
 *
 * 背景：纯 CLI 服务包只有 `bin`，没有 `main`/`exports`。历史实现一律 `import('<包名>')`
 *   探测公开面，对这类包必然失败（Cannot find package .../index.js），于是**好包被判死**，
 *   报错还写「安装后加载失败」，让人以为包坏了。
 *
 * 现在的判据：
 *   · 有库入口（main/exports）→ import 公开面
 *   · 只有 bin → **真跑** `<node> <安装位>/<bin> --version`（断言输出含版本）与 `--help`（断言退出码 0）
 *   · 两者都没有 → 明确报「没有任何可验证入口」，不说「加载失败」
 *
 * 为什么 bin 必须真跑：曾出现「bin 判据用字面路径比较、而 npm 装的是符号链接」导致
 *   `npx <命令>` 静默 exit 0 且零输出 —— 这种故障 import 永远测不到。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { classifyPackageForm, entrySpecsOf } from '../../lib/npm/smoke.js';
import { runLocalPreview } from '../../lib/npm/local-registry.js';

test('classifyPackageForm：库包 / 纯 CLI / 两者都有 / 都没有', () => {
  assert.equal(classifyPackageForm({ name: 'a', exports: { '.': './i.js' } }).kind, 'library');
  const cli = classifyPackageForm({ name: 'zipcalm', bin: { zipcalm: 'bin/zipcalm.js' } });
  assert.equal(cli.kind, 'cli');
  assert.deepEqual(cli.bins, [{ command: 'zipcalm', path: 'bin/zipcalm.js' }]);
  assert.equal(classifyPackageForm({ name: 'c', main: './i.js', bin: 'cli.js' }).kind, 'both');
  assert.equal(classifyPackageForm({ name: 'd' }).kind, 'none');
});

test('entrySpecsOf：纯 CLI 包没有库入口（返回空，而不是包名）', () => {
  assert.deepEqual(entrySpecsOf({ name: 'zipcalm', bin: { zipcalm: 'bin/zipcalm.js' } }), []);
  assert.deepEqual(entrySpecsOf({ name: 'lib', main: './index.js' }), ['lib']);
});

/** 造一个临时包（不联网：无依赖）。 */
function makePackage({ name, version = '1.0.0', main, bin, binBody }) {
  const dir = mkdtempSync(join(tmpdir(), `dshgp-pkg-${name}-`));
  const pkg = { name, version, type: 'commonjs' };
  if (main) pkg.main = main;
  if (bin) pkg.bin = bin;
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  if (main) writeFileSync(join(dir, main), 'module.exports = { ok: true };\n');
  if (bin) {
    const rel = typeof bin === 'string' ? bin : Object.values(bin)[0];
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), binBody || [
      '#!/usr/bin/env node',
      `if (process.argv.includes('--version')) { console.log('${version}'); process.exit(0); }`,
      "if (process.argv.includes('--help')) { console.log('usage: demo'); process.exit(0); }",
      'process.exit(0);',
    ].join('\n'), 'utf8');
  }
  return dir;
}

test('纯 CLI 包：彩排真跑 bin 并通过（不再 import）', async () => {
  const dir = makePackage({ name: 'dshgp-cli-demo', version: '1.2.3', bin: { 'dshgp-cli-demo': 'bin/cli.js' } });
  try {
    const r = await runLocalPreview({ dir, tag: 'beta', packageName: 'dshgp-cli-demo', entrySpecs: [], bins: [{ command: 'dshgp-cli-demo', path: 'bin/cli.js' }], expectedVersion: '1.2.3' });
    assert.equal(r.ok, true, `彩排应通过：${JSON.stringify(r.failures)}`);
    const steps = r.steps.map((x) => x.step);
    assert.ok(steps.includes('bin-version'), '必须跑过 bin --version');
    assert.ok(steps.includes('bin-help'), '必须跑过 bin --help');
    assert.ok(!steps.includes('import'), '纯 CLI 包不应走 import 检查');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bin 版本不符：彩排应拦住', async () => {
  const dir = makePackage({ name: 'dshgp-cli-badver', version: '9.9.9', bin: { 'dshgp-cli-badver': 'bin/cli.js' } });
  try {
    const r = await runLocalPreview({ dir, tag: 'beta', packageName: 'dshgp-cli-badver', entrySpecs: [], bins: [{ command: 'dshgp-cli-badver', path: 'bin/cli.js' }], expectedVersion: '1.0.0' });
    assert.equal(r.ok, false);
    assert.match(r.failures.join('\n'), /--version/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('既无库入口也无 bin：报「没有可验证入口」，不说「加载失败」', async () => {
  const dir = makePackage({ name: 'dshgp-empty-demo', version: '1.0.0' });
  try {
    const r = await runLocalPreview({ dir, tag: 'beta', packageName: 'dshgp-empty-demo', entrySpecs: [], bins: [] });
    assert.equal(r.ok, false);
    const text = r.failures.join('\n');
    assert.match(text, /可验证入口/);
    assert.doesNotMatch(text, /加载失败/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
