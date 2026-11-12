// CLI 公共层（三个入口共用：git-sluice / audit-sluice / tool-sluice）
//
// 为什么抽这一层：三入口如果各写一份 parseArgv / 结果打印 / 帮助渲染，迟早三份行为不一致——
//   同一个 `--depth 3` 在不同 CLI 里解析结果不同，是最难查的那类 bug。
//   所以「怎么解析」「怎么打印」「怎么分发」只在这里写一次；入口文件只留
//   「自己的命令表 + 自己的 HELP + 自己的副作用 import」。
//
// 切割线（命令 → 归哪个 CLI）也在这里**单处定义**：CLI_ENTRIES 是唯一真相，
//   入口的命令表、跨侧提示、测试的归属断言都从它推。改切割线只改这一处。
//
// 跨侧命令的策略：**明确报错 + 给出可直接照抄的替代命令**，不做静默转发。
//   静默转发会让「两个 CLI」名不副实，也让后续拆分永远收敛不了。

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { VERSION } from '../self/index.js';
import { registryByCli, parseRegistryArgs } from '../app/command-registry.js';
import { callTool } from '../app/tool-call.js';
import { readSettings, applySettingsToCfg } from '../app/settings-bridge.js';
import { defaultConfig } from '../client/index.js';

/** 三个入口的名字（也是 bin 名）。 */
export const CLI_GIT = 'git-sluice';
export const CLI_AUDIT = 'audit-sluice';
export const CLI_TOOL = 'tool-sluice';

/**
 * 三入口的切割线（唯一真相）。
 * commands：该 CLI 独占的命令名（含注册表驱动与 COMMANDS 表两种来源）；
 * fallback：未知命令的处置——只有 git 侧把未知命令透传给 git（`git-sluice status` = `git status`），
 *   另外两侧遇到未知命令必须报错（审计/工具 CLI 不该悄悄执行 git 命令）。
 */
export const CLI_ENTRIES = {
  [CLI_GIT]: {
    intro: 'dsh-git-push git 侧 CLI（提交/推送/克隆/账号/仓库扫描；脱离 DSH 运行）',
    fallback: 'git-passthrough',
    commands: [
      'scan', 'commit', 'clone', 'clone-preview', 'remote-create', 'rename', 'set-visibility',
      'identity-rewrite', 'account-check', 'cred-env', 'gen-ssh-key', 'git', 'api', 'repos', 'index',
      'npm-publish', 'unpublish',
    ],
  },
  [CLI_AUDIT]: {
    intro: 'dsh-git-push 审计侧 CLI（审计/规则/评分/静态检查；脱离 DSH 运行）',
    fallback: 'error',
    commands: ['audit', 'ruleset', 'file-io', 'link-check', 'scope-check', 'functions', 'tree-doc'],
  },
  [CLI_TOOL]: {
    intro: 'dsh-git-push 工具链 CLI（拆分/模板/自检；不含 git 与审计命令）',
    fallback: 'error',
    commands: ['module-splitter', 'yaml-template', 'readme-template', 'self-check'],
  },
};

/** 命令 → 所属 CLI（未登记返回空串）。 */
export function commandOwner(command) {
  const name = String(command || '');
  for (const [cliName, entry] of Object.entries(CLI_ENTRIES)) {
    if (entry.commands.includes(name)) return cliName;
  }
  return '';
}

/** 全部命令（三侧并集，供测试/文档核对完整性）。 */
export function allCommands() {
  return Object.values(CLI_ENTRIES).flatMap((entry) => entry.commands);
}

/**
 * 读插件同一份配置（config.json）→ 运行期 cfg（与插件启动回读同一映射）。
 *
 * 为什么放在 CLI 公共层：三个入口的注册表驱动命令都要「和插件同口径」的配置
 *   （审计开关/扫描上限/权重覆盖/规则槽位…），各写一份必然漂移；而它本身只依赖
 *   lib/app + lib/client，与审计实现无关——放在 here 可以让 git 侧不必为了读配置 import 审计模块。
 *
 *  注意：applySettingsToCfg 是**原地修改** cfg，返回的是状态对象（{changedSystemPrompt}），
 *  绝不能把返回值当 cfg 用——那会让 auditEnabled/maxScanFiles/weightOverrides 全变 undefined。
 * @returns {object} 运行期配置
 */
export function cliPluginConfig() {
  const cfg = defaultConfig();
  try {
    const saved = readSettings({});
    applySettingsToCfg(cfg, saved || {}); // 原地改 cfg，忽略返回值
  } catch {
    /* 配置缺失/损坏 → 保留 defaultConfig（与插件首启一致） */
  }
  return cfg;
}

