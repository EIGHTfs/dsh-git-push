/**
 * dsh-git-push — git 核心逻辑（纯函数，可独立单测，不依赖 ctx）
 *
 * 2026-09-02：GitHub 网络操作默认走 api.github.com（Git Data API / REST）。
 * 禁止 git clone/push/fetch 直连 github.com、raw.githubusercontent.com、
 * codeload.github.com。v1.18.3：token 无效（401 Bad credentials）时允许回退
 * ssh.github.com:443（本机 github.com:443 不通，SSH over 443 通）。
 * 「token无效应该能用其他方法啊」；顺序确认：先改插件回退 SSH。
 *
 * 【原代码】依赖系统 git：认证默认 HTTPS+PAT；remote 格式
 * https://<user>:<token>@github.com/<owner>/<repo>.git；SSH remote 仍兼容。
 * 关键坑（来自 git-commits-viewer 实测）：
 *   1. 每次命令带 `-c safe.directory=<cwd>`（CIFS 只读卷 doubtful ownership）
 *   2. stdio 用 pipe/ignore，防止 git 报错刷屏
 *   3. 本地分支可能是 master 而非 main —— push 前取 branch --show-current，不硬编码
 *   4. push 前 fetch + rev-list 检查 ahead/behind，远端领先时不推
 *   5. CIFS/trimafs 上可执行位不可靠：git 会把 100644↔100755 当成变更。
 *      「新功能gitpush插件会git config --global core.filemode false」
 *      AI 思路：启动时写全局；每次 git 再带 `-c core.filemode=false`（无 HOME 写权限时仍生效）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync, symlinkSync, renameSync, copyFileSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// GitHub REST / Git Data API 唯一入口。「所有功能都默认api.github.com」
// AI 思路：集中常量，所有 fetch 拼这个 origin；禁止再写 github.com 当网络目标。
export const GH_API = 'https://api.github.com';

// 每次 git 命令的 -c 前缀：忽略属主（dubious ownership）+ 忽略可执行位。
// 「新功能gitpush插件会git config --global core.filemode false」
// AI 思路：CIFS 上 chmod 不持久，status 会刷一堆 mode change 100644=>100755；
// 属主噪声是「检测到可疑的仓库所有权」——cwd 精确匹配不够（软链/父目录），再加 *。
// 全局写一次给裸 git / 其它进程；这里再带 -c，插件自己的 spawn 不依赖 HOME 可写。
export function gitCFlags(cwd) {
  const flags = ['-c', 'safe.directory=*', '-c', 'core.filemode=false'];
  if (cwd) flags.push('-c', `safe.directory=${cwd}`);
  return flags;
}

/**
 * 启动时写全局 core.filemode=false。
 * 功能：NAS/CIFS 挂载上忽略文件可执行位，status/add 不再把权限噪声当变更。
 * 「新功能gitpush插件会git config --global core.filemode false」
 * AI 思路：幂等；失败只记返回值不抛（容器 HOME 只读时仍靠 gitCFlags）。
 */
