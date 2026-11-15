/**
 * 引擎适配器 + 中间层统一入口（批 3）。
 *
 * 本文件守住三件事，缺一件这批就等于没做：
 *   ① **端到端逐字一致**：同一棵树，老口径（直接 auditWithScope + score）与
 *      新入口（runGateAudit → runPreprocess → adapter → 豁免编排 → score）的
 *      `ok / scope / summary / quality / files / findings` 必须完全相同；
 *   ② **适配器接口真能插**：mock 第三方引擎按契约实现（`id / supportsSuppressed / declaredSuppressed / run`）
 *      就能接进中间层，不需要改中间层任何代码；
 *   ③ **豁免编排不是死代码**：mock 引擎声明的 suppressed / 源码里的第三方标记
 *      经 `runPreprocess` 真的会让 finding 变成 `exempted`（而不是"函数写好了没人调"）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { builtinAdapter, getAdapter } from '../../lib/preprocess/adapters/builtin.js';
import { runPreprocess } from '../../lib/preprocess/index.js';
import { score } from '../../lib/preprocess/score.js';
import { getBuiltinScoreSpec } from '../../lib/audit/score-spec.js';
import { auditWithScope } from '../../lib/audit/orchestrate.js';
import { runGateAudit } from '../../scripts/audit-gate.mjs';
import { runAudit } from '../../lib/commit-push.js';
import { defaultConfig } from '../../lib/client/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 造一个含若干真问题的临时 git 仓库（内容确定 ⇒ 前后对比才有意义）。 */
function makeViolationRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-adapter-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# demo\n');
  writeFileSync(join(dir, 'src', 'app.js'), [
    'export function run() {',
    '  console.log("调试输出");',
    '  return 1;',
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'src', 'config.js'), [
    `export const logPath = '/tmp/app.log';`,
    'export const port = 3080;',
    '',
  ].join('\n'));
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  // 留一个**未提交**的违规文件：diff 口径（auditScanScope=diff）才有东西可审，
  //   否则 clean 仓库的 diff 审计恒为空、对比测试变成「两边都是空」的假通过。
  writeFileSync(join(dir, 'src', 'dirty.js'), ['export function dirty() {', '  console.log("未提交的调试输出");', '  return 2;', '}', ''].join('\n'));
  return dir;
}

