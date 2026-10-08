#!/usr/bin/env node
// 浏览器页面探针（无头）——读「网页实际渲染出来的内容」+ 抓前端运行时错误。
//
// 用途（为什么需要它）：
//   curl 只能拿到原始 HTML/响应，看不到 JS 渲染后的页面与前端异常。DSH 插件的前端
//   entry 激活失败时，页面只显示 `web boot: 1 entry did not activate` / `<插件>: failed`，
//   真实异常只在浏览器控制台——本脚本把「渲染后文本 + console/pageerror」一起抓出来。
//
// 设计约束（硬要求）：
//   - **零硬编码路径**：浏览器/运行库/字体/playwright 全部按
//     「环境变量 → 自动探测」解析，探测结果打印出来可核对。
//   - **零必需依赖**：解析不到 playwright 时自动降级为 chrome `--dump-dom` 模式
//     （仍能读渲染后文本，只是拿不到 console 错误与点击能力）。
//
// 用法：
//   node scripts/browser-page-probe.mjs --url "http://127.0.0.1:30901/?token=XXX"
//   node scripts/browser-page-probe.mjs --port 30901 --token XXX --click Settings --click "Git 提交推送"
//   node scripts/browser-page-probe.mjs --url ... --out /tmp/page.txt --wait 15000
//
// 环境变量（可选，用于显式指定；不设则自动探测）：
//   DSH_PAGE_SHARED_ROOT  共享根目录（其下含 pwviewer/ chromium-libs/ fonts/）
//   DSH_PAGE_CHROME       浏览器可执行文件
//   DSH_PAGE_LIBS         运行库目录（多个用 : 分隔，喂给 LD_LIBRARY_PATH）
//   DSH_PAGE_FONTCONF     fontconfig 配置文件（中文字体，避免 CJK 渲染崩溃）
//   DSH_PAGE_PWROOT       含 node_modules/playwright 的目录

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// 解析命令行参数（--k v / --flag）。
function parseArgv(argv) {
  const out = { click: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true;
    if (key === 'click') out.click.push(String(val));
    else out[key] = val;
  }
  return out;
}

const args = parseArgv(process.argv.slice(2));
const WAIT_MS = Number(args.wait || 12000);
/** 打印页面文本时的截断长度（避免整页文本把终端/日志刷爆）。 */
const TEXT_PRINT_MAX = 6000;
/** 无头浏览器视口尺寸（默认 1440×1000，够桌面布局；窄屏可另传参）。 */
const VIEWPORT_W = 1440;
const VIEWPORT_H = 1000;
/** 每次点击后等待页面稳定的毫秒数（等前端异步渲染完成）。 */
const CLICK_SETTLE_MS = 5000;
const OUT = String(args.out || '');
const URL = args.url
  ? String(args.url)
  : `http://127.0.0.1:${args.port || 30801}/?token=${args.token || ''}`;

// 有界目录探测：在候选根下找子目录名。
// 必须限深（maxDepth）——共享根下挂着大量卷/套件目录，无界遍历会扫全盘卡死
//   （实测：早期全盘 find 找 chromium 既慢又命中错根目录）。找到即返回，不做全量收集。
// 只按「目录名」在候选根下找，不写任何绝对路径。
// @param {string} root 候选根目录
// @param {string[]} names 目标子目录名（如 ['pwviewer'] / ['chromium-libs']）
// @param {number} [maxDepth] 最大下探层数（默认 4，防大目录树拖慢）
// @returns {string|undefined} 命中目录的绝对路径
function findDirUnder(root, names, maxDepth = 4) {
  const queue = [[root, 0]];
  while (queue.length) {
    const [dir, depth] = queue.shift();
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const full = join(dir, e.name);
      if (names.includes(e.name)) return full;
      if (depth < maxDepth && !e.name.startsWith('.')) queue.push([full, depth + 1]);
    }
  }
  return undefined;
}

