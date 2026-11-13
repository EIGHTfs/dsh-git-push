/**
 * 软链接安装依赖解析测试（复现 DSH 插件软链安装场景）：
 * profiles/web/node_modules/dsh-git-push -> ../../../../工作区/dsh-git-push（软链），
 * 而工作区没有 node_modules → 默认解析按软链 realpath（工作区）向上找依赖 → MODULE_NOT_FOUND。
 * 本测试在临时目录模拟同样的结构，断言两种能让软链接正确解析依赖的方式：
 *   ① node --preserve-symlinks（按软链所在层向上找 node_modules，依赖在软链层 → 命中）；
 *   ② NODE_PATH 指向软链所在层的 node_modules（realpath 解析仍会查 NODE_PATH → 命中）。
 * 修复方向对照：软链目标若是真实目录副本（local-plugins），向上可到 profiles/web/node_modules，
 *   依赖命中；软链目标是工作区则必须靠上述两种机制之一。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const NODE = process.execPath;

/**
 * 构造模拟夹具：软链所在层 install/node_modules（有依赖）+ 软链目标 real-target（无 node_modules）。
 * 结构与真实场景一致：real-target 与 install 平级，root 下无 node_modules，
 * 因此默认解析（realpath 到 real-target 向上找）必然失败，只有 --preserve-symlinks / NODE_PATH 才命中依赖。
 */
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'dshg-symlink-'));
  const installDir = join(root, 'install');                 // 模拟 profiles/web（软链所在层）
  const nm = join(installDir, 'node_modules');              // 模拟 profiles/web/node_modules（依赖所在层）
  const realTarget = join(root, 'real-target');             // 模拟工作区（软链目标，无 node_modules）
  // 依赖只装在软链所在层
  mkdirSync(join(nm, 'fake-react'), { recursive: true });
  writeFileSync(join(nm, 'fake-react', 'package.json'), JSON.stringify({ name: 'fake-react', main: 'index.js' }));
  writeFileSync(join(nm, 'fake-react', 'index.js'), 'module.exports = { from: "node_modules-layer" };\n');
  // 软链目标：包本体，index.js 依赖 fake-react
  mkdirSync(realTarget, { recursive: true });
  writeFileSync(join(realTarget, 'package.json'), JSON.stringify({ name: 'pkg', main: 'index.js' }));
  writeFileSync(join(realTarget, 'index.js'), 'module.exports = require("fake-react");\n');
  // 软链：install/node_modules/pkg -> real-target
  symlinkSync(realTarget, join(nm, 'pkg'));
  return { root, nm, pkgPath: join(nm, 'pkg') };
}

function runNode(args, env) {
  return spawnSync(NODE, args, { encoding: 'utf8', env: { ...process.env, ...env } });
}

test('软链复现：默认解析按 realpath 向上找依赖 → MODULE_NOT_FOUND', () => {
  const { root, pkgPath } = buildFixture();
  try {
    const r = runNode(['-e', `console.log(JSON.stringify(require(${JSON.stringify(pkgPath)})))`]);
    assert.notEqual(r.status, 0, `默认模式应失败，实际 status=${r.status} stdout=${r.stdout}`);
    assert.match(`${r.stderr}\n${r.stdout}`, /Cannot find module|MODULE_NOT_FOUND/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('软链修复①：--preserve-symlinks 按软链所在层解析 → 依赖命中', () => {
  const { root, pkgPath } = buildFixture();
  try {
    const r = runNode(['--preserve-symlinks', '-e', `console.log(JSON.stringify(require(${JSON.stringify(pkgPath)})))`]);
    assert.equal(r.status, 0, `--preserve-symlinks 应成功：stderr=${r.stderr}`);
    const parsed = JSON.parse(r.stdout.trim());
    assert.equal(parsed.from, 'node_modules-layer');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('软链修复②：NODE_PATH 指向软链所在层 node_modules → 依赖命中', () => {
  const { root, nm, pkgPath } = buildFixture();
  try {
    const r = runNode(['-e', `console.log(JSON.stringify(require(${JSON.stringify(pkgPath)})))`], { NODE_PATH: nm });
    assert.equal(r.status, 0, `NODE_PATH 应成功：stderr=${r.stderr}`);
    const parsed = JSON.parse(r.stdout.trim());
    assert.equal(parsed.from, 'node_modules-layer');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('软链对照：软链目标自身带 node_modules 时默认即可解析（真实目录副本场景）', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshg-symlink-'));
  const nm = join(root, 'node_modules');
  const realTarget = join(root, 'real-target');
  try {
    // 依赖装在软链目标内（模拟 local-plugins 真实副本自含依赖）
    mkdirSync(join(realTarget, 'node_modules', 'fake-react'), { recursive: true });
    writeFileSync(join(realTarget, 'node_modules', 'fake-react', 'package.json'), JSON.stringify({ name: 'fake-react', main: 'index.js' }));
    writeFileSync(join(realTarget, 'node_modules', 'fake-react', 'index.js'), 'module.exports = { from: "real-target" };\n');
    writeFileSync(join(realTarget, 'package.json'), JSON.stringify({ name: 'pkg', main: 'index.js' }));
    writeFileSync(join(realTarget, 'index.js'), 'module.exports = require("fake-react");\n');
    mkdirSync(nm, { recursive: true });
    symlinkSync(realTarget, join(nm, 'pkg'));
    const pkgPath = join(nm, 'pkg');
    const r = runNode(['-e', `console.log(JSON.stringify(require(${JSON.stringify(pkgPath)})))`]);
    assert.equal(r.status, 0, `真实副本默认应成功：stderr=${r.stderr}`);
    const parsed = JSON.parse(r.stdout.trim());
    assert.equal(parsed.from, 'real-target');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
