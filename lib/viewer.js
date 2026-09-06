/**
 * dsh-git-push — 提交历史查看器（v1.24.0 整合 git-commits-viewer）
 *
 * 只读数据层 + 查看器页面渲染。整合自 git-commits-viewer（EIGHTfs/git-commits-viewer，已下线），
 * 逐条避开旧实现的缺陷：
 *   1. 旧实现「打开页面即真实 push」（checkPushStatus 调 /api/push 直接推送）——本文件**零写操作**，
 *      不提供任何 push 能力，推送统一走 git_commit_push 工具（带审计门禁）
 *   2. 旧实现无认证 + 任意路径解析——repo 参数只接受 scanRepos 结果精确匹配（name/path），
 *      不允许任意路径；commit/file 参数以 spawnSync 数组元素传递（无 shell 拼接，无注入面）
 *   3. 旧实现路径硬编码——扫描根/深度/extraRepos 全部复用插件 config（workspaceRoot/depth/extraRepos/extraReposFile）
 *   4. 旧实现 generate.js 与 static-server.js 双份重复——本文件单份实现，唯一逻辑源
 *   5. 旧实现无测试——配套 test-viewer.mjs（见 test/）
 */
import { runGit, scanRepos } from './core.js';
import { VIEWER_LOCALES, DEFAULT_LOCALE, localeOf } from './viewer-locales.js';

/** 提交类型归类（message 前缀，GitHub Desktop 风格）。 */
function commitTypeOf(message) {
  if (message.startsWith('feat')) return 'feat';
  if (message.startsWith('fix')) return 'fix';
  if (message.startsWith('docs')) return 'docs';
  if (message.startsWith('refactor')) return 'refactor';
  if (message.startsWith('Revert') || message.startsWith('revert')) return 'revert';
  return 'chore';
}

/** 是否有父提交（根提交无父，diff 需走 git show）。 */
function hasParent(repoPath, commitId) {
  return runGit(['rev-parse', '--verify', `${commitId}^`], repoPath).status === 0;
}

/**
 * 解析 diff --numstat 单行 → { added, removed }（`-` 表示二进制/无法统计）。
 */
function parseNumstat(line) {
  const cols = (line || '').trim().split('\t');
  if (cols.length < 2) return { added: 0, removed: 0 };
  const toNum = (v) => (v === '-' ? 0 : Number(v) || 0);
  return { added: toNum(cols[0]), removed: toNum(cols[1]) };
}

/**
 * 读取仓库提交历史（只读）。
 * @param {string} repoPath 仓库绝对路径
 * @param {number} [limit=100] 提交条数
 * @returns {Array} 提交数组 [{id, shortId, message, author, email, date, type, files:[{name,added,removed}], stats:{added,removed,files}}]
 */
export function getCommitHistory(repoPath, limit = 100) {
  const commits = [];
  const cap = Math.max(1, Math.min(Number(limit) || 100, 500));
  // %x1f（ASCII 单元分隔符）作字段分隔：%s（message）可含 | 号，用 | 分隔会被 message 内的 | 干扰。
  const raw = runGit(['log', '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI', `-${cap}`], repoPath).stdout;
  if (!raw) return commits;
  for (const line of raw.split('\n')) {
    const parts = line.split('\x1f');
    if (parts.length < 6) continue;
    const [id, shortId, message, author, email, date] = parts;
    const files = [];
    let totalAdded = 0;
    let totalRemoved = 0;
    const names = runGit(['log', '--name-only', '--pretty=format:', '-1', id], repoPath).stdout
      .split('\n').map((s) => s.trim()).filter(Boolean);
    const parentOk = hasParent(repoPath, id);
    for (const file of names) {
      let added = 0;
      let removed = 0;
      if (parentOk) {
        const stat = runGit(['diff', '--numstat', `${id}~1`, id, '--', file], repoPath).stdout;
        ({ added, removed } = parseNumstat(stat.split('\n')[0] || ''));
      }
      totalAdded += added;
      totalRemoved += removed;
      files.push({ name: file, added, removed });
    }
    commits.push({
      id, shortId, message, author, email, date,
      type: commitTypeOf(message),
      files,
      stats: { added: totalAdded, removed: totalRemoved, files: files.length },
    });
  }
  return commits;
}

