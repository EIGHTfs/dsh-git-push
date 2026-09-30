/**
 * 工具命令注册表（2026-09-30，方案 B——命令注册表元数据驱动，免维护 CLI）
 *
 * 单一规则源：CLI 命令、宿主工具 schema、帮助文档三处同源生成——
 *   新增/改工具只改本注册表一处，CLI 自动对齐（CLI 独立于 DSH 运行：本地 lib 直调 callTool）。
 *
 * 条目字段：
 *   name        插件工具名（宿主注册用）
 *   cli         CLI 命令名（缺省 = name 去下划线）
 *   description 工具说明（帮助/注入文本）
 *   params      参数 schema：{ flag, type: string|boolean, positional?: 位置索引,
 *                required?, default?, enum?, desc }
 *   无 cli 的命令 = 仅工具（宿主用），CLI 不生成命令。
 */

export const TOOL_REGISTRY = [
  {
    name: 'git_scan', cli: 'scan', description: '扫描 DSH workspace 下所有 git 仓库（分支/remote/未提交/未推送/最近活动）',
    params: [
      { flag: 'root', type: 'string', positional: 0, desc: '扫描根目录（默认取配置 defaultScanRoot）' },
      { flag: 'paths', type: 'string', desc: '额外仓库绝对路径（逗号分隔）' },
      { flag: 'extraReposFile', type: 'string', desc: 'extraRepos 配置文件路径（每行一个仓库）' },
    ],
  },
  {
    name: 'git_commit_push', cli: 'commit', description: '一键提交并推送（先审计 → commit → push）',
    params: [
      { flag: 'repo', type: 'string', positional: 0, required: true, desc: '仓库绝对路径' },
      { flag: 'message', type: 'string', required: true, desc: 'commit message（必填）' },
      { flag: 'push', type: 'boolean', default: true, desc: '是否推送（默认 true）' },
      { flag: 'audit', type: 'boolean', desc: '提交前审计（默认取配置）' },
      { flag: 'dryRun', type: 'boolean', desc: 'dry-run 只模拟不写入' },
      { flag: 'force', type: 'boolean', desc: 'force 强推（谨慎）' },
      { flag: 'ignorePatterns', type: 'string', desc: '自定义忽略 pattern（追加 .gitignore）' },
      { flag: 'requirementsConfirmed', type: 'boolean', desc: '已核对开发者要求' },
      { flag: 'pushConfirmed', type: 'boolean', desc: '推送门禁放行' },
      { flag: 'paths', type: 'string', desc: '精确 add 路径（逗号分隔）' },
    ],
  },
  {
    // 2026-10-05：code_audit 不给 CLI 命令（cli 缺省）——CLI audit 用 lib/cli（完整 findings，独立于 DSH）；
    //   工具 code_audit 输出 API 指引（宿主场景有聚合 API）。CLI 独立审计不能依赖宿主 API。
    name: 'code_audit', description: '审计仓库（评分/级别数量/API 查询指引）',
    params: [
      { flag: 'repo', type: 'string', positional: 0, required: true, desc: '仓库绝对路径' },
      { flag: 'scope', type: 'string', enum: ['full', 'diff'], default: 'full', desc: '审计范围' },
      { flag: 'rulesetDir', type: 'string', desc: '自定规则目录' },
      { flag: 'llm', type: 'boolean', desc: '追加 LLM 深度审查' },
      { flag: 'includeIgnored', type: 'boolean', desc: '含 .gitignore 忽略文件' },
      { flag: 'history', type: 'boolean', desc: '历史提交审计' },
      { flag: 'since', type: 'string', desc: 'history 起始提交' },
      { flag: 'until', type: 'string', desc: 'history 结束提交' },
      { flag: 'outDir', type: 'string', desc: 'history 报告目录' },
      { flag: 'json', type: 'boolean', desc: 'JSON 输出（完整返回）' },
    ],
  },
  {
    name: 'git_clone', cli: 'clone', description: '从 GitHub 远端 clone 仓库（Git Data API，不直连 github.com）',
    params: [
      { flag: 'target', type: 'string', positional: 0, required: true, desc: 'owner/repo 或完整 URL' },
      { flag: 'dest', type: 'string', desc: '目标目录（缺省 workspaceRoot）' },
      { flag: 'branch', type: 'string', desc: '分支名' },
    ],
  },
  {
    name: 'git_remote_create', cli: 'remote-create', description: '按项目文件夹创建 GitHub 远端仓库',
    params: [
      { flag: 'repo', type: 'string', positional: 0, required: true, desc: '本地 git 仓库绝对路径' },
      { flag: 'visibility', type: 'string', enum: ['public', 'private'], default: 'private', desc: '可见性' },
      { flag: 'dryRun', type: 'boolean', desc: '只探测预演' },
    ],
  },
  {
    name: 'git_set_visibility', cli: 'set-visibility', description: '切换 GitHub 仓库 public/private',
    params: [
      { flag: 'repo', type: 'string', positional: 0, required: true, desc: '本地 git 仓库绝对路径' },
      { flag: 'visibility', type: 'string', enum: ['public', 'private'], required: true, desc: 'public | private' },
    ],
  },
  {
    name: 'io_scan', cli: 'file-io', description: 'I/O 风险扫描（AST 四级分级，与审计 io-risk 同标准）',
    params: [
      { flag: 'repo', type: 'string', positional: 0, desc: '扫描目标（默认工作区）' },
      { flag: 'writeOnly', type: 'boolean', desc: '只看写操作' },
    ],
  },
  {
    name: 'git_clone_preview', cli: 'clone-preview', description: 'clone 预演（不落盘，报告将拉取什么）',
    params: [
      { flag: 'target', type: 'string', positional: 0, required: true, desc: 'owner/repo' },
      { flag: 'branch', type: 'string', desc: '分支名' },
    ],
  },
  {
    name: 'link_check', cli: 'link-check', description: '检查文档内链接有效性（只报 warning）',
    params: [
      { flag: 'path', type: 'string', positional: 0, desc: '文件或目录（默认工作区）' },
    ],
  },
  {
    name: 'module_splitter', cli: 'module-splitter', description: '巨型单文件按顶层块拆分（analyze/split/verify）',
    params: [
      { flag: 'command', type: 'string', enum: ['analyze', 'split', 'verify'], positional: 0, required: true, desc: '子命令' },
      { flag: 'file', type: 'string', desc: 'analyze 的待拆 .js 路径' },
      { flag: 'plan', type: 'string', desc: 'split/verify 的 plan.json 路径' },
      { flag: 'dryRun', type: 'boolean', desc: '只预演不落盘' },
    ],
  },
  {
    name: 'git_account_check', cli: 'account-check', description: '校验 GitHub 账号与凭据（token 在线校验 + SSH 公钥）',
    params: [
      { flag: 'sshPub', type: 'string', desc: 'SSH 公钥内容（顺带持久化）' },
      { flag: 'token', type: 'string', desc: 'GitHub token（不传自动解析）' },
    ],
  },
  {
    name: 'git_cred_env', cli: 'cred-env', description: '输出插件凭据的环境变量前缀（SSH/HTTPS 通道）',
    params: [],
  },
  {
    name: 'git_gen_ssh_key', cli: 'gen-ssh-key', description: '生成 SSH 密钥对（私钥不出本机）',
    params: [
      { flag: 'email', type: 'string', positional: 0, required: true, desc: '邮箱（x@y.z）' },
      { flag: 'force', type: 'boolean', desc: '已存在时强制覆盖（先备份）' },
    ],
  },
];

