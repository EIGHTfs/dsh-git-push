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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  runPreCommitPipeline,
  resolveStages,
  splitCommandLine,
  substitutePlaceholders,
  resolveStageOnFail,
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

/* ───────────────── S1：有序阶段链（配置解析 + 向后兼容） ───────────────── */

test('resolveStages：未配 stages ⇒ legacy（走原来的单命令路径）', () => {
  for (const cfg of [{}, { preCommit: {} }, { preCommit: { stages: [] } }]) {
    const plan = resolveStages(cfg);
    assert.equal(plan.mode, 'legacy', '未配 stages 必须走 legacy');
    assert.deepEqual(plan.stages, []);
  }
});

test('resolveStages：配了 stages ⇒ chain，保持数组顺序（顺序即执行序）', () => {
  const plan = resolveStages({ preCommit: { stages: [{ provider: 'audit' }, { provider: 'x' }] } });
  assert.equal(plan.mode, 'chain');
  assert.deepEqual(plan.stages.map((x) => x.provider), ['audit', 'x'], '顺序必须原样保留');
});

test('resolveStages：空条目抛配置错；非法 onFail 当"没配"（不猜 block/warn）', () => {
  assert.throws(() => resolveStages({ preCommit: { stages: [{ provider: '  ' }] } }), /第 1 项|provider|command/,
    '空条目必须在解析期就报错（静默跳过会让用户以为这道门禁在跑）');
  const plan = resolveStages({ preCommit: { stages: [{ provider: 'audit', onFail: 'boom' }] } });
  assert.equal(plan.stages[0].onFail, '', '非法 onFail 当"没配"（交给 provider 声明），不当成 block/warn');
});

test('resolveStageOnFail：用户配置 > provider 声明 > 默认 block（宿主不按 provider 名猜语义）', () => {
  assert.equal(resolveStageOnFail({ onFail: 'warn' }, null), 'warn', '用户配了就按用户的');
  assert.equal(resolveStageOnFail({ onFail: 'warn' }, { defaultOnFail: 'block' }), 'warn', '用户优先于 provider 声明');
  assert.equal(resolveStageOnFail({ onFail: '' }, { defaultOnFail: 'warn' }), 'warn', '没配就用 provider 声明的');
  assert.equal(resolveStageOnFail({ onFail: '' }, null), 'block', '都没声明 ⇒ fail-closed');
  assert.equal(resolveStageOnFail({ onFail: '' }, { defaultOnFail: 'nonsense' }), 'block', '非法声明当没声明');
});

