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
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { existsSync, accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSettings } from '../app/settings-bridge.js';
// 工作树快照用（阶段改动的差集比对；只读 git status，不做任何写操作）
import { gitRaw } from '../git/index.js';
// 超时默认值取单一来源：schema 默认值与运行期兜底必须是同一个数字（见 lib/app/constants.js）
import { PRE_COMMIT_TIMEOUT_MS_DEFAULT } from '../app/constants.js';

export { PRE_COMMIT_TIMEOUT_MS_DEFAULT };

/** 阶段回执里「命中拦截的文件清单」最多列几个：只是给个线索，完整清单在 audit.blocked 里。 */
const BLOCKED_FILES_PREVIEW_MAX = 20;

/** 内置轻量入口（相对插件根）。配置留空时用它。 */


/**
 * 审计实现所属包名（拆包后审计实现在 `audit-sluice`）。
 * 为什么单独一个常量：入口解析、错误提示、将来 npm 依赖安装后的路径都引用它，避免多处手写字符串。
 */

/** 预处理实现的 CLI 入口（相对包根）。 */
export const PREPROCESS_CLI_REL = 'cli.mjs';

// 注意：这里不再写死具体实现的包名——包名属于 provider 定义（lib/preprocess/providers.js），
//   通用层只通过 provider 抽象拿它。将来换/加 provider 不需要改本文件。
import { resolveGateProvider, resolveProvider, listProviderManifests, getProviderDefinition, getCommitContributions, DEFAULT_PROVIDER_ID } from '../preprocess/providers.js';

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
 * 合法失败语义（provider 声明或用户配置只允许这三个值；其余一律当"没声明"处理）。
 * @type {ReadonlyArray<string>}
 */
export const STAGE_ON_FAIL = Object.freeze(['block', 'warn', 'skip']);

/**
 * 解析「有序阶段链」配置。
 *
 * 两种形态，语义严格区分（向后兼容是硬要求）：
 *   · `preCommit.stages` 为空/未配 ⇒ `mode:'single'`：走单命令路径（`preCommit.command` 或门禁 provider 默认入口）
 *     （`command`/`args`，缺省就是门禁 provider 的 CLI），行为与升级前逐字段一致
 *   · 非空 ⇒ `mode:'chain'`：按数组顺序逐阶段执行，每阶段独立超时与失败语义
 *
 * onFail 的解析**不看 provider 名字**（写死"audit 拦截 / format 警告"就是把具体实现
 *   固化进宿主，正是要清掉的耦合）：用户配置 > provider manifest 的 defaultOnFail > 'block'。
 *   其中 manifest 那一步需要异步读包，放在执行阶段做（见 resolveStageOnFail）。
 *
 * @param {object} [cfg] 运行期配置
 * @returns {{mode: 'single'|'chain', stages: Array<object>}}
 */
export function resolveStages(cfg = {}, paramStages = null) {
  const block = (cfg && typeof cfg.preCommit === 'object' && cfg.preCommit) || {};
  // 优先级：调用参数 > 配置 stages > （由调用方按 command/default 处理）
  const fromParam = Array.isArray(paramStages) && paramStages.length ? paramStages : null;
  const raw = fromParam || (Array.isArray(block.stages) ? block.stages : []);
  const source = fromParam ? 'param' : 'config';
  const stages = raw
    .map((stage, index) => normalizeStageItem(stage, index))
    .filter(Boolean);
  if (!stages.length) return { mode: 'single', stages: [], source: 'config' };
  return { mode: 'chain', stages: stages, source: source };
}

/**
 * 归一化单个阶段条目（两种合法形态 + 明确报错）。
 *
 *   A. `{ provider }`          —— 走 provider 注册表解析（已有通道）
 *   B. `{ command, args? }`    —— 跑任意脚本（**不要求**对方声明是"我们的扩展"）
 *
 * 非法时抛错（`StageConfigError`）：参数写错要在跑任何 git 操作之前就失败，
 *   不能等到 spawn 才发现——那会把"配置写错"表现成"提交时莫名报错"。
 * @param {object} stage 原始条目
 * @param {number} index 序号（错误信息里用）
 * @returns {object}
 */
