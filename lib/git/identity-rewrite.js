/**
 * dsh-git-push — 提交身份历史改写（把仓库里非规范身份的作者/committer 统一成规范身份）
 *
 * 【为什么做进插件】历史上混着工具/AI 产生的身份（DSH Agent / eightfs@local / v2-clone@local）
 *   与账号身份的旧变体（无 id、小写的 noreply）——这些提交在 GitHub 上关联不到账号、贡献图断裂。
 *   把「识别 → 改写 → 自检 → 安全强推」做成插件能力（工具/CLI/HTTP 同一份实现），AI 就不必
 *   手写 filter-branch 脚本、也不必自己判断该用什么身份。
 *
 * 【安全设计（每一步都不可跳过）】
 *   ① 只改「作者或 committer 命中指定身份集合」的提交：其它人/其它身份的提交**自身字段与树内容**
 *      一个字节不动（但它的 sha 会随祖先提交被改写而变化 —— git 提交对象哈希包含父提交 sha，
 *      这是历史重写的必然语义，不是「改了别人的提交」）
 *   ② 已跟踪文件有改动 → 拒绝改写（不把未保存的工作卷进历史重写）
 *   ③ 每个分支先建备份引用 `refs/backup/identity-rewrite/<时间戳>/<分支>`，可原样回滚
 *   ④ 改写后逐分支自检：提交数不变 + 工作树内容不变 + 身份全规范；任一不过立即停，绝不推
 *   ⑤ 推送仅在「远端分支 sha == 改写前本地 sha」时用 `--force-with-lease`（远端动过则自动拒绝）
 *   ⑥ 默认 dryRun：只报「会改哪些分支、多少提交」，不写任何东西；真正改写必须显式 dryRun:false
 *   ⑦ 只处理 origin 属于登录账号的仓库（别人的仓库不碰）
 */

/** 工具/AI 产生的非账号身份（默认要统一的）：这些不可能是人有意的身份选择。 */
export const AI_GENERATED_EMAILS = ['agent@dsh.local', 'eightfs@local', 'v2-clone@local'];

/**
 * 需要统一的身份集合（小写去重）。
 * @param {{account?:object, extra?:string[]}} [opts]
 *   account: `{ login }` —— 会补上该账号的 noreply 旧变体（无 id 形式 / 小写形式）
 *   extra: 额外要统一的邮箱（如历史里出现过的真实邮箱）
 * @returns {string[]}
 */
export function wrongIdentityEmails({ account = null, extra = [] } = {}) {
  const list = [...AI_GENERATED_EMAILS];
  const login = String(account?.login || account?.username || '').trim();
  if (login) {
    list.push(`${login}@users.noreply.github.com`);
    list.push(`${login.toLowerCase()}@users.noreply.github.com`);
  }
  for (const e of extra || []) {
    const t = String(e || '').trim();
    if (t) list.push(t);
  }
  return [...new Set(list.map((s) => s.toLowerCase()))];
}

/** 拼 shell 片段用的安全包裹：值都是身份名/邮箱（无反斜杠/引号风险），用 JSON 双引号包裹即可。 */
function shq(s) {
  return JSON.stringify(String(s));
}

/**
 * 解析 GitHub 远端地址 → { owner, repo }（支持 ssh/https/api 三种写法）。
 * @param {string} url
 * @returns {{owner:string, repo:string}|null}
 */
