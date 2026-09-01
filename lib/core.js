/**
 * dsh-git-push — git 核心逻辑（纯函数，可独立单测，不依赖 ctx）
 *
 * 依赖系统 git：认证默认 HTTPS+PAT（2026-08-21 用户确立 token 方案）；
 * remote 格式 https://<user>:<token>@github.com/<owner>/<repo>.git（token 只存
 * 凭据总表/remote 内部，绝不入 md/skill/代码）。SSH remote 仍兼容（备选）。
 * 关键坑（来自 git-commits-viewer 实测）：
 *   1. 每次命令带 `-c safe.directory=<cwd>`（/vol02 CIFS 只读卷 doubtful ownership）
 *   2. stdio 用 pipe/ignore，防止 git 报错刷屏
 *   3. 本地分支可能是 master 而非 main —— push 前取 branch --show-current，不硬编码
 *   4. push 前 fetch + rev-list 检查 ahead/behind，远端领先时不推
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 执行 git，返回 { status, stdout, stderr } */
export function runGit(args, cwd, env = {}) {
  const r = spawnSync('git', ['-c', `safe.directory=${cwd}`, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

/** SSH origin → HTTPS 等价 URL（https://github.com/<owner>/<repo>.git），仅用于 token 通道 */
export function httpsUrlOf(originUrl) {
  return (originUrl || '')
    .replace(/^ssh:\/\/git@ssh\.github\.com:443\//, 'https://github.com/')
    .replace(/^git@github\.com:/, 'https://github.com/');
}

/** 从 origin URL 解析 owner/repo（github.com 系列：支持 ssh://git@ssh.github.com:443/、git@github.com:、https://github.com/），失败返回 null */
export function parseGithubOwnerRepo(originUrl) {
  const u = httpsUrlOf(originUrl); // 先归一化为 https://github.com/<owner>/<repo>
  const m = (u || '').match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** 读 git 对象原始字节（binary-safe，返回 Buffer）。maxBuffer 放宽到 128MB——spawnSync 默认 1MB，
 * 超过会 status:null 截断（实测 1.1MB 的 session .zstd 日志即触发）。 */
function gitRaw(args, cwd) {
  const r = spawnSync('git', ['-c', `safe.directory=${cwd}`, ...args], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
    timeout: 600_000,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  return { status: r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0) };
}

/**
 * v1.12.0 默认推送通道：走 api.github.com 的 Git Data API（blob → tree → commit → ref），
 * 完全不依赖 github.com 直连（本机 github.com 被网络阻断、api.github.com 可达时可用）。
 * 流程：取本地 HEAD tree → 逐 blob 上传（复用远端已有 sha 的跳过）→ 建 tree → 建 commit（parent=远端 HEAD）→ 更新 ref。
 * 返回 { ok, pushed, reason, commitSha, owner, repo }
 */
export async function pushViaApi({ repoPath, branch, token }) {
  const GH = 'https://api.github.com';
  const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
  const pr = parseGithubOwnerRepo(originUrl);
  if (!pr) return { ok: false, pushed: false, reason: `无法从 origin 解析 owner/repo（${originUrl || '无 origin'}）` };
  const { owner, repo } = pr;
  const H = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'dsh-git-push',
  };
  async function api(path, method = 'GET', body) {
    const res = await fetch(GH + '/repos/' + owner + '/' + repo + path, {
      method,
      headers: H,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
    return { status: res.status, json };
  }

  // 本地 HEAD
  const headSha = runGit(['rev-parse', 'HEAD'], repoPath).stdout;
  if (!headSha) return { ok: false, pushed: false, reason: '本地无提交' };

  // 本地 tree（扁平：path/mode/sha）
  const lsOut = runGit(['ls-tree', '-r', 'HEAD'], repoPath).stdout;
  const entries = lsOut.split('\n').filter(Boolean).map((l) => {
    const m = l.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t(.*)$/);
    return m ? { mode: m[1], type: m[2], sha: m[3], path: m[4] } : null;
  }).filter((e) => e && e.type === 'blob');
  if (!entries.length) return { ok: false, pushed: false, reason: '本地 tree 为空' };

  // 分支免疫（v1.12.2）：GitHub 默认分支可能是 master 或 main，杜绝因分支名不符而误建新分支。
  // 解析目标分支：请求字符串缺省 → 取本地当前分支；
  //   a) 请求的分支在远端已存在 → 用请求值（既有分支优先，正常更新）；
  //   b) 不存在但远端有 default_branch 且不同名 → 自动改用远端默认分支（防止误建错名新分支）；
  //   c) 同名或无 default_branch 信息 → 用请求值。
  let targetBranch = branch || runGit(['branch', '--show-current'], repoPath).stdout || '';
  if (!targetBranch) return { ok: false, pushed: false, reason: '无法确定目标分支' };
  let branchAdjusted = null;
  const metaRes = await api(''); // GET /repos/{o}/{r} → default_branch
  const defaultBranch = metaRes.status === 200 ? (metaRes.json?.default_branch || null) : null;
  const hasBranchRef = (await api(`/git/ref/heads/${targetBranch}`)).status === 200;
  if (!hasBranchRef && defaultBranch && defaultBranch !== targetBranch) {
    branchAdjusted = { from: targetBranch, to: defaultBranch };
    targetBranch = defaultBranch;
  }
  // 远端 ref（首次推送 404）
  const refRes = await api(`/git/ref/heads/${targetBranch}`);
  const remoteHead = refRes.status === 200 ? refRes.json?.object?.sha : null;
  if (remoteHead === headSha) return { ok: true, pushed: false, reason: '无新提交可推送', owner, repo, branch: targetBranch, branchAdjusted };
  // 内容级短路：API 通道每次推送会新建 API 侧 commit 对象（sha 与本地不同），
  // 因此用 tree sha 判断内容是否已一致——tree 相同即无新内容可推，避免重复 commit
  if (remoteHead) {
    const localTree = runGit(['rev-parse', 'HEAD^{tree}'], repoPath).stdout;
    const rc = await api(`/git/commits/${remoteHead}`);
    const remoteTree = rc.json?.tree?.sha;
    if (localTree && remoteTree && localTree === remoteTree) {
      return { ok: true, pushed: false, reason: '无新提交可推送', owner, repo, branch: targetBranch, branchAdjusted };
    }
  }

  // 远端 tree（递归取已有 blob sha 用于复用，减少 API 调用）
  const remoteBlobShas = new Set();
  if (remoteHead) {
    const t = await api(`/git/trees/${remoteHead}?recursive=1`);
    if (t.status === 200 && t.json?.tree) {
      for (const e of t.json.tree) if (e.type === 'blob') remoteBlobShas.add(e.sha);
    }
  }

  // 逐 blob 上传（复用远端已有 sha）
  const treeEntries = [];
  for (const e of entries) {
    if (remoteBlobShas.has(e.sha)) {
      treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha });
      continue;
    }
    const raw = gitRaw(['cat-file', 'blob', e.sha], repoPath);
    if (raw.status !== 0 || !raw.stdout.length) return { ok: false, pushed: false, reason: `读 blob 失败: ${e.path}` };
    const b = await api('/git/blobs', 'POST', { content: raw.stdout.toString('base64'), encoding: 'base64' });
    if (b.status !== 201) return { ok: false, pushed: false, reason: `上传 blob 失败 ${e.path}: ${b.json?.message || b.status}` };
    treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: b.json.sha });
  }

  // 建 tree
  const t = await api('/git/trees', 'POST', { tree: treeEntries });
  if (t.status !== 201) return { ok: false, pushed: false, reason: `建 tree 失败: ${t.json?.message || t.status}` };

  // 建 commit（parent=远端 HEAD，首次推送无 parent）
  const msg = runGit(['log', '-1', '--format=%s'], repoPath).stdout || 'chore: push via api';
  const commitBody = { message: msg, tree: t.json.sha, ...(remoteHead ? { parents: [remoteHead] } : {}) };
  const c = await api('/git/commits', 'POST', commitBody);
  if (c.status !== 201) return { ok: false, pushed: false, reason: `建 commit 失败: ${c.json?.message || c.status}` };

  // 更新 ref（有则 PATCH，无则 POST 创建；POST 遇已存在 → 改 PATCH）
  if (remoteHead) {
    const r = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: false });
    if (r.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r.json?.message || r.status}` };
  } else {
    const r = await api('/git/refs', 'POST', { ref: `refs/heads/${targetBranch}`, sha: c.json.sha });
    if (r.status === 201) {
      return { ok: true, pushed: true, commitSha: c.json.sha, owner, repo, branch: targetBranch, branchAdjusted };
    }
    if (r.status === 422 && /already exists/i.test(r.json?.message || '')) {
      const r2 = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: false });
      if (r2.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r2.json?.message || r2.status}` };
    } else {
      return { ok: false, pushed: false, reason: `创建 ref 失败: ${r.json?.message || r.status}` };
    }
  }
  return { ok: true, pushed: true, commitSha: c.json.sha, owner, repo, branch: targetBranch, branchAdjusted };
}