export function ensureGlobalFilemodeFalse() {
  const r = spawnSync('git', ['config', '--global', 'core.filemode', 'false'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

/**
 * 启动时把全局 safe.directory=* 写上（幂等）。
 * 功能：CIFS/跨用户挂载上忽略「可疑属主」噪声，裸 git 也不再被拦。
 * 已有 * 则不重复 add。
 */
export function ensureGlobalSafeDirectoryStar() {
  const get = spawnSync('git', ['config', '--global', '--get-all', 'safe.directory'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
  });
  const values = (get.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (values.includes('*')) {
    return { ok: true, skipped: 'already-star', status: 0, stdout: '*', stderr: '' };
  }
  const r = spawnSync('git', ['config', '--global', '--add', 'safe.directory', '*'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

/** 调用 git_commit_push 时注入的 README 检查提示（提交前必须核对 README 是否要更新）。 */
export const README_CHECK_HINT = [
  '【dsh-git-push 提交前提醒】调用 git_commit_push 前必须检查该仓库 README：',
  '功能表 / 版本记录 / 用法是否与本次改动一致。需要更新则先改 README 再提交',
  '（可用 git_gen_readme 按模板生成）。不要把过时 README 推进远端。',
].join('');

/**
 * 按仓库是否有 README 生成提交时回传的检查块。
 * @param {{ hasReadme?: boolean, repoName?: string }} [opts]
 */
export function buildReadmeCheckHint({ hasReadme = true, repoName = '' } = {}) {
  const name = repoName ? `（${repoName}）` : '';
  if (!hasReadme) {
    return {
      needed: true,
      hasReadme: false,
      hint: `仓库${name}没有 README。提交前先补 README（git_gen_readme 或按同级仓模板写），再 git_commit_push。`,
    };
  }
  return { needed: true, hasReadme: true, hint: README_CHECK_HINT };
}

/**
 * 执行 git，返回 { status, stdout, stderr }。
 * v1.40.0：SSH 私钥改从插件配置目录探测（credentialsDir，原同级仓探测废除）；
 * v1.40.0：加 try/catch + maxBuffer 16MB 兜底——git 缺失（ENOENT）/输出超限不再抛出或静默截断，
 * 返回 { status: null, error } 由调用方走既有错误路径。
 */
export function runGit(args, cwd, env = {}) {
  const { keyPath } = resolveSshKey();
  const sshEnv = keyPath ? {
    GIT_SSH_COMMAND: `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`,
  } : {};
  try {
    const r = spawnSync('git', [...gitCFlags(cwd), ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'ignore'],
      // DSH_GIT_ENFORCE_PASS=1：插件内部 git 调用直通 git 包装器门禁（只拦 AI 裸 git）
      env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1', ...sshEnv, ...env },
    });
    return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), ...(r.error ? { error: String(r.error.message || r.error) } : {}) };
  } catch (e) {
    return { status: null, stdout: '', stderr: '', error: String(e?.message || e) };
  }
}

// 2026-09-02：httpsUrlOf 不再产出 github.com 网络 URL。
// 【原代码】SSH origin → HTTPS 等价 URL（https://github.com/<owner>/<repo>.git），仅用于 token 通道
// export function httpsUrlOf(originUrl) {
//   return (originUrl || '')
//     .replace(/^ssh:\/\/git@ssh\.github\.com:443\//, 'https://github.com/')
//     .replace(/^git@github\.com:/, 'https://github.com/');
// }
// 【改为】「修复此插件，使所有功能都默认api.github.com」
// 【思路】httpsUrlOf 曾给 git push HTTPS 回退用，回退已删除；改产出 api.github.com/repos/o/r
// （只作本地 origin 字符串，不发起 github.com 请求）。解析失败返回空串。
export function httpsUrlOf(originUrl) {
  const pr = parseGithubOwnerRepo(originUrl);
  return pr ? `${GH_API}/repos/${pr.owner}/${pr.repo}` : '';
}

/** 本地 origin 字符串 → api.github.com/repos/{owner}/{repo}（不发起网络请求） */
export function apiOriginOf(owner, repo) {
  return `${GH_API}/repos/${owner}/${repo}`;
}

/**
 * 从 origin / URL / owner/repo 解析 GitHub owner+repo。
 * 2026-09-02：同时认 api.github.com/repos/o/r（新默认 origin）和历史 github.com / SSH 写法
 * （只解析字符串，不访问 github.com）。
 * 【原代码】先 httpsUrlOf 归一成 https://github.com/<owner>/<repo> 再 match github.com/
 * 【改为】「所有功能都默认api.github.com」
 * 【思路】clone/create 后 origin 写成 api.github.com/repos/o/r，pushViaApi 必须能解析；
 * 存量仓库仍可能是 ssh://git@ssh.github.com:443/ 或 https://github.com/，解析兼容即可。
 */
/** SSH over HTTPS：本机 github.com:443 不通，ssh.github.com:443 通。 */
export function sshOriginOf(owner, repo) {
  return `ssh://git@ssh.github.com:443/${owner}/${repo}.git`;
}

/** API / 异常文案是否为 token 失效（401 / Bad credentials）。 */
export function isBadCredentials(reason = '') {
  return /Bad credentials|credential|401\b/i.test(String(reason || ''));
}

/**
 * token 无效时走 ssh.github.com:443。用独立 known_hosts，不写 github.com。
 * runGit 已从 User 仓注入 GIT_SSH_COMMAND（id_rsa 优先，其次 id_ed25519）。
 */
export function pushViaSsh({ repoPath, branch, owner, repo, force = false }) {
  const { keyPath } = resolveSshKey();
  if (!keyPath) {
    return { ok: false, pushed: false, reason: '无 SSH 私钥（插件配置目录 git-push/id_rsa，其次 id_ed25519）' };
  }
  const sshUrl = sshOriginOf(owner, repo);
  const target = branch || runGit(['branch', '--show-current'], repoPath).stdout;
  if (!target) return { ok: false, pushed: false, reason: '无法确定目标分支' };
  const known = join('/tmp', `dsh-git-push-known-hosts-${process.pid}`);
  const sshCmd = `ssh -i "${keyPath}" -p 443 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${known}" -o BatchMode=yes`;
  const spec = `HEAD:refs/heads/${target}`;
  const args = force ? ['push', '--force', sshUrl, spec] : ['push', sshUrl, spec];
  const r = runGit(args, repoPath, { GIT_SSH_COMMAND: sshCmd });
  if (r.status === 0) {
    return { ok: true, pushed: true, method: 'ssh', owner, repo, branch: target, force: !!force };
  }
  const err = (r.stderr || r.stdout || 'ssh push 失败').slice(0, 240);
  return { ok: false, pushed: false, method: 'ssh', reason: err };
}

export function parseGithubOwnerRepo(originUrl) {
  const s = String(originUrl || '').trim();
  if (!s) return null;
  const patterns = [
    /api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s*$/i,
    /(?:git@|https?:\/\/)(?:[^@/\s]+@)?(?:ssh\.)?github\.com(?::443)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
    /^ssh:\/\/git@ssh\.github\.com:443\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
    /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
  }
  return null;
}

/** 调 api.github.com：默认不跟随 302（防 tarball 跳到 codeload.github.com）。 */
export async function githubFetch(path, { token = '', method = 'GET', body, timeout = 60_000, headers: extraHeaders } = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${GH_API}${path.startsWith('/') ? path : `/${path}`}`;
  // 硬闸：网络目标必须是 api.github.com。「所有功能都默认api.github.com」
  // AI 思路：即使调用方误传 github.com URL 也直接拒绝，避免静默打到被阻断域名。
  let host = '';
  try { host = new URL(url).hostname; } catch { return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `非法 URL: ${url}` }; }
  if (host !== 'api.github.com') {
    return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `拒绝非 api.github.com 请求: ${host}` };
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-git-push',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(extraHeaders || {}),
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
    // 2026-09-02：不跟随 302。实测 GET /repos/o/r/tarball/ref → Location: codeload.github.com
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    return { status: res.status, json: null, text: '', buffer: Buffer.alloc(0), error: `api.github.com 返回重定向（拒绝跟随非 API 域名）: ${loc}` };
  }
  // 先读 arrayBuffer：JSON 接口 toString utf8；clone 二进制用 buffer / base64，避免 text() UTF-8 损坏
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = buffer.toString('utf8');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON（raw blob） */ }
  return { status: res.status, json, text, buffer };
}

/**
 * 探测 GitHub 仓库可见性（2026-09-02「私有库可豁免敏感扫描」）。
 * 用 token 调 GET /repos/{owner}/{repo} 的 private 字段判断。
 * 无法解析 origin / 无 token / API 失败 → 返回 unknown（保守：不豁免，照常扫描）。
 * @returns {Promise<{visibility:'private'|'public'|'unknown', owner?:string, repo?:string, reason?:string}>}
 */
export async function detectRepoVisibility({ repoPath = '', token = '' } = {}) {
  try {
    const originUrl = repoPath ? runGit(['remote', 'get-url', 'origin'], repoPath).stdout : '';
    const pr = parseGithubOwnerRepo(originUrl);
    if (!pr) return { visibility: 'unknown', reason: '无 github origin' };
    // 2026-09-02：走 githubFetch（api.github.com，不跟随 302）
    // 【原代码】fetch(`https://api.github.com/repos/${pr.owner}/${pr.repo}`, { headers: H, ... })
    // 【改为】「所有功能都默认api.github.com」
    // 【思路】统一走 githubFetch，硬闸 hostname=api.github.com
    const res = await githubFetch(`/repos/${pr.owner}/${pr.repo}`, { token, timeout: 30_000 });
    if (res.status === 200) {
      const json = res.json || {};
      return { visibility: json.private ? 'private' : 'public', owner: pr.owner, repo: pr.repo, private: !!json.private };
    }
    return { visibility: 'unknown', reason: res.error || `GitHub API ${res.status}` };
  } catch (e) {
    return { visibility: 'unknown', reason: String(e?.message || e) };
  }
}

/**
 * 切换 GitHub 仓库可见性（v1.16.0）：PATCH /repos/{owner}/{repo} {"private": bool}。
 * 支持 public ↔ private 双向切换；改 public 有敏感信息暴露风险，调用方需风险提示。
 * 无法解析 origin / 无 token / API 失败 → 返回 error。
 * @returns {Promise<{ok:boolean, owner?:string, repo?:string, visibility?:'private'|'public', from?:string, to?:string, reason?:string, error?:string}>}
 */
export async function setRepoVisibility({ repoPath = '', visibility = '', token = '' } = {}) {
  try {
    const target = (visibility || '').toLowerCase();
    if (!['public', 'private'].includes(target)) return { ok: false, error: 'visibility 必须为 public 或 private' };
    const originUrl = repoPath ? runGit(['remote', 'get-url', 'origin'], repoPath).stdout : '';
    const pr = parseGithubOwnerRepo(originUrl);
    if (!pr) return { ok: false, error: '无 github origin' };
    // 2026-09-02：PATCH 也走 githubFetch。「所有功能都默认api.github.com」
    // 【原代码】fetch(`https://api.github.com/repos/${pr.owner}/${pr.repo}`, { method:'PATCH', headers:H, body:... })
    const res = await githubFetch(`/repos/${pr.owner}/${pr.repo}`, {
      token, method: 'PATCH', body: { private: target === 'private' }, timeout: 30_000,
    });
    if (res.status === 200) {
      const json = res.json || {};
      return {
        ok: true,
        owner: pr.owner,
        repo: pr.repo,
        visibility: json.private ? 'private' : 'public',
        from: json.private ? 'private' : 'public',
        to: target,
        reason: 'OK',
      };
    }
    // 422 通常是 PATCH 失败详情（如 token 权限不足）
    const detail = res.json?.message || res.json?.errors?.[0]?.message || res.error || '';
    return { ok: false, owner: pr.owner, repo: pr.repo, reason: `GitHub API ${res.status}`, error: detail || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** 读取仓库 package.json 的 version（读不到返回 ''） */
export function readPkgVersion(repoPath) {
  try {
    const pkgPath = join(repoPath, 'package.json');
    if (!existsSync(pkgPath)) return '';
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return String(pkg.version || '').trim();
  } catch { return ''; }
}

/**
 * 自动打 tag（v1.16.0）：dsh- 前缀项目推送成功后自动打 v<version> tag，便于官方发现。
 * 版本号取 package.json version（readPkgVersion）；仓库名/目录名以 dsh- 开头才打。
 * 用 GitHub Git Data API 建 refs/tags/v<version>（指向 API 侧 commitSha，本地 sha 在 API 通道下与远端不一致）。
 * 已存在同 tag → 跳过（幂等）。
 * @returns {Promise<{ok:boolean, tag?:string, skipped?:string, reason?:string, error?:string}>}
 */
export async function autoTagDSHProject({ repoPath = '', version = '', commitSha = '', owner = '', repo = '', token = '' } = {}) {
  try {
    const repoName = repo || basename(repoPath);
    if (!/^dsh-/i.test(repoName)) return { ok: false, skipped: 'not-dsh-prefix', reason: repoName };
    const tag = 'v' + (version || readPkgVersion(repoPath) || '').replace(/^v/i, '');
    if (!tag || tag === 'v') return { ok: false, skipped: 'no-version' };
    if (!commitSha) return { ok: false, skipped: 'no-commit-sha' };
    if (!token) return { ok: false, skipped: 'no-token' };
    const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
    const pr = parseGithubOwnerRepo(originUrl);
    const o = owner || pr?.owner || '';
    const r = repo || pr?.repo || '';
    if (!o || !r) return { ok: false, skipped: 'no-origin' };
    // 2026-09-02：打 tag 走 githubFetch。「所有功能都默认api.github.com」
    // 【原代码】fetch(`https://api.github.com/repos/${o}/${r}/git/ref/tags/${tag}`, ...) + POST /git/refs
    const exists = await githubFetch(`/repos/${o}/${r}/git/ref/tags/${tag}`, { token, timeout: 30_000 });
    if (exists.status === 200) return { ok: false, skipped: 'tag-exists', tag };
    const res = await githubFetch(`/repos/${o}/${r}/git/refs`, {
      token, method: 'POST', body: { ref: `refs/tags/${tag}`, sha: commitSha }, timeout: 30_000,
    });
    if (res.status === 201) return { ok: true, tag };
    if (res.status === 422) {
      if (/already exists/i.test(res.json?.message || '')) return { ok: false, skipped: 'tag-exists', tag };
      return { ok: false, skipped: '422', tag, error: res.json?.message || res.status };
    }
    return { ok: false, skipped: String(res.status), tag, error: res.error || ('GitHub API ' + res.status) };
  } catch (e) {
    return { ok: false, skipped: 'error', error: String(e?.message || e) };
  }
}

/** 读 git 对象原始字节（binary-safe，返回 Buffer）。maxBuffer 放宽到 128MB——spawnSync 默认 1MB，
 * 超过会 status:null 截断（实测 1.1MB 的 session .zstd 日志即触发）。
 * v1.40.0（A3）：加 try/catch 兜底，git 缺失（ENOENT）等异常返回结构化错误不抛。 */
function gitRaw(args, cwd) {
  try {
    const r = spawnSync('git', [...gitCFlags(cwd), ...args], {
      cwd,
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 600_000,
      stdio: ['pipe', 'pipe', 'ignore'],
      // DSH_GIT_ENFORCE_PASS=1：插件内部 git 调用直通包装器门禁（与 runGit 一致）
      env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
    });
    return { status: r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0), ...(r.error ? { error: String(r.error.message || r.error) } : {}) };
  } catch (e) {
    return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: String(e?.message || e) };
  }
}

/**
 * v1.12.0 默认推送通道：走 api.github.com 的 Git Data API（blob → tree → commit → ref），
 * 完全不依赖 github.com 直连（本机 github.com 被网络阻断、api.github.com 可达时可用）。
 * 流程：取本地 HEAD tree → 逐 blob 上传（复用远端已有 sha 的跳过）→ 建 tree → 建 commit（parent=远端 HEAD）→ 更新 ref。
 * 返回 { ok, pushed, reason, commitSha, owner, repo }
 */
export async function pushViaApi({ repoPath, branch, token, force = false }) {
  const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
  const pr = parseGithubOwnerRepo(originUrl);
  if (!pr) return { ok: false, pushed: false, reason: `无法从 origin 解析 owner/repo（${originUrl || '无 origin'}）` };
  const { owner, repo } = pr;
  // 2026-09-02：push 内部 fetch 改走 githubFetch。「所有功能都默认api.github.com」
  // 【原代码】fetch(GH + '/repos/' + owner + '/' + repo + path, { method, headers:H, body, ... })
  // 【思路】统一 githubFetch，redirect:manual + hostname 硬闸，杜绝 302 到 github.com/codeload
  async function api(path, method = 'GET', body) {
    return githubFetch(`/repos/${owner}/${repo}${path}`, { token, method, body, timeout: 60_000 });
  }

  // 本地 HEAD
  const headSha = runGit(['rev-parse', 'HEAD'], repoPath).stdout;
  if (!headSha) return { ok: false, pushed: false, reason: '本地无提交' };

  // 本地 tree（扁平：path/mode/sha）
  // core.quotepath=false：中文/非 ASCII 文件名输出真实 UTF-8 路径（否则被转义成八进制+引号，远端 tree 会存错误路径）
  const lsOut = runGit(['-c', 'core.quotepath=false', 'ls-tree', '-r', 'HEAD'], repoPath).stdout;
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
  if (!force && remoteHead === headSha) return { ok: true, pushed: false, reason: '无新提交可推送', owner, repo, branch: targetBranch, branchAdjusted };
  // 内容级短路：API 通道每次推送会新建 API 侧 commit 对象（sha 与本地不同），
  // 因此用 tree sha 判断内容是否已一致——tree 相同即无新内容可推，避免重复 commit。
  // force=覆盖历史：即使 tree 相同也要换 commit（去掉旧 parent）。
  if (!force && remoteHead) {
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
    // 【修复 v1.26.0】空文件（0 字节）blob 内容为空：!raw.stdout.length 会误判「读失败」，
    // 导致含空文件（如占位文件 862434889@qq.com）的仓库无法走 Git Data API 推送。
    // 判据只认 cat-file 退出码：0 = 成功（空内容是合法空 blob）；非 0 才是真失败。
    if (raw.status !== 0) return { ok: false, pushed: false, reason: `读 blob 失败: ${e.path}` };
    const blobBuf = raw.stdout; // Buffer：空内容也是合法空 blob（GitHub API 接受 encoding=base64 的空串）
    const b = await api('/git/blobs', 'POST', { content: blobBuf.toString('base64'), encoding: 'base64' });
    if (b.status !== 201) return { ok: false, pushed: false, reason: `上传 blob 失败 ${e.path}: ${b.json?.message || b.status}` };
    treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: b.json.sha });
  }

  // 建 tree
  const t = await api('/git/trees', 'POST', { tree: treeEntries });
  if (t.status !== 201) return { ok: false, pushed: false, reason: `建 tree 失败: ${t.json?.message || t.status}` };

  // 建 commit。force=覆盖历史：不挂远端 parent（orphan）。普通推送 parent=远端 HEAD。
  const msg = runGit(['log', '-1', '--format=%s'], repoPath).stdout || 'chore: push via api';
  const commitBody = { message: msg, tree: t.json.sha, ...(!force && remoteHead ? { parents: [remoteHead] } : {}) };
  const c = await api('/git/commits', 'POST', commitBody);
  if (c.status !== 201) return { ok: false, pushed: false, reason: `建 commit 失败: ${c.json?.message || c.status}` };

  // 更新 ref（有则 PATCH，无则 POST 创建；POST 遇已存在 → 改 PATCH）
  // force=true：非快进也允许（重建历史覆盖远端）。
  if (remoteHead) {
    const r = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: !!force });
    if (r.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r.json?.message || r.status}` };
  } else {
    const r = await api('/git/refs', 'POST', { ref: `refs/heads/${targetBranch}`, sha: c.json.sha });
    if (r.status === 201) {
      return { ok: true, pushed: true, commitSha: c.json.sha, owner, repo, branch: targetBranch, branchAdjusted, force: !!force };
    }
    if (r.status === 422 && /already exists/i.test(r.json?.message || '')) {
      const r2 = await api(`/git/refs/heads/${targetBranch}`, 'PATCH', { sha: c.json.sha, force: !!force });
      if (r2.status !== 200) return { ok: false, pushed: false, reason: `更新 ref 失败: ${r2.json?.message || r2.status}` };
    } else {
      return { ok: false, pushed: false, reason: `创建 ref 失败: ${r.json?.message || r.status}` };
    }
  }
  return { ok: true, pushed: true, commitSha: c.json.sha, owner, repo, branch: targetBranch, branchAdjusted, force: !!force };
}

/**
 * v1.29.0：确保仓库有辅助 SSH remote（名字固定 github-ssh），支持标准 git fetch/pull。
 * origin 被插件设为 api.github.com REST 端点（git fetch 必 403），标准 git 工具链读不到远端；
 * 辅助 remote 用 ssh://git@ssh.github.com:443/<owner>/<repo>.git（本机实测 ssh.github.com:443 通，
 * github.com:22 不通）。插件推送仍走 API，不改动 origin；只补一个可 fetch 的 SSH remote。
 * 幂等：已存在同名 remote 不重复加。
 */
export function ensureAuxSshRemote(repoPath, owner, repo, result = {}) {
  const AUX = 'github-ssh';
  if (!owner || !repo) return;
  const pushSlot = result.push ?? (result.push = {});
  const url = `ssh://git@ssh.github.com:443/${owner}/${repo}.git`;
  const cur = runGit(['remote', 'get-url', AUX], repoPath);
  if (cur.status === 0 && cur.stdout.trim()) {
    if (cur.stdout.trim() !== url) {
      // 同名但指向不同 URL：不覆盖（用户可能自设过），仅记录
      pushSlot.auxRemote = `${AUX} 已存在（${cur.stdout.trim()}）`;
    } else {
      pushSlot.auxRemote = `${AUX} 已就绪`;
    }
    return;
  }
  const add = runGit(['remote', 'add', AUX, url], repoPath);
  pushSlot.auxRemote = add.status === 0
    ? `${AUX} → ${url}`
    : `${AUX} 添加失败: ${(add.stderr || '').trim().slice(0, 120)}`;
}

/**
 * 递归查找 root 下最多 depth 层的 .git 目录（排除 node_modules、.dsh）。
 * v1.40.0：execSync shell 拼接改 spawnSync 数组参数——root/depth 来自配置与 HTTP 参数，
 * 含引号/元字符时旧写法是命令注入面；数组参数零 shell，无注入。
 */
export function findGitDirs(root, depth = 3) {
  let out = '';
  try {
    const r = spawnSync('find', [String(root), '-maxdepth', String(Number(depth) || 3), '-name', '.git', '-type', 'd'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    out = r.stdout || '';
  } catch { /* find 无匹配/不可用返回空 */ }
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
  // v1.40.0：origin 内嵌凭据（https://user:token@...）一律脱敏后再出仓，防 token 进会话/日志
  const remote = maskRemoteUrl(runGit(['remote', 'get-url', 'origin'], repoPath).stdout || '');
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
 * 读取 extraRepos 配置文件（文本文件，每行一个仓库绝对路径，`#` 开头为注释，空行跳过）。
 * 运行时实时读取，修改文件后下次调用即时生效，无需重启。
 * 返回解析后的绝对路径数组（文件不存在/不可读返回空数组）。
 */
export function readExtraReposFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return [];
  try {
    const text = readFileSync(filePath, 'utf8');
    return text.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((p) => resolve(p));
  } catch {
    return [];
  }
}

/**
 * 扫描 root 下所有 git 仓库（按仓库名去重，同名只保留第一个——extracted 副本与顶层同名靠此去重）
 * extraRepos：硬编码补充（find 范围之外的仓库，如 CIFS 只读卷）
 * extraReposFile：配置文件路径（运行时实时读取），与 extraRepos 合并去重
 */
export function scanRepos({ root, depth = 3, extraRepos = [], extraReposFile = '' } = {}) {
  const found = findGitDirs(root, depth);
  const extra = [...extraRepos.map((p) => resolve(p)), ...readExtraReposFile(extraReposFile)];
  const repos = [];
  const seen = new Set();
  for (const repoPath of [...found, ...extra]) {
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

/**
 * 把用户自定义忽略 pattern（如 *.bak*）追加到 .gitignore（2026-09-07 用户需求④）。
 * 幂等：只追加缺失条目；已跟踪文件先 git rm --cached 解除跟踪（工作区文件保留），否则 .gitignore 无效。
 * @param {string} repoPath 仓库绝对路径
 * @param {string|string[]} patterns 逗号/换行分隔的 gitignore pattern，或字符串数组
 * 返回 { ok, added: string[], tracked: string[], unstaged: string[], error? }。
 */
export function ensureCustomIgnored(repoPath, patterns) {
  const list = (Array.isArray(patterns) ? patterns : String(patterns || '').split(/[\n,]/))
    .map((s) => s.trim()).filter(Boolean);
  if (!list.length) return { ok: true, added: [] };
  const giPath = join(repoPath, '.gitignore');
  let existing = '';
  if (existsSync(giPath)) { try { existing = readFileSync(giPath, 'utf8'); } catch { existing = ''; } }
  const missing = list.filter((line) => !new RegExp(`(^|\\n)${escapeRegExp(line)}(\\n|$)`).test(existing));
  if (missing.length === 0) return { ok: true, added: [] };
  const tracked = [];
  const unstaged = [];
  for (const line of missing) {
    // 已跟踪 → 先解除跟踪（git rm --cached --ignore-unmatch），否则 .gitignore 无效
    const ls = runGit(['ls-files', '--error-unmatch', '--', line], repoPath);
    if (ls.status === 0) {
      tracked.push(line);
      const rm = runGit(['rm', '--cached', '--ignore-unmatch', '--', line], repoPath);
      if (rm.status === 0) unstaged.push(line);
    }
  }
  const append = (existing.endsWith('\n') ? '' : '\n') + '# 自定义忽略（dsh-git-push 配置，2026-09-07）\n' + missing.join('\n') + '\n';
  try {
    writeFileSync(giPath, existing + append, 'utf8');
    return { ok: true, added: missing, tracked, unstaged };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), added: [], tracked, unstaged };
  }
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

/**
 * 敏感扫描注释豁免标记（2026-09-02：敏感信息可通过注释申请豁免）。
 * 写法（注释里带 dsh-skip-sensitive 即豁免，大小写不敏感）：
 *   · 文件头注释（前 3 行内）→ 整个文件跳过敏感字段扫描（如 app.js 里 password 只是
 *     API 字段名不是真凭据，可加文件头注释声明）
 *   · 行尾注释 → 只跳过该行（`password = "xxx" // dsh-skip-sensitive`）
 * 对「自动 gitignore / 审计 secret 报错」两个扫描器同时生效。
 */
export const SENSITIVE_EXEMPT_MARKER = 'dsh-skip-sensitive';
const SENSITIVE_EXEMPT_RE = /dsh-skip-sensitive/i;
/** 行内是否带豁免注释（同行出现即豁免该行） */
export function hasLineExempt(line) {
  return SENSITIVE_EXEMPT_RE.test(line);
}
/** 文件头（前 3 行）是否声明整文件豁免 */
export function hasFileHeaderExempt(text) {
  const head = String(text || '').split('\n').slice(0, 3).join('\n');
  return SENSITIVE_EXEMPT_RE.test(head);
}

/** 单行敏感字段匹配：返回字段名或 null（跳过豁免注释/示例行/占位符值） */
function sensitiveLineMatch(line) {
  if (hasLineExempt(line)) return null; // 2026-09-02：行内注释豁免
  if (SENSITIVE_EXAMPLE_CONTEXT.test(line)) return null;
  const clean = line.replace(/^[#;/\*\s]+/, ''); // 去掉行首注释标记与空白
  for (const k of SENSITIVE_KEYS) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])(?:${k.keys.map(escapeRegExp).join('|')})\\s*[:=]\\s*(.*)$`, 'i');
    const m = clean.match(re);
    if (m) {
      // 键值对值必须是「字符串字面量」才算硬编码凭据（2026-09-02 与 audit.js SECRET_PATTERNS 对齐，
      // 根因修复：`password: document.getElementById(...).value` / `cookie: opts.cookie` 这类
      // 表达式/变量引用不是硬编码凭据；`"完整 Cookie: " + cred.cookieChars` 这类文案拼接也不是。
      // 只有 `password: "xxx"` / `cookie: 'sess=...'` 这种「纯净字符串字面量」才算）
      const raw = m[1].trim();
      const qm = raw.match(/^(["'`])([\s\S]*?)\1\s*[,;)\]}\s]*$/);
      if (!qm) continue; // 非字符串字面量（变量/函数调用/表达式）→ 跳过
      let val = qm[2].trim();
      if (/\+|\$\{/.test(val)) continue; // 含字符串拼接/模板插值 = 表达式，不是单一硬编码值 → 跳过
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
        if (hasFileHeaderExempt(text)) continue; // 2026-09-02：文件头声明 dsh-skip-sensitive → 整文件豁免
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
 * @param {string} repoPath 仓库绝对路径
 * @param {{skipWrite?: boolean}} [opts] skipWrite=true → 只扫描报告（hits），不写 .gitignore、不解除跟踪（2026-09-02 私有库豁免用）
 * 返回 { ok, added: string[], hits, tracked: string[], unstaged: string[], skipped?: string }。
 */
export function ensureSensitiveIgnored(repoPath, { skipWrite = false } = {}) {
  const hits = scanSensitiveFiles(repoPath);
  const added = [];
  const tracked = [];
  const unstaged = [];
  if (hits.length && !skipWrite) {
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
  return { ok: true, added, hits, tracked, unstaged, skipped: skipWrite ? 'private-repo-exempt' : undefined };
}

/**
 * 一键提交推送：
 *   ensureNpmIgnored → git add -A → 检查变更 → git commit -m message → push 前 fetch + ahead/behind 检查 → push origin <branch>
 * 返回结构化结果；dryRun 只走扫描统计不执行写入。
 */
export async function commitAndPush({ repoPath, message, push = true, dryRun = false, requirementsConfirmed = false, workspaceRoot = '', customIgnorePatterns = '' } = {}) {
  if (!repoPath) return { ok: false, error: '缺少 repoPath' };
  if (!existsSync(join(repoPath, '.git'))) {
    return { ok: false, error: `不是 git 仓库: ${repoPath}` };
  }
  if (!message || !message.trim()) {
    return { ok: false, error: 'commit message 不能为空' };
  }

  let resultStepsHint = '';
  // 开发者要求门禁（v1.10.0 引入 / v1.40.0 改随插件内置）：要求清单不再依赖同级仓，AI 需逐条核对达标
  const userReqs = loadRequirements();
  if (userReqs.found && userReqs.items?.length) {
    if (!requirementsConfirmed) {
      return {
        ok: false,
        blocked: true,
        code: 'USER_REQUIREMENTS',
        error: '开发者特殊要求未核对：AI 需先逐条核对要求全部达标，再带 requirementsConfirmed:true 重新调用',
        requirements: userReqs,
        repo: repoPath,
      };
    }
    resultStepsHint = `已核对用户要求(${userReqs.items.length}条)`;
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

  // 自定义忽略 pattern（2026-09-07 用户需求④）：设置里配置的 *.bak* 等，提交时自动写 .gitignore
  const customIgnoreResult = dryRun ? { ok: true, added: [], skipped: 'dry-run' } : ensureCustomIgnored(repoPath, customIgnorePatterns);
  if (!customIgnoreResult.ok) {
    return { ok: false, step: 'ensureCustomIgnored', error: customIgnoreResult.error, repo: repoPath };
  }
  if (customIgnoreResult.added?.length) {
    result.steps.push(`custom-ignore(+${customIgnoreResult.added.length}条)`);
  }

  // 敏感字段扫描 + 自动 .gitignore（2026-09-01）：扫 cookie/device/username/password/token-secret，
  // 命中文件自动加进 .gitignore（已跟踪的 git rm --cached 解除跟踪）。dryRun 只扫描不写入。
  // 2026-09-02 私有库豁免（）：GitHub 可见性 = private → 只扫描报告不写 .gitignore、
  // 不解除跟踪（私有库敏感字段入库风险由仓库自身可见性兜底）；探测失败/非 GitHub origin 保守不豁免。
  let sensResult;
  if (dryRun) {
    sensResult = { ok: true, added: [], hits: scanSensitiveFiles(repoPath), tracked: [], unstaged: [], skipped: 'dry-run' };
  } else {
    let skipWrite = false;
    let visReason = '';
    try {
      const tokenInfo = resolveGitToken({ repoPath, workspaceRoot });
      const vis = await detectRepoVisibility({ repoPath, token: tokenInfo?.token || '' });
      if (vis.visibility === 'private') { skipWrite = true; visReason = `private(${vis.owner}/${vis.repo})`; }
    } catch { /* 探测失败保守不豁免 */ }
    sensResult = ensureSensitiveIgnored(repoPath, { skipWrite });
    if (skipWrite) result.sensitiveExempted = { reason: '私有库豁免（private-repo-exempt）', visibility: visReason };
  }
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
  // v1.18.1 fix：工作区干净但本地领先远端（已手动 commit 未 push）时，不能直接跳过——
  // pushViaApi 用本地 HEAD 推送，领先提交照常可推。仅当「无变更 && 无领先」才真正跳过。
  // 有领先时：跳过 commit 阶段（committed 保持 false），但继续走下方 push 块。
  let cleanSkipCommit = false;
  if (!dryRun && !porcelain.trim()) {
    cleanSkipCommit = true;
    if (!push) {
      return { ...result, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } };
    }
  }
  if (dryRun) {
    return { ...result, message: `(dry-run) 将提交: ${message}`, dryRunChanges: porcelain ? porcelain.split('\n').filter(Boolean).length : 0, push: { pushed: false, reason: 'dry-run 不推送' } };
  }

  // commit（工作区干净但领先远端时跳过——HEAD 已有未推送提交，无需新建；committed=false 如实反映未新提交）
  if (!cleanSkipCommit) {
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
  } else {
    result.steps.push('skip-commit(clean-worktree)');
  }

  // push：默认 api.github.com Git Data API。
  // v1.18.3：token 无效（401 / Bad credentials）或无 token 时回退 ssh.github.com:443。
  // 禁止 git push github.com / HTTPS。「token无效应该能用其他方法啊」
  result.push = { pushed: false, reason: 'push=false' };
  let tokenInfo = { token: '', source: '' };
  let pr = null;
  if (push) {
    const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
    // v1.36.2：push 路径改用异步真校验（跳过失效 token，避免双副本场景 Bad credentials）
    tokenInfo = await resolveValidGitToken({ repoPath, workspaceRoot });
    pr = parseGithubOwnerRepo(originUrl);
    if (!originUrl || !pr) {
      result.push = { pushed: false, reason: '无 origin，无法推送' };
    } else {
      let apiPushed = null;
      if (tokenInfo.token) {
        try {
          apiPushed = await pushViaApi({ repoPath, branch, token: tokenInfo.token });
        } catch (e) {
          apiPushed = { ok: false, pushed: false, reason: 'API 推送异常: ' + (e?.message || e) };
        }
      } else {
        apiPushed = { ok: false, pushed: false, reason: '无 GitHub token' };
      }
      if (apiPushed?.ok && apiPushed.pushed) {
        result.push = { pushed: true, pushedTo: `api.github.com/${apiPushed.owner}/${apiPushed.repo}`, ahead: null, method: 'api', commitSha: apiPushed.commitSha };
        // v1.29.0：推送成功后维护本地 remote-tracking ref（Git Data API 推送不会自动更新
        // refs/remotes/origin/*）。origin 是 api.github.com REST 端点（git fetch 必 403）。
        // 注意：Git Data API 在远端新建的 commit sha 与本地 HEAD 不同（本地无此对象，update-ref
        // 会报 nonexistent object）——推送内容与本地 HEAD tree 完全等价，故用本地 HEAD sha 写入
        // origin ref（内容等价代理），git log origin/<branch> 可看远端最新内容。
        try {
          const branchRef = apiPushed.branch || branch;
          const localHead = runGit(['rev-parse', 'HEAD'], repoPath).stdout;
          const refTarget = localHead || apiPushed.commitSha;
          const upd = runGit(['update-ref', `refs/remotes/origin/${branchRef}`, refTarget], repoPath);
          result.push.remoteRef = upd.status === 0
            ? `refs/remotes/origin/${branchRef} = ${refTarget.slice(0, 7)}`
            : `update-ref 失败: ${(upd.stderr || '').trim().slice(0, 120)}`;
        } catch (e) {
          result.push.remoteRef = `update-ref 异常: ${e?.message || e}`;
        }
        // v1.29.0：确保辅助 SSH remote 存在（支持标准 git fetch/pull；本机 ssh.github.com:443 通）
        try {
          ensureAuxSshRemote(repoPath, apiPushed.owner, apiPushed.repo, result);
        } catch (e) {
          result.push.auxRemote = `ensure-aux-remote 异常: ${e?.message || e}`;
        }
        try {
          result.autoTag = await autoTagDSHProject({ repoPath, version: readPkgVersion(repoPath), commitSha: apiPushed.commitSha, owner: apiPushed.owner, repo: apiPushed.repo, token: tokenInfo.token });
        } catch (e) {
          result.autoTag = { ok: false, skipped: 'auto-tag-error', error: String(e?.message || e) };
        }
      } else if (apiPushed?.ok && !apiPushed.pushed) {
        result.push = { pushed: false, reason: apiPushed.reason || '无新提交可推送', method: 'api' };
      } else {
        const apiReason = apiPushed?.reason || 'api.github.com 推送失败';
        const needSsh = !tokenInfo.token || isBadCredentials(apiReason);
        if (needSsh) {
          const sshPushed = pushViaSsh({ repoPath, branch, owner: pr.owner, repo: pr.repo });
          if (sshPushed.ok && sshPushed.pushed) {
            result.push = {
              pushed: true,
              pushedTo: `ssh.github.com:443/${pr.owner}/${pr.repo}`,
              method: 'ssh',
              fallbackFrom: 'api',
              apiReason,
            };
          } else {
            result.push = {
              pushed: false,
              reason: `API 失败（${apiReason}）；SSH 回退失败（${sshPushed.reason || '未知'}）`,
              method: 'ssh',
            };
          }
        } else {
          result.push = { pushed: false, reason: apiReason, method: 'api' };
        }
      }
    }
  }
  if (result.push?.pushed && pr) {
    try {
      result.remoteHeads = await fetchRemoteHeads({
        owner: pr.owner,
        repo: pr.repo,
        branch,
        token: tokenInfo?.token || '',
      });
    } catch (e) {
      result.remoteHeads = { ok: false, error: String(e?.message || e), heads: [] };
    }
  }
  if (resultStepsHint) result.steps.unshift(resultStepsHint);
  return result;
}

/**
 * 把 GitHub commits API 数组收成「短 SHA / 标题 / 时间」三条。
 * 「每次推送远端把远端库最新的3次推送heard，标题，推送时间也发给用户」
 */
export function extractRemoteHeads(json, count = 3) {
  if (!Array.isArray(json)) return [];
  return json.slice(0, count).map((c) => {
    const msg = String(c?.commit?.message || '');
    const title = msg.split(/\r?\n/)[0].trim();
    const time = c?.commit?.committer?.date || c?.commit?.author?.date || '';
    const shaFull = String(c?.sha || '');
    return { sha: shaFull.slice(0, 7), shaFull, title, time };
  });
}

/** 远端最近 3 次：Markdown 表格（「回复用表格形式」）。 */
export function formatRemoteHeadsTable(heads, { owner = '', repo = '' } = {}) {
  const list = Array.isArray(heads) ? heads : [];
  const title = owner && repo ? `远端最近 ${list.length || 3} 次（${owner}/${repo}）` : `远端最近 ${list.length || 3} 次`;
  const rows = list.length
    ? list.map((h, i) => `| ${i + 1} | \`${h.sha || ''}\` | ${(h.title || '').replace(/\|/g, '\\|')} | ${h.time || ''} |`)
    : ['| — | — | （无） | — |'];
  return [`**${title}**`, '', '| # | SHA | 标题 | 时间 |', '|---|-----|------|------|', ...rows].join('\n');
}

/**
 * 读远端当前分支最新 N 次提交（默认 3）。走 api.github.com，不跟随 302。
 */
export async function fetchRemoteHeads({ owner, repo, branch, token = '', count = 3 } = {}) {
  if (!owner || !repo) return { ok: false, error: '缺 owner/repo', heads: [] };
  const q = `sha=${encodeURIComponent(branch || '')}&per_page=${Number(count) || 3}`;
  const res = await githubFetch(`/repos/${owner}/${repo}/commits?${q}`, { token, timeout: 20_000 });
  if (res.status !== 200 || !Array.isArray(res.json)) {
    return { ok: false, error: res.error || `commits ${res.status}`, heads: [] };
  }
  return { ok: true, owner, repo, branch, heads: extractRemoteHeads(res.json, count) };
}

/**
 * 把设置页填的 GitHub token 写到同级仓 github-token（git 忽略本机文件）。
 * 不把 token 写进返回值。
 */
export function persistGithubToken(token, { workspaceRoot = '' } = {}) {
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'token 为空' };
  if (!/^(gh[pous]_|github_pat_)/.test(t)) return { ok: false, error: 'token 格式不对（需要 ghp_ / github_pat_ 开头）' };
  // v1.40.0：写入插件配置目录（credentialsDir），不再写同级仓
  const dir = credentialsDir({ workspaceRoot });
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { return { ok: false, error: `创建凭据目录失败: ${e?.message || e}` }; }
  const file = join(dir, 'github-token');
  writeFileSync(file, `${t}\n`, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* CIFS 可能改不了 mode */ }
  return { ok: true, source: file };
}

/** 设置页填的 SSH 公钥写入插件配置目录 *.pub（v1.40.0 起不再用同级仓）。 */
export function persistSshPub(pub, { workspaceRoot = '' } = {}) {
  const t = String(pub || '').trim();
  if (!t) return { ok: false, error: '公钥为空' };
  if (!/^(ssh-(ed25519|rsa|ecdsa)|ecdsa-sha2-nistp\d+)\s+\S+/.test(t)) {
    return { ok: false, error: '公钥格式不对（需要 ssh-ed25519 / ssh-rsa 开头）' };
  }
  const dir = credentialsDir({ workspaceRoot });
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { return { ok: false, error: `创建凭据目录失败: ${e?.message || e}` }; }
  const kind = t.startsWith('ssh-ed25519') ? 'id_ed25519.pub' : t.startsWith('ssh-rsa') ? 'id_rsa.pub' : 'id_ecdsa.pub';
  const file = join(dir, kind);
  writeFileSync(file, `${t}\n`, { encoding: 'utf8', mode: 0o644 });
  return { ok: true, source: file };
}

/** 是否已配置可读 token（不回传 token 值）。 */
export function githubTokenStatus({ workspaceRoot = '' } = {}) {
  const { token, source } = resolveGitToken({ workspaceRoot });
  return { configured: !!token, source: token ? source : '' };
}

/**
 * v1.29.0 需求①：按邮箱生成 SSH 密钥对（rsa 4096，-C 邮箱注释）。
 * 生成到插件配置目录（credentialsDir）：id_rsa（私钥 600）+ id_rsa.pub（公钥 644）。
 * 已存在 id_rsa 时不覆盖（除非 force=true）。返回公钥整行（供用户绑到 GitHub，也自动写入 *.pub）。
 * @param {string} email 邮箱（-C 注释）
 * @param {{workspaceRoot?:string, force?:boolean}} opts
 */
export function generateSshKey(email, { workspaceRoot = '', force = false } = {}) {
  const em = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return { ok: false, error: '邮箱格式不对（需要 x@y.z）' };
  const dir = credentialsDir({ workspaceRoot });
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { return { ok: false, error: `创建凭据目录失败: ${e?.message || e}` }; }
  const priv = join(dir, 'id_rsa');
  const pub = join(dir, 'id_rsa.pub');
  if (existsSync(priv) && !force) {
    return { ok: false, error: `私钥已存在 ${priv}（不想覆盖请先备份或传 force）` };
  }
  // force=true：先改名备份旧密钥（可恢复），再生成；ssh-keygen 对已存在文件会交互询问，不能留旧文件
  if (force) {
    const stamp = Date.now();
    for (const f of [priv, pub]) {
      try {
        if (existsSync(f)) renameSync(f, `${f}.bak-${stamp}`);
      } catch { /* 备份失败不阻断生成 */ }
    }
  }
  // ssh-keygen：-t rsa -b 4096 -C email -N ''（空口令）-f path；ssh-keygen 拒绝覆盖已存在文件
  const r = spawnSync('ssh-keygen', ['-t', 'rsa', '-b', '4096', '-C', em, '-N', '', '-f', priv], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    return { ok: false, error: `ssh-keygen 失败: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}` };
  }
  let pubLine = '';
  try { pubLine = readFileSync(pub, 'utf8').trim(); } catch { /* 下面再处理 */ }
  if (!pubLine) return { ok: false, error: '公钥文件生成后不可读' };
  try { chmodSync(priv, 0o600); chmodSync(pub, 0o644); } catch { /* CIFS */ }
  return { ok: true, email: em, privateKey: priv, pubFile: pub, pub: pubLine };
}

/**
 * 收集 dsh-git-push/skills 与同级仓 dsh-git-push-User 全部 .md（当 skill 注入）。
 * 「调用插件功能时强制要求读取 dsh-git-push-User dsh-git-push 两仓的 skill」
 * 实现参考：ai-work-archive/开发者文档/dsh-skill-mandatory.md 方案 A（插件 pre-step 注入，不改框架）。
 * 只读 .md，不读 token/密钥/cookie。
 */
export function collectRepoSkillDocs({ workspaceRoot = '', pluginRoot = PLUGIN_ROOT, maxFileBytes = 80_000, maxTotalBytes = 400_000 } = {}) {
  const files = [];
  let total = 0;
  const walk = (dir, relBase) => {
    if (!dir || !existsSync(dir) || total >= maxTotalBytes) return;
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (total >= maxTotalBytes) return;
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p, `${relBase}/${ent.name}`);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
      try {
        let text = readFileSync(p, 'utf8');
        if (text.length > maxFileBytes) text = `${text.slice(0, maxFileBytes)}\n…(truncated)`;
        total += text.length;
        files.push({ path: `${relBase}/${ent.name}`, text });
      } catch { /* 读不到跳过 */ }
    }
  };
  // v1.40.0：注入源 = 插件 skills/ + 技能仓库（原同级仓 dsh-git-push-User 已废除）
  for (const d of resolveSkillRepoDirs()) {
    if (d.walk === false) continue;
    walk(d.dir, d.base);
  }
  return files;
}