/** 版本行（三入口共用格式，只有 CLI 名不同）。 */
export function versionLine(cliName) {
  return `${cliName} v${VERSION} — dsh-git-push（统一函数入口架构）`;
}

/**
 * 跨侧命令的报错提示（必须可照抄：给出完整替代命令，不能只报「不支持」）。
 * @param {object} p { command, argvRest?: string[], fromCli?: string }
 * @returns {string}
 */
export function buildCrossCliHint({ command = '', argvRest = [], fromCli = '' } = {}) {
  const targetCli = commandOwner(command);
  const tail = argvRest.length ? ` ${argvRest.join(' ')}` : '';
  const lines = [
    `✗ "${command}" 属于 ${targetCli}，不在 ${fromCli} 里。`,
    `  请改用：${targetCli} ${command}${tail}`,
  ];
  if (argvRest.length) lines.push(`  （你把原命令 ${fromCli} ${command}${tail} 里的 CLI 名换成 ${targetCli} 即可）`);
  lines.push(`  三入口：${Object.keys(CLI_ENTRIES).join(' / ')}；各自 help 看本侧全部命令`);
  return lines.join('\n');
}

// ── 参数解析（三入口共用；白名单必须与各自 HELP 文本一致，由 self-check / 测试机器比对）──

/** 布尔开关 flag → flags 字段名（出现即为 true）。 */
const BOOL_FLAGS = {
  '--full': 'full',
  '--history': 'history',
  '--include-ignored': 'includeIgnored',
  '--dry-run': 'dryRun',
  '--force': 'force',
  '--req-confirm': 'reqConfirm',
  '--push-gate-confirmed': 'pushGateConfirmed',
  '--json': 'json',
  '--offline': 'offline',
  '--summary': 'summary',
  '--write': 'write',
  '--preview': 'preview',
  '--skip-empty': 'skipEmpty',
  '--no-check-ssh': null, // 特殊：置 false 而非 true（见下 applyBoolFlag）
};

/** 取值 flag → [flags 字段名, 缺值提示, 转换函数?]。 */
const VALUE_FLAGS = {
  '--depth': ['depth', '--depth 缺值（用法: --depth N）', Number],
  '--max': ['max', '--max 缺值（用法: --max N）', Number],
  '--owner': ['owner', '--owner 缺值（用法: --owner <账号>）'],
  '--ruleset': ['ruleset', '--ruleset 缺值'],
  '--weights': ['weights', '--weights 缺值'],
  '-m': ['message', '-m 缺值（用法: -m <提交信息>）'],
  '--root': ['root', '--root 缺值（用法: --root <目录>）'],
  '--readme': ['readme', '--readme 缺值（用法: --readme <README路径>）'],
  '--type': ['type', '--type 缺值（用法: --type sync|async）'],
  '--kind': ['kind', '--kind 缺值（用法: --kind read|write|delete|rename）'],
  '--risk': ['risk', '--risk 缺值（用法: --risk high|medium|low）'],
  '--op': ['op', '--op 缺值（用法: --op writeFileSync）'],
  '--dest': ['dest', '--dest 缺值（用法: --dest <目录>）'],
  '--branch': ['branch', '--branch 缺值（用法: --branch <分支名>）'],
  '--max-file-mb': ['maxFileMB', '--max-file-mb 缺值（用法: --max-file-mb N）', Number],
  '--concurrency': ['concurrency', '--concurrency 缺值（用法: --concurrency N）', Number],
  '--visibility': ['visibility', '--visibility 缺值（用法: --visibility public|private）'],
  '--email': ['email', '--email 缺值（用法: --email x@y.z）'],
  '--token': ['token', '--token 缺值（用法: --token <ghp_...>）'],
  '--since': ['since', '--since 缺值（用法: --since <起始提交 sha/ref>）'],
  '--until': ['until', '--until 缺值（用法: --until <结束提交 sha/ref>）'],
  '--out': ['out', '--out 缺值（用法: --out <报告保存目录>）'],
};

/** 默认值（每次调用新建，避免跨调用串状态）。 */
function defaultFlags() {
  return {
    depth: undefined, full: false, ruleset: undefined, weights: undefined, includeIgnored: false,
    push: undefined, dryRun: false, force: false, reqConfirm: false, pushGateConfirmed: false,
    message: undefined, json: false, max: undefined, owner: undefined, offline: false,
    summary: false, write: false, type: undefined, kind: undefined, risk: undefined, op: undefined,
    dest: undefined, branch: undefined, preview: false, maxFileMB: undefined, concurrency: undefined,
    visibility: undefined, email: undefined, checkSsh: true, token: undefined,
  };
}