/**
 * 测试环境判定（2026-08-20 用户约定：测试环境禁止 git 提交，走任务清单交接主环境提交）。
 * 与 dsh-git-rescue lib/test-home.js 同规则：DSH_HOME 含 `dsh-test-*` 即测试环境。
 * @param {string|null|undefined} dshHome DSH_HOME 路径；未指定时探测 process.env.DSH_HOME
 * @returns {boolean} true=测试环境（禁止提交）
 */
export function isTestEnvHome(dshHome) {
  const home = dshHome || process.env.DSH_HOME || ''
  if (!home) return false
  const norm = String(home).replace(/\\/g, '/')
  return /(^|\/)dsh-test-(home|rc7|clean)([\/-]|$)/.test(norm)
}

/**
 * 测试环境提交门禁：测试环境禁止 commit/push（用户约定 2026-08-20）。
 * 正确姿势：把改动写进 workspace 任务清单文件（如「任务清单-提交-<日期>.md」），
 * 由主环境（非 dsh-test-* DSH_HOME）的会话执行 git 提交推送。
 * @returns {{blocked:boolean, reason?:string}}
 */
export function checkTestEnvCommitGate() {
  if (!isTestEnvHome()) return { blocked: false }
  return {
    blocked: true,
    reason: '测试环境禁止 git 提交（DSH_HOME 含 dsh-test-*）：请把改动写进 workspace 任务清单文件，交接主环境执行 commit+push',
  }
}

