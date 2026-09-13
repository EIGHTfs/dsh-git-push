/**
 * 目录级审计（folder 槽位）作用域与剪枝回归测试（2026-09-13）。
 *
 * 覆盖两处已修复的真实误报缺陷——两者都只在「仓库有依赖目录或回收站」时才暴露，
 *   且报出的都是 warning 级仓库级提示（folder/total-count），会让健康仓库平白多一条问题：
 *
 *   ① 排除目录只按目录**名**过滤、不剪枝递归
 *      原实现先递归收集全部目录，再 `dirs.filter(d => !exclude.has(d.name))`。
 *      只排除名为 node_modules 的那一层，其**子目录**（node_modules/pkg-a）仍被计入源码目录。
 *      实测：树内只有 src、lib 两个真源码目录，却报 9 个 → 任何带依赖的仓库恒定超阈值 30。
 *      同理 folder/file-count-per-dir 会把 node_modules 里的大目录当「单目录文件过多」报出。
 *
 *   ② 回收站 `.trash` 未排除
 *      `.trash/` 是安全删除约定的回收站（.gitignore 已忽略），是回收站不是源码，
 *      计入会随备份次数虚增目录数。
 *
 * 断言用临时目录构造受控目录树，不依赖本仓库当前目录结构。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkFolderRules } from '../lib/checks/folder.js';

/** 造一棵受控目录树，跑 folder/total-count 规则，返回「计入的源码目录数」（不超阈值时为 null）。 */
function countSourceDirs(tree, { threshold = 1, excludeDirs = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-folder-'));
  try {
    for (const rel of tree) {
      if (rel.endsWith('/')) mkdirSync(join(root, rel), { recursive: true });
      else { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), 'x\n'); }
    }
    const rules = [{
      id: 'folder/total-count', threshold, severity: 'warning',
      message: '项目源码目录数 {count} 超过阈值 {threshold}',
      excludeDirs,
    }];
    const f = checkFolderRules({ root, rules, gitignoreText: '' });
    if (!f.length) return null; // 未超阈值 → 无法从消息反推，调用方给足够小的阈值
    const m = /项目源码目录数 (\d+)/.exec(f[0].message);
    return m ? Number(m[1]) : null;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const BASE_EXCLUDES = ['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '__pycache__', '.dsh', '.trash'];

test('folder/total-count：被排除目录的子目录不计入源码目录数（剪枝）', () => {
  // 真源码目录只有 src、lib；node_modules/pkg-a、node_modules/pkg-b/node_modules/nested、
  // dist/sub、coverage/x 都是被排除目录的后代 → 一个都不该计入。
  const n = countSourceDirs([
    'src/', 'lib/',
    'node_modules/pkg-a/', 'node_modules/pkg-b/node_modules/nested/',
    'dist/sub/', 'coverage/x/', 'build/out/',
    'src/a.js',
  ], { threshold: 1, excludeDirs: BASE_EXCLUDES });
  assert.equal(n, 2, `应只计入 src 与 lib 两个源码目录，实际计入 ${n} 个（排除目录未被剪枝）`);
});

test('folder/total-count：.trash 回收站不计入源码目录数', () => {
  const n = countSourceDirs([
    'src/', 'lib/',
    '.trash/20260913-backup/', '.trash/20260913-backup/nested/',
    'src/a.js',
  ], { threshold: 1, excludeDirs: BASE_EXCLUDES });
  assert.equal(n, 2, `.trash 是回收站（gitignore），不应计入源码目录，实际计入 ${n} 个`);
});

test('folder/total-count：未在排除清单里的目录照常计入（防止剪枝过度而漏报）', () => {
  // 计入 6 个：src、lib、apps、packages、packages/core、packages/ui
  //   （packages/ 虽未显式建，但 packages/core/ 隐含它，剪枝不应误删中间层）
  const n = countSourceDirs([
    'src/', 'lib/', 'apps/', 'packages/core/', 'packages/ui/',
    'src/a.js',
  ], { threshold: 1, excludeDirs: BASE_EXCLUDES });
  assert.equal(n, 6, `apps/packages 等未排除目录应正常计入，实际 ${n} 个`);
});

test('folder/total-count：排除目录内的文件也不参与单目录文件数统计', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-perdir-'));
  try {
    // node_modules 里放 5 个文件，阈值 3 → 若未剪枝会被报「单目录文件过多」
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    for (let i = 0; i < 5; i++) writeFileSync(join(root, 'node_modules', 'pkg', `f${i}.js`), 'x\n');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.js'), 'x\n');
    const rules = [
      { id: 'folder/total-count', threshold: 99, severity: 'warning', message: '{count}/{threshold}', excludeDirs: BASE_EXCLUDES },
      { id: 'folder/file-count-per-dir', threshold: 3, severity: 'warning', message: '目录 {path} 包含 {count} 个文件，超过阈值 {threshold}', excludeDirs: BASE_EXCLUDES },
    ];
    const findings = checkFolderRules({ root, rules, gitignoreText: '' });
    const perDir = findings.filter((f) => f.rule === 'folder/file-count-per-dir');
    assert.equal(perDir.length, 0, `node_modules 内目录不应计入单目录文件数，实际报出 ${perDir.length} 条`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('folder/total-count：超阈值时消息里的计数与实际源码目录数一致', () => {
  const n = countSourceDirs(['a/', 'b/', 'c/', 'a/x.js'], { threshold: 2, excludeDirs: BASE_EXCLUDES });
  assert.equal(n, 3, `应为 3 个源码目录，实际 ${n} 个`);
});
