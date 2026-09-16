/**
 * dsh-git-push 上下文注入入口
 * 给 AI 会话注入环境：工作目录映射 / 工具安装路径 / skill 总入口。
 *
 * 2026-09-13 注入范围收敛为目录级（工具目录 / 工作区目录 / skill 总入口）：
 *   - 工具目录：从静态硬编码清单改为**实测探测**（which/where，同 v1 collectToolPaths 语义）
 *   - 工作区目录：新增工作区根 + 直接子目录映射（同 v1 mapWorkspaceDirs 语义），便于 AI 直接定位项目
 *   - skill：只给总目录入口一行（不注入正文、不列文件清单）
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** 默认工具清单（探测失败时的静态兜底；探测成功以实测路径为准）。 */
export const DEFAULT_TOOLS = {
  git: '/usr/bin/git',
  node: '/usr/bin/node',
  npm: '/usr/bin/npm',
  python3: '/usr/bin/python3',
  curl: '/usr/bin/curl',
};

/** 默认探测的工具清单（名称 → 版本参数；null 表示只查路径）。 */
export const DEFAULT_TOOL_PROBES = [
  { name: 'git', versionArgs: ['--version'] },
  { name: 'node', versionArgs: ['--version'] },
  { name: 'npm', versionArgs: ['--version'] },
  { name: 'python3', versionArgs: ['--version'] },
  { name: 'curl', versionArgs: ['--version'] },
  { name: 'ssh', versionArgs: ['-V'] },
  { name: 'unzip', versionArgs: ['-version'] },
  { name: 'rsync', versionArgs: ['--version'] },
  { name: '7z', versionArgs: ['-version'] },
];

/**
 * 探测单个工具的安装路径（command -v 语义；Windows 走 where）。
 * 纯只读 + 短超时，失败返回 found:false 不抛错。
 * @param {string} name 工具名
 * @param {string[]} [versionArgs] 版本参数
 * @returns {{name:string, path:string, version:string, found:boolean}}
 */
