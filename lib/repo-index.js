/**
 * dsh-git-push — dsh-repo-index 维护模块（v1.3.0）
 *
 * 功能：扫描 workspace 全部 git 仓库 + 本地目录，自动生成 dsh-repo-index.md
 *       （唯一权威源码索引 skill），并在 push 成功后由 lib/index.js 调用同步。
 *
 * 数据来源：
 *   - git remote URL            → 仓库地址 + 恢复命令（公开 ssh clone / 私有 token clone）
 *   - GitHub API（token）       → 可见性（public/private），查不到回退手工标注/未知
 *   - 各项目 package.json dsh.skills + skills/*.md frontmatter → 「对应 skill」列
 *   - workspace 顶层无 remote 的目录 → 「本地 only」部分
 *
 * 设计：纯函数、不依赖 ctx（仅 node 内置 + fetch），可独立单测（test-repo-index.mjs）。
 * 同步语义：权威源 = 插件项目 skills/dsh-repo-index.md（随 git 版本管理）；
 *           生效副本 = 运行实例的用户级 skills 目录（由 config repoIndexSyncTarget 指定，
 *           未指定时探测 DSH_HOME）。
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { scanRepos, githubFetch, parseGithubOwnerRepo, apiOriginOf } from './core.js';

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

/** 从既有索引解析手工可见性标注：{ repoName: '公开' | '私有' } */
export function parseManualVisibility(existingContent) {
  const map = {};
  if (!existingContent) return map;
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
    // 2026-09-02：走 githubFetch。用户原话：「所有功能都默认api.github.com」
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
 * 用户原话：「修复此插件，使所有功能都默认api.github.com」
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
 * 生成完整 dsh-repo-index.md 内容。
 * opts: {
 *   workspaceRoot, depth, extraRepos,
 *   tokenPath          — GitHub token 文件路径（可选）
 *   manualVisibility   — { repoName: '公开'|'私有' } 手工标注基线（查 API 失败时回退）
 *   localOnlyExtra     — 额外纳入「本地 only」的目录名数组（自动扫描之外）
 * }
 */
export async function buildRepoIndex({ workspaceRoot, depth = 3, extraRepos = [], extraReposFile = '', tokenPath = '', manualVisibility = {}, localOnlyExtra = [] } = {}) {
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

  const rows = repos.map((r) => {
    const skills = collectProjectSkills(r.path);
    const { repoUrl, cloneCmd } = remoteToRepoInfo(r.remote, visibilityMap[r.name]);
    const vis = visibilityMap[r.name] || '未知';
    const skillCell = skills.length ? skills.join(' / ') : '—';
    return `| ${r.name} | \`${repoUrl}\` | ${vis} | ${cloneCmd} | ${skillCell} |`;
  }).sort((a, b) => a.localeCompare(b));

  // 本地 only：workspace 顶层目录（排除隐藏/排除已有 remote 的仓库/排除数据目录）
  const localOnly = new Set(localOnlyExtra);
  try {
    for (const entry of readdirSync(workspaceRoot)) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'data' || entry === 'backup') continue;
      const p = join(workspaceRoot, entry);
      if (!existsSync(p) || !statSync(p).isDirectory()) continue;
      if (repos.some((r) => r.name === entry)) continue; // 已有 GitHub remote 的仓库不进本地 only
      if (/^dsh-/.test(entry) || /DeepSeekHarness/i.test(entry)) localOnly.add(entry);
    }
  } catch { /* 读不到跳过 */ }

  const lines = [];
  lines.push('---');
  lines.push('name: dsh-repo-index');
  lines.push('description: 本机所有 DSH 插件/项目的 GitHub 源码索引（统一维护，唯一权威）：每个项目的中文名、仓库地址、可见性（公开/私有）、恢复命令、对应 skill。任何 AI 在任何会话遇到「插件文件丢失/本地副本损坏/需要重新拉取源码/确认某项目仓库地址」时加载；其他 skill 如需写源码位置一律引用本索引，不要各自复制仓库地址。');
  lines.push('whenToUse: 需要恢复/克隆某个 dsh-* 插件源码、确认某项目在 GitHub 的仓库地址与可见性、本地插件目录丢失或损坏需要重建、写文档/skill 需要引用源码位置时。');
  lines.push('---');
  lines.push('');
  lines.push('# DSH 插件/项目源码索引（dsh-repo-index）');
  lines.push('');
  lines.push('> 本索引是**唯一权威**：所有 dsh-* 插件/项目的源码位置都在这里。');
  lines.push('> 其他 skill / README 如需写源码位置，一律写「见 dsh-repo-index」，**不要各自复制仓库地址**（副本会失同步，已踩坑）。');
  lines.push('>');
  lines.push(`> ⚙️ 本索引由 **dsh-git-push 插件**（v1.3.0+）在推送成功后自动维护生成：仓库清单来自 git remote，`);
  lines.push('> 「对应 skill」列来自各项目 package.json dsh.skills + skills/*.md，可见性来自 GitHub API（token）。');
  lines.push('> 权威源在 dsh-git-push 仓库 `skills/dsh-repo-index.md`，本文件为同步副本，**请勿手改**。');
  lines.push('');
  lines.push('## 一、GitHub 仓库清单（EIGHTfs 账号下）');
  lines.push('');
  lines.push('| 项目 | 仓库地址 | 可见性 | 恢复命令 | 对应 skill |');
  lines.push('|------|----------|--------|----------|-----------|');
  for (const row of rows) lines.push(row);
  lines.push('');
  lines.push('> 命名模式：仓库地址一律 `https://api.github.com/repos/EIGHTfs/<项目名>`；恢复走 `git_clone`（api.github.com Git Data API，不直连 github.com）。');
  lines.push('> 私有仓库 clone 需 GitHub token（resolveGitToken 多源探测；本机常见位置插件 User/<用户名>/github-token）。');
  lines.push('');
  lines.push('## 二、无 GitHub 仓库的项目（本地 only）');
  lines.push('');
  lines.push('以下 workspace 目录**没有** git remote（未推送 GitHub），本地删除即不可恢复，注意备份：');
  lines.push('');
  const localOnlyList = [...localOnly].sort();
  lines.push('`' + localOnlyList.join('`、`') + '`');
  lines.push('');
  lines.push('> ⚠️ 其中部分插件实际安装在主实例/测试实例的 node_modules（如 dsh-whale-musume 在 node_modules_local），');
  lines.push('> 目录文件丢失时**先看 node_modules 里的部署副本**，GitHub 没有就找部署副本或本地备份。');
  lines.push('');
  lines.push('## 三、恢复流程（插件文件丢失时）');
  lines.push('');
  lines.push('```');
  lines.push('# 1) 查本索引确认仓库地址与可见性');
  lines.push('# 2) 公开/私有统一走 git_clone（api.github.com Git Data API，需 token）');
  lines.push('git_clone { target: "EIGHTfs/<项目名>", dest: "<目标目录>" }');
  lines.push('# 3) 恢复后按插件安装三要素装回主环境（测试实例先行 + 接管式重启）');
  lines.push('```');
  lines.push('');
  lines.push('## 四、维护约定');
  lines.push('');
  lines.push('- **权威源**：dsh-git-push 仓库 `skills/dsh-repo-index.md`（唯一手改/生成入口），本 .dsh/skills 副本由插件同步');
  lines.push('- **自动维护**：git_commit_push 推送成功后插件自动重新生成（新增/改名/删除仓库、skill 变化、可见性变化都会反映）');
  lines.push('- **手工标注**：GitHub API 查不到的仓库可见性（无 token/网络失败/非 GitHub remote）保留手工标注或标「未知」');
  lines.push('- **skill 引用**：其他 skill 写源码位置一律「见 dsh-repo-index」，不复制地址（防副本失同步）');
  lines.push('- **验证可见性**：改可见性后（公开↔私有）推送任意仓库即自动刷新');
  lines.push('');
  lines.push('<!-- auto-generated by dsh-git-push: DO NOT EDIT MANUALLY -->');
  lines.push('');
  return lines.join('\n');
}

/** 写入权威源 + 同步生效副本；返回写入结果 */
export function syncRepoIndex({ content, sourcePath, syncTarget }) {
  const written = [];
  const doWrite = (p) => {
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, 'utf8');
      written.push(p);
      return true;
    } catch { return false; }
  };
  let ok = true;
  if (sourcePath) ok = doWrite(sourcePath) && ok;
  if (syncTarget && syncTarget !== sourcePath) ok = doWrite(syncTarget) && ok;
  return { ok, written };
}

/** 探测运行实例的用户级 skills 目录（DSH_HOME 或常见位置），用于默认同步目标 */
export function detectSkillsDir() {
  const candidates = [
    process.env.DSH_HOME ? join(process.env.DSH_HOME, 'skills') : '',
    join(process.cwd(), '.dsh', 'skills'),
    '/vol1/@appshare/DeepSeekHarness/.dsh/skills',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (existsSync(c)) return c; } catch { /* 跳过 */ }
  }
  return candidates[0] || '';
}

export { execSync };
