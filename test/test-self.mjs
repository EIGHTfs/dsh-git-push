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
import {
  SOURCE_ROOT, SYNC_ENTRIES, SYNC_EXCLUDE, listSyncFiles, detectTargets, syncPlugin,
} from '../scripts/sync-plugin.mjs';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

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

test('parseArgv：--level / --ruleset / --weights 识别（G7 CLI 对齐）', () => {
  const r = parseArgv(['/tmp/x', '--level', 'quick', '--ruleset', '/tmp/rs', '--weights', '{"安全性":100}']);
  assert.equal(r.flags.level, 'quick');
  assert.equal(r.flags.ruleset, '/tmp/rs');
  assert.equal(r.flags.weights, '{"安全性":100}');
  assert.deepEqual(r.positional, ['/tmp/x']);
});

test('parseArgv：--level 非法取值 → 报错（白名单校验）', () => {
  assert.match(parseArgv(['--level', 'insane']).error, /quick\|standard\|deep/);
  assert.equal(parseArgv(['--level', 'deep']).flags.level, 'deep');
});

test('parseArgv：--ruleset / --weights 缺值 → 报错', () => {
  assert.match(parseArgv(['--ruleset']).error, /--ruleset 缺值/);
  assert.match(parseArgv(['--weights']).error, /--weights 缺值/);
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

// ---------- 参数解析健壮性（原 test-framework）----------
test('CLI：parseArgv 支持 --depth 与 --full', () => {
  const { flags, positional } = parseArgv(['.', '--depth', '5']);
  assert.equal(flags.depth, 5);
  assert.equal(positional[0], '.');
  const { flags: f2 } = parseArgv(['--full', '/tmp']);
  assert.equal(f2.full, true);
});

test('CLI：未知参数报错（不走 HELP 静默）', () => {
  const { error } = parseArgv(['--not-exist']);
  assert.match(error, /未知参数/);
});

// ---------- 双副本同步与发布准备（原 test-plugin，归属自身总入口）----------
test('同步：同步清单含入口与规则，排除 test/看板', () => {
  const files = listSyncFiles(ROOT);
  assert.ok(files.includes('package.json'));
  assert.ok(files.includes('cli.mjs'));
  assert.ok(files.includes('lib/index.js'));
  assert.ok(files.some((f) => f.startsWith('lib/audit-rules/')));
  assert.ok(!files.some((f) => f.startsWith('test/')), 'test 不应随插件发布');
  assert.ok(!files.some((f) => f.includes('WORKBOARD')), '开发看板不应随插件发布');
  assert.ok(!files.some((f) => f.includes('node_modules')));
});

test('同步：dry-run 不写文件（默认安全）', () => {
  const target = join(ROOT, '.tmp-sync-test');
  const r = syncPlugin({ source: ROOT, target, write: false });
  assert.equal(r.ok, true);
  assert.ok(r.written > 0);
  assert.equal(existsSync(target), false, 'dry-run 不应创建目标目录');
});

test('同步：缺目标目录时报错不静默', () => {
  const r = syncPlugin({ source: ROOT, target: '' });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('未指定目标'));
});

test('同步：真实写入到临时目录（幂等）', () => {
  const target = join(ROOT, '.tmp-sync-write');
  const r1 = syncPlugin({ source: ROOT, target, write: true });
  assert.equal(r1.ok, true);
  assert.ok(existsSync(join(target, 'package.json')));
  const r2 = syncPlugin({ source: ROOT, target, write: true });
  assert.equal(r2.written, 0, '第二次应全部一致（幂等）');
  assert.ok(r2.skipped > 0);
  // 清理
  import('node:fs').then((fs) => fs.rmSync(target, { recursive: true, force: true }));
});

test('同步：常量声明齐全', () => {
  assert.ok(SYNC_ENTRIES.includes('lib'));
  assert.ok(SYNC_EXCLUDE.includes('node_modules'));
});

test('同步：detectTargets 对无 HOME 返回空数组（不崩）', () => {
  assert.deepEqual(detectTargets(''), []);
  assert.deepEqual(detectTargets('/no/such/home'), []);
});

// ---------- 推送准备（产物完整） ----------
test('推送准备：package.json 有 name/version/exports/files/bin', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-git-push');
  assert.equal(pkg.version, VERSION);
  assert.ok(pkg.exports['.']);
  assert.ok(pkg.exports['./client']);
  assert.ok(Array.isArray(pkg.files));
  assert.ok(pkg.bin['git-sluice']);
});

test('推送准备：cordis.patch.yml 存在且含 insert 写法', () => {
  const yml = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
  assert.ok(yml.includes('insert:'), '第三方 bundle patch 用 insert 顶层新建行');
  assert.ok(yml.includes('dsh-git-push'));
});