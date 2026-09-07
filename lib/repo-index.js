/**
 * dsh-git-push — dsh-repo-index 维护模块（v1.27.0）
 *
 * 功能：扫描 workspace 全部 git 仓库 + 本地目录，自动生成 dsh-repo-index.json
 *       （唯一权威源码索引，JSON 格式），并在 push 成功后由 lib/index.js 调用同步
 *       到同级仓 dsh-git-push-User/<owner>/dsh-repo-index.json（owner 为变量账号）。
 *
 * 数据来源：
 *   - git remote URL            → 仓库地址 + 恢复命令（公开 ssh clone / 私有 token clone）
 *   - GitHub API（token）       → 可见性（public/private），查不到回退手工标注/未知
 *   - 各项目 package.json dsh.skills + skills/*.md frontmatter → skills 字段
 *   - workspace 顶层无 remote 的目录 → localOnly 字段
 *
 * 设计：纯函数、不依赖 ctx（仅 node 内置 + fetch），可独立单测（test-repo-index.mjs）。
 * v1.27.0：md 表格索引废弃（删 dsh-repo-index.md），改为 JSON 结构；同步目标改为
 *          dsh-git-push-User/<owner>/dsh-repo-index.json（resolveUserDir 探测 owner 变量）。
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { scanRepos, githubFetch, parseGithubOwnerRepo, apiOriginOf, resolveUserDir } from './core.js';

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

/** 从既有索引解析可见性标注：{ repoName: '公开' | '私有' }。v1.27.0 兼容两种来源： */
export function parseManualVisibility(existingContent) {
  const map = {};
  if (!existingContent) return map;
  // 新 JSON 索引（dsh-repo-index.json）：repos[].name + visibility 字段
  try {
    const obj = JSON.parse(existingContent);
    if (obj && Array.isArray(obj.repos)) {
      for (const r of obj.repos) {
        if (r && r.name && (r.visibility === '公开' || r.visibility === '私有')) map[r.name] = r.visibility;
      }
      return map;
    }
  } catch { /* 非 JSON，走旧 md 表格解析 */ }
  // 旧 md 表格（dsh-repo-index.md 历史格式，向后兼容）
  for (const line of existingContent.split('\n')) {
    const m = line.match(/^\|\s*([\w-]+)\s*\|\s*(`?[^|`]+`?)\s*\|\s*(\*\*)?(公开|私有|未知)(\*\*)?\s*\|/);
    if (m) map[m[1]] = m[4];
  }
  return map;
}

/** 查 GitHub 仓库可见性；token 缺失/请求失败返回 null（回退手工/未知） */
export async function queryGitHubVisibility(repoName, token) {
  if (!token) return null;
  try {
    // 2026-09-02：走 githubFetch。「所有功能都默认api.github.com」
    // 【原代码】fetch(`https://api.github.com/repos/EIGHTfs/${encodeURIComponent(repoName)}`, { headers, ... })
    const res = await githubFetch(`/repos/EIGHTfs/${encodeURIComponent(repoName)}`, { token, timeout: 10_000 });
    if (res.status !== 200 || !res.json) return null;
    const data = res.json;
    if (data.private === true) return '私有';
    if (data.visibility === 'private') return '私有';
    return '公开';
  } catch {
    return null;
  }
}

/**
 * 从 remote URL 生成仓库地址 + 恢复命令。
 * 2026-09-02：地址写成 api.github.com/repos/o/r，恢复命令走 git_clone（不写 git clone github.com）。
 * 「修复此插件，使所有功能都默认api.github.com」
 * 【原代码】归一化为 git@github.com:EIGHTfs/x.git；私有 git clone https://<token>@github.com/...
 * 【思路】本机 github.com 直连不可靠；索引里的恢复命令必须指向插件 API 通道。
 */
export function remoteToRepoInfo(remote, visibility) {
  if (!remote) return { repoUrl: '（无 remote）', cloneCmd: '—' };
  const pr = parseGithubOwnerRepo(remote);
  if (pr && pr.owner === 'EIGHTfs') {
    const repoUrl = apiOriginOf(pr.owner, pr.repo);
    const cloneCmd = `git_clone target=${pr.owner}/${pr.repo}` + (visibility === '私有' ? '（私有，需 token）' : '');
    return { repoUrl, cloneCmd };
  }
  if (pr) {
    return { repoUrl: apiOriginOf(pr.owner, pr.repo), cloneCmd: `git_clone target=${pr.owner}/${pr.repo}` };
  }
  return { repoUrl: remote, cloneCmd: `git_clone target=${remote}` };
}

/**
 * 生成 dsh-repo-index.json 内容（v1.27.0：JSON 结构，替代旧 md 表格）。
 * opts: {
 *   workspaceRoot, depth, extraRepos,
 *   tokenPath          — GitHub token 文件路径（可选）
 *   manualVisibility   — { repoName: '公开'|'私有' } 手工标注基线（查 API 失败时回退）
 *   localOnlyExtra     — 额外纳入 localOnly 的目录名数组（自动扫描之外）
 *   owner              — GitHub 账号变量（resolveUserDir 探测，默认 EIGHTfs）
 * }
 * @returns {string} JSON.stringify(obj, null, 2) 序列化结果（含 DO NOT EDIT 注释字段）
 */
export async function buildRepoIndex({ workspaceRoot, depth = 3, extraRepos = [], extraReposFile = '', tokenPath = '', manualVisibility = {}, localOnlyExtra = [], owner = 'EIGHTfs' } = {}) {
  const repos = scanRepos({ root: workspaceRoot, depth, extraRepos, extraReposFile });
  const token = tokenPath && existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '';

  // 可见性：GitHub API 优先，失败回退手工标注/未知
  const visibilityMap = { ...manualVisibility };
  const failed = [];
  for (const r of repos) {
    const remote = r.remote || '';
    // 2026-09-02：同时认 api.github.com origin 与历史 github.com/SSH
    if (!parseGithubOwnerRepo(remote) && !remote.includes('github.com')) continue; // 非 GitHub 仓库不查
    const api = await queryGitHubVisibility(r.name, token);
    if (api) visibilityMap[r.name] = api;
    else failed.push(r.name);
  }

  // v1.27.0：JSON 结构（替代 md 表格）
  const repoList = repos.map((r) => {
    const skills = collectProjectSkills(r.path);
    const { repoUrl, cloneCmd } = remoteToRepoInfo(r.remote, visibilityMap[r.name]);
    const vis = visibilityMap[r.name] || '未知';
    return { name: r.name, repoUrl, visibility: vis, cloneCmd, skills };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // 本地 only：workspace 顶层目录（排除隐藏/排除已有 remote 的仓库/排除数据目录）
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
 * v1.27.0：写入 dsh-repo-index.json 到同级仓 dsh-git-push-User/<owner>/ 下（唯一位置）。
 * 不再写插件 skills/ 权威源（dsh-repo-index.md 已废弃删除）。
 * @param {{ content: string, userDir: string, owner: string, syncTarget?: string }} o
 *   content   — buildRepoIndex 序列化出的 JSON 字符串
 *   userDir   — 同级仓 dsh-git-push-User 目录（resolveUserDir().dir）
 *   owner     — GitHub 账号变量（resolveUserDir().user）
 *   syncTarget— 可选覆盖目标路径（默认 join(userDir, 'dsh-repo-index.json')）
 * @returns {{ ok: boolean, written: string[] }}
 */
export function syncRepoIndex({ content, userDir = '', owner = 'EIGHTfs', syncTarget = '' } = {}) {
  // v1.27.1：默认目标 = 账号文件夹下（dsh-git-push-User/<owner>/dsh-repo-index.json），不是仓根
  const target = syncTarget || (userDir ? join(userDir, owner, 'dsh-repo-index.json') : '');
  if (!target) return { ok: false, written: [] };
  const written = [];
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
    written.push(target);
    return { ok: true, written };
  } catch {
    return { ok: false, written };
  }
}

/** 探测运行实例的用户级 skills 目录（DSH_HOME 或常见位置），用于默认同步目标 */
/**
 * 定位 JSON 索引文件。优先 syncTarget，其次 User 仓 <owner>/dsh-repo-index.md 同级的 json。
 * md 表格已废弃，不再作为权威源。
 */
export function resolveRepoIndexFile({ workspaceRoot = '', owner = '', syncTarget = '' } = {}) {
  if (syncTarget) return syncTarget;
  const { dir: userDir, user } = resolveUserDir({ workspaceRoot });
  const acc = owner || user || 'EIGHTfs';
  if (!userDir) return '';
  const nested = join(userDir, acc, 'dsh-repo-index.json');
  const flat = join(userDir, 'dsh-repo-index.json');
  try { if (existsSync(nested)) return nested; } catch { /* 跳过 */ }
  try { if (existsSync(flat)) return flat; } catch { /* 跳过 */ }
  return nested;
}

/**
 * 会话注入文本。full=false（默认）只给文件名/路径；full=true 再塞 JSON 正文。
 */
export function formatRepoIndexInjection({ workspaceRoot = '', owner = '', syncTarget = '', full = false } = {}) {
  const file = resolveRepoIndexFile({ workspaceRoot, owner, syncTarget });
  const lines = [
    '【dsh-repo-index JSON（权威源；md 表格已废弃）】',
  ];
  if (!file) {
    lines.push('同级仓 dsh-git-push-User 未就绪，索引文件尚未定位。下次 git_commit_push 推送成功后自动生成 JSON。');
    return lines.join('\n');
  }
  lines.push(`文件：${file}`);
  let exists = false;
  try { exists = existsSync(file); } catch { exists = false; }
  if (!full) {
    lines.push(exists
      ? '默认只注入文件名。查仓库地址/可见性/恢复命令请读这个 JSON。设置「注入 repo-index 全文」可改为注入正文。'
      : '文件尚未生成；下次 git_commit_push 推送成功后自动写出。');
    return lines.join('\n');
  }
  if (!exists) {
    lines.push('文件尚未生成，无法注入正文。下次 git_commit_push 推送成功后自动写出。');
    return lines.join('\n');
  }
  try {
    const body = readFileSync(file, 'utf8');
    lines.push('以下为 JSON 正文：', '', body.trimEnd());
    return lines.join('\n');
  } catch (e) {
    lines.push(`读取失败: ${e?.message || e}`);
    return lines.join('\n');
  }
}

export function detectSkillsDir() {
  // 2026-09-07 修改：硬编码审计新增后，不再写死本机 .dsh/skills 绝对路径。
  // 【原代码】candidates 第三项写死 NAS 上 .dsh/skills
  // 【改为】DSH_HOME / cwd / HOME 推导；找不到返回空串（调用方自行处理）。
  // 【触发】gitpush 增加审计硬编码功能，测试就用插件本身
  // 【思路】skills 目录随实例走，写死 NAS 卷换机即失效；HOME 兜底覆盖旧部署。
  const candidates = [
    process.env.DSH_HOME ? join(process.env.DSH_HOME, 'skills') : '',
    join(process.cwd(), '.dsh', 'skills'),
    process.env.HOME ? join(process.env.HOME, '.dsh', 'skills') : '',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch { /* 跳过 */ }
  }
  return candidates[0] || '';
}

export { execSync };