/** 递归/命令式查找 root 下最多 depth 层的 .git 目录（排除 node_modules、.dsh） */
export function findGitDirs(root, depth = 3) {
  let out = '';
  try {
    out = execSync(`find "${root}" -maxdepth ${depth} -name .git -type d 2>/dev/null`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch { /* find 无匹配返回非零，忽略 */ }
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((d) => resolve(dirnameOf(d)))
    .filter((p) => !/\/node_modules\//.test(p) && !/\/\.dsh\//.test(p));
}

function dirnameOf(gitDirPath) {
  // gitDirPath 形如 /a/b/.git → 仓库根 /a/b
  return gitDirPath.replace(/\/\.git$/, '');
}

/** 读取单仓库状态 */
export function readRepoStatus(repoPath) {
  const branch = runGit(['branch', '--show-current'], repoPath).stdout || '(detached)';
  const remote = runGit(['remote', 'get-url', 'origin'], repoPath).stdout || '';
  const shortId = runGit(['rev-parse', '--short', 'HEAD'], repoPath).stdout || '';
  const porcelain = runGit(['status', '--porcelain'], repoPath).stdout;
  const changes = porcelain ? porcelain.split('\n').filter(Boolean) : [];
  const lastActivity = runGit(['log', '-1', '--format=%aI'], repoPath).stdout || '';
  return {
    branch,
    remote,
    shortId,
    changes: changes.length,
    changeLines: changes.slice(0, 20),
    lastActivity,
  };
}

function isRepoEmpty(repoPath) {
  const count = runGit(['rev-list', '--all', '--count'], repoPath);
  return count.status !== 0 || Number(count.stdout || 0) === 0;
}

/**
 * 扫描 root 下所有 git 仓库（按仓库名去重，同名只保留第一个——extracted 副本与顶层同名靠此去重）
 * extraRepos：硬编码补充（find 范围之外的仓库，如 /vol02 只读卷）
 */
export function scanRepos({ root, depth = 3, extraRepos = [] } = {}) {
  const found = findGitDirs(root, depth);
  const repos = [];
  const seen = new Set();
  for (const repoPath of [...found, ...extraRepos.map((p) => resolve(p))]) {
    const name = basename(repoPath);
    if (seen.has(name)) continue;
    seen.add(name);
    if (!existsSync(join(repoPath, '.git'))) continue;
    if (isRepoEmpty(repoPath)) continue;
    repos.push({ name, path: repoPath, ...readRepoStatus(repoPath) });
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 确保仓库 .gitignore 屏蔽 npm 下载产物（2026-08-20 用户需求「上传推送检查屏蔽下载的一堆npm包」）。
 * 幂等：只追加缺失条目，不覆盖已有 .gitignore 内容。
 * 覆盖：node_modules/、常见 lock 文件、npm 缓存/日志。
 */
const NPM_IGNORE_LINES = [
  'node_modules/',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'npm-debug.log*',
  '.npm/',
  '.pnpm-store/',
];
export function ensureNpmIgnored(repoPath) {
  const giPath = join(repoPath, '.gitignore');
  let existing = '';
  if (existsSync(giPath)) {
    try { existing = readFileSync(giPath, 'utf8'); } catch (_) { existing = ''; }
  }
  const missing = NPM_IGNORE_LINES.filter((line) => !new RegExp(`(^|\\n)${escapeRegExp(line)}(\\n|$)`).test(existing));
  if (missing.length === 0) return { ok: true, added: [] };
  const append = (existing.endsWith('\n') ? '' : '\n') + '# npm 下载产物（dsh-git-push 自动追加，2026-08-20）\n' + missing.join('\n') + '\n';
  try {
    writeFileSync(giPath, existing + append, 'utf8');
    return { ok: true, added: missing };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), added: [] };
  }
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------ 敏感字段扫描 + 自动 .gitignore（v1.7.0） ------------------------------ */

/** 递归扫描时跳过的目录（与 npm 屏蔽同源 + 常见忽略） */
const SENSITIVE_SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', '.trash', 'cache-gifs', 'uploads', 'dist', 'build']);
/** 明显二进制/图片/压缩/媒体扩展名，不当作文本扫描 */
const SENSITIVE_BINARY_EXT = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg','zip','7z','rar','gz','tar','xz','pdf','exe','dll','so','dylib','bin','woff','woff2','ttf','otf','mp4','mp3','ogg','wav','flac','db','sqlite','ico']);
/** 敏感字段（cookie / 设备 / 用户名 / 密码 / token-secret），键名大小写不敏感 */
const SENSITIVE_KEYS = [
  { name: 'cookie',     keys: ['cookie', 'cookies'],                                  valueMin: 4 },
  { name: 'device',     keys: ['device_id','device-id','deviceid','device_name','device-info','machine_id','machine-id','hardware_id','hardware-id','imei','serial_number','serial-number'], valueMin: 2 },
  { name: 'username',   keys: ['username','user_name','user-name','login_name','login-name','account'], valueMin: 2 },
  { name: 'password',   keys: ['password','passwd','pass_word','pass-word','pwd'],    valueMin: 3 },
  { name: 'token/secret', keys: ['api_key','api-key','apikey','api_secret','api-secret','access_key','access-key','auth_token','auth-token','refresh_token','refresh-token','secret_key','secret-key','client_secret','client-secret'], valueMin: 6 },
];
/** 占位符/示例值：值看起来是假的就不报（防 README/示例误伤） */
const SENSITIVE_PLACEHOLDER_VALUE = /^(your[-_ ]?[a-z]+|xxx+\.?\.?|example|changeme|dummy|sample|demo|placeholder|<[^>]+>|\$\{?[A-Z_][A-Z0-9_]*}?|process\.env\.[A-Z_]+|env\.[A-Z_]+|undefined|null|true|false)$/i;
/** 行内示例上下文：出现即整行豁免（举例/示例/演示） */
const SENSITIVE_EXAMPLE_CONTEXT = /(例如|举例|示例|样例|演示|比如|fake|sample|demo|example|illustration)/i;

/** 单行敏感字段匹配：返回字段名或 null（跳过注释行/示例行/占位符值） */
function sensitiveLineMatch(line) {
  if (SENSITIVE_EXAMPLE_CONTEXT.test(line)) return null;
  const clean = line.replace(/^[#;/\*\s]+/, ''); // 去掉行首注释标记与空白
  for (const k of SENSITIVE_KEYS) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])(?:${k.keys.map(escapeRegExp).join('|')})\\s*[:=]\\s*(.*)$`, 'i');
    const m = clean.match(re);
    if (m) {
      const val = m[1].trim().replace(/["',;)\]}\s]+$/, '');
      if (val.length >= k.valueMin && !SENSITIVE_PLACEHOLDER_VALUE.test(val)) return k.name;
    }
  }
  return null;
}

/**
 * 扫描仓库全部文本文件，找出含敏感字段（cookie/device/username/password/token-secret）的文件。
 * 返回 [{ path, fields: string[] }]。只扫 ≤512KB 的文本文件（跳过二进制/图片/压缩/忽略目录）。
 */
export function scanSensitiveFiles(repoPath) {
  const hits = [];
  const walk = (dir, rel) => {
    let items;
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const relPath = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) {
        if (SENSITIVE_SKIP_DIRS.has(it.name)) continue;
        walk(join(dir, it.name), relPath);
      } else if (it.isFile()) {
        try {
          const st = statSync(join(dir, it.name));
          if (st.size > 512 * 1024) continue;
        } catch { continue; }
        const dot = it.name.lastIndexOf('.');
        const ext = dot >= 0 ? it.name.slice(dot + 1).toLowerCase() : '';
        if (SENSITIVE_BINARY_EXT.has(ext)) continue;
        let text;
        try { text = readFileSync(join(dir, it.name), 'utf8'); } catch { continue; }
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) continue; // 二进制内容
        const fields = [];
        for (const line of text.split('\n')) {
          const r = sensitiveLineMatch(line);
          if (r && !fields.includes(r)) fields.push(r);
          if (fields.length === SENSITIVE_KEYS.length) break;
        }
        if (fields.length) hits.push({ path: relPath, fields });
      }
    }
  };
  walk(repoPath, '');
  return hits;
}

/**
 * 扫描敏感字段并把命中文件追加到 .gitignore（幂等；已跟踪文件自动 git rm --cached 解除跟踪，工作区文件保留）。
 * 返回 { ok, added: string[], hits, tracked: string[], unstaged: string[] }。
 */
export function ensureSensitiveIgnored(repoPath) {
  const hits = scanSensitiveFiles(repoPath);
  const added = [];
  const tracked = [];
  const unstaged = [];
  if (hits.length) {
    const giPath = join(repoPath, '.gitignore');
    let existing = '';
    if (existsSync(giPath)) { try { existing = readFileSync(giPath, 'utf8'); } catch { existing = ''; } }
    const toAdd = [];
    for (const h of hits) {
      const line = h.path;
      if (new RegExp(`(^|\\n)${escapeRegExp(line)}(\\n|$)`).test(existing)) continue;
      // 已跟踪 → 先解除跟踪（git rm --cached --ignore-unmatch），否则 .gitignore 无效
      const ls = runGit(['ls-files', '--error-unmatch', '--', line], repoPath);
      if (ls.status === 0) {
        tracked.push(line);
        const rm = runGit(['rm', '--cached', '--ignore-unmatch', '--', line], repoPath);
        if (rm.status === 0) unstaged.push(line);
      }
      toAdd.push(line);
    }
    if (toAdd.length) {
      const append = (existing.endsWith('\n') ? '' : '\n') + '# 敏感字段文件（dsh-git-push 自动追加，2026-09-01）\n' + toAdd.join('\n') + '\n';
      try {
        writeFileSync(giPath, existing + append, 'utf8');
        added.push(...toAdd);
      } catch (e) {
        return { ok: false, error: String(e?.message || e), hits, tracked, added: [], unstaged };
      }
    }
  }
  return { ok: true, added, hits, tracked, unstaged };
}

/**
 * 一键提交推送：
 *   ensureNpmIgnored → git add -A → 检查变更 → git commit -m message → push 前 fetch + ahead/behind 检查 → push origin <branch>
 * 返回结构化结果；dryRun 只走扫描统计不执行写入。
 */
export async function commitAndPush({ repoPath, message, push = true, dryRun = false, requirementsConfirmed = false } = {}) {
  if (!repoPath) return { ok: false, error: '缺少 repoPath' };
  // 测试环境提交门禁（2026-08-20 用户约定）：测试环境禁止 commit/push，走任务清单交接主环境
  const gate = checkTestEnvCommitGate();
  if (gate.blocked && !dryRun) {
    return { ok: false, blocked: true, error: gate.reason, repo: repoPath };
  }
  if (!existsSync(join(repoPath, '.git'))) {
    return { ok: false, error: `不是 git 仓库: ${repoPath}` };
  }
  if (!message || !message.trim()) {
    return { ok: false, error: 'commit message 不能为空' };
  }

  let resultStepsHint = '';
  // 用户特殊要求门禁（v1.10.0）：读插件 User/<owner>/ 要求清单，AI 需逐条核对达标
  const userReqs = loadUserRequirements({ repoPath });
  if (userReqs.found) {
    if (!requirementsConfirmed) {
      return {
        ok: false,
        blocked: true,
        code: 'USER_REQUIREMENTS',
        error: '开发者特殊要求未核对：AI 需先逐条核对 User/' + userReqs.user + '/ 要求全部达标，再带 requirementsConfirmed:true 重新调用',
        requirements: userReqs,
        repo: repoPath,
      };
    }
    resultStepsHint = `已核对用户要求(${userReqs.files.reduce((a, x) => a + x.items.length, 0)}条)`;
  }
  const branch = runGit(['branch', '--show-current'], repoPath).stdout || '(detached)';
  if (branch === '(detached)') {
    return { ok: false, error: 'HEAD 处于 detached 状态，请先 checkout 分支' };
  }
  const result = { ok: true, repo: repoPath, branch, dryRun, committed: false, steps: [] };

  // 屏蔽 npm 下载产物（2026-08-20）：确保 .gitignore 覆盖 node_modules / lock 文件，防止「一堆 npm 包」进变更
  const ignoreResult = dryRun ? { ok: true, added: [], skipped: 'dry-run' } : ensureNpmIgnored(repoPath);
  if (!ignoreResult.ok) {
    return { ok: false, step: 'ensureNpmIgnored', error: ignoreResult.error, repo: repoPath };
  }
  if (ignoreResult.added?.length) {
    result.steps.push(`npm-ignore(+${ignoreResult.added.length}条)`);
  }

  // 敏感字段扫描 + 自动 .gitignore（2026-09-01）：扫 cookie/device/username/password/token-secret，
  // 命中文件自动加进 .gitignore（已跟踪的 git rm --cached 解除跟踪）。dryRun 只扫描不写入。
  const sensResult = dryRun
    ? { ok: true, added: [], hits: scanSensitiveFiles(repoPath), tracked: [], unstaged: [], skipped: 'dry-run' }
    : ensureSensitiveIgnored(repoPath);
  if (!sensResult.ok) {
    return { ok: false, step: 'ensureSensitiveIgnored', error: sensResult.error, repo: repoPath };
  }
  if (sensResult.added?.length) {
    result.steps.push(`sensitive-ignore(+${sensResult.added.length}文件)`);
  }
  if (sensResult.hits?.length) result.sensitive = sensResult;

  // add
  if (!dryRun) {
    const add = runGit(['add', '-A'], repoPath);
    if (add.status !== 0) return { ok: false, step: 'git add', error: add.stderr };
  }
  result.steps.push('add');

  // 变更检查
  const porcelain = dryRun ? '' : runGit(['status', '--porcelain'], repoPath).stdout;
  if (!dryRun && !porcelain.trim()) {
    return { ...result, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } };
  }
  if (dryRun) {
    return { ...result, message: `(dry-run) 将提交: ${message}`, dryRunChanges: porcelain ? porcelain.split('\n').filter(Boolean).length : 0, push: { pushed: false, reason: 'dry-run 不推送' } };
  }

  // commit（仓库无局部 user 配置时用通用身份，避免 "Author identity unknown"）
  const identity = runGit(['config', 'user.name'], repoPath).stdout
    ? []
    : ['-c', 'user.name=DSH Agent', '-c', 'user.email=agent@dsh.local'];
  const commit = runGit([...identity, 'commit', '-m', message], repoPath);
  if (commit.status !== 0) {
    if (/nothing to commit|no changes added/.test(commit.stderr)) {
      return { ...result, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } };
    }
    return { ok: false, step: 'git commit', error: commit.stderr };
  }
  result.committed = true;
  result.commitId = runGit(['rev-parse', '--short', 'HEAD'], repoPath).stdout;
  result.steps.push('commit');

  // push（v1.12.0：默认走 api.github.com 的 Git Data API——github.com 直连被网络阻断仍可推；
  // 无 token 或 API 失败时回退 git push origin）
  result.push = { pushed: false, reason: 'push=false' };
  if (push) {
    const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
    let apiPushed = null;
    if (originUrl) {
      const tokenInfo = resolveGitToken({ repoPath });
      if (tokenInfo.token) {
        try {
          apiPushed = await pushViaApi({ repoPath, branch, token: tokenInfo.token });
        } catch (e) {
          apiPushed = { ok: false, pushed: false, reason: 'API 推送异常: ' + (e?.message || e) };
        }
      }
    }
    if (apiPushed?.ok && apiPushed.pushed) {
      result.push = { pushed: true, pushedTo: `api.github.com/${apiPushed.owner}/${apiPushed.repo}`, ahead: null, method: 'api' };
    } else if (apiPushed?.ok && !apiPushed.pushed) {
      result.push = { pushed: false, reason: apiPushed.reason || '无新提交可推送', method: 'api' };
    } else {
      // 回退：git push origin（原 v1.11.0 逻辑——SSH origin 且有 token 时经 HTTPS+token，否则 origin）
      const sshOrigin = /^ssh:/i.test(originUrl) || /^git@github/i.test(originUrl);
      const tokenInfo = resolveGitToken({ repoPath });
      const useToken = !!originUrl && (sshOrigin || /^https:\/\//.test(originUrl)) && !!tokenInfo.token;
      if (useToken) {
        try {
          writeFileSync('/tmp/dsh-gitpush-askpass.sh', '#!/bin/sh\necho "' + tokenInfo.token + '"\n', 'utf8');
          spawnSync('chmod', ['+x', '/tmp/dsh-gitpush-askpass.sh']);
        } catch { /* 忽略 */ }
      }
      const gitEnv = useToken ? { GIT_ASKPASS: '/tmp/dsh-gitpush-askpass.sh', GIT_TERMINAL_PROMPT: '0' } : {};
      const pushUrl = useToken ? httpsUrlOf(originUrl) : 'origin';
      const fetchUrl = useToken ? httpsUrlOf(originUrl) : 'origin';
      runGit(['fetch', fetchUrl, branch], repoPath, gitEnv);
      const rc = runGit(['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`], repoPath);
      const [ahead = 0, behind = 0] = (rc.stdout || '0 0').split(/\s+/).map((x) => Number(x) || 0);
      if (behind > 0) {
        result.push = { pushed: false, reason: `远端领先 ${behind} 个提交，先 pull 同步` };
      } else {
        const p = runGit(['push', pushUrl, branch], repoPath, gitEnv);
        if (p.status !== 0) {
          result.push = { pushed: false, reason: p.stderr, fallback: true };
        } else {
          result.push = { pushed: true, pushedTo: useToken ? httpsUrlOf(originUrl) : 'origin/' + branch, ahead, fallback: true };
        }
      }
    }
  }
  if (resultStepsHint) result.steps.unshift(resultStepsHint);
  return result;
}

