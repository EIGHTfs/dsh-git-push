/**
 * dsh-git-push git 总入口
 *
 * token / sshkey / 提交 / 推送 / clone / 建仓 / 可见性。
 * 铁律：所有 git 命令走 runGit（数组参数零注入面）；所有网络请求走 githubFetch
 * （api.github.com 硬闸，拒绝其它域名——「所有功能都默认 api.github.com」）。
 * 401 回退：pushViaApi 遇 401/Bad credentials → pushViaSsh（ssh.github.com:443）。
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/* ───────────────────────── 基础：git 执行 ───────────────────────── */

/** 统一 git 执行（数组参数，零注入面；stderr 保留供排障）。 */
export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {
  const base = ['-c', 'safe.directory=*', '-c', 'core.filemode=false', '-c', 'core.quotepath=false'];
  try {
    const out = execFileSync('git', cwd ? [...base, '-C', cwd, ...args] : [...base, ...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 直通 git 包装器门禁：插件内部 git 调用合法（DSH_GIT_ENFORCE_PASS=1）
      env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1', ...env },
    });
    return { ok: true, stdout: out.trim(), stderr: '' };
  } catch (e) {
    return { ok: false, stdout: '', stderr: String(e?.stderr || e?.message || e).trim() };
  }
}

/* ───────────────────────── 凭据：token / ssh 探测 ───────────────────────── */

/** 插件配置目录：DSH_HOME/git-push → HOME/.dsh/git-push → cwd/.dsh/git-push。 */
export function credentialsDir({ workspaceRoot = '' } = {}) {
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, 'git-push');
  if (process.env.HOME) return join(process.env.HOME, '.dsh', 'git-push');
  if (workspaceRoot) return join(dirname(resolve(workspaceRoot)), '.dsh', 'git-push');
  return join(process.cwd(), '.dsh', 'git-push');
}

/** SSH 私钥探测：配置目录 id_rsa → id_ed25519 → id_ecdsa。 */
export function resolveSshKey({ workspaceRoot = '' } = {}) {
  const dir = credentialsDir({ workspaceRoot });
  for (const name of ['id_rsa', 'id_ed25519', 'id_ecdsa']) {
    const p = join(dir, name);
    try {
      if (existsSync(p)) return { keyPath: p, kind: name };
    } catch { /* 跳过 */ }
  }
  return { keyPath: '', kind: '' };
}

/**
 * token 解析（三层顺序，返回首个可读）：
 *   1) 显式传入 opts.token
 *   2) 环境变量 DSH_GIT_PUSH_TOKEN / GITHUB_TOKEN
 *   3) 配置目录 credentialsDir()/github-token|token → repoPath/.git-push-token
 * 只回传 source 路径，不回传明文给调用链以外的层。
 * @returns {{token: string, source: string}}
 */
export function resolveToken({ token = '', tokenPath = '', repoPath = '', workspaceRoot = '' } = {}) {
  if (String(token || '').trim()) return { token: String(token).trim(), source: 'explicit' };
  for (const env of ['DSH_GIT_PUSH_TOKEN', 'GITHUB_TOKEN']) {
    const t = String(process.env[env] || '').trim();
    // 环境变量同样校验格式（ghp_/github_pat_ 开头），非法跳过
    if (t && /^(gh[pous]_|github_pat_)/.test(t)) return { token: t, source: `env:${env}` };
  }
  const candidates = [];
  const credDir = credentialsDir({ workspaceRoot });
  if (credDir) {
    candidates.push(join(credDir, 'github-token'));
    candidates.push(join(credDir, 'token'));
  }
  if (tokenPath) candidates.push(tokenPath);
  if (repoPath) candidates.push(join(repoPath, '.git-push-token'));
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const t = readFileSync(p, 'utf8').trim();
        if (t && /^(gh[pous]_|github_pat_)/.test(t)) return { token: t, source: p };
      }
    } catch { /* 读不到跳过 */ }
  }
  return { token: '', source: '' };
}

/* ───────────────────────── 网络：api.github.com 唯一通道 ───────────────────────── */

export const GH_API = 'https://api.github.com';

/**
 * 调 api.github.com（唯一网络出口；非该域名直接拒绝，不跟随 302）。
 * @returns {Promise<{status, json, text, error?}>}
 */