/**
 * 只收集 skill 目录与 .md 相对路径（不读内容）——「只注入 skill 目录」模式。
 * 递归全部来源目录，跳过 .git/node_modules；返回 [{ base, dir, files: [相对路径] }]。
 */
export function collectRepoSkillDirs({ workspaceRoot = '', pluginRoot = PLUGIN_ROOT } = {}) {
  const dirs = [];
  const walk = (dir, relParts, list) => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      if (ent.isDirectory()) {
        const rel = relParts.concat(ent.name);
        const files = [];
        walk(join(dir, ent.name), rel, files);
        for (const f of files) list.push(f);
        continue;
      }
      if (ent.isFile() && ent.name.endsWith('.md') && !ent.name.startsWith('.')) {
        list.push(relParts.concat(ent.name).join('/'));
      }
    }
  };
  const collect = (dir, base, { doWalk = true, loose = null } = {}) => {
    if (!dir || !existsSync(dir)) return;
    const files = [];
    if (doWalk) walk(dir, [], files);
    if (loose) {
      try {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          if (ent.isFile() && ent.name.endsWith('.md') && loose.test(ent.name)) files.push(ent.name);
        }
      } catch { /* 跳过 */ }
    }
    files.sort();
    if (files.length) dirs.push({ base, dir, files });
  };
  // v1.40.0：来源 = 插件 skills/ + 技能仓库（git-workflow 散文档只收 git-*.md，不全量递归）
  for (const d of resolveSkillRepoDirs()) {
    collect(d.dir, d.base, { doWalk: d.walk !== false, loose: d.loose || null });
  }
  return dirs;
}