/** 批量提交推送（多个仓库），单个失败不阻断其余 */
export async function commitMany({ repos, message, push = true, dryRun = false }) {
  const results = [];
  for (const repoPath of repos) {
    results.push({ repo: repoPath, ...(await commitAndPush({ repoPath, message, push, dryRun })) });
  }
  return results;
}

/* ------------------------------ 重建历史（v1.8.0） ------------------------------ */

const VERSION_RE = /\bv?(\d+)\.(\d+)\.(\d+)\b/;

/**
 * 从字符串解析版本号三元组 {major, minor, patch}，失败返回 null。
 */
export function parseVersion(str) {
  const m = String(str).match(VERSION_RE);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

function versionToStr(v) { return `${v.major}.${v.minor}.${v.patch}`; }

function cmpVersion(a, b) {
  for (const k of ['major', 'minor', 'patch']) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}

/**
 * 扫描仓库全部提交，按版本号（commit message 中的 X.Y.Z）分组返回。
 * 每组 = 一个版本号 + 其下所有提交（含不含版本号的后续提交直至下个版本号）。
 * 返回 [{ version: {major,minor,patch}, versionStr, label, commits: string[], lastHash, isPatch }]
 */
export function listVersionCommits(repoPath) {
  const log = runGit(['log', '--reverse', '--format=%H|%s'], repoPath);
  if (!log.stdout) return [];
  const groups = [];
  let current = null;
  for (const line of log.stdout.split('\n')) {
    const i = line.indexOf('|');
    if (i < 0) continue;
    const hash = line.slice(0, i);
    const msg = line.slice(i + 1);
    const v = parseVersion(msg);
    if (v) {
      current = { version: v, versionStr: versionToStr(v), hash, label: msg.slice(0, 80), commits: [hash], isPatch: v.patch > 0 };
      groups.push(current);
    } else if (current) {
      current.commits.push(hash);
    }
  }
  return groups;
}

/** 把补丁版本组 (Z > 0) 并入前一个同 major.minor 的主版本组。返回合并后的主版本组列表。 */
function squashGroups(groups) {
  const result = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.isPatch) continue;
    const merged = { ...g, commits: [...g.commits], mergedFixes: [] };
    let j = i + 1;
    while (j < groups.length && groups[j].isPatch && groups[j].version.major === g.version.major && groups[j].version.minor === g.version.minor) {
      merged.commits.push(...groups[j].commits);
      merged.mergedFixes.push(groups[j].versionStr);
      j++;
    }
    merged.lastHash = merged.commits[merged.commits.length - 1];
    if (merged.mergedFixes.length) merged.label = `${g.versionStr}（含 ${merged.mergedFixes.join('、')} 修复）`;
    result.push(merged);
  }
  return result;
}

