/**
 * CI（GitHub Actions）结果等待 —— 推送后确认真跑绿了，而不是"推上去就算完成"。
 *
 * 为什么需要：推送成功只代表代码到了远端，构建/测试是否通过是另一回事。
 *   实测事故：一次提交推送成功，CI 在同一 SHA 上挂了（我加的一个测试假设了 CIFS 特性，
 *   在 ext4 runner 上必然失败）——只看推送结果完全发现不了。
 *
 * 设计取舍：
 *   · **只读**（GET /actions/runs），不触发、不重跑；
 *   · 按 **head_sha** 查，而不是查"最新一次 run"——否则并发提交会拿到别人的结果；
 *   · 多 workflow 同时存在时**全绿才算通过**（任一失败即 failure）；
 *   · 刚推上去时 run 可能还没创建，给一段 grace（默认 60s）再判定「没有 CI」；
 *   · 超时不算失败、也不算通过，单独给 `timeout`，让调用方自己决定怎么处理。
 */
import { runGit } from './exec.js';
import { githubFetch } from './api.js';
import { parseOwnerRepoFromRemote } from './remote.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 15 * 1000;
const DEFAULT_GRACE_MS = 60 * 1000;

/** 视为「通过」的结论集合（neutral/skipped 不算红）。 */
const OK_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

/** 从本地仓库解析 owner/repo（origin 优先，其次任意 GitHub remote）。 */
export function resolveRepoIdentity(repoPath) {
  const origin = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath });
  const fromOrigin = parseOwnerRepoFromRemote(origin.stdout || origin.stderr || '');
  if (fromOrigin.owner && fromOrigin.repo) return fromOrigin;
  const all = runGit(['remote', '-v'], { cwd: repoPath });
  for (const line of String(all.stdout || '').split('\n')) {
    const url = line.split(/\s+/)[1] || '';
    const parsed = parseOwnerRepoFromRemote(url);
    if (parsed.owner && parsed.repo) return parsed;
  }
  return { owner: '', repo: '' };
}

/**
 * 查某次提交触发的所有 workflow run。
 * @returns {Promise<{ok:boolean, runs:Array<object>, error?:string}>}
 */
export async function fetchRunsForSha({ owner, repo, sha, token = '', fetchImpl = githubFetch, perPage = 50 } = {}) {
  if (!owner || !repo) return { ok: false, runs: [], error: '缺 owner/repo' };
  if (!sha) return { ok: false, runs: [], error: '缺 sha' };
  const res = await fetchImpl(`/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=${perPage}`, { token });
  if (res.status !== 200) return { ok: false, runs: [], error: res.json?.message || res.error || `HTTP ${res.status}` };
  const runs = (res.json?.workflow_runs || []).map((r) => ({
    id: r.id,
    name: r.name || r.display_title || `run ${r.id}`,
    status: r.status || '',
    conclusion: r.conclusion || '',
    // html_url 是 GitHub 的原字段；测试注入的桩可能直接用 url —— 两者都认，避免因字段名不同丢链接
    url: r.html_url || r.url || '',
    event: r.event || '',
    headSha: r.head_sha || '',
  }));
  return { ok: true, runs };
}

/**
 * 汇总一组 run 的结论（纯函数，便于单测）。
 * @returns {{total:number, pending:number, failing:number, ok:number,
 *            conclusion:'none'|'pending'|'success'|'failure', failingRuns:Array<object>}}
 */
export function summarizeRuns(runs = []) {
  let pending = 0;
  let failing = 0;
  let ok = 0;
  const failingRuns = [];
  for (const r of runs) {
    if (r.status && r.status !== 'completed') { pending += 1; continue; }
    if (OK_CONCLUSIONS.has(String(r.conclusion || '').toLowerCase())) { ok += 1; continue; }
    failing += 1;
    failingRuns.push(r);
  }
  const conclusion = !runs.length ? 'none' : pending ? 'pending' : failing ? 'failure' : 'success';
  return { total: runs.length, pending, failing, ok, conclusion, failingRuns };
}

/**
 * 等某次提交的 CI 出结果。
 *
 * @param {{repoPath?:string, owner?:string, repo?:string, sha:string, token?:string,
 *          timeoutMs?:number, pollMs?:number, graceMs?:number,
 *          fetchImpl?:Function, sleep?:Function, now?:Function}} o
 * @returns {Promise<{ok:boolean, conclusion:'success'|'failure'|'pending'|'timeout'|'none',
 *          runs:Array<object>, summary:object, failing?:Array<object>, url?:string,
 *          timedOut?:boolean, note?:string, error?:string}>}
 */
export async function waitForCi({
  repoPath = '', owner = '', repo = '', sha = '', token = '',
  timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS, graceMs = DEFAULT_GRACE_MS,
  fetchImpl = githubFetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now(),
} = {}) {
  let own = { owner, repo };
  if ((!own.owner || !own.repo) && repoPath) own = resolveRepoIdentity(repoPath);
  if (!own.owner || !own.repo) return { ok: false, conclusion: 'none', runs: [], summary: summarizeRuns([]), error: '无法解析 owner/repo（origin 不是 GitHub 地址）' };
  const started = now();
  let lastSummary = summarizeRuns([]);
  for (;;) {
    const res = await fetchRunsForSha({ owner: own.owner, repo: own.repo, sha, token, fetchImpl });
    if (!res.ok) return { ok: false, conclusion: 'none', runs: [], summary: lastSummary, error: res.error };
    const summary = summarizeRuns(res.runs);
    lastSummary = summary;
    const elapsed = now() - started;
    if (summary.conclusion === 'none') {
      // run 还没创建：给一段 grace，超过就认为该提交没有 CI
      if (elapsed >= graceMs) {
        return { ok: true, conclusion: 'none', runs: res.runs, summary, note: `该提交未触发 CI（已等 ${Math.round(elapsed / 1000)}s）` };
      }
      await sleep(Math.min(pollMs, Math.max(0, graceMs - elapsed)));
      continue;
    }
    if (summary.conclusion !== 'pending') {
      return {
        ok: summary.conclusion === 'success',
        conclusion: summary.conclusion,
        runs: res.runs,
        summary,
        ...(summary.failing ? { failing: summary.failingRuns.map((r) => ({ name: r.name, url: r.url, conclusion: r.conclusion })) } : {}),
        url: summary.failingRuns[0]?.url || res.runs[0]?.url || '',
      };
    }
    if (elapsed >= timeoutMs) {
      return {
        ok: false, conclusion: 'timeout', timedOut: true, runs: res.runs, summary,
        note: `CI 在 ${Math.round(timeoutMs / 1000)}s 内未出结果（仍在跑）`,
        url: res.runs[0]?.url || '',
      };
    }
    await sleep(Math.min(pollMs, Math.max(0, timeoutMs - elapsed)));
  }
}