/**
 * 解析统一 diff 文本 → 行级 JSON（跳过 diff/index/---/+++/Binary 头）。
 */
export function parseDiffLines(content) {
  if (!content) return { lines: [], added: 0, removed: 0 };
  const lines = content.split('\n');
  const result = [];
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('Binary')) continue;
    if (line.startsWith('@@')) { result.push({ type: 'hunk', content: line }); continue; }
    if (line.startsWith('+')) { result.push({ type: 'added', content: line.slice(1) }); added += 1; }
    else if (line.startsWith('-')) { result.push({ type: 'removed', content: line.slice(1) }); removed += 1; }
    else if (line.startsWith(' ')) { result.push({ type: 'context', content: line.slice(1) }); }
  }
  return { lines: result, added, removed };
}

/**
 * 读取指定提交中某个文件的 diff（只读）。根提交自动回退 git show。
 * @returns {{ok:true, diff:string, parsed:object} | {ok:false, error:string}}
 */
export function getCommitDiff(repoPath, commitId, filename) {
  if (!commitId || typeof commitId !== 'string' || !filename || typeof filename !== 'string') {
    return { ok: false, error: '缺少 commit 或 file 参数' };
  }
  if (!/^[0-9a-fA-F]{4,40}$/.test(commitId)) {
    return { ok: false, error: 'commit 参数不合法' };
  }
  const parentOk = hasParent(repoPath, commitId);
  const args = parentOk
    ? ['diff', `${commitId}~1`, commitId, '--', filename]
    : ['show', '--format=', commitId, '--', filename];
  const r = runGit(args, repoPath);
  if (r.status !== 0) {
    return { ok: false, error: r.stderr || 'git diff 失败' };
  }
  return { ok: true, diff: r.stdout, parsed: parseDiffLines(r.stdout) };
}

/**
 * 解析查看器 repo 参数：只接受真实扫描仓库的 name 或 path 精确匹配（防任意路径读）。
 * @returns {string|null} 匹配到的仓库绝对路径
 */
export function resolveViewerRepo(repoParam, { root, depth = 3, extraRepos = [], extraReposFile = '' } = {}) {
  if (!repoParam || typeof repoParam !== 'string') return null;
  const repos = scanRepos({ root, depth, extraRepos, extraReposFile });
  for (const repo of repos) {
    if (repo.path === repoParam || repo.name === repoParam) return repo.path;
  }
  return null;
}

/* ------------------------------ 查看器页面（服务端渲染，零外部资源） ------------------------------ */

