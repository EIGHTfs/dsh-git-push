// CLI 工具链域命令实现（tool-sluice 独占）
//
// 为什么单独成文件：这三个命令是「对项目自身/脚手架的检查与模板输出」，与 git 操作、
//   审计执行都无关；放在入口文件里会让 tool-sluice 的入口从薄壳变成半个实现。
//
// self-check 的职责（拆分后比原来更重要）：三个入口各有一份 HELP + KNOWN_FLAGS，
//   任何一份写歪都会让用户按 HELP 抄命令失败。它逐个入口比对「HELP 里写的 flag」与
//   「该入口 parseArgv 认的 flag」，并核对每个入口的 HELP 是否列出自己全部命令。

import { VERSION, helpSync, readmeTemplate, yamlTemplate } from '../self/index.js';
import { readFileSync } from 'node:fs';

import { CLI_ENTRIES, allCommands, parseEntrySourceMeta, readEntrySource } from './shared.mjs';

/** 入口文件清单（bin → 源文件）。自检逐个核对。 */
export const ENTRY_FILES = [
  { cliName: 'git-sluice', file: 'cli.mjs' },
  { cliName: 'audit-sluice', file: 'cli-audit.mjs' },
  { cliName: 'tool-sluice', file: 'cli-tool.mjs' },
];

/** 读 package.json（失败返回 null）。 */
export function readPkgJson() {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  } catch { return null; }
}

/** 子命令：yaml-template — 输出规则 yml 模板。 */
export function cmdYamlTemplate() {
  console.log(yamlTemplate());
}

/** 子命令：readme-template — 输出 README 模板。 */
export function cmdReadmeTemplate() {
  console.log(readmeTemplate().template);
}

/**
 * 逐个入口核对「HELP ↔ parseArgv」与「HELP 是否列出本侧全部命令」。
 * @returns {{failures: string[], lines: string[]}}
 */
export function checkEntries() {
  const failures = [];
  const lines = [];
  for (const { cliName, file } of ENTRY_FILES) {
    let meta;
    try {
      meta = parseEntrySourceMeta(readEntrySource(file));
    } catch (e) {
      failures.push(`${file}: 读取失败（${e.message}）`);
      continue;
    }
    if (!meta.help) { failures.push(`${file}: 未找到 HELP 常量`); continue; }
    const sync = helpSync(meta.help, meta.flags);
    if (!sync.ok) {
      failures.push(`${file}: HELP 与 KNOWN_FLAGS 不一致`);
      for (const missingFlag of sync.missingInHelp) failures.push(`  ${file}: KNOWN_FLAGS 有但 HELP 没写 ${missingFlag}`);
      for (const extraFlag of sync.missingInParse) failures.push(`  ${file}: HELP 写了但 KNOWN_FLAGS 没有 ${extraFlag}`);
      continue;
    }
    // HELP 必须列出本侧每个命令的用法行（`<cli> <cmd>` 形式）；缺了说明「加了命令忘了文档」
    const missingCommands = (CLI_ENTRIES[cliName]?.commands || []).filter((cmd) => !meta.help.includes(`${cliName} ${cmd}`));
    if (missingCommands.length) {
      failures.push(`${file}: HELP 缺命令用法行 ${missingCommands.join(' ')}`);
    } else {
      lines.push(`  ✓ ${file}: HELP↔KNOWN_FLAGS 一致（${meta.flags.length} 个 flag）· 本侧 ${(CLI_ENTRIES[cliName]?.commands || []).length} 个命令都有用法行`);
    }
  }
  return { failures, lines };
}

/** 子命令：self-check — 版本一致性 + 三入口 HELP↔parseArgv 机器比对 + 命令覆盖。 */
export function cmdSelfCheck() {
  const failures = [];
  console.log('自身自检:');
  console.log(`  version: v${VERSION}`);
  const pkg = readPkgJson();
  if (pkg && pkg.version && pkg.version !== VERSION) {
    failures.push(`version: lib/self=${VERSION} vs package.json=${pkg.version}`);
    console.error(`  ✗ version: lib/self=${VERSION} vs package.json=${pkg.version}`);
  } else {
    console.log(`  ✓ version: lib/self = package.json = ${VERSION}`);
  }
  const { failures: entryFailures, lines } = checkEntries();
  for (const reportLine of lines) console.log(reportLine);
  // 一次性并入（不在循环里逐条 push：既少一层循环，也让「失败清单来自一处」更好读）
  failures.push(...entryFailures);
  for (const failure of entryFailures) console.error(`  ✗ ${failure}`);
  if (!entryFailures.length) console.log(`  ✓ 命令覆盖：三入口共 ${allCommands().length} 个命令都有用法行`);
  process.exitCode = failures.length > 0 ? 1 : 0;
  return failures.length > 0 ? 1 : 0;
}