/** 系统提示词里用的精简目录（v1.32.0）：不再塞整份说明书。 */
export const FUNCTION_MANUAL_COMPACT = [
  '【dsh-git-push 功能目录（精简注入）】完整说明书不注入以省 token。细节加载 skill `dsh-git-push-functions` 或读插件 `skills/dsh-git-push-functions.md`。',
  '工具：git_scan / git_commit_push / code_audit / git_gen_readme / git_remote_create / git_set_visibility / git_clone / git_rebuild_history / git_push_rules / push_permit_status / push_permit_config',
  '提交前必须核对 README（git_commit_push 返回 readmeCheck）。属主/权限噪声已忽略。审计拦截不提交。默认走 api.github.com，token 401 回退 SSH。',
].join('\n');

/**
 * 插件功能说明书注入文本（v1.28.0 全文 → v1.32.0 精简）。
 * 完整 md 仍在 skills/dsh-git-push-functions.md，按需加载；本函数只返回短目录。
 * compact=false 时仍返回全文（单测/排查用）。
 */
export function collectFunctionManual({ pluginRoot = PLUGIN_ROOT, compact = true } = {}) {
  const manualPath = join(pluginRoot, 'skills', 'dsh-git-push-functions.md');
  let text = '';
  try { text = readFileSync(manualPath, 'utf8'); } catch { /* 读不到走空 */ }
  if (compact) return FUNCTION_MANUAL_COMPACT;
  return text.trim() ? text : '';
}

