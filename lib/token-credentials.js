// dsh-git-push v1.42.0 — token/SSH 凭据管理与账号检测（自 core.js 按功能拆分，行为零变化）

import { githubFetch } from './github-api.js';
import { ensureRemoteRepo } from './remote-repo.js';
import { PLUGIN_ROOT } from './plugin-paths.js';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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
/** 检测 SSH 公钥是否绑定到当前账号（keys API 优先，404 回退 SSH 实测）。 */

async function checkSshBinding({ ssh, tok, username, workspaceRoot }) {
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
      sshBound = !!(probe.bound && (!probe.login || probe.login.toLowerCase() === String(username).toLowerCase()));
      sshBoundHow = 'ssh-auth';
      sshBoundLogin = probe.login || '';
      if (probe.bound && probe.login && probe.login.toLowerCase() !== String(username).toLowerCase()) {
        sshBound = false;
        sshBoundHow = 'ssh-other-account';
      }
      if (!probe.ok && !probe.bound) sshBoundHow = 'ssh-probe-failed';
    }
  }
  return { sshBound, sshBoundHow, sshBoundLogin };
}

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
  const { sshBound, sshBoundHow, sshBoundLogin } = await checkSshBinding({ ssh, tok, username: u.login, workspaceRoot });
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
