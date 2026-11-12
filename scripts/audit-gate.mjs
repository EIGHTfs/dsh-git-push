#!/usr/bin/env node
// 提交前审计引擎 · 轻量门禁入口（不是给人看的 CLI，只服务 commit 门禁）
//
// 为什么单独开一个入口、不复用 cli.mjs（实测数字决定，别改成"复用更省事"）：
//   同一仓库、同一 scope、同一台 CIFS 机器上——
//     进程内直接调审计内核         1.0s
//     本轻量入口（子进程 + JSON）  1.3s
//     cli.mjs audit --json         6.4s
//   多出来的 5.4s 全是 cli.mjs 全家桶的 ESM 模块解析（account/vcs/doc/npm/git 命令族被
//   一路链式 import 进来），与本次审计无关。门禁每次提交都要跑，不能为此付 5 秒。
//   所以本文件**只** import 审计内核与评分两层，加任何新的 import 前先量耗时。
//
// 契约（与实现语言无关，替代引擎照此实现即可）：
//   stdout : 一行 JSON { ok, scope, summary, quality, findings, files }
//   退出码 : 0 = 无 blocker（放行）/ 1 = 有 blocker（拦截）/ 2 = 执行失败（参数错、内部异常）
//   stderr : 仅诊断信息，不参与判定
//   --blockers-only : findings 只留 blocker 级（大仓 4900 条约 3.8MB，门禁未必需要全量）
//
// stdout 纯净性：审计过程里任何 console.* / 直接 stdout 写入都被临时改道到 stderr，
//   最后只由本文件写那一行 JSON。否则调用方 JSON.parse 会被进度噪音打死（历史故障）。
//
// 参数缺省语义（必须与插件默认配置等价，测试钉住）：
//   --max-scan-files 缺省 = DEFAULT_MAX_SCAN_FILES（3000），**不是 0**
//     —— capScanFiles 里 0 的含义是「不限」，把缺省当 0 会把大仓全量扫，语义正好相反。
//   --disabled-slots 缺省 = 不禁用任何槽位。
//   --slots 缺省 = 不限定规则包（加载层默认偏好顺序）；只在调用方显式给白名单时传。

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// 宿主文档漂移检查器接线（导入即安装，幂等）：`lib/audit/**` 不许 import scripts/**，
//   这两个检查器由宿主入口注入。漏掉这一行会让「目录树漂移 / 函数列表漂移」两类 finding
//   整类消失（实测同一棵树上少 4 条 finding）——**行为一致性要求本入口必须显式接线**，
//   与 lib/commit-push.js / cli.mjs 两处宿主入口同款。依赖只有 node 内置模块，几乎零加载代价。
import '../lib/app/host-doc-checks.js';
import { auditWithScope } from '../lib/audit/index.js';
import { scoreQuality } from '../lib/score/index.js';

/** 退出码语义（任何语言都能实现 exit 0/1/2，比让调用方解析 JSON 猜语义可靠）。 */
export const EXIT_OK = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_FAILED = 2;

/**
 * 引擎侧「全量扫描文件数上限」默认值。
 * 单一来源是 lib/app/schema-audit.js 的 DEFAULT_MAX_SCAN_FILES（3000，由 lib/client/index.js
 * 的 MAX_SCAN_FILES_DEFAULT 与之对齐）。本文件不复用那个常量是因为轻量入口不能 import
 * lib/app/ 与 lib/client/（那会把加载代价拉回去）。代价是两处数字必须相等 ——
 * test/test-pre-commit-engine.mjs 用 defaultConfig().maxScanFiles 钉住这条，改一处漏另一处会变红。
 */
export const DEFAULT_MAX_SCAN_FILES = 3000;

/** 参数错误统一用这个错误类型，main 据此输出「用法」而不是「内部异常」。 */
export class GateUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GateUsageError';
  }
}

/**
 * 解析命令行参数（纯函数，测试可直接调用，不必起子进程）。
 * @param {string[]} argv 不含 node 与脚本路径的参数表
 * @returns {{repo: string, scope: 'diff'|'full', rulesetDir: string, weights: object,
 *   maxScanFiles: number, disabledSlots: string[], blockersOnly: boolean, json: boolean}}
 */
