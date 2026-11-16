// 提交前预处理引擎 · 契约测试
//
// 测的是什么（按 docs/2026-11-13-提交前预处理与审计引擎解耦方案.MD §八 验收）：
//   ① 契约退出码 0/1/2 的**分类**必须正确（引擎崩 ≠ 审计不通过，两者不能混）；
//   ② 超时 / 命令不存在 / stdout 不合契约 → 一律 fail-closed（拒绝提交，不许当通过）；
//   ③ 错误信息必须可诊断（含命令、退出码、stderr 尾部），否则用户会卡在「提交不了但不知道为什么」；
//   ④ 参数缺省语义等价于插件默认配置（maxScanFiles 缺省必须走 3000，**不能退化成 0=不限**）；
//   ⑤ **搬迁无行为变化**：引擎子进程的 findings/summary/quality 与进程内 auditWithScope 完全一致；
//
// 测试策略：分支用**假引擎**驱动（临时目录里的几行脚本），不依赖真实审计结果——
//   真实审计的规则与阈值会变，拿它当断言基准会让这个测试天天红。
//   只有 ⑤⑥ 必须用真引擎（它们要证明的正是「真引擎与进程内一致」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 宿主文档漂移检查器接线：lib/commit-push.js 已不再自己接线（那件事搬进引擎入口），
//   本测试要在进程内直接调 auditWithScope 做基准，必须同样接线，否则基准会少两类 finding。
import { defaultConfig } from '../../lib/client/index.js';
import { Config } from '../../lib/app/schema.js';
import { setSettingsFileOverride } from '../../lib/app/settings-bridge.js';
import { runPreprocess } from '../../lib/commit-push.js';
import { resolvePreCommitEnabled } from '../../lib/commit-push/pre-commit-engine.js';
import {
  PRE_COMMIT_TIMEOUT_MS_DEFAULT,
  buildEngineArgs,
  resolveGateProvider,
  resolveEngineArgs,
  resolvePreCommitConfig,
  runPreCommitEngine,
} from '../../lib/commit-push/pre-commit-engine.js';

const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));
// 插件根下**存在**的文件（用于「相对路径按插件根解析」测试）。
//   旧的内置引擎入口 scripts/audit-gate.mjs 已随拆包删除，不能再拿它当样本。
const PLUGIN_LOCAL_FILE_REL = 'lib/app/index.js';
const PLUGIN_LOCAL_FILE = join(PLUGIN_ROOT, PLUGIN_LOCAL_FILE_REL);

/** 假引擎模板：MODE 由生成时替换，避免用环境变量（多测试并行会互相污染）。 */
function fakeEngineSource(mode) {
  return `// 假引擎（测试生成，非交付物）：只按契约输出/退出，不跑任何真实审计。
const MODE = ${JSON.stringify(mode)};
const out = (value) => { process.stdout.write(JSON.stringify(value) + '\\n'); };
const base = {
  ok: true, scope: 'diff',
  summary: { blocker: 0, warning: 0, notice: 0, total: 0 },
  quality: { score: 100, level: 'A' },
  findings: [], files: 1,
  blocked: [],
};
// 每个分支都必须自己结束进程：分支之间不能「漏下去」，否则 slow 会走到兜底的 unknown mode
if (MODE === 'ok') { out(base); process.exit(0); }
else if (MODE === 'blocked') {
  // 豁免由预处理实现判定：引擎收到 --exempt-paths 命中本文件时，blocked 应为空（模拟真实包行为）
  const exempted = process.argv.join(' ').includes('src/bad.js');
  out({
    ...base, ok: !exempted,
    summary: { blocker: 1, warning: 0, notice: 0, total: 1 },
    quality: { score: 42, level: 'E' },
    findings: [{ file: 'src/bad.js', line: 1, rule: 'fake/blocker', severity: 'blocker', message: '假引擎拦截' }],
    blocked: exempted ? [] : [{ file: 'src/bad.js', line: 1, rule: 'fake/blocker', message: '假引擎拦截' }],
  });
  process.exit(1);
}
else if (MODE === 'engine-error') { process.stderr.write('fake engine boom: stack tail here\\n'); process.exit(2); }
else if (MODE === 'exit-nine') { process.stderr.write('fake engine exit nine\\n'); process.exit(9); }
else if (MODE === 'slow') { setTimeout(() => { out(base); process.exit(0); }, 5000); }
else if (MODE === 'garbage') { process.stdout.write('not json at all\\n'); process.exit(0); }
else if (MODE === 'multiline') { out(base); out(base); process.exit(0); }
else if (MODE === 'no-summary') { out({ ok: true, scope: 'diff' }); process.exit(0); }
else { process.stderr.write('unknown fake mode: ' + MODE + '\\n'); process.exit(2); }
`;
}

