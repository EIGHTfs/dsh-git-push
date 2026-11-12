#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * dsh-git-push 独立 CLI · **工具链侧**（bin: tool-sluice）
 * 不依赖 DSH 运行时，可独立运行。
 *
 * 本侧只有「对项目自身/脚手架」的命令：拆分、模板、自检。它与 git 侧、审计侧都无关，
 *   单独成入口的理由是：这些命令需要读源码/跑 python/写文档，是维护者工具，
 *   不该混进用户日常用的 git/审计 CLI（误敲概率与权限担心都更低）。
 *
 * ⚠️ self-check 会读另两个入口的**源码文本**核对 HELP↔KNOWN_FLAGS，
 *   所以本入口必须能定位到 cli.mjs / cli-audit.mjs（同目录，随包发布）。
 *
 * 本文件只保留：命令表 + HELP 文本 + 薄壳。解析/打印/分发/跨侧提示都在 lib/cli/shared.mjs。
 */
import { VERSION } from './lib/self/index.js';

import {
  cmdModuleSplitter,
} from './lib/cli/commands-doc.mjs';
import { cmdReadmeTemplate, cmdSelfCheck, cmdYamlTemplate } from './lib/cli/commands-tool.mjs';
import { CLI_TOOL, CLI_ENTRIES, cliPluginConfig, runAsEntry, runCli } from './lib/cli/shared.mjs';

export const CLI_NAME = CLI_TOOL;

/** parseArgv 认识的选项白名单（本侧 HELP 写着的那批；self-check 机器比对本表与 HELP 文本）。
 * 注：module-splitter 走注册表参数校验（lib/app/command-registry.js 的 params），本表只覆盖
 *   非注册表命令用到的 flag。 */
export const KNOWN_FLAGS = [
  '--dry-run', '--file', '--plan',
];

const HELP = `tool-sluice v${VERSION} — ${CLI_ENTRIES[CLI_TOOL].intro}

快速开始（第一次用——不用查源码）:
  tool-sluice self-check                     ① 自检：版本一致性 + 三入口 HELP↔参数表比对
  tool-sluice module-splitter analyze --file <文件>   ② 巨型单文件先出块/依赖图
  tool-sluice yaml-template                  ③ 打印规则 yml 模板
  tool-sluice help                           全部命令与参数

其它 CLI（本入口不含，敲错会给出替代命令）:
  git-sluice    提交/推送/克隆/账号/仓库扫描: scan commit clone remote-create rename set-visibility identity-rewrite account-check cred-env gen-ssh-key git api repos index npm-publish unpublish
  audit-sluice  审计/规则/静态检查: audit ruleset file-io link-check scope-check functions tree-doc

用法（每行写的参数就是该命令真实接受的写法，照抄即可）:
  tool-sluice version              查看版本
  tool-sluice module-splitter <analyze|split|verify> [--file <文件>] [--plan <plan.json>] [--dry-run]
                                   巨型单文件按顶层块拆分（零依赖 python3 实现；analyze 先出块/依赖图 →
                                   写 plan.json → split 切分 → verify 校验导出面；--dry-run=split 只预演）
  tool-sluice yaml-template        输出规则 yml 模板（含 kind + dimensions 示范）
  tool-sluice readme-template      输出 README 模板（含 name/version 占位符）
  tool-sluice self-check           版本一致性 + 三个入口的 HELP↔参数表机器比对 + 命令覆盖自检
  tool-sluice help                 显示本帮助
`;

/** 命令表（注册表驱动的 module-splitter 由 shared 分发；这里只登记非注册表命令）。 */
export const COMMANDS = new Map([
  ['yaml-template', () => cmdYamlTemplate()],
  ['readme-template', () => cmdReadmeTemplate()],
  ['self-check', () => cmdSelfCheck()],
]);

/**
 * 入口 main。
 * @param {string[]} argv
 * @returns {Promise<number|undefined>}
 */
export async function main(argv = process.argv.slice(2)) {
  return await runCli({
    cliName: CLI_TOOL,
    argv,
    commands: COMMANDS,
    helpText: HELP,
    getConfig: cliPluginConfig,
  });
}

runAsEntry(import.meta.url, main);

// 兼容导出
export { cmdModuleSplitter, cmdYamlTemplate, cmdReadmeTemplate, cmdSelfCheck };

/** 子命令：version（三入口同一实现，只有名字不同）。 */
export function cmdVersion() {
  console.log(`tool-sluice v${VERSION} — dsh-git-push（统一函数入口架构）`);
}