/** 取值的参数解析器（各自单职责，主循环只做分派——避免一个巨型 if 链）。 */
function parseScopeValue(rawValue) {
  if (rawValue !== 'diff' && rawValue !== 'full') throw new GateUsageError(`--scope 只接受 diff|full，收到：${rawValue}`);
  return rawValue;
}

function parseWeightsValue(rawValue) {
  let parsedWeights;
  try {
    parsedWeights = JSON.parse(rawValue);
  } catch (e) {
    throw new GateUsageError(`--weights 不是合法 JSON：${e.message}`);
  }
  return parsedWeights && typeof parsedWeights === 'object' ? parsedWeights : {};
}

function parseMaxScanFilesValue(rawValue) {
  const asNumber = Number(rawValue);
  // 只接受非负有限数：0 有明确含义（不限），所以不能用 falsy 判断把它当成「没传」
  if (!Number.isFinite(asNumber) || asNumber < 0) throw new GateUsageError(`--max-scan-files 需要非负数字，收到：${rawValue}`);
  return asNumber;
}

function parseSlotListValue(rawValue) {
  return String(rawValue).split(',').map((slotName) => slotName.trim()).filter(Boolean);
}

/**
 * 参数分派表：键是参数名，值是「要不要取值 + 怎么落到解析结果上」。
 * 未知参数一律报错（不做静默忽略）——拼错的参数被忽略，等于门禁悄悄少传一项设置。
 */
const GATE_FLAG_SPECS = {
  '--repo': { needsValue: true, apply: (target, rawValue) => { target.repo = rawValue; } },
  '--scope': { needsValue: true, apply: (target, rawValue) => { target.scope = parseScopeValue(rawValue); } },
  '--ruleset': { needsValue: true, apply: (target, rawValue) => { target.rulesetDir = rawValue; } },
  '--weights': { needsValue: true, apply: (target, rawValue) => { target.weights = parseWeightsValue(rawValue); } },
  '--max-scan-files': { needsValue: true, apply: (target, rawValue) => { target.maxScanFiles = parseMaxScanFilesValue(rawValue); } },
  '--disabled-slots': { needsValue: true, apply: (target, rawValue) => { target.disabledSlots = parseSlotListValue(rawValue); } },
  '--slots': { needsValue: true, apply: (target, rawValue) => { target.slots = parseSlotListValue(rawValue); } },
  '--blockers-only': { needsValue: false, apply: (target) => { target.blockersOnly = true; } },
  '--json': { needsValue: false, apply: (target) => { target.json = true; } },
};

/**
 * 解析命令行参数（纯函数，测试可直接调用，不必起子进程）。
 * @param {string[]} argv 不含 node 与脚本路径的参数表
 * @returns {{repo: string, scope: 'diff'|'full', rulesetDir: string, weights: object,
 *   maxScanFiles: number, disabledSlots: string[], slots: string[], blockersOnly: boolean, json: boolean}}
 */
export function parseGateArgs(argv = []) {
  const target = {
    repo: '',
    scope: 'diff',
    rulesetDir: '',
    weights: {},
    maxScanFiles: DEFAULT_MAX_SCAN_FILES,
    disabledSlots: [],
    slots: [],
    blockersOnly: false,
    json: false,
  };
  for (let cursor = 0; cursor < argv.length; cursor += 1) {
    const flagName = argv[cursor];
    const spec = GATE_FLAG_SPECS[flagName];
    if (!spec) throw new GateUsageError(`不认识的参数：${flagName}`);
    if (!spec.needsValue) { spec.apply(target); continue; }
    const flagValue = argv[cursor + 1];
    if (flagValue === undefined) throw new GateUsageError(`参数 ${flagName} 缺少取值`);
    cursor += 1;
    spec.apply(target, flagValue);
  }
  if (!target.repo) throw new GateUsageError('缺少必填参数 --repo <仓库绝对路径>');
  return target;
}

