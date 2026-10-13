/**
 * Step 1 回归：npm token 设置与凭据落盘（API 纯校验 + 原子读改写语义）。
 *
 * ⚠️ 安全约定：本测试**不写真实凭据文件**——只测三件事：
 *   ① persistNpmToken 的纯校验分支（空 / 脱敏值 / 含空白 —— 都在写盘前返回）
 *   ② updateJsonAtomic 的原子合并语义（临时文件；证明「同文件多键互不覆盖」）
 *   ③ readNpmToken 的返回类型（只读）
 * 真实凭据目录的「两键同在」端到端验证放在手工步骤里做（带备份 + 还原），避免测试污染用户凭据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { persistNpmToken, readNpmToken } from '../lib/core/credentials.js';
import { updateJsonAtomic } from '../lib/core/atomic-json.js';

test('persistNpmToken：空值 / 脱敏值 / 含空白 一律在写盘前拒绝', () => {
  const empty = persistNpmToken('', {});
  assert.equal(empty.ok, false);
  assert.match(empty.error, /为空/);

  const masked = persistNpmToken('npm_abcdef…', {});
  assert.equal(masked.ok, false, '脱敏值必须拒绝（防止把 UI 显示的 **** 写回去）');
  assert.match(masked.error, /脱敏/);

  const spaced = persistNpmToken('npm_abc def', {});
  assert.equal(spaced.ok, false);
  assert.match(spaced.error, /空白/);
});

test('原子读改写：同文件多键互不覆盖（证伪「先读整份再写整份」两步写）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cred-'));
  const f = join(dir, 'config.json');
  writeFileSync(f, '{}', 'utf8');

  const a = updateJsonAtomic(f, (cur) => ({ ...cur, githubToken: 'ghp_fake_for_test_only' }));
  assert.equal(a.ok, true, '第一次写入应成功');
  const b = updateJsonAtomic(f, (cur) => ({ ...cur, npmToken: 'npm_fake_for_test_only' }));
  assert.equal(b.ok, true, '第二次写入应成功');

  const j = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(j.githubToken, 'ghp_fake_for_test_only', 'githubToken 必须仍在（原子合并，不被覆盖）');
  assert.equal(j.npmToken, 'npm_fake_for_test_only', 'npmToken 必须写入');
});

test('原子读改写：连续写不同键不丢更新，且落盘始终是合法 JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cred2-'));
  const f = join(dir, 'config.json');
  for (const k of ['k1', 'k2', 'k3', 'k4']) {
    updateJsonAtomic(f, (cur) => ({ ...cur, [k]: k }));
    JSON.parse(readFileSync(f, 'utf8')); // 每步都必须是合法 JSON（原子落盘，无半截状态）
  }
  const j = JSON.parse(readFileSync(f, 'utf8'));
  assert.deepEqual(Object.keys(j).sort(), ['k1', 'k2', 'k3', 'k4']);
});

test('readNpmToken：只读、返回字符串、不抛错', () => {
  assert.equal(typeof readNpmToken({ workspaceRoot: '' }), 'string');
});
