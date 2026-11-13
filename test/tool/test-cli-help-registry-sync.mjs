/**
 * CLI 参数 ↔ 插件参数 对齐门禁（三入口口径）。
 *
 * 为什么需要（2026-10-13 实测事故）：`cli.mjs` 的 HELP 把 `commit` 写成
 *   `git-sluice commit <仓库> -m "msg"`，而该命令实际走**注册表**
 *   （lib/app/command-registry.js 的 git_commit_push）解析参数，注册表解析器只认 `--` 前缀 ⇒
 *   单横线 `-m` 落进位置参数槽被拒（"多余的位置参数：-m"）⇒ 用户按 HELP 抄命令必然失败。
 *
 * 拆分后的口径（2026-11-13）：命令分散到三个入口，所以「哪个 CLI 该有哪些注册表命令」由
 *   lib/cli/shared.mjs 的 CLI_ENTRIES 决定——不再靠「cli.mjs 源码里出现过这个命令名」这种猜测
 *   （旧实现正是靠猜，导致 15 个注册表命令里只有 1 个真被检查到）。
 *
 * 检查项（每条都可能让用户照抄失败，所以都必须机器可判）：
 *   ① 每个注册表命令必须在其所属入口的 HELP 里有用法行
 *   ② 用法行里出现的每个 `--flag` 必须真的是该命令的注册表参数（kebab 形式）——
 *      这是「HELP 写了但解析器不认」的直接检测（旧版只能发现方向相反的错）
 *   ③ 用法行不得出现单横线短选项（注册表解析器只认 `--`）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_REGISTRY } from '../../lib/app/command-registry.js';
import { commandOwner, parseEntrySourceMeta, readEntrySource } from '../../lib/cli/shared.mjs';

const ENTRY_FILES = { 'git-sluice': 'cli.mjs', 'audit-sluice': 'cli-audit.mjs', 'tool-sluice': 'cli-tool.mjs' };

/** camelCase → kebab-case（注册表字段名 → CLI 选项名）。 */
const kebab = (name) => String(name).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * 取 HELP 中某子命令的全部出现块（含紧跟的缩进续行）。
 * 注意必须收**所有**块：HELP 里同一命令可能先在「快速开始」出现一次、再在「用法」出现一次，
 *   只取第一处会漏掉真正的参数说明（旧实现就踩了这个：快速开始那行只有 --message，
 *   于是 `--no-push` 这类写错的 flag 永远查不到）。
 */
function usageLines(helpText, cliName, command) {
  const lines = String(helpText).split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!new RegExp(`${cliName} ${command}\\b`).test(lines[index])) continue;
    const block = [lines[index]];
    for (let next = index + 1; next < lines.length && /^\s{10,}\S/.test(lines[next]); next += 1) block.push(lines[next]);
    blocks.push(block.join('\n'));
  }
  return blocks.join('\n');
}

/** 该入口的 HELP 文本（源码里的那一段）。 */
function helpOf(cliName) {
  const { help } = parseEntrySourceMeta(readEntrySource(ENTRY_FILES[cliName]));
  assert.ok(help, `${ENTRY_FILES[cliName]} 未找到 HELP 常量`);
  return help;
}

test('CLI↔插件对齐：每个注册表命令都有用法行（在其所属入口的 HELP 里）', () => {
  const missing = [];
  for (const tool of TOOL_REGISTRY) {
    if (!tool.cli) continue;
    const owner = commandOwner(tool.cli);
    assert.ok(owner, `注册表命令 ${tool.cli} 没有 CLI 归属（切割线漏登记）`);
    const text = usageLines(helpOf(owner), owner, tool.cli);
    if (!text) missing.push(`${tool.cli}（属 ${owner}，该入口 HELP 未列出）`);
  }
  assert.deepEqual(missing, [], `以下注册表命令在所属入口 HELP 里没有用法行：\n${missing.join('\n')}`);
});

test('CLI↔插件对齐：用法行里写出的每个 --flag 都必须是该命令真实接受的参数', () => {
  const problems = [];
  for (const tool of TOOL_REGISTRY) {
    if (!tool.cli) continue;
    const owner = commandOwner(tool.cli);
    const text = usageLines(helpOf(owner), owner, tool.cli);
    if (!text) continue; // 上一条测试已覆盖「缺用法行」
    const accepted = new Set((tool.params || []).map((param) => `--${kebab(param.flag)}`));
    // 布尔参数额外接受否定形式 `--no-<参数>`（CLI 层会在进解析器前翻译成 false，见 shared.normalizeRegistryArgv）
    const negations = new Set((tool.params || [])
      .filter((param) => param.type === 'boolean')
      .map((param) => `--no-${kebab(param.flag)}`));
    for (const flag of new Set(text.match(/--[a-z0-9-]+/g) || [])) {
      if (!accepted.has(flag) && !negations.has(flag)) {
        problems.push(`${owner} ${tool.cli}：HELP 写了 ${flag}，但注册表参数里没有它（照抄必然报「未知参数」）`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('CLI↔插件对齐：用法行不得出现单横线短选项（注册表解析器只认 --）', () => {
  const bad = [];
  for (const tool of TOOL_REGISTRY) {
    if (!tool.cli) continue;
    const owner = commandOwner(tool.cli);
    // 只看用法行本身（描述续行是散文，"替代 add -A" 这类内容不是选项，查它会误报）
    const usageOnly = usageLines(helpOf(owner), owner, tool.cli)
      .split('\n').filter((line) => line.trim().startsWith(owner)).join('\n');
    for (const match of usageOnly.match(/(?:^|[\s[(|])(-[A-Za-z])\b/g) || []) bad.push(`${owner} ${tool.cli}：${match.trim()}`);
  }
  assert.deepEqual(bad, [], `HELP 出现注册表解析器不认的单横线短选项：${bad.join('、')}`);
});
