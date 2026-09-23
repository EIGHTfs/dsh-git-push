/**
 * module_splitter 工具 + CLI 接入测试（2026-09-20 1.5.6）：
 *   工具契约（listTools 注册 / tool-call case / cli 命令 / HELP）+
 *   行为（cmdModuleSplitter 真实 spawn python3 跑 analyze / split --dry-run）+
 *   脚本随插件发布（scripts/module-splitter.py + SYNC_ENTRIES 覆盖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { listTools } from '../lib/app/tools.js';
import { SYNC_ENTRIES } from '../scripts/sync-plugin.mjs';
import { cmdModuleSplitter } from '../cli.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// dirname 放最后引用的 ESM 静态 import 已提升——此处再导入一次会被去重，直接定义常量替代
const rootDir = dirname(fileURLToPath(import.meta.url)) + '/..';

test('module_splitter：工具清单注册（listTools 含 module_splitter 三参数）', () => {
  const tool = listTools().find((t) => t.name === 'module_splitter');
  assert.ok(tool, 'listTools 缺 module_splitter');
  assert.ok(tool.description && tool.description.includes('analyze'), '描述应含三子命令');
  for (const k of ['command', 'file', 'plan', 'dryRun']) {
    assert.ok(tool.parameters[k], `缺参数 ${k}`);
  }
});

test('module_splitter：tool-call 分发 case 存在', () => {
  const src = readFileSync(join(rootDir, 'lib/app/tool-call.js'), 'utf8');
  assert.match(src, /case 'module_splitter':/, 'tool-call.js 缺 module_splitter case');
  assert.match(src, /spawnSync\('python3'/, '必须 spawn python3（参数数组防注入）');
});

test('module_splitter：CLI 命令 + HELP + parseArgv 兼容', () => {
  const cli = readFileSync(join(rootDir, 'cli.mjs'), 'utf8');
  assert.ok(/cmd === 'module-splitter'/.test(cli) || /\['module-splitter',/.test(cli), 'cli.mjs 缺 module-splitter 分派（if 链或表驱动均可）');
  assert.match(cli, /git-sluice module-splitter <analyze\|split\|verify>/, 'HELP 缺用法行');
  assert.match(cli, /export async function cmdModuleSplitter/, '缺 cmdModuleSplitter 实现');
});

test('module_splitter：脚本存在且随插件同步（SYNC_ENTRIES 覆盖 scripts/）', () => {
  assert.ok(existsSync(join(rootDir, 'scripts/module-splitter.py')), 'scripts/module-splitter.py 缺失');
  assert.ok(SYNC_ENTRIES.includes('scripts'), 'SYNC_ENTRIES 必须含 scripts（module-splitter.py 随插件发布）');
});

test('module_splitter：analyze 真实跑通（python3）', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dshgp-ms-'));
  try {
    const big = join(tmp, 'big.js');
    writeFileSync(big, [
      'import { a } from "./a.js";',
      '',
      'export function runGit() { return a(); }',
      '',
      'export function gitRaw() { return 1; }',
      '',
      'function helper() { return 2; }',
      '',
      'export { helper };',
      '',
    ].join('\n'));
    const r = await cmdModuleSplitter(['analyze', big], {});
    assert.equal(r.ok, true, `analyze 应成功：${JSON.stringify(r).slice(0, 200)}`);
    assert.ok(r.output.includes('runGit'), '输出应含顶层块名 runGit');
    assert.ok(r.output.includes('顶层块'), '输出应含块统计');
    // split --dry-run：预演不落盘
    const planFile = join(tmp, 'plan.json');
    writeFileSync(planFile, JSON.stringify({
      file: big, outdir: join(tmp, 'out'), index: 'index.js', index_header: '/** 出口 */',
      plan: { 'run.js': ['runGit', 'gitRaw'], 'util.js': ['helper'] },
      headers: { 'run.js': '/** 运行 */', 'util.js': '/** 工具 */' }, external: {},
    }));
    const s = await cmdModuleSplitter(['split', planFile], { dryRun: true });
    assert.equal(s.ok, true, `split --dry-run 应成功：${JSON.stringify(s).slice(0, 200)}`);
    assert.ok(s.output.includes('未写盘'), 'dry-run 应声明未写盘');
    assert.equal(existsSync(join(tmp, 'out')), false, 'dry-run 不得落盘');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});