/**
 * 生成 assets/preview.html —— 侧边栏交互模拟页（假数据、全部可点）。
 *
 * 跑的是真 client.js（不是手抄 mockup），只垫片宿主环境，所以界面与真实插件一致，
 * 且能发现真实渲染/交互缺陷。生成物单文件自包含（内联 React UMD），双击即开、离线可用。
 *
 * 用法：node assets/preview-gen.mjs
 *
 * 路径全部按脚本位置推导（换机/换工作区即用，不写死本机路径）：
 *   项目根 P = 本文件所在目录的上一级；DSH 根 = P 上溯三级
 *   （<DSH>/.dsh-home/工作区/<项目>）；React UMD 取 DSH 的 pnpm store。
 *   需要时可覆盖：DSH_ROOT / REACT_UMD_DIR / REACT_DOM_UMD_DIR。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRuleSlots } from '../lib/app/http-handlers.js';

const P = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// DSH 根：<DSH>/.dsh-home/工作区/<项目> → 上溯三级
const DSH = process.env.DSH_ROOT || resolve(P, '..', '..', '..');
const store = join(DSH, 'node_modules', '.pnpm');
const R = process.env.REACT_UMD_DIR || join(store, 'react@18.3.1', 'node_modules', 'react');
const RD = process.env.REACT_DOM_UMD_DIR || join(store, 'react-dom@18.3.1_react@18.3.1', 'node_modules', 'react-dom');

for (const [label, dir] of [['react', R], ['react-dom', RD]]) {
  if (!existsSync(join(dir, 'umd'))) {
    console.error(`找不到 ${label} UMD：${dir}\n（DSH 根推导为 ${DSH}；可用 DSH_ROOT / ${label === 'react' ? 'REACT_UMD_DIR' : 'REACT_DOM_UMD_DIR'} 指定）`);
    process.exit(1);
  }
}

const clientSrc = readFileSync(`${P}/client.js`, 'utf8');
const reactUmd = readFileSync(`${R}/umd/react.development.js`, 'utf8');
const domUmd = readFileSync(`${RD}/umd/react-dom.development.js`, 'utf8');

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
  hardcodeFullScan: false,
  // 2026-09-13：injectFullSkill / injectRepoIndexFull 已废弃移除，改为注入总开关（默认开）
  injectSystemPrompt: true,
  auditScanScope: 'diff',
  auditLevel: 'standard',
  auditRuleset: '',
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
  var d = document.getElementById('__err');
  if (!d) { d = document.createElement('pre'); d.id = '__err'; d.style.cssText = 'color:#f87171;white-space:pre-wrap;font-size:12px;border:1px solid #f87171;padding:8px;margin:0 0 12px'; document.body.insertBefore(d, document.body.firstChild); }
  d.textContent += kind + ': ' + msg + String.fromCharCode(10);
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

// 假接口：/toggle-rule 真翻转 disabled，配合 loadSlots 对账，点击结果能留住
window.fetch = function (url, init) {
  var u = String(url), body = { ok: true };
  // /toggle-rule 必须真改假数据：toggleDisabled 本地翻转后会 loadSlots 对账，
  //   假数据不改就会被拉回原状（表现为「点完回弹」）。
  if (u.indexOf('toggle-rule') >= 0) {
    try {
      var req = JSON.parse((init && init.body) || '{}');
      var meta = window.__SLOTS__[req.slot];
      if (meta) meta.disabled = !!req.disabled;
    } catch (e) { /* 假数据解析失败不影响预览 */ }
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
  }
  if (u.indexOf('rule-slots') >= 0) {
    body = { ok: true, slots: { order: window.__FAKE__._order.slice(), meta: window.__SLOTS__, forced: ['private'] } };
  } else if (u.indexOf('account-check') >= 0) {
    body = { ok: true, loggedIn: true, block: '✅ 已登录 GitHub：EIGHTfs（Public 仓库 12 个 / 私有 3 个）' };
  } else if (u.indexOf('gen-ssh-key') >= 0) {
    body = { ok: true, pub: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINewlyGeneratedDemoKeyForPreview eightfs@example.com' };
  // 2026-09-14 账号卡片（本地/云端）假数据：结构与真实端点一致，点按钮能真的出列表/弹窗
  } else if (u.indexOf('browse') >= 0) {
    // 目录浏览：mock 按请求 path 返回真实层级（点目录真切换，与真实 browseDir 行为一致）
    var q = String(u).split('?')[1] || '';
    var p = '';
    try { p = decodeURIComponent(String(q).replace(/^path=/, '')); } catch (e) { /* 忽略 */ }
    if (!p) p = '/home/user/项目';
    var parent = p.replace(/\\/[^/]+$/, '') || '/';
    var dirs;
    if (p === '/home/user/项目/dsh-git-push-v2/lib') dirs = ['app', 'ast', 'audit', 'checks', 'git', 'rule', 'self', 'client', 'context'];
    else if (p === '/home/user/项目/dsh-git-push-v2') dirs = ['lib', 'scripts', 'docs', 'test', 'assets', 'tool'];
    else if (p === '/home/user/项目/gamebanana-mods-downloader') dirs = ['server', 'crx', 'docs', 'scripts', 'test', 'mapping'];
    else if (p === '/home/user/项目/ai-work-archive') dirs = ['skills', '开发者文档', '任务'];
    else if (p === '/home/user/项目') dirs = ['dsh-git-push-v2', 'gamebanana-mods-downloader', 'iwara-downloader', 'ai-work-archive', '任务', '数据', '用户'];
    else if (p === '/home/user') dirs = ['项目'];
    else dirs = ['src', 'docs', 'build', 'scripts'];
    body = { ok: true, path: p, parent: parent, dirs: dirs };
  } else if (u.indexOf('repos-local') >= 0) {
    // 三个演示仓库：①领先+干净→push 可点 ②有未提交→push 禁用 ③无上游→push 禁用
    body = {
      ok: true, root: '/home/user/项目', count: 3,
      repos: [
        { path: '/home/user/项目/dsh-git-push-v2', branch: 'master', remote: 'origin', changed: 0, lastCommit: 'a1b2c3d 账号卡片：本地/云端', hasRemote: true, upstream: 'origin/master', ahead: 3, behind: 0 },
        { path: '/home/user/项目/gamebanana-mods-downloader', branch: 'main', remote: 'origin', changed: 5, lastCommit: 'f0e9d8c 修复下载器', hasRemote: true, upstream: 'origin/main', ahead: 1, behind: 0 },
        { path: '/home/user/项目/new-project', branch: 'main', remote: 'origin', changed: 0, lastCommit: '（无提交）', hasRemote: true, upstream: '', ahead: null, behind: null },
      ],
    };
  } else if (u.indexOf('repos-cloud') >= 0) {
    body = {
      ok: true, loggedIn: true, count: 4,
      repos: [
        { fullName: 'EIGHTfs/dsh-git-push', private: false, defaultBranch: 'master', pushedAt: '2026-09-14T10:00:00Z', description: 'DSH git 提交推送插件' },
        { fullName: 'EIGHTfs/dsh-git-rescue', private: true, defaultBranch: 'master', pushedAt: '2026-09-13T08:30:00Z', description: 'DSH 救援恢复插件' },
        { fullName: 'EIGHTfs/dsh-session-conductor', private: false, defaultBranch: 'main', pushedAt: '2026-09-12T15:20:00Z', description: '会话指挥家' },
        { fullName: 'EIGHTfs/iwara-downloader', private: false, defaultBranch: 'main', pushedAt: '2026-09-10T11:00:00Z', description: 'iwara 下载器' },
      ],
    };
  } else if (u.indexOf('repo-push') >= 0) {
    body = { ok: true, pushed: true, branch: 'master', ahead: 0 };
  } else if (u.indexOf('repo-clone') >= 0) {
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
<title>dsh-git-push 侧边栏模拟（假数据 / 全部可点）</title>
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
<div class="banner">这是<b>模拟预览</b>（交互用假数据）：跑的是仓库里真实的 <b>client.js</b>，只垫片了宿主环境；<b>规则包列表的槽位、显示名、规则条数取自真实规则文件</b>，与真实实例一致。
三个选项卡、开关、规则包启停/调序、权重、凭据保存、一键生成 SSH 都可点，改动只留在页面内，不写任何文件。</div>
<div id="root"></div>
<script>${reactUmd}</script>
<script>${domUmd}</script>
<script>${harness}</script>
<script>${clientSrc}</script>
<script>${post}</script>
</body></html>`;

writeFileSync(`${P}/assets/preview.html`, html);
console.log('生成 assets/preview.html', (html.length / 1048576).toFixed(2), 'MB');
