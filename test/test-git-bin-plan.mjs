/**
 * git 可执行文件解析的跨平台回归测试（lib/git/exec.js 的 gitSearchPlan）。
 *
 * 背景（真缺陷）：旧实现写死 `PATH.split(':')` 且候选名只试 `git` —— 在 Windows 上
 *   PATH 用 `;` 分隔、可执行名是 `git.exe`，于是**永远找不到 git**，报出
 *   「找不到 git 可执行文件」这种看似环境问题的误导结论。本测试钉住平台差异。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gitSearchPlan } from '../lib/git/exec.js';

test('gitSearchPlan：Windows 用 ";" 切分且候选名为 git.exe', () => {
  const win = 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd;D:\\tools';
  const plan = gitSearchPlan(win, { delimiter: ';', platform: 'win32' });
  assert.deepEqual(plan.dirs, ['C:\\Windows\\system32', 'C:\\Program Files\\Git\\cmd', 'D:\\tools'], '必须按 ; 切分');
  assert.equal(plan.names[0], 'git.exe', 'Windows 首选 git.exe');
  assert.ok(plan.names.includes('git.cmd'), '还应兜底 git.cmd/git.bat');
  // 反例：用 ':' 切 Windows PATH 会被**盘符的冒号**切坏（旧实现的行为）→ 目录全不对、找不到 git
  const wrong = gitSearchPlan(win, { delimiter: ':', platform: 'win32' });
  assert.notDeepEqual(wrong.dirs, plan.dirs, '用错分隔符的切分结果必然不同');
  assert.ok(!wrong.dirs.includes('C:\\Program Files\\Git\\cmd'), '用错分隔符时该目录被切坏（这正是旧缺陷：永远找不到 git）');
});

test('gitSearchPlan：POSIX 用 ":" 切分且候选名为 git', () => {
  const plan = gitSearchPlan('/usr/local/bin:/usr/bin:/bin', { delimiter: ':', platform: 'linux' });
  assert.deepEqual(plan.dirs, ['/usr/local/bin', '/usr/bin', '/bin']);
  assert.deepEqual(plan.names, ['git']);
});

test('gitSearchPlan：去掉目录尾部分隔符、跳过空段', () => {
  const posix = gitSearchPlan('/usr/bin/::/opt/git/', { delimiter: ':', platform: 'linux' });
  assert.deepEqual(posix.dirs, ['/usr/bin', '/opt/git'], '尾部 / 去掉、空段跳过');
  const win = gitSearchPlan('C:\\Git\\cmd\\;', { delimiter: ';', platform: 'win32' });
  assert.deepEqual(win.dirs, ['C:\\Git\\cmd'], '尾部 \\ 去掉');
  assert.deepEqual(gitSearchPlan('', { delimiter: ':', platform: 'linux' }).dirs, [], '空 PATH → 无目录');
  assert.deepEqual(gitSearchPlan(undefined, { delimiter: ':', platform: 'linux' }).dirs, [], 'undefined 安全');
});