function normalizeStageItem(stage, index) {
  const declaredStage = (stage && typeof stage === 'object') ? stage : null;
  if (!declaredStage) throw new StageConfigError(`预处理阶段第 ${index + 1} 项不是对象`);
  const provider = String(declaredStage.provider || '').trim();
  const command = String(declaredStage.command || '').trim();
  if (provider && command) throw new StageConfigError(`预处理阶段第 ${index + 1} 项同时给了 provider 和 command（只能二选一）`);
  if (!provider && !command) throw new StageConfigError(`预处理阶段第 ${index + 1} 项既没有 provider 也没有 command`);
  const onFailRaw = String(declaredStage.onFail || '').trim();
  const timeoutMs = Number(declaredStage.timeoutMs);
  const base = {
    index: index,
    // 空串 = 交给 provider 声明（provider 形态）/ 直接兜底 block（command 形态）
    onFail: STAGE_ON_FAIL.includes(onFailRaw) ? onFailRaw : '',
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 0,
  };
  if (provider) {
    // provider 形态：args 是**自由字典**（键名由该 provider 的 cliFlagMap 定义），宿主原样透传
    const providerArgs = (declaredStage.args && !Array.isArray(declaredStage.args) && typeof declaredStage.args === 'object')
      ? declaredStage.args : {};
    return { ...base, kind: 'provider', provider: provider, args: providerArgs };
  }
  const args = Array.isArray(declaredStage.args) ? declaredStage.args.map((a) => String(a)) : [];
  return { ...base, kind: 'command', command: command, args: args };
}

/** 阶段配置错误（与"引擎跑失败"区分开：那是执行错误，这是配置错误）。 */
export class StageConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StageConfigError';
  }
}

/**
 * 定某阶段的失败语义：用户配置 > provider manifest 的 defaultOnFail > 'block'。
 *
 * 为什么默认是 block：没声明就等于没承诺"失败也没关系"——放行一个跑失败的阶段，
 *   等于把"恰好没跑起来"当成"通过"（与门禁 fail-closed 同一原则）。
 *   想让格式化失败只警告的实现方，在自己的 manifest 里写 `defaultOnFail: 'warn'` 即可。
 * @param {{onFail: string}} stage resolveStages 的条目
 * @param {object|null} manifest provider 的 preprocessManifest（可为 null）
 * @returns {'block'|'warn'|'skip'}
 */
export function resolveStageOnFail(stage, manifest) {
  const fromUser = stage && STAGE_ON_FAIL.includes(stage.onFail) ? stage.onFail : '';
  if (fromUser) return fromUser;
  const fromManifest = manifest && STAGE_ON_FAIL.includes(manifest.defaultOnFail) ? manifest.defaultOnFail : '';
  if (fromManifest) return fromManifest;
  return 'block';
}