// 候选共享根：环境变量 → DSH_HOME 上溯 → 常见共享挂载点（模式化，不写死绝对路径）。
function sharedRootCandidates() {
  const list = [];
  if (process.env.DSH_PAGE_SHARED_ROOT) list.push(resolve(process.env.DSH_PAGE_SHARED_ROOT));
  if (process.env.DSH_HOME) {
    let dir = resolve(process.env.DSH_HOME);
    for (let i = 0; i < 6; i += 1) {
      list.push(dir);
      dir = dirname(dir);
    }
  }
  // 模式化候选：<卷>/VirtualDSM/* 与 <卷>/@appdata/*/all_shares/*/*（本机虚拟化共享目录的通用形态）
  for (const vol of ['/volume1', '/volume2', '/vol1']) {
    for (const name of ['VirtualDSM', 'virtualdsm']) {
      const base = join(vol, name);
      if (!existsSync(base)) continue;
      list.push(base);
      try {
        for (const sub of readdirSync(base)) list.push(join(base, sub));
      } catch { /* 读不到就跳过 */ }
    }
  }
  return [...new Set(list)];
}

// 读本机浏览器环境的**固定记录**：<DSH_HOME>/browser-env.json（无则返回 {}）。
// 为什么需要它：这些路径（chrome / 运行库 / 字体 / playwright 根）每次会话都重新探测一遍
//   既慢又容易找错；记录一次后所有会话直接读，换机/换版本时改那个文件即可。
// 优先级：环境变量 DSH_PAGE_* > 本文件 > 自动探测。
function readBrowserEnvRecord() {
  const home = process.env.DSH_HOME;
  if (!home) return {};
  const p = join(home, 'browser-env.json');
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')) || {}; } catch { return {}; }
}

// 探测浏览器运行环境（chrome / libs / fontconfig / playwright 根）。
// 顺序：环境变量 DSH_PAGE_* → <DSH_HOME>/browser-env.json 固定记录 → 按候选共享根自动探测。
// 探测结果全部打印，便于核对「到底用了哪份资源」。
// 边界：探测不到 chrome 时直接报错退出并提示设 env（**不静默降级成假成功**）；
//   libs/fonts 缺失只影响能否启动/中文渲染，交给调用方按报错处理。
// @returns {{chrome:string, libs:string, fontconf:string, pwroot:string}}
function discover() {
  const found = { chrome: '', libs: '', fontconf: '', pwroot: '' };
  if (process.env.DSH_PAGE_CHROME) found.chrome = resolve(process.env.DSH_PAGE_CHROME);
  if (process.env.DSH_PAGE_LIBS) found.libs = process.env.DSH_PAGE_LIBS;
  if (process.env.DSH_PAGE_FONTCONF) found.fontconf = resolve(process.env.DSH_PAGE_FONTCONF);
  if (process.env.DSH_PAGE_PWROOT) found.pwroot = resolve(process.env.DSH_PAGE_PWROOT);

  // 固定记录：一次记录、后续会话不再重新探测（env 已设的项不被覆盖）
  const rec = readBrowserEnvRecord();
  if (!found.chrome && rec.chrome) found.chrome = resolve(String(rec.chrome));
  if (!found.libs && rec.libs) found.libs = String(rec.libs);
  if (!found.fontconf && rec.fontconf) found.fontconf = resolve(String(rec.fontconf));
  if (!found.pwroot && rec.pwroot) found.pwroot = resolve(String(rec.pwroot));

  for (const root of sharedRootCandidates()) {
    if (!found.chrome) {
      const browsers = existsSync(join(root, 'pwviewer', 'browsers'))
        ? join(root, 'pwviewer', 'browsers')
        : findDirUnder(root, ['browsers'], 2);
      if (browsers) {
        for (const b of readdirSync(browsers)) {
          for (const rel of [
            ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
            ['chrome-linux', 'chrome'],
          ]) {
            const p = join(browsers, b, ...rel);
            if (existsSync(p)) { found.chrome = p; break; }
          }
          if (found.chrome) break;
        }
      }
    }
    if (!found.libs) {
      const libs = findDirUnder(root, ['chromium-libs'], 3);
      if (libs) {
        const parts = [
          join(libs, 'root', 'usr', 'lib', 'x86_64-linux-gnu'),
          join(libs, 'root', 'lib', 'x86_64-linux-gnu'),
          join(libs, 'root', 'usr', 'lib'),
        ].filter((p) => existsSync(p));
        if (parts.length) found.libs = parts.join(':');
      }
    }
    if (!found.fontconf) {
      const fonts = findDirUnder(root, ['fonts'], 2);
      const conf = fonts ? join(fonts, 'fonts.conf') : '';
      if (conf && existsSync(conf)) found.fontconf = conf;
    }
    if (!found.pwroot) {
      const pw = findDirUnder(root, ['pwviewer'], 2);
      if (pw && existsSync(join(pw, 'node_modules', 'playwright'))) found.pwroot = pw;
    }
    if (found.chrome && found.libs) break;
  }
  return found;
}

