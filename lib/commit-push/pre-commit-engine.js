// 提交前预处理引擎 · 子进程调用层
//
// 为什么要有这一层（解耦点）：提交门禁此前直接 import 审计内核（auditWithScope）与评分
//   （scoreQuality），换引擎/换语言重写就要改 git 侧代码。现在门禁只认一份**与语言无关的
//   进程契约**：跑一条命令、看退出码、解析一行 JSON。这样 Python / Go / Rust 写的引擎
//   只要满足契约就能顶替，git 侧一行不用改。
//
// 契约（完整定义见预处理实现 CLI 头部与 docs/ 下的「提交前预处理与审计引擎解耦方案」）：
//   stdout : 一行 JSON { ok, scope, summary, quality, findings, files }
//   退出码 : 0 = 无 blocker / 1 = 有 blocker / 2 = 执行失败
//   超时   : 达到 timeoutMs 一律按「执行失败」处理
//
// 退出码 1 **不等于**「本次提交被拦」：示例目录豁免、临时豁免、私有库豁免都属于 git 侧判定
//   （依赖仓库语义 / 调用方参数 / GitHub 网络），引擎不知道也不该知道。所以本层只把
//   「引擎说有 blocker」如实映射成 blocked 标志，**最终拦截判定仍由 runPreprocess 用豁免规则做**。
//
// 失败一律 fail-closed（拒绝提交）：引擎崩了 / 超时 / 退出码非 0/1 / stdout 解析不了，
//   都不能当成「审计通过」放行 —— 那是把红线交给「恰好没跑起来」。

import { spawn } from 'node:child_process';
import { existsSync, accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSettings } from '../app/settings-bridge.js';
// 超时默认值取单一来源：schema 默认值与运行期兜底必须是同一个数字（见 lib/app/constants.js）
import { PRE_COMMIT_TIMEOUT_MS_DEFAULT } from '../app/constants.js';

export { PRE_COMMIT_TIMEOUT_MS_DEFAULT };

/** 内置轻量入口（相对插件根）。配置留空时用它。 */


/**
 * 审计实现所属包名（拆包后审计实现在 `audit-sluice`）。
 * 为什么单独一个常量：入口解析、错误提示、将来 npm 依赖安装后的路径都引用它，避免多处手写字符串。
 */

/** 预处理实现的 CLI 入口（相对包根）。 */
export const PREPROCESS_CLI_REL = 'cli.mjs';

// 注意：这里不再写死具体实现的包名——包名属于 provider 定义（lib/preprocess/providers.js），
//   通用层只通过 provider 抽象拿它。将来换/加 provider 不需要改本文件。
import { resolveGateProvider, getProviderDefinition, DEFAULT_PROVIDER_ID } from '../preprocess/providers.js';

export { resolveGateProvider };

/** 错误信息里保留的 stderr 尾部字符数：够定位（栈尾通常在最后），又不至于把上下文刷爆。 */
export const STDERR_TAIL_CHARS = 2000;

/** stdout 收集上限（64MB）：findings 全量在大仓可达数 MB，超这个量级说明契约跑偏，宁可报错。 */
export const STDOUT_MAX_BYTES = 64 * 1024 * 1024;

/** 契约退出码（与预处理实现 CLI 的 EXIT_* 常量对应）。 */
export const ENGINE_EXIT_OK = 0;
export const ENGINE_EXIT_BLOCKED = 1;
export const ENGINE_EXIT_FAILED = 2;

/** 插件根目录（本文件位于 <pluginRoot>/lib/commit-push/，向上两级）。 */
export function pluginRootDir() {
  return resolve(fileURLToPath(new URL('../../', import.meta.url)));
}

/**
 * 取 stderr 尾部（按字符数，不按行——栈尾常常没有换行）。
 * @param {string} text
 * @returns {string}
 */
export function stderrTail(text) {
  const raw = String(text || '').trim();
  return raw.length > STDERR_TAIL_CHARS ? raw.slice(raw.length - STDERR_TAIL_CHARS) : raw;
}

