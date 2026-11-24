/**
 * tag 管理：打 / 推 / 列 / 删
 *
 * 两条通道，按场景选，**API 优先、git 协议回退**：
 *   · **GitHub API**：与插件的 clone / push 一致（都走 api.github.com），不需要本地先有 tag，
 *     并且能在 dryRun 里精确预演「会创建哪个 ref」。annotated tag 要「先建 tag 对象、再建 ref」两次调用。
 *   · **git 协议**（`git push origin <tag>`）：本地已有 tag（尤其带签名）时天然保真，
 *     不依赖 token，也支持 annotated 的完整语义。
 *
 * 本模块的 API 部分与 lib/git/post-push.js 的「推送后自动打 v<version>」**共用同一份实现**
 *   （createTagRefViaApi）——否则「自动打的」与「手动打的」迟早走成两套判定，
 *   出现「同一个 tag 自动能打、手动报已存在」这种难查的分歧。
 *
 * 安全口径（与插件其它写操作一致）：
 *   · 所有写操作 **dryRun 默认开**，要真做必须显式 dryRun:false；
 *   · 删除还要额外 `confirm:true`（不可逆，对齐 npm_unpublish 的处置方式）；
 *   · 同名 tag 默认**不覆盖**，要覆盖必须显式 force（覆盖会移动 ref，等于改写发布含义）。
 */
import { resolveToken } from './credentials.js';
import { githubFetch, parseGithubOwnerRepo } from './api.js';
import { runGit } from './exec.js';

/** 单次 tag API 调用超时（建 ref / 建 tag 对象都很快，30s 足够覆盖慢网络）。 */
const TAG_API_TIMEOUT_MS = 30_000;

/**
 * tag 名合法性（git check-ref-format 的实用子集）。
 * 为什么不直接调 git 校验：dryRun 阶段不该为了「名字合不合法」去 spawn 进程；
 *   这里覆盖真正会出问题的形态即可（空格、`..`、`~^:?*[`、以 `/` 或 `.` 开头结尾、`@{`）。
 */
