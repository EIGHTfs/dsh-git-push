/**
 * 克隆·真实历史模式：把「拉链 → 准备仓库 → 重放 → 收尾」串成一条流水线。
 *
 * 【为什么单独成一层】clone.js 是既有的大文件（整树快照快路径），
 *   把 history 模式的编排放在这里，clone.js 只需在参数为 history 时调用本函数一次，
 *   改动面最小；且本层可用假 deps 完全离线测（见 test/test-clone-history-mode.mjs）。
 *
 * 【与快路径的关系】默认仍是 clone.js 的「整树快照 + 一条合成提交」（与远端无祖先）；
 *   本函数只在显式要求真实历史时使用，二者互不影响。
 *
 * 【依赖注入】githubFetch / runGit / downloadBlobs 都可被 deps 覆盖（测试用）。
 */

import { githubFetch } from './api.js';
import { fetchCommitChain } from './clone-history.js';
import { replayHistory } from './clone-replay.js';
import { createReplayIo } from './clone-replay-io.js';

/**
 * 取某分支的 HEAD sha。
 *
 * @param {object} o { owner, repo, branch, token, deps }
 * @returns {Promise<{ok:boolean, sha:string, error?:string}>}
 */
export async function resolveBranchHead({ owner = '', repo = '', branch = '', token = '', deps = {} } = {}) {
  const api = deps.githubFetch || githubFetch;
  const r = await api(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, { token });
  const sha = String(r?.json?.object?.sha || '');
  // 注意：githubFetch 返回的是 { status, json, text, buffer, rateLimit }——**没有 ok 字段**
  //   （clone.js 里同样用 status === 200 判定）。此前这里写 !r.ok ⇒ 即使 HTTP 200 也一律判失败，
  //   该缺陷是「真仓库端到端实测」暴露的（离线假 API 返回了理想化的 ok 字段，故测不出来）。
  const good = r?.status === 200 || r?.ok === true;
  if (!good || !sha) return { ok: false, sha: '', error: `取分支 HEAD 失败（HTTP ${r?.status ?? '?'}）` };
  return { ok: true, sha };
}

/**
 * 重建真实历史：拉链 → 准备 → 逐条重放 → 收尾。
 *
 * @param {object} o
 * @param {string} o.owner/o.repo/o.branch GitHub 坐标
 * @param {string} o.repoPath 目标工作区路径｜o.gitDir 其 .git 路径
 * @param {number} [o.depth] 拉链深度上限（默认见 DEFAULT_HISTORY_DEPTH）
 * @param {string} [o.token] 私有仓所需
 * @param {Function} [o.onProgress] 下载进度回调
 * @param {object} [o.signal] 中止信号
 * @param {object} [o.deps] 覆盖 { githubFetch, runGit, downloadBlobs }（测试用）
 * @returns {Promise<{ok:boolean,count:number,truncated:boolean,replayed:number,headSha:string,resumedFrom:string,error?:string}>}
 */
export async function cloneWithHistory({
  owner = '', repo = '', branch = '', repoPath = '', gitDir = '', depth, token = '',
  onProgress = null, signal = null, deps = {},
} = {}) {
  const api = deps.githubFetch || githubFetch;
  const apiGet = (path) => api(path, { token });
  const fail = (error, extra = {}) => ({ ok: false, count: 0, truncated: false, replayed: 0, headSha: '', resumedFrom: '', error, ...extra });

  const head = await resolveBranchHead({ owner, repo, branch, token, deps });
  if (!head.ok) return fail(head.error);

  const chain = await fetchCommitChain({ owner, repo, head: head.sha, depth, apiGet });
  if (!chain.ok) return fail(chain.error);
  if (!chain.commits.length) return fail('提交链为空');

  const io = createReplayIo({ repoPath, gitDir, owner, repo, branch, token, onProgress, signal, deps });
  const prep = await io.prepare();
  if (!prep?.ok) return fail(`仓库准备失败：${prep?.error || '未知'}`);

  const replayed = await replayHistory({ commits: chain.commits, branch, io });
  if (!replayed.ok) {
    return fail(replayed.error, { count: chain.commits.length, truncated: chain.truncated, replayed: replayed.replayed, headSha: replayed.headSha });
  }

  const done = await io.finish({ headSha: replayed.headSha });
  if (!done?.ok) return fail(done?.error || '收尾失败', { count: chain.commits.length, truncated: chain.truncated, replayed: replayed.replayed, headSha: replayed.headSha });

  return {
    ok: true,
    count: chain.commits.length,
    truncated: chain.truncated,
    replayed: replayed.replayed,
    headSha: replayed.headSha,
    resumedFrom: replayed.resumedFrom,
  };
}
