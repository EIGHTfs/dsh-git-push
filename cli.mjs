#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * dsh-git-push 独立 CLI · **git 侧**（bin: git-sluice）
 * 不依赖 DSH 运行时，可独立运行。命名/参数与 lib 函数完全一致（外部 API 与函数名一致）。
 *
 * 三个入口的分工（切割线单处定义在 lib/cli/shared.mjs 的 CLI_ENTRIES）：
 *   git-sluice    提交/推送/克隆/账号/仓库扫描/发布（本文件）
 *   audit-sluice  审计/规则/评分/静态检查（cli-audit.mjs）
 *   tool-sluice   拆分/模板/自检（cli-tool.mjs）
 * 跨侧命令**明确报错并给出可照抄的替代命令**，不静默转发——静默转发会让「三个 CLI」名不副实。
 *
 * 本文件只保留：命令表 + HELP 文本 + 薄壳。解析/打印/分发/跨侧提示都在 lib/cli/shared.mjs。
 */
import { VERSION } from './lib/self/index.js';
import { runWrappedGit } from './lib/git/wrapped-git.js';

// 具名 import 而非 `export ... from`：COMMANDS 表直接引用 cmdXxx 变量名，
//   re-export 不建立本模块作用域绑定，会 ReferenceError。
import {
  cmdAccountCheck, cmdCredEnv, cmdRemoteCreate, cmdSetVisibility, cmdGenSshKey,
} from './lib/cli/commands-account.mjs';
import { cmdRepos, cmdIndex, cmdCommit, cmdClone } from './lib/cli/commands-vcs.mjs';
import {
  CLI_GIT, CLI_ENTRIES, cliPluginConfig, parseArgv, parseVia, printToolResult, runAsEntry, runCli,
} from './lib/cli/shared.mjs';

export const CLI_NAME = CLI_GIT;

/** parseArgv 认识的选项白名单（本侧 HELP 写着的那批；self-check 机器比对本表与 HELP 文本）。
 * 注：-m 是单横线别名（helpSync 只比对 -- 双横线），不列入本表。
 * 注：**注册表驱动**命令（scan/commit/clone/npm-publish…）的参数由 lib/app/command-registry.js
 *   的 params 校验，与本表无关；但本侧 HELP 里写了的 flag 都必须在本表出现，
 *   否则 self-check 会报「HELP 写了但 parseArgv 不认」。 */
export const KNOWN_FLAGS = [
  '--audit', '--audit-exempt-paths', '--audit-exempt-reason', '--body', '--branch', '--ci-timeout-sec',
  '--confirm', '--depth', '--dest', '--dry-run', '--extra-emails', '--extra-repos-file', '--force', '--history',
  '--history-depth', '--ignore-patterns', '--json', '--local-preview', '--max', '--message', '--message-items',
  '--method', '--no-dry-run', '--no-push', '--offline', '--otp', '--owner', '--paths', '--push',
  '--push-confirmed', '--push-initial', '--query', '--remote', '--requirements-confirmed', '--root',
  '--skip-smoke', '--ssh-pub', '--tag', '--token', '--update-remotes', '--visibility', '--wait-ci',
  '--wait-visible', '--whole-package', '--write',
];

