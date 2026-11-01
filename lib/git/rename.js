/**
 * 远程仓库改名（GitHub `PATCH /repos/{owner}/{repo}` 的 `name` 字段）。
 *
 * 为什么单独做一个动作：改名前要看清**旧名散落在哪里**（package.json 的 name/repository、
 *   README 里的克隆地址、CI 配置、文档链接……），改完还要把本地 remote 同步过去。
 *   这些如果交给用户手工做，最常见的结局是「远端改了、本地还指着旧的」，
 *   或者包名/文档链接集体失效。故 dryRun 默认开启，并**逐条列出旧名出现位置**。
 *
 * 不可逆性：改名后旧地址 301 跳转到新地址（clone/issue/PR 跟着走），但外部引用
 *   （npm 包元数据、第三方文档）不会自动更新；所以默认 dryRun=true，必须显式关闭才真改。
 */
import { runGit } from './exec.js';
import { resolveToken } from './credentials.js';
import { githubFetch } from './api.js';
import { parseOwnerRepoFromRemote } from './remote.js';

/** GitHub 仓库名规则：字母数字与 `._-`，不超过 100 字符。 */
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * 扫描旧仓库名在仓库内的出现位置（dryRun 用）。
 *
 * 用 `git grep`（比 FS 递归快几个数量级，挂载盘上尤其明显）；带超时与条数上限，
 *   宁可少报也不让探针本身把 dryRun 拖住。非 git 目录返回 skipped。
 * @returns {{scanned:boolean, total:number, byFile:Record<string,number>, samples:Array<{file:string,line:number,text:string}>}}
 */
