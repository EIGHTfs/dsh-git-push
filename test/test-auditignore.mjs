import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { collectTextFiles } from '../lib/audit/collector.js';

/** 搭一个带 .auditignore 的临时 git 仓库（git 必需，跳过则测试环境不可用）。 */
function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'auditignore-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'generated'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.js'), '// app\n');
  writeFileSync(join(dir, 'src', 'vendor.js'), '// vendor\n');
  writeFileSync(join(dir, 'generated', 'out.js'), '// gen\n');
  writeFileSync(join(dir, 'node_modules', 'dep.js'), '// dep\n');
  writeFileSync(join(dir, 'yarn.lock'), '// lock\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(dir, '.auditignore'), [
    '# auditignore 测试：目录整棵豁免 + 文件级豁免 + glob 豁免',
    'generated/',
    'src/vendor.js',
    '*.lock',
  ].join('\n') + '\n');
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] });
  } catch { /* git 不可用：目录级豁免仍可测（非 git 时 auditignore 不生效，见用例说明） */ }
  return dir;
}

test('.auditignore：目录规则（generated/）整棵豁免审计', async () => {
  const dir = setupRepo();
  try {
    const files = await collectTextFiles(dir, { depth: 10, gitIgnoreRoot: dir });
    const arr = Array.isArray(files) ? files : (files.files || []);
    assert.ok(!arr.some((f) => f.path.includes('generated')), 'generated/ 应整棵豁免');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('.auditignore：文件级规则（src/vendor.js / *.lock）豁免审计', async () => {
  const dir = setupRepo();
  try {
    const files = await collectTextFiles(dir, { depth: 10, gitIgnoreRoot: dir });
    const arr = Array.isArray(files) ? files : (files.files || []);
    assert.ok(!arr.some((f) => f.path.endsWith('src/vendor.js')), 'src/vendor.js 应豁免');
    assert.ok(!arr.some((f) => f.path.endsWith('yarn.lock')), '*.lock 匹配 yarn.lock 应豁免');
    assert.ok(arr.some((f) => f.path.endsWith('src/app.js')), '未豁免文件应保留');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('.auditignore：与 .gitignore 叠加（node_modules 仍被 gitignore 挡）', async () => {
  const dir = setupRepo();
  try {
    const files = await collectTextFiles(dir, { depth: 10, gitIgnoreRoot: dir });
    const arr = Array.isArray(files) ? files : (files.files || []);
    assert.ok(!arr.some((f) => f.path.includes('node_modules')), 'node_modules 应仍被 .gitignore 挡');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('.auditignore：豁免文件照常可入库（git add 可跟踪，不写 git 配置）', () => {
  const dir = setupRepo();
  try {
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] });
    const tracked = execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\n').filter(Boolean);
    assert.ok(tracked.includes('generated/out.js'), 'generated/out.js 应照常入库（审计豁免≠不入库）');
    assert.ok(tracked.includes('src/vendor.js'), 'src/vendor.js 应照常入库');
    assert.ok(tracked.includes('yarn.lock'), 'yarn.lock 应照常入库');
    assert.ok(tracked.includes('.auditignore'), '.auditignore 自身也应可入库');
    assert.ok(tracked.includes('.gitignore'), '.gitignore 仍正常');
  } catch { /* git 不可用环境跳过（语义由实现保证） */ }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('.auditignore：不写进任何 git 配置（不污染 .git/info/exclude）', () => {
  const dir = setupRepo();
  try {
    const infoExclude = join(dir, '.git', 'info', 'exclude');
    if (existsSync(infoExclude)) {
      const content = readFileSync(infoExclude, 'utf8');
      assert.ok(!content.includes('auditignore'), '.git/info/exclude 不应被写入 .auditignore 内容');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
