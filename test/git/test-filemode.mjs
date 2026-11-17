/**
 * `core.filemode`（忽略权限位变动）的回归测试。
 *
 * 为什么值得单测：这个能力只在「CIFS/容器卷上新文件权限 ≠ 仓库记录权限」时才有意义，
 *   而这恰恰是最难在现场复现的条件（一台机器上不一定有该挂载）。
 *   这里用 `chmod +x` 造出**真实**的权限变动，验证「忽略前算改动、忽略后不算」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readFilemode, setFilemode, modeOnlyChanges, configFileOf } from '../../lib/git/filemode.js';

/** 建一个临时 git 仓库，含一个已提交文件。 */
function makeRepo(prefix) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  writeFileSync(join(repo, 'a.sh'), '#!/bin/sh\necho hi\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  return repo;
}

test('filemode：非 git 仓库 ⇒ ok:false 且给出可诊断原因', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fm-notrepo-'));
  try {
    const r = readFilemode({ repoPath: dir });
    assert.equal(r.ok, false);
    assert.match(String(r.error), /不是 git 仓库/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('filemode：读 → 写 false → 回读为 false（以回读为准，不信命令没报错）', () => {
  const repo = makeRepo('fm-set-');
  try {
    const before = readFilemode({ repoPath: repo });
    assert.equal(before.ok, true);
    assert.equal(typeof before.effective, 'boolean', '生效值必须是布尔（未设置时按 git 默认 true）');
    const written = setFilemode({ repoPath: repo, value: false });
    assert.equal(written.ok, true, `写入应成功：${written.error || ''}`);
    assert.equal(written.effective, false);
    const cfgValue = execFileSync('git', ['-C', repo, 'config', '--local', '--get', 'core.filemode'], { encoding: 'utf8' }).trim();
    assert.equal(cfgValue, 'false', '.git/config 里必须真的是 false');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('filemode：忽略前后对「真实 chmod +x」的判定差异（这就是它存在的意义）', () => {
  const repo = makeRepo('fm-mode-');
  try {
    // 先确保「比较权限位」（git 默认）
    setFilemode({ repoPath: repo, value: true });
    execFileSync('chmod', ['+x', join(repo, 'a.sh')]);
    const withMode = modeOnlyChanges(repo);
    assert.ok(withMode.count >= 1, `比较权限位时应报出纯权限变动，实际 ${withMode.count}（${JSON.stringify(withMode.files)}）`);
    assert.ok(withMode.files.includes('a.sh'));

    // 忽略权限位后：同一改动不再算改动
    const w = setFilemode({ repoPath: repo, value: false });
    assert.equal(w.ok, true);
    const afterIgnore = modeOnlyChanges(repo);
    assert.equal(afterIgnore.count, 0, `忽略权限位后不应再有纯权限变动，实际 ${JSON.stringify(afterIgnore.files)}`);
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    assert.equal(status, '', '忽略权限位后工作区应干净（内容本来就没变）');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('filemode：写失败时有备份（CIFS 走直接改写 .git/config 的退路）', () => {
  const repo = makeRepo('fm-backup-');
  try {
    // 先设 true，再设 false：走到哪条路取决于文件系统，但**结果与可诊断性**必须一致
    setFilemode({ repoPath: repo, value: true });
    const w = setFilemode({ repoPath: repo, value: false });
    assert.equal(w.ok, true);
    assert.equal(w.effective, false);
    assert.ok(['git-config', 'direct-.git/config'].includes(w.via), `via 应可观测，实际 ${w.via}`);
    if (w.via === 'direct-.git/config') {
      assert.ok(w.backup, '走退路时必须留备份');
    }
    assert.ok(configFileOf(repo).endsWith(join('.git', 'config')), 'configFileOf 应指向 .git/config');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('filemode：scope=global 只影响全局，不动当前仓库的本地配置', () => {
  const repo = makeRepo('fm-global-');
  const prevGlobal = (() => {
    try {
      return execFileSync('git', ['config', '--global', '--get', 'core.filemode'], { encoding: 'utf8' }).trim();
    } catch { return ''; }
  })();
  try {
    setFilemode({ repoPath: repo, value: false });            // 本地先设 false
    const w = setFilemode({ repoPath: repo, scope: 'global', value: false });
    assert.equal(w.ok, true);
    const local = execFileSync('git', ['-C', repo, 'config', '--local', '--get', 'core.filemode'], { encoding: 'utf8' }).trim();
    assert.equal(local, 'false', '本地值不应被 global 写入覆盖');
  } finally {
    // 恢复全局设置，别污染本机
    try {
      if (prevGlobal) execFileSync('git', ['config', '--global', 'core.filemode', prevGlobal]);
      else execFileSync('git', ['config', '--global', '--unset', 'core.filemode']);
    } catch { /* 恢复失败不影响断言结果 */ }
    rmSync(repo, { recursive: true, force: true });
  }
});
