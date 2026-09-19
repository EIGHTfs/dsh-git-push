/**
 * dsh-git-push 上下文注入入口
 * 给 AI 会话注入环境：工作目录映射 / 工具安装路径 / skill 总入口。
 *
 * 2026-09-13 注入范围收敛为目录级（工具目录 / 工作区目录 / skill 总入口）。
 * 2026-09-20 工具清单 json 化（路径不再写死）：
 *   - 模板：lib/tool-probes.json（**只有工具 key、值为空**，随仓库提交，决定探测哪些工具）
 *   - 探测：which/where 实测（同 v1 collectToolPaths 语义），结果落盘运行目录
 *     <配置目录>/tools.json（工具为 key、**值为本机实测路径**，不入库、可热改）
 *   - 注入：上下文（agent/pre-step，见 lib/app/apply.js）按运行目录 json 注入，模板只控探测范围
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hostname as osHostname, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic } from '../git/atomic-json.js';

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

/** 内置工具版本参数（json 模板只列工具名；版本参数保持代码内默认，探测时用）。 */
export const TOOL_VERSION_ARGS = {
  git: ['--version'],
  node: ['--version'],
  npm: ['--version'],
  python3: ['--version'],
  curl: ['--version'],
  ssh: ['-V'],
  unzip: ['-version'],
  rsync: ['--version'],
  '7z': ['-version'],
  tar: ['--version'],
  gzip: ['--version'],
  bzip2: ['--version'],
  xz: ['--version'],
  zstd: ['--version'],
  lz4: ['--version'],
  zip: ['--version'],
  rar: [],
  unrar: [],
  synopkg: [],
  synouser: [],
  synogroup: [],
  synoshare: [],
  synoacltool: [],
  smartctl: ['--version'],
  mdadm: ['--version'],
  btrfs: ['--version'],
  lvm: ['version'],
  fnpack: ['--version'],
  'appcenter-cli': ['--version'],
  docker: ['--version'],
  ffmpeg: ['-version'],
  pnpm: ['--version'],
  bash: ['--version'],
  wget: ['--version'],
  jq: ['--version'],
  yq: ['--version'],
  rg: ['--version'],
  fd: ['--version'],
  scp: [],
  tmux: ['-V'],
  screen: ['--version'],
  gcc: ['--version'],
  'g++': ['--version'],
  make: ['--version'],
  'pkg-config': ['--version'],
};

/** 工具清单模板 json 位置（lib/tool-probes.json，随插件仓库提交）。 */
const TEMPLATE_FILE = fileURLToPath(new URL('../tool-probes.json', import.meta.url));

/**
 * 读取工具清单模板 json：工具为 key、值为空（模板只定探测范围，不写死路径）。
 * 返回 [{name, path:'', versionArgs}]；文件缺失 / 坏 JSON / 空 → 回退内置 DEFAULT_TOOL_PROBES。
 * @param {string} [file] 模板路径（缺省 lib/tool-probes.json）
 */
export function loadToolProbeTemplate(file = TEMPLATE_FILE) {
  try {
    if (file && existsSync(file)) {
      const obj = JSON.parse(String(readFileSync(file, 'utf8')));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const out = [];
        for (const [name, val] of Object.entries(obj)) {
          const n = String(name || '').trim();
          if (!n) continue;
          // Windows 工具可能是 .exe（如 7z.exe）：去掉后缀查版本参数表，探测时自动补 .exe
          const bare = n.replace(/\.exe$/i, '');
          out.push({ name: n, path: typeof val === 'string' ? val.trim() : '', versionArgs: TOOL_VERSION_ARGS[bare] || [] });
        }
        if (out.length) return out;
      }
    }
  } catch { /* 模板坏/不可读 → 回退内置清单 */ }
  return DEFAULT_TOOL_PROBES.map((p) => ({ ...p, path: '' }));
}

/**
 * 探测单个工具的安装路径（command -v 语义；Windows 走 where）。
 * 纯只读 + 短超时，失败返回 found:false 不抛错。
 * Windows 兼容（2026-09-20）：工具可能是 .exe——where 找不到裸名时自动补 `${name}.exe`
 *   再试（如 git.exe / 7z.exe），命中后路径原样带 .exe 后缀返回。
 * @param {string} name 工具名
 * @param {string[]} [versionArgs] 版本参数
 * @returns {{name:string, path:string, version:string, found:boolean}}
 */
