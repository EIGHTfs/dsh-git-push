/**
 * 工具命令注册表（方案 B——命令注册表元数据驱动，免维护 CLI）
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
    name: 'git_scan', cli: 'scan', description: '扫描 git 仓库（分支/remote/未提交/未推送/最近活动）。root=扫描根目录、paths=额外仓库（逗号分隔）、extraReposFile=仓库清单文件——查「哪些仓库有改动/未推送」用它',
    params: [
      { flag: 'root', type: 'string', positional: 0, desc: '扫描根目录（默认取配置 defaultScanRoot）' },
      { flag: 'paths', type: 'string', desc: '额外仓库绝对路径（逗号分隔）' },
      { flag: 'extraReposFile', type: 'string', desc: 'extraRepos 配置文件路径（每行一个仓库）' },
    ],
  },
  {
    name: 'git_commit_push', cli: 'commit', description: '一键提交并推送：一次调用 = 审计（blocker 拦截，可关）→ 有改动才 commit → 有可推内容才 push。零改动是**正常成功路径**：返回 ok:true + committed:false（job 状态 completed，不是失败）；远端已最新则 ok:true + pushed:false；本地领先远端的已提交内容照样会推。message 必填（零改动时用不到）；requirementsConfirmed=true（开发者要求全部核对达标）——**存在要求清单时任何调用都要带**（与有无改动、是否推送无关）；push=false 只提交；dryRun 只模拟',
    params: [
      { flag: 'repo', type: 'string', positional: 0, required: true, desc: '仓库绝对路径' },
      { flag: 'message', type: 'string', required: true, desc: 'commit message（字符串，必填）：可写整条提交信息；要传结构化多条目请用 messageItems（它会作为要点与正文）' },
      // ⚠️ 数组/对象形态**必须走独立参数**：宿主在进插件之前先按工具 JSON schema 校验参数，
      //   而它对 message 这类标量参数只认 type:'string'（实测 anyOf 与「类型数组」两种写法
      //   都被读成 string ✗，报 invalid arguments: "message" must be a string ⇒ 非字符串根本到不了插件 ✓）
      { flag: 'messageItems', type: 'array', desc: '结构化条目数组：元素为字符串，或 {what,type?,scope?,why?,verify?,refs?}；仅 what 必填，type/scope/why/verify/refs 可空' },
      { flag: 'push', type: 'boolean', default: true, desc: '是否推送（默认 true）' },
      { flag: 'audit', type: 'boolean', desc: '提交前审计（默认取配置）' },
      { flag: 'dryRun', type: 'boolean', desc: 'dry-run 只模拟不写入' },
      { flag: 'force', type: 'boolean', desc: 'force 强推（谨慎）' },
      { flag: 'ignorePatterns', type: 'string', desc: '自定义忽略 pattern（追加 .gitignore）' },
      { flag: 'requirementsConfirmed', type: 'boolean', desc: '已核对开发者要求' },
      { flag: 'pushConfirmed', type: 'boolean', desc: '推送门禁放行' },
      { flag: 'paths', type: 'string', desc: '精确 add 路径（逗号分隔）' },
      { flag: 'auditExemptPaths', type: 'array', desc: '本次提交按文件临时豁免审计（数组，相对仓库根）：所列文件的 finding 不参与拦截判定（含 blocker）；仅本次有效，不落盘、不改 .auditignore' },
      { flag: 'auditExemptReason', type: 'string', desc: '豁免理由（可选，仅回显，不作拦截条件）' },
      { flag: 'remote', type: 'string', desc: '推送目标 remote（多 remote / fork 场景；缺省 origin）。推送与核验使用同一 remote' },
    ],
  },
  {
    name: 'exempt', description: '注释豁免工具：给文件加/删 dsh-skip-* 豁免注释（自动选标记、校验真生效）。action=add/remove/list/check；path 相对仓库根（支持数组）；scope=header|line；rule 用于推导标记（写错会拒绝并给正确标记）',
    params: [
      { flag: 'action', type: 'string', required: true, enum: ['add', 'remove', 'list', 'check'], desc: '动作：add 加 / remove 删 / list 盘点 / check 校验' },
      { flag: 'repo', type: 'string', desc: '仓库根（缺省当前工作目录）' },
      { flag: 'path', type: 'array', desc: '目标文件（相对仓库根；数组支持多文件，多文件时不允许 line）' },
      { flag: 'line', type: 'number', desc: '1-based 行号（scope=line 且单文件时必填）' },
      { flag: 'scope', type: 'string', enum: ['header', 'line'], desc: 'header=文件头前 3 行 / line=该行行尾' },
      { flag: 'rule', type: 'string', desc: '规则名（如 maintainability/max-complexity），用于推导正确标记' },
      { flag: 'marker', type: 'string', desc: '显式指定 dsh-skip-*（与 rule 推导冲突时报错）' },
      { flag: 'reason', type: 'string', desc: '写进注释的理由（可选）' },
      { flag: 'dryRun', type: 'boolean', desc: '只预览不写盘' },
    ],
  },
  {
    // code_audit 不给 CLI 命令（cli 缺省）——CLI audit 用 lib/cli（完整 findings，独立于 DSH）；
    //   工具 code_audit 输出 API 指引（宿主场景有聚合 API）。CLI 独立审计不能依赖宿主 API。
    name: 'code_audit', description: '审计仓库：L0 静态检查+10 维度评分（0-100）。默认精简输出（评分/问题数/豁免统计/API 指引）；includeFindings=true 返回全量 findings；scope=full|diff；history=历史提交审计',
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
      { flag: 'includeFindings', type: 'boolean', desc: 'true 时返回全量审计结果（findings+yaml）' },
    ],
  },
  {
    name: 'git_clone', cli: 'clone', description: '从 GitHub clone 仓库（Git Data API，不直连 github.com）。target=owner/repo 或完整 URL、dest=目标目录（缺省 workspaceRoot，已存在非空拒绝防覆盖）、branch=分支、history=重建真实提交历史（可推回远端；默认关，走整树快照）',
    params: [
      { flag: 'target', type: 'string', positional: 0, required: true, desc: 'owner/repo 或完整 URL' },
      { flag: 'dest', type: 'string', desc: '目标目录（缺省 workspaceRoot）' },
      { flag: 'branch', type: 'string', desc: '分支名' },
      // 真实历史模式（**默认开**）：用 git fetch 取回原始对象，克隆结果与远端逐字节一致；
      //   传 history=false 可退回整树快照（与远端无祖先、不能推回）。
      { flag: 'history', type: 'boolean', default: true, desc: '重建真实提交历史（默认开；传 false 退回整树快照）' },
      { flag: 'historyDepth', type: 'number', desc: 'history 模式拉链深度上限（不传=全量历史）' },
    ],
  },
  {
    name: 'git_remote_create', cli: 'remote-create', description: '按项目文件夹创建 GitHub 远端仓库（缺省 private；dryRun 只探测预演不创建）',
    params: [
      { flag: 'repo', type: 'string', positional: 0, required: true, desc: '本地 git 仓库绝对路径' },
      { flag: 'visibility', type: 'string', enum: ['public', 'private'], default: 'private', desc: '可见性' },
      { flag: 'dryRun', type: 'boolean', desc: '只探测预演' },
    ],
  },
  {
    name: 'git_set_visibility', cli: 'set-visibility', description: '切换 GitHub 仓库 public/private（改 public 有敏感信息暴露风险——先确认无凭据/隐私）',
    params: [
      { flag: 'repo', type: 'string', positional: 0, required: true, desc: '本地 git 仓库绝对路径' },
      { flag: 'visibility', type: 'string', enum: ['public', 'private'], required: true, desc: 'public | private' },
    ],
  },
  {
    name: 'io_scan', cli: 'file-io', description: 'I/O 风险扫描（AST 四级分级 high/medium/low/safe——与审计 io-risk 同标准）。repo=目标（默认工作区）、writeOnly=只看写操作',
    params: [
      { flag: 'repo', type: 'string', positional: 0, desc: '扫描目标（默认工作区）' },
      { flag: 'writeOnly', type: 'boolean', desc: '只看写操作' },
    ],
  },
  {
    name: 'npm_publish', cli: 'npm-publish',
    description: 'npm 发包（后台 job + dryRun）：默认 dryRun=true 只做体检与 npm publish --dry-run（不写 registry）；真发必须同时 confirm=true 且 dryRun=false。dir=目标包目录（缺省工作区）、tag=发布 tag（默认 latest）、otp=2FA 一次性口令（可选）。前置体检：private:true 拦截、同名版本占用检测、npm pack 文件清单',
    params: [
      { flag: 'dir', type: 'string', positional: 0, desc: '目标包目录（缺省工作区）' },
      { flag: 'dryRun', type: 'boolean', desc: '只预演（默认 true，不写 registry）' },
      { flag: 'tag', type: 'string', desc: '发布 tag（latest/beta/next/rc/…，默认 latest）' },
      { flag: 'otp', type: 'string', desc: '2FA 一次性口令（可选）' },
      { flag: 'confirm', type: 'boolean', desc: '真发确认（dryRun=false 时必填）' },
      { flag: 'no-dry-run', type: 'boolean', desc: '关闭 dry-run（= dryRun:false；真发还需 --confirm）' },
      { flag: 'json', type: 'boolean', desc: 'JSON 输出（CLI 用；与其它工具同口径）' },
    ],
  },
  {
    name: 'git_clone_preview', cli: 'clone-preview', description: 'clone 预演（不落盘——报告将拉取什么）。target=owner/repo、branch=分支——clone 前先看要拉什么',
    params: [
      { flag: 'target', type: 'string', positional: 0, required: true, desc: 'owner/repo' },
      { flag: 'branch', type: 'string', desc: '分支名' },
    ],
  },
  {
    name: 'link_check', cli: 'link-check', description: '检查文档链接有效性（md/txt 内 URL——只报 warning 不拦截提交）。path=文件或目录（默认工作区）',
    params: [
      { flag: 'path', type: 'string', positional: 0, desc: '文件或目录（默认工作区）' },
    ],
  },
  {
    name: 'git_identity_rewrite', cli: 'identity-rewrite', description: '提交身份历史改写：把仓库里非规范身份（工具/AI 产生的 agent@dsh.local、eightfs@local、v2-clone@local，以及账号 noreply 的旧变体）的作者/committer 统一成登录账号的规范身份。默认 dryRun 只报告；真改写会先建备份引用、自检（提交数/工作树/身份全规范）通过才用 force-with-lease 强推；只处理 origin 属于登录账号的仓库。paths=仓库路径，root=扫描根',
    params: [
      { flag: 'paths', type: 'string', positional: 0, desc: '目标仓库路径（逗号分隔；缺省按 root 扫描工作区）' },
      { flag: 'root', type: 'string', desc: '扫描根目录（缺省取配置 defaultScanRoot）' },
      { flag: 'dryRun', type: 'boolean', desc: '只预演不写入（默认 true；真改写传 false 或用 --write）' },
      { flag: 'write', type: 'boolean', desc: '真正改写（等价 dryRun:false）' },
      { flag: 'push', type: 'boolean', desc: '自检通过后 force-with-lease 强推远端' },
      { flag: 'extraEmails', type: 'string', desc: '额外要统一的邮箱（逗号分隔，如历史里出现过的真实邮箱）' },
      { flag: 'json', type: 'boolean', desc: 'JSON 输出（CLI：git-sluice identity-rewrite --json）' },
    ],
  },
  {
    name: 'module_splitter', cli: 'module-splitter', description: '巨型单文件按顶层块拆分：analyze（先分析依赖）→ split（切分）→ verify（校验导出一致）。command=子命令、file/plan=目标 .js/plan.json、dryRun 预演',
    params: [
      { flag: 'command', type: 'string', enum: ['analyze', 'split', 'verify'], positional: 0, required: true, desc: '子命令' },
      { flag: 'file', type: 'string', desc: 'analyze 的待拆 .js 路径' },
      { flag: 'plan', type: 'string', desc: 'split/verify 的 plan.json 路径' },
      { flag: 'dryRun', type: 'boolean', desc: '只预演不落盘' },
    ],
  },
  {
    name: 'git_account_check', cli: 'account-check', description: '校验 GitHub 账号与凭据：token 在线校验 + SSH 公钥指纹——返回登录态/用户名/公钥数/套餐。token 不传自动解析；sshPub 非空顺带持久化',
    params: [
      { flag: 'sshPub', type: 'string', desc: 'SSH 公钥内容（顺带持久化）' },
      { flag: 'token', type: 'string', desc: 'GitHub token（不传自动解析）' },
    ],
  },
  {
    name: 'git_cred_env', cli: 'cred-env', description: '输出插件凭据的环境变量前缀（SSH GIT_SSH_COMMAND / HTTPS GIT_ASKPASS）——任意外部 git 命令前粘贴用，不含明文',
    params: [],
  },
  {
    name: 'git_gen_ssh_key', cli: 'gen-ssh-key', description: '生成 SSH 密钥对（写入插件配置目录；私钥不出本机——公钥整行回传）。email 必填；force 覆盖（先备份可恢复）',
    params: [
      { flag: 'email', type: 'string', positional: 0, required: true, desc: '邮箱（x@y.z）' },
      { flag: 'force', type: 'boolean', desc: '已存在时强制覆盖（先备份）' },
    ],
  },
  {
    name: 'git_sluice', cli: 'git', description: '浅包装 git 透传：AI 直接调用任意 git 命令（log/diff/branch/tag 等），凭据自动注入（SSH 私钥 / HTTPS token askpass）。args 传与 git 完全一致的参数串（空格分隔；路径含空格用引号包裹，例 status --short 或 log --oneline -5），返回退出码 status + stdout/stderr 原文。高频写操作（提交/推送/clone）仍优先 git_commit_push/git_clone 专用工具（自带审计门禁）。',
    params: [
      { flag: 'args', type: 'string', positional: 0, desc: 'git 参数串（与 git 完全一致，空格分隔）' },
    ],
  },
  {
    name: 'git_api', cli: 'api', description: '直接调用本插件的 HTTP API（35 条接口，与浏览器/CLI 同源实现：内部走 handleHttp 同一条代码路径）。path=接口名（去掉 /api/git-push/ 前缀，如 status / rule-slots / audit / settings-get）；method 默认 GET；query=查询参数 JSON（如 {"mode":"full"}）；body=POST 请求体 JSON；不传 path 则列出全部可用接口。写类接口（settings-set / repo-push 等）内部调用按本机同源放行。',
    params: [
      { flag: 'path', type: 'string', positional: 0, desc: '接口名（缺省 = 列出全部接口）' },
      { flag: 'method', type: 'string', desc: 'HTTP 方法（默认 GET；写操作传 POST）' },
      { flag: 'query', type: 'string', desc: '查询参数 JSON 字符串，如 {"mode":"full"}' },
      { flag: 'body', type: 'string', desc: 'POST 请求体 JSON 字符串' },
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
/**
 * 解析一个 `--flag` token（兼容 `--k=v` 与 `--k v` 两种形态），就地写入 args。
 *
 * 为什么单独成函数：原 parseRegistryArgs 把「flag 取值 / 布尔开关 / 缺值判定 / 越界看下一个 token」
 *   全挤在循环里，圈复杂度 21（阈值 10，自审 max-cyclomatic-complexity 高风险）。
 *
 * @returns {{error?: string, consumedNext?: boolean}} consumedNext=true 表示值来自下一个 token（调用方需 i++）
 */
