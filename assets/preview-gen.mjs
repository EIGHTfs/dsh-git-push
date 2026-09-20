/**
 * 生成 assets/preview.html —— 侧边栏交互模拟页（假数据、全部可点）。
 *
 * 跑的是真 client.js（不是手抄 mockup），只垫片宿主环境，所以界面与真实插件一致，
 * 且能发现真实渲染/交互缺陷。生成物单文件自包含（内联 React UMD），双击即开、离线可用。
 *
 * 用法：node assets/preview-gen.mjs
 *
 * 路径解析（2026-09-18 重写）：
 *   项目根 projectRoot = 本文件所在目录的上一级。
 *   DSH 安装根不能靠相对路径推导（数据目录与安装目录不同源），改为探测：
 *     判据「含 node_modules/ 与 package.json」，顺序 DSH_ROOT > 常见安装位 > 上溯兜底。
 *   React UMD 取该根 pnpm store；react-dom 常未安装，缺失时自动下载单文件 UMD 到
 *     <DSH_HOME>/cache/react-umd/（不入库、断网可复用）。
 *   需要时可覆盖：DSH_ROOT / REACT_UMD_DIR / REACT_DOM_UMD_DIR。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRuleSlots } from '../lib/app/http-handlers.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 字节 → MB 换算：1 MB = 1024 × 1024 字节
const BYTES_PER_MB = 1024 * 1024;
/**
 * 定位 DSH 安装根（2026-09-18 修）。
 *
 * 为什么不能靠相对路径：本机**数据目录与安装目录不同源**——
 *   工作区在 /volume1/@appdata/DeepSeekHarness-NAS/<版本>/工作区/<项目>（@appdata），
 *   DSH 却装在 /volume1/@appstore/DeepSeekHarness-NAS（@appstore），两者不在同一棵树下，
 *   上溯任意级都到不了。原实现写死上溯三级，在本机必然报「找不到 react UMD」。
 * 判据：安装根的标志 = 同时存在 node_modules/ 与 package.json。
 * 顺序：DSH_ROOT 显式指定 → 常见安装位置 → 从工作区上溯兜底。
 */
function findDshRoot() {
  if (process.env.DSH_ROOT) return process.env.DSH_ROOT;
  const isRoot = (d) => d && existsSync(join(d, 'package.json')) && existsSync(join(d, 'node_modules'));
  for (const c of ['/volume1/@appstore/DeepSeekHarness-NAS', '/opt/DeepSeekHarness-NAS', '/usr/local/DeepSeekHarness-NAS']) {
    if (isRoot(c)) return c;
  }
  let cur = resolve(projectRoot);
  for (let i = 0; i < 6; i++) {
    const up = resolve(cur, '..');
    if (up === cur) break;
    cur = up;
    if (isRoot(cur)) return cur;
  }
  return '';
}

const DSH = findDshRoot();
if (!DSH) {
  console.error('找不到 DSH 安装根（标志：含 node_modules/ 与 package.json）。用 DSH_ROOT 显式指定，例如：\n  DSH_ROOT=/volume1/@appstore/DeepSeekHarness-NAS node assets/preview-gen.mjs');
  process.exit(1);
}
const store = join(DSH, 'node_modules', '.pnpm');
const reactUmdDir = process.env.REACT_UMD_DIR || join(store, 'react@18.3.1', 'node_modules', 'react');
const RD = process.env.REACT_DOM_UMD_DIR || join(store, 'react-dom@18.3.1_react@18.3.1', 'node_modules', 'react-dom');

/**
 * 确保 react-dom UMD 就位（2026-09-18 修）。
 *
 * react-dom **常未随 DSH 安装**（本机实测全盘缺失，DSH 只装了 react），
 *   而 UMD 是单文件自包含（约 1MB）、不依赖包管理器，因此缺失时直接下载即可，
 *   不该为此要求用户去装依赖。缓存放 DSH_HOME（数据目录，不入库），命中即复用、断网可重跑。
 * @returns {string} 含 umd/react-dom.development.js 的目录
 */