/**
 * 预览重建历史的影响（安全，什么都不改）。
 * 返回结构化 preview 给用户确认。
 */
export function previewRebuildHistory({ repoPath, mode, dropFrom, dropTo }) {
  const groups = listVersionCommits(repoPath);
  if (!groups.length) return { ok: false, error: '无版本提交可操作' };
  if (mode === 'fresh') {
    return { ok: true, mode, dryRun: true, before: groups.length, after: 1, plan: '完全重建：当前文件树作为 1.0.0 初始提交，全部历史归档到 backup 标签' };
  }
  let keepGroups;
  if (mode === 'squash-bugfixes') {
    keepGroups = squashGroups(groups);
  } else if (mode === 'drop-versions') {
    const f = dropFrom ? parseVersion(dropFrom) : null;
    const t = dropTo ? parseVersion(dropTo) : null;
    if (!f && !t) return { ok: false, error: 'drop-versions 模式需指定 dropFrom 或 dropTo 版本号' };
    keepGroups = groups.filter(g => {
      if (f && cmpVersion(g.version, f) < 0) return true;
      if (t && cmpVersion(g.version, t) > 0) return true;
      if (f && t && cmpVersion(g.version, f) >= 0 && cmpVersion(g.version, t) <= 0) return false;
      if (f && !t && cmpVersion(g.version, f) >= 0) return false;
      return true;
    });
  } else {
    return { ok: false, error: `未知模式: ${mode}` };
  }
  const droppedCount = groups.length - keepGroups.length;
  return {
    ok: true, mode, dryRun: true,
    before: groups.length, after: keepGroups.length, dropped: droppedCount,
    keepGroups: keepGroups.map(g => ({ version: g.versionStr, label: g.label, commits: g.commits.length, mergedFixes: g.mergedFixes })),
  };
}

/**
 * 重建 git 历史。模式说明：
 *   squash-bugfixes — 补丁版本 (Z>0) 并入前一个主版本，只保留主版本提交点
 *   drop-versions   — 删除指定版本区间的所有提交 (dropFrom ~ dropTo)
 *   fresh           — 完全重建：当前文件树作为 1.0.0 初始提交
 * 所有破坏性操作前自动打 backup-<timestamp> tag。返回 { ok, mode, before, after, backupTag, ... }
 */
