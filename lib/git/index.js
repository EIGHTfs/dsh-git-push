/**
 * dsh-git-push git 总入口
 *
 * token / sshkey / 提交 / 推送 / clone / 建仓 / 可见性。
 * 铁律：所有 git 命令走 runGit（数组参数零注入面）；所有网络请求走 githubFetch
 * （api.github.com 硬闸，拒绝其它域名——「所有功能都默认 api.github.com」）。
 * 401 回退：pushViaApi 遇 401/Bad credentials → pushViaSsh（ssh.github.com:443）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { autoTagDSHProject, ensureAuxSshRemote, readPkgVersion, updateRemoteTrackingRef } from './post-push.js';
import { isSampleExemptDir } from '../exempt/index.js';

/** 插件根（lib/git/index.js → lib → 插件根；requirements.json 内置清单定位用）。 */
export const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * 开发者特殊要求清单（D13，对齐 v1 workspace-context.js loadRequirements）：
 * 三来源依次尝试（首个有效即返回）：
 *   1) credentialsDir()/requirements.json（用户外挂）
 *   2) PLUGIN_ROOT/lib/user-requirements.json（内置默认清单）
 *   3) PLUGIN_ROOT/user-requirements.json
 * 返回 { user, found, items, files }；无清单时 found:false（门禁放行）。
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
        return { user: String(parsed.user || '') || '默认开发者', found: true, items, files: [{ file: f, items }] };
      }
    } catch { /* 坏 JSON 换下一来源 */ }
  }
  return { user: '默认开发者', found: false, items: [], files: [] };
}

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

/**
 * git 原始字节通道（对齐 v1 gitRaw）：stdout 保留 Buffer，供 blob 原始内容读取。
 * ⚠️ 禁止用 runGit 读 blob——utf8 解码 + trim 会损坏非 UTF-8 字节/末尾换行（2026-09-11 实测：
 * pushViaApi 经 runGit 读 cat-file 上传，17/109 文件 blob sha 与本地不一致，远端内容损坏）。
 * @returns {{status: number|null, stdout: Buffer, stderr: Buffer, error?: string}}
 */