function applyFlagToken(args, tok, rest, i, byFlag) {
  const eq = tok.indexOf('=');
  const optName = eq >= 0 ? tok.slice(2, eq) : tok.slice(2);
  // CLI 用 kebab（--max-file-mb / --extra-emails），注册表参数名用 camelCase（maxFileMb / extraEmails）——
  //   两种写法都认，否则声明了参数却从 CLI 传不进来（实测：--extra-emails 报「未知参数」）。
  const camel = optName.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
  const p = byFlag.get(optName) || byFlag.get(camel);
  if (!p) return { error: `未知参数 --${optName}` };
  if (p.type === 'boolean') {
    args[p.flag] = eq >= 0 ? !['false', '0'].includes(tok.slice(eq + 1)) : true;
    return {};
  }
  const optValue = eq >= 0 ? tok.slice(eq + 1) : rest[i + 1];
  if (optValue === undefined || String(optValue).startsWith('--')) return { error: `--${optName} 需要值` };
  args[p.flag] = optValue;
  return { consumedNext: eq < 0 };
}

/** 必填与枚举约束校验；返回错误文案（空串=通过）。 */
function validateParamConstraints(args, params) {
  for (const p of params) {
    if (p.required && args[p.flag] === undefined) return `缺少必填参数 ${p.flag}`;
    if (p.enum && args[p.flag] !== undefined && !p.enum.includes(args[p.flag])) return `${p.flag} 取值必须为 ${p.enum.join('|')}`;
  }
  return '';
}

export function parseRegistryArgs(rest = [], params = []) {
  const args = {};
  const byFlag = new Map(params.map((p) => [p.flag, p]));
  const positional = params.filter((p) => p.positional !== undefined).sort((a, b) => a.positional - b.positional);
  let pi = 0;
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok.startsWith('--')) {
      const r = applyFlagToken(args, tok, rest, i, byFlag);
      if (r.error) return { error: r.error };
      if (r.consumedNext) i++;
    } else {
      const p = positional[pi++];
      if (!p) return { error: `多余的位置参数：${tok}` };
      args[p.flag] = tok;
    }
  }
  for (const p of params) if (args[p.flag] === undefined && p.default !== undefined) args[p.flag] = p.default;
  const err = validateParamConstraints(args, params);
  return err ? { error: err } : { args };
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