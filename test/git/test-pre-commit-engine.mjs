// 提交前预处理引擎 · 契约测试
//
// 测的是什么（按 docs/2026-11-13-提交前预处理与审计引擎解耦方案.MD §八 验收）：
//   ① 契约退出码 0/1/2 的**分类**必须正确（引擎崩 ≠ 审计不通过，两者不能混）；
//   ② 超时 / 命令不存在 / stdout 不合契约 → 一律 fail-closed（拒绝提交，不许当通过）；
//   ③ 错误信息必须可诊断（含命令、退出码、stderr 尾部），否则用户会卡在「提交不了但不知道为什么」；
//   ④ 参数缺省语义等价于插件默认配置（maxScanFiles 缺省必须走 3000，**不能退化成 0=不限**）；
//   ⑤ **搬迁无行为变化**：引擎子进程的 findings/summary/quality 与进程内 auditWithScope 完全一致；
//   ⑥ git 侧职责没被搬走：示例目录豁免 / 临时豁免 / 私有库豁免仍在 runAudit 里生效。
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
import '../../lib/app/host-doc-checks.js';
import { auditWithScope } from '../../lib/audit/index.js';
import { scoreQuality } from '../../lib/score/index.js';
import { defaultConfig } from '../../lib/client/index.js';
import { Config } from '../../lib/app/schema.js';
import { setSettingsFileOverride } from '../../lib/app/settings-bridge.js';
import { runAudit } from '../../lib/commit-push.js';
import {
  DEFAULT_MAX_SCAN_FILES, EXIT_BLOCKED, EXIT_FAILED, EXIT_OK, parseGateArgs,
} from '../../scripts/audit-gate.mjs';
import {
  PRE_COMMIT_TIMEOUT_MS_DEFAULT,
  buildEngineArgs,
  resolveEngineArgs,
  resolvePreCommitConfig,
  runPreCommitEngine,
} from '../../lib/commit-push/pre-commit-engine.js';