/** 造一组假引擎脚本，返回 { mode: 绝对路径 }。 */
function makeFakeEngines(dir) {
  const modes = ['ok', 'blocked', 'engine-error', 'exit-nine', 'slow', 'garbage', 'multiline', 'no-summary'];
  const map = {};
  for (const mode of modes) {
    const file = join(dir, `fake-engine-${mode}.mjs`);
    writeFileSync(file, fakeEngineSource(mode));
    map[mode] = file;
  }
  return map;
}

/** 用假引擎跑一次（command 固定为当前 node，args 指向脚本）。 */
function runWithFake(engines, mode, extra = {}) {
  return runPreCommitEngine({
    repoPath: '/tmp',
    scope: 'diff',
    cfg: { preCommit: { command: process.execPath, args: [engines[mode]], timeoutMs: extra.timeoutMs } },
    ...extra,
  });
}

/** 造一个含 blocker 触发点的临时仓库（触发词单字拼接，避免本测试源码自身命中黑名单）。 */
function makeBlockerRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-blocker-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'base.js'), 'export const base = 1;\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  const trigger = `${['用', '户', '原', '话'].join('')}：引擎契约测试用命中`;
  writeFileSync(join(dir, 'src', 'bad.js'), `// ${trigger}\nexport const bad = 1;\n`);
  return dir;
}




test('buildEngineArgs：只传调用上下文，实现自己的配置不传', () => {
  const argv = buildEngineArgs({
    repoPath: '/repo', rulesetDir: '/rs', blockersOnly: true,
    visibility: 'private', exemptPaths: ['a.js'], exemptReason: '示例',
  });
  assert.equal(argv[argv.length - 1], '--json', '--json 必须在最后（尾部固定段，任何语言都好解析）');
  assert.equal(argv[argv.indexOf('--repo') + 1], '/repo');
  assert.equal(argv[argv.indexOf('--ruleset') + 1], '/rs');
  assert.equal(argv[argv.indexOf('--visibility') + 1], 'private');
  assert.equal(argv[argv.indexOf('--exempt-paths') + 1], 'a.js');
  assert.equal(argv[argv.indexOf('--exempt-reason') + 1], '示例');
  assert.ok(argv.includes('--blockers-only'));
  // 配置类参数一律不传：它们归预处理实现自己的配置文件
  for (const flag of ['--scope', '--weights', '--max-scan-files', '--slots', '--disabled-slots']) {
    assert.ok(!argv.includes(flag), `${flag} 属实现自己的配置，宿主不该替它传`);
  }
  // 空值不传（空字符串会被引擎当成一个空取值）
  const minimal = buildEngineArgs({ repoPath: '/repo' });
  assert.deepEqual(minimal, ['--repo', '/repo', '--json']);
});

test('实现包被拔掉（command 指向 node、args 指向包里已不存在的 CLI）→ 跳过，不拦提交', async () => {
  // 热插拔语义：optionalDependency 没装时 args 指向的文件就没了，这属于「扩展没插」，
  //   不是「引擎坏了」。判据是「实现包 CLI 入口不存在」，与有没有显式配置 command 无关。
  const r = await runPreCommitEngine({
    repoPath: '/tmp',
    cfg: { preCommit: { enabled: true, command: 'node', args: ['/nonexistent-provider-' + Date.now() + '/cli.mjs'] } },
  });
  assert.equal(r.ok, true, '缺实现包不该拦提交');
  assert.equal(r.preprocessSkipped, 'package-not-found', '应明确标注「实现不可用」而不是静默通过');
  assert.ok(r.skipReason, '应带可诊断原因');
});

test('args 里的相对路径按插件根解析，不存在的原样保留（不猜）', () => {
  const resolved = resolveEngineArgs([PLUGIN_LOCAL_FILE_REL, 'not-exist-engine.py', '--timing', '200', '/abs/x.mjs']);
  assert.equal(resolved[0], PLUGIN_LOCAL_FILE, '插件根下的相对路径必须解析成绝对路径（换机不断链）');
  assert.equal(resolved[1], 'not-exist-engine.py', '不存在的相对路径原样保留，交给引擎自己报错');
  assert.equal(resolved[2], '--timing', '命令行选项不能当路径改写');
  assert.equal(resolved[3], '200', '选项取值不能当路径改写');
  assert.equal(resolved[4], '/abs/x.mjs', '绝对路径原样');
});

