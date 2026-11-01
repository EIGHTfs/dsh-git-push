/**
 * git 钩子探针测试（2026-11-01，同机会话实测移交驱动）。
 *
 * 背景：CIFS 仓库里存在从旧机器随 `.git/` 迁过来的 `prepare-commit-msg`，
 *   里面写死了上一台机器的 pnpm 路径（/volume13/...）。插件此前对钩子零感知：
 *   既不说明"本次会触发哪些钩子"，也不知道这个钩子一跑就失败。
 *
 * 处置口径（本测试锁死）：**正常钩子一律照跑**（很多仓库靠 pre-commit 做 lint），
 *   只有「可证明坏掉」（解释器不存在 / 引用的机器路径不存在）才给 LEFTHOOK=0 并说明原因。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describeHooks, probeHooks } from '../lib/git/hooks.js';

/** 造一个带 .git/hooks 的临时仓库。 */
function withRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-hooks-'));
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function writeHook(root, name, body, mode = 0o755) {
  const p = join(root, '.git', 'hooks', name);
  writeFileSync(p, body, 'utf8');
  chmodSync(p, mode);
  return p;
}

test('无钩子 ⇒ 空清单、不注入 env', () => withRepo((root) => {
  const r = probeHooks(root);
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.env, {});
  assert.match(describeHooks(r), /不触发任何 git 钩子/);
}));

test('正常钩子 ⇒ 照跑（不给 LEFTHOOK=0）', () => withRepo((root) => {
  writeHook(root, 'pre-commit', '#!/bin/sh\nnpm run lint\n');
  const r = probeHooks(root);
  assert.deepEqual(r.active, ['pre-commit']);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.env, {}, '正常钩子不能被插件擅自关掉');
}));

test('坏解释器 ⇒ 标记 broken 并注入 LEFTHOOK=0', () => withRepo((root) => {
  writeHook(root, 'prepare-commit-msg', '#!/volume13/dead/node/bin/node\nconsole.log(1)\n');
  const r = probeHooks(root);
  assert.deepEqual(r.broken, ['prepare-commit-msg']);
  assert.deepEqual(r.env, { LEFTHOOK: '0' });
  assert.match(describeHooks(r), /坏：解释器不存在/);
}));

test('脚本引用不存在的机器路径 ⇒ 标记 broken', () => withRepo((root) => {
  writeHook(root, 'pre-commit', '#!/bin/sh\nexec /volume13/old/pnpm exec lefthook run pre-commit\n');
  const r = probeHooks(root);
  assert.deepEqual(r.broken, ['pre-commit']);
  assert.match(r.items[0].reason, /路径不存在/);
}));

test('引用系统路径（/bin/sh 等）不算坏', () => withRepo((root) => {
  writeHook(root, 'commit-msg', '#!/bin/sh\n/bin/grep -q . "$1"\n');
  const r = probeHooks(root);
  assert.deepEqual(r.broken, []);
}));

test('不可执行的钩子不列（git 本来就不会跑它）', () => withRepo((root) => {
  writeHook(root, 'pre-push', '#!/bin/sh\necho hi\n', 0o644);
  const r = probeHooks(root);
  assert.deepEqual(r.items, []);
}));

test('多个钩子：只跳过坏的，好的照跑', () => withRepo((root) => {
  writeHook(root, 'pre-commit', '#!/bin/sh\necho lint\n');
  writeHook(root, 'prepare-commit-msg', '#!/volume13/dead/node\n');
  const r = probeHooks(root);
  assert.deepEqual(r.active.sort(), ['pre-commit', 'prepare-commit-msg']);
  assert.deepEqual(r.broken, ['prepare-commit-msg']);
  const text = describeHooks(r);
  assert.match(text, /pre-commit/);
  assert.match(text, /prepare-commit-msg（坏/);
}));

test('.git 不存在 ⇒ 不抛、返回空', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-nogit-'));
  try {
    const r = probeHooks(root);
    assert.deepEqual(r.items, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
