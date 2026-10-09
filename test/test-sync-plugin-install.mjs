// 插件安装形态与 HMR 自检的单元测试（纯 Node，用临时目录造 profile，不碰真实数据）。
//
// 覆盖（对应 sync-plugin-install.mjs 的对外能力）：
//   ① dshRootOf 两种入参形态（DSH_HOME 本尊 / 已含 .dsh）
//   ② readHmrConfig + judgeHmr：root 为空 ⇒ 不可热重载；root 覆盖 local-plugins ⇒ 可；只在 node_modules ⇒ 不可
//   ③ planInstall：绝对软链 ⇒ 应改相对链；缺 node_modules ⇒ 应建链；local-plugins 是软链 ⇒ 应解链
//   ④ applyInstall：默认不动盘；on=true 才把软链改成相对链
//   ⑤ depHints：link:绝对路径 ⇒ 提示改 file:local-plugins/<插件>
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, lstatSync, readlinkSync } from 'node:fs';import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dshRootOf, readHmrConfig, judgeHmr, planInstall, applyInstall, depHints, pickProfile, inspectProfiles } from '../scripts/sync-plugin-install.mjs';

/** 造一个假 DSH_HOME：<tmp>/.dsh/profiles/web（withDsh=false 时目录结构只到 <tmp>/profiles/web）。 */
function fakeHome({ profile = 'web' } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-sync-install-'));
  const dsh = join(tmp, '.dsh');
  const pd = join(dsh, 'profiles', profile);
  mkdirSync(join(pd, 'local-plugins'), { recursive: true });
  mkdirSync(join(pd, 'node_modules'), { recursive: true });
  return { tmp, dsh, pd };
}
const clean = (p) => { try { rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } };

test('dshRootOf：DSH_HOME 本尊与已含 .dsh 两种形态都能定位', () => {
  const { tmp, dsh } = fakeHome();
  try {
    assert.equal(dshRootOf(tmp), dsh, 'DSH_HOME 本尊（不含 .dsh）应补出 .dsh');
    assert.equal(dshRootOf(dsh), dsh, '已含 .dsh 的路径应原样使用');
  } finally { clean(tmp); }
});

test('judgeHmr：root 为空 ⇒ 不可热重载（module roots are opt-in）', () => {
  const { tmp, pd } = fakeHome();
  try {
    writeFileSync(join(pd, 'cordis.patch.yml'), '- id: hmr\n  config:\n    base: ' + pd + '\n    root: []\n', 'utf8');
    mkdirSync(join(pd, 'local-plugins', 'p1'), { recursive: true });
    const hmr = readHmrConfig(pd);
    const r = judgeHmr({ hmr, profileDir: pd, pluginName: 'p1' });
    assert.equal(r.hot, false);
    assert.match(r.reason, /root 为空|opt-in/);
  } finally { clean(tmp); }
});

test('judgeHmr：root 覆盖 local-plugins ⇒ 可热重载；只在 node_modules ⇒ 不可', () => {
  const { tmp, pd } = fakeHome();
  try {
    writeFileSync(join(pd, 'cordis.patch.yml'), `- id: hmr\n  config:\n    base: ${pd}\n    root:\n      - local-plugins\n`, 'utf8');
    mkdirSync(join(pd, 'local-plugins', 'p1'), { recursive: true });
    const hmr = readHmrConfig(pd);
    assert.equal(readHmrConfig(pd).base, pd);
    assert.equal(judgeHmr({ hmr, profileDir: pd, pluginName: 'p1' }).hot, true);
    // 只存在 node_modules 形态
    mkdirSync(join(pd, 'node_modules', 'p2'), { recursive: true });
    const r2 = judgeHmr({ hmr, profileDir: pd, pluginName: 'p2' });
    assert.equal(r2.hot, false);
    assert.match(r2.reason, /node_modules|剪枝|覆盖范围/);
  } finally { clean(tmp); }
});

