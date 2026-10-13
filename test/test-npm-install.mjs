/**
 * Step 3 回归：安装参数与安全默认（纯函数）+ 假 npm 端到端（PATH 注入，不真装包）。
 *
 * 重点断言：**默认带 `--ignore-scripts`**（装包不执行 postinstall）；显式关闭时才不带；
 *   全局走 `-g`、指定目录走 `--prefix`；包名校验挡住选项注入与路径穿越。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildInstallArgs, installPackages, installingKeys, validateDest, validatePackageNames } from '../lib/npm/install.js';

test('validatePackageNames：正常包名/scope/带 tag 通过；选项注入与穿越被拒', () => {
  assert.deepEqual(validatePackageNames(['left-pad']).names, ['left-pad']);
  assert.deepEqual(validatePackageNames(['@scope/pkg', 'pkg@next']).names, ['@scope/pkg', 'pkg@next']);
  assert.equal(validatePackageNames(['--registry=http://evil']).ok, false);
  assert.match(validatePackageNames(['-g']).error, /不能以 - 开头/);
  assert.equal(validatePackageNames(['../etc/passwd']).ok, false);
  assert.equal(validatePackageNames([]).ok, false);
});

test('validateDest：不存在的目录 / 非目录 被拒', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-dest-'));
  assert.equal(validateDest(dir).ok, true);
  assert.equal(validateDest(join(dir, 'nope')).ok, false);
  const file = join(dir, 'a.txt');
  writeFileSync(file, 'x', 'utf8');
  assert.equal(validateDest(file).ok, false);
  assert.equal(validateDest('').ok, false);
});

test('buildInstallArgs：默认 --ignore-scripts；全局 -g；指定目录 --prefix', () => {
  const d = buildInstallArgs({ names: ['left-pad'], dest: '/tmp/x' });
  assert.deepEqual(d.slice(0, 2), ['install', 'left-pad']);
  assert.ok(d.includes('--ignore-scripts'), '默认必须带 --ignore-scripts（不执行 postinstall）');
  assert.deepEqual(d.slice(d.indexOf('--prefix'), d.indexOf('--prefix') + 2), ['--prefix', '/tmp/x']);

  const noScripts = buildInstallArgs({ names: ['a'], dest: '/tmp/x', ignoreScripts: false });
  assert.equal(noScripts.includes('--ignore-scripts'), false, '显式关闭时不应带该开关');

  const g = buildInstallArgs({ names: ['a'], global: true });
  assert.ok(g.includes('-g'));
  assert.equal(g.includes('--prefix'), false, '全局安装不应同时给 --prefix');
});

test('installPackages（假 npm）：参数落盘可核对，日志留痕，非法入参不入锁', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fakenpm-install-'));
  const fake = join(dir, 'npm');
  const argFile = join(dir, 'args.txt');
  // 假 npm：把参数写到文件后成功退出（绝不真装包）
  writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${argFile}\nexit 0\n`, 'utf8');
  chmodSync(fake, 0o755);
  const dest = mkdtempSync(join(tmpdir(), 'dsh-install-dest-'));

  const r = installPackages({
    names: ['left-pad'], dest, registry: 'https://registry.npmjs.org/',
    workspaceRoot: dir, timeoutMs: 20_000, env: { PATH: `${dir}:${process.env.PATH}` },
  });
  assert.equal(r.ok, true, `假 npm 应成功，实得：${r.error}`);
  const args = readFileSync(argFile, 'utf8').trim().split('\n');
  assert.ok(args.includes('install') && args.includes('left-pad'), '应调用 npm install left-pad');
  assert.ok(args.includes('--ignore-scripts'), '默认安全开关必须生效');
  assert.ok(args.includes('--userconfig'), '必须走我们自己的 npmrc');
  assert.ok(r.logPath && r.logPath.endsWith('npm-install.log'), `应留痕日志，实得 ${r.logPath}`);

  // 锁语义：非法入参不会留下锁记录
  installPackages({ names: ['--bad'], dest, workspaceRoot: dir });
  assert.deepEqual(installingKeys(), [], '结束后不应残留进行中的锁');
});
