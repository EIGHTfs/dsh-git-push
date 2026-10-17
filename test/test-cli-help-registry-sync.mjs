/**
 * CLI 参数 ↔ 插件参数 对齐门禁。
 *
 * 为什么需要（2026-10-13 实测事故）：
 *   `cli.mjs` 的 HELP 把 `commit` 写成 `git-sluice commit <仓库> -m "msg"`，
 *   而该命令实际走**注册表**（lib/app/command-registry.js 的 git_commit_push）解析参数，
 *   注册表解析器只认 `--` 前缀（`if (tok.startsWith('--'))`），单横线 `-m` 会落进位置参数槽
 *   并被拒（"多余的位置参数：-m"）⇒ 用户按 HELP 抄命令必然失败。
 *
 * 为什么既有测试没抓到：
 *   · helpSync（lib/self/index.js:187）只从 HELP 提取 `--[\w-]+` ⇒ 单横线短选项天然隐形；
 *     且它的比对源是 KNOWN_FLAGS（parseArgv 的 flag 表），**不是注册表 params**。
 *   · test-command-registry.mjs 只测注册表解析器本身，不看 HELP 文本。
 *   ⇒ 本文件补上这条契约：**注册表命令的 HELP 用法行 = 该命令的 params（--kebab 形式）**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_REGISTRY } from '../lib/app/command-registry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliText = readFileSync(join(ROOT, 'cli.mjs'), 'utf8');
const HELP = (cliText.match(/const HELP = `([\s\S]*?)`;/) || [])[1] || '';

/** camelCase → kebab-case（注册表字段名 → CLI 选项名）。 */
const kebab = (s) => String(s).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** 取 HELP 中某子命令的用法行（含紧跟的缩进续行）。 */
function usageLines(cmd) {
  const lines = HELP.split('\n');
  const out = [];
  let hit = false;
  for (const l of lines) {
    if (new RegExp(`git-sluice ${cmd}\\b`).test(l)) { hit = true; out.push(l); continue; }
    if (hit && /^\s{10,}\S/.test(l)) { out.push(l); continue; }
    if (hit) break;
  }
  return out.join('\n');
}

/**
 * cli.mjs 里以**引号短名**出现过的命令名 = CLI 真正分发的子命令；
 * 未出现的（如 api 这类仅 DSH 工具条目）没有 shell 用法行 ⇒ 不参与 HELP 对齐检查。
 * 判据数据驱动（读 cli.mjs 的引号 token），不手工登记例外，避免例外表腐烂。
 */
const DISPATCHED = new Set([...cliText.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((m) => m[1]));

test('CLI↔插件对齐：每个注册表命令的 HELP 用法行必须列出其全部参数（--kebab 形式）', () => {
  const missing = [];
  for (const t of TOOL_REGISTRY) {
    if (!t.cli || !DISPATCHED.has(t.cli)) continue;
    const text = usageLines(t.cli);
    assert.ok(text, `HELP 未列出命令 ${t.cli}`);
    for (const p of t.params || []) {
      if (p.positional !== undefined) continue; // 位置参数不写成选项
      const flag = `--${kebab(p.flag)}`;
      if (!text.includes(flag)) missing.push(`${t.cli}：缺 ${flag}（插件参数 ${p.flag}）`);
    }
  }
  assert.deepEqual(missing, [], `HELP 用法行与插件参数不一致：\n${missing.join('\n')}`);
});

test('CLI↔插件对齐：注册表命令的用法行不得出现单横线短选项（注册表解析器只认 --）', () => {
  const bad = [];
  for (const t of TOOL_REGISTRY) {
    if (!t.cli) continue;
    const text = usageLines(t.cli);
    for (const m of text.match(/(?:^|[\s[(|])(-[A-Za-z])\b/g) || []) bad.push(`${t.cli}：${m.trim()}`);
  }
  assert.deepEqual(bad, [], `HELP 出现注册表解析器不认的单横线短选项：${bad.join('、')}`);
});