/** 目录模式注入文本：只给路径 + 文件清单，正文由 AI 按需自行读取。 */
export function formatRepoSkillDirsInjection(dirs) {
  const list = Array.isArray(dirs) ? dirs.filter((d) => d.files && d.files.length) : [];
  if (!list.length) return '';
  const parts = [
    '【dsh-git-push 强制 skill 目录】调用本插件任一工具前，请先按需读取以下目录中的 skill（不全文注入，路径见下）：',
  ];
  for (const d of list) {
    parts.push('');
    parts.push('## ' + d.base + '（' + d.dir + '）');
    parts.push(d.files.map((f) => '- ' + f).join('\n'));
  }
  return parts.join('\n');
}

export function formatRepoSkillInjection(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return '';
  const parts = [
    '【dsh-git-push 强制 skill】调用本插件任一工具前必须遵守下列两仓文档（插件 agent/pre-step 注入，见开发者文档 dsh-skill-mandatory 方案 A）。',
  ];
  for (const f of list) {
    parts.push('', `## ${f.path}`, '', f.text);
  }
  return parts.join('\n');
}

function maskToken(token) {
  const t = String(token || '');
  if (t.length < 8) return t ? '****' : '';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function readSshPub({ workspaceRoot = '' } = {}) {
  const dir = credentialsDir({ workspaceRoot });
  for (const name of ['id_rsa.pub', 'id_ed25519.pub', 'id_ecdsa.pub']) {
    const file = join(dir, name);
    try {
      if (!existsSync(file)) continue;
      const pub = readFileSync(file, 'utf8').trim();
      if (!pub) continue;
      const parts = pub.split(/\s+/);
      const body = parts[1] || '';
      return { configured: true, pub, file, fingerprint: body ? `${body.slice(0, 12)}…${body.slice(-8)}` : '' };
    } catch { /* 下一把 */ }
  }
  return { configured: false, pub: '', file: '', fingerprint: '' };
}

/**
 * 用本机私钥打 ssh.github.com:443，看钥匙是否已绑到某个 GitHub 账号。
 * GET /user/keys 要 admin:public_key；只有 repo 的 token 会 404，不能据此说没绑定。
 * 成功文案：Hi <login>! You've successfully authenticated
 * 【原代码】只扫 /user/keys 列表。【改为】列表拿不到就 SSH 实测。【思路】认证成功即已绑定。
 */
export function probeSshGithubAuth({ workspaceRoot = '' } = {}) {
  const { keyPath } = resolveSshKey({ workspaceRoot });
  if (!keyPath) return { ok: false, bound: false, login: '', detail: '无 SSH 私钥' };
  const known = join('/tmp', `dsh-git-push-known-hosts-probe-${process.pid}`);
  const r = spawnSync('ssh', [
    '-i', keyPath, '-p', '443', '-T',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${known}`,
    'git@ssh.github.com',
  ], {
    encoding: 'utf8',
    timeout: 15_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
  });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const m = text.match(/Hi\s+([\w-]+)!/i);
  if (m) return { ok: true, bound: true, login: m[1], detail: `SSH 已认证为 ${m[1]}` };
  if (/Permission denied \(publickey\)/i.test(text)) {
    return { ok: true, bound: false, login: '', detail: 'SSH 公钥未绑到任何 GitHub 账号' };
  }
  return { ok: false, bound: false, login: '', detail: (text || `ssh 退出 ${r.status}`).slice(0, 180) };
}

/**
 * 检测 GitHub token / SSH 公钥是否可用，返回用户信息（不回传明文）。
 * 对照 iwara /api/account-check：多行块 + 用户名/id/主页。
 */
export async function checkGithubAccount({ workspaceRoot = '', token = '' } = {}) {
  const tok = token || resolveGitToken({ workspaceRoot }).token;
  const ssh = readSshPub({ workspaceRoot });
  const cred = {
    hasToken: !!tok,
    tokenMasked: tok ? maskToken(tok) : '',
    hasSshPub: ssh.configured,
    sshFingerprint: ssh.fingerprint,
  };
  if (!tok && !ssh.configured) {
    return { ok: true, loggedIn: false, cookieSet: false, warnLevel: 'err', cred, detail: '未配置 Token / SSH 公钥' };
  }
  if (!tok) {
    return {
      ok: true, loggedIn: false, cookieSet: true, warnLevel: 'warn', cred,
      detail: '已有 SSH 公钥，但无 Token，无法向 api.github.com 取用户信息（SSH 推送仍可能可用）',
    };
  }
  const res = await githubFetch('/user', { token: tok, timeout: 15_000 });
  if (res.status !== 200 || !res.json || !res.json.login) {
    const msg = res.json?.message || res.error || `HTTP ${res.status}`;
    return {
      ok: true, loggedIn: false, cookieSet: true, warnLevel: 'err', cred,
      detail: /Bad credentials|401/.test(String(msg)) ? 'Token 无效（Bad credentials）' : `检测失败: ${msg}`,
    };
  }
  const u = res.json;
  let sshBound = false;
  let sshBoundHow = '';
  let sshBoundLogin = '';
  if (ssh.configured && ssh.pub) {
    const keys = await githubFetch('/user/keys', { token: tok, timeout: 15_000 });
    if (Array.isArray(keys.json)) {
      const body = ssh.pub.split(/\s+/)[1] || '';
      sshBound = keys.json.some((k) => String(k.key || '').includes(body) || String(k.key || '') === ssh.pub.split(/\s+/).slice(0, 2).join(' '));
      sshBoundHow = 'keys-api';
    } else {
      // token 缺 admin:public_key 时 /user/keys 404，改 SSH 实测
      const probe = probeSshGithubAuth({ workspaceRoot });
      sshBound = !!(probe.bound && (!probe.login || probe.login.toLowerCase() === String(u.login).toLowerCase()));
      sshBoundHow = 'ssh-auth';
      sshBoundLogin = probe.login || '';
      if (probe.bound && probe.login && probe.login.toLowerCase() !== String(u.login).toLowerCase()) {
        sshBound = false;
        sshBoundHow = 'ssh-other-account';
      }
      if (!probe.ok && !probe.bound) sshBoundHow = 'ssh-probe-failed';
    }
  }
  return {
    ok: true,
    loggedIn: true,
    cookieSet: true,
    warnLevel: 'ok',
    cred: { ...cred, sshBound, sshBoundHow, sshBoundLogin },
    username: u.login,
    userId: u.id,
    name: u.name || '',
    profileUrl: u.html_url || `https://github.com/${u.login}`,
    publicRepos: u.public_repos,
    plan: u.plan?.name || '',
  };
}

export function formatGithubAccountBlock(r) {
  const L = [];
  const cred = (r && r.cred) || {};
  if (!r || !r.cookieSet) {
    L.push('❌ 未配置 Token / SSH 公钥');
  } else if (r.loggedIn) {
    L.push('✅ Token 可用');
    L.push('👤 用户名: ' + (r.username || '(未取到)'));
    if (r.name) L.push('🪪 显示名: ' + r.name);
    if (r.userId) L.push('🆔 用户 id: ' + r.userId);
    if (r.profileUrl) L.push('🔗 ' + r.profileUrl);
    if (r.plan) L.push('📦 计划: ' + r.plan);
  } else {
    L.push('❌ 不可用');
    if (r.detail) L.push(r.detail);
  }
  L.push('───');
  L.push('Token: ' + (cred.hasToken ? `✅ 有（${cred.tokenMasked}，存于本机，不回传明文）` : '❌ 无'));
  L.push('SSH 公钥: ' + (cred.hasSshPub ? `✅ 有（${cred.sshFingerprint || '已配置'}）` : '❌ 无'));
  if (cred.hasSshPub && r && r.loggedIn) {
    if (cred.sshBound) {
      const via = cred.sshBoundHow === 'ssh-auth' ? '（SSH 实测已认证）' : (cred.sshBoundHow === 'keys-api' ? '（钥匙列表匹配）' : '');
      L.push('公钥已绑到该账号: ✅ 是' + via);
    } else if (cred.sshBoundHow === 'ssh-other-account') {
      L.push(`公钥已绑到该账号: ❌ 否（SSH 认证到 ${cred.sshBoundLogin || '其他账号'}，不是 ${r.username}）`);
    } else if (cred.sshBoundHow === 'ssh-probe-failed') {
      L.push('公钥已绑到该账号: ⚠️ 未能实测（SSH 探测失败；token 也无权读钥匙列表）');
    } else {
      L.push('公钥已绑到该账号: ❌ 否（SSH 未认证成功）');
    }
  }
  return L.join('\n');
}

/** 批量提交推送（多个仓库），单个失败不阻断其余 */
export async function commitMany({ repos, message, push = true, dryRun = false, workspaceRoot = '' }) {
  const results = [];
  for (const repoPath of repos) {
    results.push({ repo: repoPath, ...(await commitAndPush({ repoPath, message, push, dryRun, workspaceRoot })) });
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
    } else {
      // 第一个带版本号的提交之前：归入 1.0.0，禁止丢弃
      current = {
        version: { major: 1, minor: 0, patch: 0 },
        versionStr: '1.0.0',
        hash,
        label: '1.0.0 初始提交（标题无版本号的前缀）',
        commits: [hash],
        isPatch: false,
        synthetic: true,
      };
      groups.push(current);
    }
  }
  return groups;
}

/** HEAD / 全历史必须被分组覆盖；最后带 X.Y.Z 的提交后面不能再挂一长串未标号提交。 */
export function rebuildCoverageGuard(repoPath, groups) {
  const allLog = runGit(['log', '--reverse', '--format=%H'], repoPath);
  const all = (allLog.stdout || '').split('\n').filter(Boolean);
  const head = (runGit(['rev-parse', 'HEAD'], repoPath).stdout || '').trim();
  const covered = new Set();
  for (const g of groups) {
    for (const h of g.commits) covered.add(h);
  }
  const missing = all.filter((h) => !covered.has(h));
  const last = groups.length ? groups[groups.length - 1] : null;
  const trailingUnversioned = last ? Math.max(0, last.commits.length - 1) : 0;
  const lastVersionedIsHead = last && last.hash === head;
  return {
    total: all.length,
    covered: covered.size,
    missingCount: missing.length,
    missingHead: !covered.has(head),
    head,
    lastVersion: last ? last.versionStr : null,
    trailingUnversioned,
    lastVersionedIsHead,
  };
}

function refuseSparseVersionScan(repoPath, groups) {
  const cov = rebuildCoverageGuard(repoPath, groups);
  if (cov.missingCount > 0 || cov.missingHead) {
    return {
      ok: false,
      error: `版本扫描会丢掉 ${cov.missingCount} 个提交（HEAD 未覆盖=${cov.missingHead}）。拒绝 squash。`,
      coverage: cov,
    };
  }
  // 标题里最后一个 X.Y.Z 不是 HEAD，且后面还跟了多笔未标号提交 → 会把近期功能并进旧版本
  if (cov.trailingUnversioned >= 5 && !cov.lastVersionedIsHead) {
    return {
      ok: false,
      error: `最后带 X.Y.Z 的提交是 ${cov.lastVersion}，其后还有 ${cov.trailingUnversioned} 个未标版本提交（含 HEAD）。squash 会把近期功能并进 ${cov.lastVersion}。拒绝。请先让 commit 标题与 README 版本表同一号，或改用 fresh。`,
      coverage: cov,
    };
  }
  return null;
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
  if (mode === 'fresh') {
    const before = groups.length || Number(runGit(['rev-list', '--count', 'HEAD'], repoPath).stdout || 0);
    return { ok: true, mode, dryRun: true, before, after: 1, plan: '完全重建：当前文件树作为唯一提交，版本号保持 package.json 不变；旧历史只留 backup 标签。force=true 才覆盖远端' };
  }
  if (!groups.length) return { ok: false, error: '无版本提交可操作' };
  const refuse = refuseSparseVersionScan(repoPath, groups);
  if (refuse) return refuse;
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

function commitWithIdentity(repoPath, message) {
  const identity = runGit(['config', 'user.name'], repoPath).stdout
    ? []
    : ['-c', 'user.name=DSH Agent', '-c', 'user.email=agent@dsh.local'];
  return runGit([...identity, 'commit', '-m', message], repoPath);
}

/** 覆盖远端当前分支（重建历史用）。API force PATCH；失败回退 SSH --force。 */
async function forcePushRebuilt({ repoPath, branch, workspaceRoot = '' }) {
  const originUrl = runGit(['remote', 'get-url', 'origin'], repoPath).stdout;
  const pr = parseGithubOwnerRepo(originUrl);
  if (!originUrl || !pr) return { pushed: false, reason: '无 origin，无法强制推送' };
  const tokenInfo = await resolveValidGitToken({ repoPath, workspaceRoot });
  let apiPushed = null;
  if (tokenInfo.token) {
    try {
      apiPushed = await pushViaApi({ repoPath, branch, token: tokenInfo.token, force: true });
    } catch (e) {
      apiPushed = { ok: false, pushed: false, reason: 'API 强制推送异常: ' + (e?.message || e) };
    }
  } else {
    apiPushed = { ok: false, pushed: false, reason: '无 GitHub token' };
  }
  if (apiPushed?.ok && apiPushed.pushed) {
    return { pushed: true, method: 'api', commitSha: apiPushed.commitSha, pushedTo: `api.github.com/${pr.owner}/${pr.repo}` };
  }
  const apiReason = apiPushed?.reason || 'api.github.com 推送失败';
  const sshPushed = pushViaSsh({ repoPath, branch, owner: pr.owner, repo: pr.repo, force: true });
  if (sshPushed.ok && sshPushed.pushed) {
    return { pushed: true, method: 'ssh', fallbackFrom: 'api', apiReason, pushedTo: `ssh.github.com:443/${pr.owner}/${pr.repo}` };
  }
  return { pushed: false, reason: `API 失败（${apiReason}）；SSH 回退失败（${sshPushed.reason || '未知'}）` };
}

/**
 * 重建 git 历史。模式说明：
 *   squash-bugfixes — 补丁版本 (Z>0) 并入前一个主版本，只保留主版本提交点
 *   drop-versions   — 删除指定版本区间的所有提交 (dropFrom ~ dropTo)
 *   fresh           — 当前文件树作为唯一提交；不改 package.json 版本号
 * 破坏性操作前打 backup-<timestamp> tag。force=true 才覆盖远端（用户已同意 force push）。
 */
export async function rebuildHistory({ repoPath, mode, dryRun = false, dropFrom, dropTo, force = false, workspaceRoot = '' } = {}) {
  if (!repoPath) return { ok: false, error: '缺少 repoPath' };

  if (mode === 'fresh') {
    const groups = listVersionCommits(repoPath);
    const before = groups.length || runGit(['rev-list', '--count', 'HEAD'], repoPath).stdout;
    if (dryRun) {
      return { ok: true, mode, dryRun: true, before, after: 1, plan: '完全重建：当前文件树作为唯一提交，版本号保持不变；force=true 才覆盖远端' };
    }
    const backupTag = `backup-${Date.now()}`;
    runGit(['tag', '-f', backupTag], repoPath);
    const branch = runGit(['branch', '--show-current'], repoPath).stdout || 'master';
    const pkgVer = readPkgVersion(repoPath) || 'unknown';
    // orphan：保留 remote / backup tag，不 git rm .git（那只会从索引删路径，删不掉目录）。
    runGit(['add', '-A'], repoPath);
    const orphan = runGit(['checkout', '--orphan', 'rebuild-fresh'], repoPath);
    if (orphan.status !== 0) return { ok: false, error: `orphan 失败: ${orphan.stderr}` };
    runGit(['add', '-A'], repoPath);
    const c = commitWithIdentity(repoPath, `feat: v${pkgVer} 重建历史（覆盖旧提交）`);
    if (c.status !== 0) return { ok: false, error: `提交失败: ${c.stderr}` };
    runGit(['branch', '-M', 'rebuild-fresh', branch], repoPath);
    const result = { ok: true, mode, before, after: 1, backupTag, branch, repo: repoPath, version: pkgVer, force: !!force };
    if (force) result.push = await forcePushRebuilt({ repoPath, branch, workspaceRoot });
    else result.push = { pushed: false, reason: 'force=false，只改本地；覆盖远端需 force=true' };
    return result;
  }

  // squash-bugfixes / drop-versions
  const groups = listVersionCommits(repoPath);
  if (!groups.length) return { ok: false, error: '无版本提交可操作' };
  const refuse = refuseSparseVersionScan(repoPath, groups);
  if (refuse) return refuse;
  let keepGroups;
  if (mode === 'squash-bugfixes') {
    keepGroups = squashGroups(groups);
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
  const resultVersion = readPkgVersion(repoPath) || '(package.json 不存在)';
  const result = {
    ok: true, mode, before: groups.length, after: keepGroups.length, dropped: groups.length - keepGroups.length,
    backupTag, branch, repo: repoPath, version: resultVersion, force: !!force,
  };
  if (force) result.push = await forcePushRebuilt({ repoPath, branch, workspaceRoot });
  else result.push = { pushed: false, reason: 'force=false，只改本地；覆盖远端需 force=true' };
  return result;
}

/* ------------------------------ 规范化 README 生成（v1.8.0 / v1.23.0 模板在 User 仓） ------------------------------ */

/** 插件内置默认骨架：User 仓没有 readme-template.md 时才用。 */
export const DEFAULT_README_TEMPLATE = `# {{name}}

> {{description}}

## 目录

{{toc}}

## 架构设计

<!-- INSERT: 项目核心架构说明（分层/组件/模块/关键设计决策） -->

## 文件目录结构及作用

<!-- INSERT: 关键文件/目录清单 + 每项作用说明 -->

## 启动脚本

<!-- INSERT: start.sh 用法：start / stop / restart / status，含端口与环境要求 -->

## API 总览

<!-- INSERT: | 方法 | 路径 | 说明 |（每行路径跳转到对应详细说明锚点） -->

## 版本列表

{{versionTable}}

## 注意事项

<!-- INSERT: 踩过的坑、边界条件、依赖环境要求、已知限制 -->

## 开发计划 / 疑难杂症

<!-- INSERT: 待办功能、已知问题、未解决的技术难题 -->
`;

/**
 * README 模板（v1.40.0）：不再读同级仓——优先插件 template/README.md（每人可改章节），缺省用内置骨架。
 */
export function resolveReadmeTemplate({ workspaceRoot = '' } = {}) {
  const candidates = [join(PLUGIN_ROOT, 'template', 'README.md')];
  for (const file of candidates) {
    try {
      if (existsSync(file)) {
        const template = readFileSync(file, 'utf8');
        if (template.trim()) return { source: file, template };
      }
    } catch { /* 下一份 */ }
  }
  return { source: 'builtin', template: DEFAULT_README_TEMPLATE };
}

function tocFromTemplate(template) {
  const titles = [];
  for (const line of String(template || '').split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (!m) continue;
    const title = m[1].trim();
    if (title === '目录') continue;
    titles.push(title);
  }
  return titles.map((t) => `- [${t}](#${t})`).join('\n');
}

/**
 * 规范化生成 README 骨架。
 *  - 模板：插件 template/README.md（v1.40.0 起不再读同级仓）
 *  - 自动填充：{{name}} {{description}} {{version}} {{toc}} {{versionTable}}
 *  - writePath 可选写入文件，默认只返回内容
 */
export function genReadme({ repoPath, writePath, workspaceRoot = '' } = {}) {
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

  const { source, template } = resolveReadmeTemplate({ workspaceRoot });
  const toc = tocFromTemplate(template);
  const versionTable = versionTableLines.join('\n');
  const content = template
    .replaceAll('{{name}}', name)
    .replaceAll('{{description}}', description)
    .replaceAll('{{version}}', version || '')
    .replaceAll('{{toc}}', toc)
    .replaceAll('{{versionTable}}', versionTable);

  let written = false;
  let writeError = null;
  if (writePath) {
    try { writeFileSync(writePath, content, 'utf8'); written = true; }
    catch (e) { writeError = String(e?.message || e); }
  }

  return {
    ok: true, content, name, description, version, written, writeError,
    templateSource: source,
    versionTable: versionTableLines,
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
    // v1.40.0：untracked 跳过二进制/大文件（isBinaryOrLarge 原本只服务于 tracked diff 路径）
    if (isBinaryOrLarge(join(repoPath, p))) continue;
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
 * 探测 GitHub token（多源，返回首个可读）：
 * v1.40.0 顺序 = 插件配置目录 credentialsDir()（token / <owner>/token）→ 显式 tokenPath →
 * repo 内 .git-push-token → workspaceRoot data/sensitive → 常见凭据位置。
 * 原同级仓 dsh-git-push-User 候选废除（含双副本扫描）。
 * 绝不把 token 值写入返回值明文（只回传 source 路径）。
 * @returns {{ token: string, source: string }}
 */
export function resolveGitToken({ tokenPath = '', repoPath = '', workspaceRoot = '' } = {}) {
  const candidates = [];
  const credDir = credentialsDir({ workspaceRoot });
  if (credDir) {
    candidates.push(join(credDir, 'github-token'));
    candidates.push(join(credDir, 'token'));
  }
  if (tokenPath) candidates.push(tokenPath);
  if (repoPath) candidates.push(join(repoPath, '.git-push-token'));
  if (workspaceRoot) {
    candidates.push(join(workspaceRoot, 'data', 'sensitive', 'github-token'));
    candidates.push(join(workspaceRoot, '..', 'data', 'sensitive', 'github-token'));
  }
  // 2026-09-07 修改：硬编码审计新增后，本机绝对路径不再写死。
  // 【原代码】candidates.push 写死 NAS 工作区 data/sensitive/github-token 绝对路径
  // 【改为】从 HOME / DSH_HOME 推导历史凭据目录（换机/换挂载点仍能找到旧 token）。
  // 【触发】gitpush 增加审计硬编码功能，测试就用插件本身
  // 【思路】旧副本曾把 token 放 workspace/data/sensitive；用环境变量拼相对段，不再锚定某台 NAS 卷。
  for (const root of [process.env.HOME, process.env.DSH_HOME, process.env.DSH_WORKSPACE]) {
    if (!root) continue;
    candidates.push(join(root, 'workspace', 'data', 'sensitive', 'github-token'));
    candidates.push(join(root, 'data', 'sensitive', 'github-token'));
  }
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
        if (t && /^(gh[pous]_|github_pat_)/.test(t)) return { token: t, source: p };
      }
    } catch { /* 读不到跳过 */ }
  }
  return { token: '', source: '' };
}

/**
 * v1.36.2：异步真校验版 token 探测——候选逐个调 probeTokenValid，跳过失效 token。
 * v1.40.0：候选 = resolveGitToken 同一清单（插件配置目录优先），原同级仓候选废除。
 * 全部失效/无候选时回退 resolveGitToken 的同步结果（保持 401→SSH 回退旧路径）。
 * @returns {Promise<{token: string, source: string}>}
 */
export async function resolveValidGitToken(opts = {}) {
  const syncRes = resolveGitToken(opts);
  if (!syncRes.token) return syncRes;
  // 逐个候选校验：复刻 resolveGitToken 候选顺序，跳过已校验失效的文件，
  // 找下一个格式匹配且 probeTokenValid=true 的。
  const candidates = [];
  const credDir = credentialsDir({ workspaceRoot: opts.workspaceRoot || '' });
  if (credDir) {
    candidates.push(join(credDir, 'github-token'));
    candidates.push(join(credDir, 'token'));
  }
  if (opts.tokenPath) candidates.push(opts.tokenPath);
  if (opts.repoPath) candidates.push(join(opts.repoPath, '.git-push-token'));
  const seen = new Set();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      if (!existsSync(p)) continue;
      const t = readFileSync(p, 'utf8').trim();
      if (!t || !/^(gh[pous]_|github_pat_)/.test(t)) continue;
      if (await probeTokenValid(t)) return { token: t, source: p };
    } catch { /* 读不到/校验异常跳过 */ }
  }
  // 全部失效：回退同步结果（保持旧行为，让调用方走 401→SSH 回退）
  return syncRes;
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

  // 1. 现有 origin（2026-09-02：新 origin 写成 api.github.com/repos/o/r，不再写 SSH 443）
  // 「所有功能都默认api.github.com」
  // 【原代码】runGit(['remote','add','origin', `ssh://git@ssh.github.com:443/${owner}/${name}.git`], repoPath)
  // 【思路】origin 只给 parseGithubOwnerRepo / pushViaApi 解析用，不发起 git 协议；写成 API URL 才和默认通道一致
  const apiOrigin = apiOriginOf(owner, name);
  const origin = runGit(['remote', 'get-url', 'origin'], repoPath).stdout || '';
  if (origin) {
    steps.push(`已有 origin: ${origin}`);
  } else if (!dryRun) {
    runGit(['remote', 'add', 'origin', apiOrigin], repoPath);
    steps.push(`已设置 origin → ${apiOrigin}`);
  } else {
    steps.push(`将设置 origin → ${apiOrigin}`);
  }

  // 2. 检查 GitHub 是否已存在（githubFetch，不跟随 302）
  let exists = false;
  let existingUrl = '';
  try {
    const res = await githubFetch(`/repos/${owner}/${encodeURIComponent(name)}`, { token, timeout: 10_000 });
    if (res.status === 200) {
      exists = true;
      existingUrl = apiOrigin;
    } else if (res.status !== 404) {
      return { ok: false, error: { code: 'GH_QUERY', message: res.error || `查询远程仓库失败 HTTP ${res.status}` } };
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
      const res = await githubFetch('/user/repos', {
        token, method: 'POST', timeout: 20_000,
        body: {
          name,
          description: description || `由 dsh-git-push 自动创建（项目 ${name}）`,
          private: visibility !== 'public',
          auto_init: false,
        },
      });
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, error: { code: 'GH_CREATE', message: `创建远程仓库失败 HTTP ${res.status}: ${(res.text || res.error || '').slice(0, 160)}` } };
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
    origin: apiOrigin,
    remoteWasSet: !origin && !dryRun,
    steps,
    tokenSource: source,
    ...(dryRun ? { dryRun: true } : {}),
  };
}