export function probeToolPath(name, versionArgs = []) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  let r;
  try {
    r = spawnSync(finder, [name], { encoding: 'utf8', timeout: 8000, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch { return { name, path: '', version: '', found: false }; }
  const path = String(r.stdout || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
  if (!path) return { name, path: '', version: '', found: false };
  let version = '';
  if (versionArgs.length) {
    try {
      const v = spawnSync(path, versionArgs, { encoding: 'utf8', timeout: 8000, stdio: ['pipe', 'pipe', 'ignore'] });
      const out = `${(v.stdout || '').trim()} ${(v.stderr || '').trim()}`.trim();
      const first = out.split(/\r?\n/)[0] || '';
      version = first.length > 120 ? first.slice(0, 120) : first;
    } catch { /* 版本读不到不影响路径注入 */ }
  }
  return { name, path, version, found: true };
}

/**
 * 批量探测工具安装路径。
 * @param {Array<{name:string, versionArgs?:string[]}>} [probes]
 * @returns {Array<object>}
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
 * 映射工作区目录：cwd、项目实际目录（git 根）、父级链、直接子目录。
 * @param {{workspaceRoot?:string, cwd?:string, maxChildren?:number}} opts
 * @returns {{cwd:string, projectDir:string, parents:string[], children:string[], workspaceRoot:string}}
 */
export function mapWorkspaceDirs({ workspaceRoot = '', cwd = process.cwd(), maxChildren = 40 } = {}) {
  const cur = resolve(cwd);
  const root = workspaceRoot ? resolve(workspaceRoot) : cur;
  let projectDir = root;
  try {
    const gitProbe = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: cur, encoding: 'utf8', timeout: 8000, stdio: ['pipe', 'pipe', 'ignore'],
    });
    const top = String(gitProbe.stdout || '').trim();
    if (gitProbe.status === 0 && top) projectDir = resolve(top);
  } catch { /* 非 git 目录：回退 workspaceRoot */ }
  const parents = [];
  let p = cur;
  for (let i = 0; i < 32 && p && p !== dirname(p); i++) {
    parents.push(p);
    p = dirname(p);
  }
  if (p) parents.push(p);
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
 * 生成 AI 环境注入文本（注入 systemPrompt section；必须同步返回）。
 *
 * 注入内容（只到目录级：工具目录 + 工作区目录 + skill 总入口）：
 *   ① 当前工作目录 / 项目实际目录 / skills **总入口**（只给目录路径，不注正文、不列文件清单）
 *   ② 工作区根 + 直接子目录（便于直接定位项目）
 *   ③ 工具安装路径（探测结果，格式 name=path / …）
 *
 * @param {{cwd?:string, projectRoot?:string, tools?:object|Array, workspace?:object}} opts
 *   tools：{name:path} 对象（旧签名兼容）或 collectToolPaths() 数组（推荐，带版本）
 *   workspace：mapWorkspaceDirs() 结果（可选，缺失则跳过工作区目录段）
 */
export function createEnvInjectionText({ cwd = '', projectRoot = '', tools = DEFAULT_TOOLS, workspace = null } = {}) {
  const lines = [];
  lines.push('【dsh-git-push 环境注入】');
  lines.push(`- 当前工作目录 cwd：${cwd}`);
  if (projectRoot) {
    lines.push(`- 项目实际目录（git 根）：${projectRoot}`);
    lines.push(`- skills 目录：${join(projectRoot, 'skills')}（存在：${existsSync(join(projectRoot, 'skills'))}）`);
  }
  // 工作区目录映射（工作区根 + 直接子目录）
  if (workspace && typeof workspace === 'object') {
    if (workspace.workspaceRoot) lines.push(`- 工作区根目录：${workspace.workspaceRoot}`);
    if (Array.isArray(workspace.children) && workspace.children.length) {
      lines.push(`- 工作区子目录：${workspace.children.join(' / ')}`);
    }
  }
  // 工具目录：数组（探测结果）或对象（旧签名）
  let toolPairs = [];
  if (Array.isArray(tools)) {
    toolPairs = tools.filter((t) => t && t.found && t.path).map((t) => `${t.name}=${t.path}`);
  } else {
    toolPairs = Object.entries(tools || {}).map(([k, v]) => `${k}=${v}`);
  }
  lines.push(`- 工具：${toolPairs.join(' / ')}`);
  return lines.join('\n');
}

/**
 * 路径归属判定：确认 `target` 是否位于 `root` 之下（防目录穿越，跨主机定位用）。
 * @param {string} root 根目录绝对路径
 * @param {string} target 待判定路径
 * @returns {boolean} true=属于该根（或等于根）
 */
export function isWithinRoot(root = '', target = '') {
  const norm = (p) => {
    const s = String(p ?? '').trim();
    if (!s) return '';
    const stripped = s.replace(/\/+$/, ''); // 去尾斜杠（多重也归一）
    return stripped || '/'; // 根 '/' 去尾斜杠后为空 → 还原为 '/'
  };
  const r = norm(root);
  const t = norm(target);
  if (!r || !t) return false;
  if (r === '/') return t.startsWith('/'); // 根目录包含一切绝对路径
  return t === r || t.startsWith(r + '/');
}

/**
 * 提取注入段落的键值结构（机器可读，供解析测试）。
 * @param {string} text createEnvInjectionText 输出
 * @returns {object} { cwd, projectRoot, skillsDir, tools: {k:v} }
 */
export function parseEnvInjection(text = '') {
  // 字段预置为空串：无对应行时回读为 ''（而非 undefined），消费方无需再判空
  const out = { cwd: '', projectRoot: '', skillsDir: '', workspaceRoot: '', children: [], tools: {} };
  for (const line of String(text).split('\n')) {
    const match = /^\- ([^：:]+)：(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1].trim();
    const lineValue = match[2].trim();
    if (key === '当前工作目录 cwd') out.cwd = lineValue;
    else if (key.startsWith('项目实际目录')) out.projectRoot = lineValue;
    else if (key.startsWith('skills 目录')) out.skillsDir = lineValue.replace(/（存在：.*）$/, '');
    else if (key.startsWith('工作区根目录')) out.workspaceRoot = lineValue;
    else if (key.startsWith('工作区子目录')) out.children = lineValue.split(' / ').map((x) => x.trim()).filter(Boolean);
    else if (key === '工具') {
      for (const pair of lineValue.split(' / ')) {
        const [k, v] = pair.split('=');
        if (k && v !== undefined) out.tools[k.trim()] = v.trim();
      }
    }
  }
  return out;
}