/** 布尔开关落值：--no-check-ssh 语义是「关掉」而非「开启」；--push/--no-push 是同一字段两态。 */
function applyBoolFlag(flags, token) {
  if (token === '--no-check-ssh') { flags.checkSsh = false; return; }
  if (token === '--push') { flags.push = true; return; }
  if (token === '--no-push') { flags.push = false; return; }
  flags[BOOL_FLAGS[token]] = true;
}

/** 取值 flag 落值。 */
function applyValueFlag(flags, token, rawValue) {
  const [field, , convert] = VALUE_FLAGS[token];
  flags[field] = convert ? convert(rawValue) : rawValue;
}

/**
 * 解析命令行参数（表驱动：加 flag 只加表项，函数长度不随 flag 数增长）。
 * 三入口共用同一张表（超集）——某个 CLI 不用某个 flag 只是「不写进它的 HELP」，
 *   解析器认不认与「有没有写进 HELP」由各侧 KNOWN_FLAGS 分别约束（self-check 比对）。
 * @param {string[]} argv
 * @returns {{flags: object, positional: string[]} | {error: string}}
 */
export function parseArgv(argv = []) {
  const flags = defaultFlags();
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--push' || token === '--no-push' || token === '--no-check-ssh' || token in BOOL_FLAGS) {
      applyBoolFlag(flags, token);
    } else if (token in VALUE_FLAGS) {
      const rawValue = argv[++index];
      if (rawValue === undefined || rawValue.startsWith('--')) return { error: VALUE_FLAGS[token][1] };
      applyValueFlag(flags, token, rawValue);
    } else if (token.startsWith('--')) {
      return { error: `未知参数: ${token}` };
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

/** 解析后直接跑命令（三入口共用的「先 parseArgv 再调实现」包装）。 */
export function parseVia(run) {
  return (rest) => {
    const { flags, positional, error } = parseArgv(rest);
    if (error) return console.error(error);
    return run(flags, positional);
  };
}

/**
 * 工具返回的统一文本输出（注册表驱动命令共用）。
 * 默认文本化 summary/quality/lines；--json 直出完整返回（完整返回可能很大，只给显式要的人）。
 * @param {object} result 工具返回
 * @param {boolean} asJson 是否直出 JSON
 */
export function printToolResult(result, asJson) {
  if (asJson) { console.log(JSON.stringify(result, null, 2)); return; }
  if (!result) return;
  if (result.error) { console.error(result.error); return; }
  if (result.apiGuide) { console.log(result.apiGuide); return; }
  const lines = readableResultLines(result);
  console.log(lines.length ? lines.join('\n') : JSON.stringify(result));
}

/**
 * 把工具返回里的可读片段摊成文本行（summary / quality / count / 工具自带 lines）。
 * 拆出来的理由：printToolResult 只剩「选哪条输出通道」，不再塞满条件分支。
 * @param {object} result 工具返回
 * @returns {string[]}
 */
function readableResultLines(result) {
  const lines = [];
  if (result.summary) lines.push(`summary: ${JSON.stringify(result.summary)}`);
  if (result.quality) lines.push(`quality: ${result.quality.score ?? '?'}/${result.quality.level ?? '?'}`);
  if (result.count != null) lines.push(`count: ${result.count}`);
  // lines：工具自备的可读文本行（逐文件结论、命中明细等）——避免为此另造输出通道
  if (Array.isArray(result.lines) && result.lines.length) lines.push(...result.lines);
  return lines;
}

/** 子命令：version（三入口同一实现）。 */
export function printVersion(cliName) {
  console.log(versionLine(cliName));
}

/**
 * 纯分发决策（不执行任何命令）：把 argv 判成「该走哪条」。
 * 为什么要单独抽出来：真实执行命令会碰网络/磁盘（account-check 校验证书、scan 扫目录），
 *   而「命令归属哪个 CLI」这件事必须能被无副作用地测（28 个命令 × 3 个入口全覆盖）。
 * @param {object} p { cliName, argv, commands }
 * @returns {{kind: 'help'|'version'|'cross'|'registry'|'command'|'git-passthrough'|'unknown',
 *   command?: string, targetCli?: string, hint?: string, entry?: object, handler?: Function, error?: string}}
 */
export function resolveDispatch({ cliName = CLI_GIT, argv = [], commands = new Map() } = {}) {
  const [command, ...rest] = argv;
  const knownCli = Object.prototype.hasOwnProperty.call(CLI_ENTRIES, cliName);
  if (!knownCli) return { kind: 'unknown', error: `内部错误：未登记的 CLI 名 ${cliName}` };
  if (!command || command === 'help' || command === '--help' || command === '-h') return { kind: 'help' };
  if (command === 'version' || command === '-v' || command === '--version') return { kind: 'version' };
  const owner = commandOwner(command);
  // ① 跨侧：明确报错并给出可照抄的替代命令（绝不静默转发）
  if (owner && owner !== cliName) {
    return { kind: 'cross', command, targetCli: owner, hint: buildCrossCliHint({ command, argvRest: rest, fromCli: cliName }) };
  }
  // ② 本侧 COMMANDS 表优先：它是「CLI 自己怎么执行」的显式实现，
  //   注册表只是「与插件工具同实现」的镜像。两者都有的命令（目前只有 `git`）必须走 COMMANDS——
  //   `git-sluice git <任意 git 参数>` 要原样透传，而注册表解析器只认声明过的参数，
  //   会把 `git log --oneline` 里的 --oneline 当「未知参数」拒掉（实测）。
  const handler = commands.get(command);
  if (handler) return { kind: 'command', command, handler };
  // ③ 注册表驱动命令（与插件工具同实现；只有属于本侧时才走）
  const registryEntry = registryByCli(command);
  if (registryEntry && (!owner || owner === cliName)) return { kind: 'registry', command, entry: registryEntry };
  // ④ 未知命令
  if (CLI_ENTRIES[cliName].fallback === 'git-passthrough') return { kind: 'git-passthrough', command, argv };
  return {
    kind: 'unknown',
    command,
    error: [
      `✗ 未知命令：${command}（${cliName} 没有这个命令）`,
      `  ${cliName} help 看本侧全部命令`,
      `  若是 git 操作，请用 ${CLI_GIT}（例：${CLI_GIT} ${command}）。`,
    ].join('\n'),
  };
}

/**
 * 注册表命令的布尔**否定形式**归一化：`--no-<参数>` ⇒ 该布尔参数置 false。
 *
 * 为什么需要：注册表解析器（lib/app/command-registry.js）只认 `--<参数>`（出现即 true），
 *   没有否定形式。而 HELP 里 `[--push|--no-push]` 这种写法用户天天照抄——不认就报
 *   「未知参数 --no-push」，属于「文档写着、抄了必失败」。这里在进解析器之前翻译：
 *   删掉 `--no-x` token，解析完再把该参数显式置 false（与 parseArgv 的 --no-check-ssh 同一语义）。
 * ⚠️ 若 `--no-x` 本身就是已声明的参数名（如 npm-publish 的 --no-dry-run），原样放行不翻译。
 * @param {string[]} rest 命令后的参数表
 * @param {object[]} params 该命令的注册表参数
 * @returns {{argv: string[], negated: object[]}}
 */
export function normalizeRegistryArgv(rest = [], params = []) {
  const byFlag = new Map(params.map((param) => [param.flag, param]));
  const declaredFlags = new Set(params.map((param) => `--${String(param.flag).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`));
  const argv = [];
  const negated = [];
  for (const token of rest) {
    const raw = String(token);
    const isNegation = raw.startsWith('--no-') && !declaredFlags.has(raw);
    const single = isNegation ? raw.slice('--no-'.length) : '';
    const param = isNegation ? (byFlag.get(single) || byFlag.get(single.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase()))) : null;
    if (param && param.type === 'boolean') { negated.push(param); continue; }
    argv.push(raw);
  }
  return { argv, negated };
}