/* ------------------------------ 插件根目录与本地凭据（v1.40.0：同级仓 dsh-git-push-User 全模块废除） ------------------------------ */

/** 插件根目录（运行时定位到实际装载副本；源码仓与 node_modules 装载副本都适用） */
export const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // lib/.. → 插件根

/**
 * 从 remote URL 提取 GitHub owner（EIGHTfs/x.git → EIGHTfs）；无 remote 返回 ''。
 */
export function ownerFromRemote(remote = '') {
  // 2026-09-02：复用 parseGithubOwnerRepo，同时认 api.github.com/repos/o/r 与历史 github.com/SSH
  // 【原代码】remote.match(/(?:github\.com[:/]|git@)([\w.-]+)\/([\w.-]+)(?:\.git)?$/)
  // 【改为】「所有功能都默认api.github.com」
  const pr = parseGithubOwnerRepo(remote);
  return pr ? pr.owner : '';
}

/**
 * v1.40.0：插件配置目录——token / SSH 密钥 / 公钥 / requirements 等本机私有数据统一收敛在此。
 * 解析顺序：DSH_HOME/git-push → HOME/.dsh/git-push → <workspaceRoot>/../.dsh/git-push → cwd/.dsh/git-push。
 * 取代原同级仓 dsh-git-push-User（v1.40.0 废除）。目录在 git 仓库内时由 .gitignore 拦截入库。
 */