/**
 * 配置解析顺序：`cfg.preCommit`（宿主注入）→ 插件 config.json 的 `preCommit` → 内置默认。
 *
 * 为什么还要读 config.json：`preCommit` 是**高级文件配置**，不进 UI 设置项
 *   （lib/client/index.js 的 SETTINGS_SCHEMA 是 UI 单一事实源，其 resolveConfig 会丢弃未知键），
 *   所以运行期 cfg 里不会有它。同款先例：lib/app/apply.js 直接从 config.json 读 injectUsageText。
 *   将来 UI 把 preCommit 加进 SETTINGS_SCHEMA 后，第一档（cfg.preCommit）会自动接管，本函数不用改。
 *
 * @param {object} [cfg] 运行期配置
 * @returns {{command: string, args: string[], timeoutMs: number, source: 'cfg'|'config.json'|'default'}}
 */
export function resolvePreCommitConfig(cfg = {}) {
  const { raw, source } = readPreCommitBlock(cfg);
  const command = typeof raw?.command === 'string' ? raw.command.trim() : '';
  const configuredArgs = Array.isArray(raw?.args)
    ? raw.args.map((rawArg) => String(rawArg)).filter((rawArg) => rawArg !== '')
    : [];
  // 内置默认只在「command 与 args 都没配」时生效：
  //   · command 空 + args 空   → node + 预处理实现 CLI
  //   · command 空 + args 有值  → node + 配置里给的引擎脚本（args 里相对路径按插件根解析）
  //   · command 有值 + args 空  → 那是一个独立可执行文件（Go/Rust 单二进制就是这种形态，
  //                              此时**不能**塞我们自己的脚本路径进去）
  // 缺省引擎 = 预处理实现的 CLI；显式配置 command/args 时以配置为准（换引擎只改配置）。
  let args = configuredArgs;
  if (!command && configuredArgs.length === 0) {
    const entry = resolveGateProvider();
    // 解析失败也把"期望的路径"放进 args：真正的失败在 spawn 前由 runPreCommitEngine 报出，
    //   错误信息里带上具体查过哪些路径（否则用户只看到"命令不存在"，不知道该怎么办）。
    args = entry.ok ? [entry.path] : [join(pluginRootDir(), '..', getProviderDefinition(DEFAULT_PROVIDER_ID).packageName, PREPROCESS_CLI_REL)];
  }
  const rawTimeout = Number(raw?.timeoutMs);
  // 超时必须是正有限数：0 / 负数 / NaN 一律退回默认（0 表示「立刻超时」会让门禁永远失败）
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.floor(rawTimeout) : PRE_COMMIT_TIMEOUT_MS_DEFAULT;
  return { command, args, timeoutMs, source };
}

/**
 * 旧版开关键名（历史配置里这个键就是「提交前检查开不开」）。
 * 单独提常量是为了让「还在兼容什么」一目了然，也便于将来彻底删除时 grep 到唯一出处。
 */
const LEGACY_ENABLED_KEY = 'auditEnabled';

/**
 * 判断「提交前预处理要不要跑」（`preCommit.enabled`）。
 *
 * 判定顺序（**先看用户实际写下的配置，再看运行期默认值**）：
 *   ① `config.json` 里的 `preCommit.enabled`（用户显式配过）
 *   ② `config.json` 里的旧版开关键（LEGACY_ENABLED_KEY）：直接忽略等于让「本来开着的门禁
 *      悄悄关掉」，这是最难发现的一类行为变化；读回时把来源标出来，用户能看到「本次沿用旧键」
 *   ③ 运行期 cfg 的 `preCommit.enabled`（schema 默认值 / 调用方显式传入）
 *   ④ 关
 * 为什么 ①② 在 ③ 之前：schema 有默认值，运行期 cfg 里**永远**有 `preCommit.enabled:false`，
 *   若先看 cfg 就永远读不到用户写下的真值（旧键也就永远失效）。
 * @param {object} [cfg] 运行期配置
 * @returns {{enabled: boolean, source: 'config.json'|'legacy'|'cfg'|'default'}}
 */
