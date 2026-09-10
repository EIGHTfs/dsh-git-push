/**
 * 自身总入口测试（0.1.4）：VERSION 一致性 / versionInfo / readmeTemplate /
 * yamlTemplate / helpSync（HELP↔parseArgv 机器比对）/ parseArgv 边界 / CLI 子命令。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSION, readmeTemplate, yamlTemplate, versionInfo, helpSync } from '../lib/self/index.js';
import { parseArgv, KNOWN_FLAGS, main, cmdVersion } from '../cli.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const cliText = readFileSync(join(ROOT, 'cli.mjs'), 'utf8');

test('VERSION：lib/self 与 package.json 一致（版本漂移拦截）', () => {
  assert.equal(VERSION, packageJson.version, `lib/self=${VERSION} vs package.json=${packageJson.version} 不一致`);
});

test('VERSION：像语义化版本号', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('versionInfo：一致通过', () => {
  const r = versionInfo(JSON.stringify({ version: VERSION }));
  assert.equal(r.ok, true);
  assert.equal(r.selfVersion, VERSION);
  assert.equal(r.pkgVersion, VERSION);
});

test('versionInfo：不一致拦截（self 与 pkg 分离）', () => {
  const r = versionInfo(JSON.stringify({ version: '9.9.9' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /lib\/self=.*vs package\.json=9\.9\.9/);
});

test('versionInfo：对象入参也支持', () => {
  const r = versionInfo({ version: VERSION });
  assert.equal(r.ok, true);
});

test('versionInfo：无 version 字段拦截', () => {
  const r = versionInfo('{}');
  assert.equal(r.ok, false);
  assert.match(r.error, /无 version/);
});

test('readmeTemplate：占位符渲染（name/version）', () => {
  const r = readmeTemplate({ name: 'dsh-git-push', version: VERSION });
  assert.equal(r.ok, true);
  assert.ok(r.template.includes('# dsh-git-push'));
  assert.ok(r.template.includes(`v${VERSION}`));
  assert.ok(r.template.includes('版本列表'));
});

test('readmeTemplate：versionTable 可注入', () => {
  const r = readmeTemplate({ versionTable: '| 版本 | 说明 |\n|---|---|\n| 0.0.0 | 测试 |' });
  assert.ok(r.template.includes('| 0.0.0 | 测试 |'));
});

test('yamlTemplate：含 kind + dimensions 示范', () => {
  const t = yamlTemplate();
  assert.ok(t.includes('kind: regex'));
  assert.ok(t.includes('dimensions:'));
  assert.ok(t.includes('severity:'));
});

test('helpSync：KNOWN_FLAGS 与 HELP 全含（缺一即报）', () => {
  // 从 cli.mjs 提取 HELP 常量文本
  const helpBlock = cliText.match(/const HELP = `([\s\S]*?)`;/);
  assert.ok(helpBlock, 'cli.mjs 应含 HELP 常量');
  const r = helpSync(helpBlock[1], KNOWN_FLAGS);
  assert.deepEqual(r.missingInHelp, []);
  assert.deepEqual(r.missingInParse, []);
  assert.equal(r.ok, true);
});

test('helpSync：parseArgv 少认一个选项 → missingInParse 报出', () => {
  const r = helpSync('--depth --full', ['--depth']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingInParse, ['--full']);
});

test('helpSync：HELP 没写 parseArgv 认的 → missingInHelp 报出', () => {
  const r = helpSync('--depth', ['--depth', '--full']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingInHelp, ['--full']);
});

test('parseArgv：--depth 与 --full 识别', () => {
  const r = parseArgv(['/tmp/x', '--depth', '5', '--full']);
  assert.equal(r.flags.depth, 5);
  assert.equal(r.flags.full, true);
  assert.deepEqual(r.positional, ['/tmp/x']);
});

test('parseArgv：未知参数报错', () => {
  const r = parseArgv(['--bogus']);
  assert.match(r.error, /未知参数: --bogus/);
});

test('parseArgv：--depth 缺值 → 报错', () => {
  const r = parseArgv(['--depth']);
  assert.match(r.error, /--depth/);
});

test('main：未知命令 exit 1 且提示', () => {
  const prev = process.exitCode;
  main(['nope-cmd']);
  assert.equal(process.exitCode, 1);
  process.exitCode = prev ?? 0;
});

test('cmdVersion：输出含 v + VERSION', () => {
  const prev = console.log;
  let out = '';
  console.log = (s) => { out += s; };
  try { cmdVersion(); } finally { console.log = prev; }
  assert.ok(out.includes(`v${VERSION}`));
});

test('package.json：name 即 dsh-git-push（本体身份）', () => {
  assert.equal(packageJson.name, 'dsh-git-push');
  assert.ok(!/v2|重构|重建/.test(packageJson.description), 'description 不应含 v2/重构 措辞');
});