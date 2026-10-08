/**
 * 前端渲染自检（clone 预览弹窗）——把「改前端后必须实际看一眼」变成一条可重复命令。
 *
 * 为什么需要：宿主 GUI 里看插件页面要刷新/重启，前端报错又只藏在浏览器控制台；
 *   而 clone 预览弹窗只在「真实交互走到那一步」时才出现（面板状态由构造函数初始化，
 *   外部注入的终态会被覆盖）⇒ 必须**驱动**而不是塞状态。
 *
 * 依赖（都按环境变量传入，脚本内不写死绝对路径）：
 *   PW_ROOT   含 node_modules/playwright 的目录（createRequire 的基准）
 *   CHROMIUM  无头浏览器可执行文件（chrome-headless-shell 亦可）
 *   运行库/字体由调用方通过 LD_LIBRARY_PATH / FONTCONFIG_FILE 提供（无头 chromium 的既有要求）
 *
 * 用法：
 *   node scripts/frontend-preview-check.mjs --html <预览页.html> [--out <截图.png>]
 * 前置（生成预览页；同样由调用方给出工具与 React UMD 路径）：
 *   <dsh>/skills/frontend-real-render-preview.mjs --client lib/client.js --out <预览页.html>
 *     --react <dsh>/cache/react-umd --endpoints <伪造响应.json>
 *   伪造响应至少含三组：/repos-cloud、/browse、/clone-preview（形状见测试用例的断言数据）。
 *
 * 判据（任一不满足即非零退出）：
 *   ① 云端标签 → ② 加载仓库列表 → ③ 行内 clone → ④ 目录选择器确认 → ⑤ 预览弹窗出现
 *   ⑥ 弹窗内「带真实历史」勾选框存在、且默认 checked=true（与后端默认一致）
 *   ⑦ 全程无前端错误（pageerror / console.error）
 */
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const arg = (name, def = '') => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const HTML = arg('--html');
const OUT = arg('--out', 'frontend-preview-check.png');
// plain   = 普通克隆（伪造 /clone-preview 里 partial:false）：不应出现「重来」
// partial = 不完整克隆（partial:true）：应出现「重来」与 partial 提示
const EXPECT = arg('--expect', 'plain');
const PW_ROOT = process.env.PW_ROOT || process.cwd();
const CHROME = process.env.CHROMIUM || '';
if (!HTML) { console.error('缺少 --html <预览页.html>'); process.exit(2); }
if (!CHROME) { console.error('缺少环境变量 CHROMIUM（无头浏览器可执行文件路径）'); process.exit(2); }

const require = createRequire(PW_ROOT.replace(/\/?$/, '/'));
const { chromium } = require('playwright');

const browser = await chromium.launch({
  executablePath: CHROME,
  // file:// 页面要能 fetch 真后端/伪造端点：与 frontend-real-render-preview 的 --open 同参数
  args: ['--no-sandbox', '--disable-gpu', '--disable-web-security', '--allow-file-access-from-files'],
});
const page = await browser.newPage({ viewport: { width: 1320, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 120)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });

const clickText = async (re) => {
  const b = page.locator('button', { hasText: re }).first();
  if (await b.count()) { await b.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(2200); return true; }
  return false;
};
const fails = [];
const need = (cond, msg) => { if (!cond) fails.push(msg); };

await page.goto('file://' + HTML, { waitUntil: 'load' });
await page.waitForTimeout(2200);

need(await clickText(/^云端$/), '未找到「云端」标签');
need(await clickText(/加载仓库列表/), '未找到「加载仓库列表」按钮');
const clones = page.locator('button', { hasText: /^clone$/ });
need(await clones.count() > 0, '仓库列表没有出现 clone 按钮（伪造 /repos-cloud 或 /browse 响应不符）');
if (await clones.count()) {
  await clones.first().click().catch(() => {});
  await page.waitForTimeout(2600);
  if (!(await clickText(/选择当前目录|确定|选择|确认|此目录|开始/))) {
    const row = page.locator('text=dshgp-demo').first();
    if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(1200); await clickText(/选择当前目录|确定|选择|确认|此目录|开始/); }
    else fails.push('目录选择器里既没有确认按钮也没有可点目录');
  }
  await page.waitForTimeout(2500);
}
const dlg = page.locator('.dshgp_clonepreview');
const hasDlg = await dlg.count();
need(hasDlg > 0, 'clone 预览弹窗未出现（clone-preview 未被触发或响应不符）');
if (hasDlg) {
  const box = page.locator('.dshgp_previewopt input[type=checkbox]');
  need(await box.count() > 0, '弹窗内没有「带真实历史」勾选框（类名 .dshgp_previewopt 变了？）');
  if (await box.count()) {
    const checked = await box.first().isChecked();
    need(checked === true, `勾选框默认应为 checked=true（与后端默认「带历史」一致），实测 ${checked}`);
    // 切换有效性：「取消勾选 ⇒ 真的传 history:false ⇒ 退回整树快照」依赖前端能切换成功，
    //   故这里验「点一下真的变 false、再点回 true」；提交体是否带 history:false 由代码审查 + 用例覆盖。
    await box.first().click().catch(() => {});
    await page.waitForTimeout(600);
    const off = await box.first().isChecked();
    need(off === false, `点击勾选框应变为未勾选（实测 ${off}）——说明 onChange 没接到或状态没重绘`);
    await box.first().click().catch(() => {});
    await page.waitForTimeout(600);
    const back = await box.first().isChecked();
    need(back === true, `再次点击应恢复勾选（实测 ${back}）`);
  }
  // 条件渲染对照：「重来」按钮与 partial 提示只在「已存在且不完整」时出现。
  //   只验出现态无法区分「只在 partial 时显示」与「总是显示」——故两种期望值都要能断言。
  const labels = (await dlg.locator('button').allInnerTexts()).map((t) => t.trim());
  const hasRestart = labels.includes('重来');
  const hasHint = (await page.locator('.dshgp_previewpartial').count()) > 0;
  if (EXPECT === 'partial') {
    need(hasRestart, `不完整克隆应出现「重来」按钮（实测按钮 ${JSON.stringify(labels)}）`);
    need(hasHint, '不完整克隆应显示 partial 提示（.dshgp_previewpartial）');
  } else {
    need(!hasRestart, `普通克隆不应出现「重来」按钮（实测按钮 ${JSON.stringify(labels)}）`);
    need(!hasHint, '普通克隆不应显示 partial 提示');
  }
}
await page.screenshot({ path: OUT, fullPage: true });
if (errs.length) fails.push('存在前端错误: ' + errs.slice(0, 2).join(' | '));
await browser.close();

console.log(fails.length ? '❌ 前端渲染自检未通过：\n  - ' + fails.join('\n  - ') + '\n  截图: ' + OUT
  : '✅ 前端渲染自检通过（弹窗出现 + 勾选框存在 + 默认勾选 + 切换有效 + 无前端错误）\n  截图: ' + OUT);
process.exit(fails.length ? 1 : 0);
