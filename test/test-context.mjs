/**
 * 上下文注入测试（0.1.7）：环境注入文本生成/解析、路径归属判定。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEnvInjectionText, parseEnvInjection, isWithinRoot } from '../lib/context/index.js';

test('环境注入：生成含 cwd/项目根/工具清单', () => {
  const t = createEnvInjectionText({ cwd: '/work', projectRoot: '/work/proj' });
  assert.ok(t.includes('当前工作目录 cwd：/work'));
  assert.ok(t.includes('项目实际目录（git 根）：/work/proj'));
  assert.ok(t.includes('git=/usr/bin/git'));
});

test('环境注入：解析回键值结构', () => {
  const t = createEnvInjectionText({ cwd: '/work', projectRoot: '/work/proj', tools: { node: '/usr/bin/node', git: '/usr/bin/git' } });
  const p = parseEnvInjection(t);
  assert.equal(p.cwd, '/work');
  assert.equal(p.projectRoot, '/work/proj');
  assert.equal(p.tools.node, '/usr/bin/node');
  assert.equal(p.tools.git, '/usr/bin/git');
});

test('环境注入：自定义工具覆盖默认', () => {
  const t = createEnvInjectionText({ cwd: '/x', tools: { python3: '/opt/py' } });
  assert.ok(t.includes('python3=/opt/py'));
});

test('环境注入：skills 目录存在性标记', () => {
  const t = createEnvInjectionText({ cwd: '/x', projectRoot: '/no-such-dir-xyz' });
  assert.ok(t.includes('存在：false'));
});

test('路径归属：target 在 root 内/等于 root → true', () => {
  assert.equal(isWithinRoot('/a/b', '/a/b'), true);
  assert.equal(isWithinRoot('/a/b', '/a/b/c.js'), true);
});

test('路径归属：target 在 root 外/空 → false', () => {
  assert.equal(isWithinRoot('/a/b', '/a/c.js'), false);
  assert.equal(isWithinRoot('/a/b', '/a'), false);
  assert.equal(isWithinRoot('', '/x'), false);
  assert.equal(isWithinRoot('/x', ''), false);
});

test('路径归属：前缀相似但不同目录 → false（防目录穿越）', () => {
  assert.equal(isWithinRoot('/a/b', '/a/bc'), false);
});