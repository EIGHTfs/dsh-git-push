/**
 * dsh-git-push — dsh-repo-index 自动维护（2026-09-14 由 v1 lib/repo-index.js 移植进 v2）。
 *
 * 功能：扫描 workspace 全部 git 仓库（含嵌套 .git）+ 本地目录，自动生成 dsh-repo-index.json
 *   （唯一权威源码索引），并在推送成功后重建同步（账号卡片本地扫描同时读取它做
 *   「索引登记」标注——联动：即使本地仓库未设 remote/上游，也能显示它的 GitHub 归属）。
 *
 * 数据来源：
 *   - git remote URL            → 仓库地址 + 恢复命令（公开 ssh clone / 私有 token clone）
 *   - GitHub API（token）       → 可见性（public/private），查不到回退手工标注/未知
 *   - 各项目 package.json dsh.skills + skills/*.md frontmatter → skills 字段
 *   - workspace 顶层无 remote 的目录 → localOnly 字段
 *
 * 写入目标：插件配置目录 $DSH_HOME/git-push/dsh-repo-index.json（credentialsDir，
 *   2026-09-15 修正：原工作区 dsh-git-push-User/<owner>/ 同级仓已废除，索引收敛插件
 *   自持、不入 git；与 dsh-repo-index skill 权威位置一致）。失败全部静默降级，
 *   不阻塞扫描/推送。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

import { scanRepos, parseGithubOwnerRepo, githubFetch } from './index.js';
import { credentialsDir } from './credentials.js';

const INDEX_FILE = 'dsh-repo-index.json';

/* ───────────────────────── 读取（账号卡片本地扫描联动） ───────────────────────── */

/**
 * 找插件配置目录下的索引文件：$DSH_HOME/git-push/dsh-repo-index.json
 * （2026-09-15 修正：原 <workspaceRoot>/dsh-git-push-User/<owner>/ 已废除，
 *   凭据/索引收敛插件自持；workspaceRoot 保留作兼容入参，不再参与路径解析）。
 */
export function locateRepoIndex(workspaceRoot) {
  const p = join(credentialsDir({ workspaceRoot: workspaceRoot || '' }), INDEX_FILE);
  return existsSync(p) ? p : null;
}

/** 读索引：{ name → {owner, repo, repoUrl, visibility} }；无索引/损坏 → null。 */
export function readRepoIndexMap(workspaceRoot) {
  const p = locateRepoIndex(workspaceRoot);
  if (!p) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    const map = {};
    for (const r of Array.isArray(data.repos) ? data.repos : []) {
      if (!r || !r.name) continue;
      const m = (r.repoUrl || '').match(/\/repos\/([^/]+)\/([^/]+)\/?$/);
      map[r.name] = {
        owner: m ? m[1] : '',
        repo: m ? m[2] : r.name,
        repoUrl: r.repoUrl || '',
        visibility: r.visibility || '未知',
      };
    }
    return map;
  } catch { return null; }
}

/** 为单个本地仓库附上索引信息：目录名匹配索引条目；未命中/无索引 → null。 */
export function indexEntryForRepo(localPath, indexMap) {
  if (!indexMap || !localPath) return null;
  const name = localPath.split('/').pop() || '';
  return indexMap[name] ? { ...indexMap[name] } : null;
}

/* ───────────────────────── 生成（v1 移植：推送成功后全量重建） ───────────────────────── */

/** 解析 md frontmatter 的 name（--- 块内第一处 name: xxx） */
export function parseMdFrontmatterName(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return '';
  const n = m[1].match(/^\s*name:\s*(.+)$/m);
  return n ? n[1].trim() : '';
}

