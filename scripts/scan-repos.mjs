#!/usr/bin/env node
/**
 * dsh-git-push — 本地仓库「独立进程」离线扫描（增量流式）
 *
 * 由 HTTP 端点 `POST /api/git-push/repos-local-scan` 以 child_process.spawn 拉起，
 * 独立于宿主/主进程运行（扫描 CPU 密集，绝不卡前台/拖垮宿主）。
 *
 * 逐仓流式：每扫到一个 owner(账号) 一致的仓库 →
 *   ① 增量写 scan-live.json（version 递增、found 追加）——宿主 fs.watchFile 变化即唤醒
 *      前端等待者，前端只追加这一个（不全量重读）；
 *   ② 把该仓库并入 dsh-repo-index.json（读-改-写追加 entry，不覆盖其他）。
 *   全部扫完 → scan-live.json done:true → 前端收到收尾。
 *
 * 纯离线：只扫本地 .git，owner 用离线账号 json 比对，不联网（可见性回退「未知」）。
 * 性能限制：--depth、--max 防拖垮系统；每仓库打一行 stdout 供宿主导出。
 *
 * 用法：node scripts/scan-repos.mjs --root <root> --owner <owner> [--depth 10] [--max 200]
 * 退出码：0=成功，非0=失败
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 以脚本位置解析仓库根：<repo>/scripts/ → <repo>
const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function liveFile(wr) { return join(cfgDir(wr), 'scan-live.json'); }
function indexFile(wr) { return join(cfgDir(wr), 'dsh-repo-index.json'); }
function cfgDir(wr) { return credentialsDir({ workspaceRoot: wr || REPO_ROOT }); }

let credentialsDir = null;
let scanRepos = null;
let parseGithubOwnerRepo = null;
let readAccountStatus = null;
let buildRepoListEntry = null;

async function main() {
  const root = arg('--root', '');
  const owner = arg('--owner', 'EIGHTfs');
  const depth = Number(arg('--depth', '10')) || 10;
  const max = Number(arg('--max', '200')) || 200;
  if (!root) { console.error('缺 --root（扫描根路径）'); process.exit(2); }

  // 顶层懒加载（独立进程 ESM，仅需的模块）
  ({ credentialsDir } = await import(`${REPO_ROOT}/lib/git/credentials.js`));
  ({ scanRepos } = await import(`${REPO_ROOT}/lib/git/repos.js`));
  ({ parseGithubOwnerRepo } = await import(`${REPO_ROOT}/lib/git/api.js`));
  try { ({ readAccountStatus } = await import(`${REPO_ROOT}/lib/git/account-status.js`)); } catch { /* 可选 */ }

  // 离线段 owner：优先账号 json 快照（不联网）；无则参数/默认
  let scanOwner = owner;
  if (readAccountStatus) {
    try {
      const acct = readAccountStatus({ workspaceRoot: REPO_ROOT });
      if (acct && acct.username) scanOwner = acct.username;
    } catch { /* 忽略 */ }
  }

  process.stdout.write(`SCAN start root=${root} owner=${scanOwner} depth=${depth} max=${max}\n`);
  const repos = scanRepos(root, { depth, maxRepos: max });
  let foundCount = 0;
  const scanned = new Set(); // 本轮扫到的仓库名（用于清理索引残留，见下）
  for (const r of repos) {
    if (!r || !r.remote) continue;
    const pr = parseGithubOwnerRepo(r.remote);
    if (!pr || pr.owner !== scanOwner) continue; // 只登记与离线账号 owner 一致的仓库
    scanned.add(r.name);
    pushLive({ workspaceRoot: REPO_ROOT, found: [r.name], done: false });
    appendIndexEntry({
      workspaceRoot: REPO_ROOT,
      owner: scanOwner,
      entry: {
        name: r.name,
        path: r.path || '',
        repoUrl: `https://api.github.com/repos/${pr.owner}/${pr.repo}`,
        visibility: '未知',   // 离线不查 GitHub API，可见性回退未知
        cloneCmd: `git_clone target=${pr.owner}/${pr.repo}`,
        skills: [],
      },
    });
    foundCount += 1;
    process.stdout.write(`SCAN found ${r.name} (${foundCount})\n`);
  }
  // 2026-09-16：清理索引残留——此前只「追加/更新」不删除，被 .gitignore 忽略后不再扫到的
  //   仓库（如 DeepSeekHarness-NAS 的 source 构建产物）会永远留在索引里。这里按本轮结果
  //   剔除「owner 一致但本轮未扫到」的条目，保证索引 = 本次扫描结果。
  const removed = pruneIndex({ workspaceRoot: REPO_ROOT, owner: scanOwner, scanned });
  if (removed.length) process.stdout.write(`SCAN pruned ${removed.join(',')}\n`);
  pushLive({ workspaceRoot: REPO_ROOT, found: [], done: true });
  process.stdout.write(`SCAN done ok=true count=${foundCount}\n`);
  process.exit(0);
}

