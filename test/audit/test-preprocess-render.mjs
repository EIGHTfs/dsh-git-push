/**
 * 预处理「结果文案」契约（方案 2：审计方注册 renderResult）。
 *
 * 为什么单独一个测试文件：这次改动把**文案**从 git 侧搬到预处理侧，属于「同一事实两处表达」的高危改动——
 * 文案容易在搬动中悄悄漂移，而漂移不会让任何现有断言变红（它们只查 ok/blocked）。
 * 三条硬要求在这里钉死：
 *   ① 预处理提供 renderResult ⇒ 文案来自它（含审计特有措辞）；
 *   ② 预处理**不提供**（或渲染抛错）⇒ 走 git 侧中性兜底，**不崩、不静默丢信息**；
 *   ③ `blocked` 布尔与 job 状态分叉（被拦截 ≠ 执行失败）不受影响。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditPreprocess, auditRenderResult } from '../../lib/preprocess/audit.js';
import { preprocessParams, renderPreprocessResult } from '../../lib/preprocess/index.js';
import { defaultPreprocessRender, runAudit } from '../../lib/commit-push.js';
import { pushJobOutcome } from '../../lib/app/tool-call.js';
import { defaultConfig } from '../../lib/client/index.js';

/** 造一个必中 blocker 的临时仓库（触发词单字拼接，避免本文件自身命中规则）。 */
function makeBlockerRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-render-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'base.js'), 'export const base = 1;\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  const trigger = `${['用', '户', '原', '话'].join('')}：渲染契约测试用命中`;
  writeFileSync(join(dir, 'src', 'bad.js'), `// ${trigger}\nexport const bad = 1;\n`);
  return dir;
}

const CTX = {
  repoPath: '/repo/demo',
  audit: {
    summary: { blocker: 1, warning: 0, notice: 0, total: 1 },
    quality: { score: 88.5, level: 'B' },
    findings: [{ file: 'a.js', line: 3, rule: 'demo/rule', severity: 'blocker', message: '示例' }],
    scope: 'diff',
    files: 2,
  },
  blocked: [{ file: 'a.js', line: 3, rule: 'demo/rule', message: '示例' }],
};

test('① 预处理提供 renderResult ⇒ 文案来自它（审计特有措辞 + 新前缀查询指引）', () => {
  const rendered = renderPreprocessResult(CTX, {});
  assert.ok(rendered, '可用预处理应产出渲染结果');
  // 拦截文案逐字沿用历史格式（「N 个 blocker → 位置（规则）」）
  assert.match(rendered.error, /^审计拦截：1 个 blocker → /, `拦截文案应来自审计预处理：${rendered.error}`);
  assert.match(rendered.error, /a\.js:3（demo\/rule）/, '逐条位置与规则必须可读');
  // 查询指引：指向分侧后的审计前缀（若 git 侧还硬编码老路径，这里会红）
  assert.match(rendered.apiGuide, /\/api\/git-audit\/audit/, `apiGuide 应来自审计预处理且指向新前缀：${rendered.apiGuide.split('\n')[0]}`);
  // 回显 note：两段都提供
  assert.match(rendered.notes.exempt, /评分仍按全量 findings 计算/);
  assert.match(rendered.notes.privateExempt, /private-repo-report-only/);
});

test('② 预处理不提供 renderResult（或渲染抛错）⇒ 中性兜底，不崩、不丢信息', () => {
  // 不提供：registry 返回 undefined，由 git 侧兜底
  assert.equal(renderPreprocessResult(CTX, {}, []), undefined, '无预处理时应返回 undefined（交给兜底）');
  assert.equal(renderPreprocessResult(CTX, {}, [{ id: 'x', enabled: () => true }]), undefined, '有预处理但没实现 renderResult 时同样返回 undefined');
  // 渲染抛错：必须被吞掉，不把提交门禁带崩
  const throwing = renderPreprocessResult(CTX, {}, [{ id: 'boom', enabled: () => true, renderResult: () => { throw new Error('render boom'); } }]);
  assert.equal(throwing, undefined, 'renderResult 抛错应被吞掉并退回兜底');
  // 兜底文案：中性（不含审计措辞），但 blocker 位置仍要能读
  const fallback = defaultPreprocessRender(CTX);
  assert.match(fallback.error, /^提交前检查拦截：1 项 → /, `兜底文案应为中性表述：${fallback.error}`);
  assert.doesNotMatch(fallback.error, /审计拦截/, '兜底文案不得写死审计措辞（那属预处理语义）');
  assert.match(fallback.error, /a\.js:3（demo\/rule）/, '兜底也要说清是哪几处');
  assert.equal(fallback.apiGuide, '', '兜底不编造查询指引');
  // 无 blocker 时不给拦截文案（放行场景不该出现「拦截」字样）
  assert.equal(defaultPreprocessRender({ blocked: [] }).error, undefined);
  assert.equal(auditRenderResult({ blocked: [] }).error, undefined);
});

test('② 端到端：默认配置下 runAudit 的文案仍来自审计预处理（apiGuide 已换新前缀）', async () => {
  const dir = makeBlockerRepo();
  try {
    const cfg = { ...defaultConfig(), auditScanScope: 'full', preCommit: {} };
    const r = await runAudit({ repoPath: dir, audit: true, cfg, visibility: 'public' });
    assert.equal(r.ok, false, '有 blocker 必须拦');
    assert.equal(r.blocked, true);
    assert.match(String(r.error), /审计拦截：\d+ 个 blocker → /, `拦截文案应来自 renderResult：${r.error}`);
    assert.match(String(r.audit.apiGuide), /\/api\/git-audit\/audit/, 'apiGuide 应指向分侧后的审计前缀');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('③ 回归：blocked 布尔与 job 状态分叉不受影响（被拦截 ≠ 执行失败）', async () => {
  // 布尔本身：审计拦截 = true
  const dir = makeBlockerRepo();
  try {
    const cfg = { ...defaultConfig(), auditScanScope: 'full', preCommit: {} };
    const blockedRun = await runAudit({ repoPath: dir, audit: true, cfg, visibility: 'public' });
    assert.equal(blockedRun.blocked, true, '审计拦截必须带 blocked:true');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // job 状态分叉：blocked:true → 「未推送（被拦截）」；blocked:false → 「未完成」
  const intercepted = pushJobOutcome({ ok: false, blocked: true, error: '审计拦截：1 个 blocker → x' });
  assert.equal(intercepted.status, 'failed');
  assert.match(intercepted.detail, /^未推送（被拦截）：/, `被拦截应走这个分叉：${intercepted.detail}`);
  const failed = pushJobOutcome({ ok: false, blocked: false, error: '引擎找不到' });
  assert.equal(failed.status, 'failed');
  assert.match(failed.detail, /^未完成：/, `执行失败应走这个分叉：${failed.detail}`);
});

test('参数能力与渲染能力同处一处：auditPreprocess 暴露三项（params / enabled / renderResult）', () => {
  assert.equal(auditPreprocess.id, 'audit');
  assert.equal(typeof auditPreprocess.enabled, 'function');
  assert.equal(typeof auditPreprocess.renderResult, 'function');
  assert.ok(Array.isArray(auditPreprocess.params) && auditPreprocess.params.length === 3, '审计贡献 3 个参数');
  // 可用性判据：内置引擎在 ⇒ 参数在；不在 ⇒ 参数消失（与「参数动态注册」同口径）
  assert.equal(preprocessParams({}, true).length, 3);
  assert.equal(preprocessParams({}, false).length, 0);
});