const VIEWER_STYLE = `
:root{color-scheme:light dark}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f6f8fa;color:#24292e;height:100vh;display:flex;flex-direction:column}
.layout{display:flex;flex:1;min-height:0}
.sidebar{width:300px;flex-shrink:0;background:#fff;border-right:1px solid #d1d5da;display:flex;flex-direction:column;min-height:0}
.sidebar-header{padding:14px 16px;border-bottom:1px solid #d1d5da}
.sidebar-title{font-size:15px;font-weight:600;margin-bottom:8px}
.repo-search{width:100%;padding:5px 10px;border:1px solid #d1d5da;border-radius:6px;font-size:13px;outline:none}
.repo-list{flex:1;overflow-y:auto;padding:8px}
.repo-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;cursor:pointer;margin-bottom:2px}
.repo-item:hover{background:#f6f8fa}
.repo-item.active{background:#ddf4ff;border:1px solid #0366d6}
.repo-icon{width:28px;height:28px;border-radius:6px;background:#0366d6;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}
.repo-info{flex:1;min-width:0}
.repo-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.repo-meta{font-size:11px;color:#586069;margin-top:2px}
.sidebar-footer{padding:10px 16px;border-top:1px solid #d1d5da;font-size:11px;color:#586069}
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.topbar{background:#fff;border-bottom:1px solid #d1d5da;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.topbar-left{display:flex;align-items:center;gap:12px}
.topbar-repo{font-size:15px;font-weight:600}
.topbar-repo a{color:#0366d6;text-decoration:none}
.topbar-stats{font-size:13px;color:#586069}
.topbar-right{display:flex;gap:8px;align-items:center}
.filter-btn{padding:5px 12px;border:1px solid #d1d5da;border-radius:6px;background:#fff;cursor:pointer;font-size:13px}
.filter-btn.active{background:#0366d6;border-color:#0366d6;color:#fff}
.refresh-btn{padding:5px 12px;border:1px solid #d1d5da;border-radius:6px;background:#fff;cursor:pointer;font-size:13px}
.refresh-btn:hover{background:#f6f8fa}
.stats-bar{display:flex;gap:20px;padding:8px 20px;background:#fafbfc;border-bottom:1px solid #d1d5da;font-size:12px;color:#586069;flex-wrap:wrap}
.stats-bar strong{color:#24292e}
.status-bar{padding:6px 20px;font-size:12px;display:none}
.status-bar.visible{display:block}
.status-bar.success{background:#dafbe1;color:#1a7f37}
.status-bar.error{background:#ffeef0;color:#cf222e}
.commit-container{flex:1;overflow-y:auto}
.commit-item{display:flex;padding:14px 20px;border-bottom:1px solid #d1d5da;cursor:pointer}
.commit-item:hover{background:#f6f8fa}
.commit-item.expanded{background:#f6f8fa}
.commit-avatar{width:34px;height:34px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;margin-right:12px;flex-shrink:0}
.commit-content{flex:1;min-width:0}
.commit-header{display:flex;align-items:baseline;gap:8px;margin-bottom:3px;flex-wrap:wrap}
.commit-message{font-size:14px;font-weight:500;word-break:break-all}
.commit-meta{font-size:12px;color:#586069;display:flex;gap:8px;flex-wrap:wrap}
.commit-hash{font-family:monospace;color:#0366d6}
.commit-type{padding:1px 7px;border-radius:12px;font-size:10px;font-weight:600;text-transform:uppercase}
.commit-type.feat{background:#dafbe1;color:#1a7f37}
.commit-type.fix{background:#ffeef0;color:#cf222e}
.commit-type.docs{background:#ddf4ff;color:#0969da}
.commit-type.chore{background:#fff8c5;color:#9a6700}
.commit-type.refactor{background:#fce8ff;color:#8250df}
.commit-type.revert{background:#f6f8fa;color:#586069}
.commit-stats{display:flex;gap:6px;margin-top:5px;flex-wrap:wrap}
.stat-badge{padding:1px 7px;border-radius:12px;font-size:11px}
.stat-badge.added{background:#dafbe1;color:#1a7f37}
.stat-badge.removed{background:#ffeef0;color:#cf222e}
.stat-badge.modified{background:#fff8c5;color:#9a6700}
.commit-expanded{padding:14px 20px;background:#f6f8fa;border-top:1px solid #d1d5da}
.commit-details{display:grid;grid-template-columns:220px 1fr;gap:20px}
@media(max-width:768px){.commit-details{grid-template-columns:1fr}}
.info-item{margin-bottom:10px}
.info-label{font-size:11px;color:#586069;margin-bottom:3px}
.info-value{font-size:12px;font-family:monospace;word-break:break-all}
.file-list{min-width:0}
.file-item{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#fff;border:1px solid #d1d5da;border-radius:6px;margin-bottom:6px;cursor:pointer;font-size:13px}
.file-item:hover{background:#eef1f4}
.file-item.selected{background:#ddf4ff;border-color:#0366d6}
.file-name{flex:1;font-family:monospace;word-break:break-all}
.file-stats{display:flex;gap:6px;flex-shrink:0}
.file-stat{padding:1px 5px;border-radius:4px;font-size:11px}
.file-stat.added{background:#dafbe1;color:#1a7f37}
.file-stat.removed{background:#ffeef0;color:#cf222e}
.diff-host{margin-top:10px}
.diff-placeholder{padding:24px;text-align:center;color:#586069;background:#fff;border:1px dashed #d1d5da;border-radius:6px;font-size:13px}
.diff-loading{padding:24px;text-align:center;color:#586069;font-size:13px}
.diff-panel{border:1px solid #d1d5da;border-radius:6px;overflow:hidden;background:#fff}
.diff-panel-header{display:flex;justify-content:space-between;padding:7px 12px;background:#f6f8fa;border-bottom:1px solid #d1d5da;font-size:13px}
.diff-panel-title{font-family:monospace;word-break:break-all}
.diff-panel-meta{color:#586069;white-space:nowrap}
.diff-panel-body{max-height:520px;overflow:auto}
.diff-line{display:flex;padding:0 12px;font-family:monospace;font-size:12px;line-height:1.6;white-space:pre}
.diff-line .dl-no{width:44px;flex-shrink:0;text-align:right;color:#8b949e;user-select:none;padding-right:10px;border-right:1px solid #eaeef2;margin-right:10px}
.diff-line.added{background:#dafbe1;color:#116329}
.diff-line.removed{background:#ffeef0;color:#82071e}
.diff-line.hunk{background:#f0f3ff;color:#4c5bd4}
.empty-state{text-align:center;padding:60px;color:#586069}
.pagination{display:flex;justify-content:center;align-items:center;gap:10px;padding:12px 20px;border-top:1px solid #d1d5da}
.page-btn{padding:5px 12px;border:1px solid #d1d5da;border-radius:6px;background:#fff;cursor:pointer;font-size:13px}
.page-btn:disabled{opacity:.5;cursor:not-allowed}
.page-info{font-size:12px;color:#586069}
.loading-spinner{text-align:center;padding:40px;color:#586069}
.note{padding:6px 20px;font-size:12px;color:#6a737d;background:#fffbe9;border-bottom:1px solid #eaeef2}
.manual-box{padding:10px 16px;border-bottom:1px solid #d1d5da}
.manual-title{font-size:12px;font-weight:600;color:#586069;margin-bottom:6px}
.manual-row{display:flex;gap:6px}
.manual-input{flex:1;min-width:0;padding:5px 10px;border:1px solid #d1d5da;border-radius:6px;font-size:12px;outline:none}
.manual-btn{padding:5px 10px;border:1px solid #d1d5da;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;white-space:nowrap}
.manual-btn:hover{background:#f6f8fa}
.lang-btn{padding:5px 12px;border:1px solid #d1d5da;border-radius:6px;background:#fff;cursor:pointer;font-size:12px}
.lang-btn:hover{background:#f6f8fa}
.repo-manual{display:inline-block;margin-left:6px;padding:0 5px;border-radius:8px;font-size:9px;color:#8250df;background:#fce8ff;vertical-align:1px}
`;