export function credentialsDir({ workspaceRoot = '' } = {}) {
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, 'git-push');
  if (process.env.HOME) return join(process.env.HOME, '.dsh', 'git-push');
  if (workspaceRoot) return join(dirname(resolve(workspaceRoot)), '.dsh', 'git-push');
  return join(process.cwd(), '.dsh', 'git-push');
}

/**
 * v1.40.0：SSH 私钥探测——只认插件配置目录 credentialsDir()（id_rsa → id_ed25519 → id_ecdsa）。
 * 原同级仓 resolveUserSshKey 废除；未找到时走系统默认 ssh 配置。
 */
export function resolveSshKey({ workspaceRoot = '' } = {}) {
  const dir = credentialsDir({ workspaceRoot });
  for (const name of ['id_rsa', 'id_ed25519', 'id_ecdsa']) {
    const p = join(dir, name);
    try {
      if (p && existsSync(p)) return { keyPath: p, kind: name };
    } catch { /* 跳过 */ }
  }
  return { keyPath: '', kind: '' };
}

/**
 * v1.40.0：maskRemoteUrl —— origin remote URL 脱敏。
 * 抹掉内嵌凭据（https://user:token@…、https://token@…）与 query 中的 token 参数；
 * SSH 与普通 URL 原样返回。防止 token 经 git_scan / HTTP scan 回传进会话。
 */
export function maskRemoteUrl(url = '') {
  const s = String(url || '');
  if (!s) return '';
  // 单遍处理 userinfo：user:token@ → user:****@；裸 token@ → ****@（不二次替换）
  const masked = s.replace(/^(https?:\/\/)([^/@\s]*)@/i, (m, proto, userinfo) => {
    if (!userinfo) return m;
    const i = userinfo.indexOf(':');
    return i >= 0 ? `${proto}${userinfo.slice(0, i)}:****@` : `${proto}****@`;
  });
  return masked.replace(/([?&](?:token|access_token|private_token)=)[^&\s]+/gi, '$1****');
}