/**
 * 判断「提交前预处理要不要跑」（`preCommit.enabled`）。
 *
 * 判定顺序（**先看用户实际写下的配置，再看运行期默认值**）：
 *   ① `config.json` 里的 `preCommit.enabled`（用户显式配过）
 *   ② 运行期 cfg 的 `preCommit.enabled`（schema 默认值 / 调用方显式传入）
 *   ③ 关
 * 为什么不读任何旧键名：不替使用者猜「他旧的配置想干什么」——没写新键就是没配，走默认。
 * 为什么 ① 在 ② 之前：schema 有默认值，运行期 cfg 里**永远**有 `preCommit.enabled:false`，
 *   若先看 cfg 就永远读不到用户写下的真值。
 * @param {object} [cfg] 运行期配置
 * @returns {{enabled: boolean, source: 'config.json'|'cfg'|'default'}}
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
  // 运行期 cfg 有两种形态（都在用，不是"旧键兼容"）：
  //   · 嵌套 `preCommit.enabled` —— app/schema.js 的 Config() 形态（HTTP/设置页读到的）
  //   · 扁平 `preCommitEnabled`  —— client/index.js 的 defaultConfig() 形态（提交路径实际拿到的）
  //   此前只认嵌套 ⇒ 提交时读 defaultConfig() 永远拿不到开关，审计**默认永远关着**（实测踩到）。
  //   嵌套优先（更具体），扁平兜底。
  if (typeof cfg?.preCommit?.enabled === 'boolean') return { enabled: cfg.preCommit.enabled, source: 'cfg' };
  if (typeof cfg?.preCommitEnabled === 'boolean') return { enabled: cfg.preCommitEnabled, source: 'cfg' };
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
  visibility = '', providerParams = {}, flagMap = {},
} = {}) {
  const argv = [...resolveEngineArgs(args)];
  argv.push('--repo', String(repoPath || '.'));
  // provider 自报参数 → CLI flag：映射来自 manifest 的 cliFlagMap（宿主不写死任何实现参数名）
  for (const [paramName, rule] of Object.entries(flagMap || {})) {
    const value = (providerParams || {})[paramName];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) { if (value.length) argv.push(rule.flag, value.join(',')); continue; }
    const text = String(value);
    if (text) argv.push(rule.flag, text);
  }
  // 自定规则目录是**调用方显式指定**（工具 ruleset 参数 / API 传参），不是宿主配置，故保留透传。
  if (rulesetDir) argv.push('--ruleset', String(rulesetDir));
  // 可见性：只有明确知道时才传（unknown 是引擎缺省，传了也一样）；
  //   私有库豁免由预处理实现自己判（它是权威），gitpush 只负责探测后把结论传过去。
  if (visibility === 'private' || visibility === 'public') argv.push('--visibility', visibility);
  // 实现自己的参数（如临时豁免）不在这里写死：由 provider 的 cliFlagMap 决定 flag 名与拼法。
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
function runEngineProcess({ command, args, timeoutMs, env }) {
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
      // env 是**追加**的：不给就完全继承父进程环境（旧行为不变）
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(env || {}) } });
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
  cfg = {}, timeoutMs, visibility = '', providerParams = {}, flagMap = {}, env = null,
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
  // flagMap 缺省从「provider 贡献」缓存取（引擎本来就读 providers 注册表，不新增耦合面）
  const effectiveFlagMap = (flagMap && Object.keys(flagMap).length) ? flagMap : getCommitContributions().flagMap;
  // 防护：给了 provider 参数却没有映射表 ⇒ 这些参数会被**静默丢弃**（最危险的一类故障：
  //   调用方以为「我豁免了 a.js」，实际一条都没豁免，门禁照拦或照放都说不清）。
  //   成因通常是 primeCommitContributions() 没预热（直接调 API 而非走 apply()）。
  //   热插拔不受影响：provider 不在位时 providerParams 本来就是空的，不会命中这里。
  const declaredParamNames = Object.keys(providerParams || {});
  if (declaredParamNames.length && !Object.keys(effectiveFlagMap || {}).length) {
    return failClosed(
      `提交前预处理参数无法翻译成 CLI flag：未取到 provider 的 cliFlagMap，`
      + `本次传入的参数（${declaredParamNames.join(', ')}）会被丢弃。`
      + `常见原因：直接调用引擎而没先 primeCommitContributions() 预热；`
      + `或该 provider 的 manifest 没有声明 cliFlagMap。`,
    );
  }
  const args = buildEngineArgs({ args: spec.args, repoPath, rulesetDir, blockersOnly, visibility, providerParams, flagMap: effectiveFlagMap });
  const commandLine = formatCommandLine(command, args);
  const effectiveTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.floor(Number(timeoutMs))
    : spec.timeoutMs;
  const run = await runEngineProcess({ command, args, timeoutMs: effectiveTimeout, env: env });

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

/**
 * 跑「提交前预处理流水线」——阶段链的入口。
 *
 * 与 `runPreCommitEngine` 的分工：后者是**单次执行**（解析命令 → spawn → 按契约解释结果），
 *   本函数只做「按配置决定跑几个阶段、按什么顺序、失败了怎么办」，不重复实现执行细节。
 *
 * 三种形态：
 *   · `preCommit.stages` 未配/空 ⇒ **原样调用 runPreCommitEngine**（回执与升级前逐字段一致）
 *   · 只配一个阶段 ⇒ 也走同一条单次执行路径（按该阶段 provider 的 CLI 跑），回执形状不变
 *   · 多阶段 ⇒ 按数组顺序逐阶段执行；每阶段独立超时；失败语义见 resolveStageOnFail
 *
 * @param {object} opts 与 runPreCommitEngine 相同的入参（repoPath / visibility / exemptPaths / cfg / …）
 * @returns {Promise<object>} legacy/单阶段：与 runPreCommitEngine 同形状；
 *   多阶段：在它基础上追加 `preprocessStages`（逐阶段回执）等 additive 字段
 */