export function gitRaw(args, { cwd = '', timeoutMs = 600_000 } = {}) {
  const base = ['-c', 'safe.directory=*', '-c', 'core.filemode=false', '-c', 'core.quotepath=false'];
  try {
    const r = spawnSync('git', cwd ? [...base, '-C', cwd, ...args] : [...base, ...args], {
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
    });
    return { status: r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0), ...(r.error ? { error: String(r.error.message || r.error) } : {}) };
  } catch (e) {
    return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: String(e?.message || e) };
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
export async function githubFetch(path, { token = '', method = 'GET', body, timeout = 60_000, headers: extraHeaders } = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${GH_API}${path.startsWith('/') ? path : `/${path}`}`;
  let host = '';
  try { host = new URL(url).hostname; } catch { return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `非法 URL: ${url}` }; }
  if (host !== 'api.github.com') {
    return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: `拒绝非 api.github.com 请求: ${host}` };
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-git-push',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(extraHeaders || {}),
  };
  try {
    const res = await fetch(url, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual', // 防 tarball 302 跳到 codeload.github.com
    });
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, json: null, text: '', buffer: Buffer.alloc(0), error: `api.github.com 重定向（拒绝跟随）: ${res.headers.get('location') || ''}` };
    }
    // 先读 arrayBuffer：JSON 接口 toString utf8；clone 二进制用 buffer / base64，避免 text() UTF-8 损坏
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = buffer.toString('utf8');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON（raw blob） */ }
    return { status: res.status, json, text, buffer };
  } catch (e) {
    return { status: 0, json: null, text: '', buffer: Buffer.alloc(0), error: String(e?.message || e) };
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

/**
 * 探测 GitHub 仓库可见性（GET /repos/{owner}/{repo}，走 api.github.com 不跟随 302）。
 * 用于私有库豁免：private 仓库敏感字段入库风险由可见性兜底，自动 .gitignore 只扫描不写。
 * @returns {{visibility:'private'|'public'|'unknown', owner?, repo?, private?, reason?}}
 */
export async function detectRepoVisibility({ repoPath = '', token = '' } = {}) {
  try {
    const originUrl = repoPath ? runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout : '';
    const pr = parseGithubOwnerRepo(originUrl);
    if (!pr) return { visibility: 'unknown', reason: '无 github origin' };
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

/* ───────────────────────── 敏感文件自动 .gitignore ───────────────────────── */

const SENSITIVE_NAMES = new Set(['.env', '.env.local', 'github-token', '.git-push-token', 'id_rsa', 'id_ed25519', 'id_ecdsa', '*.pem', '*.key']);

/** 扫描仓库内敏感文件（相对路径列表）。 */
/** 递归扫描跳过的目录（与 npm 屏蔽同源 + 常见构建/缓存）。 */
const SENSITIVE_SKIP_DIRS = new Set(['.git', 'node_modules', 'node_modules.orig', '.dsh', '.trash', 'cache-gifs', 'uploads', 'dist', 'build']);
/** 明显二进制/图片/压缩/媒体扩展名，不当作文本扫描。 */
const SENSITIVE_BINARY_EXT = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg','zip','7z','rar','gz','tar','xz','pdf','exe','dll','so','dylib','bin','woff','woff2','ttf','otf','mp4','mp3','ogg','wav','flac','db','sqlite','ico']);
/** 敏感字段（cookie / 设备 / 用户名 / 密码 / token-secret），键名大小写不敏感。 */
const SENSITIVE_KEYS = [
  { name: 'cookie',     keys: ['cookie', 'cookies'],                                  valueMin: 4 },
  { name: 'device',     keys: ['device_id','device-id','deviceid','device_name','device-info','machine_id','machine-id','hardware_id','hardware-id','imei','serial_number','serial-number'], valueMin: 2 },
  { name: 'username',   keys: ['username','user_name','user-name','login_name','login-name'], valueMin: 2 },
  { name: 'password',   keys: ['password','passwd','pass_word','pass-word','pwd'],    valueMin: 3 },
  { name: 'token/secret', keys: ['api_key','api-key','apikey','api_secret','api-secret','access_key','access-key','auth_token','auth-token','refresh_token','refresh-token','secret_key','secret-key','client_secret','client-secret'], valueMin: 6 },
];
/** 占位符/示例值：值看起来是假的就不报（防 README/示例误伤）。 */
const SENSITIVE_PLACEHOLDER_VALUE = /^(your[-_ ]?[a-z]+|xxx+\.?\.?|example|changeme|dummy|sample|demo|placeholder|<[^>]+>|\$\{?[A-Z_][A-Z0-9_]*}?|process\.env\.[A-Z_]+|env\.[A-Z_]+|undefined|null|true|false)$/i;
/** 行内示例上下文：出现即整行豁免（举例/示例/演示）。 */
const SENSITIVE_EXAMPLE_CONTEXT = /(例如|举例|示例|样例|演示|比如|fake|sample|demo|example|illustration)/i;
/** 豁免标记：行尾注释豁免单行 / 文件头（前 3 行）声明豁免整文件（大小写不敏感）。 */
const SENSITIVE_EXEMPT_RE = /dsh-skip-sensitive/i;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 单行敏感字段匹配：返回字段名或 null（跳过豁免注释/示例行/占位符值）。 */
function sensitiveLineMatch(line) {
  if (SENSITIVE_EXEMPT_RE.test(line)) return null; // 行内注释豁免
  if (SENSITIVE_EXAMPLE_CONTEXT.test(line)) return null;
  const clean = line.replace(/^[#;/\*\s]+/, ''); // 去掉行首注释标记与空白
  for (const k of SENSITIVE_KEYS) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])(?:${k.keys.map(escapeRegExp).join('|')})\\s*[:=]\\s*(.*)$`, 'i');
    const m = clean.match(re);
    if (m) {
      // 值必须是「纯净字符串字面量」才算硬编码凭据：变量/函数调用/表达式/拼接/插值不算
      const raw = m[1].trim();
      const qm = raw.match(/^(["'`])([\s\S]*?)\1\s*[,;)\]}\s]*$/);
      if (!qm) continue;
      let val = qm[2].trim();
      if (/\+|\$\{/.test(val)) continue; // 拼接/模板插值 = 表达式
      if (/[\u4e00-\u9fff]/.test(val)) continue; // 值含中文 = UI 文案/说明，不是凭据（如 account: '账号检查'）
      if (val.length >= k.valueMin && !SENSITIVE_PLACEHOLDER_VALUE.test(val)) return k.name;
    }
  }
  return null;
}

/**
 * 扫描仓库全部文本文件，找出含敏感字段（cookie/device/username/password/token-secret）的文件。
 * 内容级检测：键值对 + 字符串字面量判定 + 占位符/示例/豁免注释；≤512KB、跳过二进制/图片/忽略目录。
 * 补充文件名黑名单（.env/id_rsa/*.pem 等）——名字本身就是凭据载体，无需读内容。
 * @returns {{path: string, fields: string[]}[]}
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
        // 文件名黑名单：名字本身就是凭据载体
        for (const n of SENSITIVE_NAMES) {
          if (n.includes('*')) {
            if (new RegExp(`^${n.replace('*', '.*')}$`).test(it.name)) { hits.push({ path: relPath, fields: ['filename'] }); break; }
          } else if (it.name === n) { hits.push({ path: relPath, fields: ['filename'] }); break; }
        }
        // 内容级：文本文件内敏感键值检测
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
        if (SENSITIVE_EXEMPT_RE.test(text.split('\n').slice(0, 3).join('\n'))) continue; // 文件头豁免整文件
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
 * 基线忽略项（与仓库内容无关，恒定排除）。
 * node_modules 是依赖目录、node_modules.orig 是安装/备份残留副本，
 * 两者都属机器本地产物，不应进入版本库（也避免链接/占位混入插件树）。
 */
export const DEFAULT_IGNORE_PATTERNS = ['node_modules/', 'node_modules.orig/'];

/**
 * 把基线忽略项 + 自定义忽略追加进 .gitignore（幂等：已存在行不重复写）。
 * 敏感文件扫描只报告（files），不写入 .gitignore、不解除跟踪（2026-09-12 用户指令）。
 * @param {string} repoPath 仓库根
 * @param {{customIgnorePatterns?: string|string[]}} [opts]
 *   customIgnorePatterns：逗号/换行分隔的 gitignore pattern 或字符串数组（用户自定义忽略）
 * @returns {{added:number, files:string[], baseline:number, custom:number, tracked:string[], unstaged:string[]}}
 *   added 追加总行数 / files 敏感文件路径（只报告）/ baseline 基线补入数 / custom 自定义补入数 /
 *   tracked 恒空（不再解除跟踪）/ unstaged 恒空
 */
export function ensureGitignore(repoPath, { customIgnorePatterns = '' } = {}) {
  const files = scanSensitiveFiles(repoPath);
  const giPath = join(repoPath, '.gitignore');
  let existing = '';
  try { existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''; } catch { /* 忽略 */ }
  const lines = existing.split('\n').map((l) => l.trim());
  let added = 0;
  let baseline = 0;
  let custom = 0;
  let sampleExempted = 0;
  const additions = [];
  // 1) 基线忽略项（node_modules / node_modules.orig）
  for (const pat of DEFAULT_IGNORE_PATTERNS) {
    const bare = pat.replace(/\/$/, '');
    if (lines.includes(pat) || lines.includes(bare)) continue;
    additions.push(pat);
    baseline++;
    added++;
  }
  // 2) 扫描出的敏感文件（内容级 + 文件名黑名单）——只报告不动作：不动 .gitignore、不解除跟踪
  //（2026-09-12 用户指令：扫描到敏感文件不改动 git 忽略配置，由仓库方自行决定处理）
  for (const h of files) {
    const rel = h.path;
    if (isSampleExemptDir(repoPath, rel)) { sampleExempted++; continue; }
    // 已跟踪不解除、未跟踪不追加——敏感文件照常留在工作区，仅经 files 报告
  }
  // 3) 自定义忽略 pattern（幂等追加）
  const customList = (Array.isArray(customIgnorePatterns) ? customIgnorePatterns : String(customIgnorePatterns || '').split(/[\n,]/))
    .map((s) => s.trim()).filter(Boolean);
  for (const line of customList) {
    if (lines.includes(line)) continue;
    additions.push(line);
    custom++;
    added++;
  }
  if (added) {
    const block = `${existing.endsWith('\n') || !existing ? '' : '\n'}${additions.join('\n')}\n`;
    try { writeFileSync(giPath, existing + block, 'utf8'); } catch { /* 写失败不抛 */ }
  }
  return { added, files: files.map((h) => h.path), baseline, custom, tracked: [], unstaged: [], sampleExempted };
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
 * @param {{repoPath, message, push, dryRun, token, customIgnorePatterns}} opts
 *   customIgnorePatterns：逗号/换行分隔的 gitignore pattern，追加进 .gitignore（幂等）
 * @returns {{ok, steps: string[], commitSha?, pushed?, push?, remoteHeads?, error?}}
 */
export async function commitAndPush({ repoPath = '', message = '', push = true, dryRun = false, token = '', customIgnorePatterns = '', requirementsConfirmed = false, force = false } = {}) {
  const steps = [];
  if (!repoPath || !existsSync(join(repoPath, '.git'))) return { ok: false, steps: ['预检'], error: `非 git 仓库: ${repoPath || '(空)'}` };
  if (!String(message || '').trim()) return { ok: false, steps: ['预检'], error: 'commit message 必填' };
  // D13 开发者要求门禁（对齐 v1 commitPushPreflight v1.10/1.40）：要求清单存在且未核对 → 拦截。
  // 清单来源：credentialsDir()/requirements.json（外挂）→ PLUGIN_ROOT/lib/user-requirements.json（内置）。
  const userReqs = loadRequirements();
  if (userReqs.found && userReqs.items?.length && !requirementsConfirmed) {
    return {
      ok: false,
      blocked: true,
      code: 'USER_REQUIREMENTS',
      steps: ['预检'],
      error: '开发者特殊要求未核对：AI 需先逐条核对要求全部达标，再带 requirementsConfirmed:true 重新调用',
      requirements: userReqs,
      repo: repoPath,
    };
  }
  // D14 detached HEAD 防护（对齐 v1 commitPushPreflight）：HEAD 处于 detached 状态时拒绝提交，
  // 避免在无分支的游离 HEAD 上 commit 后无法推送（v1: 'HEAD 处于 detached 状态，请先 checkout 分支'）
  const curBranch = runGit(['branch', '--show-current'], { cwd: repoPath }).stdout;
  if (!curBranch) return { ok: false, steps: ['预检'], error: 'HEAD 处于 detached 状态，请先 checkout 分支' };
  if (dryRun) return { ok: true, dryRun: true, steps: ['预检', 'commit', push ? 'push' : 'skip-push'] };
  steps.push('敏感文件 .gitignore');
  // 私有库豁免（v1.24.0 语义）：GitHub 可见性 = private → 只扫描报告不写 .gitignore、不解除跟踪
  // （私有库敏感字段入库风险由仓库自身可见性兜底）；探测失败/非 GitHub origin 保守不豁免。
  let privateExempt = false;
  let visReason = '';
  const tok0 = token || resolveToken({ repoPath }).token;
  if (tok0) {
    try {
      const vis = await detectRepoVisibility({ repoPath, token: tok0 });
      if (vis.visibility === 'private') { privateExempt = true; visReason = `private(${vis.owner}/${vis.repo})`; }
    } catch { /* 探测失败保守不豁免 */ }
  }
  const gi = privateExempt
    ? { added: 0, files: scanSensitiveFiles(repoPath).map((h) => h.path), baseline: 0, custom: 0, tracked: [], unstaged: [], skipped: 'private-repo-exempt' }
    : ensureGitignore(repoPath, { customIgnorePatterns });
  // 敏感文件只报告不动作（2026-09-12 用户指令：扫描到不改动 git 忽略，由仓库方自行处理）
  if (gi.files.length) steps.push(`sensitive-scan(${gi.files.length}文件, 只报告)`);
  else if (gi?.added > 0) steps.push(`.gitignore(+${gi.added}条)`);
  if (privateExempt) steps.push(`private-exempt(${visReason})`);
  steps.push('add');
  const add = runGit(['add', '-A'], { cwd: repoPath });
  if (!add.ok) return { ok: false, steps, error: `git add 失败: ${add.stderr}` };
  const status = runGit(['status', '--porcelain'], { cwd: repoPath });
  // v1.18.1 语义：工作区干净但本地领先远端（已手动 commit 未 push）时不能直接跳过——
  // pushViaApi 用本地 HEAD 推送，领先提交照常可推；仅当「无变更 && 无领先」才真正跳过。
  // 有领先时：跳过 commit 阶段（committed 保持 false），但继续走下方 push 块。
  // D24 无变更语义（对齐 v1 v1.18.1）：工作区干净且 !push → 成功跳过（ok:true，非错误）；
  // 工作区干净且 push → 跳过 commit 阶段，push 块由 pushViaApi 内容级短路兜底「无新提交可推送」。
  let cleanSkipCommit = false;
  if (!status.stdout.trim()) {
    cleanSkipCommit = true;
    steps.push('clean-worktree');
    if (!push) {
      return { ok: true, steps, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } };
    }
    const ahead = curBranch ? runGit(['rev-list', '--count', `origin/${curBranch}..HEAD`], { cwd: repoPath }) : { ok: false };
    const aheadCount = ahead.ok ? Number(ahead.stdout || 0) : 0;
    if (ahead.ok && aheadCount > 0) steps.push('clean-领先跳过 commit，直接推');
  }
  steps.push('commit');
  if (!cleanSkipCommit) {
    // identity 兜底：仓库无局部 user 配置时用通用身份，避免 "Author identity unknown"
    const identity = runGit(['config', 'user.name'], { cwd: repoPath }).stdout
      ? []
      : ['-c', 'user.name=DSH Agent', '-c', 'user.email=agent@dsh.local'];
    const commit = runGit([...identity, 'commit', '-m', message], { cwd: repoPath });
    if (!commit.ok) {
      if (/nothing to commit|no changes added/i.test(commit.stderr)) {
        return { ok: true, steps, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } };
      }
      return { ok: false, steps, error: `git commit 失败: ${commit.stderr}` };
    }
  }
  const commitSha = runGit(['rev-parse', 'HEAD'], { cwd: repoPath }).stdout;
  if (!push) return { ok: true, steps: [...steps, 'skip-push'], commitSha, pushed: false, committed: !cleanSkipCommit };
  steps.push('push');
  // ⚠️ pushViaApi 是 async：必须 await（旧 bug：同步调用导致 pr.ok 恒 undefined，API 推送从未成功）
  const pr = await pushViaApi({ repoPath, token, force });
  if (pr.ok) {
    // D24：pr.pushed=false（内容级短路「无新提交可推送」）→ 如实 pushed:false（对齐 v1 commitPushDoPush）
    if (!pr.pushed) return { ok: true, steps, commitSha, pushed: false, push: pr };
    // D15（对齐 v1 commitPushAfterApiSuccess）拆出的独立函数：remote-ref + aux remote + autoTag + heads
    const enhanced = await enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha });
    return { ok: true, steps, commitSha, pushed: true, push: enhanced.push, autoTag: enhanced.autoTag, ...(enhanced.heads ? { remoteHeads: enhanced.heads } : {}) };
  }
  const ssh = pushViaSsh({ repoPath, force });
  if (ssh.ok) {
    const heads = await fetchRemoteHeads({ owner: ssh.owner, repo: ssh.repo, branch: ssh.branch, token }).catch(() => null);
    return { ok: true, steps, commitSha, pushed: true, push: ssh, ...(heads ? { remoteHeads: heads } : {}) };
  }
  return { ok: false, steps, commitSha, error: `推送失败（API: ${pr.reason}；SSH: ${ssh.reason}）` };
}