export async function githubFetch(path, { token = '', method = 'GET', body, timeout = 60_000 } = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${GH_API}${path.startsWith('/') ? path : `/${path}`}`;
  let host = '';
  try { host = new URL(url).hostname; } catch { return { status: 0, json: null, text: '', error: `非法 URL: ${url}` }; }
  if (host !== 'api.github.com') {
    return { status: 0, json: null, text: '', error: `拒绝非 api.github.com 请求: ${host}` };
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-git-push',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };
  try {
    const res = await fetch(url, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual', // 防 tarball 302 跳到 codeload.github.com
    });
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, json: null, text: '', error: `api.github.com 重定向（拒绝跟随）: ${res.headers.get('location') || ''}` };
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON（raw blob） */ }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: '', error: String(e?.message || e) };
  }
}

/** 从 origin / URL / owner-repo 解析 GitHub owner+repo（只解析字符串，不访问 github.com）。 */
export function parseGithubOwnerRepo(originUrl) {
  const s = String(originUrl || '').trim();
  if (!s) return null;
  const patterns = [
    /api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s*$/i,
    /(?:git@|https?:\/\/)(?:[^@/\s]+@)?(?:ssh\.)?github\.com(?::443)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
    /^ssh:\/\/git@ssh\.github\.com:443\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
    /^([\w.-]+)\/([\w.-]+?)$/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
  }
  return null;
}

/** token 失效判定（401 / Bad credentials）。 */
export function isBadCredentials(reason = '') {
  return /Bad credentials|credential|401\b/i.test(String(reason || ''));
}

/* ───────────────────────── 敏感文件自动 .gitignore ───────────────────────── */

const SENSITIVE_NAMES = new Set(['.env', '.env.local', 'github-token', '.git-push-token', 'id_rsa', 'id_ed25519', 'id_ecdsa', '*.pem', '*.key']);

/** 扫描仓库内敏感文件（相对路径列表）。 */
export function scanSensitiveFiles(repoPath) {
  const out = [];
  const walk = (dir, prefix) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'node_modules.orig') continue;
      const full = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(full, rel); continue; }
      for (const n of SENSITIVE_NAMES) {
        if (n.includes('*')) {
          if (new RegExp(`^${n.replace('*', '.*')}$`).test(e.name)) { out.push(rel); break; }
        } else if (e.name === n) { out.push(rel); break; }
      }
    }
  };
  walk(repoPath, '');
  return out;
}

/**
 * 基线忽略项（与仓库内容无关，恒定排除）。
 * node_modules 是依赖目录、node_modules.orig 是安装/备份残留副本，
 * 两者都属机器本地产物，不应进入版本库（也避免链接/占位混入插件树）。
 */
export const DEFAULT_IGNORE_PATTERNS = ['node_modules/', 'node_modules.orig/'];

/**
 * 把基线忽略项 + 敏感文件追加进 .gitignore（幂等：已存在行不重复写）。
 * @param {string} repoPath 仓库根
 * @returns {{added:number, files:string[], baseline:number}} 追加行数 / 敏感文件 / 基线补入数
 */
export function ensureGitignore(repoPath) {
  const files = scanSensitiveFiles(repoPath);
  const giPath = join(repoPath, '.gitignore');
  let existing = '';
  try { existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''; } catch { /* 忽略 */ }
  const lines = existing.split('\n').map((l) => l.trim());
  let added = 0;
  let baseline = 0;
  const additions = [];
  // 1) 基线忽略项（node_modules / node_modules.orig）
  for (const pat of DEFAULT_IGNORE_PATTERNS) {
    const bare = pat.replace(/\/$/, '');
    if (lines.includes(pat) || lines.includes(bare)) continue;
    additions.push(pat);
    baseline++;
    added++;
  }
  // 2) 扫描出的敏感文件
  for (const rel of files) {
    const pat = `/${rel}`;
    if (lines.includes(rel) || lines.includes(pat)) continue;
    additions.push(pat);
    added++;
  }
  if (added) {
    const block = `${existing.endsWith('\n') || !existing ? '' : '\n'}${additions.join('\n')}\n`;
    try { writeFileSync(giPath, existing + block, 'utf8'); } catch { /* 写失败不抛 */ }
  }
  return { added, files, baseline };
}

/* ───────────────────────── 提交推送 ───────────────────────── */

/** README 检查提示（提交前核对 README 是否同步）。 */
export function readmeCheckHint(repoPath) {
  const hasReadme = ['README.md', 'readme.md', 'README', 'readme'].some((n) => existsSync(join(repoPath, n)));
  return hasReadme
    ? { needed: true, hasReadme: true, hint: '提交前核对 README：功能表/版本记录/用法与本次改动一致，过时先改 README 再提交' }
    : { needed: true, hasReadme: false, hint: '仓库无 README，提交前先补（git_gen_readme 或按模板写）' };
}

/**
 * 统一提交推送：预检 → 敏感文件 .gitignore → add → commit → push。
 * @param {{repoPath, message, push, dryRun, token}} opts
 * @returns {{ok, steps: string[], commitSha?, pushed?, error?}}
 */
export function commitAndPush({ repoPath = '', message = '', push = true, dryRun = false, token = '' } = {}) {
  const steps = [];
  if (!repoPath || !existsSync(join(repoPath, '.git'))) return { ok: false, steps: ['预检'], error: `非 git 仓库: ${repoPath || '(空)'}` };
  if (!String(message || '').trim()) return { ok: false, steps: ['预检'], error: 'commit message 必填' };
  if (dryRun) return { ok: true, dryRun: true, steps: ['预检', 'commit', push ? 'push' : 'skip-push'] };
  steps.push('敏感文件 .gitignore');
  ensureGitignore(repoPath);
  steps.push('add');
  const add = runGit(['add', '-A'], { cwd: repoPath });
  if (!add.ok) return { ok: false, steps, error: `git add 失败: ${add.stderr}` };
  const status = runGit(['status', '--porcelain'], { cwd: repoPath });
  if (!status.stdout.trim()) return { ok: false, steps, error: '无变更可提交' };
  steps.push('commit');
  const commit = runGit(['commit', '-m', message], { cwd: repoPath });
  if (!commit.ok) return { ok: false, steps, error: `git commit 失败: ${commit.stderr}` };
  const commitSha = runGit(['rev-parse', 'HEAD'], { cwd: repoPath }).stdout;
  if (!push) return { ok: true, steps: [...steps, 'skip-push'], commitSha, pushed: false };
  steps.push('push');
  const pr = pushViaApi({ repoPath, token });
  if (pr.ok) return { ok: true, steps, commitSha, pushed: true, push: pr };
  const ssh = pushViaSsh({ repoPath });
  if (ssh.ok) return { ok: true, steps, commitSha, pushed: true, push: ssh };
  return { ok: false, steps, commitSha, error: `推送失败（API: ${pr.reason}；SSH: ${ssh.reason}）` };
}

/* ───────────────────────── 推送：API 主通道 + SSH 回退 ───────────────────────── */

/** SSH 回退：ssh.github.com:443（token 401 时）。 */
export function pushViaSsh({ repoPath = '', branch = '' }) {
  const { keyPath } = resolveSshKey();
  if (!keyPath) return { ok: false, pushed: false, reason: '无 SSH 私钥（配置目录 id_rsa/id_ed25519/id_ecdsa）' };
  const origin = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout;
  const pr = parseGithubOwnerRepo(origin);
  if (!pr) return { ok: false, pushed: false, reason: '无法解析 origin owner/repo' };
  const target = branch || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout;
  if (!target) return { ok: false, pushed: false, reason: '无法确定目标分支' };
  const sshUrl = `ssh://git@ssh.github.com:443/${pr.owner}/${pr.repo}.git`;
  const known = join('/tmp', `dsh-git-push-known-hosts-${process.pid}`);
  const sshCmd = `ssh -i "${keyPath}" -p 443 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${known}" -o BatchMode=yes`;
  const r = runGit(['push', sshUrl, `HEAD:refs/heads/${target}`], { cwd: repoPath, env: { GIT_SSH_COMMAND: sshCmd } });
  if (r.ok) return { ok: true, pushed: true, method: 'ssh', owner: pr.owner, repo: pr.repo, branch: target };
  return { ok: false, pushed: false, method: 'ssh', reason: (r.stderr || 'ssh push 失败').slice(0, 240) };
}