test('planInstall：绝对软链⇒relink；缺链⇒link；local 是软链⇒delink', () => {
  const { tmp, pd } = fakeHome();
  try {
    const outside = join(tmp, 'outside-plugin');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(pd, 'node_modules', 'p1'));           // 绝对软链
    const a1 = planInstall({ profileDir: pd, pluginName: 'p1' }).map((x) => x.kind);
    assert.ok(a1.includes('relink-nm'), '绝对软链应提示改相对链');
    assert.ok(a1.includes('create-local'), 'local-plugins 缺 ⇒ 应提示建真实目录');
    // 换成「已有 local 真实目录 + 完全缺 node_modules」
    mkdirSync(join(pd, 'local-plugins', 'p1'), { recursive: true });
    rmSync(join(pd, 'node_modules', 'p1'));
    assert.deepEqual(planInstall({ profileDir: pd, pluginName: 'p1' }).map((x) => x.kind), ['link-nm']);
    // local-plugins 下是软链 ⇒ delink
    rmSync(join(pd, 'local-plugins', 'p1'), { recursive: true, force: true });
    symlinkSync(outside, join(pd, 'local-plugins', 'p1'));
    assert.ok(planInstall({ profileDir: pd, pluginName: 'p1' }).some((x) => x.kind === 'delink-local'));
  } finally { clean(tmp); }
});

test('applyInstall：默认不写盘；on=true 才把绝对软链改成相对软链', () => {
  const { tmp, pd } = fakeHome();
  try {
    const outside = join(tmp, 'outside-plugin');
    mkdirSync(outside, { recursive: true });
    mkdirSync(join(pd, 'local-plugins', 'p1'), { recursive: true });
    symlinkSync(outside, join(pd, 'node_modules', 'p1'));
    const actions = planInstall({ profileDir: pd, pluginName: 'p1' });
    applyInstall(actions, { on: false });
    assert.equal(lstatSync(join(pd, 'node_modules', 'p1')).isSymbolicLink(), true);
    assert.ok(readlinkSync(join(pd, 'node_modules', 'p1')).startsWith('/'), 'dry-run 不应改动盘上软链');
    applyInstall(actions, { on: true });
    assert.equal(readlinkSync(join(pd, 'node_modules', 'p1')), join('..', 'local-plugins', 'p1'), 'on=true 应改成相对链');
  } finally { clean(tmp); }
});

test('depHints：link:绝对路径应提示改 file:local-plugins/<插件>', () => {
  const { tmp, pd } = fakeHome();
  try {
    writeFileSync(join(pd, 'package.json'), JSON.stringify({ name: 'web', dependencies: { p1: 'link:/abs/path/p1' } }, null, 2), 'utf8');
    const h = depHints(pd, 'p1');
    assert.equal(h.length, 1);
    assert.match(h[0], /file:local-plugins\/p1/);
    writeFileSync(join(pd, 'package.json'), JSON.stringify({ name: 'web', dependencies: { p1: 'file:local-plugins/p1' } }, null, 2), 'utf8');
    assert.deepEqual(depHints(pd, 'p1'), [], '已正确则不应有提示');
  } finally { clean(tmp); }
});

test('pickProfile：优先 local-plugins；多命中要求显式；只在 node_modules 也算命中', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-pick-'));
  const proot = join(tmp, '.dsh', 'profiles');
  for (const n of ['a', 'b']) {
    mkdirSync(join(proot, n, 'local-plugins'), { recursive: true });
    mkdirSync(join(proot, n, 'node_modules'), { recursive: true });
  }
  try {
    // 只有 b 的 local-plugins 有 p1 ⇒ 应选 b（本条正是 dry-run 实测踩到的坑：自动取首个会选到错 profile）
    mkdirSync(join(proot, 'b', 'local-plugins', 'p1'), { recursive: true });
    const r1 = pickProfile(inspectProfiles(tmp), 'p1');
    assert.equal(r1.profile, 'b');
    assert.equal(r1.ambiguous, undefined);
    // 两个 profile 的 local-plugins 都有 ⇒ 要求显式
    mkdirSync(join(proot, 'a', 'local-plugins', 'p1'), { recursive: true });
    assert.equal(pickProfile(inspectProfiles(tmp), 'p1').ambiguous, true);
    // 都只落在 node_modules ⇒ 仍能命中（但理由会提示应迁到 local-plugins）
    rmSync(join(proot, 'a', 'local-plugins', 'p1'), { recursive: true, force: true });
    rmSync(join(proot, 'b', 'local-plugins', 'p1'), { recursive: true, force: true });
    mkdirSync(join(proot, 'a', 'node_modules', 'p2'), { recursive: true });
    const r2 = pickProfile(inspectProfiles(tmp), 'p2');
    assert.equal(r2.profile, 'a');
    assert.match(r2.reason, /node_modules|local-plugins/);
    // 完全没装 ⇒ 不命中
    assert.equal(pickProfile(inspectProfiles(tmp), 'nope').dir, '');
  } finally { clean(tmp); }
});
