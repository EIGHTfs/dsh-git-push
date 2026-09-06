/**
 * dsh-git-push 环境注入（v1.26.0）：agent/pre-step 钩子注入两类信息
 *   1. 工作目录映射 —— 当前 cwd、项目实际目录、父子目录树（父级链 + 直接子目录）
 *   2. 工具安装路径 —— 探测 python3/node/git/ffmpeg 等安装位置 + 版本，
 *      并把清单写入同级仓 dsh-git-push-User 的 tools-index.md（仓库存一份，跨机可查）
 *
 * 全部纯函数，可单测。工具探测用 spawnSync（零依赖，禁 which 之外副作用）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

/** 默认探测的工具清单：名称 → 版本参数（null 表示只查路径） */
export const DEFAULT_TOOL_PROBES = [
  { name: 'python3', versionArgs: ['--version'] },
  { name: 'python', versionArgs: ['--version'] },
  { name: 'node', versionArgs: ['--version'] },
  { name: 'npm', versionArgs: ['--version'] },
  { name: 'git', versionArgs: ['--version'] },
  { name: 'ffmpeg', versionArgs: ['-version'] },
  { name: 'ffprobe', versionArgs: ['-version'] },
  { name: '7z', versionArgs: ['-version'] },
  { name: '7zz', versionArgs: ['-version'] },
  { name: 'aria2c', versionArgs: ['--version'] },
  { name: 'curl', versionArgs: ['--version'] },
  { name: 'wget', versionArgs: ['--version'] },
  { name: 'unzip', versionArgs: ['-version'] },
  { name: 'rsync', versionArgs: ['--version'] },
  { name: 'ssh', versionArgs: ['-V'] },
];

/**
 * 探测单个工具安装路径（command -v 语义；Windows 走 where）。
 * @param {string} name 工具名
 * @param {string[]} [versionArgs] 版本探测参数
 * @returns {{ name: string, path: string, version: string, found: boolean }}
 */
export function probeToolPath(name, versionArgs = []) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [name], { encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'ignore'] });
  const path = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  if (!path) return { name, path: '', version: '', found: false };
  let version = '';
  if (versionArgs.length) {
    const v = spawnSync(path, versionArgs, { encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'ignore'] });
    const out = `${(v.stdout || '').trim()} ${(v.stderr || '').trim()}`.trim();
    // 版本输出常有多行（ffmpeg 版权头），取第一行核心
    const first = out.split(/\r?\n/)[0] || '';
    version = first.length > 200 ? first.slice(0, 200) : first;
  }
  return { name, path, version, found: true };
}

/**
 * 批量探测工具安装路径。
 * @param {Array<{name: string, versionArgs?: string[]}>} [probes]
 * @returns {Array<{name: string, path: string, version: string, found: boolean}>}
 */
export function collectToolPaths(probes = DEFAULT_TOOL_PROBES) {
  const seen = new Set();
  const out = [];
  for (const p of probes) {
    if (!p || !p.name || seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(probeToolPath(p.name, p.versionArgs || []));
  }
  return out;
}

/**
 * 映射工作目录：当前 cwd、项目实际目录（cwd 的 git 根或 workspaceRoot）、父级目录链、直接子目录。
 * @param {{ workspaceRoot?: string, cwd?: string, maxChildren?: number }} opts
 * @returns {{ cwd: string, projectDir: string, parents: string[], children: string[], workspaceRoot: string }}
 */
export function mapWorkspaceDirs({ workspaceRoot = '', cwd = process.cwd(), maxChildren = 60 } = {}) {
  const cur = resolve(cwd);
  const root = workspaceRoot ? resolve(workspaceRoot) : cur;
  // 项目实际目录：cwd 若在 git 仓库内 → git 根；否则回退 workspaceRoot
  let projectDir = root;
  try {
    const g = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: cur, encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'ignore'],
    });
    const top = (g.stdout || '').trim();
    if (g.status === 0 && top) projectDir = resolve(top);
  } catch { /* 非 git 目录 */ }
  // 父级链：cwd → 父 → 祖父…到文件系统根
  const parents = [];
  let p = cur;
  for (let i = 0; i < 32 && p && p !== dirname(p); i++) {
    parents.push(p);
    p = dirname(p);
  }
  if (p) parents.push(p);
  // 直接子目录（跳过 .git/node_modules/隐藏目录）
  const children = [];
  try {
    if (statSync(projectDir).isDirectory()) {
      for (const ent of readdirSync(projectDir, { withFileTypes: true })) {
        if (children.length >= maxChildren) break;
        if (!ent.isDirectory()) continue;
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'build') continue;
        children.push(ent.name);
      }
      children.sort();
    }
  } catch { /* 目录不可读 */ }
  return { cwd: cur, projectDir, parents, children, workspaceRoot: root };
}

/**
 * 格式化「工作目录映射」注入文本。
 * @param {{ cwd: string, projectDir: string, parents: string[], children: string[] }} map
 * @returns {string}
 */
