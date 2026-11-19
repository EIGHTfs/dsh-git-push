// 提交范围（精确 paths）测试：预处理只审「这一次要提交的文件」。
//
// 背景：精确 `paths` 提交时，预处理过去照样扫整棵工作树 diff —— 别人正在写的文件一旦触发
//   blocker（实测是 max-function-length），本次提交就被无关文件拦住。并行协作下这等于提不了。
//
// 本文件锁四件事：
//   ① 快照按 paths 过滤，且**目录前缀要展开成实际变动文件**（否则清单里是目录名，实现方对不上）
//   ② 提交范围清单只在**真的带了 paths** 时写；不带 = 一个字节都不多写（其它宿主靠这条不变）
//   ③ 清单内容 = 仓库相对路径、一行一个（实现方按行读）
//   ④ 端到端：paths 外的 blocker 不拦、paths 内的照拦；不给 paths 时行为与改动前一致
//
// 假引擎只实现「读到清单就取交集」这一条契约，用来验证**宿主侧**把范围交对了；
//   真实引擎的对应实现由引擎仓负责（同一个环境变量名 PREPROCESS_ONLY_FILES_FILE）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildStageEnv,
  commitPathMatcher,
  runPreCommitPipeline,
  snapshotWorktree,
} from '../../lib/commit-push/pre-commit-engine.js';
import { setSettingsFileOverride } from '../../lib/app/settings-bridge.js';

/** 造一个临时 git 仓库：base.js 已提交，随后改 inside.js（干净）+ outside.js（会被假引擎判 blocker）。 */
function makeRepoWithOutsideChange() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-scope-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  writeFileSync(join(dir, 'base.js'), 'export const base = 1;\n');
  mkdirSync(join(dir, 'lib', 'app'), { recursive: true });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  writeFileSync(join(dir, 'inside.js'), 'export const inside = 1;\n');
  writeFileSync(join(dir, 'outside.js'), 'export const outside = 1;\n');
  writeFileSync(join(dir, 'lib', 'app', 'nested.js'), 'export const nested = 1;\n');
  return dir;
}

/** 假引擎：实现「读到清单 ⇒ 只审清单内文件；读不到 ⇒ 审全部」。 */
function scopedEngineSource() {
  return `// 假引擎（测试生成，非交付物）：按 PREPROCESS_ONLY_FILES_FILE 缩小审计范围
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const repoArg = process.argv.indexOf('--repo');
const repo = repoArg >= 0 ? process.argv[repoArg + 1] : '.';
const listFile = process.env.PREPROCESS_ONLY_FILES_FILE || '';
const scoped = listFile && existsSync(listFile)
  ? readFileSync(listFile, 'utf8').split('\\n').map((one) => one.trim()).filter(Boolean)
  : null;
// 「本次要审的文件」= 清单（有就取交集）与否（老行为：仓库里所有变动文件）
const candidates = scoped || ['inside.js', 'outside.js', 'lib/app/nested.js'];
const bad = candidates.filter((one) => one === 'outside.js');
const blocked = bad.map((file) => ({ file, line: 1, rule: 'fake/blocker', message: '外侧文件的 blocker' }));
process.stdout.write(JSON.stringify({
  ok: blocked.length === 0, scope: 'diff',
  summary: { blocker: blocked.length, warning: 0, notice: 0, total: blocked.length },
  quality: { score: 100, level: 'A' }, findings: blocked, blocked, files: candidates.length,
}) + '\\n');
process.exit(blocked.length ? 1 : 0);
`;
}

/** 用假引擎跑一次流水线（command = 当前 node，args 指向假引擎脚本）。 */
function runPipeline(repoPath, engineFile, over = {}) {
  return runPreCommitPipeline({
    repoPath,
    scope: 'diff',
    cfg: { preCommit: { command: process.execPath, args: [engineFile] } },
    ...over,
  });
}