export function isValidTagName(name) {
  // 刻意**不 trim**：tag 名带前导/尾随空格是输入错误，应当报错而不是被静默修正成另一个名字
  //   （用户的 `" v1.0"` 到底想要 `v1.0` 还是打错了？插件不该替用户猜）。
  const text = String(name ?? '');
  if (!text || text.length > 200) return false;
  if (/\s/.test(text)) return false;
  if (/[~^:?*[\\]/.test(text)) return false;
  if (text.includes('..') || text.includes('@{')) return false;
  if (text.startsWith('/') || text.endsWith('/') || text.startsWith('.') || text.endsWith('.')) return false;
  if (text.endsWith('.lock')) return false;
  return true;
}

/** 取 HEAD 的完整 sha（空仓库返回空串）。 */
function headSha(repoPath) {
  const result = runGit(['rev-parse', 'HEAD'], { cwd: repoPath });
  return result.ok ? String(result.stdout || '').trim() : '';
}

/** 某个 commit 的一行摘要，供 dryRun 预览「这个 tag 会指向什么」。 */
export function describeCommit(repoPath, sha) {
  if (!sha) return '';
  const result = runGit(['log', '-1', '--format=%h %s', sha], { cwd: repoPath });
  return result.ok ? String(result.stdout || '').trim() : '';
}

/** 本地是否已有该 tag。 */
export function localTagExists(repoPath, tag) {
  const result = runGit(['tag', '-l', tag], { cwd: repoPath });
  return result.ok && String(result.stdout || '').trim() === tag;
}

/** 列表：本地 tag（`git tag -l`）。 */
export function listLocalTags({ repoPath = '', pattern = '' } = {}) {
  const args = pattern ? ['tag', '-l', pattern] : ['tag', '-l'];
  const result = runGit(args, { cwd: repoPath });
  if (!result.ok) return { ok: false, error: String(result.stderr || 'git tag 失败').trim() };
  const tags = String(result.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean).sort();
  return { ok: true, tags };
}

/** 把「建 ref / 建 tag 对象」的响应归类成统一结果（与 post-push 的 skipped 语义一致）。 */
function classifyCreateResult(response, tag) {
  if (response.status === 201) return { ok: true, tag };
  if (response.status === 422) {
    if (/already exists/i.test(response.json?.message || '')) return { ok: false, skipped: 'tag-exists', tag };
    return { ok: false, skipped: '422', tag, error: response.json?.message || '422' };
  }
  return { ok: false, skipped: String(response.status), tag, error: response.error || `GitHub API ${response.status}` };
}

/**
 * 通过 GitHub API 建一个 tag ref（**与 post-push 的自动打 tag 共用**）。
 *
 * 轻量 tag：直接 `POST /git/refs`，ref = refs/tags/<tag>、sha = 目标提交。
 * annotated tag：先 `POST /git/tags` 建 tag 对象（带 message），再用它的 sha 建 ref。
 *   第二次失败会留下一个没有 ref 指向的 tag 对象——在 GitHub 上不可见、无害，
 *   但回执里会带 `orphanTagObject`，避免「建了却没成」这件事被悄悄吞掉。
 *
 * @returns {Promise<{ok:boolean, tag?:string, skipped?:string, error?:string, orphanTagObject?:string}>}
 */
export async function createTagRefViaApi({
  owner = '', repo = '', tag = '', sha = '', message = '', token = '',
  annotated = false, fetchImpl = githubFetch,
} = {}) {
  if (!owner || !repo || !tag || !sha) return { ok: false, skipped: 'bad-args', error: 'owner/repo/tag/sha 缺一不可' };
  const base = `/repos/${owner}/${repo}`;
  const existing = await fetchImpl(`${base}/git/ref/tags/${tag}`, { token, timeout: TAG_API_TIMEOUT_MS });
  if (existing.status === 200) return { ok: false, skipped: 'tag-exists', tag };
  if (!annotated) {
    const created = await fetchImpl(`${base}/git/refs`, {
      token, method: 'POST', body: { ref: `refs/tags/${tag}`, sha }, timeout: TAG_API_TIMEOUT_MS,
    });
    return classifyCreateResult(created, tag);
  }
  const tagObject = await fetchImpl(`${base}/git/tags`, {
    token, method: 'POST',
    body: { tag, message: String(message || tag), object: sha, type: 'commit' },
    timeout: TAG_API_TIMEOUT_MS,
  });
  if (tagObject.status !== 201) return classifyCreateResult(tagObject, tag);
  const tagObjectSha = String(tagObject.json?.sha || '');
  if (!tagObjectSha) return { ok: false, skipped: 'no-tag-object-sha', tag, error: '建 tag 对象成功但没拿到 sha' };
  const refCreated = await fetchImpl(`${base}/git/refs`, {
    token, method: 'POST', body: { ref: `refs/tags/${tag}`, sha: tagObjectSha }, timeout: TAG_API_TIMEOUT_MS,
  });
  const result = classifyCreateResult(refCreated, tag);
  if (!result.ok) result.orphanTagObject = tagObjectSha;
  return result;
}

/** 从本地 origin 解析 owner/repo（解析不到返回 null）。 */
export function resolveOwnerRepo(repoPath) {
  const originUrl = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath });
  if (!originUrl.ok) return null;
  return parseGithubOwnerRepo(String(originUrl.stdout || '').trim());
}

/**
 * 建 tag（本地建 + 可选推远端）。
 *
 * @param {object} options
 * @param {string} options.repoPath 仓库路径
 * @param {string} options.tag tag 名
 * @param {string} [options.sha] 目标提交（缺省取 HEAD，不猜分支）
 * @param {string} [options.message] annotated tag 的说明
 * @param {boolean} [options.annotated=false] 是否建 annotated tag
 * @param {boolean} [options.dryRun=true] 默认只预演
 * @param {boolean} [options.force=false] 允许覆盖同名 tag（会移动 ref）
 * @param {boolean} [options.push=false] 建完是否推远端
 * @param {string} [options.token] GitHub token（推远端时用；缺省从插件凭据解析）
 */