test('② 适配器接口契约：内置适配器符合统一形态，第三方照此实现即可插入', async () => {
  assert.equal(builtinAdapter.id, 'builtin');
  assert.equal(typeof builtinAdapter.run, 'function');
  assert.equal(typeof builtinAdapter.supportsSuppressed, 'boolean', 'supportsSuppressed 是第三方必填声明位');
  // 内置引擎不自报豁免（它的豁免在逐文件审计时就按真实正文判过了）
  assert.deepEqual(builtinAdapter.declaredSuppressed({}), []);
  assert.equal(getAdapter().id, 'builtin', '不传 id 默认内置');
  assert.equal(getAdapter('builtin').id, 'builtin');
  // 未知引擎必须硬报错（不能静默退回内置：那会让人以为在跑别的引擎）
  assert.throws(() => getAdapter('semgrep-typo'), /未知审计引擎适配器/);

  const dir = makeViolationRepo();
  try {
    const result = await builtinAdapter.run(dir, { scope: 'full', maxScanFiles: 40 });
    assert.ok(Array.isArray(result.findings), 'run() 必须返回 findings 数组');
    assert.equal(typeof result.files, 'number');
    assert.ok(Array.isArray(result.scoreSpec?.dims) && result.scoreSpec.dims.length, 'run() 必须带 scoreSpec（引擎只声明、不算分）');
    assert.deepEqual(result.scoreSpec.dims, getBuiltinScoreSpec().dims, '内置适配器的 scoreSpec 来自 lib/audit/score-spec.js');
    assert.ok(result.audit && typeof result.audit === 'object', '透传引擎原始结果（summary/dim*Counts 等）供中间层算分');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('③ 豁免编排接通：mock 第三方引擎「声明式豁免」经 runPreprocess 真的生效', async () => {
  const mockAdapter = {
    id: 'mock-eslint',
    supportsSuppressed: true,
    declaredSuppressed: () => [{ file: 'src/a.js', line: 3, rule: 'residue/no-console-log' }],
    async run() {
      return {
        files: 2,
        scoreSpec: getBuiltinScoreSpec(),
        findings: [
          { file: 'src/a.js', line: 3, rule: 'residue/no-console-log', kind: 'regex', severity: 'warning', message: '别打日志', dimensions: ['可读性'] },
          { file: 'src/b.js', line: 9, rule: 'residue/no-console-log', kind: 'regex', severity: 'warning', message: '这条没声明豁免', dimensions: ['可读性'] },
        ],
      };
    },
  };
  const pre = await runPreprocess('/tmp/whatever', { adapter: mockAdapter });
  assert.equal(pre.adapter, 'mock-eslint');
  assert.equal(pre.exemptions.declared, 1, '应采信引擎自报的 1 条声明');
  assert.equal(pre.findings[0].exempted, true, '声明式豁免命中的 finding 必须被标注');
  assert.equal(pre.findings[0].exemptReason, 'mock-eslint:declared');
  assert.equal(pre.findings[1].exempted, undefined, '未声明的同规则 finding 不得被连带豁免');
  assert.equal(pre.exemptions.total, 1);

  // 中间层算分时跳过被豁免项（这是豁免「真的生效」的最终证据）
  const withExemption = score(pre.findings, pre.scoreSpec, {}, { files: pre.files });
  const withoutExemption = score(pre.findings.map((finding) => ({ ...finding, exempted: false })), pre.scoreSpec, {}, { files: pre.files });
  assert.notEqual(withExemption.score, withoutExemption.score, '豁免是否生效必须体现在分数上（否则等于没接）');
});

test('③ 豁免编排接通：mock 第三方引擎的源码标记（读取式兜底）也经 runPreprocess 生效', async () => {
  const mockAdapter = {
    id: 'mock-semgrep',
    supportsSuppressed: false, // 不支持声明式 ⇒ 必须走中间层的读取式
    sourceMarkers: ['nosemgrep'], // 引擎声明自己认哪些源码标记（中间层按此扫）
    async run() {
      return {
        files: 1,
        scoreSpec: getBuiltinScoreSpec(),
        findings: [
          { file: 'src/a.js', line: 2, rule: 'semgrep/x', kind: 'regex', severity: 'warning', message: '标注了的' },
          { file: 'src/a.js', line: 3, rule: 'semgrep/x', kind: 'regex', severity: 'warning', message: '没标注的' },
        ],
      };
    },
  };
  const sources = { 'src/a.js': 'const a = 1;\nconst b = 2; // nosemgrep\nconst c = 3;\n' };
  const pre = await runPreprocess('/tmp/whatever', { adapter: mockAdapter, textOf: (file) => sources[file] });
  assert.equal(pre.findings[0].exempted, true, '本行 nosemgrep ⇒ 豁免');
  assert.equal(pre.findings[0].exemptReason, 'mock-semgrep:marker');
  assert.equal(pre.findings[1].exempted, undefined, '相邻行不得被连带豁免');
});

test('① 端到端逐字一致：同树老口径（auditWithScope+score）vs 新入口（runGateAudit）', async () => {
  const dir = makeViolationRepo();
  try {
    for (const scope of ['full', 'diff']) {
      const opts = { scope, maxScanFiles: 60, rulesetDir: '', slots: undefined, disabledSlots: [] };
      // 老口径：批 3 之前 audit-gate 的两行（直接调审计内核 + 直接算分）
      const raw = await auditWithScope(dir, opts);
      const legacyQuality = score(raw.findings, getBuiltinScoreSpec(), {}, {
        files: raw.files, dimFileCounts: raw.dimFileCounts, dimRuleCounts: raw.dimRuleCounts,
      });
      const legacyView = { ok: (raw.summary?.blocker ?? 0) === 0, scope: raw.scope, summary: raw.summary, quality: legacyQuality, files: raw.files, findings: raw.findings };

      // 新口径：runPreprocess → adapter → 豁免编排 → score
      const next = await runGateAudit({ repo: dir, scope, rulesetDir: '', weights: {}, maxScanFiles: 60, disabledSlots: [], slots: [], blockersOnly: false, json: true });
      const nextView = { ok: next.ok, scope: next.scope, summary: next.summary, quality: next.quality, files: next.files, findings: next.findings };

      for (const key of ['ok', 'scope', 'summary', 'quality', 'files', 'findings']) {
        assert.deepEqual(nextView[key], legacyView[key], `${scope} 口径下 ${key} 必须逐字一致`);
      }
      assert.ok(next.findings.length > 0, `${scope} 样本应至少产出一条 finding（否则对比没意义）`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('① 提交门禁完整返回不变：runAudit 的 blocked / summary / quality / apiGuide / notes 仍齐全且口径不变', async () => {
  const dir = makeViolationRepo();
  try {
    const cfg = { ...defaultConfig(), auditScanScope: 'full', preCommit: {} };
    const blockedRun = await runAudit({ repoPath: dir, audit: true, cfg, visibility: 'public', exemptPaths: ['README.md'], exemptReason: '样本' });
    assert.equal(blockedRun.blocked, true, '有 blocker 必须 blocked:true');
    assert.equal(blockedRun.ok, false);
    assert.match(String(blockedRun.error), /^审计拦截：\d+ 个 blocker → /, `拦截文案仍由预处理渲染：${String(blockedRun.error).slice(0, 80)}`);
    assert.ok(blockedRun.audit.summary && typeof blockedRun.audit.summary.blocker === 'number', 'summary 必须在');
    assert.equal(typeof blockedRun.audit.quality.score, 'number', 'quality 必须在');
    assert.match(String(blockedRun.audit.apiGuide), /\/api\/git-audit\/audit/, 'apiGuide 必须指向审计侧前缀');
    assert.match(String(blockedRun.audit.exempt?.note), /临时豁免/, 'exempt note 必须由预处理渲染提供');

    // 私有库：只报告不拦截（blocked 布尔留在 git 侧，语义分叉不受适配器影响）
    const privateRun = await runAudit({ repoPath: dir, audit: true, cfg, visibility: 'private' });
    assert.equal(privateRun.ok, true, '私有库只报告不拦截');
    assert.match(String(privateRun.audit.privateExempt?.note), /private-repo-report-only/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('③ 接线是真的：runPreprocess 出现在引擎入口的主流程里（不是只导出没人调）', () => {
  const gateSource = readFileSync(join(ROOT, 'scripts', 'audit-gate.mjs'), 'utf8');
  assert.match(gateSource, /import \{ runPreprocess \} from '\.\.\/lib\/preprocess\/index\.js'/, '引擎入口必须 import 中间层统一入口');
  assert.match(gateSource, /await runPreprocess\(/, '引擎入口必须真的调用 runPreprocess');
  assert.doesNotMatch(gateSource, /await auditWithScope\(/, '引擎入口不得再直接调审计内核（否则适配器被绕过）');
  // 豁免编排在 runPreprocess 内部被调用 ⇒ 调用链 commit-push → pre-commit-engine → audit-gate → runPreprocess → resolveExemptions
  const preSource = readFileSync(join(ROOT, 'lib', 'preprocess', 'index.js'), 'utf8');
  assert.match(preSource, /resolveExemptions\(rawFindings/, 'runPreprocess 内必须对引擎 findings 施加豁免编排');
});