// 隔离插件配置：resolvePreCommitConfig / resolveStages 会读 config.json，
//   不隔离就会读宿主真实配置（本机开着别的门禁 ⇒ 断言随环境变）。
//   必须 await 回调：回调是异步的，同步 finally 会在 await 之前就把 override 清掉。
async function withIsolatedSettings(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-scope-cfg-'));
  setSettingsFileOverride(join(dir, 'config.json'));
  try {
    return await callback();
  } finally {
    setSettingsFileOverride(null);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('commitPathMatcher：精确文件与目录前缀都算「在范围内」，空值 = 不限制', () => {
  assert.equal(commitPathMatcher(''), null, '空字符串 ⇒ 不限制（git add -A 语义）');
  assert.equal(commitPathMatcher([]), null);
  const exact = commitPathMatcher('lib/app/a.js');
  assert.equal(exact('lib/app/a.js'), true);
  assert.equal(exact('lib/app/b.js'), false, '同目录其它文件不在范围内');
  const dir = commitPathMatcher('lib/app/');
  assert.equal(dir('lib/app/a.js'), true, '目录前缀必须命中目录内文件（展开后的实际文件）');
  assert.equal(dir('lib/apps/a.js'), false, '前缀不能跨目录误匹配（lib/app vs lib/apps）');
});

test('snapshotWorktree：给了 paths 只拍这些文件；目录前缀展开为实际文件', () => {
  const repo = makeRepoWithOutsideChange();
  try {
    const all = snapshotWorktree(repo);
    assert.ok(all.files.has('inside.js') && all.files.has('outside.js'), '不限制时应拍到全部变动文件');

    const scoped = snapshotWorktree(repo, { paths: 'inside.js' });
    assert.deepEqual([...scoped.files.keys()], ['inside.js'], '精确文件 ⇒ 只剩它');
    assert.ok(!scoped.files.has('outside.js'), 'paths 外的文件不得进快照（否则下游还会审它）');

    const byDir = snapshotWorktree(repo, { paths: 'lib/app/' });
    assert.deepEqual([...byDir.files.keys()], ['lib/app/nested.js'], '目录前缀要展开成目录内的实际文件');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('buildStageEnv：只在给了提交范围时写 PREPROCESS_ONLY_FILES_FILE（一行一个相对路径）', () => {
  const envDir = mkdtempSync(join(tmpdir(), 'dshgp-scope-env-'));
  try {
    const plain = buildStageEnv({ repoPath: '/r', provider: 'audit', changed: ['a.js', 'b.js'], envDir });
    assert.equal(plain.env.PREPROCESS_ONLY_FILES_FILE, undefined, '没给范围 ⇒ 一个字节都不多写（其它宿主靠这条不变）');

    const scoped = buildStageEnv({ repoPath: '/r', provider: 'audit', changed: ['a.js', 'b.js'], onlyFiles: ['a.js'], envDir });
    assert.ok(scoped.env.PREPROCESS_ONLY_FILES_FILE, '给了范围 ⇒ 必须写出清单文件路径');
    assert.equal(readFileSync(scoped.env.PREPROCESS_ONLY_FILES_FILE, 'utf8'), 'a.js', '内容 = 仓库相对路径、每行一个');
    assert.equal(scoped.env.PREPROCESS_CHANGED_FILES_COUNT, '2', '改动清单本身不受影响（两份清单语义不同）');

    const empty = buildStageEnv({ repoPath: '/r', changed: ['a.js'], onlyFiles: [], envDir });
    assert.equal(empty.env.PREPROCESS_ONLY_FILES_FILE, undefined, '空范围视同未给（不给假绿灯）');
  } finally { rmSync(envDir, { recursive: true, force: true }); }
});

test('流水线：paths 外有 blocker 不拦、paths 内照拦；不给 paths 时仍拦（行为不变）', async () => {
  const repo = makeRepoWithOutsideChange();
  const engineDir = mkdtempSync(join(tmpdir(), 'dshgp-scope-engine-'));
  const engineFile = join(engineDir, 'scoped-engine.mjs');
  writeFileSync(engineFile, scopedEngineSource());
  try {
    await withIsolatedSettings(async () => {
      // 不给 paths：老行为 —— 外侧文件的 blocker 拦住本次提交
      const legacy = await runPipeline(repo, engineFile);
      assert.equal(legacy.ok, true);
      assert.equal(legacy.blocked, true, '没给 paths 时，工作树里的 blocker 必须照拦');

      // 给 paths（只要 inside.js）：只审它 ⇒ 不被外侧 blocker 拦住
      const scoped = await runPipeline(repo, engineFile, { paths: 'inside.js' });
      assert.equal(scoped.ok, true);
      assert.equal(scoped.blocked, false, 'paths 外的 blocker 不得再拦住本次提交');
      assert.equal(scoped.audit?.blocked?.length, 0, '拦截清单应为空');

      // 给 paths 且它自己就是那个有问题的文件 ⇒ 照拦
      const hit = await runPipeline(repo, engineFile, { paths: 'outside.js' });
      assert.equal(hit.blocked, true, 'paths 内的 blocker 必须照拦（范围缩小 ≠ 放松门禁）');
      assert.equal(hit.audit?.blocked?.[0]?.file, 'outside.js');
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(engineDir, { recursive: true, force: true });
  }
});