/**
 * 跑一个 CLI 入口（三入口共用的 main 实现）。
 * @param {object} p
 *   cliName  : 入口名（同时决定跨侧提示文案与 fallback 行为）
 *   argv     : 参数表（缺省 process.argv.slice(2)）
 *   commands : 本侧 COMMANDS 表（Map<命令名, handler(rest)>）
 *   helpText : 本侧 HELP 文本
 *   config   : 可选 { cliPluginConfig } 注入（CLI 独立运行时的插件配置）
 *   passthroughGit : fallback=git-passthrough 时调用（由 git 入口注入，避免 audit/tool 侧依赖 git 层）
 * @returns {Promise<number|undefined>} 退出码（number 时由入口赋给 process.exitCode）
 */
export async function runCli({
  cliName = CLI_GIT, argv = process.argv.slice(2), commands = new Map(), helpText = '',
  passthroughGit = null, getConfig = () => undefined,
} = {}) {
  const plan = resolveDispatch({ cliName, argv, commands });
  if (plan.kind === 'help') { console.log(helpText); return; }
  if (plan.kind === 'version') { printVersion(cliName); return; }
  if (plan.kind === 'cross') { console.error(plan.hint); process.exitCode = 1; return 1; }
  if (plan.kind === 'unknown') { console.error(plan.error); process.exitCode = 1; return 1; }
  if (plan.kind === 'command') return await plan.handler(argv.slice(1));
  if (plan.kind === 'registry') {
    const { argv: normalizedArgv, negated } = normalizeRegistryArgv(argv.slice(1), plan.entry.params);
    const { args, error } = parseRegistryArgs(normalizedArgv, plan.entry.params);
    if (error) { console.error(error); process.exitCode = 1; return 1; }
    // --no-<布尔参数>：解析器给的是默认值/true，这里显式覆盖成 false
    for (const param of negated) args[param.flag] = false;
    try {
      const toolResult = await callTool(plan.entry.name, args, { workspaceRoot: process.cwd() }, getConfig(), console, null, null);
      printToolResult(toolResult, args.json === true);
      // 退出码如实反映结果：ok:false = 命令失败（门禁/脚本据此判失败）。
      //   ok:true 但 committed:false / pushed:false 这类「零改动正常路径」仍是 0。
      return toolResult && toolResult.ok === false ? 1 : 0;
    } catch (e) {
      console.error(String((e && e.message) || e));
      process.exitCode = 1;
      return 1;
    }
  }
  // git 透传（只有 git 侧会走到）
  if (plan.kind === 'git-passthrough') {
    if (typeof passthroughGit !== 'function') {
      console.error(`✗ 未知命令：${plan.command}（本入口未接线 git 透传）`);
      process.exitCode = 1;
      return 1;
    }
    const wrapped = await passthroughGit(plan.argv);
    if (wrapped && wrapped.ok) return 0;
    process.exitCode = typeof wrapped?.status === 'number' ? wrapped.status : 1;
    return process.exitCode;
  }
  return 1;
}

