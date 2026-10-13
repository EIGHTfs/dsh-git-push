/**
 * GitHub remote 自动判定与修正（推送前调用）。
 *
 * 为什么需要：推送链路此前**到处假设 `origin`**（`remote get-url origin` / `push origin`），
 *   一旦 ① `origin` 不存在、② `origin` 指向别人的仓库、③ 用了本机不通的 URL 形态
 *   （如 `git@github.com:owner/repo.git` 走 22 端口），推送就会失败或推错地方。
 *   本模块给出统一判定：**归属对（owner/repo 与目标一致）+ 本机可用形态（ssh:443 优先）+ 名字稳定**，
 *   必要时自动 `remote set-url` / `remote add`，并在回执里说明做了什么（dryRun 只报告不写盘）。
 *
 * 判定口径（都是可复核的事实，不猜网络）：
 *   · 归属：remote URL 解析出的 owner/repo 必须与目标一致；
 *   · 形态：优先 `ssh://git@ssh.github.com:443/<owner>/<repo>.git`（本机实测可用通道），
 *     其次保留既有形态（如 https —— 带 token 的 https 也能推，取决于 pushMethod）；
 *   · 名字：同分候选按 `origin` > `github-ssh` > 其它 取名，避免每次推送换名字。
 */
import { runGit } from './exec.js';

