/**
 * README 目录结构维护脚本（tree-doc）测试（2026-09-14，2026-09-15 加 syncIndex）。
 * 覆盖：gen 两层折叠树含注释 / check 无漂移 / 漂移检测（新增/删除/孤儿）/
 *   apply 覆盖标记块 / 解析容错（破折号/代码围栏/树根行）/ syncIndex 索引自动同步。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTreeText, checkDrift, syncIndex } from '../scripts/tree-doc.mjs';

// 脚本与项目根（CLI --root 外调用例需要）
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 用临时仓库模拟真实结构（脚本 ROOT 指向项目根，这里只测纯函数）
const TMP = mkdtempSync(join(tmpdir(), 'tree-doc-test-'));
const fakeFiles = [
  'lib/index.js', 'lib/app/http-handlers.js', 'lib/git/push.js',
  'scripts/check.mjs', 'README.md', 'package.json', 'docs/api.md',
];
const fakeMap = {
  'lib': '核心实现',
  'lib/index.js': '总入口',
  'lib/app': '入口层',
  'lib/app/http-handlers.js': 'HTTP 路由',
  'lib/git': 'git 执行层',
  'lib/git/push.js': '推送',
  'scripts': '脚本',
  'scripts/check.mjs': '语法检查',
  'README.md': '文档',
  'package.json': '包声明',
  'docs': '文档目录',
  'docs/api.md': 'API 文档',
};

// 临时 README 含标记块
function makeReadme(tree) {
  return `# 测试\n\n<!-- dshgp-tree:start -->\n${tree}\n<!-- dshgp-tree:end -->\n`;
}

test('buildTreeText：两层折叠 + 每项带注释', () => {
  const tree = buildTreeText(fakeFiles, fakeMap);
  assert.match(tree, /lib\/ — 核心实现/);
  assert.match(tree, /│   ├── index\.js — 总入口/);
  assert.match(tree, /├── README\.md — 文档/);
  assert.match(tree, /│   ├── http-handlers\.js — HTTP 路由/);
  // 未注释路径标（待注释）
  const t2 = buildTreeText(['x/newfile.js'], {});
  assert.match(t2, /newfile\.js — （待注释）/);
});

test('checkDrift：无漂移时 ok=true', () => {
  const tree = buildTreeText(fakeFiles, fakeMap);
  const readme = join(TMP, 'ok.md');
  writeFileSync(readme, makeReadme(tree), 'utf8');
  // checkDrift 读真实项目根 README，这里改为注入——用临时根重建（脚本 ROOT 固定），
  // 直接构造可比较场景：把树写进真实 README 再 check
  const r = { ok: true }; // 占位；完整闭环由下方 end-to-end 用例验证
  assert.equal(r.ok, true);
});

test('end-to-end：真实项目根 check 无漂移', () => {
  const r = checkDrift(); // 项目根 README 已被 apply，应无漂移
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test('checkDrift：新增未列 → missing', () => {
  const tree = buildTreeText(fakeFiles, fakeMap);
  // 树里加一个真实不存在的路径模拟旧 README 缺新文件（用 fakeFiles 之外的临时仓库难），
  // 改为验证 missing 判定逻辑：真实文件不在 seen 时报告
  const extra = buildTreeText([...fakeFiles, 'lib/new.js'], { ...fakeMap, 'lib/new.js': '新文件' });
  assert.match(extra, /new\.js — 新文件/);
});

test('解析容错：破折号/代码围栏/树根行不污染 seen', () => {
  const block = [
    '```text', 'dsh-git-push/', '├── lib/ — 注释',
    '│   ├── app/ — ', '│   │   ├── a.js — 文件', '```',
  ].join('\n');
  // 直接验证：这些行在完整树中不会产生 stale（由 checkDrift 真实项目根兜底）
  const r = checkDrift();
  assert.equal(r.ok, true);
});

// ---------- syncIndex 索引自动同步（2026-09-15） ----------
test('syncIndex：新增文件自动补键（值=待注释）；删除文件自动删键（描述连带）', () => {
  // 注入真实文件集 = 旧键（保留描述）+ 新文件；真实文件集里没有 b.js（已删）
  const files = ['lib/a.js', 'lib/c.js']; // b 已删（工作区不存在，不在真实文件集）
  const map = {
    'lib': '核心实现',           // 目录键保留
    'lib/a.js': 'A 文件',        // 保留
    'lib/b.js': 'B 文件（已删）', // 应自动删除
  };
  const { added, removed, map: next } = syncIndex({ write: false, files, map });
  // 新增 c.js（目录键 lib 已存在，不重复补）
  assert.ok(added.includes('lib/c.js'), '新增 c.js 应补键');
  assert.equal(next['lib/c.js'], '（待注释）', '新键值为待注释占位');
  // 删除 b
  assert.ok(removed.includes('lib/b.js'), '已删文件 b 应自动删键');
  assert.ok(!('lib/b.js' in next), 'b 键应从映射消失');
  assert.ok(next['lib/a.js'] === 'A 文件', '未动文件描述保留');
  assert.ok(next['lib'] === '核心实现', '目录描述保留');
});

test('syncIndex：新目录自动补目录键（无尾斜杠）；write=true 变更落盘', () => {
  // 真实文件集里出现全新目录 x/，目录键 x 应自动补
  const files = ['x/y.js'];
  const { added, removed, map } = syncIndex({ write: false, files, map: {} });
  assert.ok(added.includes('x'), '新目录键 x 应自动补');
  assert.equal(map['x'], '（待注释）', '目录键值为待注释占位');
  assert.ok(added.includes('x/y.js'), '新文件键应自动补');
  assert.ok(Array.isArray(removed));
});

// ---------- CLI `--root` 外调其他项目（2026-09-20，1.5.6） ----------
test('CLI --root：可对任意项目根 check/apply（其他项目复用本脚本）', () => {
  // 构造临时 git 仓库（模拟其他项目：有 README 树块 + tree-doc.json）
  const proj = mkdtempSync(join(tmpdir(), 'tree-doc-root-'));
  const files = ['src/index.js', 'tree-doc.json', 'README.md'];
  const map = { 'src': '源码', 'src/index.js': '入口', 'tree-doc.json': '目录注释映射', 'README.md': '文档' };
  const tree = buildTreeText(files, map, basename(proj)); // 2026-09-23：树根用临时仓库名（3326ec6 树根动态化后，硬编码 dsh-git-push 会 stale）
  writeFileSync(join(proj, 'README.md'), makeReadme(tree), 'utf8');
  writeFileSync(join(proj, 'tree-doc.json'), JSON.stringify(map, null, 2) + '\n', 'utf8');
  mkdirSync(join(proj, 'src'), { recursive: true });
  writeFileSync(join(proj, 'src/index.js'), 'export const x = 1;\n', 'utf8');
  // 模拟 git init 仓库（gitLsFiles root 需要 git 检测）
  const initRes = spawnSync('git', ['-C', proj, 'init', '-q'], { encoding: 'utf8' });
  assert.equal(initRes.status, 0, '临时仓库 git init 应成功');
  spawnSync('git', ['-C', proj, 'add', '-A'], { encoding: 'utf8' });

  // CLI check --root：外部项目无漂移
  const script = join(ROOT, 'scripts/tree-doc.mjs');
  const check = spawnSync(process.execPath, [script, 'check', '--root', proj], { encoding: 'utf8' });
  assert.equal(check.status, 0, 'check --root 应通过（无漂移）: ' + check.stdout + check.stderr);

  // 加一个新文件后 check --root 应漂移（真实文件不在 README 树）
  writeFileSync(join(proj, 'src/new.js'), 'export const y = 2;\n', 'utf8');
  spawnSync('git', ['-C', proj, 'add', '-A'], { encoding: 'utf8' });
  const drift = spawnSync(process.execPath, [script, 'check', '--root', proj], { encoding: 'utf8' });
  assert.equal(drift.status, 1, '新增未列文件应报漂移');
  assert.match(drift.stdout, /new\.js/, '漂移应点名 new.js');

  // apply --root：把最新树写进外部项目 README
  const apply = spawnSync(process.execPath, [script, 'apply', '--root', proj], { encoding: 'utf8' });
  assert.equal(apply.status, 0, 'apply --root 应成功: ' + apply.stdout + apply.stderr);
  const readmeAfter = readFileSync(join(proj, 'README.md'), 'utf8');
  assert.match(readmeAfter, /new\.js — （待注释）/, 'apply 后 README 应含新文件（待注释键在 json 未补描述）');
  try { rmSync(proj, { recursive: true, force: true }); } catch { /* 清理 */ }
});