test('preCommit 三档解析顺序：cfg.preCommit → config.json → 内置默认', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-cfg-'));
  try {
    const cfgFile = join(dir, 'config.json');
    writeFileSync(cfgFile, JSON.stringify({ preCommit: { command: 'python3', args: ['tools/audit_gate.py'], timeoutMs: 1234 } }));
    setSettingsFileOverride(cfgFile);
    try {
      // ① cfg 有 → 用 cfg，不读文件
      const fromCfg = resolvePreCommitConfig({ preCommit: { command: process.execPath, args: ['mine.mjs'] } });
      assert.equal(fromCfg.command, process.execPath);
      assert.deepEqual(fromCfg.args, ['mine.mjs']);
      assert.equal(fromCfg.source, 'cfg');
      // ② cfg 没有 → 读 config.json
      const fromFile = resolvePreCommitConfig({});
      assert.equal(fromFile.command, 'python3');
      assert.deepEqual(fromFile.args, ['tools/audit_gate.py']);
      assert.equal(fromFile.timeoutMs, 1234);
      assert.equal(fromFile.source, 'config.json');
    } finally { setSettingsFileOverride(null); }
    // ③ 都没有 → 内置默认（node + **预处理实现 CLI**），超时 10 分钟
    //   只在显式配置回滚时使用（见下一条断言）。
    //   注意：这里必须用「空的临时配置」覆盖，否则会读到**宿主真实 config.json**——
    //   开发机可能配了 preCommit 指向本地预处理实现（拆包后这就是正常配置），
    //   而本档断言的是「三档都没有」⇒ 不隔离会让测试结果依赖机器状态。
    const emptyCfg = join(dir, 'empty-config.json');
    writeFileSync(emptyCfg, '{}');
    setSettingsFileOverride(emptyCfg);
    const fallback = resolvePreCommitConfig({});
    assert.equal(fallback.source, 'default');
    assert.equal(fallback.command, '', 'command 空 = 内置 node');
    assert.equal(fallback.args.length, 1, '缺省只带一个入口脚本参数');
    assert.ok(fallback.args[0].length > 0, '缺省入口应指向预处理实现 CLI（路径由 provider 解析提供）');
    assert.equal(fallback.timeoutMs, PRE_COMMIT_TIMEOUT_MS_DEFAULT);
    // ③' 回滚路径已随拆包删除（内置引擎入口不复存在），原 legacyEngine 断言一并移除
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('超时配置非法（0/负数/NaN）退回默认 —— 0 不能让门禁永远超时', () => {
  assert.equal(resolvePreCommitConfig({ preCommit: { timeoutMs: 0 } }).timeoutMs, PRE_COMMIT_TIMEOUT_MS_DEFAULT);
  assert.equal(resolvePreCommitConfig({ preCommit: { timeoutMs: -5 } }).timeoutMs, PRE_COMMIT_TIMEOUT_MS_DEFAULT);
  assert.equal(resolvePreCommitConfig({ preCommit: { timeoutMs: 'abc' } }).timeoutMs, PRE_COMMIT_TIMEOUT_MS_DEFAULT);
});



test('退出码 2 → fail-closed，错误信息含命令 + 退出码 + stderr 尾部', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-'));
  try {
    const engines = makeFakeEngines(dir);
    const r = await runWithFake(engines, 'engine-error');
    assert.equal(r.ok, false, '引擎失败必须 fail-closed');
    assert.equal(r.blocked, false, '引擎失败不等于审计拦截（工具侧文案要能区分）');
    assert.equal(r.audit, null);
    assert.match(r.error, /退?出码 2/, '必须说明退出码');
    assert.match(r.error, /fake-engine-engine-error\.mjs/, '必须说明跑的是哪条命令');
    assert.match(r.error, /fake engine boom/, '必须带 stderr（否则用户无从下手）');
    assert.match(r.error, /未执行任何 git 操作/, '必须说清 git 侧什么都没做');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('未在契约内的退出码（9）→ 同样 fail-closed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-'));
  try {
    const engines = makeFakeEngines(dir);
    const r = await runWithFake(engines, 'exit-nine');
    assert.equal(r.ok, false);
    assert.match(r.error, /退出码 9/);
    assert.match(r.error, /fake engine exit nine/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 失败路径 ────────────────────────────────────────────────────────
test('超时 → fail-closed（强杀 + 明确报超时）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-'));
  try {
    const engines = makeFakeEngines(dir);
    const startedAt = Date.now();
    const r = await runWithFake(engines, 'slow', { timeoutMs: 300 });
    const elapsed = Date.now() - startedAt;
    assert.equal(r.ok, false, '超时必须 fail-closed');
    assert.match(r.error, /超时/);
    assert.ok(elapsed < 4000, `超时应尽快返回（实测 ${elapsed}ms，假引擎会睡 5s）`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('命令不存在 → fail-closed 且指明「找不到命令」与搜索过的 PATH', async () => {
  const r = await runPreCommitEngine({
    repoPath: '/tmp',
    scope: 'diff',
    cfg: { preCommit: { command: 'dshgp-no-such-engine-binary-xyz', args: [] } },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /找不到引擎命令「dshgp-no-such-engine-binary-xyz」/);
  assert.match(r.error, /PATH/, '要告诉用户搜过哪里');
  assert.match(r.error, /未执行任何 git 操作/);
});

test('stdout 不合契约（非 JSON / 多行 / 缺 summary）→ fail-closed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-'));
  try {
    const engines = makeFakeEngines(dir);
    const garbage = await runWithFake(engines, 'garbage');
    assert.equal(garbage.ok, false);
    assert.match(garbage.error, /不是合法 JSON/);

    const multiline = await runWithFake(engines, 'multiline');
    assert.equal(multiline.ok, false, '多行输出说明引擎破坏了单行契约，不能猜哪一行是对的');
    assert.match(multiline.error, /单行 JSON/);

    const noSummary = await runWithFake(engines, 'no-summary');
    assert.equal(noSummary.ok, false);
    assert.match(noSummary.error, /缺少 summary/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── git 侧职责没被搬走（用假引擎驱动，结果完全可控） ────────────────
test('runPreprocess：预处理关闭时完全不调引擎（引擎配错也不影响提交）', async () => {
  // 隔离配置文件：本用例要断言「关掉时返回值就是干净的 {ok,audit:null}」，
  //   若读到真实 DSH_HOME 里可能存在的旧键，返回体会多出迁移提示字段（那是另一条语义）。
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-off-'));
  const cfgFile = join(dir, 'config.json');
  writeFileSync(cfgFile, JSON.stringify({ preCommit: { enabled: false } }));
  setSettingsFileOverride(cfgFile);
  try {
    // command 指向不存在的程序：如果还是去 spawn 了，必然报「找不到引擎命令」
    const r = await runPreprocess({ repoPath: '/tmp', audit: false, cfg: { preCommit: { enabled: false, command: 'dshgp-no-such-engine-binary-xyz' } } });
    assert.deepEqual(r, { ok: true, audit: null });
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runPreprocess：配置文件里 preCommit.enabled=true 时门禁照跑（开关真源是 config.json）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-on-'));
  const cfgFile = join(dir, 'config.json');
  writeFileSync(cfgFile, JSON.stringify({ preCommit: { enabled: true, command: 'dshgp-no-such-engine-binary-xyz' } }));
  setSettingsFileOverride(cfgFile);
  try {
    // 开关为开但引擎不存在 ⇒ fail-closed（不能因为「引擎恰好没跑起来」就放行）
    const r = await runPreprocess({ repoPath: '/tmp', cfg: {} });
    assert.equal(r.ok, false, '引擎不可用必须 fail-closed');
    assert.match(String(r.error), /找不到引擎命令|无法启动|预处理失败/);
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('只认旧版开关键时按它的值决定跑不跑（不静默关掉门禁）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-legacy-'));
  const cfgFile = join(dir, 'config.json');
  writeFileSync(cfgFile, JSON.stringify({ auditEnabled: true }));
  setSettingsFileOverride(cfgFile);
  try {
    // 开关真源是 config.json 里的旧键：schema 默认值（false）不得压过它
    const state = resolvePreCommitEnabled({ preCommit: { enabled: false } });
    assert.equal(state.enabled, true, '旧键为开 ⇒ 开关必须是开');
    assert.equal(state.source, 'legacy', '沿用旧键时必须标出来源');
    // 门禁真跑起来（引擎不存在 ⇒ fail-closed，而不是当作「没开」静默放行）
    const r = await runPreprocess({ repoPath: '/tmp', cfg: { preCommit: { enabled: false, command: 'dshgp-no-such-engine-binary-xyz' } } });
    assert.equal(r.ok, false, '引擎不可用必须 fail-closed');
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
});