test('向后兼容：未配 stages 时 pipeline 与单次引擎逐字段一致（回执形状不变）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-pipeline-legacy-'));
  try {
    const engine = writeFakeEngine(dir, 'fake-engine.mjs', { marker: 'legacy-ok' });
    const cfg = { preCommit: { enabled: true, command: 'node', args: [engine] } };
    const direct = await runPreCommitEngine({ repoPath: dir, cfg: cfg });
    const viaPipeline = await runPreCommitPipeline({ repoPath: dir, cfg: cfg });
    // 唯一的差异允许是 additive 的 stagesSource（用于观测"本次跑的是谁"）
    const { stagesSource, ...rest } = viaPipeline;
    assert.deepEqual(rest, direct, '除 stagesSource 外必须逐字段一致');
    assert.equal(stagesSource, 'command', '显式配了 command ⇒ 来源应标 command');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('单阶段：stages 指定 provider 时按该 provider 的 CLI 执行（不是写死默认那个）', async () => {
  // 用注册表里的 audit + 环境变量把它指到假 CLI：验证"阶段解析出来的入口真的被用了"
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-pipeline-one-'));
  const fakeCli = join(dir, 'fake-cli.mjs');
  const prevEnv = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    writeFileSync(fakeCli, [
      "const out = { ok: true, scope: 'diff', summary: { blocker: 0, warning: 0, notice: 0, total: 0 }, quality: { score: 100, level: 'A' }, findings: [], files: 0, marker: 'stage-provider-served' };",
      'process.stdout.write(JSON.stringify(out) + "\\n");',
      'process.exit(0);',
    ].join('\n'));
    process.env.DSH_PREPROCESS_AUDIT_CLI = fakeCli;
    const r = await runPreCommitPipeline({ repoPath: dir, cfg: { preCommit: { enabled: true, stages: [{ provider: 'audit' }] } } });
    assert.equal(r.ok, true, '单阶段应执行成功');
    assert.equal(r.audit && r.audit.marker, 'stage-provider-served', '应真的跑阶段里指定的 provider 入口');
  } finally {
    if (prevEnv === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('单阶段：provider 未注册 ⇒ fail-closed 且错误信息带 provider id（不能静默换人跑）', async () => {
  const r = await runPreCommitPipeline({ repoPath: '/tmp', cfg: { preCommit: { enabled: true, stages: [{ provider: 'no-such-provider' }] } } });
  assert.equal(r.ok, false, '未注册的 provider 必须 fail-closed');
  assert.match(String(r.error), /no-such-provider/, '错误信息要能看出是哪个 provider 没注册');
});

/* ───────────────── S2：多阶段顺序执行 + onFail 语义 ───────────────── */

/** 造一个可控的假引擎脚本：按 JSON 里给的 exitCode/JSON 输出行为。 */
function writeFakeEngine(dir, name, { exitCode = 0, body = null, marker = '' } = {}) {
  const file = join(dir, name);
  const payload = body || {
    ok: exitCode === 0,
    scope: 'diff',
    summary: { blocker: exitCode === 1 ? 1 : 0, warning: 0, notice: 0, total: exitCode === 1 ? 1 : 0 },
    quality: { score: 100, level: 'A' },
    blocked: exitCode === 1 ? [{ file: 'x.js', line: 1, rule: 'r', message: 'm' }] : [],
    findings: [],
    files: 1,
    ...(marker ? { marker: marker } : {}),
  };
  writeFileSync(file, [
    'process.stdout.write(' + JSON.stringify(JSON.stringify(payload)) + ' + "\\n");',
    'process.exit(' + exitCode + ');',
  ].join('\n'));
  return file;
}

test('S2：多阶段按顺序执行，回执含每阶段 provider/ok/ms/onFail', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-chain-'));
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    const okEngine = writeFakeEngine(dir, 'ok.mjs', { marker: 'ok' });
    process.env.DSH_PREPROCESS_AUDIT_CLI = okEngine;
    const r = await runPreCommitPipeline({
      repoPath: dir,
      cfg: { preCommit: { enabled: true, stages: [{ provider: 'audit' }, { provider: 'audit' }] } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.blocked, false);
    assert.equal(r.preprocessStages.length, 2, '两个阶段都要有回执（顺序执行）');
    assert.deepEqual(r.preprocessStages.map((x) => x.provider), ['audit', 'audit']);
    assert.deepEqual(r.preprocessStages.map((x) => x.ok), [true, true]);
    assert.ok(r.preprocessStages.every((x) => typeof x.ms === 'number'), '每阶段都要有耗时');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('S2：onFail 未声明 ⇒ 默认 block（失败即拦，等价于审计旧行为）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-chain-block-'));
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    // 引擎退出码 2 = 执行失败；没配 onFail ⇒ 走默认 block
    process.env.DSH_PREPROCESS_AUDIT_CLI = writeFakeEngine(dir, 'boom.mjs', { exitCode: 2 });
    const r = await runPreCommitPipeline({
      repoPath: dir,
      cfg: { preCommit: { enabled: true, stages: [{ provider: 'audit' }, { provider: 'audit' }] } },
    });
    assert.equal(r.ok, false, '未声明 onFail 时必须拦截');
    assert.equal(r.preprocessStages.length, 1, '拦在第一阶段，后续阶段不再跑');
    assert.equal(r.preprocessStages[0].onFail, 'block', '回执要写清用了哪个语义');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('S2：onFail=warn ⇒ 失败只记警告并继续下一阶段', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-chain-warn-'));
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    // 第一阶段 warn 且失败；第二阶段要能证明它确实继续跑了
    const boom = writeFakeEngine(dir, 'boom.mjs', { exitCode: 2 });
    process.env.DSH_PREPROCESS_AUDIT_CLI = boom;
    const r = await runPreCommitPipeline({
      repoPath: dir,
      cfg: { preCommit: { enabled: true, stages: [{ provider: 'audit', onFail: 'warn' }, { provider: 'audit' }] } },
    });
    assert.equal(r.preprocessStages.length, 2, 'warn 阶段失败后必须继续跑到第二阶段');
    assert.equal(r.preprocessStages[0].ok, false);
    assert.equal(r.preprocessStages[0].onFail, 'warn');
    assert.ok(Array.isArray(r.preprocessWarnings) && r.preprocessWarnings.length >= 1, '要有警告记录');
    assert.equal(r.ok, false, '第二阶段用同一个失败引擎且默认 block ⇒ 整体仍拦（证明第二阶段真的跑了）');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('S2：用户 onFail=block 覆盖 provider 的 defaultOnFail=warn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-chain-override-'));
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    process.env.DSH_PREPROCESS_AUDIT_CLI = writeFakeEngine(dir, 'boom.mjs', { exitCode: 2 });
    // 用一个假 manifest 声明 defaultOnFail=warn（通过临时 provider 包 + 注册表不认 ⇒ 这里改用
    //   直接断言 resolveStageOnFail 的优先级，配合用户配置覆盖的行为断言）
    assert.equal(resolveStageOnFail({ onFail: 'block' }, { defaultOnFail: 'warn' }), 'block');
    const r = await runPreCommitPipeline({
      repoPath: dir,
      cfg: { preCommit: { enabled: true, stages: [{ provider: 'audit', onFail: 'block' }] } },
    });
    assert.equal(r.ok, false, '用户配 block ⇒ 即使 provider 想 warn 也要拦');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ───────────────── S3：快照差集 + 改动可见 + 幂等 ───────────────── */

/** 造一个"会改文件"的假 provider CLI：把 <repo>/a.js 写成固定内容，然后按契约输出。 */
function writeTouchEngine(dir, name, content) {
  const file = join(dir, name);
  writeFileSync(file, [
    "import { writeFileSync } from 'node:fs';",
    "const argv = process.argv.slice(2);",
    "const repo = argv[argv.indexOf('--repo') + 1] || '.';",
    'writeFileSync(repo + "/a.js", ' + JSON.stringify(content) + ');',
    "const out = { ok: true, scope: 'diff', summary: { blocker: 0, warning: 0, notice: 0, total: 0 }, quality: { score: 100, level: 'A' }, findings: [], files: 1 };",
    'process.stdout.write(JSON.stringify(out) + "\\n");',
    'process.exit(0);',
  ].join('\n'));
  return file;
}

/** 建一个临时 git 仓库（一个已提交文件），返回路径。 */
function makeTempRepo(prefix) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  writeFileSync(join(repo, 'a.js'), 'const x = 0;\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

test('S3：会改文件的阶段 ⇒ 回执带 changed 清单 + preprocessChanges 汇总', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-snap-'));
  const repo = makeTempRepo('dshgp-snap-repo-');
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    process.env.DSH_PREPROCESS_AUDIT_CLI = writeTouchEngine(dir, 'touch.mjs', 'const x = 1;\n');
    const r = await runPreCommitPipeline({
      repoPath: repo,
      cfg: { preCommit: { enabled: true, stages: [{ provider: 'audit' }] } },
    });
    assert.equal(r.ok, true);
    const stage = r.preprocessStages[0];
    assert.ok(stage.changed, '阶段回执应含 changed');
    assert.ok(stage.changed.files.includes('a.js'), `changed.files 应包含被改的 a.js，实际 ${JSON.stringify(stage.changed)}`);
    assert.equal(r.preprocessChanges.total, 1, '汇总应报出 1 个文件');
    assert.deepEqual(r.preprocessChanges.files, ['a.js']);
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('S3 幂等：同一个格式化阶段跑两次，第二次改动数必须为 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-idem-'));
  const repo = makeTempRepo('dshgp-idem-repo-');
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    process.env.DSH_PREPROCESS_AUDIT_CLI = writeTouchEngine(dir, 'touch.mjs', 'const x = 1;\n');
    const cfg = { preCommit: { enabled: true, stages: [{ provider: 'audit' }] } };
    const first = await runPreCommitPipeline({ repoPath: repo, cfg: cfg });
    assert.equal(first.preprocessChanges.total, 1, '第一次应改掉 1 个文件');
    // 第二次：内容已与格式化目标一致 ⇒ 真幂等必须是 0（不是"又改了一遍"）
    const second = await runPreCommitPipeline({ repoPath: repo, cfg: cfg });
    assert.equal(second.preprocessChanges.total, 0,
      `幂等失败：第二次仍报改动 ${JSON.stringify(second.preprocessChanges.files)}（mtime 变化不算改动，比的是内容指纹）`);
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('S3：未配 stages（legacy）时回执不含阶段字段（向后兼容）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-legacy-nofield-'));
  const repo = makeTempRepo('dshgp-legacy-repo-');
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    process.env.DSH_PREPROCESS_AUDIT_CLI = writeTouchEngine(dir, 'touch.mjs', 'const x = 9;\n');
    const r = await runPreCommitPipeline({
      repoPath: repo,
      cfg: { preCommit: { enabled: true, command: 'node', args: [join(dir, 'touch.mjs')] } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.preprocessStages, undefined, 'legacy 模式不应出现 preprocessStages');
    assert.equal(r.preprocessChanges, undefined, 'legacy 模式不应出现 preprocessChanges');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

/* ───────────────── S3 扩展：阶段环境变量注入 ───────────────── */

/** 造一个"把收到的 PREPROCESS_* 环境变量写进日志"的假实现。 */
function writeEnvProbeEngine(dir, logPath) {
  const file = join(dir, 'env-probe.mjs');
  writeFileSync(file, [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    'const snap = {',
    '  repo: process.env.PREPROCESS_REPO ?? null,',
    '  files: process.env.PREPROCESS_CHANGED_FILES ?? null,',
    '  count: process.env.PREPROCESS_CHANGED_FILES_COUNT ?? null,',
    '  file: process.env.PREPROCESS_CHANGED_FILES_FILE ?? null,',
    '  provider: process.env.PREPROCESS_STAGE_PROVIDER ?? null,',
    // 落盘文件只能**运行时**读：链跑完宿主会清理临时目录（这正是"运行期可用"的契约）
    '  fileContent: (() => { try { return readFileSync(process.env.PREPROCESS_CHANGED_FILES_FILE, "utf8"); } catch { return null; } })(),',
    '};',
    'writeFileSync(' + JSON.stringify(logPath) + ', JSON.stringify(snap));',
    "const out = { ok: true, scope: 'diff', summary: { blocker: 0, warning: 0, notice: 0, total: 0 }, quality: { score: 100, level: 'A' }, findings: [], files: 0 };",
    'process.stdout.write(JSON.stringify(out) + "\\n");',
    'process.exit(0);',
  ].join('\n'));
  return file;
}

test('S3-扩展：阶段环境变量给到实现方（含换行分隔的文件名清单与落盘路径）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-env-'));
  const repo = makeTempRepo('dshgp-env-repo-');
  const logPath = join(dir, 'probe.json');
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    // 造三个"本次改动"：普通名 / 含逗号 / 含空格（这正是选换行分隔的原因）
    writeFileSync(join(repo, 'a.js'), 'const a = 1;\n');
    writeFileSync(join(repo, 'b,c.js'), 'const b = 1;\n');
    writeFileSync(join(repo, 'd e.js'), 'const d = 1;\n');
    process.env.DSH_PREPROCESS_AUDIT_CLI = writeEnvProbeEngine(dir, logPath);
    const r = await runPreCommitPipeline({
      repoPath: repo,
      cfg: { preCommit: { enabled: true, stages: [{ provider: 'audit' }] } },
    });
    assert.equal(r.ok, true);
    const snap = JSON.parse(readFileSync(logPath, 'utf8'));
    assert.equal(snap.repo, repo, 'PREPROCESS_REPO 应是仓库绝对路径');
    assert.equal(snap.provider, 'audit', 'PREPROCESS_STAGE_PROVIDER 应是当前阶段 provider');
    const lines = String(snap.files).split('\n').filter(Boolean);
    assert.equal(snap.count, String(lines.length), 'COUNT 必须与清单行数一致');
    assert.ok(lines.includes('a.js'), `清单应含 a.js，实际 ${JSON.stringify(lines)}`);
    assert.ok(lines.includes('b,c.js'), '含逗号的文件名必须完整保留（不能被当成分隔符切开）');
    assert.ok(lines.includes('d e.js'), '含空格的文件名必须完整保留');
    // 落盘路径与内存里的一致
    assert.ok(snap.file, '应给 PREPROCESS_CHANGED_FILES_FILE');
    assert.deepEqual(String(snap.fileContent || '').split('\n').filter(Boolean), lines,
      '落盘文件内容必须与环境变量一致');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('S3-扩展：未配 stages（legacy）时不注入任何 PREPROCESS_* 变量（老实现零影响）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-env-legacy-'));
  const repo = makeTempRepo('dshgp-env-legacy-repo-');
  const logPath = join(dir, 'probe.json');
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  const prevVars = {};
  for (const key of ['PREPROCESS_REPO', 'PREPROCESS_CHANGED_FILES', 'PREPROCESS_CHANGED_FILES_COUNT',
    'PREPROCESS_CHANGED_FILES_FILE', 'PREPROCESS_STAGE_PROVIDER']) {
    prevVars[key] = process.env[key];
    delete process.env[key];
  }
  try {
    writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
    const rel = writeEnvProbeEngine(dir, logPath);
    await runPreCommitPipeline({ repoPath: repo, cfg: { preCommit: { enabled: true, command: 'node', args: [rel] } } });
    const snap = JSON.parse(readFileSync(logPath, 'utf8'));
    assert.equal(snap.repo, null, 'legacy 模式不该注入 PREPROCESS_REPO');
    assert.equal(snap.files, null, 'legacy 模式不该注入 PREPROCESS_CHANGED_FILES');
    assert.equal(snap.count, null);
    assert.equal(snap.file, null);
    assert.equal(snap.provider, null, 'legacy 模式没有"阶段"概念，不该注入 provider');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    for (const [key, value] of Object.entries(prevVars)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

/* ───────────────── S3+：阶段链可作为调用参数（优先级 > 配置） ───────────────── */

test('S3+：参数里的阶段链覆盖配置，且回执标出 stagesSource=param', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-param-'));
  const repo = makeTempRepo('dshgp-param-repo-');
  const logPath = join(dir, 'probe.json');
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    writeFileSync(join(repo, 'a.js'), 'const a = 3;\n');
    const probe = writeEnvProbeEngine(dir, logPath);
    // 配置里指定的是"审计"，参数里换成"跑这个探针脚本" ⇒ 必须用参数的
    const r = await runPreCommitPipeline({
      repoPath: repo,
      cfg: { preCommit: { enabled: true, stages: [{ provider: 'audit' }] } },
      stages: [{ command: 'node', args: [probe] }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.stagesSource, 'param', '回执必须标明本次链来自调用参数');
    assert.equal(r.preprocessStages.length, 1);
    assert.equal(r.preprocessStages[0].kind, 'command', '参数里的 command 形态要如实标注');
    assert.ok(existsSync(logPath), '参数指定的脚本必须真的被执行了');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('S3+：不传参数 ⇒ 走配置（stagesSource=config）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-param-none-'));
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    process.env.DSH_PREPROCESS_AUDIT_CLI = writeFakeEngine(dir, 'ok.mjs');
    const r = await runPreCommitPipeline({ repoPath: dir, cfg: { preCommit: { enabled: true, stages: [{ provider: 'audit' }] } } });
    assert.equal(r.stagesSource, 'config');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('S3+：参数结构非法 ⇒ fail-closed 且错误指出第几项（不跑任何阶段）', async () => {
  const r = await runPreCommitPipeline({
    repoPath: '/tmp',
    cfg: { preCommit: { enabled: true } },
    stages: [{ onFail: 'warn' }],   // 既无 command 也无 provider
  });
  assert.equal(r.ok, false, '非法参数必须拦');
  assert.match(String(r.error), /第 1 项/, '错误信息要指出是哪一项');
  assert.match(String(r.error), /provider|command/, '错误信息要说清缺什么');
});

test('S3+：参数里混用 {command} 与 {provider} ⇒ 按序执行', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-param-mix-'));
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    process.env.DSH_PREPROCESS_AUDIT_CLI = writeFakeEngine(dir, 'ok.mjs');
    const cmd = writeFakeEngine(dir, 'cmd.mjs');
    const r = await runPreCommitPipeline({
      repoPath: dir,
      cfg: { preCommit: { enabled: true } },
      stages: [{ command: 'node', args: [cmd] }, { provider: 'audit' }],
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.preprocessStages.map((x) => x.kind || 'provider'), ['command', 'provider']);
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('S3+：占位符替换（{repo}/{filesFile}/{filesCount}/{stage}）走 argv 也能拿到', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-placeholder-'));
  const repo = makeTempRepo('dshgp-ph-repo-');
  const outPath = join(dir, 'argv.json');
  const prev = process.env.DSH_PREPROCESS_AUDIT_CLI;
  try {
    writeFileSync(join(repo, 'a.js'), 'const a = 4;\n');
    const script = join(dir, 'argv-probe.mjs');
    writeFileSync(script, [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      'writeFileSync(' + JSON.stringify(outPath) + ', JSON.stringify({',
      '  argv: process.argv.slice(2),',
      '  filesFileContent: (() => { try { return readFileSync(process.argv[3], "utf8"); } catch { return null; } })(),',
      '}));',
      "const out = { ok: true, scope: 'diff', summary: { blocker: 0, warning: 0, notice: 0, total: 0 }, quality: { score: 100, level: 'A' }, findings: [], files: 0 };",
      'process.stdout.write(JSON.stringify(out) + "\\n");',
      'process.exit(0);',
    ].join('\n'));
    const r = await runPreCommitPipeline({
      repoPath: repo,
      cfg: { preCommit: { enabled: true } },
      stages: [{ command: 'node', args: [script, '{repo}', '{filesFile}', '{filesCount}', '{stage}'] }],
    });
    assert.equal(r.ok, true);
    const seen = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(seen.argv[0], repo, '{repo} 应替换成仓库绝对路径');
    assert.equal(seen.argv[2], '1', '{filesCount} 应是本次改动文件数');
    assert.equal(seen.argv[3], '1', '{stage} 应是阶段序号（从 1 起）');
    assert.ok(String(seen.argv[1]).includes('changed-files.txt'), '{filesFile} 应是临时清单文件路径');
    assert.ok(String(seen.filesFileContent || '').includes('a.js'), '该文件内容应是改动清单');
  } finally {
    if (prev === undefined) delete process.env.DSH_PREPROCESS_AUDIT_CLI; else process.env.DSH_PREPROCESS_AUDIT_CLI = prev;
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('S3+：command 单字符串按 shell-like 切词（不启动真 shell，注入不生效）', () => {
  assert.deepEqual(splitCommandLine('node x.mjs --mode staged'), ['node', 'x.mjs', '--mode', 'staged']);
  assert.deepEqual(splitCommandLine('node "a b.js" --x=1'), ['node', 'a b.js', '--x=1']);
  assert.deepEqual(splitCommandLine("node 'a b.js'"), ['node', 'a b.js']);
  // 注入测试：分号/管道/命令替换都只当普通参数，不产生额外命令
  const evil = splitCommandLine('node x.mjs; rm -rf /tmp/should-not-run');
  assert.deepEqual(evil, ['node', 'x.mjs;', 'rm', '-rf', '/tmp/should-not-run'],
    '分号必须留在参数里，不能被当成命令分隔符');
  assert.deepEqual(splitCommandLine('node $(whoami)'), ['node', '$(whoami)'], '命令替换不生效');
});

test('S3+：占位符替换只认已知键，未知原样保留', () => {
  assert.equal(substitutePlaceholders('--repo {repo}', { repo: '/r' }), '--repo /r');
  assert.equal(substitutePlaceholders('{unknown}', { repo: '/r' }), '{unknown}');
  assert.equal(substitutePlaceholders('{filesCount}', { filesCount: '0' }), '0', '0 不能被当成"没给"');
});