export function rebuildHistory({ repoPath, mode, dryRun = false, dropFrom, dropTo, force = false } = {}) {
  if (!repoPath) return { ok: false, error: '缺少 repoPath' };
  const gate = checkTestEnvCommitGate();
  if (gate.blocked) return { ok: false, error: gate.reason };

  if (mode === 'fresh') {
    const groups = listVersionCommits(repoPath);
    const before = groups.length;
    if (dryRun) return { ok: true, mode, dryRun: true, before, after: 1, plan: '完全重建为 1.0.0' };
    const backupTag = `backup-${Date.now()}`;
    runGit(['tag', '-f', backupTag], repoPath);
    const branch = runGit(['branch', '--show-current'], repoPath).stdout || 'master';
    // 当前工作树 add → 记录 treeHash → reset HEAD → 删 .git → init → 重建提交
    runGit(['add', '-A'], repoPath);
    const treeHash = runGit(['write-tree'], repoPath).stdout;
    runGit(['rm', '-rf', '.git'], repoPath);
    runGit(['init', '-q'], repoPath);
    runGit(['checkout', '-b', branch], repoPath);
    runGit(['add', '-A'], repoPath);
    runGit(['commit', '-m', '1.0.0 初始提交（重建历史）'], repoPath);
    // package.json 版本号归 1.0.0
    try {
      const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf8'));
      pkg.version = '1.0.0';
      writeFileSync(join(repoPath, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      runGit(['add', 'package.json'], repoPath);
      runGit(['commit', '-m', 'chore: 版本号归 1.0.0'], repoPath);
    } catch {}
    return { ok: true, mode, before, after: 1, backupTag, branch, repo: repoPath, version: '1.0.0' };
  }

  // squash-bugfixes / drop-versions
  const groups = listVersionCommits(repoPath);
  if (!groups.length) return { ok: false, error: '无版本提交可操作' };
  let keepGroups;
  if (mode === 'squash-bugfixes') {
    keepGroups = groups.filter(g => !g.isPatch);
  } else if (mode === 'drop-versions') {
    const f = dropFrom ? parseVersion(dropFrom) : null;
    const t = dropTo ? parseVersion(dropTo) : null;
    if (!f && !t) return { ok: false, error: 'drop-versions 模式需指定 dropFrom 或 dropTo' };
    keepGroups = groups.filter(g => {
      if (f && cmpVersion(g.version, f) < 0) return true;
      if (t && cmpVersion(g.version, t) > 0) return true;
      if (f && t && cmpVersion(g.version, f) >= 0 && cmpVersion(g.version, t) <= 0) return false;
      if (f && !t && cmpVersion(g.version, f) >= 0) return false;
      return true;
    });
  } else {
    return { ok: false, error: `未知模式: ${mode}` };
  }
  if (keepGroups.length === 0) return { ok: false, error: '没有符合条件的版本组保留。请检查版本号或模式' };

  if (dryRun) {
    return {
      ok: true, mode, dryRun: true,
      before: groups.length, after: keepGroups.length, dropped: groups.length - keepGroups.length,
      keepGroups: keepGroups.map(g => ({ version: g.versionStr, label: g.label, commits: g.commits.length })),
    };
  }

  const backupTag = `backup-${Date.now()}`;
  runGit(['tag', '-f', backupTag], repoPath);
  const branch = runGit(['branch', '--show-current'], repoPath).stdout || 'master';
  runGit(['checkout', '--orphan', 'rebuild-tmp'], repoPath);

  for (const g of keepGroups) {
    const lastHash = g.commits[g.commits.length - 1];
    runGit(['read-tree', lastHash], repoPath);
    runGit(['commit', '-m', g.label], repoPath);
  }

  runGit(['branch', '-M', 'rebuild-tmp', branch], repoPath);
  // 版本号归 1.0.0
  let resultVersion = null;
  try {
    const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf8'));
    pkg.version = '1.0.0';
    writeFileSync(join(repoPath, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    runGit(['add', 'package.json'], repoPath);
    runGit(['commit', '-m', 'chore: 版本号归 1.0.0（重建历史）'], repoPath);
    resultVersion = '1.0.0';
  } catch {}

  return {
    ok: true, mode, before: groups.length, after: keepGroups.length, dropped: groups.length - keepGroups.length,
    backupTag, branch, repo: repoPath, version: resultVersion || '(package.json 不存在)',
  };
}

/* ------------------------------ 规范化 README 生成（v1.8.0） ------------------------------ */

/** README 章节定义：id / 标题 / 插入点说明。骨架留插入点，内容填充由 skill 实现。 */
const README_SECTIONS = [
  { id: 'architecture', title: '架构设计', insert: '项目核心架构说明（分层/组件/模块/关键设计决策）' },
  { id: 'structure', title: '文件目录结构及作用', insert: '关键文件/目录清单 + 每项作用说明' },
  { id: 'start', title: '启动脚本', insert: 'start.sh 用法：start / stop / restart / status，含端口与环境要求' },
  { id: 'api', title: 'API 总览', insert: '| 方法 | 路径 | 说明 |（每行路径跳转到对应详细说明锚点）' },
  { id: 'versions', title: '版本列表', insert: null }, // 自动填充
  { id: 'pitfalls', title: '注意事项', insert: '踩过的坑、边界条件、依赖环境要求、已知限制' },
  { id: 'plan', title: '开发计划 / 疑难杂症', insert: '待办功能、已知问题、未解决的技术难题' },
];

/**
 * 规范化生成 README 骨架（一句话概括 + 架构设计 + 文件目录结构及作用 + 启动脚本 + API 总览带跳转目录 + 版本列表 + 注意事项 + 开发计划/疑难杂症）。
 *  - 自动填充：项目名（package.json）、一句话概括（description）、版本号、顶部目录 TOC、版本记录表（git log）
 *  - 其余章节为占位插入点，标记 `<!-- INSERT:xxx -->`
 *  - writePath 可选写入文件，默认只返回内容
 * 返回 { ok, content, name, description, version, versionTable, skeleton, toc }
 */
export function genReadme({ repoPath, writePath } = {}) {
  if (!repoPath) return { ok: false, error: '缺少 repoPath' };
  let name = '项目名';
  let description = '一句话简介';
  let version = null;
  try {
    const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf8'));
    if (pkg.name) name = pkg.name;
    if (pkg.description) description = pkg.description;
    if (pkg.version) version = pkg.version;
  } catch {}

  // 版本记录表：git log 版本组 → 按版本号聚合（同版本多 commit 并一行，补丁并入所属主版本，最新→最旧）
  const groups = listVersionCommits(repoPath);
  const versionTableLines = ['| 版本 | 内容 |', '|------|------|'];
  if (groups.length) {
    const byVersion = new Map();
    for (const g of groups) {
      const key = g.isPatch ? `${g.version.major}.${g.version.minor}.0` : g.versionStr;
      if (!byVersion.has(key)) byVersion.set(key, []);
      byVersion.get(key).push(g.label);
    }
    const keys = [...byVersion.keys()].sort((a, b) => {
      const [am, ai, ap] = a.split('.').map(Number);
      const [bm, bi, bp] = b.split('.').map(Number);
      return (bm - am) || (bi - ai) || (bp - ap);
    });
    for (const k of keys) {
      const content = byVersion.get(k).map((l) => l.replace(/^\S+\s*/, '')).filter(Boolean).join('；');
      versionTableLines.push(`| ${k} | ${content || '(见提交)'} |`);
    }
  } else {
    versionTableLines.push('| 1.0.0 | （待填） |');
  }

  // 顶部跳转目录（TOC）
  const toc = README_SECTIONS.map(s => `- [${s.title}](#${s.title})`).join('\n');

  // 组装正文（插入点 + 自动填充）
  const sections = README_SECTIONS.map((s) => {
    if (s.id === 'versions') return `## ${s.title}\n\n${versionTableLines.join('\n')}`;
    return `## ${s.title}\n\n<!-- INSERT: ${s.insert} -->`;
  }).join('\n\n');

  const content = `# ${name}

> ${description}

## 目录

${toc}

${sections}
`;

  let written = false;
  let writeError = null;
  if (writePath) {
    try { writeFileSync(writePath, content, 'utf8'); written = true; }
    catch (e) { writeError = String(e?.message || e); }
  }

  return {
    ok: true, content, name, description, version, written, writeError,
    versionTable: versionTableLines,
    skeleton: ['intro', 'toc', ...README_SECTIONS.map(s => s.id)],
    toc,
  };
}

/**
 * 解析 git diff 文本，返回变更文件列表：
 * [{ path, addedLines: string[], deleted: number, isBinary: boolean }]
 */
export function parseDiff(diffText) {
  const files = [];
  let current = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/diff --git a\/(.*?) b\/(.*)$/);
      const path = m?.[2]?.replace(/\s+$/, '') ?? '';
      if (current) files.push(current);
      current = { path, addedLines: [], deleted: 0, isBinary: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('Binary files ')) { current.isBinary = true; continue; }
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (/^@@ /.test(line)) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.addedLines.push(line.slice(1));
    else if (line.startsWith('-') && !line.startsWith('---')) current.deleted += 1;
  }
  if (current) files.push(current);
  return files.filter((f) => f.path);
}

/** 获取 repo 相对 HEAD 的变更文件（含 untracked 新文件，untracked 合成进 diff 文本）。 */
export function getDiff(repoPath, { unified = 3 } = {}) {
  const r = runGit(['diff', 'HEAD', `--unified=${unified}`, '--no-color'], repoPath);
  if (r.status !== 0) return { ok: false, error: r.stderr || 'git diff 失败' };
  const files = parseDiff(r.stdout);
  const ut = runGit(['ls-files', '--others', '--exclude-standard'], repoPath);
  let synthetic = '';
  for (const p of ut.stdout.split('\n').filter(Boolean)) {
    if (files.some((f) => f.path === p)) continue;
    try {
      const content = readFileSync(join(repoPath, p), 'utf8');
      const lines = content.split('\n');
      files.push({ path: p, addedLines: lines, deleted: 0, isBinary: false });
      synthetic += `diff --git a/${p} b/${p}\nnew file mode 100644\n`;
      for (const line of lines) synthetic += `+${line}\n`;
    } catch { /* 读不到跳过 */ }
  }
  return { ok: true, diff: r.stdout + synthetic, files };
}

/** 判断文件是否二进制/大文件（按扩展名 + 大小）。 */
export function isBinaryOrLarge(filePath, { maxBytes = 1024 * 1024 } = {}) {
  const bigExt = /\.(fpk|zip|tgz|gz|exe|dll|so|dylib|pem|key|p12|bin|class|jar|apk|ipa|crx|ttf|woff2?|mp4|mov|png|jpg|jpeg|webp|gif)$/i;
  if (bigExt.test(filePath)) return true;
  try {
    return statSync(filePath).size > maxBytes;
  } catch {
    return false;
  }
}

export { readdirSync };

/* ------------------------------ 按项目文件夹创建远程仓库（v1.9.0） ------------------------------ */

/**
 * 探测 GitHub token（多源，返回首个可读）：显式 tokenPath → repo 内 .git-push-token →
 * workspaceRoot/data/sensitive/github-token → 常见凭据位置。绝不把 token 值写入返回值明文（只回传 source 路径）。
 * @returns {{ token: string, source: string }}
 */
export function resolveGitToken({ tokenPath = '', repoPath = '', workspaceRoot = '' } = {}) {
  const candidates = [];
  if (tokenPath) candidates.push(tokenPath);
  if (repoPath) candidates.push(join(repoPath, '.git-push-token'));
  if (workspaceRoot) {
    candidates.push(join(workspaceRoot, 'data', 'sensitive', 'github-token'));
    candidates.push(join(workspaceRoot, '..', 'data', 'sensitive', 'github-token'));
  }
  candidates.push('/vol1/@appshare/DeepSeekHarness/workspace/data/sensitive/github-token');
  // 会话目录 .git-push-token（多会话探测）：HOME 与 DSH_HOME 的「会话」目录下各子目录
  for (const root of [process.env.HOME, process.env.DSH_HOME]) {
    if (!root) continue;
    for (const d of ['会话', 'sessions', 'workspace']) {
      const sdir = join(root, d);
      try {
        if (!existsSync(sdir)) continue;
        for (const ent of readdirSync(sdir, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue;
          const tpath = join(sdir, ent.name, '.git-push-token');
          if (existsSync(tpath)) candidates.push(tpath);
        }
      } catch { /* 忽略 */ }
    }
  }
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const t = readFileSync(p, 'utf8').trim();
        if (t && /^gh[pous]_/.test(t)) return { token: t, source: p };
      }
    } catch { /* 读不到跳过 */ }
  }
  return { token: '', source: '' };
}