const VIEWER_SCRIPT = `(function () {
  'use strict';
  // ---- i18n（字典由服务端注入，默认中文；localStorage 记忆用户选择） ----
  var I18N = window.__VIEWER_I18N || { locale: '${DEFAULT_LOCALE}', locales: {} };
  var L = I18N.locale;
  try {
    var saved = localStorage.getItem('gp-viewer-locale');
    if (saved === 'zh' || saved === 'en') L = saved;
  } catch (e) { /* localStorage 不可用时保持默认 */ }
  var t = function (k, args) {
    var d = I18N.locales[L] || {};
    var s = d[k] !== undefined ? d[k] : k;
    if (args) Object.keys(args).forEach(function (x) { s = String(s).split('{' + x + '}').join(args[x]); });
    return s;
  };
  function setLocale(loc) {
    L = loc;
    try { localStorage.setItem('gp-viewer-locale', loc); } catch (e) { /* ignore */ }
    $('langBtn').textContent = t('langToggle');
    renderSidebar();
    if (current) {
      $('topbarStats').textContent = t('topbarCommits', { n: current.totalCommits });
      applyFilter();
    }
  }

  var repos = [];
  var commits = [];
  var filtered = [];
  var page = 1;
  var pageSize = 20;
  var expanded = null;
  var filter = 'all';
  var current = null;
  var cache = {};

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  function avatarColor(author) {
    var colors = ['#0366d6', '#28a745', '#d73a49', '#a371f7', '#f97316'];
    var h = 0, a = author || '';
    for (var i = 0; i < a.length; i++) h = a.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
  }
  function fmtDate(d) {
    if (!d) return '';
    var days = Math.floor((Date.now() - new Date(d)) / 86400000);
    if (days === 0) return t('today');
    if (days === 1) return t('yesterday');
    if (days < 7) return t('daysAgo', { n: days });
    return new Date(d).toLocaleDateString(t('dateLocale'));
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // ---- sidebar ----
  function renderSidebar() {
    var q = $('repoSearch').value.toLowerCase();
    $('repoList').innerHTML = '';
    repos.forEach(function (repo) {
      if (q && repo.name.toLowerCase().indexOf(q) === -1) return;
      var item = el('div', 'repo-item' + (current && current.path === repo.path ? ' active' : ''));
      var icon = el('div', 'repo-icon', repo.name.slice(0, 2).toUpperCase());
      var info = el('div', 'repo-info');
      var nameRow = el('div', 'repo-name', repo.name);
      if (repo._manual) nameRow.appendChild(el('span', 'repo-manual', t('manualBadge')));
      info.appendChild(nameRow);
      info.appendChild(el('div', 'repo-meta', repo.branch + ' \u00b7 ' + repo.shortId + ' \u00b7 ' + repo.totalCommits + ' ' + t('statCommits') + (repo.changes > 0 ? ' \u00b7 ' + t('commitChanges', { n: repo.changes }) : '')));
      item.appendChild(icon);
      item.appendChild(info);
      item.addEventListener('click', function () { selectRepo(repo); });
      $('repoList').appendChild(item);
    });
    $('sidebarFooter').textContent = t('footerRepos', { n: repos.length });
  }

  // ---- commits ----
  function selectRepo(repo) {
    current = repo;
    expanded = null;
    page = 1;
    $('topbarRepo').innerHTML = '<a href="' + esc(repo.remote ? 'https://github.com/' + esc(repo.remote) : '#') + '" target="_blank" rel="noopener">' + esc(repo.name) + '</a>';
    $('topbarStats').textContent = t('topbarCommits', { n: repo.totalCommits });
    if (cache[repo.path]) {
      commits = cache[repo.path];
      applyFilter();
      return;
    }
    $('commitContainer').innerHTML = '<div class="loading-spinner">' + t('commitLoading') + '</div>';
    fetch('/api/git-push/commits?repo=' + encodeURIComponent(repo.path) + '&limit=100').then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
    }).then(function (data) {
      commits = data && data.ok ? data.commits : [];
      cache[repo.path] = commits;
      applyFilter();
      if (!commits.length) $('commitContainer').innerHTML = '<div class="empty-state">' + t('commitEmpty') + '</div>';
    }).catch(function (e) {
      $('commitContainer').innerHTML = '<div class="empty-state">' + t('commitLoadFailed', { err: e.message }) + '</div>';
    });
    renderSidebar();
  }

  function applyFilter() {
    filtered = commits.filter(function (c) { return filter === 'all' || c.type === filter; });
    page = 1;
    expanded = null;
    renderCommits();
  }

  // ---- render ----
  function renderCommits() {
    var start = (page - 1) * pageSize;
    var pageRows = filtered.slice(start, start + pageSize);
    $('commitContainer').innerHTML = '';
    if (!pageRows.length) {
      $('commitContainer').innerHTML = '<div class="empty-state">' + t('commitFilterEmpty') + '</div>';
      $('pagination').innerHTML = '';
    } else {
      pageRows.forEach(function (c) { $('commitContainer').appendChild(buildCommit(c)); });
    }
    $('statCommits').textContent = commits.length;
    $('statFiles').textContent = commits.reduce(function (s, c) { return s + c.stats.files; }, 0);
    $('statAdded').textContent = '+' + commits.reduce(function (s, c) { return s + c.stats.added; }, 0);
    $('statRemoved').textContent = '-' + commits.reduce(function (s, c) { return s + c.stats.removed; }, 0);
    $('statsBar').style.display = 'flex';
    var total = Math.ceil(filtered.length / pageSize);
    $('pagination').innerHTML = '';
    if (total > 1) {
      var prev = el('button', 'page-btn', t('pagePrev'));
      prev.disabled = page === 1;
      prev.addEventListener('click', function () { page--; renderCommits(); });
      var info = el('span', 'page-info', (start + 1) + '-' + Math.min(start + pageSize, filtered.length) + ' / ' + filtered.length);
      var next = el('button', 'page-btn', t('pageNext'));
      next.disabled = page === total;
      next.addEventListener('click', function () { page++; renderCommits(); });
      $('pagination').appendChild(prev);
      $('pagination').appendChild(info);
      $('pagination').appendChild(next);
    }
  }

  function buildCommit(c) {
    var item = el('div', 'commit-item' + (c.id === expanded ? ' expanded' : ''));
    var avatar = el('div', 'commit-avatar', (c.author || '').slice(0, 2));
    avatar.style.background = avatarColor(c.author);
    var content = el('div', 'commit-content');
    var header = el('div', 'commit-header');
    header.appendChild(el('span', 'commit-type commit-type-' + c.type, c.type));
    header.appendChild(el('span', 'commit-message', c.message));
    var meta = el('div', 'commit-meta');
    meta.appendChild(el('span', 'commit-hash', c.shortId));
    meta.appendChild(el('span', null, '\u00b7 ' + c.author));
    meta.appendChild(el('span', null, '\u00b7 ' + fmtDate(c.date)));
    var stats = el('div', 'commit-stats');
    if (c.stats.files > 0) stats.appendChild(el('span', 'stat-badge modified', t('commitFiles', { n: c.stats.files })));
    if (c.stats.added > 0) stats.appendChild(el('span', 'stat-badge added', '+' + c.stats.added));
    if (c.stats.removed > 0) stats.appendChild(el('span', 'stat-badge removed', '-' + c.stats.removed));
    content.appendChild(header);
    content.appendChild(meta);
    content.appendChild(stats);
    item.appendChild(avatar);
    item.appendChild(content);
    item.addEventListener('click', function () {
      expanded = expanded === c.id ? null : c.id;
      renderCommits();
    });
    if (c.id === expanded) item.appendChild(buildExpanded(c));
    return item;
  }

  function buildExpanded(c) {
    var wrap = el('div', 'commit-expanded');
    var details = el('div', 'commit-details');
    var info = el('div', null);
    info.appendChild(infoRow(t('infoHash'), c.id));
    info.appendChild(infoRow(t('infoAuthor'), c.author));
    info.appendChild(infoRow(t('infoDate'), new Date(c.date).toLocaleString(t('dateLocale'))));
    var fileList = el('div', 'file-list');
    fileList.appendChild(el('div', 'info-label', t('filesChanged', { n: c.files.length })));
    c.files.forEach(function (f) {
      var item = el('div', 'file-item' + (c._file === f.name ? ' selected' : ''), '');
      item.appendChild(el('span', null, '\ud83d\udcc4'));
      item.appendChild(el('span', 'file-name', f.name));
      var st = el('span', 'file-stats');
      if (f.added > 0) st.appendChild(el('span', 'file-stat added', '+' + f.added));
      if (f.removed > 0) st.appendChild(el('span', 'file-stat removed', '-' + f.removed));
      item.appendChild(st);
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        c._file = c._file === f.name ? null : f.name;
        renderCommits();
      });
      fileList.appendChild(item);
    });
    var host = el('div', 'diff-host');
    if (c._file) loadDiff(host, c.id, c._file);
    else host.appendChild(el('div', 'diff-placeholder', t('selectFileHint')));
    fileList.appendChild(host);
    details.appendChild(info);
    details.appendChild(fileList);
    wrap.appendChild(details);
    return wrap;
  }

  function infoRow(label, value) {
    var item = el('div', 'info-item');
    item.appendChild(el('div', 'info-label', label));
    item.appendChild(el('div', 'info-value', value));
    return item;
  }

  function loadDiff(host, commitId, filename) {
    host.innerHTML = '';
    host.appendChild(el('div', 'diff-loading', t('diffLoading')));
    fetch('/api/git-push/diff?repo=' + encodeURIComponent(current.path) + '&commit=' + encodeURIComponent(commitId) + '&file=' + encodeURIComponent(filename)).then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status));
    }).then(function (data) {
      host.innerHTML = '';
      if (!data || !data.ok || !data.parsed || !data.parsed.lines) {
        host.appendChild(el('div', 'diff-placeholder', t('diffEmpty')));
        return;
      }
      var panel = el('div', 'diff-panel');
      var head = el('div', 'diff-panel-header');
      head.appendChild(el('span', 'diff-panel-title', filename));
      head.appendChild(el('span', 'diff-panel-meta', '+' + data.parsed.added + ' / -' + data.parsed.removed));
      panel.appendChild(head);
      var body = el('div', 'diff-panel-body');
      var lineNo = 0;
      data.parsed.lines.forEach(function (line) {
        if (line.type === 'hunk') { lineNo = 0; }
        var row = el('div', 'diff-line' + (line.type === 'added' ? ' added' : line.type === 'removed' ? ' removed' : line.type === 'hunk' ? ' hunk' : ''));
        if (line.type !== 'hunk') {
          lineNo += 1;
          row.appendChild(el('span', 'dl-no', String(lineNo)));
        }
        row.appendChild(el('span', null, line.type === 'hunk' ? line.content : (line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  ') + line.content));
        body.appendChild(row);
      });
      panel.appendChild(body);
      host.appendChild(panel);
    }).catch(function (e) {
      host.innerHTML = '';
      host.appendChild(el('div', 'diff-placeholder', t('diffFailed', { err: e.message })));
    });
  }

  // ---- 手动选择本地仓库（v1.25.0）：输入仓库路径或目录 → 调只读 repos API（paths / root） ----
  function addManualRepo() {
    var raw = ($('manualInput').value || '').trim();
    if (!raw) return;
    $('manualBtn').disabled = true;
    $('manualBtn').textContent = t('manualAdding');
    var before = repos.length;
    var scanPaths = fetch('/api/git-push/repos?paths=' + encodeURIComponent(raw)).then(function (r) { return r.ok ? r.json() : null; });
    var scanRoot = fetch('/api/git-push/repos?root=' + encodeURIComponent(raw)).then(function (r) { return r.ok ? r.json() : null; });
    Promise.all([scanPaths, scanRoot]).then(function (results) {
      var found = [];
      results.forEach(function (data) {
        if (data && data.ok && Array.isArray(data.repos)) data.repos.forEach(function (repo) {
          if (!repos.some(function (r) { return r.path === repo.path; })) found.push(repo);
        });
      });
      found.forEach(function (repo) { repo._manual = true; repos.push(repo); });
      $('manualBtn').disabled = false;
      $('manualBtn').textContent = t('manualAdd');
      if (found.length) {
        renderSidebar();
        selectRepo(found[0]);
        $('statusBar').textContent = t('manualOk', { n: found.length });
        $('statusBar').className = 'status-bar success visible';
        setTimeout(function () { $('statusBar').className = 'status-bar'; }, 4000);
      } else {
        $('statusBar').textContent = t('manualEmpty') + ': ' + raw;
        $('statusBar').className = 'status-bar error visible';
        setTimeout(function () { $('statusBar').className = 'status-bar'; }, 4000);
      }
    }).catch(function () {
      $('manualBtn').disabled = false;
      $('manualBtn').textContent = t('manualAdd');
      $('statusBar').textContent = t('repoLoadFailed', { err: 'network' });
      $('statusBar').className = 'status-bar error visible';
    });
  }

  // ---- init ----
  var filterBtns = document.querySelectorAll('.filter-btn');
  function updateFilterBtns() {
    filterBtns.forEach(function (b) { if (b.dataset.filter === 'all') b.textContent = t('filterAll'); });
  }
  updateFilterBtns();
  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      filter = btn.dataset.filter;
      applyFilter();
    });
  });
  $('repoSearch').addEventListener('input', renderSidebar);
  $('refreshBtn').addEventListener('click', function () {
    if (!current) return;
    delete cache[current.path];
    selectRepo(current);
  });
  $('langBtn').addEventListener('click', function () { setLocale(L === 'zh' ? 'en' : 'zh'); });
  $('manualBtn').addEventListener('click', addManualRepo);
  $('manualInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') addManualRepo(); });
  fetch('/api/git-push/repos').then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }).then(function (data) {
    repos = data && data.ok ? data.repos : [];
    renderSidebar();
    if (repos.length === 1) selectRepo(repos[0]);
  }).catch(function (e) {
    $('repoList').innerHTML = '<div class="empty-state">' + t('repoLoadFailed', { err: e.message }) + '</div>';
  });
})();`;