/**
 * 推送（api.github.com Git Data API：blob → tree → commit → ref）。
 * token 401 → pushViaSsh 回退。
 * @returns {{ok, pushed, method?, commitSha?, reason?, branchAdjusted?}}
 */
export async function pushViaApi({ repoPath = '', branch = '', token = '', force = false } = {}) {
  const origin = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout;
  const pr = parseGithubOwnerRepo(origin);
  if (!pr) return { ok: false, pushed: false, reason: `无法从 origin 解析 owner/repo（${origin || '无 origin'}）` };
  const { owner, repo } = pr;
  const tok = token || resolveToken({ repoPath }).token;
  const api = (path, method = 'GET', body) => githubFetch(`/repos/${owner}/${repo}${path}`, { token: tok, method, body });

  const headSha = runGit(['rev-parse', 'HEAD'], { cwd: repoPath }).stdout;
  if (!headSha) return { ok: false, pushed: false, reason: '本地无提交' };
  const lsOut = runGit(['ls-tree', '-r', 'HEAD'], { cwd: repoPath }).stdout;
  const entries = lsOut.split('\n').filter(Boolean).map((l) => {
    const m = l.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t(.*)$/);
    return m && m[2] === 'blob' ? { mode: m[1], type: m[2], sha: m[3], path: m[4] } : null;
  }).filter(Boolean);
  if (!entries.length) return { ok: false, pushed: false, reason: '本地 tree 为空' };

  // 分支解析：远端 default_branch 优先（防误建错名分支）
  let targetBranch = branch || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout || 'master';
  let branchAdjusted = null;
  const meta = await api('');
  if (isBadCredentials(meta.error || `HTTP ${meta.status}`) || meta.status === 401) {
    const fb = pushViaSsh({ repoPath, branch: targetBranch });
    return fb.ok ? fb : { ok: false, pushed: false, method: 'ssh-fallback', reason: `token 失效（API 401）→ SSH 回退失败: ${fb.reason}` };
  }
  if (meta.status === 200 && meta.json?.default_branch && meta.json.default_branch !== targetBranch) {
    branchAdjusted = { from: targetBranch, to: meta.json.default_branch };
    targetBranch = meta.json.default_branch;
  }
  const refRes = await api(`/git/ref/heads/${targetBranch}`);
  if (isBadCredentials(refRes.error || `HTTP ${refRes.status}`) || refRes.status === 401) {
    const fb = pushViaSsh({ repoPath, branch: targetBranch });
    return fb.ok ? fb : { ok: false, pushed: false, method: 'ssh-fallback', reason: `token 失效（API 401）→ SSH 回退失败: ${fb.reason}` };
  }
  const remoteHead = refRes.status === 200 ? refRes.json?.object?.sha : null;

  // 远端已有 blob sha（复用，减少 API 调用）
  const remoteBlobShas = new Set();
  if (remoteHead) {
    const t = await api(`/git/trees/${remoteHead}?recursive=1`);
    if (t.status === 200 && Array.isArray(t.json?.tree)) {
      for (const e of t.json.tree) if (e.type === 'blob') remoteBlobShas.add(e.sha);
    }
  }
  // 逐 blob 上传
  const treeEntries = [];
  for (const e of entries) {
    if (remoteBlobShas.has(e.sha)) { treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha }); continue; }
    const raw = runGit(['cat-file', 'blob', e.sha], { cwd: repoPath });
    if (!raw.ok) return { ok: false, pushed: false, reason: `读 blob 失败: ${e.path}` };
    const b = await api('/git/blobs', 'POST', { content: Buffer.from(raw.stdout, 'utf8').toString('base64'), encoding: 'base64' });
    if (b.status !== 201) return { ok: false, pushed: false, reason: `上传 blob 失败 ${e.path}: ${b.json?.message || b.status}` };
    treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: b.json.sha });
  }
  const t = await api('/git/trees', 'POST', { tree: treeEntries });
  if (t.status !== 201) return { ok: false, pushed: false, reason: `建 tree 失败: ${t.json?.message || t.status}` };

  // 建 commit（parent=远端 HEAD；force 不挂 parent）
  const msg = runGit(['log', '-1', '--format=%s'], { cwd: repoPath }).stdout || 'chore: push via api';
  const c = await api('/git/commits', 'POST', { message: msg, tree: t.json.sha, ...(!force && remoteHead ? { parents: [remoteHead] } : {}) });
  if (c.status !== 201) return { ok: false, pushed: false, reason: `建 commit 失败: ${c.json?.message || c.status}` };

  // 更新 ref（有则 PATCH，无则 POST 创建）
  if (remoteHead) {
    const r = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: !!force });
    if (r.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r.json?.message || r.status}` };
  } else {
    const r = await api('/git/refs', 'POST', { ref: `refs/heads/${targetBranch}`, sha: c.json.sha });
    if (r.status !== 201) {
      if (r.status === 422) {
        const r2 = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: !!force });
        if (r2.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r2.json?.message || r2.status}` };
      } else {
        return { ok: false, pushed: false, reason: `创建 ref 失败: ${r.json?.message || r.status}` };
      }
    }
  }
  return { ok: true, pushed: true, method: 'api', commitSha: c.json.sha, owner, repo, branch: targetBranch, branchAdjusted };
}