/**
 * 跑一次审计并组装契约 JSON（纯逻辑，测试可直接调用）。
 * 与旧「进程内提交门禁」逐项对齐的点：
 *   · scope / maxScanFiles / rulesetDir / disabledSlots 的取值路径完全相同；
 *   · 评分上下文只给 files / dimFileCounts / dimRuleCounts（**不给 docsScore**）——
 *     旧 runAudit 就是这么调的，多给一项会让分数变化；
 *   · summary 直接透传内核结果，不在这里重新计数。
 * @param {object} opts parseGateArgs 的返回值
 * @returns {Promise<{ok: boolean, scope: string, summary: object, quality: object, findings: object[], files: number}>}
 */
export async function runGateAudit(opts) {
  const auditResult = await auditWithScope(opts.repo, {
    scope: opts.scope,
    maxScanFiles: opts.maxScanFiles,
    rulesetDir: opts.rulesetDir,
    // 空数组与 undefined 在加载层同义（都用默认偏好顺序），显式给 undefined 更贴合旧行为
    slots: Array.isArray(opts.slots) && opts.slots.length ? opts.slots : undefined,
    disabledSlots: Array.isArray(opts.disabledSlots) ? opts.disabledSlots : [],
  });
  const quality = scoreQuality(auditResult.findings, opts.weights, {
    files: auditResult.files,
    dimFileCounts: auditResult.dimFileCounts,
    dimRuleCounts: auditResult.dimRuleCounts,
  });
  const findings = opts.blockersOnly
    ? (auditResult.findings || []).filter((finding) => finding.severity === 'blocker')
    : (auditResult.findings || []);
  return {
    ok: (auditResult.summary?.blocker ?? 0) === 0,
    scope: auditResult.scope,
    summary: auditResult.summary,
    quality,
    findings,
    files: auditResult.files,
  };
}

/**
 * 把审计期间的一切 stdout 写入改道到 stderr，返回还原函数。
 * 为什么不用「审计结束后从 stdout 里找 JSON 行」：findings 可达数 MB 且内容里可能含
 * 花括号，正则挑行不可靠；从源头保证 stdout 只有一行才是可验证的。
 */
export function muteStdout() {
  const originalWrite = process.stdout.write;
  process.stdout.write = process.stderr.write.bind(process.stderr);
  return () => { process.stdout.write = originalWrite; };
}

/** 写契约 JSON 并在冲刷完成后退出（flush 后再 exit，避免大 payload 被截断）。 */
function emitAndExit(result, exitCode) {
  const payload = `${JSON.stringify(result)}\n`;
  process.stdout.write(payload, () => { process.exit(exitCode); });
}

/** 入口：解析 → 审计 → 输出 → 定退出码。 */
async function main(argv) {
  let opts;
  try {
    opts = parseGateArgs(argv);
  } catch (e) {
    process.stderr.write(`${e.name === 'GateUsageError' ? '参数错误' : '内部错误'}：${e.message}\n`);
    return EXIT_FAILED;
  }
  const restoreStdout = muteStdout();
  let gateAuditResult;
  try {
    gateAuditResult = await runGateAudit(opts);
  } catch (e) {
    process.stderr.write(`审计执行失败（repo=${opts.repo} scope=${opts.scope}）：${e?.stack || e}\n`);
    return EXIT_FAILED;
  } finally {
    restoreStdout();
  }
  emitAndExit(gateAuditResult, gateAuditResult.ok ? EXIT_OK : EXIT_BLOCKED);
  // emitAndExit 内部已注册退出，这里返回一个占位码保持函数语义完整
  return gateAuditResult.ok ? EXIT_OK : EXIT_BLOCKED;
}

/** 直接执行时才真正开跑：被测试 import 时不得产生副作用。 */
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return resolve(entry) === resolve(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then((code) => {
    // 正常路径里 emitAndExit 已经退出；走到这里说明审计抛错或没输出结果
    if (typeof code === 'number') process.exitCode = code;
  }).catch((e) => {
    process.stderr.write(`未捕获异常：${e?.stack || e}\n`);
    process.exit(EXIT_FAILED);
  });
}
