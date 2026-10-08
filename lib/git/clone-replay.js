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