export function parseGithubRepo(url) {
  const u = String(url || '').trim();
  // github.com:<端口>/<owner>/<repo>（ssh 走 443 时常见）、github.com/<owner>/<repo>、
  //   api.github.com/repos/<owner>/<repo> 三种写法都要认
  const m = u.match(/github\.com(?::\d+)?[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i)
    || u.match(/api\.github\.com\/repos\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** 该分支上命中待统一身份的提交清单（作者或 committer 命中；大小写不敏感）。 */
export function identityHits(repoPath, { runGit, wrongEmails, branch = '' } = {}) {
  const set = new Set((wrongEmails || []).map((s) => s.toLowerCase()));
  const args = ['log', ...(branch ? [branch] : []), '--format=%H%x1f%ae%x1f%ce'];
  const r = runGit(args, { cwd: repoPath });
  if (!r || !r.ok) return [];
  return String(r.stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ae, ce] = line.split('\x1f');
      const hitA = set.has(String(ae || '').toLowerCase());
      const hitC = set.has(String(ce || '').toLowerCase());
      return hitA || hitC ? { sha, author: ae, committer: ce, side: hitA && hitC ? 'both' : (hitA ? 'author' : 'committer') } : null;
    })
    .filter(Boolean);
}

/** 生成 filter-branch 的 --env-filter 片段（把命中身份换成规范身份）。 */
function buildEnvFilter(canonicalName, canonicalEmail, wrongEmails) {
  const list = wrongEmails.join('|');
  const lower = 'tr A-Z a-z';
  return [
    'ae="$(printf %s "$GIT_AUTHOR_EMAIL" | ' + lower + ')"',
    'ce="$(printf %s "$GIT_COMMITTER_EMAIL" | ' + lower + ')"',
    'case "$ae" in ' + list + ') GIT_AUTHOR_NAME=' + shq(canonicalName) + '; GIT_AUTHOR_EMAIL=' + shq(canonicalEmail) + ';; esac',
    'case "$ce" in ' + list + ') GIT_COMMITTER_NAME=' + shq(canonicalName) + '; GIT_COMMITTER_EMAIL=' + shq(canonicalEmail) + ';; esac',
  ].join('\n');
}

/**
 * 改写单个仓库的身份（多分支一起改；带备份与自检；可选安全强推）。
 *
 * @param {string} repoPath 仓库路径
 * @param {object} opts
 * @param {Function} opts.runGit 注入的 git 执行器 runGit(args,{cwd,env}) → {ok,stdout,stderr}
 * @param {{name:string,email:string}} opts.canonical 规范身份
 * @param {string[]} opts.wrongEmails 要统一的身份集合（小写）
 * @param {boolean} [opts.dryRun=true] true=只报告
 * @param {boolean} [opts.push=false] 自检通过后是否强推
 * @param {string} [opts.timestamp] 备份引用用的时间戳
 * @param {object} [opts.credEnv] 推送用的凭据环境（不传则用 runGit 默认环境）
 * @returns {object} 报告 { repo, skipped?, reason?, branches:[{branch,hits,before,after,pushed,remote}] }
 */
export function rewriteRepoIdentity(repoPath, opts = {}) {
  const {
    runGit, canonical, wrongEmails = [], dryRun = true, push = false,
    timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, ''), credEnv = {},
  } = opts;
  if (typeof runGit !== 'function') throw new TypeError('rewriteRepoIdentity 需要注入 runGit');
  const name = repoPath.split('/').filter(Boolean).pop() || repoPath;
  const report = { repo: repoPath, name, branches: [] };

  const pre = preflightRepo(repoPath, { runGit });
  if (pre.skipped) return { ...report, skipped: true, reason: pre.reason };
  report.origin = pre.origin;
  report.pushUrl = pre.pushUrl;

  for (const branch of pre.branches) {
    const hits = identityHits(repoPath, { runGit, wrongEmails, branch });
    if (!hits.length) { report.branches.push({ branch, hits: 0, skipped: true, reason: '无需改写' }); continue; }
    const before = countCommits(repoPath, branch, runGit);
    if (dryRun) {
      report.branches.push({ branch, hits: hits.length, before, dryRun: true, samples: hits.slice(0, 3) });
      continue;
    }
    const entry = rewriteBranch(repoPath, branch, { runGit, canonical, wrongEmails, timestamp, hits: hits.length, before });
    if (!entry.error && push) {
      entry.push = pre.pushUrl
        ? pushRewrittenBranch(repoPath, branch, { runGit, pushUrl: pre.pushUrl, oldSha: entry.oldSha, credEnv })
        : { pushed: false, reason: 'origin 不是 GitHub 地址，无法推送' };
    }
    report.branches.push(entry);
  }
  return report;
}

/** 分支提交数（runGit 失败按 0，避免 NaN）。 */
function countCommits(repoPath, branch, runGit) {
  return Number(String((runGit(['rev-list', '--count', branch], { cwd: repoPath }) || {}).stdout || '0').trim()) || 0;
}

/**
 * 仓库级预检：已跟踪改动拒改；取本地分支清单与 origin 推送地址。
 * @returns {{skipped?:boolean, reason?:string, branches?:string[], origin?:string, pushUrl?:string}}
 */