export async function createTag({
  repoPath = '', tag = '', sha = '', message = '', annotated = false,
  dryRun = true, force = false, push = false, token = '', fetchImpl = githubFetch,
} = {}) {
  const name = String(tag ?? '');
  if (!isValidTagName(name)) {
    return { ok: false, error: `tag 名不合法：${name || '(空)'}（不能含空格 / .. / ~^:?*[ 等，不能以 . 或 / 开头结尾）` };
  }
  const targetSha = String(sha || '').trim() || headSha(repoPath);
  if (!targetSha) return { ok: false, error: '没有可指向的提交（空仓库？请显式传 sha）' };
  const alreadyExists = localTagExists(repoPath, name);
  if (alreadyExists && !force) {
    return { ok: false, error: `本地已存在同名 tag：${name}（要覆盖请传 force:true）` };
  }

  const preview = {
    tag: name,
    sha: targetSha,
    commit: describeCommit(repoPath, targetSha),
    annotated: annotated === true,
    message: annotated ? String(message || name) : '',
    willForce: alreadyExists && force === true,
    willPush: push === true,
  };

  if (dryRun !== false) return { ok: true, dryRun: true, ...preview };

  // 1) 本地建（-f 仅在 force 时加：默认绝不覆盖已有 tag）
  const gitArgs = ['tag'];
  if (annotated) gitArgs.push('-a', name, '-m', String(message || name));
  else gitArgs.push(name);
  gitArgs.push(targetSha);
  if (force) gitArgs.splice(1, 0, '-f');
  const created = runGit(gitArgs, { cwd: repoPath });
  if (!created.ok) {
    return { ok: false, error: `本地打 tag 失败：${String(created.stderr || '').trim().slice(0, 200)}`, ...preview };
  }

  // 2) 可选推远端
  if (!push) return { ok: true, ...preview, localCreated: true };
  const pushed = await pushTag({ repoPath, tag: name, token, fetchImpl, dryRun: false, annotated });
  return { ok: pushed.ok, ...preview, localCreated: true, push: pushed, ...(pushed.ok ? {} : { error: pushed.error }) };
}

/**
 * 推 tag 到远端：API 优先、git 协议回退。
 *
 * 为什么 API 优先：与插件其它远端操作一致（统一走 token 鉴权），且不依赖本地 SSH 通道。
 * 为什么仍要 git 回退：annotated tag 的完整语义（tagger / message）在 API 路径需要两次调用，
 *   而「本地已经有这个 tag」时 `git push origin <tag>` 一次就完整推过去，更省也更保真。
 */
export async function pushTag({
  repoPath = '', tag = '', remote = 'origin', token = '', annotated = false,
  dryRun = true, fetchImpl = githubFetch,
} = {}) {
  const name = String(tag ?? '');
  if (!isValidTagName(name)) return { ok: false, error: `tag 名不合法：${name || '(空)'}` };
  if (!localTagExists(repoPath, name)) {
    return { ok: false, error: `本地没有这个 tag：${name}（先 createTag 再推）` };
  }
  const targetSha = (() => {
    // 轻量 tag 指向提交；annotated tag 指向 tag 对象，需要 peel 一层拿到提交
    const peeled = runGit(['rev-list', '-n', '1', name], { cwd: repoPath });
    return peeled.ok ? String(peeled.stdout || '').trim() : '';
  })();
  const resolvedToken = String(token || '').trim() || resolveToken({ repoPath }).token;
  const parsed = resolveOwnerRepo(repoPath);
  const preview = { tag: name, remote, sha: targetSha, owner: parsed?.owner || '', repo: parsed?.repo || '' };

  if (dryRun !== false) {
    return {
      ok: true, dryRun: true, ...preview,
      channels: {
        api: !!(resolvedToken && parsed?.owner && parsed?.repo),
        git: true,
      },
    };
  }

  // 通道 1：GitHub API
  let apiFailure = '';
  if (resolvedToken && parsed?.owner && parsed?.repo) {
    const apiResult = await createTagRefViaApi({
      owner: parsed.owner, repo: parsed.repo, tag: name, sha: targetSha,
      message: annotated ? name : '', token: resolvedToken, annotated, fetchImpl,
    });
    if (apiResult.ok) return { ok: true, channel: 'api', ...preview };
    // tag 已存在：远端已经有了，按成功处理（与「幂等」语义一致），但如实标注
    if (apiResult.skipped === 'tag-exists') return { ok: true, channel: 'api', alreadyExisted: true, ...preview };
    // 其它失败：继续尝试 git 协议
    apiFailure = apiResult.error || apiResult.skipped;
  }

  // 通道 2：git 协议
  const pushed = runGit(['push', remote, name], { cwd: repoPath, timeoutMs: 120_000 });
  if (pushed.ok) return { ok: true, channel: 'git', ...preview };
  return {
    ok: false, ...preview,
    error: `两条通道都失败：API ${apiFailure || '(不可用：缺 token 或解析不出 owner/repo)'}；git ${String(pushed.stderr || '').trim().slice(0, 200)}`,
  };
}

