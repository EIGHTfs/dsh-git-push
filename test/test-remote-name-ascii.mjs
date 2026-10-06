// 仓库名 ASCII 校验回归：非 ASCII 名必须前置拦截并明确报错，不得静默变形。
//
// 事故（用户实测）：项目文件夹名含中文（「逆向-malang」）时，ensureRemoteRepo 取 basename 当仓库名，
//   名字在 URL 构造/参数传递中被拆掉、残余片段被当成选项式 token（`--malang`），
//   建出来的远端名与预期完全不符；且返回 ok，用户直到查远端才发现。
// 约束（用户给定）：插件建仓库只能用 ASCII 名。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ensureRemoteRepo } from '../lib/git/remote.js';

test('非 ASCII 仓库名：前置拦截 + 明确报错（不静默变形）', async () => {
  const r = await ensureRemoteRepo({ repoPath: '/tmp/逆向-malang', dryRun: true });
  assert.equal(r.ok, false, '非 ASCII 名不得返回成功');
  assert.equal(r.code, 'NON_ASCII_REPO_NAME', '应带稳定的错误码');
  assert.match(r.error, /非 ASCII/, '错误文案要点明原因');
  assert.match(r.error, /malang-reverse/, '错误文案应给 ASCII 改名示例');
});

test('ASCII 名（含 . _ -）不被误拦', async () => {
  // dry-run + 无 token：走到 owner 占位分支即可，不真建仓；只断言没被名字校验拦下
  const r = await ensureRemoteRepo({ repoPath: '/tmp/malang-reverse', dryRun: true });
  assert.notEqual(r.code, 'NON_ASCII_REPO_NAME', 'ASCII 名不该命中名字校验');
  assert.equal(r.name ?? 'malang-reverse', 'malang-reverse');
});
