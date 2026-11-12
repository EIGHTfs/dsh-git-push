#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * dsh-git-push 独立 CLI · **审计侧**（bin: audit-sluice）
 * 不依赖 DSH 运行时，可独立运行。
 *
 * 为什么单独一个入口（而不是继续挂在 git-sluice 里）：
 *   审计引擎上一轮已经解耦成「可配置子进程」，但入口层如果还共用，用户仍得敲
 *   `git-sluice audit` 才能跑到审计——「审计侧独立」只做了一半。现在审计有自己的 CLI，
 *   换引擎（含换语言重写）与换 CLI 组合互不影响。
 *
 * ⚠️⚠️ 两条**纯副作用 import** 是本入口的生命线（删了不报错、少了不报错，只会让功能静默失效）：
 *   ① ./lib/app/host-doc-checks.js —— 目录树漂移 / 函数列表漂移两类检查器由宿主注入。
 *      漏搬后果：同一棵树上这两类 finding **整类消失**（实测少 4 条），审计照常「通过」。
 *   ② ./lib/rule/compilers.js —— 规则编译函数注册（13 种）。
 *      漏搬后果：`ruleset` 命令编译出 0 条规则却报「OK」。
 *   （`audit` 走 lib/audit/index.js，那条路径自身也会注册编译器；但 `ruleset` 不走审计编排，
 *     必须靠本文件的显式 import。两处都留是刻意的冗余——这类静默失效不值得省一行 import。）
 *
 * 本文件只保留：命令表 + HELP 文本 + 薄壳。解析/打印/分发/跨侧提示都在 lib/cli/shared.mjs。
 */
import './lib/app/host-doc-checks.js'; // 副作用①：文档漂移检查器接线（审计专用）
import './lib/rule/compilers.js'; // 副作用②：规则编译函数注册（audit / ruleset 依赖）

import { VERSION } from './lib/self/index.js';
import { loadRuleFiles } from './lib/rule/loader.js';
import { compileAllRules } from './lib/rule/registry.js';

import {
  cmdAudit, cmdScan, pluginEqualAuditOpts, pluginEqualWeights, cliPluginConfig,
} from './lib/cli/commands-audit.mjs';
import { cmdLinkCheck } from './lib/cli/commands-vcs.mjs';
import { cmdFileIo, cmdTreeDoc, cmdFunctions } from './lib/cli/commands-doc.mjs';
import {
  CLI_AUDIT, CLI_ENTRIES, printToolResult, parseArgv, parseVia, runAsEntry, runCli,
} from './lib/cli/shared.mjs';

export const CLI_NAME = CLI_AUDIT;

/** parseArgv 认识的选项白名单（本侧 HELP 写着的那批；self-check 机器比对本表与 HELP 文本）。
 * 注：**注册表驱动**命令（file-io / link-check / scope-check）的参数由
 *   lib/app/command-registry.js 的 params 校验，与本表无关；本侧 HELP 写了的 flag 必须在本表出现。 */
export const KNOWN_FLAGS = [
  '--allowlist', '--files', '--full', '--history', '--include-ignored', '--json', '--out', '--prefix', '--readme',
  '--repo', '--root', '--ruleset', '--since', '--skip-empty', '--top-level-must-be-empty', '--until', '--weights',
  '--write', '--write-only',
];

