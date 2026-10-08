/**
 * 跨平台可移植性扫描器（scripts/platform-scan.mjs）回归测试。
 *
 * 钉子：
 *   ① 能抓到「只在 POSIX 成立」的写法（/tmp、sh -c 与 argv 形态、PATH.split(':')）
 *   ② 能抓到「只在 Windows 成立」的写法（盘符路径、cmd /c、.exe）
 *   ③ 注释里的命中降级为 info（说明性文字，不算代码问题）
 *   ④ 跨平台写法（os.tmpdir()/path.delimiter/process.platform 分支）不算问题、计入 gated
 *   ⑤ 只扫源码扩展名、跳过 node_modules/.git 等
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { scanPlatformCode } from '../scripts/platform-scan.mjs';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';

/** 造一个含各类平台写法的小工程。 */
function makeProject() {
  const root = mkdtempTracked('plat-');
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(join(root, 'lib', 'posix.js'), [
    "import { execFileSync } from 'node:child_process';",
    "const dirs = process.env.PATH.split(':');",
    "const cache = '/tmp/x/cache';",
    "execFileSync('sh', ['-c', 'echo hi']);",
    "const bin = '/usr/bin/git';",
  ].join('\n'));
  writeFileSync(join(root, 'lib', 'win.js'), [
    "const p = 'C:\\\\Windows\\\\System32';",
    "execFileSync('cmd', ['/c', 'dir']);",
    "const exe = 'tool.exe';",
  ].join('\n'));
  writeFileSync(join(root, 'lib', 'ok.js'), [
    "import os from 'node:os';",
    "import path from 'node:path';",
    "const dir = path.join(os.tmpdir(), 'x');",
    "const parts = (process.env.PATH || '').split(path.delimiter);",
    "if (process.platform === 'win32') { /* 平台分支 */ }",
    "// 注释示例：const p = '/tmp/x'; const w = 'C:\\\\Windows';（应只算提示）",
  ].join('\n'));
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'x', 'skip.js'), "const a = '/tmp/should-not-scan';");
  return root;
}

test('scanPlatformCode：POSIX 专属写法被抓到（含 argv 形态与 PATH 切分）', () => {
  const root = makeProject();
  const r = scanPlatformCode(root);
  const ids = r.findings.filter((f) => f.file === 'lib/posix.js').map((f) => f.rule);
  assert.ok(ids.includes('path-split-colon'), 'PATH.split(\':\') 必须被抓（Windows 用 ;）');
  assert.ok(ids.includes('posix-tmp'), '/tmp 硬编码必须被抓');
  assert.ok(ids.includes('posix-shell'), "execFileSync('sh', ['-c', ...]) 必须被抓");
  assert.ok(ids.includes('posix-abs'), '/usr/bin/git 必须被抓');
});

test('scanPlatformCode：Windows 专属写法被抓到', () => {
  const root = makeProject();
  const r = scanPlatformCode(root);
  const ids = r.findings.filter((f) => f.file === 'lib/win.js').map((f) => f.rule);
  assert.ok(ids.includes('win-drive'), '盘符路径必须被抓');
  assert.ok(ids.includes('win-cmd'), 'cmd /c 必须被抓');
  assert.ok(ids.includes('win-exe'), '.exe 字面量必须被抓');
});

test('scanPlatformCode：注释命中降级为 info，跨平台写法计入 gated 而非问题', () => {
  const root = makeProject();
  const r = scanPlatformCode(root);
  const commented = r.findings.filter((f) => f.file === 'lib/ok.js' && f.inComment && f.category !== 'gated');
  assert.ok(commented.length > 0, '注释里的 /tmp 与盘符应被记录');
  assert.ok(commented.every((f) => f.severity === 'info'), '注释命中必须是 info（不算代码问题）');
  const gated = r.findings.filter((f) => f.file === 'lib/ok.js' && f.category === 'gated');
  assert.ok(gated.length >= 3, 'os.tmpdir()/path.delimiter/process.platform 分支都应计入 gated');
  // 该文件不应产生「代码里的平台专属写法」
  const actionable = r.findings.filter((f) => f.file === 'lib/ok.js' && f.category !== 'gated' && !f.inComment && f.severity !== 'info');
  assert.equal(actionable.length, 0, '跨平台正确写法不得被判为问题');
});

test('scanPlatformCode：跳过 node_modules 等目录，且汇总统计可用', () => {
  const root = makeProject();
  const r = scanPlatformCode(root);
  assert.ok(!r.findings.some((f) => f.file.startsWith('node_modules/')), 'node_modules 必须跳过');
  assert.ok(r.summary.actionable > 0, '应有可执行的问题项');
  assert.ok(r.summary.filesAffected >= 2, '至少涉及 posix.js 与 win.js');
  assert.equal(r.summary.byCategory.gated > 0, true, '应统计已平台分支的正面写法');
});

test('scanPlatformCode：可注入扩展名（默认只扫源码类）', () => {
  const root = makeProject();
  writeFileSync(join(root, 'notes.txt'), "const p = '/tmp/not-scanned';");
  const def = scanPlatformCode(root);
  assert.ok(!def.findings.some((f) => f.file.endsWith('.txt')), '默认不扫 .txt');
  const withTxt = scanPlatformCode(root, { exts: ['.txt'] });
  assert.ok(withTxt.findings.some((f) => f.file.endsWith('.txt')), '显式指定扩展名后应扫到');
  rmSync(join(root, 'notes.txt'), { force: true });
});
