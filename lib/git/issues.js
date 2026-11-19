// Git 执行层 · GitHub Issue 与 PR（只读查询 + 创建/评论）
//
// 设计边界（**刻意不做的事**）：
//   · 不做 PR merge —— 合并他人代码是不可逆远端状态变更，且涉及审查责任，让用户去网页点
//   · 不做 review（approve / request changes）—— 那是代人做决定，AI 不该有这个权限
//   · 不做 issue/PR 删除 —— 同上，破坏性操作不开口子
//
// 网络出口与其余 GitHub 能力一致：统一走 githubFetch（api.github.com 硬闸 + 凭据不经镜像）。

import { githubFetch } from './api.js';

/** 单次列举的默认条数（GitHub 上限 100）。 */
const DEFAULT_LIST_LIMIT = 30;

/** issue/PR 的正文长度上限（GitHub 限制 65536，这里留余量避免贴着上限失败）。 */
const BODY_MAX_CHARS = 60000;

/**
 * 解析 owner/repo：接受 `owner/repo` 字符串，或从本地仓库 origin 推导。
 *
 * @param {string} repo 目标仓库（`owner/repo` 形式）
 * @returns {{ok: boolean, owner?: string, name?: string, error?: string}}
 */
function parseRepoSlug(repo = '') {
  const text = String(repo || '').trim();
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(text);
  if (!m) return { ok: false, error: `repo 需为 owner/repo 形式（实得：${text || '(空)'}）` };
  return { ok: true, owner: m[1], name: m[2] };
}

/**
 * 把 githubFetch 的结果统一成 { ok, status, data, error } 形态。
 *
 * 为什么单独抽：issue 与 PR 十来个动作都要这套判断，散在各处必然漂移
 *   （「有的动作吞 404、有的不吞」是这类封装最常见的缺陷）。
 */
function normalizeResponse(res) {
  if (!res) return { ok: false, status: 0, error: '请求无返回' };
  if (res.error) return { ok: false, status: res.status || 0, error: res.error };
  const status = Number(res.status || 0);
  if (status >= 200 && status < 300) return { ok: true, status, data: res.json, rateLimit: res.rateLimit };
  // GitHub 的错误响应带 message；取不到时退回原文前 200 字符（含 HTML 错误页的情况）
  const msg = res.json?.message || String(res.text || '').slice(0, 200) || `HTTP ${status}`;
  return { ok: false, status, error: msg, rateLimit: res.rateLimit };
}