const HELP = `audit-sluice v${VERSION} — ${CLI_ENTRIES[CLI_AUDIT].intro}

快速开始（第一次用——不用查源码）:
  audit-sluice audit .                  ① 审计当前仓库（默认只看本次改动）
  audit-sluice audit . --full            ② 全量审计（评分 + 问题明细）
  audit-sluice ruleset                   ③ 规则包是否能编译（改规则后先跑它）
  audit-sluice help                      全部命令与参数

其它 CLI（本入口不含，敲错会给出替代命令）:
  git-sluice    提交/推送/克隆/账号/仓库扫描: scan commit clone remote-create rename set-visibility identity-rewrite account-check cred-env gen-ssh-key git api repos index npm-publish unpublish
  tool-sluice   工具链: module-splitter yaml-template readme-template self-check

用法（每行写的参数就是该命令真实接受的写法，照抄即可）:
  audit-sluice version              查看版本
  audit-sluice audit <root> [--full] [--ruleset <目录>] [--weights <JSON>] [--include-ignored] [--history [--since <提交>] [--until <提交>] [--out <目录>]] [--json]
                                   审计目录（默认 diff 范围；--full=全量；--ruleset=自定规则目录；--weights=权重覆盖 JSON；
                                   --include-ignored=连 .gitignore 忽略的文件也扫描；--history=历史提交审计——逐提交快照全量审计并落盘报告，
                                   --since/--until 起始~结束提交（皆缺省=全部历史、含两端），--out 报告保存目录（缺省=git 根 audit-history/））
  audit-sluice ruleset [槽位...]    编译规则包并输出统计（默认全部槽位）
  audit-sluice file-io [路径] [--write-only]
                                   文件读写调用扫描（同步 I/O 在异步路径会阻塞；写/删/改名涉及数据安全）；--write-only=只看写操作。
                                   按类型/操作/风险分组的明细走 code_audit 工具的 io_scan 结果
  audit-sluice link-check <路径>    检查 md/文本中的链接有效性（只 warning，flaky 域名打折）
  audit-sluice scope-check [文件...] [--files <文件,文件>] [--repo <目录>] [--prefix <前缀>] [--allowlist <名,名>] [--top-level-must-be-empty] [--json]
                                   拼接产物作用域撞名（多段 JS 拼进同一作用域）：同一函数帧内重名会让后者静默顶掉前者，运行期毫无线索；
                                   判定按真实作用域帧（两个不同函数里的同名局部变量不算撞名）；顶层声明与命名前缀按被查项目自己的 package.json（dshScopeCheck）判定，
                                   没声明就只查同帧重名（不拿本项目的命名前缀去要求别人）；不给文件时取该项目 dshScopeCheck.files
  audit-sluice functions <analyze|apply> [目录] [--skip-empty] [--json]
                                   函数索引与函数文档：analyze 生成 functions-index.json（含签名/注释槽位）；
                                   apply 读 JSON（人工补 comment 后）生成 docs/函数 下的 md（文件删除归档 _archived，注释不丢）
  audit-sluice tree-doc <sync|gen|check|apply> [--root <目录>] [--readme <路径>] [--write]
                                   README 目录结构维护：sync 索引同步（新增自动加键/删除自动删键）；gen 生成树；
                                   check 检查漂移；apply 覆盖 README/FILE-TREE 标记块（封装 scripts/doc-tree.mjs）
  audit-sluice help                 显示本帮助
`;

/** 子命令：ruleset — 编译规则包输出统计（依赖本文件顶部的 compilers 副作用 import）。 */
export function cmdRuleset(slots = []) {
  const order = slots.length ? slots : null; // null=动态发现全部槽位
  const { ok, merged, errors, files, order: effective } = loadRuleFiles(order);
  const ctx = { errors: [] };
  const compiled = compileAllRules(merged.rules, ctx);
  if (!ok || ctx.errors.length) {
    console.error('规则编译失败:');
    for (const failure of [...errors, ...ctx.errors]) console.error('  ✗ ' + failure);
    process.exitCode = 1;
    return;
  }
  console.log(`规则包编译 OK（${effective.join('+')}）`);
  console.log(`  文件: ${files.length} 个槽位, 规则条目 ${merged.rules.length}, 编译成功 ${compiled.length}`);
  const byKind = {};
  for (const rule of compiled) {
    const kind = rule.kind || rule.type || 'other';
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  for (const [kind, count] of Object.entries(byKind)) console.log(`  ${kind}: ${count}`);
}

/** 命令表（本侧独有的 COMMANDS；注册表驱动的 file-io / link-check / scope-check 由 shared 分发）。 */
export const COMMANDS = new Map([
  ['ruleset', (rest) => cmdRuleset(rest)],
  // audit 不走注册表——CLI 独立审计需完整 findings（不依赖宿主 API）；工具 code_audit 输出 API 指引
  ['audit', parseVia((flags, positional) => cmdAudit(positional[0] || '.', flags))],
  ['functions', parseVia((flags, positional) => cmdFunctions(positional[0] || '', positional[1] || '', flags))],
  ['tree-doc', parseVia((flags, positional) => cmdTreeDoc(positional[0] || '', flags))],
  // 兼容：scan 属于 git 侧（注册表 git_scan）；此处保留导出给老代码直调，不注册进命令表
]);

/**
 * 入口 main。
 * @param {string[]} argv
 * @returns {Promise<number|undefined>}
 */
export async function main(argv = process.argv.slice(2)) {
  return await runCli({
    cliName: CLI_AUDIT,
    argv,
    commands: COMMANDS,
    helpText: HELP,
    getConfig: cliPluginConfig,
  });
}

runAsEntry(import.meta.url, main);

// 兼容导出（审计侧实现的老引用路径）
export { cmdAudit, cmdScan, cmdLinkCheck, cmdFileIo, cmdTreeDoc, cmdFunctions };
export { pluginEqualAuditOpts, pluginEqualWeights, cliPluginConfig, parseArgv, printToolResult };

/** 子命令：version（三入口同一实现，只有名字不同）。 */
export function cmdVersion() {
  console.log(`audit-sluice v${VERSION} — dsh-git-push（统一函数入口架构）`);
}
