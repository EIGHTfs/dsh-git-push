/**
 * Git 执行层 · 凭据
 *
 * 职责：解析 GitHub token / SSH 私钥（环境变量 → 凭据文件 → settings），
 *   持久化凭据（token 与公钥写插件配置目录，0600），生成 SSH 密钥，脱敏展示。
 * 明文凭据只落本机凭据目录，不进仓库。
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJson, writeJsonAtomic, updateJsonAtomic } from './atomic-json.js';

/* ───────────────────────── 凭据：token / ssh 探测 ───────────────────────── */

/** 插件配置目录：DSH_HOME/git-push → HOME/.dsh/git-push → cwd/.dsh/git-push。 */
export function credentialsDir({ workspaceRoot = '' } = {}) {
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, 'git-push');
  if (process.env.HOME) return join(process.env.HOME, '.dsh', 'git-push');
  if (workspaceRoot) return join(dirname(resolve(workspaceRoot)), '.dsh', 'git-push');
  return join(process.cwd(), '.dsh', 'git-push');
}

/** 确保凭据目录存在（0700）。失败返回 { ok:false, error }。 */
function ensureCredentialsDir(workspaceRoot) {
  const dir = credentialsDir({ workspaceRoot });
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { return { ok: false, error: `创建凭据目录失败: ${e?.message || e}` }; }
  return { ok: true, dir };
}

/**
 * SSH 私钥探测（全部候选，按偏好顺序）：配置目录 id_rsa → id_ed25519 → id_ecdsa。
 * 与 resolveSshKey 的区别：返回全部存在的候选而非首个——配置目录里可能同时躺着一把
 * 已登记到 GitHub、一把没登记的，推送时需逐个试到能用的那把。
 * @returns {Array<{keyPath: string, kind: string}>}
 */
export function resolveSshKeys({ workspaceRoot = '' } = {}) {
  const dir = credentialsDir({ workspaceRoot });
  const found = [];
  for (const name of ['id_rsa', 'id_ed25519', 'id_ecdsa']) {
    const p = join(dir, name);
    try {
      if (existsSync(p)) found.push({ keyPath: p, kind: name });
    } catch { /* 跳过 */ }
  }
  return found;
}

/** SSH 私钥探测（首个可用）：配置目录 id_rsa → id_ed25519 → id_ecdsa。 */
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
  // 2026-09-16 真源统一为插件 config.json（设置侧边栏所有键都在这里，含 githubToken）——
  //   凭据文件（github-token）降为兜底：它可能残留占位符/旧值，此前优先读它导致
  //   「config.json 里是真 token 却报 Bad credentials」。
  // 注：按 credentialsDir() 拼 config.json 路径，不 import settings-bridge（后者反向依赖本模块）。
  const candidates = [];
  const credDir = credentialsDir({ workspaceRoot });
  if (credDir) candidates.push(join(credDir, 'config.json'));
  if (credDir) {
    candidates.push(join(credDir, 'github-token'));
    candidates.push(join(credDir, 'token'));
  }
  if (tokenPath) candidates.push(tokenPath);
  if (repoPath) candidates.push(join(repoPath, '.git-push-token'));
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, 'utf8').trim();
      // config.json 是 JSON（取 githubToken 字段）；其余候选是纯文本 token
      const t = p.endsWith('config.json') ? String(JSON.parse(raw)?.githubToken || '').trim() : raw;
      if (t && /^(gh[pous]_|github_pat_)/.test(t)) return { token: t, source: p };
    } catch { /* 读不到/非 JSON 跳过 */ }
  }
  return { token: '', source: '' };
}

/* ═══════════════ 账号检查 + SSH 密钥生成（2026-09-11 补齐 D34） ═══════════════ */

