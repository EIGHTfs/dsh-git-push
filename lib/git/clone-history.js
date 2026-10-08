/**
 * 克隆·真实历史：提交链拉取与「按提交重放」所需的纯逻辑。
 *
 * 【为什么需要本模块】原克隆（clone.js 的 cloneViaApi）走 Git Data API 的 trees+blobs，
 *   把**整树快照**写盘后再 `git init` + 一条合成提交。后果实测：
 *   本地与远端**无共同祖先** ⇒ 推不回（非快进）、`git log` 只有 1 条（读不到演进）、分支/标签全丢。
 *   本模块负责把真实提交链取回来，并给出重放所需的**数据与顺序**；落盘与提交由 clone.js 执行。
 *
 * 【为什么写成纯函数模块（apiGet 注入）】拉链与定序是**可单测的逻辑**——
 *   分页、拓扑序、合并提交、depth 截断——与网络、磁盘无关。
 *   把 apiGet 作为参数注入 ⇒ 单测可完全离线（见 test/test-clone-history.mjs），
 *   这也让本模块能被外部复用（不依赖本插件的网络层）。
 *
 * 【只做三件事】
 *   ① fetchCommitChain：按 parents 拉链（逐条 /git/commits/{sha}），并**拓扑排序**（父先于子）
 *   ② gitDateOf / authorEnvOf / committerEnvOf：生成 git 提交所需的环境变量与日期格式
 *   ③ planReplay：把链整理成「有父先于子」的重放顺序（并标出合并提交的父编号）
 */

/** 默认拉链深度：既够读演进，又不至于让大仓打爆 API 配额。 */
export const DEFAULT_HISTORY_DEPTH = 50;

/**
 * 把 GitHub 返回的 ISO8601 时间转成 git 可接受的原始日期格式。
 *
 * 为什么不能直接塞 ISO：git 认 `@<epoch> <±HHMM>` 或 `<epoch> <±HHMM>`，
 *   不认 `2026-09-13T12:00:00Z`；而**时区偏移必须保留**——
 *   commit sha 含作者/提交者的日期字符串，丢掉偏移就再也对不上远端 sha（见 transport.js 的通道说明）。
 *
 * @param {string} iso GitHub API 的 `author.date` / `committer.date`
 * @returns {string} 形如 `1694567890 +0800`；无法解析时回退 `0 +0000`
 */
export function gitDateOf(iso) {
  const s = String(iso || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? `${Math.floor(t / 1000)} +0000` : '0 +0000';
  }
  const [, day, clock, tzRaw] = m;
  const epoch = Math.floor(Date.parse(`${day}T${clock}Z`) / 1000);
  let tz = '+0000';
  if (tzRaw && tzRaw !== 'Z') tz = tzRaw.includes(':') ? tzRaw.replace(':', '') : tzRaw;
  return `${epoch} ${tz}`;
}

/**
 * 生成一次 git 提交所需的环境变量（作者/提交者姓名、邮箱、日期）。
 *
 * 为什么逐字段回填：sha 由「tree + parents + author + committer + message」共同决定，
 *   任一字段不同则 sha 不同 ⇒ 远端祖先关系又会断（这正是 API 推送通道的老问题）。
 *
 * @param {object} c 提交对象（含 author/committer/message）
 * @returns {object} 可直接展开进 runGit 的 env
 */
export function commitEnvOf(c) {
  const a = c?.author || {};
  const m = c?.committer || a;
  return {
    GIT_AUTHOR_NAME: String(a.name || 'unknown'),
    GIT_AUTHOR_EMAIL: String(a.email || 'unknown@example.com'),
    GIT_AUTHOR_DATE: gitDateOf(a.date),
    GIT_COMMITTER_NAME: String(m.name || a.name || 'unknown'),
    GIT_COMMITTER_EMAIL: String(m.email || a.email || 'unknown@example.com'),
    GIT_COMMITTER_DATE: gitDateOf(m.date || a.date),
  };
}

/**
 * 拓扑排序：保证**父提交先于子提交**。
 *
 * 为什么不能只按时间排：GitHub 返回的时间可被改写/时钟漂移，且合并提交的两个父
 *   时间先后不定；一旦子先于父重放，`git commit -p <父>` 会因父对象不存在而失败。
 *   故用「入度=未就绪父数」的 Kahn 排序，与时间无关。
 *
 * @param {Array<object>} commits 提交对象数组（含 sha/parents）
 * @returns {Array<object>} 新数组，父在前；存在环或缺失父时，剩余部分按原顺序追加（不丢数据）
 */