const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GATE_SCRIPT = join(PLUGIN_ROOT, 'scripts', 'audit-gate.mjs');

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
};
// 每个分支都必须自己结束进程：分支之间不能「漏下去」，否则 slow 会走到兜底的 unknown mode
if (MODE === 'ok') { out(base); process.exit(0); }
else if (MODE === 'blocked') {
  out({
    ...base, ok: false,
    summary: { blocker: 1, warning: 0, notice: 0, total: 1 },
    quality: { score: 42, level: 'E' },
    findings: [{ file: 'src/bad.js', line: 1, rule: 'fake/blocker', severity: 'blocker', message: '假引擎拦截' }],
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

// ── 参数解析与缺省语义 ───────────────────────────────────────────────
test('gate 参数缺省语义：maxScanFiles 缺省 = 插件默认 3000（不是 0=不限）', () => {
  const opts = parseGateArgs(['--repo', '/tmp/x']);
  assert.equal(opts.scope, 'diff', 'scope 缺省必须是 diff');
  assert.equal(opts.maxScanFiles, DEFAULT_MAX_SCAN_FILES);
  assert.equal(opts.maxScanFiles, 3000, '数值本身：与插件默认配置一致');
  // 与插件默认配置对齐（改一处漏另一处 → 这条变红）
  assert.equal(defaultConfig().maxScanFiles, DEFAULT_MAX_SCAN_FILES, '引擎默认必须等于插件默认配置的 maxScanFiles');
  // schema 默认值与运行期兜底值必须相等（两处不等会出现「配置显示 10 分钟、实际 5 分钟」）
  assert.deepEqual(Config({}).preCommit, { command: '', args: [], timeoutMs: PRE_COMMIT_TIMEOUT_MS_DEFAULT },
    'preCommit 的 schema 默认必须是「全空 = 内置」且超时与引擎运行期默认一致');
  assert.deepEqual(opts.disabledSlots, [], 'disabledSlots 缺省 = 不禁用任何槽位');
  assert.deepEqual(opts.slots, [], 'slots 缺省 = 不限定规则包');
  assert.equal(opts.blockersOnly, false);
});

test('gate 参数：0 必须原样保留（0 表示不限，不能被 truthy 判断吃掉）', () => {
  const opts = parseGateArgs(['--repo', '/tmp/x', '--max-scan-files', '0']);
  assert.equal(opts.maxScanFiles, 0);
  const argv = buildEngineArgs({ repoPath: '/tmp/x', scope: 'full', maxScanFiles: 0 });
  assert.ok(argv.includes('--max-scan-files'), '显式 0 必须传下去');
  assert.equal(argv[argv.indexOf('--max-scan-files') + 1], '0');
});

test('gate 参数：非法输入一律报错（拼错的参数不能被静默忽略）', () => {
  assert.throws(() => parseGateArgs([]), /缺少必填参数 --repo/);
  assert.throws(() => parseGateArgs(['--repo', '/tmp/x', '--scope', 'changed']), /--scope 只接受 diff\|full/);
  assert.throws(() => parseGateArgs(['--repo', '/tmp/x', '--bogus']), /不认识的参数/);
  assert.throws(() => parseGateArgs(['--repo']), /缺少取值/);
  assert.throws(() => parseGateArgs(['--repo', '/tmp/x', '--weights', '{oops}']), /--weights 不是合法 JSON/);
  assert.throws(() => parseGateArgs(['--repo', '/tmp/x', '--max-scan-files', '-3']), /非负数字/);
});

test('buildEngineArgs：契约参数由模块统一追加，调用方不拼', () => {
  const argv = buildEngineArgs({ repoPath: '/repo', scope: 'full', rulesetDir: '/rs', weights: { 安全性: 100 }, maxScanFiles: 10, slots: ['nodejs'], disabledSlots: ['python'], blockersOnly: true });
  assert.equal(argv[argv.length - 1], '--json', '--json 必须在最后（尾部固定段，任何语言都好解析）');
  assert.equal(argv[argv.indexOf('--repo') + 1], '/repo');
  assert.equal(argv[argv.indexOf('--scope') + 1], 'full');
  assert.equal(argv[argv.indexOf('--ruleset') + 1], '/rs');
  assert.equal(argv[argv.indexOf('--weights') + 1], JSON.stringify({ 安全性: 100 }));
  assert.equal(argv[argv.indexOf('--slots') + 1], 'nodejs');
  assert.equal(argv[argv.indexOf('--disabled-slots') + 1], 'python');
  assert.ok(argv.includes('--blockers-only'));
  // 空值不传（空字符串会被引擎当成一个空槽位名）
  const minimal = buildEngineArgs({ repoPath: '/repo', scope: 'diff' });
  assert.deepEqual(minimal, ['--repo', '/repo', '--scope', 'diff', '--json']);
});

test('args 里的相对路径按插件根解析，不存在的原样保留（不猜）', () => {
  const resolved = resolveEngineArgs(['scripts/audit-gate.mjs', 'not-exist-engine.py', '--timing', '200', '/abs/x.mjs']);
  assert.equal(resolved[0], GATE_SCRIPT, '插件根下的相对路径必须解析成绝对路径（换机不断链）');
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
    // ③ 都没有 → 内置默认（node + 插件自带入口），超时 10 分钟
    const fallback = resolvePreCommitConfig({});
    assert.equal(fallback.source, 'default');
    assert.equal(fallback.command, '', 'command 空 = 内置 node');
    assert.deepEqual(fallback.args, [GATE_SCRIPT], 'args 空 = 插件自带 scripts/audit-gate.mjs');
    assert.equal(fallback.timeoutMs, PRE_COMMIT_TIMEOUT_MS_DEFAULT);
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

// ── 退出码分类（假引擎） ─────────────────────────────────────────────
test('退出码 0 → 放行（ok=true, blocked=false）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-'));
  try {
    const engines = makeFakeEngines(dir);
    const r = await runWithFake(engines, 'ok');
    assert.equal(r.ok, true);
    assert.equal(r.blocked, false);
    assert.deepEqual(r.audit.summary, { blocker: 0, warning: 0, notice: 0, total: 0 });
    assert.equal(r.engine.exitCode, EXIT_OK);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('退出码 1 → 引擎报告有 blocker（blocked=true，但 ok 仍为 true：拦不拦由 git 侧定）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-'));
  try {
    const engines = makeFakeEngines(dir);
    const r = await runWithFake(engines, 'blocked');
    assert.equal(r.ok, true, '退出码 1 不是「引擎失败」');
    assert.equal(r.blocked, true);
    assert.equal(r.audit.summary.blocker, 1);
    assert.equal(r.engine.exitCode, EXIT_BLOCKED);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
test('runAudit：临时豁免仍在 git 侧生效（引擎说 blocker，豁免后放行）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-'));
  try {
    const engines = makeFakeEngines(dir);
    const cfg = { auditEnabled: true, preCommit: { command: process.execPath, args: [engines.blocked] } };
    // 不豁免 → 拦
    const blockedRun = await runAudit({ repoPath: '/tmp', cfg, visibility: 'public' });
    assert.equal(blockedRun.ok, false, '引擎报 blocker 且无豁免 → 必须拦');
    assert.equal(blockedRun.blocked, true);
    assert.match(blockedRun.error, /审计拦截：1 个 blocker/, '拦截文案保持原样（含拦截条数）');
    // 豁免该文件 → 放行，但 summary 不变（豁免不影响评分基数）
    const exemptRun = await runAudit({ repoPath: '/tmp', cfg, visibility: 'public', exemptPaths: ['src/bad.js'], exemptReason: '契约测试' });
    assert.equal(exemptRun.ok, true, '临时豁免必须仍然生效（这条职责留在 git 侧）');
    assert.equal(exemptRun.audit.summary.blocker, 1, '豁免不改 summary（引擎看到的就是 1 条）');
    assert.equal(exemptRun.audit.exempt.count, 1);
    assert.equal(exemptRun.audit.exempt.reason, '契约测试');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runAudit：私有库豁免仍在 git 侧生效（private → 只报告不拦截）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-engine-'));
  try {
    const engines = makeFakeEngines(dir);
    const cfg = { auditEnabled: true, preCommit: { command: process.execPath, args: [engines.blocked] } };
    const r = await runAudit({ repoPath: '/tmp', cfg, visibility: 'private' });
    assert.equal(r.ok, true, '私有库只报告不拦截');
    assert.equal(r.audit.privateExempt.visibility, 'private');
    assert.equal(r.audit.privateExempt.blockedCount, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runAudit：auditEnabled=false 时完全不调引擎（配置写坏也不影响提交）', async () => {
  // command 指向不存在的程序：如果还是去 spawn 了，必然报「找不到引擎命令」
  const r = await runAudit({ repoPath: '/tmp', audit: false, cfg: { preCommit: { command: 'dshgp-no-such-engine-binary-xyz' } } });
  assert.deepEqual(r, { ok: true, audit: null });
});

// ── 搬迁无行为变化（真引擎 vs 进程内，同仓库同一改动） ──────────────
test('真引擎与进程内 auditWithScope 同仓库比对：summary/findings/quality 完全一致', async () => {
  const dir = makeBlockerRepo();
  try {
    const cfg = { ...defaultConfig(), auditScanScope: 'full', preCommit: {} };
    // 通道 A：进程内（改造前的等价调用）
    const inProcess = await auditWithScope(dir, {
      scope: 'full', maxScanFiles: cfg.maxScanFiles, rulesetDir: '', slots: undefined, disabledSlots: [],
    });
    const inProcessQuality = scoreQuality(inProcess.findings, {}, {
      files: inProcess.files, dimFileCounts: inProcess.dimFileCounts, dimRuleCounts: inProcess.dimRuleCounts,
    });
    // 通道 B：子进程引擎 + runAudit（改造后的真实门禁路径）
    const engineRun = await runPreCommitEngine({ repoPath: dir, scope: 'full', maxScanFiles: cfg.maxScanFiles, cfg });
    assert.equal(engineRun.ok, true, `引擎执行失败：${engineRun.error || ''}`);
    const gateQuality = engineRun.audit.quality;

    assert.deepEqual(engineRun.audit.summary, inProcess.summary, 'summary 必须逐项一致');
    assert.equal(engineRun.audit.findings.length, (inProcess.findings || []).length, 'findings 条数必须一致');
    assert.deepEqual(engineRun.audit.findings, inProcess.findings, 'findings 内容必须逐条一致（含 file/rule/severity/message）');
    assert.equal(gateQuality.score, inProcessQuality.score, 'quality.score 必须一致');
    assert.equal(gateQuality.level, inProcessQuality.level, 'quality.level 必须一致');
    assert.equal(engineRun.audit.files, inProcess.files, 'files 必须一致');

    // runAudit 组合层：blocked 列表与拦截语义也要与旧口径一致
    const combined = await runAudit({ repoPath: dir, audit: true, cfg, visibility: 'public' });
    assert.equal(combined.ok, false, '该 fixture 有 blocker，必须拦');
    assert.equal(combined.blocked, true);
    assert.deepEqual(combined.audit.summary, inProcess.summary, 'runAudit 的 summary 必须与进程内一致');
    assert.equal(combined.audit.quality.score, inProcessQuality.score, 'runAudit 的评分必须与进程内一致');
    const expectedBlockers = (inProcess.findings || []).filter((f) => f.severity === 'blocker');
    assert.equal(combined.audit.blocked.length, expectedBlockers.length, '拦截条数必须与进程内 blocker 条数一致');
    assert.equal(combined.audit.engine.exitCode, EXIT_BLOCKED, '引擎退出码应体现「有 blocker」');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('真引擎脚本直跑：退出码 0 / 1 / 2 三种语义', () => {
  // 0：无 blocker（干净仓库，diff 0 变动）
  const cleanDir = mkdtempSync(join(tmpdir(), 'dshgp-engine-cli-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: cleanDir });
    execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: cleanDir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: cleanDir });
    writeFileSync(join(cleanDir, 'a.js'), 'export const a = 1;\n');
    execFileSync('git', ['add', '-A'], { cwd: cleanDir });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: cleanDir });
    const okRun = spawnSync(process.execPath, [GATE_SCRIPT, '--repo', cleanDir, '--scope', 'diff', '--json'], { encoding: 'utf8' });
    assert.equal(okRun.status, EXIT_OK, `干净仓库应退出 0；stderr=${String(okRun.stderr).slice(0, 300)}`);
    const okJson = JSON.parse(okRun.stdout.trim());
    assert.equal(okJson.ok, true);
    assert.equal(okJson.summary.blocker, 0);
    assert.equal(okRun.stdout.trim().split('\n').length, 1, 'stdout 必须只有一行 JSON（不然调用方解析会被噪音打死）');
  } finally { rmSync(cleanDir, { recursive: true, force: true }); }

  // 1：有 blocker
  const blockerDir = makeBlockerRepo();
  try {
    const blockedRun = spawnSync(process.execPath, [GATE_SCRIPT, '--repo', blockerDir, '--scope', 'full', '--json'], { encoding: 'utf8' });
    assert.equal(blockedRun.status, EXIT_BLOCKED, `有 blocker 应退出 1；stderr=${String(blockedRun.stderr).slice(0, 300)}`);
    const blockedJson = JSON.parse(blockedRun.stdout.trim());
    assert.equal(blockedJson.ok, false);
    assert.ok(blockedJson.summary.blocker > 0);

    // --blockers-only：findings 只留 blocker，但 summary 仍是全量计数（评分口径不变）
    const onlyRun = spawnSync(process.execPath, [GATE_SCRIPT, '--repo', blockerDir, '--scope', 'full', '--blockers-only', '--json'], { encoding: 'utf8' });
    const onlyJson = JSON.parse(onlyRun.stdout.trim());
    assert.deepEqual(onlyJson.summary, blockedJson.summary, '--blockers-only 不得改变 summary（只是少传 findings）');
    assert.ok(onlyJson.findings.every((f) => f.severity === 'blocker'), '--blockers-only 下 findings 只应含 blocker');
    assert.deepEqual(onlyJson.quality, blockedJson.quality, '--blockers-only 不得改变评分');
  } finally { rmSync(blockerDir, { recursive: true, force: true }); }

  // 2：参数错
  const badArgs = spawnSync(process.execPath, [GATE_SCRIPT, '--repo', '/tmp', '--scope', 'changed', '--json'], { encoding: 'utf8' });
  assert.equal(badArgs.status, EXIT_FAILED, '参数错必须退出 2');
  assert.match(String(badArgs.stderr), /--scope 只接受 diff\|full/);
  assert.equal(String(badArgs.stdout).trim(), '', '失败时不得往 stdout 写半成品 JSON');
});
