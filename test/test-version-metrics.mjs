// 版本量化记录回归（学习第 3 条：版本表带「可量化效果」）。
//
// 事故背景：版本表由 git log 聚合，行内容取自提交信息——偏叙述，看不出这版改善了多少。
//   现支持可选的 version-metrics.json：为某版本写一句前后对比，渲染时拼到该行最前。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readVersionMetrics, buildReadmeVersionTable } from '../scripts/readme-gen.mjs';

const SANDBOX = mkdtempSync(join(tmpdir(), 'dshgp-vmetrics-'));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

test('readVersionMetrics：缺文件/坏 json/非对象 一律返回空对象（不阻断生成）', () => {
  const empty = join(SANDBOX, 'empty');
  mkdirSync(empty, { recursive: true });
  assert.deepEqual(readVersionMetrics(empty), {}, '缺文件应返回 {}');

  const bad = join(SANDBOX, 'bad');
  mkdirSync(bad, { recursive: true });
  writeFileSync(join(bad, 'version-metrics.json'), '{ 不是合法 json');
  assert.deepEqual(readVersionMetrics(bad), {}, '坏 json 应返回 {}');

  const arr = join(SANDBOX, 'arr');
  mkdirSync(arr, { recursive: true });
  writeFileSync(join(arr, 'version-metrics.json'), '["x"]');
  assert.deepEqual(readVersionMetrics(arr), {}, '数组不是合法形状，应返回 {}');
});

test('buildReadmeVersionTable：量化记录拼到该版本行最前，未写量化的版本保持原样', () => {
  const repo = join(SANDBOX, 'repo');
  mkdirSync(repo, { recursive: true });
  execSync('git init -q && git config user.email t@t.local && git config user.name t', { cwd: repo, stdio: 'ignore' });
  writeFileSync(join(repo, 'a.txt'), '1');
  execSync('git add -A && git commit -qm "feat: 9.9.9 — 某版本做了什么"', { cwd: repo, stdio: 'ignore' });
  writeFileSync(join(repo, 'b.txt'), '2');
  execSync('git add -A && git commit -qm "fix: 9.9.8 — 另一版本做了什么"', { cwd: repo, stdio: 'ignore' });

  // 只为 9.9.9 写量化
  writeFileSync(join(repo, 'version-metrics.json'), JSON.stringify({ '9.9.9': '误报 16 → 0' }));

  const rows = buildReadmeVersionTable(repo);
  const r999 = rows.find((x) => x.includes('9.9.9'));
  const r998 = rows.find((x) => x.includes('9.9.8'));
  assert.ok(r999.includes('误报 16 → 0'), `9.9.9 行应含量化：${r999}`);
  assert.ok(r999.indexOf('误报 16 → 0') < r999.indexOf('某版本做了什么'), '量化应在行内容最前');
  assert.ok(!r998.includes('→'), `未写量化的 9.9.8 行不应出现箭头：${r998}`);
});