export async function runPreCommitPipeline(opts = {}) {
  let plan;
  try {
    plan = resolveStages(opts.cfg, opts.stages);
  } catch (e) {
    // 配置错误要在**跑任何 git 操作之前**就失败（runPreprocess 在 add/commit 之前调用）
    return failClosed(`提交前预处理失败：${e && e.message ? e.message : e}`);
  }
  // ── 兼容路径：没配阶段链 ⇒ 行为与升级前完全一致（不追加任何字段）──
  if (plan.mode === 'single') {
    // 单命令 / 单 provider 兜底：回执不变，只补一个来源标识（additive，便于观测本次跑的是谁）
    const legacy = await runPreCommitEngine(opts);
    const block = (opts.cfg && opts.cfg.preCommit) || {};
    const legacySource = (block.command || (Array.isArray(block.args) && block.args.length)) ? 'command' : 'default';
    return { ...legacy, stagesSource: legacySource };
  }
  // ── 配了 stages（哪怕只有一个）：一律走链执行 ──
  //   为什么单阶段也走链：这样"改了哪些文件"（preprocessChanges）对单阶段同样可用，
  //   否则「只配了一个格式化 provider」的用户永远看不到改动清单。
  //   代价仅是回执多出 additive 字段（preprocessStages / preprocessChanges），
  //   拦截决策与执行路径完全复用同一实现。
  return runChain(plan.stages, opts, plan.source || 'config');
}

/** 单文件内容指纹（读不到/非普通文件返回空串，不抛）。 */
function fileFingerprint(absPath) {
  try {
    const st = statSync(absPath);
    if (!st.isFile()) return 'nonfile';
    const buf = readFileSync(absPath);
    return createHash('sha256').update(buf).digest('hex').slice(0, 16);
  } catch { return ''; }
}

/** 工作树快照上限：超过就退化为「只比状态码」，避免大改动拖慢提交。 */
const STAGE_SNAPSHOT_MAX_FILES = 500;

/**
 * 拍一次工作树快照：`git status --porcelain` 列出的每个路径 → `状态码|大小|内容指纹`。
 *
 * 为什么不能只比状态码：格式化器改写一个**本来就已经是 M** 的文件时，status 前后都是 " M"，
 *   只看状态码会得出"没改动"的假结论（这正是要防的）。
 * 为什么不只看 mtime：跑两次格式化，第二次内容完全相同时 mtime 仍会变 ⇒ 会把幂等误报成有改动。
 *   ⇒ 用**内容指纹**，幂等才是真的幂等。
 * @param {string} repoPath 仓库绝对路径
 * @returns {{ok: boolean, files: Map<string,string>, truncated?: boolean}}
 */
export function snapshotWorktree(repoPath) {
  // 必须用 gitRaw + -z：runGit 会 trim 输出，而 porcelain 的状态首列**可能就是一个空格**
  //   （未暂存修改 = " M"）——trim 会把那个空格吃掉，路径整体左移一位，
  //   结果得到 ".js" 这种假路径（本函数第一版就是这么错的，靠"改动清单里没有 a.js"抓到）。
  //   -z 分隔的原始字节不受 trim 影响。
  const res = gitRaw(['status', '--porcelain', '-z'], { cwd: repoPath });
  const files = new Map();
  if (res.error || res.status === null) return { ok: false, files: files };
  const entries = res.stdout.toString('utf8').split('\0').filter((entry) => entry.length > 2);
  const truncated = entries.length > STAGE_SNAPSHOT_MAX_FILES;
  for (const line of entries.slice(0, STAGE_SNAPSHOT_MAX_FILES)) {
    // porcelain v1 -z：每项 "XY path"（重命名是 "XY new\0old"，旧路径项会被上面的长度过滤挡住）
    const code = line.slice(0, 2);
    let rel = line.slice(3);
    rel = rel.replace(/^"|"$/g, '');
    if (!rel) continue;
    const abs = joinPath(repoPath, rel);
    const size = (() => { try { return String(statSync(abs).size); } catch { return '0'; } })();
    const fp = truncated ? '' : fileFingerprint(abs);
    files.set(rel, code + '|' + size + '|' + fp);
  }
  return { ok: true, files: files, ...(truncated ? { truncated: true } : {}) };
}