/**
 * 判断「本模块是不是被直接执行」（被 import 时不执行入口逻辑）。
 * 为什么不能用字符串比较：bin 是符号链接（PATH 里 git-sluice → cli.mjs），
 *   process.argv[1] 是链接路径、import.meta.url 是真实路径，直接比会判成「非直接执行」→
 *   入口静默不跑、exit 0 无输出；相对/绝对路径混用时同理。故两边都 realpath 归一化再比。
 * @param {string} moduleUrl 入口模块的 import.meta.url
 * @returns {boolean}
 */
export function isDirectRun(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}

/**
 * 入口薄壳：直接执行时跑 main 并把 number 返回值落成退出码。
 * @param {string} moduleUrl import.meta.url
 * @param {Function} main 返回 Promise<number|undefined>
 */
export function runAsEntry(moduleUrl, main) {
  if (!isDirectRun(moduleUrl)) return;
  // 顶层 await：main 已异步，未 await 时 rejection 会变成 unhandled rejection
  //   （进程静默退出、退出码不对）。命令函数有的返回业务对象/数组，只有 number 才赋 exitCode
  //   —— 否则 `process.exitCode = 对象` 抛 ERR_INVALID_ARG_TYPE。
  main().then((code) => {
    if (typeof code === 'number' && Number.isInteger(code)) process.exitCode = code;
  }).catch((e) => {
    console.error(String((e && e.stack) || e));
    process.exitCode = 1;
  });
}

/**
 * 读入口源码（self-check 用：跨入口核对 HELP 与 KNOWN_FLAGS，不 import 入口）。
 * 为什么读源码而不 import 三个入口：入口 import 会连带加载全部命令实现（含网络/凭据模块），
 *   而自检只需要两张文本表；读源码既零副作用，又核对到「文件里真正写着的那份」。
 * @param {string} relPath 相对插件根的路径（如 'cli-audit.mjs'）
 * @returns {string}
 */
export function readEntrySource(relPath) {
  return readFileSync(new URL(`../../${relPath}`, import.meta.url), 'utf8');
}

/**
 * 从入口源码里取 HELP 与 KNOWN_FLAGS。
 * @param {string} sourceText 入口文件全文
 * @returns {{help: string, flags: string[]}}
 */
export function parseEntrySourceMeta(sourceText = '') {
  const text = String(sourceText);
  const helpMatch = text.match(/const HELP = `([\s\S]*?)`;/);
  const flagsMatch = text.match(/const KNOWN_FLAGS = \[([\s\S]*?)\];/);
  const flags = flagsMatch ? [...flagsMatch[1].matchAll(/'(--[a-z0-9-]+)'/g)].map((match) => match[1]) : [];
  return { help: helpMatch ? helpMatch[1] : '', flags };
}
