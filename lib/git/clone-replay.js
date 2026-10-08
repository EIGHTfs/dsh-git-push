/**
 * 克隆·真实历史重放：从「提交链」算出每一步要落盘/删除的文件（纯规划部分）。
 *
 * 【为什么要「按父提交算差异」而不是每条提交重下整棵树】
 *   整树重下意味着 N 条提交 × M 个文件，等于把仓库下载 N 遍（大仓直接不可用）；
 *   而相邻提交之间通常只改几个文件 ⇒ 按 sha 比对后只下「新增/内容变/权限变」的，
 *   其余复用工作区已有文件，删除的按名单删掉即可。
 *
 * 【为什么单独成模块、且与 git 执行分开】
 *   「算差异」是**可单测的纯逻辑**（新增/改动/删除、权限变化、目录变文件等），
 *   而「跑 git 命令」依赖仓库状态与环境 ⇒ 后者放在执行层，前者在此并单测覆盖。
 *
 * 【一个必须处理的真实限制】GitHub 的 `GET /git/trees/{sha}?recursive=1` 在
 *   条目过多（约 10 万条 / 7MB 响应）时会回 `truncated: true` 且**只给一部分条目**——
 *   此时绝不能当成完整树用（会漏文件、重放出的 tree 与远端不同 ⇒ sha 不同 ⇒ 推不回）。
 *   故本模块提供 blobEntriesOf 显式回报该情况，由调用方决定中止或改走非递归逐层拉取。
 */

// replayHistory 要用 clone-history 的「提交环境变量换算」（author/committer/date 回填），
//   两者分工：clone-history 负责「远端链 → 数据」，本模块负责「数据 → 本地提交」。
import { commitEnvOf } from './clone-history.js';

/**
 * 从 `git/trees/{sha}` 的返回体里取 blob 条目，并显式回报「树被截断」。
 *
 * @param {object} treeJson API 返回体（含 tree: [{path,mode,type,sha,size}], truncated）
 * @returns {{ok:boolean, entries:Array<object>, truncated:boolean, error?:string}}
 */