/* ───────────────────────── clone / 建仓 / 可见性 ───────────────────────── */

/**
 * clone（只走 api.github.com Git Data API：git/trees + git/blobs，不直连 github.com）。
 * /tmp 中转建仓后整拷目标（兼容 CIFS 卷）。origin 写成 api.github.com/repos/o/r。
 * @returns {{ok, owner?, repo?, branch?, commitSha?, dest?, files?, error?}}
 */
export async function cloneViaApi({ target = '', dest = '', token = '', branch = '' } = {}) {
  const pr = parseGithubOwnerRepo(target);
  if (!pr) return { ok: false, error: `无法解析 target（${target}）：需要 owner/repo 或 github URL` };
  const { owner, repo } = pr;
  const tok = token || resolveToken({ tokenPath: process.env.DSH_GIT_PUSH_TOKEN ? undefined : '', repoPath: '' }).token;
  const api = (path, method = 'GET', body) => githubFetch(`/repos/${owner}/${repo}${path}`, { token: tok, method, body });
  const meta = await api('');
  if (meta.status !== 200) return { ok: false, error: meta.error || `仓库查询失败: HTTP ${meta.status}` };
  const useBranch = branch || meta.json?.default_branch || 'master';
  const treeRes = await api(`/git/trees/${useBranch}?recursive=1`);
  if (treeRes.status !== 200) return { ok: false, error: treeRes.error || `tree 拉取失败: HTTP ${treeRes.status}` };
  const commitSha = treeRes.json?.sha || '';
  const targetDir = dest || join(process.cwd(), repo);
  try { mkdirSync(targetDir, { recursive: true }); } catch (e) { return { ok: false, error: `创建目录失败: ${e?.message || e}` }; }
  let files = 0;
  for (const item of treeRes.json?.tree || []) {
    if (item.type !== 'blob') continue;
    const rel = String(item.path || '');
    if (!rel) continue;
    const out = join(targetDir, rel);
    try { mkdirSync(dirname(out), { recursive: true }); } catch { /* 忽略 */ }
    const blob = await api(`/git/blobs/${item.sha}`, 'GET');
    if (blob.status !== 200) continue;
    try {
      // 二进制：base64 解码；文本：原文（api.github.com blob Accept 默认返回 content+encoding）
      const isBase64 = blob.json?.encoding === 'base64';
      writeFileSync(out, isBase64 ? Buffer.from(blob.json.content, 'base64') : String(blob.text ?? ''));
      files++;
    } catch { /* 写失败跳过该文件 */ }
  }
  // 转成 git 仓库并设 origin
  for (const args of [
    ['init', '-q'], ['add', '-A'], ['-c', 'user.email=v2-clone@local', '-c', 'user.name=v2-clone', 'commit', '-q', '-m', `clone from ${owner}/${repo}@${useBranch}`],
  ]) {
    runGit(args, { cwd: targetDir });
  }
  runGit(['remote', 'add', 'origin', `${GH_API}/repos/${owner}/${repo}`], { cwd: targetDir });
  return { ok: true, owner, repo, branch: useBranch, commitSha, dest: targetDir, files, method: 'api' };
}