export function resolvePreCommitEnabled(cfg = {}) {
  let fileSettings = null;
  try {
    fileSettings = readSettings({});
  } catch {
    // 配置读不到（无 DSH_HOME / 坏 JSON）→ 当作没配，不让读盘失败影响提交
    fileSettings = null;
  }
  const fileBlock = fileSettings && typeof fileSettings.preCommit === 'object' ? fileSettings.preCommit : null;
  if (typeof fileBlock?.enabled === 'boolean') return { enabled: fileBlock.enabled, source: 'config.json' };
  const legacyEnabled = fileSettings?.[LEGACY_ENABLED_KEY];
  if (typeof legacyEnabled === 'boolean') return { enabled: legacyEnabled, source: 'legacy' };
  if (typeof cfg?.preCommit?.enabled === 'boolean') return { enabled: cfg.preCommit.enabled, source: 'cfg' };
  return { enabled: false, source: 'default' };
}

/**
 * 取 preCommit 配置块（两档来源 + 来源标记）。
 * @param {object} cfg
 * @returns {{raw: object|null, source: 'cfg'|'config.json'|'default'}}
 */
function readPreCommitBlock(cfg = {}) {
  if (cfg && typeof cfg.preCommit === 'object' && cfg.preCommit !== null) {
    return { raw: cfg.preCommit, source: 'cfg' };
  }
  try {
    const fileSettings = readSettings({});
    if (fileSettings && typeof fileSettings.preCommit === 'object' && fileSettings.preCommit !== null) {
      return { raw: fileSettings.preCommit, source: 'config.json' };
    }
  } catch {
    // 配置读不到（无权限/无 DSH_HOME/坏 JSON）→ 落回内置默认，不影响提交门禁
  }
  return { raw: null, source: 'default' };
}

/**
 * 判断某个路径是否可执行（POSIX 查 X_OK；Windows 只查存在，可执行性由扩展名决定）。
 * @param {string} absPath
 * @returns {boolean}
 */
function isExecutableFile(absPath) {
  try {
    if (!existsSync(absPath)) return false;
    if (process.platform === 'win32') return true;
    accessSync(absPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 在 PATH 里搜命令（Windows 还要按 PATHEXT 补扩展名）。
 * @param {string} commandName 裸命令名（不含目录分隔符）
 * @returns {{ok: true, command: string} | {ok: false, error: string}}
 */
function searchCommandOnPath(commandName) {
  const pathValue = process.env.PATH || '';
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, `${commandName}${ext}`);
      if (isExecutableFile(candidate)) return { ok: true, command: candidate };
    }
  }
  return {
    ok: false,
    error: `找不到引擎命令「${commandName}」：已搜索 PATH（${dirs.length} 个目录，PATH=${pathValue || '（空）'}）`,
  };
}

/**
 * 显式给了路径的命令：绝对路径原样校验；带分隔符的相对路径按**插件根**解析（换机不断链）。
 * @param {string} pathLike
 * @returns {{ok: true, command: string} | {ok: false, error: string}}
 */
function resolvePathLikeCommand(pathLike) {
  const absPath = isAbsolute(pathLike) ? pathLike : resolve(pluginRootDir(), pathLike);
  if (isExecutableFile(absPath)) return { ok: true, command: absPath };
  return { ok: false, error: `引擎命令不可用：${pathLike}（解析为 ${absPath}，文件不存在或没有可执行权限）` };
}

/**
 * 把配置里的 command 解析成**可直接 spawn 的绝对路径**，找不到就显式失败。
 *
 * 不做「找不到就静默回退内置引擎」：配置把命令写错时静默回退，会让提交门禁悄悄地用另一套
 *   引擎跑——审计口径变了却没人知道，比直接报错危险得多。
 * @param {string} command 配置的 command（空 = 内置默认：当前 node 解释器）
 * @returns {{ok: true, command: string, isDefault: boolean} | {ok: false, error: string}}
 */
export function resolveEngineCommand(command) {
  const wanted = String(command || '').trim();
  if (!wanted) return { ok: true, command: process.execPath, isDefault: true };
  const looksLikePath = isAbsolute(wanted) || wanted.includes('/') || wanted.includes('\\');
  const found = looksLikePath ? resolvePathLikeCommand(wanted) : searchCommandOnPath(wanted);
  return found.ok ? { ok: true, command: found.command, isDefault: false } : found;
}