export function blobEntriesOf(treeJson) {
  const list = Array.isArray(treeJson?.tree) ? treeJson.tree : null;
  if (!list) return { ok: false, entries: [], truncated: false, error: '返回体缺少 tree 数组' };
  const truncated = treeJson?.truncated === true;
  const entries = list
    .filter((e) => e && e.type === 'blob' && e.path)
    .map((e) => ({ path: String(e.path), mode: String(e.mode || ''), sha: String(e.sha || ''), size: Number(e.size) || 0 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (truncated) {
    return { ok: false, entries, truncated: true, error: '远端树过大被截断（truncated）——不能当作完整树使用，需改走非递归逐层拉取' };
  }
  return { ok: true, entries, truncated: false };
}

/**
 * 两次树快照的差异 → 本轮重放要下载/保留/删除的文件。
 *
 * 判据：**sha 不同**（内容变）或 **mode 不同**（可执行位变）都要重下；
 *   路径只在旧树里出现 ⇒ 删除；两边都在且 sha/mode 相同 ⇒ 复用工作区文件（不下载）。
 *   注意：目录变文件 / 文件变目录在 git 里就是「旧路径删除 + 新路径新增」，本函数天然覆盖
 *   （路径比对，不假设类型），但**调用方必须保证删除先于下载会破坏目录的路径**——
 *   故返回体分开给出 remove 与 download，由执行层决定顺序（先删后下，见执行层注释）。
 *
 * @param {Array<object>} prevEntries 父提交的 blob 条目（首次提交传空数组）
 * @param {Array<object>} curEntries 当前提交的 blob 条目
 * @returns {{download:Array<object>,keep:Array<object>,remove:Array<string>}}
 */
export function planTreeDiff(prevEntries = [], curEntries = []) {
  const prev = new Map((Array.isArray(prevEntries) ? prevEntries : []).map((e) => [e.path, e]));
  const cur = new Map((Array.isArray(curEntries) ? curEntries : []).map((e) => [e.path, e]));
  const download = [];
  const keep = [];
  const remove = [];
  for (const [path, e] of cur) {
    const p = prev.get(path);
    if (!p || p.sha !== e.sha || p.mode !== e.mode) download.push(e);
    else keep.push(e);
  }
  for (const [path] of prev) if (!cur.has(path)) remove.push(path);
  const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  download.sort(byPath);
  keep.sort(byPath);
  remove.sort();
  return { download, keep, remove };
}

/**
 * 重放进度标记：记录「已重放到哪个远端 sha」，供中断后继续（不从头再来）。
 *
 * 为什么需要：大仓重放要跑成百上千次 API 与 git 命令，任何一次网络抖动都会中断；
 *   没有标记就只能整条链重来（实测同类问题：下载链路曾因「每轮清零分片」永远收敛不了）。
 *   标记文件放在仓库的 .git 目录内（不进工作区、不会被 git 跟踪）。
 *
 * @param {string} gitDir 仓库的 .git 目录绝对路径
 * @returns {{path:string}}
 */
export function replayMarkerPath(gitDir) {
  return { path: `${String(gitDir).replace(/[\\/]+$/, '')}/dsh-clone-history.json` };
}

/**
 * 判断标记是否可用于续跑：分支相同**且**已记录的 sha 确实是当前链上的提交。
 *
 * 为什么要校验 sha 在链上：远端被 force push / 分支重建后，旧标记指向的 sha
 *   可能已不在链上；直接沿用会重放出一条与远端不符的历史（sha 全错 ⇒ 推不回）。
 *
 * @param {object} marker 已读出的标记（可为 null）
 * @param {{branch?:string, shas?:Set<string>|Array<string>}} ctx 当前分支与链上 sha 集合
 * @returns {{resume:boolean, fromSha:string, reason?:string}}
 */
export function canResumeFrom(marker, { branch = '', shas = [] } = {}) {
  if (!marker || typeof marker !== 'object') return { resume: false, fromSha: '', reason: '无标记' };
  if (String(marker.branch || '') !== String(branch || '')) return { resume: false, fromSha: '', reason: '分支不一致' };
  const set = shas instanceof Set ? shas : new Set(shas || []);
  const fromSha = String(marker.replayedSha || '');
  if (!fromSha || !set.has(fromSha)) return { resume: false, fromSha: '', reason: '标记的 sha 不在当前链上（可能被 force push 或分支重建）' };
  return { resume: true, fromSha };
}

/**
 * 重放编排：按拓扑序逐条重建本地提交。**所有外部动作走 io 注入**，故本函数可离线单测。
 *
 * 【为什么用 write-tree + commit-tree，而不是 `git commit`】
 *   ① `commit-tree` **原生支持多个 -p**（合并提交直接给多个父即可），而 `git commit` 造合并
 *      要依赖 HEAD/索引状态机（`-p` 并非其参数），在多父、非线性的重放里极易出错；
 *   ② `commit-tree` 完全由「tree + parents + env + message」决定结果 ⇒ 与我们要的
 *      「sha 保真」语义一致（env 里的 author/committer/date 直接进对象）；
 *   ③ 不依赖工作区是否干净、不触发 hooks。
 *   故 io.commit 的实现应为：暂存变更 → `git write-tree` → `git commit-tree <tree> [-p …]`。
 *
 * @param {object} o
 * @param {Array<object>} o.commits 拓扑序提交链（来自 fetchCommitChain）
 * @param {string} o.branch 分支名
 * @param {object} o.io 执行动作注入：
 *        readMarker() → marker|null｜writeMarker({branch,replayedSha}) → {ok}
 *        fetchTreeEntries(treeSha) → {ok,entries,error}
 *        applyDownload(entries) → {ok,failed?,error?}
 *        applyRemove(paths) → {ok,error?}
 *        commit({env,message,parentShas}) → {ok,sha,error?}
 * @returns {Promise<{ok:boolean,replayed:number,headSha:string,resumedFrom:string,error?:string}>}
 */
export async function replayHistory({ commits = [], branch = '', io } = {}) {
  if (!io || typeof io.commit !== 'function') return { ok: false, replayed: 0, headSha: '', resumedFrom: '', error: '缺少 io 注入' };
  const list = Array.isArray(commits) ? commits : [];
  if (!list.length) return { ok: false, replayed: 0, headSha: '', resumedFrom: '', error: '提交链为空' };

  const shas = new Set(list.map((c) => c.sha));
  const marker = typeof io.readMarker === 'function' ? await io.readMarker() : null;
  const can = canResumeFrom(marker, { branch, shas });
  const fromIndex = can.resume ? list.findIndex((c) => c.sha === can.fromSha) : -1;

  const localShas = new Map();            // 远端 sha → 本地 sha（父映射用）
  let prevEntries = [];
  let start = 0;
  if (fromIndex >= 0) {
    // 续跑：基线用「已重放到的那个提交」的树（它的本地提交已存在），并跳过它本身
    const base = await io.fetchTreeEntries(list[fromIndex].tree);
    if (!base.ok) return { ok: false, replayed: 0, headSha: '', resumedFrom: can.fromSha, error: `续跑基线取树失败：${base.error}` };
    prevEntries = base.entries;
    start = fromIndex + 1;
  }

  let replayed = 0;
  let headSha = '';
  let resumedFrom = can.resume ? can.fromSha : '';
  for (let i = start; i < list.length; i++) {
    const c = list[i];
    const t = await io.fetchTreeEntries(c.tree);
    if (!t.ok) return { ok: false, replayed, headSha, resumedFrom, error: `取树失败（${c.sha.slice(0, 7)}）：${t.error}` };
    const diff = planTreeDiff(prevEntries, t.entries);
    if (diff.remove.length) {
      const rm = await io.applyRemove(diff.remove);
      if (!rm?.ok) return { ok: false, replayed, headSha, resumedFrom, error: `删除失败（${c.sha.slice(0, 7)}）：${rm?.error || '未知'}` };
    }
    if (diff.download.length) {
      const dl = await io.applyDownload(diff.download);
      if (!dl?.ok) {
        // 失败处**不写标记**：标记指向「最后一个完整重放的提交」，续跑从它的下一个开始
        return { ok: false, replayed, headSha, resumedFrom, error: `下载失败（${c.sha.slice(0, 7)}）：${dl?.error || '未知'}` };
      }
    }
    // 父映射：链上不存在的父（depth 截断处）不传——本地没有该对象，传了必然失败
    const parentShas = (c.parents || []).map((p) => localShas.get(p)).filter(Boolean);
    const r = await io.commit({ env: commitEnvOf(c), message: c.message, parentShas });
    if (!r?.ok) return { ok: false, replayed, headSha, resumedFrom, error: `建提交失败（${c.sha.slice(0, 7)}）：${r?.error || '未知'}` };
    localShas.set(c.sha, r.sha);
    headSha = r.sha;
    replayed += 1;
    prevEntries = t.entries;
    if (typeof io.writeMarker === 'function') await io.writeMarker({ branch, replayedSha: c.sha });
  }
  return { ok: true, replayed, headSha, resumedFrom };
}

// ─────────────────── git 命令参数构造（纯函数：把「要跑什么」固定下来） ───────────────────
// 为什么要这一层：接线层（把 io 接到真 git）最容易出错的地方，是**命令与参数顺序**写错
//   （少一个 -p、ref 名写错、配置键大小写错）。把这些固化成纯函数后：
//   ① 可以单测（断言精确参数数组）② 接线层只负责「把这些参数交给 runGit」③ 命令语义集中可查。
//   核心链条（重放一条提交）：addAll → writeTree → commitTree → updateRef。

/** `git init`：在目标目录建库（真实历史模式下用，快照模式也走同一条但现在已存在）。 */
export function initArgs() {
  return ['init'];
}

/** `git remote add <name> <url>`：真实历史模式写真实 git URL（供标准 fetch/push）。 */
export function setRemoteArgs(name, url) {
  return ['remote', 'add', String(name), String(url)];
}

/** `git config core.fileMode false`：不支持 mode 的卷（CIFS）上抑制「权限变更」噪音。 */
export function configFileModeArgs(enabled = false) {
  return ['config', 'core.fileMode', enabled ? 'true' : 'false'];
}

/** `git add -A`：把工作区当前状态全部暂存（删除也一并暂存）。 */
export function addAllArgs() {
  return ['add', '-A'];
}

/** `git write-tree`：把暂存区写成树对象，供 commit-tree 使用。 */
export function writeTreeArgs() {
  return ['write-tree'];
}

/**
 * `git commit-tree <tree> [-p <parent>…] -m <message>`：由树与父构造提交对象。
 *
 * 为什么不用 `git commit`：commit-tree **原生支持多个 -p**（合并提交直接给多父），
 *   且结果只由 tree + parents + env + message 决定 ⇒ 与「sha 保真」语义一致。
 *
 * @param {{tree:string, parents?:string[], message?:string}} o
 * @returns {string[]} 参数数组
 */
export function commitTreeArgs({ tree = '', parents = [], message = '' } = {}) {
  const args = ['commit-tree', String(tree)];
  for (const p of parents || []) args.push('-p', String(p));
  args.push('-m', String(message));
  return args;
}

/**
 * `git update-ref <ref> <sha> [<old>]`：把分支/远端跟踪引用指向重放出来的提交。
 * 给了 oldValue 时是「CAS 更新」（引用不是该值则失败），用于避免覆盖并发写入。
 */
export function updateRefArgs(ref, sha, { oldValue = '' } = {}) {
  const args = ['update-ref', String(ref), String(sha)];
  if (oldValue) args.push(String(oldValue));
  return args;
}

/** `git branch --set-upstream-to=<remote>/<branch> <branch>`：让 branch -vv 显示上游。 */
export function setUpstreamArgs(branch, remote = 'origin') {
  return ['branch', `--set-upstream-to=${String(remote)}/${String(branch)}`, String(branch)];
}

/** `git rev-parse <rev>`：取引用对应的 sha（接线层校验用）。 */
export function revParseArgs(rev) {
  return ['rev-parse', String(rev)];
}

/** 远端跟踪引用名：`refs/remotes/<remote>/<branch>`。 */
export function remoteTrackingRef(remote, branch) {
  return `refs/remotes/${String(remote)}/${String(branch)}`;
}

/** 本地分支引用名：`refs/heads/<branch>`。 */
export function localBranchRef(branch) {
  return `refs/heads/${String(branch)}`;
}

/** 构造续跑标记内容（写入 .git 内的标记文件，含写入时间便于排查）。 */
export function markerJson({ branch = '', replayedSha = '', at = '' } = {}) {
  return JSON.stringify({ branch: String(branch), replayedSha: String(replayedSha), at: at || new Date().toISOString() });
}