/** 剔除索引中「owner 一致但本轮未扫到」的条目，返回被移除的仓库名（保证索引=扫描结果）。 */
function pruneIndex({ workspaceRoot, owner, scanned }) {
  const p = indexFile(workspaceRoot);
  let doc = null;
  try { if (existsSync(p)) doc = JSON.parse(readFileSync(p, 'utf8')); } catch { return []; }
  if (!doc || !Array.isArray(doc.repos)) return [];
  const removed = [];
  const kept = doc.repos.filter((r) => {
    if (!r || !r.name) return false;
    if (scanned.has(r.name)) return true;
    // 只清理「本账号所属」的条目（别的 owner 的条目不动，避免误删手动登记的）
    const match = String(r.repoUrl || '').match(/\/repos\/([^/]+)\//);
    const rowOwner = match ? match[1] : '';
    if (rowOwner && rowOwner !== owner) return true;
    removed.push(r.name);
    return false;
  });
  if (!removed.length) return [];
  doc.repos = kept;
  doc.generatedAt = new Date().toISOString();
  const dir = dirname(p); mkdirSync(dir, { recursive: true });
  const tmpPath = `${p}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, p);
  return removed;
}

/** 递增写 scan-live.json：version+1、found 追加、done 标记。 */
function pushLive({ workspaceRoot, found, done }) {
  const p = liveFile(workspaceRoot);
  let cur = { version: 0, found: [], startedAt: '', done: false };
  try { if (existsSync(p)) cur = JSON.parse(readFileSync(p, 'utf8')); } catch { /* 忽略 */ }
  cur.version = (Number(cur.version) || 0) + 1;
  if (Array.isArray(found)) for (const f of found) if (!cur.found.includes(f)) cur.found.push(f);
  cur.done = !!done;
  const dir = dirname(p); mkdirSync(dir, { recursive: true });
  const tmpPath = `${p}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(cur, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, p);
}

/** 把单条仓库 entry 追加进 dsh-repo-index.json（读-改-写，不覆盖其他）。 */
function appendIndexEntry({ workspaceRoot, entry, owner }) {
  const p = indexFile(workspaceRoot);
  let doc = null;
  try { if (existsSync(p)) doc = JSON.parse(readFileSync(p, 'utf8')); } catch { /* 忽略 */ }
  if (!doc || !Array.isArray(doc.repos)) {
    doc = { name: 'dsh-repo-index', description: '', version: 1, generatedAt: new Date().toISOString(), owner: owner || 'EIGHTfs', repos: [], localOnly: [] };
  }
  const i = doc.repos.findIndex((r) => r && r.name === entry.name);
  if (i >= 0) doc.repos[i] = entry; else doc.repos.push(entry);
  doc.generatedAt = new Date().toISOString();
  const dir = dirname(p); mkdirSync(dir, { recursive: true });
  const tmpPath = `${p}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, p);
}

main().catch((e) => {
  console.error('SCAN fail:', e && e.message || e);
  process.exit(4);
});