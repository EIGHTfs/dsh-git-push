// dsh-git-push 测试：scripts/doc-version.mjs（版本列表生成器，2026-09-29）
/**
 * 覆盖：buildVersionListText / applyVersionBlock / checkVersionDrift
 * （gen/apply/check 闭环 + 复用 readme-gen 版本聚合）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { buildVersionListText, applyVersionBlock, checkVersionDrift } from '../scripts/doc-version.mjs';
import { findMarkedHostMd } from '../scripts/doc-tree.mjs';

// 项目根：end-to-end 用例直接查真实仓库的版本列表与 git log 聚合是否一致
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const mkTmp = () => mkdtempSync(join(tmpdir(), 'dshgp-docver-'));

// end-to-end：真实项目根的版本列表必须与**文件源**（package.json + docs/releases.json）一致。
//   为什么放测试里：doc-version check 只是脚本，不跑就没人发现漂移；改成测试后
//   每次全量测试都会拦住「改了版本/releases.json 但没同步版本表」。
//   2026-10-16：**不再以 git log 为判据**——普通提交不该动版本表，也不该逼人为门禁升版本。
test('end-to-end：真实项目根 checkVersionDrift 无漂移（版本表与文件源一致）', () => {
  const host = findMarkedHostMd(ROOT, 'dshgp-version');
  const r = checkVersionDrift({ hostPath: host, root: ROOT });
  assert.equal(r.ok, true, `版本列表漂移（先跑 doc-version.mjs apply）：${JSON.stringify(r.issues)}`);
});

/** 建 git 仓库 + 两条带版本号的提交。 */
function gitRepoWithVersions(dir) {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@e.com', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"demo","version":"1.0.1"}\n');
  execSync('git add -A && git commit -qm "chore(1.0.0): init"', { cwd: dir });
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  execSync('git add -A && git commit -qm "feat(1.0.1): add a"', { cwd: dir });
}

test('doc-version：buildVersionListText 由文件（package.json + docs/releases.json）生成版本表', () => {
  const dir = mkTmp();
  try {
    gitRepoWithVersions(dir);
    const r = buildVersionListText(dir);
    assert.match(r.text, /\| 版本 \| 内容 \|/, '应含表头');
    // 2026-10-16：改为文件驱动断言——行内容来自 docs/releases.json + 当前版本（package.json 真源），
    //   与 git log 无关（普通提交不改表）
    assert.match(r.text, /1\.0\.1/, '应含当前版本 1.0.1 行（package.json 真源）');
    assert.equal(r.source, 'package.json', '版本源应识别为 package.json');
    assert.ok(r.rows >= 1, '应至少 1 版本行');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('doc-version：applyVersionBlock 替换块 / 无块追加', () => {
  const dir = mkTmp();
  try {
    const withBlock = '# x\n<!-- dshgp-version:start -->\nold\n<!-- dshgp-version:end -->\n';
    const after = applyVersionBlock(withBlock, '## 版本列表\nnew');
    assert.ok(after.includes('new') && !after.includes('old'));
    const noBlock = '# x\n';
    const added = applyVersionBlock(noBlock, '## 版本列表\nfresh');
    assert.ok(added.includes('dshgp-version:start') && added.includes('fresh'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('doc-version：checkVersionDrift 无块报 no-block，apply 后一致', () => {
  const dir = mkTmp();
  try {
    gitRepoWithVersions(dir);
    const host = join(dir, 'README.md');
    writeFileSync(host, '# demo\n');
    let r = checkVersionDrift({ hostPath: host, root: dir });
    assert.equal(r.ok, false, '无块应报 no-block');
    assert.match(JSON.stringify(r.issues), /no-block/);
    const { text } = buildVersionListText(dir);
    writeFileSync(host, applyVersionBlock(readFileSync(host, 'utf8'), text), 'utf8');
    r = checkVersionDrift({ hostPath: host, root: dir });
    assert.equal(r.ok, true, 'apply 后应一致');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