export function topoSort(commits) {
  const list = Array.isArray(commits) ? commits.slice() : [];
  const bySha = new Map(list.map((c) => [c.sha, c]));
  const missing = new Set();           // 链外的父（depth 截断处）：视为已满足
  const pending = new Map();           // sha → 尚未就绪的父个数
  for (const c of list) {
    const ps = (c.parents || []).filter((p) => bySha.has(p));
    pending.set(c.sha, ps.length);
    for (const p of c.parents || []) if (!bySha.has(p)) missing.add(p);
  }
  const out = [];
  const done = new Set();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const c of list) {
      if (done.has(c.sha)) continue;
      if ((pending.get(c.sha) || 0) === 0) {
        done.add(c.sha);
        out.push(c);
        progressed = true;
        for (const other of list) {
          if (done.has(other.sha)) continue;
          if ((other.parents || []).includes(c.sha)) pending.set(other.sha, Math.max(0, (pending.get(other.sha) || 0) - 1));
        }
      }
    }
  }
  for (const c of list) if (!done.has(c.sha)) out.push(c);   // 有环/异常时兜底，绝不丢提交
  return out;
}

/**
 * 按 parents 拉取提交链（逐条 `/git/commits/{sha}`，与现有 API 层 `{ok,status,json}` 约定一致）。
 *
 * @param {object} o
 * @param {string} o.owner 仓库 owner
 * @param {string} o.repo 仓库名
 * @param {string} o.head 起始提交 sha（分支 HEAD）
 * @param {number} [o.depth] 最多拉多少条（默认 DEFAULT_HISTORY_DEPTH）
 * @param {Function} o.apiGet `(apiPath) => Promise<{ok:boolean,status:number,json:any}>`
 * @returns {Promise<{ok:boolean,commits:Array<object>,truncated:boolean,error?:string}>}
 *          commits 已按拓扑序（父先于子）排列
 */
export async function fetchCommitChain({ owner, repo, head, depth = DEFAULT_HISTORY_DEPTH, apiGet } = {}) {
  if (typeof apiGet !== 'function') return { ok: false, commits: [], truncated: false, error: '缺少 apiGet 注入' };
  if (!owner || !repo || !head) return { ok: false, commits: [], truncated: false, error: '缺少 owner/repo/head' };
  const max = Math.max(1, Number(depth) || DEFAULT_HISTORY_DEPTH);
  const seen = new Map();
  const queue = [head];
  let truncated = false;
  while (queue.length) {
    if (seen.size >= max) { truncated = true; break; }
    const sha = queue.shift();
    if (seen.has(sha)) continue;
    const r = await apiGet(`/repos/${owner}/${repo}/git/commits/${sha}`);
    if (!r?.ok || !r.json?.sha) return { ok: false, commits: [], truncated, error: `取提交 ${String(sha).slice(0, 7)} 失败（HTTP ${r?.status ?? '?'}）` };
    const c = r.json;
    seen.set(sha, {
      sha: c.sha,
      parents: Array.isArray(c.parents) ? c.parents.slice() : [],
      tree: c.tree?.sha || '',
      message: String(c.message || ''),
      author: c.author || {},
      committer: c.committer || {},
    });
    for (const p of c.parents || []) if (!seen.has(p)) queue.push(p);
  }
  return { ok: true, commits: topoSort([...seen.values()]), truncated };
}

/**
 * 把（已拓扑排序的）链整理成重放计划：逐条给出「提交 + 父在本地序列中的位置」。
 *
 * 为什么单独一步：重放时要区分「普通提交（1 个父）」与「合并提交（≥2 个父）」，
 *   后者必须显式传多个 `-p`，否则历史线会断（线断了 sha 就不同，祖先关系又裂）。
 *
 * @param {Array<object>} commits 拓扑序提交数组
 * @returns {Array<{commit:object,parentIndexes:number[],isMerge:boolean}>}
 */
export function planReplay(commits) {
  const list = Array.isArray(commits) ? commits : [];
  const index = new Map(list.map((c, i) => [c.sha, i]));
  return list.map((c) => {
    const parentIndexes = (c.parents || []).map((p) => index.get(p)).filter((i) => Number.isInteger(i));
    return { commit: c, parentIndexes, isMerge: (c.parents || []).length > 1 };
  });
}
