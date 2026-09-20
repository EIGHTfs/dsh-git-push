/**
 * dsh-git-push 侧边栏独立预览启动器（模板源：bench-template/server/lib/preview/start-preview.mjs，改配置区裁剪）
 *
 * 用途：把任意 DSH 插件的预览页（preview.html，垫片执行真实 client 代码）独立跑起来，
 *   并接 **DSH 真实后端**——预览页里的数据全部来自真后端（读与写都真实）。
 *
 * 复制到目标项目后，改「配置区」即可：
 *   - PROJECT_LABEL   启动横幅显示名（如 "dsh-git-push 设置侧边栏预览"）
 *   - PREVIEW_FILE    预览页文件名（相对项目根；默认 preview.html，如 assets/preview.html）
 *   - SERVE_DIRS      本地静态服务目录（相对项目根；预览页相对资源走这里）
 *   - PROXY_PREFIX    转发到 DSH 后端的 URL 前缀（默认 /api/；插件后端前缀改如 /api/git-push/）
 *   - HEALTH_PATH     健康检查路径（默认 /preview-ping；配套 start.sh 用它判启动成功）
 *   - DSH_BASE        默认后端（可 --dsh 覆盖）
 *
 * 逻辑部分（勿改）：token 认证（--token > 环境变量 DSH_PREVIEW_TOKEN > dsh-proxy.log 兜底，
 *   GET /?token= → dsh-auth cookie）+ 反向代理 + 静态服务 + playwright 自检骨架。
 *
 * 用法：
 *   node start-preview.mjs --port 30999          # 起本地反代服务器
 *   node start-preview.mjs --dsh http://127.0.0.1:30800 --token <launch-token>
 *   node start-preview.mjs --shot preview.png    # playwright 截图自检（需 pwviewer）
 */
// dsh-skip-sensitive: 本文件为预览反代服务器，含 token 认证逻辑（--token/环境变量/dsh-proxy.log 运行时解析），无硬编码凭据，安全类规则整文件豁免（见 lib/exempt dsh-skip-sensitive：敏感类按 rule 名细分）。
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

/* ─────────────── 配置区（各项目按需修改） ─────────────── */
const PROJECT_LABEL = 'dsh-git-push 设置侧边栏预览（接真实后端）';
const PREVIEW_FILE = 'assets/preview.html';        // 预览页文件名（相对项目根，preview-gen 生成）
const SERVE_DIRS = ['lib'];                       // 本地静态服务目录（相对项目根）
const PROXY_PREFIX = '/api/git-push/';            // 转发到 DSH 后端的 URL 前缀（插件后端）
const HEALTH_PATH = '/preview-ping';              // 健康检查路径（start.sh 启动判定用）
const DSH_BASE = process.env.DSH_PREVIEW_TARGET || 'http://127.0.0.1:30800'; // DSH 反代
const SHOT_ROOT_SELECTOR = '.dshgp_page';         // playwright 自检的根元素选择器（侧边栏页根）
/* ─────────────── 配置区结束 ─────────────── */

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));       // 本脚本所在目录
const PROJECT_ROOT = normalize(join(SCRIPT_DIR, '..'));           // 项目根（脚本在 <根>/preview 或 <根>/assets 下一级）
const PROXY_LOG = process.env.DSH_PROXY_LOG || join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'dsh-proxy.log');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

// ── CLI 参数 ──
const args = process.argv.slice(2);
const PORT = parseInt(args.find(a => a.startsWith('--port'))?.split('=')[1] || args[args.indexOf('--port') + 1] || '30999', 10);
const noOpen = args.includes('--no-open');
const shotPath = args.find(a => a.startsWith('--shot'))?.split('=')[1] || (args.includes('--shot') ? args[args.indexOf('--shot') + 1] : null);
const dshArg = args.find(a => a.startsWith('--dsh'))?.split('=')[1] || (args.includes('--dsh') ? args[args.indexOf('--dsh') + 1] : null);
const tokenArg = args.find(a => a.startsWith('--token'))?.split('=')[1] || (args.includes('--token') ? args[args.indexOf('--token') + 1] : null);
const TARGET = dshArg || DSH_BASE;

// ── token 解析：--token > env > dsh-proxy.log ──
function resolveToken() {
  if (tokenArg) return tokenArg;
  if (process.env.DSH_PREVIEW_TOKEN) return process.env.DSH_PREVIEW_TOKEN;
  try {
    if (!existsSync(PROXY_LOG)) return null;
    const txt = readFileSync(PROXY_LOG, 'utf8');
    const m = txt.match(/token=([a-zA-Z0-9_-]{20,})/g);
    if (m && m.length) {
      const last = m[m.length - 1].replace('token=', '');
      return last;
    }
  } catch { /* 读不到就 null */ }
  return null;
}

// ── DSH 会话：认证 cookie 缓存 ──
let authCookie = null;   // 已认证的 cookie 串
const COOKIE_RE = /(dsh-auth|_DSH|dsh_)[^;]*/i;