// 解析 playwright（可缺省）。
// playwright 只装在共享根的 `pwviewer/node_modules` 下，**不在本插件依赖里**——
//   故用 createRequire 从「探测到的 pwroot」解析（而不是 import，避免把 playwright 变成硬依赖）。
//   解析不到不报错：调用方降级为 chrome `--dump-dom`（仍能读渲染后文本）。
// 边界：显式设了 DSH_PAGE_PWROOT 时只认它；否则依次试 pwroot → cwd → 本脚本位置。
// @param {string} pwroot 含 node_modules/playwright 的目录（可为空）
// @returns {object|null} playwright 模块，或 null（→ 降级模式）
function loadPlaywright(pwroot) {
  const roots = [pwroot, process.cwd()].filter(Boolean);
  for (const root of roots) {
    try {
      return createRequire(join(root, 'noop.cjs'))('playwright');
    } catch { /* 换下一个候选根 */ }
  }
  try { return createRequire(import.meta.url)('playwright'); } catch { return null; }
}

// 从渲染后的 HTML 里剥离标签，取可见文本（降级模式用）。
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n').map((s) => s.trim()).filter((s) => s.length > 1).join('\n');
}

const env = discover();
console.log('[probe] 浏览器:', env.chrome || '（未找到，请设 DSH_PAGE_CHROME）');
console.log('[probe] 运行库  :', env.libs || '（未找到，可能缺 libatk 等；请设 DSH_PAGE_LIBS）');
console.log('[probe] 字体配置:', env.fontconf || '（未找到，中文页可能渲染崩溃）');
console.log('[probe] 目标 URL:', URL.replace(/token=[^&]+/, 'token=***'));

if (!env.chrome) {
  console.error('[probe] 找不到浏览器可执行文件：请设 DSH_PAGE_CHROME 或 DSH_PAGE_SHARED_ROOT 后重试');
  process.exit(2);
}

const childEnv = { ...process.env };
if (env.libs) childEnv.LD_LIBRARY_PATH = env.libs;
if (env.fontconf) childEnv.FONTCONFIG_FILE = env.fontconf;

const playwright = loadPlaywright(env.pwroot);
if (!playwright) {
  // ── 降级模式：chrome --dump-dom（无 console 捕获、无点击） ──
  console.log('[probe] 未解析到 playwright → 降级为 --dump-dom 模式（无 console 错误捕获）');
  const r = spawnSync(env.chrome, [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--virtual-time-budget=${WAIT_MS}`, '--dump-dom', URL,
  ], { env: childEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const text = stripHtml(r.stdout || '');
  if (OUT) writeFileSync(OUT, text);
  console.log('=== 页面可见文本 ===');
  console.log(text.slice(0, TEXT_PRINT_MAX));
  process.exit(r.status === 0 ? 0 : 1);
}

// ── 完整模式：playwright（console/pageerror 捕获 + 点击） ──
const { chromium } = playwright;
const browser = await chromium.launch({
  executablePath: env.chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  env: childEnv,
});
const page = await browser.newPage({ viewport: { width: VIEWPORT_W, height: VIEWPORT_H } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 500)); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(WAIT_MS);
for (const text of args.click) {
  const hit = await page.evaluate((t) => {
    const els = [...document.querySelectorAll('button,a,div,span,li')];
    const el = els.find((e) => e.children.length === 0 && (e.textContent || '').trim() === t);
    if (el) { el.click(); return true; }
    return false;
  }, text);
  console.log(`[probe] 点击「${text}」:`, hit ? '成功' : '未找到');
  await page.waitForTimeout(CLICK_SETTLE_MS);
}
const body = await page.evaluate(() => document.body.innerText);
if (OUT) { writeFileSync(OUT, body); writeFileSync(`${OUT}.errors`, errors.join('\n')); }
console.log('=== 页面可见文本 ===');
console.log(body.slice(0, TEXT_PRINT_MAX));
console.log('=== 前端错误（pageerror / console.error）===');
console.log(errors.join('\n').slice(0, 4000) || '（无）');
await browser.close();