function ensureReactDomUmd(dir) {
  if (existsSync(join(dir, 'umd', 'react-dom.development.js'))) return dir;
  if (process.env.REACT_DOM_UMD_DIR) return dir; // 显式指定时不擅自改写
  const cache = join(process.env.DSH_HOME || join(tmpdir(), 'dsh-git-push'), 'cache', 'react-umd');
  const cached = join(cache, 'umd', 'react-dom.development.js');
  try {
    mkdirSync(join(cache, 'umd'), { recursive: true });
    if (!existsSync(cached)) {
      console.log(`react-dom 未安装，下载单文件 UMD → ${cached}`);
      const r = spawnSync('curl', ['-sSL', '--max-time', '180', '-o', cached, 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js'], { stdio: 'inherit' });
      if (r.status !== 0 || !existsSync(cached)) {
        console.error(`下载失败，可手动放置到：${cached}`);
        return dir;
      }
    }
    return cache;
  } catch (e) {
    console.error(`准备 react-dom UMD 失败：${e?.message || e}`);
    return dir;
  }
}

const reactDomDir = ensureReactDomUmd(RD);

for (const [label, dir] of [['react', reactUmdDir], ['react-dom', reactDomDir]]) {
  if (!existsSync(join(dir, 'umd'))) {
    console.error(`找不到 ${label} UMD：${dir}\n（DSH 根推导为 ${DSH}；可用 DSH_ROOT / ${label === 'react' ? 'REACT_UMD_DIR' : 'REACT_DOM_UMD_DIR'} 指定）`);
    process.exit(1);
  }
}

const clientSrc = readFileSync(`${projectRoot}/lib/client.js`, 'utf8');
const reactUmd = readFileSync(`${reactUmdDir}/umd/react.development.js`, 'utf8');
const domUmd = readFileSync(`${reactDomDir}/umd/react-dom.development.js`, 'utf8');

// 槽位数据取自真实规则文件（动态发现 audit-rules-<名>.yml），不再手写清单——
//   手写清单会与真实规则包脱节：曾只手写 6 个，预览里就只显示 6 个槽位，
//   被误当成「只显示 6 个」的回归。读取真实数据后预览与真实实例恒等。
//   第三参传 null = 未审计过，stats 走「规则条数」口径（与真实实例重启后的初始态一致）。
const realSlots = listRuleSlots(undefined, [], null);
const SLOT_ORDER = realSlots.order.filter((slot) => slot !== 'template');
const SLOT_META = realSlots.meta;

// 假数据：可变（点开关/调序会真的改它，UI 才反映结果，而不是点完回弹）
const FAKE = {
  // 2026-09-13：改为演示「父开关关闭 + 子开关已勾选」——正是可勾选/只置灰/不生效的验证场景
  auditEnabled: false,
  injectRequirements: true,
  // 2026-09-13：injectFullSkill / injectRepoIndexFull 已废弃移除，改为注入总开关（默认开）
  injectSystemPrompt: true,
  auditScanScope: 'diff',
  maxScanFiles: 3000,
  weightOverrides: '',
  githubToken: 'ghp_ExampleToken1234567890abcdefGHIJ',
  sshPub: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamplePublicKeyForDemoOnly eightfs@example.com',
  _order: SLOT_ORDER,
};

// 规则包元数据（SLOT_META）现在来自真实规则文件，见文件上方 realSlots。
//   仍只作为 /rule-slots 的接口假数据，**不放进快照**——放进快照会掩盖
//   「客户端被空 ruleSlotMeta 覆盖」这类 bug（真实宿主从不提供该字段）。

const harness = `
window.__ERRORS__ = [];
function __err(kind, msg) {
  window.__ERRORS__.push(kind + ': ' + msg);
  var errEl = document.getElementById('__err');
  if (!errEl) {
    errEl = document.createElement('pre');
    errEl.id = '__err';
    errEl.style.cssText = 'color:#f87171;white-space:pre-wrap;font-size:12px;'
      + 'border:1px solid #f87171;padding:8px;margin:0 0 12px';
    document.body.insertBefore(errEl, document.body.firstChild);
  }
  errEl.textContent += kind + ': ' + msg + String.fromCharCode(10);
}
window.addEventListener('error', function (e) { __err('error', e.message); });
window.addEventListener('unhandledrejection', function (e) { __err('reject', String((e.reason && e.reason.stack) || e.reason)); });
var __oerr = console.error;
console.error = function () { __err('console', Array.prototype.map.call(arguments, function (x) { return String((x && x.stack) || x); }).join(' ')); __oerr.apply(console, arguments); };

window.__FAKE__ = ${JSON.stringify(FAKE)};
window.__CAPTURED__ = null;
window.__ModuleLoader__ = { load: function (m) { window.__CAPTURED__ = m; } };

// jsx-runtime → createElement：key 走 props、children 走独立实参（否则 children 会被覆盖成空）
window.__jsxRuntime = {
  Fragment: React.Fragment,
  jsx: function (type, props, key) {
    var p = props || {}, children = p.children, rest = {};
    for (var k in p) if (k !== 'children') rest[k] = p[k];
    if (key !== undefined) rest.key = key;
    var args = children === undefined ? [rest] : [rest].concat(Array.isArray(children) ? children : [children]);
    return React.createElement.apply(React, [type].concat(args));
  },
  jsxs: function (type, props, key) { return window.__jsxRuntime.jsx(type, props, key); },
};

window.__requireShim = function (name) {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return window.__jsxRuntime;
  if (name === '@deepseek-ai/dsh-client-store') {
    return { createSnapshotStore: function (initial) {
      var cur = initial, subs = [];
      return {
        set: function (v) { cur = v; subs.forEach(function (f) { f(); }); },
        getSnapshot: function () { return cur; },
        subscribe: function (f) { subs.push(f); return function () {}; },
      };
    } };
  }
  throw new Error('未垫片的 require: ' + name);
};

// 宿主 settingsScope：真内存 store，set 后通知 → 界面真的跟着变
window.__SLOTS__ = ${JSON.stringify(SLOT_META)};
window.__scopeSubs = [];
window.__scopeMock = {
  getSnapshot: function () { return { status: 'ready', writable: true, value: window.__FAKE__ }; },
  subscribe: function (cb) { window.__scopeSubs.push(cb); return function () {}; },
  set: function (key, value) {
    window.__FAKE__[key] = value;
    window.__scopeSubs.forEach(function (f) { f(); });
    return Promise.resolve();
  },
};

// 接真实后端（2026-09-20 完全真实数据版）：
//   · 默认（无参数）：同源相对路径 /api/git-push/* 直接放行——在 start-preview.mjs 反代服务下
//     打开时请求落到真实 DSH 后端，预览数据完全真实（账号/仓库/规则/审计/设置）。
//   · URL 传 ?backend=http://127.0.0.1:PORT → 转发到所给后端（preview-server 直连实测）。
//   · ?mock=1 → 走下方假数据（离线调试兜底，默认不再用假数据）。
var __PRE_REAL__ = window.fetch;
window.__dshgpScript = window.__dshgpScript || [];
window.fetch = function (url, init) {
  var urlStr = String(url), body = { ok: true };
  // ?backend= 或 window.__DSHGP_BACKEND__（preview-server 注入）→ 转发指定后端
  var __PRE_B__ = (location.search.match(/[?&]backend=([^&]+)/) || [])[1] || window.__DSHGP_BACKEND__ || '';
  if (__PRE_B__) {
    return __PRE_REAL__(__PRE_B__ + urlStr, {
      method: ((init && init.method) || 'GET'),
      headers: { 'Content-Type': 'application/json' },
      body: (init && init.body) || undefined,
    }).then(function (raw) {
      return raw.json().then(function (data) {
        return { ok: true, status: raw.status, json: function () { return Promise.resolve(data); } };
      });
    }).catch(function () { return { ok: true, status: 502, json: function () { return Promise.resolve({ ok: false, error: '后端未启动: ' + __PRE_B__ }); } }; });
  }
  // 默认放行同源：start-preview.mjs 反代到 DSH 真实后端（完全真实数据）；
  //   仅显式 ?mock=1 才走下方假数据（离线调试）。
  if (!/[?&]mock=1/.test(location.search)) {
    return __PRE_REAL__(urlStr, init);
  }
  body = { ok: true };
  // 演示目录根（mock 假数据用；browse/repos-local 共用）
  var DEMO_HOME = '/home/user/项目';
  // /toggle-rule 必须真改假数据：toggleDisabled 本地翻转后会 loadSlots 对账，
  //   假数据不改就会被拉回原状（表现为「点完回弹」）。
  if (urlStr.indexOf('toggle-rule') >= 0) {
    try {
      var req = JSON.parse((init && init.body) || '{}');
      var meta = window.__SLOTS__[req.slot];
      if (meta) meta.disabled = !!req.disabled;
    } catch (e) { /* 假数据解析失败不影响预览 */ }
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
  }
  if (urlStr.indexOf('rule-slots') >= 0) {
    body = { ok: true, slots: { order: window.__FAKE__._order.slice(), meta: window.__SLOTS__, forced: ['private'] } };
  } else if (urlStr.indexOf('account-check') >= 0) {
    body = { ok: true, loggedIn: true, block: '✅ 已登录 GitHub：EIGHTfs（Public 仓库 12 个 / 私有 3 个）' };
  } else if (urlStr.indexOf('gen-ssh-key') >= 0) {
    body = { ok: true, pub: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINewlyGeneratedDemoKeyForPreview eightfs@example.com' };
  // 2026-09-14 账号卡片（本地/云端）假数据：结构与真实端点一致，点按钮能真的出列表/弹窗
  } else if (urlStr.indexOf('browse') >= 0) {
    // 目录浏览：mock 按请求 path 返回真实层级（点目录真切换，与真实 browseDir 行为一致）
    var queryStr = String(urlStr).split('?')[1] || '';
    var p = '';
    try { p = decodeURIComponent(String(queryStr).replace(/^path=/, '')); } catch (e) { /* 忽略 */ }
    if (!p) p = DEMO_HOME;
    var parent = p.replace(/\\/[^/]+$/, '') || '/';
    var dirs;
    if (p === DEMO_HOME + '/dsh-git-push-v2/lib') dirs = ['app', 'ast', 'audit', 'checks', 'git', 'rule', 'self', 'client', 'context'];
    else if (p === DEMO_HOME + '/dsh-git-push-v2') dirs = ['lib', 'scripts', 'docs', 'test', 'assets', 'tool'];
    else if (p === DEMO_HOME + '/gamebanana-mods-downloader') dirs = ['server', 'crx', 'docs', 'scripts', 'test', 'mapping'];
    else if (p === DEMO_HOME + '/ai-work-archive') dirs = ['skills', '开发者文档', '任务'];
    else if (p === DEMO_HOME) dirs = ['dsh-git-push-v2', 'gamebanana-mods-downloader', 'iwara-downloader', 'ai-work-archive', '任务', '数据', '用户'];
    else if (p === '/home/user') dirs = ['项目'];
    else dirs = ['src', 'docs', 'build', 'scripts'];
    body = { ok: true, path: p, parent: parent, dirs: dirs };
  } else if (urlStr.indexOf('repos-local') >= 0) {
    // 服务端已过滤：只保留登录同作者（EIGHTfs）的仓库。
    //   ①领先+干净→push 可点 ②有未提交→push 禁用；其他作者/无 remote 的都被过滤不显示
    body = {
      ok: true, root: '/home/user/项目', count: 2, owner: 'EIGHTfs', indexedAvailable: true,
      repos: [
        {
          path: DEMO_HOME + '/dsh-git-push-v2', branch: 'master', remote: 'origin', changed: 0,
          lastCommit: 'a1b2c3d 账号卡片：本地/云端', hasRemote: true, upstream: 'origin/master', ahead: 3, behind: 0,
          indexed: { owner: 'EIGHTfs', repo: 'dsh-git-push', repoUrl: 'https://api.github.com/repos/EIGHTfs/dsh-git-push', visibility: '公开' },
        },
        {
          path: DEMO_HOME + '/gamebanana-mods-downloader', branch: 'main', remote: 'origin', changed: 5,
          lastCommit: 'f0e9d8c 修复下载器', hasRemote: true, upstream: 'origin/main', ahead: 1, behind: 0,
          indexed: { owner: 'EIGHTfs', repo: 'gamebanana-mods-downloader', repoUrl: 'https://api.github.com/repos/EIGHTfs/gamebanana-mods-downloader', visibility: '私有' },
        },
      ],
    };
  } else if (urlStr.indexOf('repos-cloud') >= 0) {
    body = {
      ok: true, loggedIn: true, count: 4,
      repos: [
        { fullName: 'EIGHTfs/dsh-git-push', private: false, defaultBranch: 'master', pushedAt: '2026-09-14T10:00:00Z', description: 'DSH git 提交推送插件' },
        { fullName: 'EIGHTfs/dsh-git-rescue', private: true, defaultBranch: 'master', pushedAt: '2026-09-13T08:30:00Z', description: 'DSH 救援恢复插件' },
        { fullName: 'EIGHTfs/dsh-session-conductor', private: false, defaultBranch: 'main', pushedAt: '2026-09-12T15:20:00Z', description: '会话指挥家' },
        { fullName: 'EIGHTfs/iwara-downloader', private: false, defaultBranch: 'main', pushedAt: '2026-09-10T11:00:00Z', description: 'iwara 下载器' },
      ],
    };
  } else if (urlStr.indexOf('repo-push') >= 0) {
    body = { ok: true, pushed: true, branch: 'master', ahead: 0 };
  } else if (urlStr.indexOf('repo-clone') >= 0) {
    body = { ok: true, dest: '/home/user/项目/dsh-git-push' };
  }
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
};
`;

const post = `
try {
  var mod = window.__CAPTURED__.factory(window.__requireShim);
  var renderSection = null;
  var ctx = {
    settingsScope: { bind: function () { return window.__scopeMock; } },
    slots: { inject: function (n, cb) { cb(); }, register: function (spec, render) { renderSection = render; } },
  };
  mod.apply(ctx);
  if (!renderSection) throw new Error('settings.section 未注册');
  ReactDOM.flushSync(function () {
    ReactDOM.createRoot(document.getElementById('root')).render(
      React.createElement(function () {
        var el = renderSection();
        return el || React.createElement('div', null, '（state.available=false）');
      }, null)
    );
  });
  window.__ready = true;
} catch (e) {
  __err('harness', (e && e.message) || String(e));
}
`;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>dsh-git-push 侧边栏预览（真实后端数据）</title>
<style>
:root{
  --dsw-alias-label-primary:#e8eaf0;--dsw-alias-label-secondary:#a0a6b4;--dsw-alias-label-tertiary:#6b7280;
  --dsw-alias-bg-layer-1:#14161d;--dsw-alias-bg-layer-2:#1a1d26;--dsw-alias-bg-layer-3:#20242e;
  --dsw-alias-border-l2:rgba(255,255,255,.08);--dsw-alias-border-l4:rgba(255,255,255,.14);
}
*{box-sizing:border-box}
body{margin:0;padding:20px;background:#0f1117;color:#e8eaf0;
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.banner{max-width:520px;margin:0 0 14px;padding:10px 12px;border:1px dashed rgba(255,255,255,.18);
  border-radius:10px;color:#a0a6b4;font-size:12px}
.banner b{color:#e8eaf0}
#root{max-width:520px}
#__err{max-width:520px}
</style></head><body>
<div class="banner">这是<b>真实后端数据预览</b>：跑的是仓库里真实的 <b>client.js</b>（垫片宿主环境）；默认在
<b>start.sh 起的预览服务</b>下打开，账号/仓库/规则/审计/设置全部来自 <b>DSH 真实后端</b>（读写都真实）。
离线调试可用 <b>?mock=1</b> 切回内置假数据（改动只留页面内、不写文件）；跨后端实测用 <b>?backend=http://127.0.0.1:端口</b>。</div>
<div id="root"></div>
<script>${reactUmd}</script>
<script>${domUmd}</script>
<script>${harness}</script>
<script>${clientSrc}</script>
<script>${post}</script>
</body></html>`;

writeFileSync(`${projectRoot}/assets/preview.html`, html);
console.log('生成 assets/preview.html', (html.length / BYTES_PER_MB).toFixed(2), 'MB');