/**
 * API 推送成功后的增强（D15，对齐 v1 commitPushAfterApiSuccess）：更新 remote-tracking ref +
 * 确保辅助 SSH remote + dsh- 项目自动打 tag + 拉取远端 heads。三者失败不阻断推送成功，
 * 结果记入 push.remoteRef / push.auxRemote / autoTag。
 * @returns {Promise<{push, autoTag, heads?}>}
 */
async function enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha }) {
  const pushSlot = pr;
  const branchRef = pr.branch;
  const localHead = runGit(['rev-parse', 'HEAD'], { cwd: repoPath }).stdout;
  const refTarget = localHead || pr.commitSha;
  pushSlot.remoteRef = updateRemoteTrackingRef(repoPath, branchRef, refTarget);
  try {
    ensureAuxSshRemote(repoPath, pr.owner, pr.repo, { push: pushSlot });
  } catch (e) {
    pushSlot.auxRemote = `ensure-aux-remote 异常: ${e?.message || e}`;
  }
  let autoTag = null;
  try {
    autoTag = await autoTagDSHProject({ repoPath, version: readPkgVersion(repoPath), commitSha: pr.commitSha, owner: pr.owner, repo: pr.repo, token: pr.token || token });
  } catch (e) {
    autoTag = { ok: false, skipped: 'auto-tag-error', error: String(e?.message || e) };
  }
  const heads = await fetchRemoteHeads({ owner: pr.owner, repo: pr.repo, branch: pr.branch, token: pr.token || token }).catch(() => null);
  return { push: pushSlot, autoTag, heads };
}