/**
 * 解析配置里的 args：相对路径按**插件根**解析，其余原样保留。
 *
 * 判据用「解析后是否真存在」而不是「有没有斜杠」：args 里既可能是脚本路径，
 *   也可能是命令行选项的取值（如 `--timing 200`），一刀切按路径解析会把选项值改成
 *   一个不存在的绝对路径。存在才改写，不存在就原样交给引擎自己报错 —— 保守且可预测。
 * @param {string[]} args
 * @returns {string[]}
 */
export function resolveEngineArgs(args = []) {
  const pluginRoot = pluginRootDir();
  return (Array.isArray(args) ? args : []).map((rawArg) => {
    const text = String(rawArg);
    if (!text || text.startsWith('-') || isAbsolute(text)) return text;
    const absPath = resolve(pluginRoot, text);
    return existsSync(absPath) ? absPath : text;
  });
}

/**
 * 把槽位清单转成引擎要的逗号串（空清单返回空串 = 不传该参数）。
 * @param {unknown} slots
 * @returns {string}
 */
function toSlotCsv(slots) {
  return (Array.isArray(slots) ? slots : [])
    .map((slotName) => String(slotName).trim())
    .filter(Boolean)
    .join(',');
}

/**
 * 组装传给引擎的完整参数表（**由本模块统一追加，调用方不拼**）。
 * 排序固定：先配置里的 args，再契约参数 —— 契约参数在最后，任何引擎都能靠「尾部固定段」解析。
 *
 * 参数只有两类，**界线不能含糊**（宿主/实现分家后的核心约定）：
 *   ① **调用上下文**（宿主才知道的）：repo / 仓库可见性 / 本次临时豁免 / findings 粒度
 *      —— 这些是「这一次提交的事实」，不是配置，必须由宿主传给引擎；
 *   ② **实现自己的配置**（怎么审）：扫描范围 / 权重 / 规则槽位 / 文件数上限
 *      —— 属预处理实现自己的 config.json，宿主**不传**（传了等于宿主继续替它做配置决策，
 *      两包就还是耦合的）。命令行 `--scope` 等只用于「显式覆盖」，由调用方在需要时给。
 * @param {object} p
 * @returns {string[]}
 */
export function buildEngineArgs({
  args = [], repoPath = '', rulesetDir = '', blockersOnly = false,
  visibility = '', exemptPaths = [], exemptReason = '',
} = {}) {
  const argv = [...resolveEngineArgs(args)];
  argv.push('--repo', String(repoPath || '.'));
  // 自定规则目录是**调用方显式指定**（工具 ruleset 参数 / API 传参），不是宿主配置，故保留透传。
  if (rulesetDir) argv.push('--ruleset', String(rulesetDir));
  // 可见性：只有明确知道时才传（unknown 是引擎缺省，传了也一样）；
  //   私有库豁免由预处理实现自己判（它是权威），gitpush 只负责探测后把结论传过去。
  if (visibility === 'private' || visibility === 'public') argv.push('--visibility', visibility);
  // 临时豁免：**参数名映射** —— 工具参数叫 auditExemptPaths/auditExemptReason，
  //   预处理实现 CLI 叫 --exempt-paths/--exempt-reason（独立包不需要 audit- 前缀）。
  const exemptCsv = toSlotCsv(exemptPaths);
  if (exemptCsv) argv.push('--exempt-paths', exemptCsv);
  if (exemptReason) argv.push('--exempt-reason', String(exemptReason));
  if (blockersOnly) argv.push('--blockers-only');
  argv.push('--json');
  return argv;
}

/**
 * 拼一条可复制的「人类可读命令行」，用于错误信息（用户要能直接粘到终端里复现）。
 * @param {string} command
 * @param {string[]} args
 * @returns {string}
 */
export function formatCommandLine(command, args = []) {
  return [command, ...args].map((part) => (/\s/.test(part) ? `'${part}'` : part)).join(' ');
}