/**
 * 两次快照的差集 = 这一阶段到底改了什么。
 *
 * 判定：
 *   · 只在 after 里 ⇒ 新增
 *   · 只在 before 里 ⇒ 删除（格式化器不会删，但"会改文件"的 provider 可能）
 *   · 两边都有但指纹/大小/状态码不同 ⇒ 修改（**这是格式化最常见的形态**）
 * @param {Map<string,string>} before
 * @param {Map<string,string>} after
 * @returns {{added: number, modified: number, deleted: number, files: string[]}}
 */
export function diffSnapshots(before, after) {
  const added = [];
  const modified = [];
  const deleted = [];
  for (const [rel, sig] of after) {
    if (!before.has(rel)) { added.push(rel); continue; }
    if (before.get(rel) !== sig) modified.push(rel);
  }
  for (const rel of before.keys()) if (!after.has(rel)) deleted.push(rel);
  return {
    added: added.length,
    modified: modified.length,
    deleted: deleted.length,
    files: [...added, ...modified, ...deleted].sort(),
  };
}

/**
 * 顺序执行阶段链。
 *
 * 语义（与配置解耦，宿主不认 provider 名字）：
 *   · **顺序**：数组顺序即执行顺序，前一个跑完才跑下一个（格式化必须先于审计改完文件）
 *   · **每阶段独立超时**：stage.timeoutMs > 0 时覆盖全局超时
 *   · **失败语义**：resolveStageOnFail（用户 > provider 声明 > 'block'）
 *       block ⇒ 立即中断并拒绝提交；warn ⇒ 记警告继续；skip ⇒ 静默跳过继续
 *   · **实现不在位**（provider 没装）不算失败 ⇒ 记 `skipped` + 警告，继续下一阶段
 *     （与单阶段「拔掉扩展仍能提交」的热插拔语义一致）
 * @param {Array<{provider: string, onFail: string, timeoutMs: number}>} stages
 * @param {object} opts 与 runPreCommitEngine 相同
 * @returns {Promise<object>} 追加 `preprocessStages`（逐阶段回执）与可选 `preprocessWarnings`
 */
