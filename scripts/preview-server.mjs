/**
 * dsh-git-push — 本地真实后端测试服务（2026-09-14）
 *
 * 起一个真实 HTTP 服务，直接调插件 handleHttp（走真实代码路径：repos-local 真实扫描、
 *   browse 真实目录、repo-push 真实推送、后台任务等等），供 preview.html 用
 *   `?backend=<此地址>` 接真实后端测试（区别于纯 mock 离线预览）。
 *
 * 用法：
 *   node scripts/preview-server.mjs --port 8090 [--root <默认扫描根>]
 *   浏览器访问：http://<本机局域网IP>:8090 （推荐，手机/其他设备也可开）
 *               本机回环 http://127.0.0.1:8090 亦可用（自动接真实后端）
 *
 * 说明：
 *   - 仅服务本机调试（回环信任 + 全 ENABLE CORS），非生产宿主；不经 DSH 宿主
 *     的鉴权会话（账号卡片 token/SSH 凭据仍从插件配置目录自探测，与实例一致）。
 *   - GET / 自动 serve preview.html（注入 backend 指向本服务，免手动拼 URL）。
 */
import http from 'node:http';
import os from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonBody } from '../lib/http/index.js';
import { handleHttp } from '../lib/app/http-handlers.js';
import { defaultConfig, resolveConfig } from '../lib/client/index.js';

/** 探测本机局域网 IPv4（非回环、非容器网桥）：优先 10.x/192.168.x/172.16-31.x。 */
function detectLanIp() {
  try {
    const cands = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family !== 'IPv4' || ni.internal) continue;
        cands.push(ni.address);
      }
    }
    // 优先私网段（排除 docker/网桥常见的 172.17-172.31 次级地址，首选项仍按出现顺序）
    return cands.find((a) => /^10\./.test(a)) || cands.find((a) => /^192\.168\./.test(a)) || cands[0] || '';
  } catch { return ''; }
}

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
// 2026-09-16 修复：注入**同源地址**（location.origin），不再硬编码 127.0.0.1——
//   经局域网地址（如 http://10.10.10.63:8090）打开页面时，硬编码回环会让浏览器把请求
//   打到访问设备自己（连不上）；同源地址则本机/局域网都正确指向本服务。
const injectScript = `<script>window.__DSHGP_BACKEND__=location.origin;</script>`;
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
    // 本地信任：预览页跨端口，覆写 origin 为**请求实际 Host**（本机访问=回环地址，
    //   局域网访问=局域网地址）以过 CSRF 校验；不再固定 127.0.0.1，否则局域网访问被判跨源。
    const reqHost = String(req.headers.host || `127.0.0.1:${port}`);
    const origin = `http://${reqHost}`;
    const r = await handleHttp(
      { method: req.method, url: req.url, origin, host: reqHost, headers: req.headers, body },
      env,
      cfg,
    );
    res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.body));
  });
});

server.listen(port, '0.0.0.0', () => {
  // 2026-09-16：优先给**局域网地址**（远程/手机也能打开），本机回环降为备选；
  //   IP 用 os.networkInterfaces() 动态探测（不写死某台机器的地址）。
  const lan = detectLanIp();
  console.log('dsh-git-push 预览服务已启动:');
  if (lan) console.log(`  局域网访问: http://${lan}:${port}   ← 推荐（本机/手机/其他设备）`);
  console.log(`  本机回环:   http://127.0.0.1:${port}`);
  console.log('  （自动接真实后端，免手动拼 ?backend=）');
});