/**
 * 删 tag：本地删 +（可选）远端删。
 * 默认 dryRun；真删必须 confirm（不可逆，且可能破坏别人的发布引用）。
 */
export async function deleteTag({
  repoPath = '', tag = '', remote = 'origin', token = '', deleteRemote = true,
  dryRun = true, confirm = false, fetchImpl = githubFetch,
} = {}) {
  const name = String(tag ?? '');
  if (!isValidTagName(name)) return { ok: false, error: `tag 名不合法：${name || '(空)'}` };
  const existsLocally = localTagExists(repoPath, name);
  const resolvedToken = String(token || '').trim() || resolveToken({ repoPath }).token;
  const parsed = resolveOwnerRepo(repoPath);
  const preview = { tag: name, existsLocally, remote, deleteRemote: deleteRemote === true };

  if (dryRun !== false) return { ok: true, dryRun: true, ...preview };
  if (confirm !== true) {
    return { ok: false, error: '删除不可逆：确认后请传 confirm:true（建议先 dryRun 看要删什么）', ...preview };
  }

  const steps = [];
  if (existsLocally) {
    const localDeleted = runGit(['tag', '-d', name], { cwd: repoPath });
    steps.push({ target: 'local', ok: localDeleted.ok, detail: String(localDeleted.stdout || localDeleted.stderr || '').trim().slice(0, 120) });
    if (!localDeleted.ok) return { ok: false, ...preview, steps, error: `本地删除失败：${steps[0].detail}` };
  }

  if (deleteRemote && resolvedToken && parsed?.owner && parsed?.repo) {
    const response = await fetchImpl(`/repos/${parsed.owner}/${parsed.repo}/git/refs/tags/${name}`, {
      token: resolvedToken, method: 'DELETE', timeout: TAG_API_TIMEOUT_MS,
    });
    // 204 = 删除成功；404 = 远端本来就没有（按成功处理，幂等）
    const remoteOk = response.status === 204 || response.status === 404;
    steps.push({ target: 'remote', ok: remoteOk, status: response.status, detail: response.error || '' });
    if (!remoteOk) {
      return { ok: false, ...preview, steps, error: `远端删除失败：HTTP ${response.status}` };
    }
  } else if (deleteRemote) {
    const pushed = runGit(['push', remote, `:refs/tags/${name}`], { cwd: repoPath, timeoutMs: 120_000 });
    steps.push({ target: 'remote', channel: 'git', ok: pushed.ok, detail: String(pushed.stderr || '').trim().slice(0, 120) });
    if (!pushed.ok) return { ok: false, ...preview, steps, error: `远端删除失败：${steps[steps.length - 1].detail}` };
  }

  return { ok: true, ...preview, steps };
}

/** 远端 tag 列表（走 API，需要 token 才能读私有库）。 */
export async function listRemoteTags({ owner = '', repo = '', token = '', fetchImpl = githubFetch } = {}) {
  if (!owner || !repo) return { ok: false, error: '需要 owner 与 repo' };
  const response = await fetchImpl(`/repos/${owner}/${repo}/git/refs/tags`, { token, timeout: TAG_API_TIMEOUT_MS });
  if (response.status !== 200) {
    return { ok: false, status: response.status, error: response.error || `GitHub API ${response.status}` };
  }
  const refs = Array.isArray(response.json) ? response.json : [];
  const tags = refs
    .map((item) => String(item?.ref || '').replace(/^refs\/tags\//, ''))
    .filter(Boolean)
    .sort();
  return { ok: true, tags, count: tags.length };
}