export function formatWorkspaceEnvInjection(map) {
  const parts = [
    '【dsh-git-push 环境注入：工作目录映射】当前会话/项目目录关系如下：',
    '',
    `- 当前工作目录 cwd：${map.cwd}`,
    `- 项目实际目录（git 根）：${map.projectDir}`,
  ];
  parts.push('', '- 父级目录链（近 → 远）：');
  for (const p of map.parents) parts.push(`  - ${p}`);
  parts.push('', `- ${map.projectDir} 直接子目录（共 ${map.children.length} 个）：`);
  if (map.children.length) parts.push('  ' + map.children.join(' / '));
  else parts.push('  （无）');
  parts.push('', '用途：确认「当前在哪 / 项目在哪 / 目录归属」，跨会话、跨主机定位文件与仓库时以此为准。');
  return parts.join('\n');
}

/**
 * 格式化「工具安装路径」注入文本。
 * @param {Array<{name: string, path: string, version: string, found: boolean}>} tools
 * @returns {string}
 */
export function formatToolsEnvInjection(tools) {
  const found = tools.filter((t) => t.found);
  const missing = tools.filter((t) => !t.found);
  const parts = ['【dsh-git-push 环境注入：工具安装路径】本机已探测工具（清单已同步到 dsh-git-push-User/tools-index.md）：'];
  if (found.length) {
    for (const t of found) {
      parts.push(`- ${t.name}: ${t.path}${t.version ? `（${t.version}）` : ''}`);
    }
  } else {
    parts.push('  （未探测到任何工具）');
  }
  if (missing.length) {
    parts.push('', '未安装：' + missing.map((t) => t.name).join(' / '));
  }
  parts.push('', '用途：写代码/脚本时直接引用绝对路径，无需 command -v 再探测；换机部署按 tools-index.md 核对工具齐全度。');
  return parts.join('\n');
}

/**
 * 把工具清单写入同级仓 dsh-git-push-User 的 tools-index.md（幂等；目录缺失自动创建）。
 * @param {{ workspaceRoot?: string, userDir?: string, tools?: Array } } opts
 * @returns {{ ok: boolean, file: string, error?: string }}
 */
export function ensureToolsIndexFile({ workspaceRoot = '', userDir = '', tools = [] } = {}) {
  const dir = userDir || (workspaceRoot ? join(resolve(workspaceRoot), 'dsh-git-push-User') : '');
  if (!dir) return { ok: false, file: '', error: '无法确定 dsh-git-push-User 目录' };
  const file = join(dir, 'tools-index.md');
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const found = tools.filter((t) => t.found);
    const lines = [
      '# 工具安装路径索引（tools-index）',
      '',
      '> 由 dsh-git-push 插件自动生成（agent/pre-step 注入时更新），记录本机常用工具安装路径。',
      '> 换机部署 / 排查「工具在哪」时以此为准；项目内自备工具副本规则见 project-self-tools.md。',
      '',
      '| 工具 | 安装路径 | 版本 |',
      '| --- | --- | --- |',
    ];
    for (const t of found) {
      lines.push(`| ${t.name} | \`${t.path}\` | ${t.version ? '`' + t.version.replace(/\|/g, '/') + '`' : '—'} |`);
    }
    lines.push('', '---', '', '未安装：' + (tools.filter((t) => !t.found).map((t) => t.name).join(' / ') || '（全部已安装）'));
    writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    return { ok: true, file };
  } catch (e) {
    return { ok: false, file, error: String(e?.message || e) };
  }
}

/**
 * 组合注入：工作目录映射 + 工具路径（一次调用生成全部注入文本）。
 * @param {{ workspaceRoot?: string, cwd?: string, probeTools?: boolean }} opts
 * @returns {{ dirsText: string, toolsText: string, tools: Array, map: Object }}
 */
export function buildEnvInjection({ workspaceRoot = '', cwd = process.cwd(), probeTools = true } = {}) {
  const map = mapWorkspaceDirs({ workspaceRoot, cwd });
  const tools = probeTools ? collectToolPaths() : [];
  return {
    map,
    tools,
    dirsText: formatWorkspaceEnvInjection(map),
    toolsText: probeTools ? formatToolsEnvInjection(tools) : '',
  };
}

/**
 * 组合注入（自定义工具清单）：只探测配置里指定的工具名。
 * @param {string[]} names 自定义工具名（如 ['python3','ffmpeg']）
 * @param {{ workspaceRoot?: string, cwd?: string }} opts
 * @returns {{ dirsText: string, toolsText: string, tools: Array, map: Object }}
 */
export function buildEnvInjectionWithTools(names, { workspaceRoot = '', cwd = process.cwd() } = {}) {
  const map = mapWorkspaceDirs({ workspaceRoot, cwd });
  const probes = names.map((name) => {
    const known = DEFAULT_TOOL_PROBES.find((t) => t.name === name);
    return { name, versionArgs: known ? known.versionArgs : [] };
  });
  const tools = collectToolPaths(probes);
  return {
    map,
    tools,
    dirsText: formatWorkspaceEnvInjection(map),
    toolsText: formatToolsEnvInjection(tools),
  };
}