function preflightRepo(repoPath, { runGit }) {
  const dirty = runGit(['status', '--porcelain', '--untracked-files=no'], { cwd: repoPath });
  if (dirty && dirty.ok && String(dirty.stdout || '').trim()) {
    return { skipped: true, reason: '有已跟踪文件改动（先提交或还原再改写，避免把未保存的工作卷进重写）' };
  }
  const branches = String((runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: repoPath }) || {}).stdout || '')
    .split('\n').filter(Boolean);
  if (!branches.length) return { skipped: true, reason: '没有本地分支' };
  const origin = String((runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }) || {}).stdout || '').trim();
  const parsed = parseGithubRepo(origin);
  return {
    branches,
    origin,
    pushUrl: parsed ? `ssh://git@ssh.github.com:443/${parsed.owner}/${parsed.repo}.git` : '',
  };
}

/**
 * 改写单个分支：备份引用 → filter-branch → 自检（提交数/工作树/身份）。
 * 任一步失败都只在返回值里报错并停止，绝不继续推送。
 * @returns {object} 分支报告（带 error 表示未改写或自检未过）
 */
function rewriteBranch(repoPath, branch, { runGit, canonical, wrongEmails, timestamp, hits, before }) {
  const backupRef = `refs/backup/identity-rewrite/${timestamp}/${branch}`;
  const oldSha = String((runGit(['rev-parse', branch], { cwd: repoPath }) || {}).stdout || '').trim();
  if (!(runGit(['update-ref', backupRef, branch], { cwd: repoPath }) || {}).ok) {
    return { branch, hits, error: '备份引用写入失败（已停，不冒险改写）' };
  }
  const fb = runGit([
    'filter-branch', '-f', '--env-filter', buildEnvFilter(canonical.name, canonical.email, wrongEmails),
    '--tag-name-filter', 'cat', '--', branch,
  ], { cwd: repoPath, timeoutMs: 1_800_000 });
  if (!fb || !fb.ok) {
    return { branch, hits, backupRef, error: `filter-branch 失败：${String((fb && fb.stderr) || '').slice(-200)}` };
  }
  const after = countCommits(repoPath, branch, runGit);
  const stillWrong = identityHits(repoPath, { runGit, wrongEmails, branch }).length;
  const treeDiff = String((runGit(['diff', '--stat', backupRef, branch], { cwd: repoPath }) || {}).stdout || '').trim();
  const entry = { branch, hits, before, after, backupRef, oldSha, stillWrong, treeChanged: !!treeDiff };
  if (before !== after || stillWrong > 0 || treeDiff) {
    entry.error = `自检未过（提交数 ${before}→${after}／残留身份 ${stillWrong}／树差异 ${treeDiff ? '有' : '无'}）——已停，不推送`;
  }
  return entry;
}

/**
 * 安全强推单个分支：仅当远端 sha == 改写前本地 sha 时 `--force-with-lease`（远端被别人动过则自动拒绝），
 * 推完再核验远端 sha 与本地一致。
 * @returns {{pushed:boolean, verified?:boolean, remoteSha?:string, reason:string}}
 */
function pushRewrittenBranch(repoPath, branch, { runGit, pushUrl, oldSha, credEnv }) {
  const lsRemote = () => String((runGit(['ls-remote', pushUrl, `refs/heads/${branch}`], { cwd: repoPath, env: credEnv, timeoutMs: 60_000 }) || {}).stdout || '').split(/\s+/)[0];
  const remoteSha = lsRemote();
  if (!remoteSha) return { pushed: false, reason: '远端无此分支（不新建，避免误伤）' };
  if (remoteSha !== oldSha) {
    return { pushed: false, reason: `远端 sha(${remoteSha.slice(0, 8)}) ≠ 改写前本地(${oldSha.slice(0, 8)})，跳过推送` };
  }
  const p = runGit(['push', `--force-with-lease=refs/heads/${branch}:${oldSha}`, pushUrl, branch], { cwd: repoPath, env: credEnv, timeoutMs: 300_000 });
  if (!p || !p.ok) return { pushed: false, reason: String((p && p.stderr) || '').slice(-200) };
  const post = lsRemote();
  const newSha = String((runGit(['rev-parse', branch], { cwd: repoPath }) || {}).stdout || '').trim();
  return {
    pushed: true,
    verified: post === newSha,
    remoteSha: post,
    reason: post === newSha ? '' : '推送后远端 sha 与本地不一致',
  };
}

/**
 * 批量改写（多个仓库）。逐仓调用 rewriteRepoIdentity，聚合成总结。
 * @param {string[]} repoPaths 仓库路径
 * @param {object} opts 同 rewriteRepoIdentity（去掉 repoPath）
 * @returns {{dryRun:boolean, canonical:object, wrongEmails:string[], repos:object[], totals:object}}
 */
