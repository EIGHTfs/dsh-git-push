/**
 * dsh-git-push — 本地真实后端测试服务（2026-09-14）
 *
 * 起一个真实 HTTP 服务，直接调插件 handleHttp（走真实代码路径：repos-local 真实扫描、
 *   browse 真实目录、repo-push 真实推送、后台任务等等），供 preview.html 用
 *   `?backend=<此地址>` 接真实后端测试（区别于纯 mock 离线预览）。
 *
 * 用法：
 *   node scripts/preview-server.mjs --port 8090 [--root <默认扫描根>]
 *   浏览器访问：http://127.0.0.1:8090 （自动接真实后端）
 *
 * 说明：
 *   - 仅服务本机调试（回环信任 + 全 ENABLE CORS），非生产宿主；不经 DSH 宿主
 *     的鉴权会话（账号卡片 token/SSH 凭据仍从插件配置目录自探测，与实例一致）。
 *   - GET / 自动 serve preview.html（注入 backend 指向本服务，免手动拼 URL）。
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonBody } from '../lib/http/index.js';
import { handleHttp } from '../lib/app/http-handlers.js';
import { defaultConfig, resolveConfig } from '../lib/client/index.js';

const __root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const port = Number((argv.find((a) => a.startsWith('--port')) || '').split('=')[1] || argv[argv.indexOf('--port') + 1] || 8090);
const rootArgIdx = argv.indexOf('--root');
const root = rootArgIdx !== -1 ? argv[rootArgIdx + 1]
  : (process.env.DSH_HOME ? dirname(process.env.DSH_HOME) : __root);

// 配置：若部署副本有持久化 config（status 端点会脱敏读），这里用默认配置 + 本地覆盖。
const cfg = defaultConfig();
const cfgPath = join(process.env.DSH_HOME || '', 'git-push', 'config.json');
try {
  if (existsSync(cfgPath)) {
    const persisted = JSON.parse(readFileSync(cfgPath, 'utf8'));
    Object.assign(cfg, resolveConfig(persisted));
  }
} catch { /* 无持久化配置 → 用默认 */ }

const env = {
  workspaceRoot: root,
  extraRepos: [],
  dshHomeRoot: root,
};

// 读 preview.html 模板（注入 backend 指向本服务，用户打开即接真实后端）
const previewPath = join(__root, 'assets', 'preview.html');
let previewHtml = '';
try { previewHtml = readFileSync(previewPath, 'utf8'); } catch { /* preview.html 不存在则不 serve 首页 */ }
// 在 </head> 前注入 <script> 设置 backend（preview.html fetch mock 优先读 location.search，
//   fallback 读 window.__DSHGP_BACKEND__，两者都自动接本服务）
const injectScript = `<script>window.__DSHGP_BACKEND__='http://127.0.0.1:${port}';</script>`;
const injectedHtml = previewHtml.replace('</head>', injectScript + '\n</head>');

const server = http.createServer((req, res) => {
  const optFlag = req.method === 'OPTIONS';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (optFlag) { res.writeHead(204); res.end(); return; }
  // GET / → serve preview.html（注入 backend）
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    if (!injectedHtml) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('preview.html 不存在'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(injectedHtml);
    return;
  }
  // 其他请求 → handleHttp（/api/git-push/* 等）
  readJsonBody(req, async (body) => {
    // 本地信任：回环预览页跨端口，覆写 origin 为同源以过 CSRF 校验（本地开发服务）。
    const origin = `http://127.0.0.1:${port}`;
    const r = await handleHttp(
      { method: req.method, url: req.url, origin, host: `127.0.0.1:${port}`, headers: req.headers, body },
      env,
      cfg,
    );
    res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.body));
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`dsh-git-push 预览服务已启动:`);
  console.log(`  本机访问: http://127.0.0.1:${port}`);
  console.log(`  局域网访问: http://10.10.10.63:${port}`);
  console.log(`  （自动接真实后端，免手动拼 ?backend=）`);
});