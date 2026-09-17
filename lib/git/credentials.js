/**
 * Git 执行层 · 凭据
 *
 * 职责：解析/持久化 GitHub token 与 SSH 公钥、生成 SSH 密钥、脱敏展示。
 *
 * **凭据只读写 config.json**（2026-09-16 彻底收敛）：
 *   - token   → config.json `githubToken` 键（唯一真源；不再读/写 github-token 平铺文件）
 *   - 公钥    → config.json `sshPub` 键（唯一真源；不再读/写 *.pub 平铺文件）
 *   - 私钥    → 仍是文件（id_rsa/id_ed25519/id_ecdsa，ssh 命令行必需，无法进 json）
 *   - 覆盖顺序：显式参数 → 环境变量 → 显式文件路径 → config.json
 * 明文凭据只落本机配置目录（0600），不进仓库；写入侧拒绝脱敏值（防回显串污染真凭据）。
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
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
 * token 解析（**凭据只读 config.json**，2026-09-16 彻底收敛）：
 *   1) 显式传入 opts.token
 *   2) 环境变量 DSH_GIT_PUSH_TOKEN / GITHUB_TOKEN
 *   3) opts.tokenPath（显式指定的外部文件，调用方明确给出才读）
 *   4) repoPath/.git-push-token（仓库级显式覆盖文件）
 *   5) **config.json 的 githubToken 键**（唯一真源）
 * 配置目录下的 github-token / token 平铺文件**不再作为读取来源**（历史遗留，易残留占位符/旧值，
 *   被误当有效凭据）。只回传 source，不回传明文给调用链以外的层。
 * @returns {{token: string, source: string}}
 */
