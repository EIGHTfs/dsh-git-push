/**
 * Step 5 回归：NPM 面板「构建产物 + 预览页」渲染自检（不依赖浏览器，可在 CI/门禁跑）。
 *
 * 为什么需要：前端改动最容易「代码写了但产物没重建 / 分片没登记 / 面板没挂进标签」——
 *   这类问题静态检查与后端测试都看不见（真实事故：改分片忘跑 build-client 会静默回退旧面板）。
 * 覆盖：① 分片存在且登记进 PART_ORDER ② 产物含 NPM 面板符号与三标签 ③ 产物含 npm token/registry 字段 id
 *   ④ 预览页（若存在）含同样符号 ⑤ 产物与分片一致（等价于 build-client --check 的断言，失败信息更直白）。
 * 真机渲染（浏览器 DOM + 截图）见提交说明与 assets/preview.html 的手工自检记录。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('分片：23-npm.js 存在且登记进 PART_ORDER（未登记=不会进产物）', () => {
  assert.equal(existsSync(join(ROOT, 'lib/client-parts/23-npm.js')), true);
  const build = read('scripts/build-client.mjs');
  assert.match(build, /'23-npm\.js'/, 'PART_ORDER 必须登记 23-npm.js');
});

test('产物：含 NPM 面板组件与「本地/GitHub/NPM」三标签', () => {
  const client = read('lib/client.js');
  for (const sym of ['dshgp_NpmPanel', 'dshgp_NpmAccountCard', 'dshgp_NpmInstallForm', 'dshgp_NpmCredFields']) {
    assert.ok(client.includes(sym), `产物应含 ${sym}`);
  }
  assert.match(client, /label: '本地'/);
  assert.match(client, /label: 'GitHub'/);
  assert.match(client, /label: 'NPM'/);
  assert.ok(!client.includes("label: '云端'"), '旧「云端」标签应已被 GitHub 取代');
});

test('产物：npm 凭据字段 id 与安全默认开关都在', () => {
  const client = read('lib/client.js');
  for (const id of ['dshgp-npm-token', 'dshgp-npm-registry', 'dshgp-npm-names', 'dshgp-npm-dir']) {
    assert.ok(client.includes(id), `产物应含字段 ${id}`);
  }
  assert.ok(client.includes('不执行安装脚本'), '应保留 ignore-scripts 安全开关文案');
  assert.ok(client.includes('确认安装'), '安装必须走二次确认');
});

test('产物与分片一致（等价于 build-client --check）', async () => {
  const { buildClient } = await import('../scripts/build-client.mjs');
  const built = buildClient();
  const current = read('lib/client.js');
  assert.equal(current, built, '产物与分片不一致：请运行 node scripts/build-client.mjs');
});

test('产物：NPM 账号卡与 GitHub 账号卡同款面板（渐变面板/状态徽标/勾选块/刷新按钮）', () => {
  const client = read('lib/client.js');
  const start = client.indexOf('function dshgp_NpmAccountCard');
  assert.ok(start > 0, '产物应含 dshgp_NpmAccountCard');
  const nextFn = client.indexOf('function dshgp_', start + 10);
  const body = client.slice(start, nextFn > 0 ? nextFn : start + 6000);
  for (const cls of ['dshgp_acctpanel', 'dshgp_accthead', 'dshgp_acctic', 'dshgp_acctstat', 'dshgp_acctblock2', 'dshgp_acctfoot', 'dshgp_keybtn', 'dshgp_accthint']) {
    assert.ok(body.includes(cls), `NPM 账号卡应复用 GitHub 卡样式类 ${cls}`);
  }
  assert.ok(body.includes('npm'), '图标块应含 npm 字样');
  assert.ok(client.split('dshgp_acctpanel').length >= 3, 'GitHub 卡与 NPM 卡都应使用 dshgp_acctpanel');
});

test('产物：顶部账号区为 GitHub↔NPM 滑动切换（AccountSwitcher）且 NPM 子页用仓库行样式', () => {
  const client = read('lib/client.js');
  assert.ok(client.includes('function dshgp_AccountSwitcher'), '应有顶部账号切换器');
  const sw = client.slice(client.indexOf('function dshgp_AccountSwitcher'), client.indexOf('function dshgp_AccountSwitcher') + 2600);
  assert.ok(sw.includes('dshgp_AccountCard'), '切换器应挂 GitHub 账号卡');
  assert.ok(sw.includes('dshgp_NpmAccountCard'), '切换器应挂 NPM 账号卡');
  assert.ok(sw.includes('dshgp_supview'), '切换器应有滑动视图容器');
  const pane = client.slice(client.indexOf('function dshgp_NpmPanel'), client.indexOf('function dshgp_AccountSwitcher'));
  assert.ok(pane.includes('dshgp_reprow'), 'NPM 子页列表应复用 GitHub 仓库行的行样式');
  assert.ok(pane.includes('dshgp_pushcol'), 'NPM 子页列表应有右侧操作列');
  assert.ok(pane.includes('openInstallFlow'), 'NPM 行内安装应走 Controller 的四段入口 openInstallFlow');
  assert.ok(pane.includes('dshgp_browsemask'), '选择段应复用 GitHub 同款遮罩对话框');
  assert.ok(pane.includes('dshgp_cloneprog'), '进度段应复用 clone 进度框样式');
  assert.ok(pane.includes('confirmInstallGlobal'), '选择段应有「全局安装」选项');
  assert.ok(client.includes('/api/git-push/npm-install-progress'), '进度应来自 /npm-install-progress 轮询');
  assert.ok(!/dshgp_NpmInstallForm, \{ st \}/.test(pane), '自创的安装表单不应再渲染（已改为四段交互）');
});

test('预览页（若已生成）含同一批符号（保证截图自检看的就是新 UI）', () => {
  const p = join(ROOT, 'assets/preview.html');
  if (!existsSync(p)) return; // 预览页属生成物，未生成时跳过（不误报）
  const html = readFileSync(p, 'utf8');
  for (const sym of ['dshgp_NpmPanel', 'dshgp_NpmAccountCard', 'dshgp-npm-token']) {
    assert.ok(html.includes(sym), `预览页应含 ${sym}（否则截图自检看的是旧 UI）`);
  }
});
