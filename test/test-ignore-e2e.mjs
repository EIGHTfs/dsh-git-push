/**
 * 忽略规则端到端回归（.gitignore + .auditignore）。
 *
 * 为什么单独一个文件、且必须跑**端到端**（auditFull / runAudit）：
 *   历史上这块反复回归过多次，而每一次都不是判定逻辑写错，而是**接线层**断掉——
 *     ① 1.0.4：以空 stdin 调 check-ignore，从未传文件路径 ⇒ 忽略集恒空；
 *     ② 大仓库降级：枚举全部文件喂 check-ignore 被改成目录级判定时漏了文件级兜底；
 *     ③ 调用方漏传 `gitIgnoreRoot`（collectTextFiles 的默认值是 null = 不判定忽略），
 *        函数本身完好、忽略却完全不生效。
 *   这三种用「只测 collectTextFiles 内部」的用例都测不出来——既有 test-collector-ignore /
 *   test-auditignore 恰好都只测内部函数。所以本文件从**真实审计入口**跑，守的是那条链：
 *   orchestrate 传参 → collector 建忽略集 → 规则判定 → findings。
 *
 * 样本为什么入库（而不是测试里现造）：
 *   临时拼的样本会随实现漂移、也容易被后人改坏；固定 fixture 让「什么叫被忽略」有唯一答案。
 *   样本文件用 `.js.fixture` / `.rules` 后缀：若直接叫 `gib.js` + 同目录 `.gitignore`，
 *   这两份样本自己就会被忽略而无法入库（自我反噬）。
 *
 * 三条链路各一个用例 + 一个对照组断言（keep.js 必须被报）——
 * 没有对照组时，「全部文件都被排除」也会让前三条假通过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { auditFull } from '../lib/audit/orchestrate.js';
import { runAudit } from '../lib/commit-push.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test/fixtures/ignore-e2e');
const SAMPLES = ['keep', 'gib', 'aud'];

/** 把入库样本铺成一个真实仓库；git=false 时只放文件（用于非 git 目录兜底链路）。 */
function setupRepo({ git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ignore-e2e-'));
  for (const n of SAMPLES) copyFileSync(join(FIX, `${n}.js.fixture`), join(dir, `${n}.js`));
  copyFileSync(join(FIX, 'gitignore.rules'), join(dir, '.gitignore'));
  copyFileSync(join(FIX, 'auditignore.rules'), join(dir, '.auditignore'));
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 't@example.invalid'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir, stdio: 'ignore' });
  }
  return dir;
}

/** findings 涉及的文件名集合（去目录、去重、排序）。 */
const hitNames = (findings) => [...new Set((findings || []).map((f) => String(f.file || '').replace(/^.*\//, '')))].sort();

test('full 端到端：.gitignore 与 .auditignore 都被遵守，对照组仍被审到', async () => {
  const dir = setupRepo();
  try {
    const r = await auditFull(dir, { scope: 'full', maxScanFiles: 50 });
    const hit = hitNames(r.findings);
    // 对照组：该被审的必须被审到（否则下面两条「没出现」可能只是全军覆没的假通过）
    assert.ok(hit.includes('keep.js'), `对照组 keep.js 必须被审计到，实际命中：${JSON.stringify(hit)}`);
    assert.ok(!hit.includes('gib.js'), `.gitignore 里的 gib.js 不得进审计范围，实际：${JSON.stringify(hit)}`);
    assert.ok(!hit.includes('aud.js'), `.auditignore 里的 aud.js 不得进审计范围，实际：${JSON.stringify(hit)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('diff 端到端：改动被忽略的文件也不进变动审计范围', async () => {
  const dir = setupRepo();
  try {
    // 三个文件都改动 —— 变动审计最容易漏掉忽略判定（历史回归点之一）
    for (const n of SAMPLES) appendFileSync(join(dir, `${n}.js`), '\n// touched\n');
    const r = await runAudit({ repoPath: dir, cfg: { auditEnabled: true, auditScanScope: 'diff', auditLevel: 'standard' } });
    const blocked = [...new Set((r.audit?.blocked || []).map((b) => String(b.file || '').replace(/^.*\//, '')))].sort();
    assert.ok(blocked.includes('keep.js'), `对照组的改动必须被拦下，实际 blocked：${JSON.stringify(blocked)}`);
    assert.ok(!blocked.includes('gib.js'), `.gitignore 文件的改动不得被拦，实际：${JSON.stringify(blocked)}`);
    assert.ok(!blocked.includes('aud.js'), `.auditignore 文件的改动不得被拦，实际：${JSON.stringify(blocked)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('非 git 目录：仅靠 .gitignore/.auditignore 文本也生效（不依赖 git check-ignore）', async () => {
  // 没有 .git 时 git check-ignore 不可用，必须由 parseGitignore 的纯 JS 兜底接管。
  // 历史上「这类目录的 .gitignore 被完全无视」是一个审计范围 bug，故单列一条。
  const dir = setupRepo({ git: false });
  try {
    const r = await auditFull(dir, { scope: 'full', maxScanFiles: 50 });
    const hit = hitNames(r.findings);
    assert.ok(hit.includes('keep.js'), `对照组 keep.js 必须被审计到，实际：${JSON.stringify(hit)}`);
    assert.ok(!hit.includes('gib.js'), `非 git 目录的 .gitignore 也必须生效，实际：${JSON.stringify(hit)}`);
    assert.ok(!hit.includes('aud.js'), `非 git 目录的 .auditignore 也必须生效，实际：${JSON.stringify(hit)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