async function ensureAuthCookie() {
  if (authCookie) return authCookie;
  const token = resolveToken();
  if (!token) return null;
  // GET /?token=xxx → 303 + Set-Cookie
  return new Promise((resolve) => {
    const target = new URL(TARGET);
    // dsh-skip-sensitive（token 来自 --token 参数/环境变量/日志兜底，运行时解析，非硬编码凭据）
    const req = httpRequest({
      hostname: target.hostname, port: target.port, path: '/?token=' + encodeURIComponent(token), method: 'GET',
      headers: { host: target.host, connection: 'close' }, // 强制新连接，避免复用反代坏 keep-alive
    }, (res) => {
      const setCookies = res.headers['set-cookie'] || [];
      const c = setCookies.map(s => s.split(';')[0]).join('; ');
      if (c) { authCookie = c; }
      res.resume();
      resolve(authCookie);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/** 转发一个浏览器请求到 DSH 真实后端。 */
function proxyToDsh(req, res, upstreamPath) {
  const t0 = Date.now();
  let bodyBytes = 0;
  req.on('data', (c) => { bodyBytes += c.length; });
  ensureAuthCookie().then((cookie) => {
    if (!cookie) {
      console.log(`[proxy] ${req.method} ${upstreamPath} → 502 no-cookie (${Date.now() - t0}ms)`);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('preview: 无法认证 DSH 后端（未提供 --token 且 proxy.log 无 token）');
      return;
    }
    const target = new URL(TARGET);
    const headers = { ...req.headers, host: target.host, cookie, connection: 'close' };
    // 流式转发：删除 content-length 让 Node 用 chunked 处理，避免长度不匹配挂起
    delete headers['content-length'];
    const upstream = httpRequest({
      hostname: target.hostname, port: target.port, path: upstreamPath, method: req.method, headers,
    }, (up) => {
      const outHeaders = { ...up.headers };
      delete outHeaders['set-cookie']; // 不把 DSH cookie 回给预览页
      delete outHeaders['content-length'];
      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
      up.on('end', () => {
        console.log(`[proxy] ${req.method} ${upstreamPath} → ${up.statusCode} body=${bodyBytes}B ${Date.now() - t0}ms`);
      });
      up.on('close', () => {
        console.log(`[proxy] ${req.method} ${upstreamPath} → CLOSE(no-response?) body=${bodyBytes}B ${Date.now() - t0}ms`);
      });
    });
    upstream.on('error', (e) => {
      console.log(`[proxy] ${req.method} ${upstreamPath} → ERROR ${e.message} body=${bodyBytes}B ${Date.now() - t0}ms`);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('preview: 转发 DSH 失败 ' + e.message);
    });
    req.pipe(upstream);
  });
}

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(body);
}

function serveFile(res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) { send(res, 404, 'not found'); return; }
  const mime = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  // 健康检查（start.sh 启动判定用；不转发后端）
  if (pathname === HEALTH_PATH) { send(res, 200, 'pong', 'text/plain'); return; }

  // 根 → 预览页
  if (pathname === '/' || pathname === '/index.html') { serveFile(res, join(PROJECT_ROOT, PREVIEW_FILE)); return; }

  // 配置的本地静态目录（如 /lib/* → 项目根 lib/；预览页相对资源走这里）
  for (const dir of SERVE_DIRS) {
    if (pathname.startsWith('/' + dir + '/')) {
      const file = normalize(join(PROJECT_ROOT, pathname.replace(new RegExp('^/' + dir + '/'), dir + '/')));
      if (file.startsWith(join(PROJECT_ROOT, dir))) { serveFile(res, file); return; }
      send(res, 403, 'forbidden'); return;
    }
  }

  // 代理前缀 → 全部转发 DSH 真实后端（读与写都真实）
  if (pathname.startsWith(PROXY_PREFIX)) {
    proxyToDsh(req, res, req.url); // 原样转发（保留 query）
    return;
  }

  // 其余 → 404
  send(res, 404, 'not found');
});

async function openBrowser() {
  if (noOpen || !existsSync(join(PROJECT_ROOT, '..', '..', 'pwviewer', 'node_modules', 'playwright'))) return;
  try {
    const { chromium } = await import('/volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs');
    const CHROME = '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-software-rasterizer','--no-zygote','--single-process','--disable-fontconfig'] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);
    const state = await page.evaluate((sel) => ({
      root: !!document.querySelector(sel),
      buttons: document.querySelector(sel) ? document.querySelector(sel).querySelectorAll('button').length : 0,
    }), SHOT_ROOT_SELECTOR);
    console.log('[shot] 预览渲染:', JSON.stringify(state));
    if (shotPath) await page.screenshot({ path: shotPath });
    await browser.close();
    if (shotPath) console.log('[shot] 截图已存:', shotPath);
  } catch (e) {
    console.log('[shot] playwright 自检跳过（', e.message?.slice(0, 80), '）——真实浏览器打开即可预览');
  }
}

server.listen(PORT, '0.0.0.0', async () => {
  const token = resolveToken();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  ' + PROJECT_LABEL.padEnd(46) + '║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('  预览页:  http://127.0.0.1:' + PORT + '/');
  console.log('  后端:    ' + TARGET + '（' + PROXY_PREFIX + '* 转发，数据真实）');
  console.log('  token:   ' + (token ? '已自动获取（' + token.slice(0, 8) + '…）' : '⚠ 未找到，预览将不可用（用 --token 指定）'));
  console.log('  停止: Ctrl+C 或 start.sh stop');
  await openBrowser();
});