/** 校验必填字符串，返回去空白后的值。 */
function requireText(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${fieldName} 必填`);
  return text;
}

/** 正文长度守卫：超长直接报错，而不是让 GitHub 返回 422 让人猜。 */
function guardBody(body) {
  const text = String(body ?? '');
  if (text.length > BODY_MAX_CHARS) {
    throw new Error(`body 过长（${text.length} 字符，上限 ${BODY_MAX_CHARS}）——请精简或改为分段评论`);
  }
  return text;
}

/**
 * issue 列表项裁剪：GitHub 返回的原始对象很大（含 user/reactions/timeline 等），
 *   全量回传会把 AI 上下文吃光。只留定位与判断真正需要的字段。
 */
function slimIssue(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    number: item.number,
    title: item.title,
    state: item.state,
    user: item.user?.login || '',
    labels: (item.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
    comments: item.comments,
    created_at: item.created_at,
    updated_at: item.updated_at,
    html_url: item.html_url,
    ...(item.pull_request ? { is_pr: true } : {}),
  };
}

/** PR 列表项裁剪（比 issue 多 head/base/draft/merged 等判定字段）。 */
function slimPull(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    number: item.number,
    title: item.title,
    state: item.state,
    draft: !!item.draft,
    merged: !!item.merged_at,
    user: item.user?.login || '',
    head: item.head?.ref || '',
    base: item.base?.ref || '',
    comments: item.comments,
    created_at: item.created_at,
    updated_at: item.updated_at,
    html_url: item.html_url,
  };
}

// ───────────────────────── Issue ─────────────────────────

/**
 * Issue 域动作。
 *
 * @param {object} o
 * @param {'list'|'create'|'comment'|'close'} o.action
 * @param {string} o.repo owner/repo
 * @param {string} [o.token] GitHub token（只读可空，写操作必须给）
 * @param {number|string} [o.number] issue 编号（comment/close 必填）
 * @param {string} [o.title] 标题（create 必填）
 * @param {string} [o.body] 正文
 * @param {string[]|string} [o.labels] 标签（create 用）
 * @param {string} [o.state] 列表过滤（list 用：open/closed/all，默认 open）
 * @param {number} [o.limit] 列表条数（默认 30，上限 100）
 * @returns {Promise<object>}
 */
export async function issueAction({
  action = 'list', repo = '', token = '', number, title, body, labels, state = 'open', limit = DEFAULT_LIST_LIMIT,
  dryRun = false,
} = {}) {
  const slug = parseRepoSlug(repo);
  if (!slug.ok) return { ok: false, error: slug.error };
  const base = `/repos/${slug.owner}/${slug.name}/issues`;
  const act = String(action || 'list').toLowerCase();

  // dryRun：create / comment / close 三个写操作只回「将要发出的请求」，一行都不碰远端。
  // 为什么必须有：没有它的时候，验证接口是否可用只能在真仓库上真建真改 —— 在别人的仓库里
  // 建了测试 issue 只能事后手工去关，既留垃圾又打扰维护者。预览里给出 method / path / body，
  // 足以判断「会打哪个端点、带什么内容」。
  if (dryRun === true && (act === 'create' || act === 'comment' || act === 'close')) {
    const num = Number(number) || 0;
    const would = {
      method: act === 'close' ? 'PATCH' : 'POST',
      path: act === 'create' ? base : `${base}/${num}${act === 'comment' ? '/comments' : ''}`,
    };
    if (act === 'create') {
      would.body = { title: String(title ?? ''), body: String(body ?? '') };
      const labelList = Array.isArray(labels) ? labels.filter(Boolean) : String(labels || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (labelList.length) would.body.labels = labelList;
    } else if (act === 'comment') {
      if (!num) return { ok: false, error: 'comment 需要 number（issue 编号）' };
      would.body = { body: String(body ?? '') };
    } else {
      would.body = { state: 'closed' };
    }
    return { ok: true, dryRun: true, action: act, repo: `${slug.owner}/${slug.name}`, would };
  }

  try {
    if (act === 'list') {
      const perPage = Math.min(Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1), 100);
      const res = await githubFetch(`${base}?state=${encodeURIComponent(state)}&per_page=${perPage}`, { token });
      const r = normalizeResponse(res);
      if (!r.ok) return r;
      const items = (Array.isArray(r.data) ? r.data : [])
        .filter((x) => !x?.pull_request) // GitHub 的 issues 接口会连 PR 一起返回，这里只留真 issue
        .map(slimIssue)
        .filter(Boolean);
      return { ok: true, repo: `${slug.owner}/${slug.name}`, count: items.length, issues: items };
    }

    if (act === 'create') {
      const payload = { title: requireText(title, 'title') };
      const bodyText = guardBody(body);
      if (bodyText) payload.body = bodyText;
      const labelList = Array.isArray(labels)
        ? labels.filter(Boolean)
        : String(labels || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (labelList.length) payload.labels = labelList;
      const res = await githubFetch(base, { token, method: 'POST', body: JSON.stringify(payload) });
      const r = normalizeResponse(res);
      if (!r.ok) return r;
      return { ok: true, repo: `${slug.owner}/${slug.name}`, issue: slimIssue(r.data), url: r.data?.html_url || '' };
    }

    if (act === 'comment') {
      const num = Number(number);
      if (!Number.isFinite(num) || num <= 0) return { ok: false, error: 'comment 需要 number（issue 编号）' };
      const bodyText = guardBody(body);
      if (!bodyText) return { ok: false, error: 'comment 需要 body（评论内容）' };
      const res = await githubFetch(`${base}/${num}/comments`, { token, method: 'POST', body: JSON.stringify({ body: bodyText }) });
      const r = normalizeResponse(res);
      if (!r.ok) return r;
      return { ok: true, repo: `${slug.owner}/${slug.name}`, number: num, comment_id: r.data?.id, url: r.data?.html_url || '' };
    }

    if (act === 'close') {
      const num = Number(number);
      if (!Number.isFinite(num) || num <= 0) return { ok: false, error: 'close 需要 number（issue 编号）' };
      const res = await githubFetch(`${base}/${num}`, { token, method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      const r = normalizeResponse(res);
      if (!r.ok) return r;
      return { ok: true, repo: `${slug.owner}/${slug.name}`, issue: slimIssue(r.data) };
    }

    return { ok: false, error: `不支持的 action：${action}（允许：list / create / comment / close）` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ───────────────────────── Pull Request ─────────────────────────

/**
 * PR 域动作。
 *
 * @param {object} o
 * @param {'list'|'create'|'comment'|'files'|'commits'} o.action
 * @param {string} o.repo owner/repo
 * @param {string} [o.token]
 * @param {number|string} [o.number] PR 编号（comment/files/commits 必填）
 * @param {string} [o.title] create 必填
 * @param {string} [o.head] create 必填：源分支（同仓写 `分支名`，跨 fork 写 `owner:分支名`）
 * @param {string} [o.base] create 可选：目标分支（默认仓库默认分支）
 * @param {string} [o.body] 正文
 * @param {boolean} [o.draft] 是否草稿 PR
 * @param {string} [o.state] 列表过滤（open/closed/all，默认 open）
 * @param {number} [o.limit]
 */
export async function pullAction({
  action = 'list', repo = '', token = '', number, title, head, base = '', body, draft = false, state = 'open', limit = DEFAULT_LIST_LIMIT,
} = {}) {
  const slug = parseRepoSlug(repo);
  if (!slug.ok) return { ok: false, error: slug.error };
  const pulls = `/repos/${slug.owner}/${slug.name}/pulls`;
  const act = String(action || 'list').toLowerCase();

  try {
    if (act === 'list') {
      const perPage = Math.min(Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1), 100);
      const res = await githubFetch(`${pulls}?state=${encodeURIComponent(state)}&per_page=${perPage}`, { token });
      const r = normalizeResponse(res);
      if (!r.ok) return r;
      const items = (Array.isArray(r.data) ? r.data : []).map(slimPull).filter(Boolean);
      return { ok: true, repo: `${slug.owner}/${slug.name}`, count: items.length, pulls: items };
    }

    if (act === 'create') {
      const payload = {
        title: requireText(title, 'title'),
        head: requireText(head, 'head'),
      };
      // base 不填则交给 GitHub 用仓库默认分支——不在这里猜「main 还是 master」
      if (String(base || '').trim()) payload.base = String(base).trim();
      const bodyText = guardBody(body);
      if (bodyText) payload.body = bodyText;
      if (draft === true) payload.draft = true;
      const res = await githubFetch(pulls, { token, method: 'POST', body: JSON.stringify(payload) });
      const r = normalizeResponse(res);
      if (!r.ok) return r;
      return { ok: true, repo: `${slug.owner}/${slug.name}`, pull: slimPull(r.data), url: r.data?.html_url || '' };
    }

    if (act === 'comment') {
      const num = Number(number);
      if (!Number.isFinite(num) || num <= 0) return { ok: false, error: 'comment 需要 number（PR 编号）' };
      const bodyText = guardBody(body);
      if (!bodyText) return { ok: false, error: 'comment 需要 body（评论内容）' };
      // PR 评论走 issues 接口（GitHub 的设计：PR 也是 issue）
      const res = await githubFetch(`/repos/${slug.owner}/${slug.name}/issues/${num}/comments`, {
        token, method: 'POST', body: JSON.stringify({ body: bodyText }),
      });
      const r = normalizeResponse(res);
      if (!r.ok) return r;
      return { ok: true, repo: `${slug.owner}/${slug.name}`, number: num, comment_id: r.data?.id, url: r.data?.html_url || '' };
    }

    if (act === 'files') {
      const num = Number(number);
      if (!Number.isFinite(num) || num <= 0) return { ok: false, error: 'files 需要 number（PR 编号）' };
      const res = await githubFetch(`${pulls}/${num}/files?per_page=100`, { token });
      const r = normalizeResponse(res);
      if (!r.ok) return r;
      // 只留审查真正需要的字段：路径 + 增删行数 + 状态（完整 patch 太大，按需另取）
      const files = (Array.isArray(r.data) ? r.data : []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
      }));
      return { ok: true, repo: `${slug.owner}/${slug.name}`, number: num, count: files.length, files };
    }

    if (act === 'commits') {
      const num = Number(number);
      if (!Number.isFinite(num) || num <= 0) return { ok: false, error: 'commits 需要 number（PR 编号）' };
      const res = await githubFetch(`${pulls}/${num}/commits?per_page=100`, { token });
      const r = normalizeResponse(res);
      if (!r.ok) return r;
      const commits = (Array.isArray(r.data) ? r.data : []).map((c) => ({
        sha: String(c?.sha || '').slice(0, 8),
        message: String(c?.commit?.message || '').split('\n')[0],
        author: c?.commit?.author?.name || c?.author?.login || '',
        date: c?.commit?.author?.date || '',
      }));
      return { ok: true, repo: `${slug.owner}/${slug.name}`, number: num, count: commits.length, commits };
    }

    return { ok: false, error: `不支持的 action：${action}（允许：list / create / comment / files / commits）` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