export function rewriteIdentities(repoPaths = [], opts = {}) {
  const repos = repoPaths.map((p) => rewriteRepoIdentity(p, opts));
  const totals = {
    repos: repos.length,
    branches: repos.reduce((n, r) => n + (r.branches || []).length, 0),
    hits: repos.reduce((n, r) => n + (r.branches || []).reduce((m, b) => m + (b.hits || 0), 0), 0),
    rewritten: repos.reduce((n, r) => n + (r.branches || []).filter((b) => b.after != null).length, 0),
    pushed: repos.reduce((n, r) => n + (r.branches || []).filter((b) => b.push && b.push.pushed && b.push.verified !== false).length, 0),
    skipped: repos.filter((r) => r.skipped).length,
  };
  return { dryRun: opts.dryRun !== false, canonical: opts.canonical, wrongEmails: opts.wrongEmails || [], repos, totals };
}

/**
 * 仓库历史里**遗留的**非规范身份统计（只报告，不改任何东西）。
 *
 * 用途：提交时顺带提醒「以前」留下的身份问题 —— 自动提交只要带正确身份即可，
 *   历史要不要统一由用户决定，所以这里只给出「还有多少条、都是谁」，不做任何改写。
 * @param {string} repoPath 仓库路径
 * @param {{runGit:Function, wrongEmails?:string[], branch?:string}} opts
 * @returns {{count:number, emails:string[]}}
 */
export function legacyIdentityReport(repoPath, { runGit, wrongEmails = [], branch = '' } = {}) {
  const hits = identityHits(repoPath, { runGit, wrongEmails, branch });
  const set = new Set((wrongEmails || []).map((s) => s.toLowerCase()));
  const emails = [...new Set(
    hits.flatMap((h) => [h.author, h.committer])
      .map((e) => String(e || '').toLowerCase())
      .filter((e) => set.has(e)),
  )];
  return { count: hits.length, emails };
}

/**
 * 「以前还有 N 条非规范身份」的提醒文本（提交返回里带上，让 AI 顺带说明）。
 * @param {{count:number, emails?:string[]}} report legacyIdentityReport 的结果
 * @param {{name:string,email:string}|null} [canonical] 本次使用的规范身份
 * @returns {string} count 为 0 时返回空串（无提醒）
 */
export function buildLegacyIdentityHint(report = {}, canonical = null) {
  const count = Number(report.count || 0);
  if (!count) return '';
  const who = canonical && canonical.email ? `${canonical.name} <${canonical.email}>` : '登录账号规范身份';
  const list = (report.emails || []).join('、');
  return `⚠️ 该仓库历史上还有 ${count} 条非规范身份提交${list ? `（${list}）` : ''}——`
    + `本次提交身份已是 ${who}；历史要不要一并统一由你决定（可调 git_identity_rewrite 先 dry-run 看会改哪些）。`;
}

/**
 * 把改写总结格式化成 AI/用户可读文本（工具返回用）。
 * @param {object} summary rewriteIdentities 的返回
 * @returns {string}
 */
export function formatIdentityRewriteReport(summary = {}) {
  const { repos = [], totals = {}, canonical = {}, dryRun } = summary;
  const L = [
    `提交身份改写${dryRun ? '（预演 dryRun，未写入）' : ''}：规范身份 ${canonical.name} <${canonical.email}>；`
      + `仓库 ${totals.repos}｜分支 ${totals.branches}｜待改/已改提交 ${totals.hits}｜已推分支 ${totals.pushed}｜跳过仓库 ${totals.skipped}`,
  ];
  for (const r of repos) {
    if (r.skipped) { L.push(`· ${r.name}：跳过（${r.reason}）`); continue; }
    const parts = (r.branches || []).map((b) => {
      if (b.hits === 0) return `${b.branch}=无需改`;
      if (b.error) return `${b.branch}=❌${b.error}`;
      if (b.dryRun) return `${b.branch}=待改 ${b.hits} 条`;
      const pushed = b.push ? (b.push.pushed ? (b.push.verified === false ? '（推送后校验不符！）' : '（已推）') : `（未推：${b.push.reason}）`) : '';
      return `${b.branch}=已改 ${b.hits} 条${pushed}`;
    });
    L.push(`· ${r.name}：${parts.join('，')}`);
  }
  if (dryRun) L.push('要真正改写并推送：带 dryRun:false（会先建备份引用 refs/backup/identity-rewrite/<日期>/<分支>，自检通过才 force-with-lease 推送）');
  return L.join('\n');
}