async function runChain(stages, opts = {}, chainSource = 'config') {
  const stageReceipts = [];
  const warnings = [];
  const allChanged = [];
  let lastAudit = null;
  let lastEngine = null;
  let lastSkipped = null;

  // 一次性取全部在位 provider 的声明（onFail 的默认值来自它；读不到就当没声明）
  let manifestsById = new Map();
  try {
    const listed = await listProviderManifests();
    manifestsById = new Map((listed.manifests || []).map((m) => [m.provider.id, m.manifest]));
  } catch { /* 读不到声明不影响执行：onFail 退回默认 block */ }

  // 链开始时的「本次改动」：这就是用户马上要提交的那批文件（格式化要处理的正是它们）
  const initialSnap = snapshotWorktree(opts.repoPath || '.');
  const changedSoFar = new Set(initialSnap.ok ? [...initialSnap.files.keys()] : []);
  const envDir = mkdtempSync(joinPath(tmpdir(), 'dsh-preprocess-'));

  try {
  for (const stage of stages) {
    const startedAt = Date.now();
    // 两种阶段形态：provider（走注册表解析）与 command（跑任意脚本，不要求对方声明）
    const stageLabel = stage.kind === 'provider' ? stage.provider : commandLabelOf(stage.command);
    let providerEntry = null;
    if (stage.kind === 'provider') {
      providerEntry = resolveProvider(stage.provider);
      if (!providerEntry.ok) {
        // 两种"解析失败"必须分开处理，否则会把配置错当成"没装"而静默放行：
        //   ① provider 名字不在注册表里 ⇒ 配置写错了 ⇒ fail-closed（打错一个字母就让整道门禁消失，太危险）
        //   ② 注册过但入口文件不在 ⇒ 扩展没装 ⇒ 跳过 + 警告，不拦提交（热插拔语义）
        if (!getProviderDefinition(stage.provider)) {
          return failClosed(`提交前预处理失败：阶段配置里的 provider 「${stage.provider}」未注册（已注册：audit 等，见 lib/preprocess/providers.js）`);
        }
        stageReceipts.push({ provider: stageLabel, ok: true, skipped: 'provider-not-found', ms: 0, error: providerEntry.error });
        warnings.push(`${stageLabel}: 未安装/入口不可用，已跳过该阶段`);
        lastSkipped = { preprocessSkipped: 'package-not-found', skipReason: providerEntry.error };
        continue;
      }
    }
    const onFail = resolveStageOnFail(stage, stage.kind === 'provider' ? (manifestsById.get(stage.provider) || null) : null);
    // 改动的可见性：阶段前后各拍一次工作树快照，差集就是它改了哪些文件。
    //   放在宿主而不是要求 provider 上报：任何"会改文件"的实现（格式化/自动修复/锁更新）都通用。
    const beforeSnap = snapshotWorktree(opts.repoPath || '.');
    // 把「本次改动」以**环境变量**的形式交给实现方（想读就读，不读就当没看见 ⇒ 不改变既有契约）。
    //   换行分隔而不是逗号：文件名里可以有逗号，换行几乎不可能。
    //   同时落一份文件路径：文件很多时单个环境变量会撞 128KB 上限。
    const stageEnv = buildStageEnv({
      repoPath: opts.repoPath || '.',
      provider: stage.provider,
      changed: [...changedSoFar],
      envDir: envDir,
    });
    const stageCfg = stage.kind === 'provider'
      ? withStageOverride(opts.cfg, providerEntry.path, stage.timeoutMs)
      : withCommandStage(opts.cfg, stage, {
        repo: opts.repoPath || '.',
        filesFile: stageEnv.listFile,
        filesCount: String(changedSoFar.size),
        stage: String(stageReceipts.length + 1),
      }, stage.timeoutMs);
    const res = await runPreCommitEngine({
      ...opts,
      cfg: stageCfg,
      env: stageEnv.env,
      // 该阶段自己的参数：自由字典，宿主不认识内容，只按 manifest 的 cliFlagMap 翻 flag
      providerParams: (stage.args && !Array.isArray(stage.args) && typeof stage.args === 'object') ? stage.args : {},
    });
    const afterSnap = snapshotWorktree(opts.repoPath || '.');
    const changed = (beforeSnap.ok && afterSnap.ok) ? diffSnapshots(beforeSnap.files, afterSnap.files) : null;
    const ms = Date.now() - startedAt;
    const providerSkipped = !!res.preprocessSkipped;
    const hitBlockers = res.ok === true && res.blocked === true;
    const failed = res.ok !== true;

    stageReceipts.push({
      provider: stageLabel,
      ...(stage.kind === 'command' ? { kind: 'command' } : {}),
      ok: !failed && !hitBlockers,
      onFail: onFail,
      ms: ms,
      ...(providerSkipped ? { skipped: res.preprocessSkipped, reason: res.skipReason || '' } : {}),
      ...(hitBlockers ? { blocked: blockedSummaryOf(res) } : {}),
      ...(failed ? { error: res.error || '执行失败' } : {}),
      // 本阶段改动的文件清单（null = 拍不到快照，例如非 git 目录）
      ...(changed ? { changed: changed } : {}),
    });
    allChanged.push(...((changed && changed.files) || []));
    for (const rel of (changed && changed.files) || []) changedSoFar.add(rel);
    if (res.engine) lastEngine = res.engine;
    if (res.audit) lastAudit = res.audit;
    if (providerSkipped) { lastSkipped = { preprocessSkipped: res.preprocessSkipped, skipReason: res.skipReason || '' }; continue; }

    if (failed) {
      if (onFail === 'warn') { warnings.push(`${stage.provider}: ${res.error || '执行失败'}（该阶段为 warn，继续）`); continue; }
      if (onFail === 'skip') continue;
      // block：中断整条链，拒绝提交（保留可诊断信息 + 已跑阶段的回执）
      return {
        ...res,
        preprocessStages: stageReceipts,
        preprocessChanges: { total: new Set(allChanged).size, files: [...new Set(allChanged)].sort() },
        ...(warnings.length ? { preprocessWarnings: warnings } : {}),
      };
    }
    if (hitBlockers) {
      if (onFail === 'warn') { warnings.push(`${stage.provider}: 命中拦截项（该阶段为 warn，仅记录）`); continue; }
      if (onFail === 'skip') continue;
      return {
        ok: true,
        blocked: true,
        audit: res.audit || null,
        engine: res.engine || null,
        preprocessStages: stageReceipts,
        preprocessChanges: { total: new Set(allChanged).size, files: [...new Set(allChanged)].sort() },
        ...(warnings.length ? { preprocessWarnings: warnings } : {}),
      };
    }
  }

  return {
    ok: true,
    blocked: false,
    audit: lastAudit,
    engine: lastEngine,
    ...(lastSkipped && !lastAudit ? lastSkipped : {}),
    preprocessStages: stageReceipts,
    // 汇总：整条链一共改了哪些文件（去重排序；格式化改的文件会被后续 git add 一并提交）
    preprocessChanges: { total: new Set(allChanged).size, files: [...new Set(allChanged)].sort() },
    // 本次链的来源：param（调用参数覆盖）/ config（配置文件）
    stagesSource: chainSource,
    ...(warnings.length ? { preprocessWarnings: warnings } : {}),
  };
  } finally {
    // 临时目录只装「改动文件清单」，链跑完就删（不在 /tmp 里堆垃圾）
    try { rmSync(envDir, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ }
  }
}

/**
 * 造「当前阶段」的环境变量（想读就读，不读就当没看见 ⇒ 不改变既有 provider 契约）。
 *
 * 变量（都是**加法**，老实现完全不需要知道它们）：
 *   PREPROCESS_REPO                  当前仓库绝对路径
 *   PREPROCESS_CHANGED_FILES         本次改动文件（**换行**分隔；文件名里可以有逗号，换行几乎不可能）
 *   PREPROCESS_CHANGED_FILES_COUNT   条数
 *   PREPROCESS_CHANGED_FILES_FILE    同一份清单落盘的绝对路径（文件多时单个变量会撞 128KB 上限）
 *   PREPROCESS_STAGE_PROVIDER        当前阶段的 provider id
 * @param {{repoPath: string, provider: string, changed: string[], envDir: string}} p
 * @returns {{env: object, listFile: string}}
 */
export function buildStageEnv({ repoPath = '.', provider = '', changed = [], envDir = '' } = {}) {
  const list = changed.filter(Boolean);
  const text = list.join('\n');
  let listFile = '';
  if (envDir) {
    listFile = joinPath(envDir, 'changed-files.txt');
    try { writeFileSync(listFile, text, 'utf8'); } catch { listFile = ''; }
  }
  const env = {
    PREPROCESS_REPO: String(repoPath || '.'),
    PREPROCESS_CHANGED_FILES: text,
    PREPROCESS_CHANGED_FILES_COUNT: String(list.length),
    ...(listFile ? { PREPROCESS_CHANGED_FILES_FILE: listFile } : {}),
    ...(provider ? { PREPROCESS_STAGE_PROVIDER: String(provider) } : {}),
  };
  return { env: env, listFile: listFile };
}

/**
 * 从单阶段回执里抽出「拦截清单摘要」——阶段回执只报事实（几条、头几条文件），
 *   完整 findings 仍在最终 audit 里，不在这里复制一份（避免两份真相）。
 * @param {object} res runPreCommitEngine 的回执
 * @returns {{count: number, files: string[]}}
 */
function blockedSummaryOf(res) {
  const audit = (res && res.audit) || {};
  const blocked = Array.isArray(audit.blocked) ? audit.blocked : [];
  return {
    count: blocked.length,
    files: [...new Set(blocked.map((b) => String(b && b.file || '')).filter(Boolean))].slice(0, BLOCKED_FILES_PREVIEW_MAX),
  };
}

/**
 * 造一份「指定 provider 入口」的临时 cfg：让 runPreCommitEngine 走显式 args 分支。
 *
 * 为什么不改 runPreCommitEngine 的签名：它已经支持「command/args 显式指定」，这里只是
 *   把阶段解析结果喂进那条既有通道 —— 单次执行只有一份实现，避免两套 spawn 逻辑漂移。
 * @param {object} cfg 原运行期配置
 * @param {string} cliPath provider 的 CLI 绝对路径
 * @param {number} timeoutMs 该阶段超时（0=沿用全局）
 * @returns {object}
 */
function withStageOverride(cfg, cliPath, timeoutMs) {
  const base = (cfg && typeof cfg.preCommit === 'object' && cfg.preCommit) || {};
  return {
    ...cfg,
    preCommit: {
      ...base,
      command: '',
      args: [cliPath],
      ...(timeoutMs > 0 ? { timeoutMs: timeoutMs } : {}),
    },
  };
}

/** 阶段标签（command 形态）：取可执行文件名，便于回执里认人。 */
function commandLabelOf(command) {
  const first = splitCommandLine(String(command || ''))[0] || String(command || '');
  return joinPath('.', first).replace(/^\.\//, '') || 'command';
}

/**
 * 按 shell-like 规则切词 —— **不启动真 shell**。
 *
 * 为什么不用 `sh -c`：那等于把配置里的字符串当代码执行（`; rm -rf /` 会被执行）。
 *   这里只做引号/空白切分，任何 `;` `|` `$()` 都原样当作普通参数传下去。
 * 规则：单/双引号成组（引号内空格不切分）；反斜杠转义下一个字符；其余按空白切分。
 * @param {string} text 命令行文本
 * @returns {string[]} 词数组（首项通常是可执行文件）
 */
export function splitCommandLine(text) {
  const out = [];
  let cur = '';
  let quote = '';
  let has = false;
  const src = String(text || '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) { quote = ''; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < src.length) { cur += src[i + 1]; i += 1; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (ch === '\\' && i + 1 < src.length) { cur += src[i + 1]; i += 1; has = true; continue; }
    if (/\s/.test(ch)) {
      if (has || cur) { out.push(cur); cur = ''; has = false; }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has || cur) out.push(cur);
  return out;
}

/** 占位符替换：{repo} / {filesFile} / {filesCount} / {stage}（宿主替换，未知占位符原样保留）。 */
export function substitutePlaceholders(value, ctx = {}) {
  return String(value == null ? '' : value).replace(/\{(repo|filesFile|filesCount|stage)\}/g,
    (whole, key) => (ctx[key] === undefined || ctx[key] === null ? whole : String(ctx[key])));
}

/**
 * 造「command 形态阶段」的临时 cfg。
 *
 * 两种写法都支持：
 *   A. `{ command: 'node', args: ['x.mjs', '{filesFile}'] }` —— **不走 shell**，文件名含空格也安全（推荐）
 *   B. `{ command: 'node x.mjs --mode staged' }`              —— 按 shell-like 切词（不启动真 shell）
 * 占位符在两种写法里都替换（{repo} / {filesFile} / {filesCount} / {stage}）。
 * @param {object} cfg 原运行期配置
 * @param {{command: string, args: string[]}} stage 阶段条目
 * @param {object} ctx 占位符上下文
 * @param {number} timeoutMs 该阶段超时（0=沿用全局）
 * @returns {object}
 */
function withCommandStage(cfg, stage, ctx, timeoutMs) {
  const base = (cfg && typeof cfg.preCommit === 'object' && cfg.preCommit) || {};
  const declaredArgs = Array.isArray(stage.args) ? stage.args : [];
  let command = '';
  let args = [];
  if (declaredArgs.length) {
    command = substitutePlaceholders(stage.command, ctx);          // A：可执行文件 + 参数数组
    args = declaredArgs.map((a) => substitutePlaceholders(a, ctx));
  } else {
    const words = splitCommandLine(stage.command).map((w) => substitutePlaceholders(w, ctx)); // B：整串切词
    command = words[0] || '';
    args = words.slice(1);
  }
  return {
    ...cfg,
    preCommit: {
      ...base,
      command: command,
      args: args,
      ...(timeoutMs > 0 ? { timeoutMs: timeoutMs } : {}),
    },
  };
}