export function scanOldName(repoPath, oldName, { limit = 60, timeoutMs = 20000 } = {}) {
  const empty = { scanned: false, total: 0, byFile: {}, samples: [], urlLike: 0 };
  if (!oldName) return empty;
  const res = runGit(['grep', '-n', '-I', '-F', '--no-color', '-e', oldName, '--', '.'], { cwd: repoPath, timeoutMs });
  if (!res.ok && !res.stdout) return { ...empty, skipped: res.stderr?.slice(0, 200) || 'git grep 失败' };
  const urlSamples = [];   // URL 形态优先展示：改名后**必须**改的就是它们
  const textSamples = [];
  const byFile = {};
  let total = 0;
  let urlLike = 0;
  // 分类：「URL 形态」（github.com/owner/repo、git@…:owner/repo.git 等，改名后**必须**跟着改）
  //   与「普通文字」（说明/标题/user.name，通常不用改）。dryRun 里分开报，避免 293 条一起糊上来。
  const urlRe = new RegExp(`(github\\.com|ssh\\.github\\.com)[/:][^/\\s:]+/${oldName}(\\.git)?\\b`, 'i');
  for (const line of String(res.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    // 形如 `path:12:内容`
    const m = /^([^:]+):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    total += 1;
    const isUrl = urlRe.test(m[3]);
    if (isUrl) urlLike += 1;
    byFile[m[1]] = (byFile[m[1]] || 0) + 1;
    const item = { file: m[1], line: Number(m[2]), kind: isUrl ? 'url' : 'text', text: m[3].trim().slice(0, 160) };
    if (isUrl) urlSamples.push(item); else textSamples.push(item);
  }
  const samples = [...urlSamples, ...textSamples].slice(0, limit);
  return { scanned: true, total, urlLike, byFile, samples };
}

/** 列出指向该仓库的本地 remote（含 URL，便于回执里说明会改哪几条）。 */
export function remotesPointingTo(repoPath, owner, repo) {
  const res = runGit(['remote', '-v'], { cwd: repoPath });
  const out = [];
  for (const line of String(res.stdout || '').split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const [, name, url] = m;
    if (!new RegExp(`[/:]${owner}/${repo}(\\.git)?/?$`, 'i').test(url)) continue;
    if (out.some((it) => it.name === name)) continue;
    out.push({ name, url });
  }
  return out;
}

/**
 * 改名主流程。
 * @param {{repoPath?:string, owner?:string, repo?:string, newName:string, dryRun?:boolean,
 *          token?:string, updateRemotes?:boolean, scanLimit?:number}} o
 */
export async function renameRepo({
  repoPath = '', owner = '', repo = '', newName = '', dryRun = true, token = '', updateRemotes = true, scanLimit = 60,
} = {}) {
  const target = String(newName || '').trim();
  if (!NAME_RE.test(target)) return { ok: false, error: `新仓库名不合法（只允许字母数字 . _ -，≤100 字符）：${target || '(空)'}` };
  if (!repoPath) return { ok: false, error: 'repo 必填（本地仓库路径）' };
  // 从 origin 解析 owner/repo（与 git_set_visibility 同口径）
  if (!owner || !repo) {
    const cur = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath });
    const parsed = parseOwnerRepoFromRemote(cur.stdout || cur.stderr || '');
    owner = owner || parsed.owner;
    repo = repo || parsed.repo;
  }
  if (!owner || !repo) return { ok: false, error: '缺 owner/repo（origin 里解析不出 GitHub 地址）' };
  if (target === repo) return { ok: false, error: `新名与当前名相同：${repo}` };

  const tok = token || resolveToken({ workspaceRoot: repoPath }).token;
  if (!tok) return { ok: false, error: '无 token' };

  // 远端现状（顺带确认仓库存在、以及现在的 full_name）
  const info = await githubFetch(`/repos/${owner}/${repo}`, { token: tok });
  if (info.status !== 200) return { ok: false, error: info.json?.message || info.error || `HTTP ${info.status}` };
  const current = { owner, repo, fullName: info.json?.full_name || `${owner}/${repo}`, private: info.json?.private === true, htmlUrl: info.json?.html_url || '' };

  const remotes = remotesPointingTo(repoPath, owner, repo);
  const occurrences = scanOldName(repoPath, repo, { limit: scanLimit });

  if (dryRun) {
    return {
      ok: true, dryRun: true, current, target: { owner, repo: target, fullName: `${owner}/${target}` },
      remotes, occurrences,
      hint: '确认无误后传 dryRun=false 才真正改名；改名不可逆（旧地址只做 301 跳转）',
    };
  }

  const patched = await githubFetch(`/repos/${owner}/${repo}`, { token: tok, method: 'PATCH', body: { name: target } });
  if (patched.status !== 200) return { ok: false, error: patched.json?.message || patched.error || `HTTP ${patched.status}`, current };

  // 同步本地 remote（GitHub 会给旧地址 301，但别依赖跳转：SSH remote 不一定跟着走）
  const updated = [];
  if (updateRemotes) {
    for (const r of remotes) {
      const nextUrl = String(r.url).replace(new RegExp(`([/:])${owner}/${repo}(\\.git)?/?$`, 'i'), `$1${owner}/${target}$2`);
      if (nextUrl === r.url) continue;
      const set = runGit(['remote', 'set-url', r.name, nextUrl], { cwd: repoPath });
      updated.push({ name: r.name, from: r.url, to: nextUrl, ok: set.ok, error: set.ok ? '' : String(set.stderr || '').slice(0, 200) });
    }
  }
  return {
    ok: true, dryRun: false,
    current, renamedTo: { owner, repo: target, fullName: patched.json?.full_name || `${owner}/${target}` },
    remotesUpdated: updated,
    occurrences,
    // URL 形态的出现位置 = 改名后**必须**更新引用（其余是文字提及，通常不用动）
    urlOccurrencesHint: occurrences.scanned && occurrences.urlLike > 0
      ? `仓库内有 ${occurrences.urlLike} 处 URL 形态引用仍写着旧名，建议一并更新`
      : '',
    hint: updated.some((u) => !u.ok)
      ? '远端已改名，但有本地 remote 未更新成功——请手工执行 git remote set-url 修正'
      : '远端与本地 remote 均已指向新名；外部引用（npm 包元数据/第三方文档）需自行更新',
  };
}
