// dsh-git-push 测试：lib/readme-gen（README 生成）——按 v2 lib 文件夹对齐（2026-09-11）
/**
 * 覆盖：genReadme / renderReadmeTemplateYml / loadReadmeTemplateYml / resolveReadmeTemplate /
 * tocFromTemplate / parseVersion / listVersionCommits / buildReadmeVersionTable。
 * 断言基于真实签名（行为快照：先探实际输出再断言，不臆测）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import {
  genReadme, renderReadmeTemplateYml, loadReadmeTemplateYml,
  resolveReadmeTemplate, tocFromTemplate, parseVersion, listVersionCommits, buildReadmeVersionTable,
} from '../lib/readme-gen/index.js';

let tmp = '';
const runGit = (args, cwd) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

test('readme-gen：内置 yml 模板可装载（返回 {file, data, template}）', () => {
  const tpl = loadReadmeTemplateYml();
  assert.ok(tpl && typeof tpl === 'object', '应返回对象');
  assert.ok(tpl.file && /readme\.yml$/.test(tpl.file), `file 应指向 readme.yml（实际 ${tpl.file}）`);
  assert.ok(tpl.data && typeof tpl.data === 'object', '应有 yml data');
  assert.equal(typeof tpl.template, 'string');
  assert.ok(tpl.template.length > 0, '渲染模板非空');
});

test('readme-gen：renderReadmeTemplateYml 按 {header, sections} 渲染', () => {
  const out = renderReadmeTemplateYml({
    header: { title: 'demo', intro: 'desc' },
    sections: [{ title: '安装', body: 'npm i' }, { title: '用法', body: 'run' }],
  });
  assert.ok(out.includes('demo'));
  assert.ok(out.includes('desc'));
  assert.ok(out.includes('## 安装'));
  assert.ok(out.includes('npm i'));
  assert.ok(out.includes('## 用法'));
  assert.ok(out.includes('run'));
});

test('readme-gen：resolveReadmeTemplate 缺省走内置 readme.yml（source 含 readme.yml）', () => {
  const r = resolveReadmeTemplate({});
  assert.ok(r && typeof r === 'object', '应返回对象');
  assert.equal(typeof r.template, 'string');
  assert.ok(r.template.length > 0, '模板非空');
  assert.ok(r.source.includes('readme.yml') || r.source === 'builtin', `source 应为 readme.yml 或 builtin（实际 ${r.source}）`);
});

test('readme-gen：tocFromTemplate 提取 ## 标题为锚点列表', () => {
  const toc = tocFromTemplate('# 大标题\n正文\n## 安装\n内容\n## 用法\n内容\n');
  assert.ok(toc.includes('- [安装](#安装)'));
  assert.ok(toc.includes('- [用法](#用法)'));
  assert.ok(!toc.includes('大标题'), '一级标题不入目录');
});

test('readme-gen：parseVersion 返回 {major,minor,patch} 三元组', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion('abc'), null);
});

test('readme-gen：listVersionCommits 从真实临时仓列出版本提交', () => {
  tmp = mkdtempSync(join(tmpdir(), 'v2-readme-'));
  const repo = join(tmp, 'r');
  mkdirSync(repo);
  runGit(['init', '-q'], repo);
  runGit(['config', 'user.email', 't@v2.local'], repo);
  runGit(['config', 'user.name', 'v2 test'], repo);
  writeFileSync(join(repo, 'a.js'), 'const ok = 1;\n');
  runGit(['add', '-A'], repo);
  runGit(['commit', '-q', '-m', 'feat: init'], repo);
  writeFileSync(join(repo, 'a.js'), 'const ok = 2;\n');
  runGit(['add', '-A'], repo);
  runGit(['commit', '-q', '-m', '1.0.0 release'], repo);
  const commits = listVersionCommits(repo);
  assert.ok(Array.isArray(commits) && commits.length >= 1, `应有版本分组（实际 ${commits.length}）`);
  assert.ok(commits.some((c) => c.versionStr === '1.0.0'), `应含 1.0.0 分组（实际 ${commits.map((c) => c.versionStr).join(',')}）`);
});

test('readme-gen：buildReadmeVersionTable 返回版本表数组', () => {
  if (!tmp) { tmp = mkdtempSync(join(tmpdir(), 'v2-readme-')); }
  const repo = join(tmp, 'r');
  if (!rmSync || false) { /* noop */ }
  const table = buildReadmeVersionTable(repo);
  assert.ok(Array.isArray(table), '应为数组');
});

test('readme-gen：genReadme 对真实仓库返回 README 文本（content 字段）', () => {
  const repo = join(tmp, 'r');
  const r = genReadme({ repoPath: repo, writePath: '' });
  assert.ok(r, '应有返回');
  assert.equal(r.ok, true, `应生成成功（实际 ${JSON.stringify(r)?.slice(0, 200)}）`);
  assert.equal(typeof r.content, 'string');
  assert.ok(r.content.length > 0, 'content 应非空');
  assert.equal(typeof r.templateSource, 'string');
  assert.ok(Array.isArray(r.versionTable) || !r.versionTable, 'versionTable 应为数组或空');
});

test('readme-gen：清理临时目录', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
  assert.ok(true);
});