export function probeToolPath(name, versionArgs = []) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const candidates = process.platform === 'win32'
    ? [name, /\.exe$/i.test(name) ? '' : `${name}.exe`].filter(Boolean)
    : [name];
  let path = '';
  for (const cand of candidates) {
    let r;
    try {
      r = spawnSync(finder, [cand], { encoding: 'utf8', timeout: 8000, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch { continue; }
    path = String(r.stdout || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
    if (path) break;
  }
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
 * @param {Array<{name:string, versionArgs?:string[]}>} [probes] 显式探测清单（缺省读模板 json）
 * @param {{templateFile?:string, resultFile?:string}} [opts]
 *   templateFile：模板 json 路径（缺省 lib/tool-probes.json；仅当 probes 未传时生效）
 *   resultFile：探测结果落盘 json（工具为 key、值为实测路径；只写探测到的；空=不落盘）
 * @returns {Array<object>}
 */
export function collectToolPaths(probes = null, { templateFile = TEMPLATE_FILE, resultFile = '' } = {}) {
  const list = probes || loadToolProbeTemplate(templateFile);
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || !p.name || seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(probeToolPath(p.name, p.versionArgs || []));
  }
  if (resultFile) {
    const w = writeToolResult(resultFile, out);
    if (!w.ok) { /* 落盘失败不阻断注入（需要排查时由调用方日志兜底） */ }
  }
  return out;
}

/**
 * 把探测结果写成 {工具名: 实际路径} 的 json（运行目录 tools.json；原子写，只写探测到的）。
 * @param {string} file 目标绝对路径
 * @param {Array<object>} results collectToolPaths() 探测结果数组
 * @returns {{ok:boolean, file:string, error?:string, tools:number}}
 */
export function writeToolResult(file = '', results = []) {
  const map = {};
  for (const r of results) {
    if (r && r.found && r.path && r.name) map[r.name] = r.path;
  }
  const w = writeJsonAtomic(file, map, { mode: 0o600 });
  return { ...w, tools: Object.keys(map).length };
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
 * 生成 AI 环境注入文本（注入上下文 agent/pre-step；必须同步返回）。
 *
 * 2026-09-20 起走上下文注入（不再进 systemPrompt section）：每次会话每个 agent
 * 首次 step 注入一次（见 lib/app/apply.js 的 registerPreStepInjection 接线）。
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
/**
 * 探测本机运行主机名 + 局域网 IPv4（过滤 internal/回环/链路本地，多网卡全列）。
 * @returns {{hostname: string, ips: string[]}}
 */
export function detectLocalHost() {
  let host = '';
  try { host = osHostname(); } catch { /* 探测失败给空 */ }
  const ips = [];
  try {
    for (const list of Object.values(networkInterfaces() || {})) {
      for (const net of list || []) {
        if (net.family !== 'IPv4' || net.internal) continue;
        const ip = String(net.address || '').trim();
        if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
        if (!ips.includes(ip)) ips.push(ip);
      }
    }
  } catch { /* 探测失败给空 */ }
  return { hostname: host, ips };
}

export function createEnvInjectionText({ cwd = '', projectRoot = '', tools = DEFAULT_TOOLS, workspace = null, host = null } = {}) {
  const lines = [];
  lines.push('【dsh-git-push 环境注入】');
  lines.push(`- 当前工作目录 cwd：${cwd}`);
  // 运行主机 + 局域网 IP（默认实时探测；测试可注入 host 覆盖）
  const h = host && typeof host === 'object' ? host : detectLocalHost();
  const hostLine = h && h.hostname
    ? `- 运行主机：${h.hostname}` + (Array.isArray(h.ips) && h.ips.length ? `（${h.ips.join(' / ')}）` : '')
    : '';
  if (hostLine) lines.push(hostLine);
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
  const out = { cwd: '', projectRoot: '', skillsDir: '', workspaceRoot: '', children: [], host: { hostname: '', ips: [] }, tools: {} };
  for (const line of String(text).split('\n')) {
    const match = /^\- ([^：:]+)：(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1].trim();
    const lineValue = match[2].trim();
    if (key === '当前工作目录 cwd') out.cwd = lineValue;
    else if (key.startsWith('运行主机')) {
      // 格式：主机名（ip1 / ip2）——括号段可选
      const paren = /^([^（(]*)(?:[（(](.*)[）)])?$/.exec(lineValue);
      out.host.hostname = (paren ? paren[1] : lineValue).trim();
      if (paren && paren[2]) {
        out.host.ips = paren[2].split(/[/、]/).map((x) => x.trim()).filter(Boolean);
      }
    }
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