/**
 * 失败结果统一形状：ok=false + 明确原因（含命令、退出码、stderr 尾部）。
 * blocked=false —— 引擎不可用不属于「审计判定拦截」，调用方据此显示不同文案
 *   （工具侧：blocked 显示「推送被拦截」，非 blocked 显示「未完成：<原因>」）。
 * @param {string} message
 * @returns {{ok: false, blocked: false, error: string, audit: null}}
 */
function failClosed(message) {
  return { ok: false, blocked: false, error: message, audit: null };
}

/**
 * 从 stdout 里取出那一行契约 JSON。
 * 只容忍「前后有空行」，不容忍夹杂其他文字：出现噪音说明引擎破坏了契约，
 *   此时宁可失败也不要猜（挑错行会拿到过期/别人的数据）。
 * @param {string} stdout
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function parseEngineStdout(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return { ok: false, error: '引擎没有输出任何内容（stdout 为空）' };
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) {
    return { ok: false, error: `引擎 stdout 不是「单行 JSON」（共 ${lines.length} 行非空输出）` };
  }
  let parsed;
  try {
    parsed = JSON.parse(lines[0]);
  } catch (e) {
    return { ok: false, error: `引擎 stdout 不是合法 JSON：${e.message}；首 200 字符：${lines[0].slice(0, 200)}` };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: '引擎 JSON 顶层不是对象' };
  if (!parsed.summary || typeof parsed.summary !== 'object') {
    return { ok: false, error: '引擎 JSON 缺少 summary 字段（契约要求 { summary:{blocker,warning,notice,total} }）' };
  }
  return { ok: true, value: parsed };
}

/**
 * 起子进程并收 stdout/stderr，只负责「跑完 + 收齐」，不做契约解释。
 * 拆出来的理由：超时强杀、流上限、spawn 异常三条路径都不该混在门禁语义里，
 *   否则「跑失败」和「判失败」会糊在一起，改一处就动全身。
 * @param {object} p { command, args, timeoutMs }
 * @returns {Promise<{ok: true, stdout: string, stderr: string, exitCode: number|null, signal: string|null}
 *   | {ok: false, stage: 'timeout'|'too-large'|'spawn', error: string, stderr: string}>}
 */
function runEngineProcess({ command, args, timeoutMs }) {
  return new Promise((settle) => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let settled = false;
    // timer 必须先声明再被 finish 引用：spawn 同步抛异常时 finish 会跑在 setTimeout 之前，
    //   用 const + 后置赋值会命中 TDZ（ReferenceError）把「启动失败」变成「未捕获异常」。
    let timer = null;
    let child = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      settle(result);
    };
    const killChild = () => { try { child?.kill('SIGKILL'); } catch { /* 进程可能已退出 */ } };

    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      finish({ ok: false, stage: 'spawn', error: String(e?.message || e), stderr });
      return;
    }
    timer = setTimeout(() => {
      killChild();
      finish({ ok: false, stage: 'timeout', error: `>${timeoutMs}ms 未返回，已强杀`, stderr });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_MAX_BYTES) {
        killChild();
        finish({ ok: false, stage: 'too-large', error: `stdout 超过上限 ${STDOUT_MAX_BYTES} 字节（findings 过大？可改用 --blockers-only）`, stderr });
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (e) => {
      const reason = e?.code === 'ENOENT' ? '命令不存在（ENOENT）' : String(e?.message || e);
      finish({ ok: false, stage: 'spawn', error: reason, stderr });
    });
    child.on('close', (exitCode, signal) => {
      finish({ ok: true, stdout, stderr, exitCode: typeof exitCode === 'number' ? exitCode : null, signal });
    });
  });
}

/**
 * 跑提交前预处理引擎。
 * @param {object} p
 *   repoPath  : 仓库绝对路径（相对路径按当前工作目录解析，与旧行为一致）
 *   rulesetDir: 自定规则目录（调用方显式指定，透传不解析）
 *   blockersOnly: findings 只留 blocker
 *   cfg       : 运行期配置（读 preCommit）
 *   timeoutMs : 覆盖超时（测试用）
 * @returns {Promise<{ok: boolean, blocked: boolean, error?: string, audit: object|null,
 *   engine?: {command: string, args: string[], exitCode: number|null, timedOut: boolean}}>}
 */