const HELP = `git-sluice v${VERSION} — ${CLI_ENTRIES[CLI_GIT].intro}

快速开始（第一次用——不用查源码）:
  git-sluice account-check            ① 先校验 GitHub 凭据（token/SSH 是否可用）
  git-sluice scan <目录>              ② 看有哪些 git 仓库（分支/未提交/未推送）
  git-sluice commit <仓库> --message "msg"   ③ 提交推送（自动过审计门禁）
  git-sluice help                     全部命令与参数

其它 CLI（本入口不含，敲错会给出替代命令）:
  audit-sluice  审计/规则/静态检查: audit ruleset file-io link-check scope-check functions tree-doc
  tool-sluice   工具链: module-splitter yaml-template readme-template self-check

用法（每行写的参数就是该命令真实接受的写法，照抄即可）:
  git-sluice version              查看版本
  git-sluice scan <root> [--paths <路径,路径>] [--extra-repos-file <文件>]
                                   扫描本地 git 仓库（分支/remote/未提交/未推送；尊重 .gitignore：被忽略目录整棵跳过）
  git-sluice repos <root> [--depth N] [--max N] [--json]
                                   同上，可读文本通道（scan 是它的注册表通道，输出更精简）
  git-sluice index <root> [--owner <账号>] [--depth N] [--max N] [--offline] [--json]
                                   重建仓库索引 dsh-repo-index.json（--offline=纯离线不查 GitHub API）
  git-sluice commit <repo> --message <msg> [--push|--no-push] [--audit] [--dry-run] [--force] [--ignore-patterns <模式>] [--requirements-confirmed] [--push-confirmed] [--paths <路径1,路径2>] [--message-items <JSON>] [--audit-exempt-paths <文件,...>] [--audit-exempt-reason <理由>] [--remote <名>] [--wait-ci] [--ci-timeout-sec N]
                                   审计门禁 → 提交（默认只 commit 不 push；--push 推远端；--force 强推覆盖远端历史；
                                   --requirements-confirmed 显式核对开发者要求；--push-confirmed 显式放行推送门禁；
                                   --paths 精确 add 指定文件替代 add -A；--audit-exempt-paths 本次提交按文件临时豁免审计）
  git-sluice clone <owner/repo> [dest] [--dest <目录>] [--branch <名>] [--history] [--history-depth N]
                                   从 GitHub 克隆仓库（Git Data API 通道，不直连 github.com；--history=重建真实提交历史）
  git-sluice clone-preview <owner/repo> [--branch <名>]
                                   clone 预演：只报告将拉取什么，不落盘
  git-sluice remote-create <repo> [--visibility public|private] [--push-initial] [--dry-run]
                                   按项目文件夹在 GitHub 建远端仓库（已存在则复用），并指向 origin；--push-initial=建完首次推送
  git-sluice rename <repo> <新名> [--dry-run] [--update-remotes]
                                   给 GitHub 远程仓库改名（--dry-run 只报告；--update-remotes 同步本地 remote）
  git-sluice set-visibility <repo> --visibility public|private
                                   切换仓库公开/私有（改成公开有敏感信息暴露风险）
  git-sluice identity-rewrite [仓库路径...] [--root <目录>] [--dry-run] [--write] [--push] [--extra-emails <邮箱...>] [--json]
                                   提交身份历史改写：把非规范身份（工具/AI 产生的 agent@dsh.local 等）统一成登录账号规范身份；
                                   默认 dry-run 只报告，--write 才改（先建备份引用，自检通过才改写），--push 再 force-with-lease 强推
  git-sluice account-check [--token <t>] [--ssh-pub <公钥整行>]
                                   校验 GitHub 账号与凭据（token 在线校验 + SSH 公钥指纹）
  git-sluice cred-env
                                   输出插件保管凭据的环境变量前缀（SSH: GIT_SSH_COMMAND 私钥路径 / HTTPS: GIT_ASKPASS 脚本）——AI 执行任意外部 git 命令时粘贴使用，全程无 token/私钥明文
  git-sluice gen-ssh-key <x@y.z> [--force]
                                   生成 SSH 密钥对（公钥回传，私钥不出本机；--force=先备份再覆盖）
  git-sluice git <git 参数...>  浅包装 git：参数与 git 完全一致，凭据自动注入（SSH 私钥 / config.json token），无需传 token/私钥参数
                                   例：git-sluice git pull | git clone owner/repo | git fetch origin（stdio 直连，退出码透传）
  git-sluice api <接口名> [--method GET|POST] [--query <JSON>] [--body <JSON>]
                                   直接调用本插件 HTTP API（与浏览器同源实现）；不带接口名则列出全部可用接口
  git-sluice npm-publish [目录] [--dry-run|--no-dry-run] [--tag <tag>] [--otp <码>] [--confirm] [--json] [--wait-visible] [--skip-smoke] [--local-preview]
                                   npm 发包（注册为后台 job）：默认 dry-run，只体检 + npm publish --dry-run（不写 registry）；
                                   真发必须同时给 --no-dry-run 与 --confirm（不可撤销）
  git-sluice unpublish <包名> [版本] [--whole-package] [--dry-run] [--confirm]
                                   从 npm registry 撤包（不可逆）：默认 dry-run 只预检，真撤需关掉 --dry-run 并给 --confirm
  git-sluice help                 显示本帮助
`;

/** 命令表（本侧独有的 COMMANDS；注册表驱动的命令由 shared 的 resolveDispatch 处理）。
 * 注：`git` 不用登记——注册表（git_sluice）已覆盖它，旧 cli.mjs 里那条 COMMANDS['git'] 是死代码。 */
export const COMMANDS = new Map([
  ['repos', parseVia((flags, positional) => cmdRepos(positional[0] || '.', flags))],
  ['index', parseVia((flags, positional) => cmdIndex(positional[0] || '.', flags))],
  // `git` 必须走这里而不是注册表：注册表只认声明过的参数，会把 git 自己的 flag
  //   （如 `log --oneline`）当「未知参数」拒掉，与「参数与 git 完全一致」的承诺相反。
  ['git', (rest) => cmdGit(rest)],
]);

/** 子命令：git —— 浅包装 git（参数原样透传，凭据自动注入）。
 *  无参数时只让 git 打印自己的用法并返回 0（`git` 裸跑本身 exit 1，但「看用法」不是错误场景）。 */
export async function cmdGit(rest = []) {
  const wrapped = await runWrappedGit(rest);
  if (Array.isArray(rest) && rest.length === 0) return 0;
  if (wrapped && wrapped.ok) return 0;
  process.exitCode = typeof wrapped?.status === 'number' ? wrapped.status : 1;
  return process.exitCode;
}

/** 未知命令的 git 透传（`git-sluice status` = `git status`；git-sluice 是 git 的超集）。 */
async function passthroughGit(argv) {
  return await runWrappedGit(argv);
}

/**
 * 入口 main。
 * @param {string[]} argv
 * @returns {Promise<number|undefined>} 退出码
 */
export async function main(argv = process.argv.slice(2)) {
  return await runCli({
    cliName: CLI_GIT,
    argv,
    commands: COMMANDS,
    helpText: HELP,
    passthroughGit,
    getConfig: cliPluginConfig,
  });
}

runAsEntry(import.meta.url, main);

// 兼容导出（外部/测试按老路径 import 这些名字；实现已按域迁到 lib/cli/commands-*.mjs）
export { parseArgv, printToolResult, cliPluginConfig };
export {
  cmdAccountCheck, cmdCredEnv, cmdRemoteCreate, cmdSetVisibility, cmdGenSshKey,
  cmdRepos, cmdIndex, cmdCommit, cmdClone,
};
/** 子命令：version（三入口同一实现，只有名字不同）。 */
export function cmdVersion() {
  console.log(`git-sluice v${VERSION} — dsh-git-push（统一函数入口架构）`);
}