/**
 * 推送后回传远端最近 count 次提交（SHA/标题/时间），供工具结果展示。
 * 复用 githubFetch（api.github.com）；失败返回 { ok:false }（不阻断主流程）。
 * @returns {{ok:boolean, owner?, repo?, branch?, heads?: {sha,title,date}[], error?}}
 */
export async function fetchRemoteHeads({ owner = '', repo = '', branch = '', token = '', count = 3 } = {}) {
  if (!owner || !repo) return { ok: false, error: '缺 owner/repo' };
  const q = `sha=${encodeURIComponent(branch || '')}&per_page=${Number(count) || 3}`;
  const res = await githubFetch(`/repos/${owner}/${repo}/commits?${q}`, { token, timeout: 20_000 });
  if (res.status !== 200 || !Array.isArray(res.json)) {
    return { ok: false, error: res.error || `commits ${res.status}`, heads: [] };
  }
  const heads = (res.json || []).map((c) => ({
    sha: (c?.sha || '').slice(0, 7),
    title: c?.commit?.message?.split('\n')[0] || '',
    date: c?.commit?.author?.date || '',
  })).filter((h) => h.sha);
  return { ok: true, owner, repo, branch, heads };
}

/* ───────────────────────── 推送：API 主通道 + SSH 回退 ───────────────────────── */