/** Token 脱敏（maskToken：前 4…后 4；过短打 ****）。 */
export function maskToken(token = '') {
  const t = String(token || '');
  if (t.length < 8) return t ? '****' : '';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

/** 读取 SSH 公钥（2026-09-16 统一：优先 config.json 的 sshPub 键，回退旧配置目录 *.pub 文件）。 */
export function readSshPub({ workspaceRoot = '' } = {}) {
  const dir = credentialsDir({ workspaceRoot });
  // 1) config.json sshPub 键（persistSshPub / 设置侧边栏保存的主存）
  try {
    const cfg = join(dir, 'config.json');
    const c = readJson(cfg);
    const pub = String((c && c.sshPub) || '').trim();
    if (pub) return { configured: true, pub, file: cfg, fingerprint: pub.length > 20 ? `${pub.slice(0, 12)}…${pub.slice(-8)}` : '' };
  } catch { /* 跳到旧文件 */ }
  // 2) 旧独立 *.pub 文件（兼容迁移前/手动放置）
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
 * 持久化 GitHub token（persistGithubToken：校验格式 → 写配置目录 github-token 0600）。
 * 侧边栏设置页保存凭据时调用（scope.watch），确保插件配置目录落盘、不依赖 DSH settings.yaml 明文。
 * @param {string} token GitHub token（ghp_ / github_pat_ 开头）
 * @param {object} [opts] { workspaceRoot }
 * @returns {{ok:boolean, source?:string, error?:string}}
 */
export function persistGithubToken(token, { workspaceRoot = '' } = {}) {
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'token 为空' };
  if (!/^(gh[pous]_|github_pat_)/.test(t)) return { ok: false, error: 'token 格式不对（需要 ghp_ / github_pat_ 开头）' };
  const dirRes = ensureCredentialsDir(workspaceRoot);
  if (!dirRes.ok) return dirRes;
  const dir = dirRes.dir;
  // 2026-09-16 统一：凭据主存 **config.json**（githubToken 键，0600 原子写）——此前只写独立
  //   github-token 文件，设置侧边栏保存/重启回读不同源。保留旧文件写入作兼容（旧读取路径仍可用）。
  const cfg = join(dir, 'config.json');
  updateJsonAtomic(cfg, (cur) => ({ ...cur, githubToken: t }));
  const file = join(dir, 'github-token');
  writeFileSync(file, `${t}\n`, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* CIFS 可能改不了 mode */ }
  return { ok: true, source: file, config: cfg };
}

/**
 * 持久化 SSH 公钥（persistSshPub：校验格式 → 写配置目录 *.pub）。
 * @param {string} pub 公钥内容（ssh-ed25519 / ssh-rsa / ecdsa 开头）
 * @returns {{ok:boolean, source?:string, error?:string}}
 */
export function persistSshPub(pub, { workspaceRoot = '' } = {}) {
  const t = String(pub || '').trim();
  if (!t) return { ok: false, error: '公钥为空' };
  if (!/^(ssh-(ed25519|rsa|ecdsa)|ecdsa-sha2-nistp\d+)\s+\S+/.test(t)) {
    return { ok: false, error: '公钥格式不对（需要 ssh-ed25519 / ssh-rsa 开头）' };
  }
  const dirRes = ensureCredentialsDir(workspaceRoot);
  if (!dirRes.ok) return dirRes;
  const dir = dirRes.dir;
  const kind = t.startsWith('ssh-ed25519') ? 'id_ed25519.pub' : t.startsWith('ssh-rsa') ? 'id_rsa.pub' : 'id_ecdsa.pub';
  const file = join(dir, kind);
  // 2026-09-16 统一：公钥主存 **config.json**（sshPub 键，0600 原子写）——此前只写独立 *.pub 文件，
  //   设置侧边栏保存/重启回读不同源（曾出现「sshkey 只存了 id_rsa.pub 未同步 config.json」）。
  //   保留 *.pub 文件写入作兼容（SSH 工具链/旧读取路径仍可用）。
  const cfg = join(dir, 'config.json');
  updateJsonAtomic(cfg, (cur) => ({ ...cur, sshPub: t }));
  writeFileSync(file, `${t}\n`, { encoding: 'utf8', mode: 0o644 });
  return { ok: true, source: file, config: cfg };
}

/**
 * 按邮箱生成 SSH 密钥对（generateSshKey：ssh-keygen -t rsa -b 4096 -C email）。
 * force=true 先改名备份旧密钥（可恢复）再生成；私钥永不离开本机。
 * @param {string} email 邮箱（x@y.z）
 * @param {object} [opts] { workspaceRoot, force }
 * @returns {{ok:boolean, error?:string, email?:string, privateKey?:string, pubFile?:string, pub?:string}}
 */
export function generateSshKey(email, { workspaceRoot = '', force = false } = {}) {
  const em = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return { ok: false, error: '邮箱格式不对（需要 x@y.z）' };
  const dirRes = ensureCredentialsDir(workspaceRoot);
  if (!dirRes.ok) return dirRes;
  const dir = dirRes.dir;
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
  try { pubLine = readFileSync(pub, 'utf8').trim(); } catch { /* 公钥读失败：下面统一报不可读 */ }
  if (!pubLine) return { ok: false, error: '公钥文件生成后不可读' };
  try { chmodSync(priv, 0o600); chmodSync(pub, 0o644); } catch { /* CIFS 卷可能改不了 mode */ }
  return { ok: true, email: em, privateKey: priv, pubFile: pub, pub: pubLine };
}