/**
 * v1.40.0：默认 GitHub owner（可配置化，D7）。ensureRemoteRepo 等以此兜底，
 * 配置 githubOwner 时由插件启动时调用 setDefaultGithubOwner 覆盖。
 */
export const DEFAULT_GITHUB_OWNER = 'EIGHTfs';
let DEFAULT_GITHUB_OWNER_VALUE = DEFAULT_GITHUB_OWNER;
export function setDefaultGithubOwner(owner = '') {
  if (String(owner || '').trim()) DEFAULT_GITHUB_OWNER_VALUE = String(owner).trim();
}
export function getDefaultGithubOwner() {
  return DEFAULT_GITHUB_OWNER_VALUE || DEFAULT_GITHUB_OWNER;
}

/**
 * v1.40.0：skill 注入来源目录（去同级仓依赖，B3/B6）。
 *   1. 插件自带 skills/（PLUGIN_ROOT/skills）
 *   2. 技能仓库 ai-work-archive/skills（DSH_HOME 工作区推导）：
 *      根下散装 git-*.md（walk=false + loose 过滤，防全量递归技能仓）+
 *      quality-质量/git-workflow-gitpush/ 子目录整体。
 * 目录不存在自动跳过，返回 [{ dir, base, walk, loose }]。
 */
export function resolveSkillRepoDirs() {
  const dirs = [{ dir: join(PLUGIN_ROOT, 'skills'), base: 'dsh-git-push/skills' }];
  const roots = [];
  if (process.env.DSH_HOME) roots.push(join(process.env.DSH_HOME, '工作区'));
  if (process.env.HOME) roots.push(join(process.env.HOME, '工作区'));
  roots.push(process.cwd());
  for (const root of roots) {
    try {
      const skillsRoot = join(resolve(root), 'ai-work-archive', 'skills');
      if (!existsSync(skillsRoot)) continue;
      dirs.push({ dir: skillsRoot, base: 'ai-work-archive/skills', walk: false, loose: /^git-.*\.md$/i });
      const quality = join(skillsRoot, 'quality-质量', 'git-workflow-gitpush');
      if (existsSync(quality)) dirs.push({ dir: quality, base: 'ai-work-archive/skills/quality-质量/git-workflow-gitpush', walk: true });
      break; // 只取第一个命中的技能仓库根
    } catch { /* 跳过 */ }
  }
  return dirs;
}

/**
 * v1.40.0：开发者要求门禁（B4）——随插件内置 lib/user-requirements.json（归属 EIGHTfs），
 * 原同级仓 requirements.md 废除。可放 <credentialsDir>/requirements.json 覆盖（外挂别人清单）。
 */
export function loadRequirements() {
  const candidates = [
    join(credentialsDir(), 'requirements.json'),
    join(PLUGIN_ROOT, 'lib', 'user-requirements.json'),
    join(PLUGIN_ROOT, 'user-requirements.json'),
  ];
  for (const f of candidates) {
    try {
      if (!f || !existsSync(f)) continue;
      const parsed = JSON.parse(readFileSync(f, 'utf8'));
      const items = Array.isArray(parsed?.items) ? parsed.items.map((x) => String(x).trim()).filter(Boolean) : [];
      if (items.length) {
        return { user: String(parsed.user || '') || 'EIGHTfs', found: true, items, files: [{ file: f, items }] };
      }
    } catch { /* 坏 JSON 换下一来源 */ }
  }
  return { user: 'EIGHTfs', found: false, items: [], files: [] };
}

/**
 * 校验 GitHub token 是否可用（v1.36.2：双副本场景修复的核心）。
 * 调 GET /user 判断 token 有效性；带 60s 内存缓存，避免插件生命周期内重复探测。
 * 网络异常按「无效」处理（false）；调用方在单候选无竞争时不受影响（v1.40.0：候选=插件配置目录单一清单）。
 * 纯本地无 token / 空 token → false（不联网）。
 * @returns {Promise<boolean>}
 */
const _tokenValidCache = new Map(); // token -> { valid: boolean, at: number }
export async function probeTokenValid(token = '') {
  const t = String(token || '').trim();
  if (!t || !/^(gh[pous]_|github_pat_)/.test(t)) return false;
  const hit = _tokenValidCache.get(t);
  if (hit && Date.now() - hit.at < 60_000) return hit.valid;
  let valid = false;
  try {
    const res = await githubFetch('/user', { token: t, timeout: 2_000 });
    valid = res.status === 200;
  } catch { /* 网络异常按无效，但仅影响加分 */ }
  _tokenValidCache.set(t, { valid, at: Date.now() });
  return valid;
}

/** 供测试注入/清理缓存：清空 token 有效性缓存。 */
export function clearTokenValidCache() {
  _tokenValidCache.clear();
}

/**
 * v1.17.0 远端 clone：只走 api.github.com Git Data API（git/trees + git/blobs），
 * 不再下 tarball（实测 302 → codeload.github.com，违反「默认 api.github.com」）。
 * 「修复此插件，使所有功能都默认api.github.com」
 * 【原代码】GET /repos/o/r/tarball/{branch} + redirect:'follow' → tar 解压 → git init
 * 【思路】GET /git/trees/{ref}?recursive=1 拿路径+sha，再 GET /git/blobs/{sha} Accept: raw
 * 写文件（含 symlink），/tmp 中转建仓后整拷 dest，origin 写成 api.github.com/repos/o/r。
 * target 仍支持 owner/repo 与历史 github.com / SSH URL（只解析字符串，不访问那些域名）。
 * @returns {{ ok, owner, repo, branch, commitSha, dest, method: 'api', defaultBranch?, files?, error? }}
 */
export async function cloneViaApi({ target, dest = '', branch = '', token = '', workspaceRoot = '' } = {}) {
  if (!token) return { ok: false, error: '缺少 GitHub token（可用 resolveGitToken 多源探测）' };
  const t = (target || '').trim();
  let pr = parseGithubOwnerRepo(t);
  if (!pr) {
    const m = t.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (m) pr = { owner: m[1], repo: m[2] };
  }
  if (!pr) return { ok: false, error: `无法解析 target 为 owner/repo: ${t || '(空)'}` };
  const { owner, repo } = pr;

  // 1. 默认分支探测（分支免疫：GitHub 默认分支可能是 master 或 main）
  let defaultBranch = '';
  const metaRes = await githubFetch(`/repos/${owner}/${repo}`, { token, timeout: 30_000 });
  if (metaRes.status === 200) defaultBranch = metaRes.json?.default_branch || '';
  const branchName = branch || defaultBranch || 'master';

  // 2. 递归 tree（留在 api.github.com，不走 tarball/codeload）
  const treeRes = await githubFetch(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branchName)}?recursive=1`, { token, timeout: 60_000 });
  if (treeRes.status !== 200 || !Array.isArray(treeRes.json?.tree)) {
    return { ok: false, error: `读 git/trees 失败 HTTP ${treeRes.status}: ${(treeRes.error || treeRes.text || '').slice(0, 160)}` };
  }
  const blobs = treeRes.json.tree.filter((e) => e && e.type === 'blob');

  // 3. /tmp 中转建仓（CIFS git init chmod EPERM，必须 /tmp 可写卷）
  const tmpRoot = mkdtempSync(join('/tmp', 'dsh-clone-'));
  try {
    const gitDir = join(tmpRoot, 'repo');
    const ini = spawnSync('git', [...gitCFlags(gitDir), 'init', gitDir], { encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'ignore'] });
    if (ini.status !== 0) return { ok: false, error: `git init 失败: ${ini.stderr || ini.status}` };
    const sr = spawnSync('git', [...gitCFlags(gitDir), 'symbolic-ref', 'HEAD', `refs/heads/${branchName}`], { cwd: gitDir, encoding: 'utf8', timeout: 60_000, stdio: ['pipe', 'pipe', 'ignore'] });
    if (sr.status !== 0) return { ok: false, error: `设置分支 ${branchName} 失败: ${sr.stderr || sr.status}` };

    // 4. 逐 blob 下载：GET /git/blobs/{sha} 返回 JSON+base64（留在 api.github.com，二进制安全）
    // 【原代码】Accept: raw 再 latin1 回写——text() 会按 UTF-8 损坏二进制；改 base64 与 pushViaApi 对称
    for (const e of blobs) {
      const filePath = join(gitDir, e.path);
      mkdirSync(dirname(filePath), { recursive: true });
      const blob = await githubFetch(`/repos/${owner}/${repo}/git/blobs/${e.sha}`, { token, timeout: 60_000 });
      if (blob.status !== 200) return { ok: false, error: `读 blob 失败 ${e.path}: HTTP ${blob.status}` };
      const encoding = blob.json?.encoding;
      let buf;
      if (encoding === 'base64' && typeof blob.json?.content === 'string') {
        buf = Buffer.from(blob.json.content.replace(/\n/g, ''), 'base64');
      } else if (blob.buffer?.length) {
        buf = blob.buffer;
      } else {
        return { ok: false, error: `blob 无内容 ${e.path}` };
      }
      if (e.mode === '120000') {
        try { symlinkSync(buf.toString('utf8'), filePath); } catch (err) { return { ok: false, error: `写 symlink 失败 ${e.path}: ${err.message}` }; }
        continue;
      }
      writeFileSync(filePath, buf);
      if (e.mode === '100755') {
        try { chmodSync(filePath, 0o755); } catch { /* 忽略 */ }
      }
    }

    // 5. 本地 commit（identity 用 owner，与远端一致）
    const add = runGit(['add', '-A'], gitDir);
    if (add.status !== 0) return { ok: false, error: `git add 失败: ${add.stderr}` };
    const cm = runGit(
      ['-c', `user.name=${owner}`, '-c', `user.email=${owner}@users.noreply.github.com`, 'commit', '-m', `clone of ${owner}/${repo} @ ${branchName} (api.github.com Git Data API)`, '--allow-empty'],
      gitDir
    );
    if (cm.status !== 0) return { ok: false, error: `git commit 失败: ${cm.stderr}` };
    const commitSha = runGit(['rev-parse', 'HEAD'], gitDir).stdout;

    // 6. origin 写成 api.github.com/repos/o/r（pushViaApi / parseGithubOwnerRepo 可解析）
    // 【原代码】runGit(['remote','add','origin', `https://github.com/${owner}/${repo}.git`], gitDir)
    runGit(['remote', 'add', 'origin', apiOriginOf(owner, repo)], gitDir);

    // 7. 整拷回 dest（预先校验非空目录，防误覆盖）
    // 2026-09-07 修改：硬编码审计新增后，clone 默认 dest 不再写死本机工作区。
    // 【原代码】dest 缺省时 join(workspaceRoot 或 NAS 工作区绝对路径, repo)
    // 【改为】workspaceRoot → cwd → HOME/工作区 → /tmp（最后兜底，避免空路径覆盖未知目录）。
    // 【触发】gitpush 增加审计硬编码功能，测试就用插件本身
    // 【思路】调用方通常传 dest 或 workspaceRoot；缺两者时用进程 cwd，再退 HOME，绝不锚定某台 NAS。
    const destRoot = workspaceRoot
      || process.cwd()
      || (process.env.HOME && join(process.env.HOME, '工作区'))
      || '/tmp';
    const destPath = dest || join(destRoot, repo);
    if (existsSync(destPath) && readdirSync(destPath).length > 0) {
      return { ok: false, error: `目标目录已存在且非空: ${destPath}` };
    }
    mkdirSync(destPath, { recursive: true });
    const cp2 = spawnSync('cp', ['-a', gitDir + '/.', destPath + '/'], { encoding: 'utf8', timeout: 120_000 });
    if (cp2.status !== 0) return { ok: false, error: `拷贝到目标失败: ${cp2.stderr || cp2.status}` };

    return {
      ok: true, owner, repo, branch: branchName, commitSha, dest: destPath,
      method: 'api', defaultBranch: defaultBranch || branchName, files: blobs.length, origin: apiOriginOf(owner, repo),
    };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}
