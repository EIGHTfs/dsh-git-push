/**
 * 采集快路径（git ls-files）测试（2026-11-01）。
 *
 * 背景：CIFS/SMB 挂载上，一次 diff 审计卡 9 分钟不返回且看不到 git 子进程。
 *   实测定位：同一仓库 231 个文本文件，readdir+stat 递归 **103.8s**（sys 29s，
 *   全是跨网 stat），而 `git ls-files` 列 733 个路径只要 **0.046s**。
 *
 * 快路径必须与原遍历**语义一致**（本测试就是锁这个）：
 *   · 已跟踪 + 未跟踪未被忽略的文本文件都要收；
 *   · .gitignore 忽略的**不收**（顺带修掉旧遍历的一个漏判：文件级 ignore 规则命中时
 *     旧路径曾把 `web-install/install-config.json` 这类文件误收进来）；
 *   · 非 git 目录仍走原遍历（不能因为快路径存在就丢掉兜底）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { collectTextFiles } from '../lib/audit/collector.js';

async function withGitRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-fastpath-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  // 必须 await：否则 finally 会在异步用例跑完**之前**就把临时仓库删掉（用例拿到空结果）
  try { return await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

const pathsOf = (files) => files.map((f) => f.path).sort();

test('快路径：已跟踪 + 未跟踪未忽略都收，忽略的不收', async () => withGitRepo(async (root) => {
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'src', 'tracked.js'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src', 'untracked.js'), 'export const b = 2;\n');
  writeFileSync(join(root, 'dist', 'built.js'), '// 构建产物\n');
  writeFileSync(join(root, 'secret.json'), '{}\n');
  writeFileSync(join(root, '.gitignore'), 'dist/\nsecret.json\n');
  execFileSync('git', ['add', 'src/tracked.js', '.gitignore'], { cwd: root });
  const files = await collectTextFiles(root, { gitIgnoreRoot: root });
  const paths = pathsOf(files);
  assert.ok(paths.includes('src/tracked.js'), '已跟踪的在');
  assert.ok(paths.includes('src/untracked.js'), '未跟踪未被忽略的也在');
  assert.ok(!paths.includes('dist/built.js'), '被忽略的目录不收');
  assert.ok(!paths.includes('secret.json'), '被忽略的文件不收');
  assert.ok(!paths.includes('.gitignore') || true); // .gitignore 本身是否收由扩展名白名单决定，不做断言
}));

test('快路径与旧遍历结果一致（同一仓库两种路径对比）', async () => withGitRepo(async (root) => {
  mkdirSync(join(root, 'a'), { recursive: true });
  writeFileSync(join(root, 'a', 'x.js'), 'const x = 1;\n');
  writeFileSync(join(root, 'a', 'y.md'), '# y\n');
  writeFileSync(join(root, 'a', 'z.png'), 'binary');
  writeFileSync(join(root, 'a', '.hidden.js'), '// hidden\n');
  execFileSync('git', ['add', 'a/x.js', 'a/y.md'], { cwd: root });

  const fast = pathsOf(await collectTextFiles(root, { gitIgnoreRoot: root }));
  const prev = process.env.DSH_AUDIT_NO_GIT_FASTPATH;
  process.env.DSH_AUDIT_NO_GIT_FASTPATH = '1';
  let slow;
  try {
    slow = pathsOf(await collectTextFiles(root, { gitIgnoreRoot: root }));
  } finally {
    if (prev === undefined) delete process.env.DSH_AUDIT_NO_GIT_FASTPATH;
    else process.env.DSH_AUDIT_NO_GIT_FASTPATH = prev;
  }
  assert.deepEqual(fast, slow, '两条路径的收集结果必须完全一致');
}));

test('非 git 目录：仍走原遍历，不因快路径而漏文件', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-nogit-'));
  try {
    writeFileSync(join(root, 'a.js'), 'const a = 1;\n');
    const files = await collectTextFiles(root);
    assert.deepEqual(pathsOf(files), ['a.js']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('快路径不破坏 .auditignore（整文件豁免仍然生效）', async () => withGitRepo(async (root) => {
  writeFileSync(join(root, 'keep.js'), 'const k = 1;\n');
  writeFileSync(join(root, 'drop.js'), 'const d = 1;\n');
  writeFileSync(join(root, '.auditignore'), 'drop.js\n');
  const files = await collectTextFiles(root, { gitIgnoreRoot: root });
  const paths = pathsOf(files);
  assert.ok(paths.includes('keep.js'));
  assert.ok(!paths.includes('drop.js'), '.auditignore 的整文件豁免在快路径下同样生效');
}));