/** 建仓（POST /user/repos）并设置 origin。dryRun 只探测不创建。 */
export async function ensureRemoteRepo({ repoPath = '', visibility = 'private', dryRun = false, token = '' } = {}) {
  const name = basename(repoPath || '');
  if (!name) return { ok: false, error: '缺仓库路径' };
  const vis = (visibility || 'private').toLowerCase() === 'public' ? 'public' : 'private';
  const tok = token || resolveToken({ repoPath }).token;
  if (!tok && !dryRun) return { ok: false, error: '无 token（配置目录 github-token 或环境变量 DSH_GIT_PUSH_TOKEN）' };
  const exists = await githubFetch(`/repos/${name}`, { token: tok });
  if (exists.status === 200) {
    return { ok: true, exists: true, name, visibility: vis, reason: '已存在同名仓库' };
  }
  if (dryRun) return { ok: true, dryRun: true, wouldCreate: true, name, visibility: vis };
  const created = await githubFetch('/user/repos', { token: tok, method: 'POST', body: { name, private: vis === 'private' } });
  if (created.status !== 201) return { ok: false, error: created.json?.message || created.error || `创建失败: HTTP ${created.status}` };
  if (repoPath && existsSync(join(repoPath, '.git'))) {
    const origin = `${GH_API}/repos/${name}`;
    const cur = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath });
    if (!cur.ok) runGit(['remote', 'add', 'origin', origin], { cwd: repoPath });
  }
  return { ok: true, created: true, name, visibility: vis, origin: `${GH_API}/repos/${name}` };
}