/**
 * 注册表驱动参数解析（CLI 与工具同源——schema 通用解析）：
 *   positional 按索引、--flag value/--flag=value、boolean --flag、
 *   default 填充、required/enum 校验。
 * @param {string[]} rest CLI 参数串
 * @param {Array} params 注册表 params
 * @returns {{args?: object, error?: string}}
 */
export function parseRegistryArgs(rest = [], params = []) {
  const args = {};
  const byFlag = new Map(params.map((p) => [p.flag, p]));
  const positional = params.filter((p) => p.positional !== undefined).sort((a, b) => a.positional - b.positional);
  let pi = 0;
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      const flag = eq >= 0 ? tok.slice(2, eq) : tok.slice(2);
      const p = byFlag.get(flag);
      if (!p) return { error: `未知参数 --${flag}` };
      if (p.type === 'boolean') {
        args[p.flag] = eq >= 0 ? !['false', '0'].includes(tok.slice(eq + 1)) : true;
      } else {
        const val = eq >= 0 ? tok.slice(eq + 1) : rest[i + 1];
        if (val === undefined || String(val).startsWith('--')) return { error: `--${flag} 需要值` };
        args[p.flag] = val;
        if (eq < 0) i++;
      }
    } else {
      const p = positional[pi++];
      if (!p) return { error: `多余的位置参数：${tok}` };
      args[p.flag] = tok;
    }
  }
  for (const p of params) if (args[p.flag] === undefined && p.default !== undefined) args[p.flag] = p.default;
  for (const p of params) {
    if (p.required && args[p.flag] === undefined) return { error: `缺少必填参数 ${p.flag}` };
    if (p.enum && args[p.flag] !== undefined && !p.enum.includes(args[p.flag])) return { error: `${p.flag} 取值必须为 ${p.enum.join('|')}` };
  }
  return { args };
}

/** 工具名 → 注册表项（快速查找）。 */
export function registryByName(name) {
  return TOOL_REGISTRY.find((t) => t.name === name);
}

/** CLI 命令名 → 注册表项。 */
export function registryByCli(cli) {
  return TOOL_REGISTRY.find((t) => t.cli === cli || (t.cli === undefined && t.name.replace(/_/g, '-') === cli));
}

/** 工具清单注入文本（宿主工具注册 + 帮助——同源生成）。 */
export function buildToolsListText() {
  return TOOL_REGISTRY.map((t) => `${t.name}（${t.description}）`).join(' / ');
}