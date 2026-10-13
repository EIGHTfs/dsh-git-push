/**
 * Step 2 回归：npm 只读探测（纯函数）+ 假 npm 登录态。
 *
 * 覆盖面：registry 归一化 / whoami 输出解析 / npmrc 文本与 auth 前缀 / 通过 PATH 注入假 npm 验证 whoami 全链路。
 * 不触网、不动真实 npmrc（假 npm 与临时目录都在 /tmp）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_REGISTRY, normalizeRegistry, parseWhoami, whoami } from '../lib/npm/registry.js';
import { npmArgs, npmrcText, registryAuthPrefix } from '../lib/npm/npmrc.js';

test('normalizeRegistry：空/非法退回官方源，合法值去尾斜杠', () => {
  assert.equal(normalizeRegistry(''), DEFAULT_REGISTRY);
  assert.equal(normalizeRegistry('not a url'), DEFAULT_REGISTRY);
  assert.equal(normalizeRegistry('http://my.reg.local/'), 'http://my.reg.local');
  assert.equal(normalizeRegistry('https://registry.npmmirror.com/'), 'https://registry.npmmirror.com');
});

test('parseWhoami：取最后一行非空（跳过 npm 的日志行）', () => {
  assert.equal(parseWhoami('npm notice foo\nfluquormyosotis\n'), 'fluquormyosotis');
  assert.equal(parseWhoami(''), '');
  assert.equal(parseWhoami('  \n \n'), '');
});

test('npmrcText：无 token 只写 registry；有 token 追加 authToken 行', () => {
  const bare = npmrcText({ registry: 'https://registry.npmjs.org/' });
  assert.equal(bare, 'registry=https://registry.npmjs.org/\n');
  assert.equal(bare.includes('_authToken'), false);

  const withTok = npmrcText({ registry: 'https://registry.npmjs.org/', token: 'npm_secret' });
  assert.match(withTok, /^registry=https:\/\/registry\.npmjs\.org\/\n/);
  assert.match(withTok, /\/\/registry\.npmjs\.org\/:_authToken=npm_secret\n/);
});

test('registryAuthPrefix：含子路径的私有源也正确', () => {
  assert.equal(registryAuthPrefix('https://registry.npmjs.org/'), '//registry.npmjs.org/');
  assert.equal(registryAuthPrefix('https://npm.pkg.github.com/my-org/'), '//npm.pkg.github.com/my-org/');
  assert.equal(registryAuthPrefix('garbage'), '');
});

test('npmArgs：有 npmrc 时带 --userconfig，registry 始终显式传', () => {
  assert.deepEqual(npmArgs({ npmrcFile: '/tmp/x/npmrc', registry: 'https://r.example' }), ['--userconfig', '/tmp/x/npmrc', '--registry', 'https://r.example']);
  assert.deepEqual(npmArgs({ registry: 'https://r.example' }), ['--registry', 'https://r.example']);
});

test('whoami（假 npm，PATH 注入）：成功取用户名；未登录给出可读错误', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-fakenpm-'));
  const okBin = join(dir, 'npm');
  writeFileSync(okBin, '#!/bin/sh\necho "npm notice 日志行" >&2\necho fake-user\n', 'utf8');
  chmodSync(okBin, 0o755);
  const ok = whoami({ env: { PATH: `${dir}:${process.env.PATH}` } });
  assert.equal(ok.ok, true, `应成功，实得：${ok.error}`);
  assert.equal(ok.user, 'fake-user');

  const failBin = join(dir, 'npm');
  writeFileSync(failBin, '#!/bin/sh\necho "npm ERR! not logged in" >&2\nexit 1\n', 'utf8');
  chmodSync(failBin, 0o755);
  const bad = whoami({ env: { PATH: `${dir}:${process.env.PATH}` } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /not logged in/);
});