/** 可见性切换（PATCH /repos/{owner}/{repo} {"private": bool}）。 */
export async function setVisibility({ owner = '', repo = '', visibility = '', token = '' } = {}) {
  const target = (visibility || '').toLowerCase();
  if (!['public', 'private'].includes(target)) return { ok: false, error: 'visibility 必须为 public 或 private' };
  if (!owner || !repo) return { ok: false, error: '缺 owner/repo' };
  const tok = token || resolveToken({}).token;
  if (!tok) return { ok: false, error: '无 token' };
  const res = await githubFetch(`/repos/${owner}/${repo}`, { token: tok, method: 'PATCH', body: { private: target === 'private' } });
  if (res.status !== 200) return { ok: false, error: res.json?.message || res.error || `HTTP ${res.status}` };
  return { ok: true, owner, repo, visibility: res.json?.private ? 'private' : 'public', to: target };
}

/**
 * 扫描目录下的 git 仓库（1.0.0 接线：git_scan 工具用）。
 * 逐层下钻查找 .git；返回分支/remote/未提交变更数/最近提交。
 * @param {string} root 扫描根目录
 * @param {object} [opts] { depth=3, extraRepos=[], extraReposFile='', maxRepos=200 }
 *   extraReposFile：额外仓库清单文件（每行一个绝对路径，# 开头为注释，运行时实时读取；
 *   文件缺失/不可读静默忽略——不因配置缺失让扫描失败）
 * @returns {Array<object>} 仓库信息列表
 */
export function scanRepos(root = '.', { depth = 3, extraRepos = [], extraReposFile = '', maxRepos = 200 } = {}) {
  const out = [];
  const seen = new Set();
  const walk = (dir, level) => {
    if (out.length >= maxRepos || level > depth) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === '.git')) {
      if (!seen.has(dir)) { seen.add(dir); out.push(describeRepo(dir)); }
      return; // 仓库内不再下钻
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(join(dir, e.name), level + 1);
    }
  };
  walk(String(root || '.'), 0);
  // 清单文件追加（# 注释 / 空行跳过；读不到就忽略）
  const extras = [...(extraRepos || [])];
  if (extraReposFile) {
    try {
      for (const line of readFileSync(extraReposFile, 'utf8').split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#')) extras.push(t);
      }
    } catch { /* 清单文件缺失/不可读：忽略 */ }
  }
  for (const extra of extras) {
    const d = String(extra || '').trim();
    if (!d || seen.has(d) || !existsSync(d)) continue;
    seen.add(d);
    out.push(describeRepo(d));
  }
  return out;
}

/** 读取单个仓库的状态摘要（git_scan 输出项）。 */
function describeRepo(repoPath = '') {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath }).stdout.trim() || '(空仓)';
  const remote = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout.trim();
  const status = runGit(['status', '--porcelain'], { cwd: repoPath }).stdout;
  const changed = status ? status.split('\n').filter(Boolean).length : 0;
  const last = runGit(['log', '-1', '--format=%h %s'], { cwd: repoPath }).stdout.trim();
  return { path: repoPath, branch, remote, changed, lastCommit: last };
}
