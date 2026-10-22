/**
 * git 调用参数回归：非 ASCII 路径不被转义 + 权限位变化不产生噪声。
 *
 * 背景（2026-10-22 讨论后落地）：
 *   git 的 `core.quotepath` 默认 true —— 非 ASCII 字节在输出里被包成双引号 +
 *   八进制转义（`"\345\214\277"`），而插件的解析端只解 `\\` 与 `\"`，不认 `\ooo`。
 *   后果不只是「显示乱码」：join(repoPath, rel) 出来的 full 指向一个**不存在的路径**，
 *   文件读不到 ⇒ diff 审计漏审、中文路径下的私密文件 glob 匹配失效（安全漏检）。
 *
 *   同时 `core.filemode` 默认 true —— 权限位变化（CIFS/NFS 跨机同步、挂载差异）
 *   会被 git 算成 modified，审计范围被无关文件污染。
 *
 * 修法：所有 git 调用统一带 lib/core/exec.js 的 GIT_GLOBAL_ARGS
 *   （safe.directory=* + core.filemode=false + core.quotepath=false）。
 *   本文件用真实 git 仓库锁死这两件事，防回归。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { GIT_GLOBAL_ARGS } from '../lib/core/exec.js';
import { collectChangedFiles } from '../lib/audit/collector.js';

/** 搭一个含中文文件名 + 子目录的 git 仓库，返回 dir。git 不可用时返回 null。 */
function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'git-path-args-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  // 中文 + 空格 + 三层嵌套：这三类都是 git 默认会加引号转义的情形
  writeFileSync(join(dir, 'src', '配置说明.js'), '// cfg\n');
  writeFileSync(join(dir, 'src', 'my file.js'), '// spaced\n');
  writeFileSync(join(dir, 'src', 'app.js'), '// app\n');
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 't@example.invalid'], { cwd: dir, stdio: 'ignore' });
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  return dir;
}

/** 提交当前全部改动（首次提交仓库用）。 */
function commitAll(dir, msg = 'init') {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir, stdio: 'ignore' });
}

test('GIT_GLOBAL_ARGS 含 quotepath=false 与 filemode=false', () => {
  // 这是判据的「真源」：一旦有人从 GIT_GLOBAL_ARGS 里删掉这两项，本测试立刻红
  assert.ok(GIT_GLOBAL_ARGS.includes('core.quotepath=false'), '必须禁用路径转义（中文/空格文件名原样输出）');
  assert.ok(GIT_GLOBAL_ARGS.includes('core.filemode=false'), '必须忽略权限位（防跨机同步刷出一堆 M）');
  assert.ok(GIT_GLOBAL_ARGS.includes('safe.directory=*'), '必须放行 safe.directory（防 dubious ownership）');
});

test('status --porcelain 输出中文路径为原样（非八进制转义）', () => {
  const dir = setupRepo();
  if (!dir) return;
  try {
    commitAll(dir);
    writeFileSync(join(dir, 'src', '配置说明.js'), '// cfg changed\n');
    // 关键：**带前缀**跑 git，模拟插件内部调用的实际参数
    const out = execFileSync('git', [...GIT_GLOBAL_ARGS, '-C', dir, 'status', '--porcelain'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ok(out.includes('配置说明.js'), `应原样输出中文路径，实际：${JSON.stringify(out)}`);
    assert.ok(!out.includes('\\3'), `不应出现八进制转义（\\ooo），实际：${JSON.stringify(out)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collectChangedFiles：中文路径可解析出真实存在的 full', () => {
  const dir = setupRepo();
  if (!dir) return;
  try {
    commitAll(dir);
    writeFileSync(join(dir, 'src', '配置说明.js'), '// cfg changed\n');
    const files = collectChangedFiles(dir);
    assert.ok(Array.isArray(files), 'git 仓库应返回数组');
    const hit = files.find((f) => f.rel.endsWith('配置说明.js'));
    assert.ok(hit, `应收集到中文文件，实际：${JSON.stringify(files)}`);
    // 核心断言：rel 是**可读的中文**，且 full 指向真实文件（转义没解时这里必然失败）
    assert.ok(!hit.rel.includes('\\3'), `rel 不应含八进制转义，实际：${hit.rel}`);
    assert.ok(existsSync(hit.full), `full 应指向真实文件：${hit.full}`);
    // 带空格的文件名同样要正确
    writeFileSync(join(dir, 'src', 'my file.js'), '// spaced changed\n');
    const files2 = collectChangedFiles(dir);
    const hit2 = files2.find((f) => f.rel.endsWith('my file.js'));
    assert.ok(hit2, `应收集到带空格的文件，实际：${JSON.stringify(files2)}`);
    assert.ok(existsSync(hit2.full), `full 应指向真实文件：${hit2.full}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('权限位变化不算 modified（core.filemode=false 生效）', () => {
  const dir = setupRepo();
  if (!dir) return;
  try {
    commitAll(dir);
    // 只改权限位、不改内容：默认配置下 git 会报 M，filemode=false 时应干净
    chmodSync(join(dir, 'src', 'app.js'), 0o755);
    const out = execFileSync('git', [...GIT_GLOBAL_ARGS, '-C', dir, 'status', '--porcelain'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(out.trim(), '', `仅权限位变化不应产生改动，实际：${JSON.stringify(out)}`);
    const files = collectChangedFiles(dir);
    assert.equal(files.length, 0, `审计范围不应被权限位噪声污染，实际：${JSON.stringify(files)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
