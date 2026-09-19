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

test('parseArgv：--ruleset / --weights 识别（G7 CLI 对齐）', () => {
  const r = parseArgv(['/tmp/x', '--ruleset', '/tmp/rs', '--weights', '{"安全性":100}']);
  assert.equal(r.flags.ruleset, '/tmp/rs');
  assert.equal(r.flags.weights, '{"安全性":100}');
  assert.deepEqual(r.positional, ['/tmp/x']);
});

test('parseArgv：--level 已删除（审计固定完整流程，不再是合法参数）', () => {
  // 2026-09-17：审计强度不是用户可配项，CLI 的 --level 随之删除。
  // 仍传 --level 应被当作未知参数拒绝（而非静默忽略），避免用户以为强度生效了。
  const r = parseArgv(['--level', 'quick']);
  assert.ok(r.error, '--level 应报错');
  assert.match(r.error, /--level/);
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
test('同步：同步清单含入口与规则，排除 test/看板', async () => {
  const files = await listSyncFiles(ROOT);
  assert.ok(files.includes('package.json'));
  assert.ok(files.includes('cli.mjs'));
  assert.ok(files.includes('lib/index.js'));
  assert.ok(files.some((f) => f.startsWith('lib/audit-rules/')));
  assert.ok(!files.some((f) => f.startsWith('test/')), 'test 不应随插件发布');
  assert.ok(!files.some((f) => f.includes('WORKBOARD')), '开发看板不应随插件发布');
  assert.ok(!files.some((f) => f.includes('node_modules')));
});

test('同步：dry-run 不写文件（默认安全）', async () => {
  const target = join(ROOT, '.tmp-sync-test');
  const r = await syncPlugin({ source: ROOT, target, write: false });
  assert.equal(r.ok, true);
  assert.ok(r.written > 0);
  assert.equal(existsSync(target), false, 'dry-run 不应创建目标目录');
});

test('同步：缺目标目录时报错不静默', async () => {
  const r = await syncPlugin({ source: ROOT, target: '' });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('未指定目标'));
});

test('同步：真实写入到临时目录（幂等）', async () => {
  const target = join(ROOT, '.tmp-sync-write');
  const r1 = await syncPlugin({ source: ROOT, target, write: true });
  assert.equal(r1.ok, true);
  assert.ok(existsSync(join(target, 'package.json')));
  const r2 = await syncPlugin({ source: ROOT, target, write: true });
  assert.equal(r2.written, 0, '第二次应全部一致（幂等）');
  assert.ok(r2.skipped > 0);
  // 清理
  import('node:fs').then((fs) => fs.rmSync(target, { recursive: true, force: true }));
});

test('同步：常量声明齐全', () => {
  assert.ok(SYNC_ENTRIES.includes('lib'));
  assert.ok(SYNC_EXCLUDE.includes('node_modules'));
  // 2026-09-14：备份与回收站不得进安装副本（scripts/*.bak 曾被同步进 <插件目录>/scripts/）
  assert.ok(SYNC_EXCLUDE.includes('.bak'), 'SYNC_EXCLUDE 必须排除 .bak（含 .bak-<后缀>）');
  assert.ok(SYNC_EXCLUDE.includes('.trash'), 'SYNC_EXCLUDE 必须排除 .trash 回收站');
});

// 2026-09-14：实测返回集，确保排除规则真的作用于 listSyncFiles（不只是常量里写了名字）
test('同步：listSyncFiles 返回集不含 .bak / .trash 残留', async () => {
  const files = await listSyncFiles(ROOT);
  const bad = files.filter((f) => f.includes('.bak') || f.includes('.trash'));
  assert.deepEqual(bad, [], `备份/回收站文件不得进安装副本：${bad.join(', ')}`);
  assert.ok(files.length > 0, '同步清单不应为空');
});

// 2026-09-13：SYNC_ENTRIES 曾漏 client.js（侧边栏前端主文件当时在仓库根），
//   而 package.json 的 files 白名单里有它 → 同步到已安装副本时前端改动装不进去。
//   2026-09-19：client.js 移到 lib/client.js，随 'lib' 整目录同步，此类漏列风险消除；
//   断言保留——仍锁死 files 白名单与 SYNC_ENTRIES 一致，避免以后新增发布文件又漏同步。
test('同步：SYNC_ENTRIES 覆盖 package.json files 白名单', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const f of pkg.files) {
    assert.ok(SYNC_ENTRIES.includes(f),
      `package.json files 里的 ${f} 未在 SYNC_ENTRIES 中——同步会漏掉它（发布有、安装副本无）`);
  }
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

// 2026-09-18：克隆防护回归 —— 目标位于既有 git 仓库工作树内时必须拒绝。
//   背景：cloneViaApi 末尾要 git init/add/commit 建初始提交；目标若在既有仓库内
//   （哪怕目标目录尚不存在），git init 在 CIFS 上会 chmod 失败静默留下未初始化目录，
//   随后的 add/commit 便向上命中父仓库 .git，把父仓库全部内容作为一次提交写进其历史
//   —— 实测两次发生（678458e / 17f572d，均已 reset 撤销、未推送）。
test('clone 防护：目标位于既有仓库工作树内必须拒绝', async () => {
  const { enclosingGitRoot, cloneViaApi } = await import('../lib/git/clone.js');

  // ① 判据层（不联网）：仓库内不存在目录应命中父仓库根
  assert.equal(enclosingGitRoot(join(ROOT, '.tmp-not-exist')), ROOT,
    '仓库内不存在目录应命中父仓库根');
  assert.equal(enclosingGitRoot(join(ROOT, '.tmp-not-exist', 'deep', 'x')), ROOT,
    '仓库内深层不存在目录应命中父仓库根');
  assert.notEqual(enclosingGitRoot(tmpdir()), ROOT, '仓库外目录不应命中本仓库');

  // ② 端到端：走到防护分支必须发生在「目录创建 / git 操作」之前。
  //   注意不能用无效 token 测——那样会在 HTTP 401 提前返回，根本走不到防护，
  //   测试会「通过」但什么都没验证。这里用仓库内目标 + 有效凭据，
  //   若防护失效则错误会是 HTTP/网络类而非「位于既有仓库内」。
  const headBefore = readFileSync(join(ROOT, '.git', 'HEAD'), 'utf8');
  const r = await cloneViaApi({ target: 'EIGHTfs/dsh-git-push', dest: join(ROOT, '.tmp-guard-probe') });
  assert.equal(r.ok, false, '仓库内目标必须被拒绝');
  assert.match(String(r.error), /既有 git 仓库内/,
    `错误必须来自防护分支（而非提前的 API 失败）；实际: ${r.error}`);
  assert.equal(readFileSync(join(ROOT, '.git', 'HEAD'), 'utf8'), headBefore,
    '被拒绝的克隆不得改动 .git/HEAD');
  assert.equal(existsSync(join(ROOT, '.tmp-guard-probe')), false,
    '被拒绝时不得留下目标目录');
});

// 2026-09-19：CLI 补齐的 5 个命令（clone / account-check / remote-create /
//   set-visibility / gen-ssh-key）——与插件同名工具一一对应。
//   这些用例全部**离线**：只验证「命令已接线、参数校验、退出码」三件事，
//   不发网络请求、不写远端、不动本机凭据（联网部分由 clone e2e 覆盖）。
test('CLI 新命令：HELP 必须列出 5 个补齐命令', () => {
  const helpBlock = cliText.match(/const HELP = `([\s\S]*?)`;/);
  assert.ok(helpBlock, 'cli.mjs 应含 HELP 常量');
  for (const cmd of ['clone', 'account-check', 'remote-create', 'set-visibility', 'gen-ssh-key']) {
    assert.ok(new RegExp(`git-sluice ${cmd}\\b`).test(helpBlock[1]),
      `HELP 必须列出 ${cmd}（否则用户不知道它存在）`);
  }
});

test('CLI 新命令：main 分发必须接线（不能只写 HELP）', () => {
  for (const cmd of ['clone', 'account-check', 'remote-create', 'set-visibility', 'gen-ssh-key']) {
    assert.ok(new RegExp(`cmd === '${cmd}'`).test(cliText),
      `main 必须分发 ${cmd}`);
  }
});

test('CLI 新命令：--email / --visibility 解析与缺值报错', () => {
  // 值参数正常解析
  const r1 = parseArgv(['--email', 'a@b.co', '--visibility', 'private']);
  assert.equal(r1.flags.email, 'a@b.co');
  assert.equal(r1.flags.visibility, 'private');
  // 缺值必须报错（而非静默吞掉下一个参数）
  for (const f of ['--email', '--visibility', '--dest', '--branch', '--token', '--max-file-mb', '--concurrency']) {
    const r = parseArgv([f]);
    assert.ok(r.error, `${f} 缺值必须报错`);
  }
});

test('CLI 新命令：--no-check-ssh / --preview 布尔开关', () => {
  assert.equal(parseArgv(['--preview']).flags.preview, true);
  // checkSsh 默认 true，--no-check-ssh 置 false（语义是「关掉」而非「开启」）
  assert.equal(parseArgv([]).flags.checkSsh, true);
  assert.equal(parseArgv(['--no-check-ssh']).flags.checkSsh, false);
});

test('CLI 新命令：缺必填参数时退出码非 0（脚本可判失败）', async () => {
  const cases = [
    ['clone', []],                       // 缺 <owner/repo>
    ['remote-create', []],               // 缺 <repo>
    ['set-visibility', ['/tmp']],        // 缺 --visibility
    ['gen-ssh-key', []],                 // 缺 --email
  ];
  for (const [cmd, args] of cases) {
    const prevErr = console.error;
    console.error = () => {};
    let code;
    try { code = await main([cmd, ...args]); } finally { console.error = prevErr; }
    assert.equal(code, 1, `${cmd} 缺参数必须返回 1（实际 ${code}）`);
  }
});

test('CLI 新命令：--visibility 只接受 public|private', async () => {
  const prevErr = console.error;
  console.error = () => {};
  let code;
  try { code = await main(['set-visibility', '/tmp', '--visibility', 'weird']); } finally { console.error = prevErr; }
  assert.equal(code, 1, '非法 visibility 必须拒绝（防误改可见性）');
});
