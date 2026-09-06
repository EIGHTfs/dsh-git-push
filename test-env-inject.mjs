/**
 * lib/env-inject.js 单测：工作目录映射 / 工具路径探测 / 注入文本 / tools-index 写入
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  probeToolPath,
  collectToolPaths,
  mapWorkspaceDirs,
  formatWorkspaceEnvInjection,
  formatToolsEnvInjection,
  ensureToolsIndexFile,
  buildEnvInjection,
  buildEnvInjectionWithTools,
  DEFAULT_TOOL_PROBES,
} from './lib/env-inject.js';

test('probeToolPath：本机 git 必然存在（零依赖环境也带 git）', () => {
  const r = probeToolPath('git', ['--version']);
  assert.equal(r.found, true);
  assert.ok(r.path.length > 0);
  assert.match(r.version, /git version/i);
});

test('probeToolPath：不存在的工具 → found:false', () => {
  const r = probeToolPath('dsh-no-such-tool-xyz-2026');
  assert.equal(r.found, false);
  assert.equal(r.path, '');
});

test('collectToolPaths：默认清单去重且只返回探测结果', () => {
  const names = DEFAULT_TOOL_PROBES.map((t) => t.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, '默认清单不应有重复工具名');
  const tools = collectToolPaths();
  assert.ok(Array.isArray(tools));
  assert.ok(tools.length >= 5);
});

test('mapWorkspaceDirs：cwd 与 projectDir 解析、父级链、子目录', () => {
  const root = mkdtempSync(join(tmpdir(), 'gpenv-'));
  mkdirSync(join(root, 'proj'), { recursive: true });
  writeFileSync(join(root, 'proj', 'a.txt'), 'x');
  const m = mapWorkspaceDirs({ workspaceRoot: join(root, 'proj'), cwd: join(root, 'proj') });
  assert.equal(m.cwd, join(root, 'proj'));
  assert.equal(m.projectDir, join(root, 'proj'));
  assert.ok(m.parents.length >= 2);
  // 子目录列表应包含/不包含隐藏与 node_modules
  mkdirSync(join(root, 'proj', 'sub1'));
  mkdirSync(join(root, 'proj', '.hidden'));
  mkdirSync(join(root, 'proj', 'node_modules'));
  const m2 = mapWorkspaceDirs({ workspaceRoot: join(root, 'proj'), cwd: join(root, 'proj') });
  assert.ok(m2.children.includes('sub1'));
  assert.ok(!m2.children.includes('.hidden'));
  assert.ok(!m2.children.includes('node_modules'));
  rmSync(root, { recursive: true, force: true });
});

test('formatWorkspaceEnvInjection：包含关键字段', () => {
  const t = formatWorkspaceEnvInjection({
    cwd: '/a/b', projectDir: '/a/b/proj', parents: ['/a/b/proj', '/a/b', '/a', '/'], children: ['src', 'docs'],
  });
  assert.ok(t.includes('工作目录映射'));
  assert.ok(t.includes('/a/b/proj'));
  assert.ok(t.includes('src'));
  assert.ok(t.includes('/'));
});

test('formatToolsEnvInjection：命中/缺失分组', () => {
  const t = formatToolsEnvInjection([
    { name: 'git', path: '/usr/bin/git', version: 'git version 2.39', found: true },
    { name: 'nonexist', path: '', version: '', found: false },
  ]);
  assert.ok(t.includes('/usr/bin/git'));
  assert.ok(t.includes('nonexist'));
});

test('ensureToolsIndexFile：写盘可读回、表格含工具行', () => {
  const root = mkdtempSync(join(tmpdir(), 'gptools-'));
  const r = ensureToolsIndexFile({
    workspaceRoot: root,
    tools: [
      { name: 'python3', path: '/usr/bin/python3', version: 'Python 3.11', found: true },
      { name: 'missing', path: '', version: '', found: false },
    ],
  });
  assert.equal(r.ok, true);
  const content = readFileSync(r.file, 'utf8');
  assert.ok(content.includes('# 工具安装路径索引'));
  assert.ok(content.includes('| python3 |'));
  assert.ok(content.includes('missing'));
  rmSync(root, { recursive: true, force: true });
});

test('buildEnvInjectionWithTools：只探测指定工具', () => {
  const env = buildEnvInjectionWithTools(['git', 'no-such-tool'], { workspaceRoot: process.cwd() });
  assert.equal(env.tools.length, 2);
  const names = env.tools.map((t) => t.name);
  assert.deepEqual(names.sort(), ['git', 'no-such-tool'].sort());
  assert.ok(env.dirsText.length > 0);
  assert.ok(env.toolsText.length > 0);
});

test('buildEnvInjection：完整链路', () => {
  const env = buildEnvInjection({ workspaceRoot: process.cwd(), probeTools: true });
  assert.ok(env.dirsText.includes('工作目录映射'));
  assert.ok(env.toolsText.includes('工具安装路径'));
  assert.ok(Array.isArray(env.tools));
});