/** GitHub URL 解析（兼容 https / git@ / ssh:443 / 裸域名四种写法）。 */
const GH_RE = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/\s]+@)?(?:ssh\.)?github\.com(?::\d+)?[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i;

/** 解析 GitHub remote URL ⇒ { owner, repo, form }；非 GitHub 返回 null。 */
export function parseGithubUrl(url = '') {
  const s = String(url || '').trim();
  const m = s.match(GH_RE);
  if (!m) return null;
  const ssh443 = /^ssh:\/\/[^/]*ssh\.github\.com:443\//i.test(s);
  const https = /^https?:\/\//i.test(s);
  const scp = /^[^/]+@(?:ssh\.)?github\.com:/i.test(s);
  return { owner: m[1], repo: m[2], form: ssh443 ? 'ssh443' : (https ? 'https' : (scp ? 'scp' : 'other')) };
}

/** 本机推荐形态（实测通道）：ssh.github.com:443。 */
export function ssh443Url(owner, repo) {
  return `ssh://git@ssh.github.com:443/${owner}/${repo}.git`;
}

/** https 形态（API/token 通道用）。 */
export function httpsUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}.git`;
}

/** 列出全部 remote：{ name: { fetch, push } }。 */
export function listRemotes(repoPath = '') {
  const r = runGit(['remote', '-v'], { cwd: repoPath });
  const out = r && r.ok ? String(r.stdout || '') : '';
  const map = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)\s*$/);
    if (!m) continue;
    map[m[1]] = map[m[1]] || {};
    map[m[1]][m[3]] = m[2];
  }
  return map;
}

/** 候选 remote 评分：归属对 + 形态可用 + 名字稳定（分数越大越优先）。 */
export function scoreRemote(cand = {}, { owner = '', repo = '', preferSsh443 = true } = {}) {
  let score = 0;
  const reasons = [];
  const hasTarget = !!(owner && repo);
  const sameOwner = owner && String(cand.owner).toLowerCase() === String(owner).toLowerCase();
  const sameRepo = repo && String(cand.repo).toLowerCase() === String(repo).toLowerCase();
  if (!hasTarget) {
    // 未提供目标 owner/repo（如"就着现有 remote 推"）⇒ 不判归属，只按形态与名字择优
    reasons.push('未提供目标归属 ⇒ 只按形态/名字择优');
  } else if (sameOwner && sameRepo) {
    score += 100; reasons.push('归属一致(+100)');
  } else {
    score -= 100; reasons.push(`归属不一致(${cand.owner}/${cand.repo})`);
  }
  if (preferSsh443) {
    if (cand.form === 'ssh443') { score += 30; reasons.push('形态 ssh:443(+30)'); }
    else if (cand.form === 'scp') { score -= 20; reasons.push('形态 scp:22（本机不通）(-20)'); }
    else { score += 5; reasons.push(`形态 ${cand.form}(+5)`); }
  }
  const nameScore = cand.name === 'origin' ? 10 : cand.name === 'github-ssh' ? 8 : 0;
  score += nameScore;
  if (nameScore) reasons.push(`名字 ${cand.name}(+${nameScore})`);
  return { score, reasons };
}

/**
 * 判定「正确的 GitHub remote」并（按需）修正。
 * @param {object} o { repoPath, owner, repo, preferSsh443=true, dryRun=false }
 * @returns {{ok:boolean, remote?:string, url?:string, action?:'keep'|'fixed'|'added', reasons:string[], candidates:Array}}
 */
export function resolveGithubRemote({ repoPath = '', owner = '', repo = '', preferSsh443 = true, dryRun = false } = {}) {
  const remotes = listRemotes(repoPath);
  const candidates = Object.entries(remotes)
    .map(([name, u]) => {
      const url = u.push || u.fetch || '';
      const p = parseGithubUrl(url);
      return p ? { name, url, ...p } : null;
    })
    .filter(Boolean);
  if (!candidates.length) {
    if (!(owner && repo)) {
      return { ok: false, action: 'none', reasons: ['没有 GitHub remote，且未提供 owner/repo ⇒ 无法判定'], candidates: [] };
    }
    const url = preferSsh443 ? ssh443Url(owner, repo) : httpsUrl(owner, repo);
    // 不覆盖「已有但归属不符」的 origin——那可能是别人的仓库/别的项目（不做静默改址）
    //   本分支里 candidates 为空 ⇒ 既有 origin 一定是非 GitHub 形态（如内网 gitlab）⇒ 一律视为「不是我们的」
    const originIsForeign = !!remotes['origin'];
    const name = (!remotes['origin'] || originIsForeign) ? 'github-ssh' : 'origin';
    const existed = !!remotes[name];
    if (!dryRun) {
      if (existed) runGit(['remote', 'set-url', name, url], { cwd: repoPath });
      else runGit(['remote', 'add', name, url], { cwd: repoPath });
    }
    return {
      ok: true, remote: name, url, action: existed ? 'fixed' : 'added',
      reasons: [`缺少指向 ${owner}/${repo} 的 remote ⇒ ${existed ? 'set-url' : 'add'} ${name} → ${url}${dryRun ? '（dryRun 未写盘）' : ''}${originIsForeign ? '；origin 归属不符，未改动它' : ''}`],
      candidates,
    };
  }
  const scored = candidates
    .map((c) => ({ ...c, ...scoreRemote(c, { owner, repo, preferSsh443 }) }))
    .sort((a, b) => (b.score - a.score) || (a.name === 'origin' ? -1 : 1));
  const best = scored[0];
  // 「有 remote，但没有一个属于目标仓库」必须与「完全没有 remote」同样处理：
  //   新建/修正专用 github-ssh，**绝不覆盖别人的 remote**（此前漏了这一支，会把 origin 指向别人的仓库 ✗）。
  const ours = (owner && repo) ? scored.filter((c) => c.score >= 100) : scored;
  if (!ours.length) {
    const url = preferSsh443 ? ssh443Url(owner, repo) : httpsUrl(owner, repo);
    const name = 'github-ssh'; // origin 已属于别人/别的项目 ⇒ 不动它
    const existed = !!remotes[name];
    if (!dryRun) {
      if (existed) runGit(['remote', 'set-url', name, url], { cwd: repoPath });
      else runGit(['remote', 'add', name, url], { cwd: repoPath });
    }
    return {
      ok: true, remote: name, url, action: existed ? 'fixed' : 'added',
      reasons: [`没有指向 ${owner}/${repo} 的 remote（现有 ${best.name} → ${best.url} 归属不符）⇒ ${existed ? 'set-url' : 'add'} ${name} → ${url}${dryRun ? '（dryRun 未写盘）' : ''}；未改动其它 remote`],
      candidates: scored,
    };
  }
  const hit = ours[0];
  const reasons = [`命中 ${hit.name} → ${hit.url}（评分 ${hit.score}：${hit.reasons.join(' ')}）`];
  const needUrl = preferSsh443 && hit.form !== 'ssh443' && owner && repo ? ssh443Url(hit.owner, hit.repo) : '';
  if (needUrl && needUrl !== hit.url) {
    if (!dryRun) runGit(['remote', 'set-url', hit.name, needUrl], { cwd: repoPath });
    reasons.push(`形态不推荐（${hit.form}）⇒ set-url ${hit.name} → ${needUrl}${dryRun ? '（dryRun 未写盘）' : ''}`);
    return { ok: true, remote: hit.name, url: needUrl, action: 'fixed', reasons, candidates: scored };
  }
  return { ok: true, remote: hit.name, url: hit.url, action: 'keep', reasons, candidates: scored };
}