/** 收集某项目的 skill 名列表：优先 package.json dsh.skills，其次扫描 skills/*.md frontmatter */
export function collectProjectSkills(projectPath) {
  const skills = [];
  const seen = new Set();
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const declared = Array.isArray(pkg.dsh?.skills) ? pkg.dsh.skills : [];
      for (const rel of declared) {
        const name = basename(rel).replace(/\.md$/, '');
        if (name && !seen.has(name)) { seen.add(name); skills.push(name); }
      }
    } catch { /* 坏 JSON 忽略，走目录扫描 */ }
  }
  const skillsDir = join(projectPath, 'skills');
  if (existsSync(skillsDir)) {
    try {
      for (const f of readdirSync(skillsDir)) {
        if (!f.endsWith('.md')) continue;
        const name = basename(f).replace(/\.md$/, '');
        if (seen.has(name)) continue; // package.json 声明优先
        const content = readFileSync(join(skillsDir, f), 'utf8');
        const fmName = parseMdFrontmatterName(content);
        if (fmName && fmName !== name && !seen.has(fmName)) { seen.add(fmName); skills.push(fmName); }
        else if (!seen.has(name)) { seen.add(name); skills.push(name); }
      }
    } catch { /* 读不到跳过 */ }
  }
  return skills;
}

/** 从既有索引解析可见性标注：{ repoName: '公开' | '私有' }（API 查不到时回退）。 */
export function parseManualVisibility(existingContent) {
  const map = {};
  if (!existingContent) return map;
  try {
    const obj = JSON.parse(existingContent);
    if (obj && Array.isArray(obj.repos)) {
      for (const r of obj.repos) {
        if (r && r.name && (r.visibility === '公开' || r.visibility === '私有')) map[r.name] = r.visibility;
      }
    }
  } catch { /* 非 JSON 忽略 */ }
  return map;
}

/** 查 GitHub 仓库可见性；token 缺失/请求失败返回 null（回退手工/未知）。 */
async function queryGitHubVisibility(repoName, token, owner = 'EIGHTfs') {
  if (!token) return null;
  try {
    const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, { token, timeout: 10_000 });
    if (res.status !== 200 || !res.json) return null;
    const data = res.json;
    if (data.private === true || data.visibility === 'private') return '私有';
    return '公开';
  } catch {
    return null;
  }
}

/** 从 remote URL 生成仓库地址 + 恢复命令（地址统一 api.github.com/repos/o/r，恢复走 git_clone）。 */
function remoteToRepoInfo(remote, visibility) {
  if (!remote) return { repoUrl: '（无 remote）', cloneCmd: '—' };
  const pr = parseGithubOwnerRepo(remote);
  if (pr) {
    const repoUrl = `https://api.github.com/repos/${pr.owner}/${pr.repo}`;
    const cloneCmd = `git_clone target=${pr.owner}/${pr.repo}` + (visibility === '私有' ? '（私有，需 token）' : '');
    return { repoUrl, cloneCmd };
  }
  return { repoUrl: remote, cloneCmd: `git_clone target=${remote}` };
}

/** 可见性查询：GitHub API 优先（并发 4，避免串行等 28 个仓库），失败回退手工标注/未知。 */
async function buildRepoIndexVisibility({ repos, token, manualVisibility, owner }) {
  const visibilityMap = { ...manualVisibility };
  const queue = [...repos];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const r = queue.shift();
      if (!r || !r.remote) continue;
      if (!parseGithubOwnerRepo(r.remote) && !String(r.remote).includes('github.com')) continue; // 非 GitHub 仓库不查
      const pr = parseGithubOwnerRepo(r.remote);
      const api = await queryGitHubVisibility(r.name, token, pr?.owner || owner);
      if (api) visibilityMap[r.name] = api;
    }
  });
  await Promise.all(workers);
  return visibilityMap;
}

/** localOnly 收集：workspace 顶层目录（排除隐藏/已有 remote 的仓库/数据目录）。 */
function buildRepoIndexLocalOnly({ workspaceRoot, repos, localOnlyExtra }) {
  const localOnly = new Set(localOnlyExtra);
  try {
    for (const entry of readdirSync(workspaceRoot)) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'data' || entry === 'backup') continue;
      const p = join(workspaceRoot, entry);
      if (!existsSync(p) || !statSync(p).isDirectory()) continue;
      if (repos.some((r) => r.name === entry)) continue; // 已有 GitHub remote 的仓库不进 localOnly
      if (/^dsh-/.test(entry) || /DeepSeekHarness/i.test(entry)) localOnly.add(entry);
    }
  } catch { /* 读不到跳过 */ }
  return localOnly;
}