/**
 * 渲染查看器页面 HTML（零外部依赖：全部样式与脚本内嵌，数据走 /api/git-push/*）。
 * @param {object} opts { workspaceRoot, depth, extraRepos, extraReposFile, version, locale }
 *   locale 默认 'zh'（查看器多语言，v1.25.0；字典见 lib/viewer-locales.js）
 */
export function renderViewerPage({ workspaceRoot = '', depth = 3, extraRepos = [], extraReposFile = '', version = '', locale } = {}) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lang = localeOf(locale);
  const dict = VIEWER_LOCALES[lang];
  const noteParts = [
    dict.noteRoot + ': ' + (workspaceRoot || dict.noteNone),
    dict.noteDepth + ': ' + depth,
    extraRepos.length ? 'extraRepos: ' + extraRepos.join(', ') : '(' + dict.noteNone + ')',
    extraReposFile ? 'extraReposFile: ' + extraReposFile : '',
  ].filter(Boolean).join(' | ');
  const i18nJson = JSON.stringify({ locale: lang, locales: VIEWER_LOCALES }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${lang === 'zh' ? 'Git 提交历史查看器' : 'Git Commit History Viewer'} - dsh-git-push v${esc(version)}</title>
<style>${VIEWER_STYLE}</style>
</head>
<body>
<div class="layout">
  <div class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title">${dict.sidebarTitle}</div>
      <input class="repo-search" id="repoSearch" type="text" placeholder="${esc(dict.searchPlaceholder)}" autocomplete="off">
    </div>
    <div class="manual-box">
      <div class="manual-title">${dict.manualTitle}</div>
      <div class="manual-row">
        <input class="manual-input" id="manualInput" type="text" placeholder="${esc(dict.manualPlaceholder)}" autocomplete="off">
        <button class="manual-btn" id="manualBtn">${dict.manualAdd}</button>
      </div>
    </div>
    <div class="repo-list" id="repoList"></div>
    <div class="sidebar-footer" id="sidebarFooter">${dict.footerLoading}</div>
  </div>
  <div class="main">
    <div class="topbar">
      <div class="topbar-left">
        <span class="topbar-repo" id="topbarRepo"></span>
        <span class="topbar-stats" id="topbarStats"></span>
      </div>
      <div class="topbar-right">
        <button class="filter-btn active" data-filter="all">${dict.filterAll}</button>
        <button class="filter-btn" data-filter="feat">feat</button>
        <button class="filter-btn" data-filter="fix">fix</button>
        <button class="filter-btn" data-filter="docs">docs</button>
        <button class="refresh-btn" id="refreshBtn">${dict.refresh}</button>
        <button class="lang-btn" id="langBtn">${dict.langToggle}</button>
      </div>
    </div>
    <div class="note">${esc(dict.note.replace('{config}', noteParts))}</div>
    <div class="status-bar" id="statusBar"></div>
    <div class="stats-bar" id="statsBar" style="display:none">
      <span>${dict.statCommits}: <strong id="statCommits">0</strong></span>
      <span>${dict.statFiles}: <strong id="statFiles">0</strong></span>
      <span>${dict.statAdded}: <strong style="color:#1a7f37" id="statAdded">0</strong></span>
      <span>${dict.statRemoved}: <strong style="color:#cf222e" id="statRemoved">0</strong></span>
    </div>
    <div class="commit-container" id="commitContainer"><div class="loading-spinner">${dict.noRepoSelected}</div></div>
    <div class="pagination" id="pagination"></div>
  </div>
</div>
<script>window.__VIEWER_I18N = ${i18nJson};<\/script>
<script>${VIEWER_SCRIPT}<\/script>
</body>
</html>`;
}