/**
 * 按项目文件夹创建/关联远程仓库（v1.9.0）。
 * 对本地 git 仓库（repoPath）：取目录名做仓库名 → 检查 GitHub 是否已存在同名仓库 →
 * 不存在则用 token 自动创建（private 可选）→ 设置 origin（SSH 443 端口，与 ai-work-archive 同款）→ 返回结果。
 * dryRun=true 只探测/预演不写 remote 不调创建 API。
 * @returns {{ ok, created, exists, name, owner, origin, remoteAdded?, steps: string[], dryRun?, error? }}
 */
export async function ensureRemoteRepo({
  repoPath = '',
  owner = 'EIGHTfs',
  visibility = 'private',
  tokenPath = '',
  workspaceRoot = '',
  dryRun = false,
  description = '',
} = {}) {
  if (!repoPath || !existsSync(repoPath) || !existsSync(join(repoPath, '.git'))) {
    return { ok: false, error: { code: 'NOT_GIT', message: '指定路径不是 git 仓库（无 .git）' } };
  }
  const name = basename(repoPath);
  const steps = [];
  const { token, source } = resolveGitToken({ tokenPath, repoPath, workspaceRoot });
  if (!token) {
    return { ok: false, error: { code: 'NO_TOKEN', message: '未找到可读 GitHub token（尝试 tokenPath / 项目 .git-push-token / workspaceRoot data/sensitive）' } };
  }

  // 1. 现有 origin
  const origin = runGit(['remote', 'get-url', 'origin'], repoPath).stdout || '';
  if (origin) {
    steps.push(`已有 origin: ${origin}`);
  } else if (!dryRun) {
    runGit(['remote', 'add', 'origin', `ssh://git@ssh.github.com:443/${owner}/${name}.git`], repoPath);
    steps.push(`已设置 origin → ssh://git@ssh.github.com:443/${owner}/${name}.git`);
  } else {
    steps.push(`将设置 origin → ssh://git@ssh.github.com:443/${owner}/${name}.git`);
  }

  // 2. 检查 GitHub 是否已存在
  let exists = false;
  let existingUrl = '';
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-git-push' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 200) {
      exists = true;
      const data = await res.json();
      existingUrl = data.html_url || '';
    } else if (res.status !== 404) {
      return { ok: false, error: { code: 'GH_QUERY', message: `查询远程仓库失败 HTTP ${res.status}` } };
    }
  } catch (e) {
    return { ok: false, error: { code: 'GH_NET', message: `GitHub API 请求失败: ${String(e?.message || e).slice(0, 100)}` } };
  }

  // 3. 创建（不存在时）
  let created = false;
  if (exists) {
    steps.push(`远程已存在: ${existingUrl || `${owner}/${name}`}`);
  } else if (dryRun) {
    steps.push(`将创建远程仓库 ${owner}/${name}（${visibility}）`);
  } else {
    try {
      const res = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-git-push', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || `由 dsh-git-push 自动创建（项目 ${name}）`,
          private: visibility !== 'public',
          auto_init: false,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: { code: 'GH_CREATE', message: `创建远程仓库失败 HTTP ${res.status}: ${body.slice(0, 160)}` } };
      }
      created = true;
      steps.push(`已创建远程仓库 ${owner}/${name}（${visibility}）`);
    } catch (e) {
      return { ok: false, error: { code: 'GH_NET', message: `创建请求失败: ${String(e?.message || e).slice(0, 100)}` } };
    }
  }

  return {
    ok: true,
    name,
    owner,
    exists,
    created,
    origin: `ssh://git@ssh.github.com:443/${owner}/${name}.git`,
    remoteWasSet: !origin && !dryRun,
    steps,
    tokenSource: source,
    ...(dryRun ? { dryRun: true } : {}),
  };
}