export async function runPreCommitEngine({
  repoPath = '.', rulesetDir = '', blockersOnly = false,
  cfg = {}, timeoutMs, visibility = '', exemptPaths = [], exemptReason = '',
} = {}) {
  const spec = resolvePreCommitConfig(cfg);
  // 预处理实现是**可热插拔的扩展能力**：不在位时不该拦住提交，而应当「跳过审计并明确标注」。
  //   这正是解耦的目标——拔掉扩展，主流程照常；插上扩展，能力自动回来。
  //   注意：这里返回的是「跳过」而不是「静默通过」，调用方能拿到 preprocessSkipped 与原因。
  //   「不在位」的判据 = **实现包的 CLI 入口文件不存在**，与有没有显式配置 command 无关：
  //   用户完全可能把 preCommit.command 配成 `node` + args 指到包里的 cli.mjs，
  //   此时包被拔掉（optionalDependency 未装）也属「扩展没插」，不该拦提交；
  //   而自定义引擎换成别的脚本名时不会命中这条，仍是 fail-closed（那是配置错，不是缺扩展）。
  const missingProviderEntry = spec.args.find((rawArg) => {
    const text = String(rawArg || '');
    return text.endsWith(PREPROCESS_CLI_REL) && isAbsolute(text) && !existsSync(text);
  });
  if (missingProviderEntry) {
    const entry = resolveGateProvider();
    return {
      ok: true,
      audit: null,
      preprocessSkipped: 'package-not-found',
      skipReason: entry.ok ? '预处理实现不可用' : entry.error,
      engine: { command: '', args: [], exitCode: null, timedOut: false },
    };
  }
  const resolved = resolveEngineCommand(spec.command);
  // 显式配置的引擎命令不可用 ⇒ 这是配置错误（不是「扩展不在位」），仍然 fail-closed
  if (!resolved.ok) return failClosed(`提交前预处理失败：${resolved.error}（未执行任何 git 操作；修复 preCommit.command 后重试）`);
  const command = resolved.command;
  const args = buildEngineArgs({ args: spec.args, repoPath, rulesetDir, blockersOnly, visibility, exemptPaths, exemptReason });
  const commandLine = formatCommandLine(command, args);
  const effectiveTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.floor(Number(timeoutMs))
    : spec.timeoutMs;
  const run = await runEngineProcess({ command, args, timeoutMs: effectiveTimeout });

  if (!run.ok) {
    const label = run.stage === 'timeout' ? '超时' : run.stage === 'too-large' ? '输出超限' : '无法启动';
    return failClosed(`提交前预处理失败：引擎${label}（${run.error}）\n  命令：${commandLine}\n  stderr: ${stderrTail(run.stderr) || '（空）'}\n  （未执行任何 git 操作；修复引擎或临时关闭 preCommit.enabled 后重试）`);
  }
  const { exitCode, signal, stdout, stderr } = run;
  if (exitCode !== ENGINE_EXIT_OK && exitCode !== ENGINE_EXIT_BLOCKED) {
    const codeText = exitCode === null ? `被信号 ${signal || '?'} 终止` : `退出码 ${exitCode}`;
    return failClosed(`提交前预处理失败：引擎 ${commandLine} ${codeText}\n  stderr: ${stderrTail(stderr) || '（空）'}\n  （未执行任何 git 操作；修复引擎或临时关闭 preCommit.enabled 后重试）`);
  }
  const parsed = parseEngineStdout(stdout);
  if (!parsed.ok) {
    return failClosed(`提交前预处理失败：${parsed.error}\n  命令：${commandLine}（退出码 ${exitCode}）\n  stderr: ${stderrTail(stderr) || '（空）'}`);
  }
  return {
    ok: true,
    // 退出码 1 = 引擎看到 blocker；是否真的拦，由 git 侧豁免规则最终决定
    blocked: exitCode === ENGINE_EXIT_BLOCKED,
    audit: parsed.value,
    engine: { command, args, exitCode, timedOut: false },
  };
}