export function resolveToken({ token = '', tokenPath = '', repoPath = '', workspaceRoot = '' } = {}) {
  if (String(token || '').trim()) return { token: String(token).trim(), source: 'explicit' };
  for (const env of ['DSH_GIT_PUSH_TOKEN', 'GITHUB_TOKEN']) {
    const t = String(process.env[env] || '').trim();
    // 环境变量同样校验格式（ghp_/github_pat_ 开头），非法跳过
    if (t && /^(gh[pous]_|github_pat_)/.test(t)) return { token: t, source: `env:${env}` };
  }
  // 显式指定的文件路径（调用方明确给出才读，非隐式探测）
  const explicitFiles = [];
  if (tokenPath) explicitFiles.push(tokenPath);
  if (repoPath) explicitFiles.push(join(repoPath, '.git-push-token'));
  for (const p of explicitFiles) {
    try {
      if (!existsSync(p)) continue;
      const t = readFileSync(p, 'utf8').trim();
      if (t && /^(gh[pous]_|github_pat_)/.test(t)) return { token: t, source: p };
    } catch { /* 读不到跳过 */ }
  }
  // 唯一真源：插件 config.json 的 githubToken 键
  const credDir = credentialsDir({ workspaceRoot });
  if (credDir) {
    const cfgPath = join(credDir, 'config.json');
    try {
      const t = String(readJson(cfgPath)?.githubToken || '').trim();
      if (t && /^(gh[pous]_|github_pat_)/.test(t)) return { token: t, source: cfgPath };
    } catch { /* 配置不存在/坏 JSON 跳过 */ }
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

/** 读取 SSH 公钥（2026-09-16 彻底收敛：**只读 config.json 的 sshPub 键**，不再回退 *.pub 文件）。 */
export function readSshPub({ workspaceRoot = '' } = {}) {
  const dir = credentialsDir({ workspaceRoot });
  // 1) config.json sshPub 键（persistSshPub / 设置侧边栏保存的主存）
  try {
    const cfg = join(dir, 'config.json');
    const c = readJson(cfg);
    const pub = String((c && c.sshPub) || '').trim();
    if (pub) return { configured: true, pub, file: cfg, fingerprint: pub.length > 20 ? `${pub.slice(0, 12)}…${pub.slice(-8)}` : '' };
  } catch { /* 配置不存在/坏 JSON → 视为未配置 */ }
  // 2026-09-16 彻底收敛：**不再回退读 *.pub 平铺文件**（凭据只读写 config.json，避免「文件有、
  //   json 无」两处状态打架；生成密钥后由 generateSshKey/gen-ssh-key 端点写入 config.json）。
  return { configured: false, pub: '', file: '', fingerprint: '' };
}

/**
 * 脱敏值检测（isMaskedValue）：前端回显/日志用的打码串绝不能被当作真凭据写回。
 *   命中 ⇢ 拒绝写入，防止「保存 sshkey 时把脱敏 token 覆盖真实 token」这类污染。
 */
export function isMaskedValue(v = '') {
  const s = String(v || '');
  return s.includes('…') || s.includes('****') || s.includes('...') || /^ghp_?$/.test(s) || /^gh[pous]_…/.test(s);
}

/**
 * 持久化 GitHub token（persistGithubToken）——**只写 config.json 的 githubToken 键**。
 * 2026-09-16 彻底收敛：不再写配置目录 github-token 平铺文件（历史遗留：两处状态打架、
 *   平铺文件残留占位符被误当真凭据）。读取侧同步只认 config.json。
 * @param {string} token GitHub token（ghp_ / github_pat_ 开头）
 * @param {object} [opts] { workspaceRoot }
 * @returns {{ok:boolean, file?:string, error?:string}}
 */
export function persistGithubToken(token, { workspaceRoot = '' } = {}) {
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'token 为空' };
  if (isMaskedValue(t)) return { ok: false, error: 'token 是脱敏值（含 …/****），拒绝写入——请输入完整 token' };
  if (!/^(gh[pous]_|github_pat_)/.test(t)) return { ok: false, error: 'token 格式不对（需要 ghp_ / github_pat_ 开头）' };
  const dirRes = ensureCredentialsDir(workspaceRoot);
  if (!dirRes.ok) return dirRes;
  const cfg = join(dirRes.dir, 'config.json');
  const w = updateJsonAtomic(cfg, (cur) => ({ ...cur, githubToken: t }));
  if (!w.ok) return { ok: false, error: w.error || 'config.json 写入失败' };
  return { ok: true, file: cfg, config: cfg };
}

/**
 * 持久化 SSH 公钥（persistSshPub）——**只写 config.json 的 sshPub 键**。
 * 2026-09-16 彻底收敛：不再写配置目录 *.pub 平铺文件（历史遗留：出现「公钥只落 id_rsa.pub、
 *   config.json 里没有」，设置页重启回读为空）。读取侧同步只认 config.json。
 * @param {string} pub 公钥内容（ssh-ed25519 / ssh-rsa / ecdsa 开头）
 * @returns {{ok:boolean, file?:string, error?:string}}
 */
export function persistSshPub(pub, { workspaceRoot = '' } = {}) {
  const t = String(pub || '').trim();
  if (!t) return { ok: false, error: '公钥为空' };
  if (isMaskedValue(t) && !/^ssh-/.test(t)) return { ok: false, error: '公钥是脱敏值，拒绝写入' };
  if (!/^(ssh-(ed25519|rsa|ecdsa)|ecdsa-sha2-nistp\d+)\s+\S+/.test(t)) {
    return { ok: false, error: '公钥格式不对（需要 ssh-ed25519 / ssh-rsa 开头）' };
  }
  const dirRes = ensureCredentialsDir(workspaceRoot);
  if (!dirRes.ok) return dirRes;
  const cfg = join(dirRes.dir, 'config.json');
  const w = updateJsonAtomic(cfg, (cur) => ({ ...cur, sshPub: t }));
  if (!w.ok) return { ok: false, error: w.error || 'config.json 写入失败' };
  return { ok: true, file: cfg, config: cfg };
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
  // 2026-09-16 关键修复：生成后**同步把公钥写入 config.json 的 sshPub 键**——此前只产出
  //   id_rsa.pub 文件，config.json 里没有公钥，设置页重启回读为空（「sshkey 没保存 json」的根因）。
  //   私钥仍是文件（ssh 命令必需，不能进 json）；公钥以 config.json 为真源。
  let cfgWritten = false;
  try {
    cfgWritten = updateJsonAtomic(join(dir, 'config.json'), (cur) => ({ ...cur, sshPub: pubLine })).ok;
  } catch { /* 写 config 失败不影响密钥已生成，返回值里标注 */ }
  return { ok: true, email: em, privateKey: priv, pubFile: pub, pub: pubLine, configWritten: cfgWritten };
}
