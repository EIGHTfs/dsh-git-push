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
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    const map = {};
    for (const r of Array.isArray(parsed.repos) ? parsed.repos : []) {
      if (!r || !r.name) continue;
      const match = (r.repoUrl || '').match(/\/repos\/([^/]+)\/([^/]+)\/?$/);
      map[r.name] = {
        owner: match ? match[1] : '',
        repo: match ? match[2] : r.name,
        path: r.path || '',   // 2026-09-16：透传本地完整路径（索引重建时缓存，供列表精确定位）
        repoUrl: r.repoUrl || '',
        visibility: r.visibility || '未知',
        // 2026-09-16：透传云端合并字段（mergeCloudReposIntoIndex 写入）——本地列表
        //   刷新远端状态用：默认分支 / 云端最后推送时间 / 是否纯云端（本地无副本）/ 描述
        defaultBranch: r.defaultBranch || '',
        pushedAt: r.pushedAt || '',
        cloudOnly: !!r.cloudOnly,
        description: r.description || '',
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
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return '';
  const n = match[1].match(/^\s*name:\s*(.+)$/m);
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
    const existing = JSON.parse(existingContent);
    if (existing && Array.isArray(existing.repos)) {
      for (const r of existing.repos) {
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
    const resp = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, { token, timeout: 10_000 });
    if (resp.status !== 200 || !resp.json) return null;
    const repoData = resp.json;
    if (repoData.private === true || repoData.visibility === 'private') return '私有';
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
export async function buildRepoIndex({ workspaceRoot, depth = 20, extraRepos = [], extraReposFile = '', token = '', manualVisibility = {}, localOnlyExtra = [], owner = 'EIGHTfs', offline = false, maxRepos = 200 } = {}) {
  const repos = scanRepos(workspaceRoot || '.', { depth, extraRepos, extraReposFile, maxRepos });
  // 2026-09-16：offline=true 时**纯离线**重建（账号卡片「扫描」按钮语义）——跳过 GitHub API
  //   可见性联网查询（visibilityMap 只用既有标注 manualVisibility），全程不联网；
  //   联网可见性刷新只在 push 在线路径（offline 缺省 false）做。
  const visibilityMap = offline ? { ...manualVisibility } : await buildRepoIndexVisibility({ repos, token, manualVisibility, owner });

  // 2026-09-15：索引只存「本地所属且与登录账号一致」的仓库——有 remote 的仓库按 remote owner
  //   判定（== owner 才入列）；无 remote 的本地仓库无 GitHub 归属，不进 repoList（归入 localOnly）。
  //   此前 repoList 收纳全部 scanRepos 结果，索引会混入其他账号/无归属仓库。
  const repoList = repos
    .filter((r) => {
      if (!r.remote) return false;
      const pr = parseGithubOwnerRepo(r.remote);
      return pr ? pr.owner === owner : false;
    })
    .map((r) => {
      const skills = collectProjectSkills(r.path);
      const { repoUrl, cloneCmd } = remoteToRepoInfo(r.remote, visibilityMap[r.name]);
      const vis = visibilityMap[r.name] || '未知';
      // 2026-09-16：存本地完整路径 path（供账号卡片列表精确定位真实目录——工作区在
      //   <DSH 家根>/工作区/<repo>，不能靠 join(扫描根, name) 反推，会拼错层级）。
      return { name: r.name, path: r.path, repoUrl, visibility: vis, cloneCmd, skills };
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
    const tmpPath = `${target}.${process.pid}.tmp`;
    writeFileSync(tmpPath, content, 'utf8');
    renameSync(tmpPath, target);
    return { ok: true, written: [target] };
  } catch {
    return { ok: false, written: [] };
  }
}

/**
 * 推送成功后全量重建索引（v1 语义）。token 缺失时可见性回退既有标注/未知；
 * 任何失败静默返回 {ok:false, error}，不阻塞推送结果。
 */
export async function maintainRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '', offline = false, maxRepos = 200 } = {}) {
  try {
    let existing = '';
    const p = syncTarget || locateRepoIndex(workspaceRoot);
    if (p) { try { existing = readFileSync(p, 'utf8'); } catch { /* 跳过 */ } }
    const manualVisibility = parseManualVisibility(existing);
    // 2026-09-16：offline=true（账号卡片「扫描」）时纯离线重建——owner 过滤来自本地 remote
    //   解析（不联网），可见性回退既有标注，不给 buildRepoIndex 传 token 即不触发可见性网络。
    const content = await buildRepoIndex({
      workspaceRoot, depth, extraRepos, extraReposFile,
      token: offline ? '' : token, manualVisibility, owner, offline, maxRepos,
    });
    const sync = syncRepoIndex({ content, workspaceRoot, owner, syncTarget });
    return { ok: true, target: sync.written[0] || '' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * 云端扫描结果合并进索引（2026-09-16 新增：账号卡片「云端」扫描也写索引）。
 *
 * 语义：把 listCloudRepos 返回的云端仓库（owner 名下全部仓库）登记/更新进
 *   dsh-repo-index.json——云端仓库即使本地没有副本也登记（cloudOnly 标记），
 *   本地已有副本的条目保留本地字段（path/skills/cloneCmd）并刷新云端状态
 *   （defaultBranch/pushedAt/description/visibility 按云端真源）。
 *   任何失败静默返回 {ok:false, error}，不阻塞云端扫描响应。
 *
 * @param {object} opts
 *   { workspaceRoot, owner, cloudRepos: [{fullName,name,private,defaultBranch,pushedAt,description,cloneUrl}], syncTarget }
 * @returns {{ok:boolean, updated:number, target?:string, error?}}
 */
export function mergeCloudReposIntoIndex({ workspaceRoot = '', owner = 'EIGHTfs', cloudRepos = [], syncTarget = '' } = {}) {
  try {
    const target = syncTarget || locateRepoIndex(workspaceRoot) || join(credentialsDir({ workspaceRoot: workspaceRoot || '' }), INDEX_FILE);
    let existing = null;
    try {
      if (existsSync(target)) existing = JSON.parse(readFileSync(target, 'utf8'));
    } catch { existing = null; }
    // 保底结构：老索引/坏 JSON → 空容器，合并后写回
    const index = existing && typeof existing === 'object' && Array.isArray(existing.repos) ? existing : {
      name: 'dsh-repo-index',
      version: 1,
      generatedAt: new Date().toISOString(),
      owner,
      note: 'auto-generated by dsh-git-push: DO NOT EDIT MANUALLY',
      repos: [],
      localOnly: [],
    };
    const byName = new Map((index.repos || []).map((r) => [r.name, r]));
    let updated = 0;
    for (const cloudRepo of Array.isArray(cloudRepos) ? cloudRepos : []) {
      const name = String(cloudRepo.name || '').trim();
      if (!name) continue;
      const prev = byName.get(name);
      const repoUrl = `https://api.github.com/repos/${String(cloudRepo.fullName || `${owner}/${name}`)}`;
      // 云端真源可见性（listCloudRepos 的 private 布尔）优先，覆盖本地标注
      const visibility = cloudRepo.private === true ? '私有' : '公开';
      const next = {
        name,
        ...(prev && prev.path ? { path: prev.path } : {}),           // 保留本地完整路径
        repoUrl,
        visibility,
        ...(prev && prev.cloneCmd ? { cloneCmd: prev.cloneCmd } : {}),
        ...(prev && prev.skills ? { skills: prev.skills } : {}),
        // 云端状态字段（2026-09-16：本地列表/远端状态刷新用）
        defaultBranch: String(cloudRepo.defaultBranch || ''),
        pushedAt: String(cloudRepo.pushedAt || ''),
        description: String(cloudRepo.description || ''),
        cloudOnly: !prev,                                            // 云端有、本地索引无副本
        owner,
        repo: name,
      };
      if (!byName.has(name)) updated++;
      else if (prev && (prev.visibility !== next.visibility || prev.pushedAt !== next.pushedAt)) updated++;
      byName.set(name, next);
    }
    index.repos = [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    index.generatedAt = new Date().toISOString();
    index.owner = owner;
    const written = syncRepoIndex({ content: JSON.stringify(index, null, 2) + '\n', workspaceRoot, owner, syncTarget });
    return { ok: true, updated, ...written };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