/**
 * 生成 dsh-repo-index.json 内容（JSON 结构）。
 * opts: { workspaceRoot, depth, extraRepos, extraReposFile, token, manualVisibility,
 *         localOnlyExtra, owner }
 */
export async function buildRepoIndex({ workspaceRoot, depth = 20, extraRepos = [], extraReposFile = '', token = '', manualVisibility = {}, localOnlyExtra = [], owner = 'EIGHTfs' } = {}) {
  const repos = scanRepos(workspaceRoot || '.', { depth, extraRepos, extraReposFile });
  const visibilityMap = await buildRepoIndexVisibility({ repos, token, manualVisibility, owner });

  const repoList = repos.map((r) => {
    const skills = collectProjectSkills(r.path);
    const { repoUrl, cloneCmd } = remoteToRepoInfo(r.remote, visibilityMap[r.name]);
    const vis = visibilityMap[r.name] || '未知';
    return { name: r.name, repoUrl, visibility: vis, cloneCmd, skills };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const localOnly = buildRepoIndexLocalOnly({ workspaceRoot, repos, localOnlyExtra });

  const index = {
    name: 'dsh-repo-index',
    description: '本机所有 DSH 插件/项目的 GitHub 源码索引（唯一权威）：每个项目的仓库地址、可见性（公开/私有）、恢复命令、对应 skill。任何 AI 需要恢复/克隆某个 dsh-* 插件源码、确认某项目仓库地址与可见性、本地插件目录丢失需要重建时读取本文件；其他 skill 写源码位置一律引用本索引，不各自复制仓库地址。',
    version: 1,
    generatedAt: new Date().toISOString(),
    owner,
    note: 'auto-generated by dsh-git-push: DO NOT EDIT MANUALLY',
    repos: repoList,
    localOnly: [...localOnly].sort(),
    recovery: [
      '# 1) 查本索引确认仓库地址与可见性',
      '# 2) 公开/私有统一走 git_clone（api.github.com Git Data API，需 token）',
      'git_clone { target: "OWNER/<项目名>", dest: "<目标目录>" }',
      '# 3) 恢复后按插件安装三要素装回主环境（测试实例先行 + 接管式重启）',
    ].join('\n'),
  };
  return JSON.stringify(index, null, 2) + '\n';
}

/**
 * 写入索引：既有文件原位更新；不存在写 $DSH_HOME/git-push/dsh-repo-index.json
 * （2026-09-15 修正：原 dsh-git-push-User/<owner>/ 同级仓已废除，索引收敛插件配置目录）。
 */
export function syncRepoIndex({ content, workspaceRoot = '', owner = 'EIGHTfs', syncTarget = '' } = {}) {
  const target = syncTarget || locateRepoIndex(workspaceRoot) || join(credentialsDir({ workspaceRoot: workspaceRoot || '' }), INDEX_FILE);
  try {
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, target);
    return { ok: true, written: [target] };
  } catch {
    return { ok: false, written: [] };
  }
}

/**
 * 推送成功后全量重建索引（v1 语义）。token 缺失时可见性回退既有标注/未知；
 * 任何失败静默返回 {ok:false, error}，不阻塞推送结果。
 */
export async function maintainRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '' } = {}) {
  try {
    let existing = '';
    const p = syncTarget || locateRepoIndex(workspaceRoot);
    if (p) { try { existing = readFileSync(p, 'utf8'); } catch { /* 跳过 */ } }
    const manualVisibility = parseManualVisibility(existing);
    const content = await buildRepoIndex({
      workspaceRoot, depth, extraRepos, extraReposFile,
      token, manualVisibility, owner,
    });
    const res = syncRepoIndex({ content, workspaceRoot, owner, syncTarget });
    return { ok: true, target: res.written[0] || '' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