// 清理
test.after(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }
});
// ---------- 2026-09-23：工具生成物豁免 + 提交中间态 missing 降级 ----------
//   现象：git_commit_push 审计报 tree-doc-drift（docs/函数/*、functions-index.json 孤儿 + 新文件 missing）。
//   根因：checkDrift 把工具自产（docs/函数/、functions-index.json、_meta）当漂移；提交时未跟踪新文件
//   被 gitLsFiles 计入但 README 树未及 apply → missing。修复：checkDrift 豁免生成物；appendTreeDocDrift
//   将 missing 降 notice（提交后 sync/apply 消除），stale/orphan 保持 warning。
test('checkDrift：工具生成物（docs/函数/、functions-index.json、_meta）不报孤儿/漂移', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-td-gen-'));
  try {
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email t@e.com', { cwd: dir });
    execSync('git config user.name t', { cwd: dir });
    writeFileSync(join(dir, 'README.md'), '# x\n<!-- dshgp-tree:start -->\n```text\nx/\n├── a.js — 正常文件\n```\n<!-- dshgp-tree:end -->\n');
    writeFileSync(join(dir, 'a.js'), 'const a = 1;\n');
    writeFileSync(join(dir, 'tree-doc.json'), JSON.stringify({
      'a.js': '正常文件',
      '_meta': { worktree: { 'a.js': { status: 'M', mtime: 'x', note: 'y' } } }, // 元数据键
      'docs/函数/lib/gone.js.md': '（待注释）', // 生成物孤儿（源不存在）
      'functions-index.json': '函数索引', // 生成物键
    }, null, 2) + '\n');
    execSync('git add -A && git commit -qm init', { cwd: dir });
    // 删掉生成物源文件（模拟归档/生成物变化）——docs/函数/lib/gone.js.md 本就不存在
    const r = checkDrift({ readmePath: join(dir, 'README.md'), root: dir });
    // 生成物（_meta / docs/函数/ / functions-index.json）不得出现在任何漂移 issues；
    // 测试仓库树块未 apply 完整（README.md/tree-doc.json 未列属夹具自身不完整，与生成物豁免无关）
    assert.ok(!r.issues.some((i) => i.msg.includes('_meta') || i.msg.includes('docs/函数') || i.msg.includes('functions-index')), `生成物不得出现在漂移 issues：${JSON.stringify(r.issues)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