/** SSH 回退：ssh.github.com:443（token 401 时）。force=true 时 --force（覆盖远端历史）。 */
export function pushViaSsh({ repoPath = '', branch = '', force = false }) {
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
  const pushArgs = ['push', ...(force ? ['--force'] : []), sshUrl, `HEAD:refs/heads/${target}`];
  const r = runGit(pushArgs, { cwd: repoPath, env: { GIT_SSH_COMMAND: sshCmd } });
  if (r.ok) return { ok: true, pushed: true, method: 'ssh', force, owner: pr.owner, repo: pr.repo, branch: target };
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
  const refRes = await api(`/git/ref/heads/${targetBranch}`);
  if (isBadCredentials(refRes.error || `HTTP ${refRes.status}`) || refRes.status === 401) {
    const fb = pushViaSsh({ repoPath, branch: targetBranch });
    return fb.ok ? fb : { ok: false, pushed: false, method: 'ssh-fallback', reason: `token 失效（API 401）→ SSH 回退失败: ${fb.reason}` };
  }
  // 分支免疫（v1.12.2 语义）：仅当「请求分支在远端不存在」且「远端有不同名 default_branch」时才改用
  // 默认分支——防误建错名新分支；请求分支已存在则保持请求值（v2 旧实现无条件切 default，会误切已有分支）
  const hasRequestedRef = refRes.status === 200;
  if (!hasRequestedRef && !branchAdjusted && meta.status === 200 && meta.json?.default_branch && meta.json.default_branch !== targetBranch) {
    branchAdjusted = { from: targetBranch, to: meta.json.default_branch };
    targetBranch = meta.json.default_branch;
  }
  const refRes2 = branchAdjusted ? await api(`/git/ref/heads/${targetBranch}`) : refRes;
  if (branchAdjusted && (isBadCredentials(refRes2.error || `HTTP ${refRes2.status}`) || refRes2.status === 401)) {
    const fb = pushViaSsh({ repoPath, branch: targetBranch });
    return fb.ok ? fb : { ok: false, pushed: false, method: 'ssh-fallback', reason: `token 失效（API 401）→ SSH 回退失败: ${fb.reason}` };
  }
  const remoteHead = refRes2.status === 200 ? refRes2.json?.object?.sha : null;

  // 内容级短路（v1.12.2）：远端 HEAD==本地 HEAD 或 tree sha 相同 → 无新内容可推，不建冗余 commit。
  // force=覆盖历史：即使 tree 相同也要换 commit（去掉旧 parent）。
  if (!force) {
    if (remoteHead === headSha) {
      return { ok: true, pushed: false, reason: '无新提交可推送', owner, repo, branch: targetBranch, branchAdjusted };
    }
    if (remoteHead) {
      const localTree = runGit(['rev-parse', 'HEAD^{tree}'], { cwd: repoPath }).stdout;
      const rc = await api(`/git/commits/${remoteHead}`);
      const remoteTree = rc.json?.tree?.sha;
      if (localTree && remoteTree && localTree === remoteTree) {
        return { ok: true, pushed: false, reason: '无新提交可推送', owner, repo, branch: targetBranch, branchAdjusted };
      }
    }
  }

  // 远端已有 blob sha（复用，减少 API 调用）
  const remoteBlobShas = new Set();
  if (remoteHead) {
    const t = await api(`/git/trees/${remoteHead}?recursive=1`);
    if (t.status === 200 && Array.isArray(t.json?.tree)) {
      for (const e of t.json.tree) if (e.type === 'blob') remoteBlobShas.add(e.sha);
    }
  }
  const treeBuilt = await uploadBlobsAndBuildTree({ repoPath, entries, remoteBlobShas, api });
  if (!treeBuilt.ok) return treeBuilt.fail;

  // 建 commit（parent=远端 HEAD；force 不挂 parent）
  const msg = runGit(['log', '-1', '--format=%s'], { cwd: repoPath }).stdout || 'chore: push via api';
  const c = await api('/git/commits', 'POST', { message: msg, tree: treeBuilt.treeSha, ...(!force && remoteHead ? { parents: [remoteHead] } : {}) });
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

/**
 * 逐 blob 上传（远端已有 sha 直接复用）+ 建 tree（拆分自 pushViaApi，控制单函数行数）。
 * @returns {{ok:true, treeSha: string} | {ok:false, fail: object}}
 */
async function uploadBlobsAndBuildTree({ repoPath, entries, remoteBlobShas, api }) {
  const fail = (reason) => ({ ok: false, fail: { ok: false, pushed: false, reason } });
  const treeEntries = [];
  for (const e of entries) {
    if (remoteBlobShas.has(e.sha)) { treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha }); continue; }
    // 【修复 2026-09-11】读 blob 必须走 gitRaw（buffer 通道）：runGit 的 utf8+trim
    // 会丢末尾换行/损坏非 UTF-8 字节 → 上传 blob sha 与本地不一致（实测 17/109 文件损坏）。
    // 判据只认 status：0 = 成功（空内容是合法空 blob）；非 0 才是真失败（对齐 v1 git-core gitRaw 语义）。
    const raw = gitRaw(['cat-file', 'blob', e.sha], { cwd: repoPath });
    if (raw.status !== 0) return fail(`读 blob 失败: ${e.path}`);
    const b = await api('/git/blobs', 'POST', { content: raw.stdout.toString('base64'), encoding: 'base64' });
    if (b.status !== 201) return fail(`上传 blob 失败 ${e.path}: ${b.json?.message || b.status}`);
    treeEntries.push({ path: e.path, mode: e.mode, type: 'blob', sha: b.json.sha });
  }
  const t = await api('/git/trees', 'POST', { tree: treeEntries });
  if (t.status !== 201) return fail(`建 tree 失败: ${t.json?.message || t.status}`);
  return { ok: true, treeSha: t.json.sha };
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
  // 非空目录拒绝覆盖（防误覆盖已有内容）
  try {
    if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
      return { ok: false, error: `目标目录已存在且非空: ${targetDir}` };
    }
    mkdirSync(targetDir, { recursive: true });
  } catch (e) { return { ok: false, error: `创建目录失败: ${e?.message || e}` }; }
  let files = 0;
  for (const item of treeRes.json?.tree || []) {
    if (item.type !== 'blob') continue;
    const rel = String(item.path || '');
    if (!rel) continue;
    const out = join(targetDir, rel);
    // symlink 保真（mode 120000）：blob 内容即链接目标
    if (item.mode === '120000') {
      const linkRes = await api(`/git/blobs/${item.sha}`, 'GET');
      if (linkRes.status !== 200) continue;
      try {
        mkdirSync(dirname(out), { recursive: true });
        symlinkSync(String(linkRes.json?.content ?? linkRes.text ?? ''), out);
        files++;
      } catch { /* symlink 写失败跳过 */ }
      continue;
    }
    try { mkdirSync(dirname(out), { recursive: true }); } catch { /* 忽略 */ }
    const blob = await api(`/git/blobs/${item.sha}`, 'GET');
    if (blob.status !== 200) continue;
    try {
      // 二进制：base64 解码；文本：原文（api.github.com blob Accept 默认返回 content+encoding）
      const isBase64 = blob.json?.encoding === 'base64';
      writeFileSync(out, isBase64 ? Buffer.from(blob.json.content, 'base64') : String(blob.text ?? ''));
      // 可执行位保真（mode 100755）
      if (item.mode === '100755') { try { chmodSync(out, 0o755); } catch { /* 忽略 */ } }
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
export async function ensureRemoteRepo({ repoPath = '', owner = '', visibility = 'private', dryRun = false, token = '' } = {}) {
  const name = basename(repoPath || '');
  if (!name) return { ok: false, error: '缺仓库路径' };
  const vis = (visibility || 'private').toLowerCase() === 'public' ? 'public' : 'private';
  const tok = token || resolveToken({ repoPath }).token;
  if (!tok && !dryRun) return { ok: false, error: '无 token（配置目录 github-token 或环境变量 DSH_GIT_PUSH_TOKEN）' };
  // owner 缺省取 token 对应用户（GET /user）——保证 owner≠库名时同名检测与 origin 均正确
  let ownerName = owner || '';
  if (!ownerName) {
    const me = await githubFetch('/user', { token: tok, timeout: 15_000 });
    if (me.status === 200 && me.json?.login) ownerName = me.json.login;
    else if (dryRun) ownerName = name; // dry-run 无 token：占位 owner 继续模拟，不阻断
    else return { ok: false, error: '无法确定 owner（传 owner 参数或提供有效 token）' };
  }
  const exists = await githubFetch(`/repos/${ownerName}/${name}`, { token: tok });
  if (exists.status === 200) {
    return { ok: true, exists: true, owner: ownerName, name, visibility: vis, reason: '已存在同名仓库' };
  }
  if (dryRun) return { ok: true, dryRun: true, wouldCreate: true, owner: ownerName, name, visibility: vis };
  const created = await githubFetch('/user/repos', { token: tok, method: 'POST', body: { name, private: vis === 'private' } });
  if (created.status !== 201) return { ok: false, error: created.json?.message || created.error || `创建失败: HTTP ${created.status}` };
  if (repoPath && existsSync(join(repoPath, '.git'))) {
    const origin = `${GH_API}/repos/${ownerName}/${name}`;
    const cur = runGit(['remote', 'get-url', 'origin'], { cwd: repoPath });
    if (!cur.ok) runGit(['remote', 'add', 'origin', origin], { cwd: repoPath });
  }
  return { ok: true, created: true, owner: ownerName, name, visibility: vis, origin: `${GH_API}/repos/${ownerName}/${name}` };
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

/**
 * 脱敏 remote URL（v1.40.0）：userinfo 内嵌凭据（https://user:token@...）→ user:****@；
 * query 参数 token/access_token/private_token=xxx → ****。防 token 进会话/日志/HTTP 输出。
 */
export function maskRemoteUrl(url = '') {
  const s = String(url || '');
  if (!s) return '';
  const masked = s.replace(/^(https?:\/\/)([^/@\s]*)@/i, (m, proto, userinfo) => {
    if (!userinfo) return m;
    const i = userinfo.indexOf(':');
    return i >= 0 ? `${proto}${userinfo.slice(0, i)}:****@` : `${proto}****@`;
  });
  return masked.replace(/([?&](?:token|access_token|private_token)=)[^&\s]+/gi, '$1****');
}

/** 读取单个仓库的状态摘要（git_scan 输出项）。remote 一律脱敏防 token 泄漏。 */
function describeRepo(repoPath = '') {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath }).stdout.trim() || '(空仓)';
  const remote = maskRemoteUrl(runGit(['remote', 'get-url', 'origin'], { cwd: repoPath }).stdout.trim());
  const status = runGit(['status', '--porcelain'], { cwd: repoPath }).stdout;
  const changed = status ? status.split('\n').filter(Boolean).length : 0;
  const last = runGit(['log', '-1', '--format=%h %s'], { cwd: repoPath }).stdout.trim();
  return { path: repoPath, branch, remote, changed, lastCommit: last };
}

/* ═══════════════ 账号检查 + SSH 密钥生成（对齐 v1 token-credentials.js，2026-09-11 补齐 D34） ═══════════════ */

/** Token 脱敏（对齐 v1 maskToken：前 4…后 4；过短打 ****）。 */
export function maskToken(token = '') {
  const t = String(token || '');
  if (t.length < 8) return t ? '****' : '';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

/** 读取 SSH 公钥（配置目录 id_rsa.pub / id_ed25519.pub / id_ecdsa.pub），对齐 v1 readSshPub。 */
export function readSshPub({ workspaceRoot = '' } = {}) {
  const dir = credentialsDir({ workspaceRoot });
  for (const name of ['id_rsa', 'id_ed25519', 'id_ecdsa']) {
    const file = join(dir, `${name}.pub`);
    try {
      const pub = readFileSync(file, 'utf8').trim();
      if (pub) return { configured: true, pub, file, fingerprint: pub.length > 20 ? `${pub.slice(0, 12)}…${pub.slice(-8)}` : '' };
    } catch { /* 跳过 */ }
  }
  return { configured: false, pub: '', file: '', fingerprint: '' };
}

/**
 * 持久化 SSH 公钥（对齐 v1 persistSshPub：校验格式 → 写配置目录 *.pub）。
 * @param {string} pub 公钥内容（ssh-ed25519 / ssh-rsa / ecdsa 开头）
 * @returns {{ok:boolean, source?:string, error?:string}}
 */
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

/**
 * 校验 GitHub 账号与凭据（对齐 v1 checkGithubAccount：token 在线校验 / SSH 公钥指纹 / 绑定关系）。
 * 网络出口仅 api.github.com（githubFetch 硬闸）。
 * @param {object} [opts] { workspaceRoot, token }
 * @returns {Promise<object>} { ok, loggedIn, cookieSet, warnLevel, cred, detail, username?, ... }
 */
export async function checkGithubAccount({ workspaceRoot = '', token = '' } = {}) {
  const tok = token || resolveToken({ workspaceRoot }).token;
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
  return {
    ok: true,
    loggedIn: true,
    cookieSet: true,
    warnLevel: 'ok',
    cred,
    username: u.login,
    userId: u.id,
    name: u.name || '',
    profileUrl: u.html_url || `https://github.com/${u.login}`,
    publicRepos: u.public_repos,
    plan: u.plan?.name || '',
  };
}

/** 账号检查结果格式化为可读块（对齐 v1 formatGithubAccountBlock）。 */
export function formatGithubAccountBlock(r = {}) {
  const L = [];
  const cred = r.cred || {};
  if (!r.cookieSet) {
    L.push('❌ 未配置 Token / SSH 公钥（推送将走匿名失败）');
  } else if (r.loggedIn) {
    L.push(`✅ 已登录 GitHub：${r.username}${r.name ? `（${r.name}）` : ''}`);
    L.push(`- 公钥仓库数：${r.publicRepos ?? '?'}｜套餐：${r.plan || '?'}`);
    if (cred.hasToken) L.push(`- Token：${cred.tokenMasked || '已配置'}`);
    if (cred.hasSshPub) L.push(`- SSH 公钥：${cred.sshFingerprint || '已配置'}`);
  } else {
    L.push(`⚠️ 未登录：${r.detail || '凭据缺失'}`);
    if (cred.hasToken) L.push(`- Token：${cred.tokenMasked || '已配置'}`);
    if (cred.hasSshPub) L.push(`- SSH 公钥：${cred.sshFingerprint || '已配置'}`);
  }
  return L.join('\n');
}

/**
 * 按邮箱生成 SSH 密钥对（对齐 v1 generateSshKey：ssh-keygen -t rsa -b 4096 -C email）。
 * force=true 先改名备份旧密钥（可恢复）再生成；私钥永不离开本机。
 * @param {string} email 邮箱（x@y.z）
 * @param {object} [opts] { workspaceRoot, force }
 * @returns {{ok:boolean, error?:string, email?:string, privateKey?:string, pubFile?:string, pub?:string}}
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
  if (force) {
    const stamp = Date.now();
    for (const f of [priv, pub]) {
      try {
        if (existsSync(f)) renameSync(f, `${f}.bak-${stamp}`);
      } catch { /* 备份失败不阻断生成 */ }
    }
  }
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