/* ------------------------------ 用户特殊要求（User/<owner>/，v1.10.0） ------------------------------ */

/** 插件根目录（User/ 所在，运行时定位到实际装载副本） */
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // lib/.. → 插件根

/**
 * 从 remote URL 提取 GitHub owner（EIGHTfs/x.git → EIGHTfs）；无 remote 返回 ''。
 */
export function ownerFromRemote(remote = '') {
  const m = remote.match(/(?:github\.com[:/]|git@)([\w.-]+)\/([\w.-]+)(?:\.git)?$/);
  return m ? m[1] : '';
}

/**
 * 读取插件 User/<owner>/ 下所有 .md 的「要求清单」（编号条目）。
 * @returns {{ user: string, found: boolean, files: Array<{file, items: string[]}>, dir: string }}
 */
export function loadUserRequirements({ repoPath = '', owner = '' } = {}) {
  const remote = repoPath ? runGit(['remote', 'get-url', 'origin'], repoPath).stdout || '' : '';
  const user = owner || ownerFromRemote(remote) || 'EIGHTfs';
  const dir = join(PLUGIN_ROOT, 'User', user);
  const files = [];
  if (existsSync(dir)) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
      const content = readFileSync(join(dir, ent.name), 'utf8');
      const items = [];
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*\d+[.、]\s+(.+)$/);
        if (m) items.push(m[1].trim());
      }
      if (items.length) files.push({ file: ent.name, items });
    }
  }
  return { user, found: files.length > 0, files, dir };
}

/**
 * v1.13.0 远端 clone（默认走 api.github.com）：GitHub tarball 下载 → /tmp 中转 git init →
 * 整拷回 dest。CIFS 卷上 `git init` 会 chmod EPERM（实测），必须在 /tmp 可写卷建仓再整拷。
 * target 支持 owner/repo、https://github.com/o/r.git、git@github.com:o/r.git、ssh://git@ssh.github.com:443/o/r.git。
 * @returns {{ ok, owner, repo, branch, commitSha, dest, method: 'api', defaultBranch?, error? }}
 */
export async function cloneViaApi({ target, dest = '', branch = '', token = '', workspaceRoot = '' } = {}) {
  const GH = 'https://api.github.com';
  if (!token) return { ok: false, error: '缺少 GitHub token（可用 resolveGitToken 多源探测）' };
  const t = (target || '').trim();
  let pr = null;
  if (/^https?:\/\//.test(t) || /^git@/.test(t) || /^ssh:\/\//.test(t)) pr = parseGithubOwnerRepo(t);
  if (!pr) {
    const m = t.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (m) pr = { owner: m[1], repo: m[2] };
  }
  if (!pr) return { ok: false, error: `无法解析 target 为 owner/repo: ${t || '(空)'}` };
  const { owner, repo } = pr;
  const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-git-push' };

  // 1. 默认分支探测（分支免疫：GitHub 默认分支可能是 master 或 main）
  let defaultBranch = '';
  try {
    const metaRes = await fetch(`${GH}/repos/${owner}/${repo}`, { headers: H, signal: AbortSignal.timeout(30_000) });
    if (metaRes.ok) {
      const meta = await metaRes.json();
      defaultBranch = meta.default_branch || '';
    }
  } catch { /* 探测失败回退 */ }
  const branchName = branch || defaultBranch || 'master';

  // 2. 下载 tarball（api.github.com，302 → codeload.github.com；带 token 可下私有库）
  const tarRes = await fetch(`${GH}/repos/${owner}/${repo}/tarball/${encodeURIComponent(branchName)}`, {
    headers: H,
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
  });
  if (!tarRes.ok) {
    const body = await tarRes.text().catch(() => '');
    return { ok: false, error: `下载 tarball 失败 HTTP ${tarRes.status}: ${body.slice(0, 160)}` };
  }
  const buf = Buffer.from(await tarRes.arrayBuffer());

  // 3. /tmp 中转建仓（CIFS git init chmod EPERM，必须 /tmp 可写卷）
  const tmpRoot = mkdtempSync(join('/tmp', 'dsh-clone-'));
  try {
    const tgzPath = join(tmpRoot, 'repo.tgz');
    writeFileSync(tgzPath, buf);
    const extractDir = join(tmpRoot, 'x');
    mkdirSync(extractDir, { recursive: true });
    const tar = spawnSync('tar', ['-xzf', tgzPath, '-C', extractDir], { encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'ignore'] });
    if (tar.status !== 0) return { ok: false, error: `解压 tarball 失败: ${tar.stderr || tar.status}` };
    const top = readdirSync(extractDir)[0];
    const srcDir = top ? join(extractDir, top) : extractDir;

    // 4. 建干净仓库 + 设分支名（symbolic-ref 兼容任意 git 版本）
    const gitDir = join(tmpRoot, 'repo');
    const ini = spawnSync('git', ['init', gitDir], { encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'ignore'] });
    if (ini.status !== 0) return { ok: false, error: `git init 失败: ${ini.stderr || ini.status}` };
    const sr = spawnSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${branchName}`], { cwd: gitDir, encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'ignore'] });
    if (sr.status !== 0) return { ok: false, error: `设置分支 ${branchName} 失败: ${sr.stderr || sr.status}` };
    const cp = spawnSync('cp', ['-a', srcDir + '/.', gitDir + '/'], { encoding: 'utf8', timeout: 120_000 });
    if (cp.status !== 0) return { ok: false, error: `拷贝文件失败: ${cp.stderr || cp.status}` };

    // 5. 本地 commit（identity 用 owner，与远端一致）
    const add = runGit(['add', '-A'], gitDir);
    if (add.status !== 0) return { ok: false, error: `git add 失败: ${add.stderr}` };
    const cm = runGit(
      ['-c', `user.name=${owner}`, '-c', `user.email=${owner}@users.noreply.github.com`, 'commit', '-m', `clone of ${owner}/${repo} @ ${branchName} (api.github.com)`, '--allow-empty'],
      gitDir
    );
    if (cm.status !== 0) return { ok: false, error: `git commit 失败: ${cm.stderr}` };
    const commitSha = runGit(['rev-parse', 'HEAD'], gitDir).stdout;

    // 6. 写 origin（走 pushViaApi 时按此解析 owner/repo）
    runGit(['remote', 'add', 'origin', `https://github.com/${owner}/${repo}.git`], gitDir);

    // 7. 整拷回 dest（预先校验非空目录，防误覆盖）
    const destPath = dest || join(workspaceRoot || '/vol1/@appshare/DeepSeekHarness/workspace', repo);
    if (existsSync(destPath) && readdirSync(destPath).length > 0) {
      return { ok: false, error: `目标目录已存在且非空: ${destPath}` };
    }
    mkdirSync(destPath, { recursive: true });
    const cp2 = spawnSync('cp', ['-a', gitDir + '/.', destPath + '/'], { encoding: 'utf8', timeout: 120_000 });
    if (cp2.status !== 0) return { ok: false, error: `拷贝到目标失败: ${cp2.stderr || cp2.status}` };

    return { ok: true, owner, repo, branch: branchName, commitSha, dest: destPath, method: 'api', defaultBranch: defaultBranch || branchName };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
