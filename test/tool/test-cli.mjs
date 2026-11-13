/**
 * test-cli.mjs —— 同族测试合并（test-cli-help-registry-sync.mjs · test-cli-split.mjs · test-command-registry.mjs · test-client.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（top-level test() 不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明（如两个文件都有 ROOT），
 *     不影响 test() 的注册时机与执行顺序；每个 test 名带 `[原文件名]` 前缀便于溯源。
 * 为什么不用 describe：它的回调是 async 函数作用域，会把顶层 await/const/exitCode 挪位（上轮实测 54 失败 / 少 17 条用例）。
 */
import { TOOL_REGISTRY, registryByName, registryByCli, parseRegistryArgs, buildToolsListText } from '../../lib/app/command-registry.js';
import { tokenize } from '../../lib/ast/tokenizer.js';
import { commandOwner, parseEntrySourceMeta, readEntrySource, CLI_AUDIT, CLI_ENTRIES, CLI_GIT, CLI_TOOL, allCommands, resolveDispatch } from '../../lib/cli/shared.mjs';
import { DEFAULT_CONFIG, SETTINGS_SCHEMA, defaultConfig, resolveConfig, createSettingsCard, collectExternalRefs, INLINE_CSS, clientModuleInfo } from '../../lib/client/index.js';
import { helpSync, VERSION } from '../../lib/self/index.js';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
// ── 原 test-cli-help-registry-sync.mjs（块级作用域：只为隔离同名声明，不改求值时机/顺序）──
{
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

  test('[cli-help-registry-sync] CLI↔插件对齐：每个注册表命令都有用法行（在其所属入口的 HELP 里）', () => {
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

  test('[cli-help-registry-sync] CLI↔插件对齐：用法行里写出的每个 --flag 都必须是该命令真实接受的参数', () => {
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

  test('[cli-help-registry-sync] CLI↔插件对齐：用法行不得出现单横线短选项（注册表解析器只认 --）', () => {
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
}

// ── 原 test-cli-split.mjs（块级作用域：只为隔离同名声明，不改求值时机/顺序）──
{
  /**
   * CLI 三入口拆分门禁（git-sluice / audit-sluice / tool-sluice）。
   *
   * 为什么需要（拆分的固有风险）：入口一分为三后，「命令只在一个 CLI 里可用」这件事
   *   没有任何编译器保证——命令表漏登记、跨侧判断写反、HELP 忘了写，全都表现为
   *   「用户敲进去得到一句莫名其妙的报错」，而源码里一切正常。更隐蔽的是**纯副作用 import**
   *   （文档漂移检查器接线、规则编译器注册）：漏搬不报错，只是某个功能静默失效
   *   （实测漏 host-doc-checks → 同一棵树上两类 finding 整类消失）。
   *
   * 覆盖面：
   *   ① 切割线完整性（并集=全部命令、无命令被两侧声明、注册表命令都有归属）
   *   ② 分发决策纯函数：28 命令 × 3 入口全覆盖（不执行命令 → 无网络/无副作用）
   *   ③ 跨侧提示文案可照抄（含目标 CLI 名 + 完整替代命令）
   *   ④ 每侧 HELP 与自己的命令集/参数表一致（不列别侧命令）
   *   ⑤ version 三入口一致
   *   ⑥ 副作用接线**行为级**证明：审计入口真的能报文档漂移、ruleset 真的编译出规则
   *   ⑦ 每个入口每个命令逐个真跑（用不存在的 flag 触发解析层，零副作用）
   */


  const execFileAsync = promisify(execFile);
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const ENTRY_FILES = { [CLI_GIT]: 'cli.mjs', [CLI_AUDIT]: 'cli-audit.mjs', [CLI_TOOL]: 'cli-tool.mjs' };
  const SIDES = Object.keys(CLI_ENTRIES);

  /** 跑一个入口（返回 {code, out}；不抛，便于断言）。 */
  async function runCliFile(cliName, argv, opts = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [join(ROOT, ENTRY_FILES[cliName]), ...argv], {
        encoding: 'utf8', timeout: 120000, cwd: opts.cwd || ROOT, maxBuffer: 16 * 1024 * 1024,
      });
      return { code: 0, out: `${stdout}${stderr}` };
    } catch (e) {
      return { code: typeof e.code === 'number' ? e.code : 1, out: `${e.stdout || ''}${e.stderr || ''}` };
    }
  }

  /** 分批并行跑（NAS 上串行 28 条 spawn 太慢，全并发又会互相抢 CPU）。 */
  async function runInWaves(tasks, waveSize = 4) {
    const results = [];
    for (let index = 0; index < tasks.length; index += waveSize) {
      results.push(...await Promise.all(tasks.slice(index, index + waveSize).map((task) => task())));
    }
    return results;
  }

  // ── ① 切割线完整性 ───────────────────────────────────────────────────
  test('[cli-split] 切割线：三侧命令并集 = 全部命令，且没有命令被两侧同时声明', () => {
    const commands = allCommands();
    const duplicated = commands.filter((cmd, index) => commands.indexOf(cmd) !== index);
    assert.deepEqual(duplicated, [], `同一命令被多个 CLI 声明：${duplicated.join(',')}`);
    assert.equal(new Set(commands).size, commands.length);
    assert.equal(commands.length, 28, `命令总数变了（现 ${commands.length}）：切割线需要同步更新 CLI_ENTRIES`);
    // 每个命令都能问到唯一归属
    for (const cmd of commands) assert.ok(commandOwner(cmd), `${cmd} 没有归属`);
    assert.equal(commandOwner('nope-cmd'), '', '未登记命令不应有归属');
  });

  test('[cli-split] 切割线：注册表驱动命令必须全部有 CLI 归属（漏登记 = 该命令无处可敲）', () => {
    const registryCliNames = TOOL_REGISTRY.filter((entry) => entry.cli).map((entry) => entry.cli);
    const unowned = registryCliNames.filter((name) => !commandOwner(name));
    assert.deepEqual(unowned, [], `注册表命令没有 CLI 归属：${unowned.join(',')}`);
  });

  test('[cli-split] 切割线：每侧 COMMANDS 表里的命令都必须在该侧切割线内（防「登记在 A、实现在 B」）', async () => {
    const problems = [];
    for (const side of SIDES) {
      const mod = await import(`../../${ENTRY_FILES[side]}`);
      for (const cmd of mod.COMMANDS.keys()) {
        if (!CLI_ENTRIES[side].commands.includes(cmd)) problems.push(`${cmd} 在 ${side} 的 COMMANDS 表里，但切割线归 ${commandOwner(cmd) || '（无）'}`);
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  // ── ② 分发决策（纯函数，28 命令 × 3 入口） ───────────────────────────
  test('[cli-split] 分发决策：每个命令只在本侧可执行，异侧一律走跨侧提示', async () => {
    const problems = [];
    for (const cmd of allCommands()) {
      const owner = commandOwner(cmd);
      for (const side of SIDES) {
        // COMMANDS 表用真实表，保证「命令存在但表里漏了」也能被这条抓出来
        const mod = await import(`../../${ENTRY_FILES[side]}`);
        const plan = resolveDispatch({ cliName: side, argv: [cmd], commands: mod.COMMANDS });
        if (side === owner) {
          if (plan.kind !== 'registry' && plan.kind !== 'command') problems.push(`${side} ${cmd} → ${plan.kind}（应可执行）`);
        } else if (plan.kind !== 'cross') {
          problems.push(`${side} ${cmd} → ${plan.kind}（应报跨侧，属 ${owner}）`);
        } else if (plan.targetCli !== owner) {
          problems.push(`${side} ${cmd} → 指到了 ${plan.targetCli}（应指 ${owner}）`);
        }
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  test('[cli-split] 分发决策：未知命令——git 侧透传给 git，另两侧报错并提示 git-sluice', () => {
    const gitPlan = resolveDispatch({ cliName: CLI_GIT, argv: ['status'] });
    assert.equal(gitPlan.kind, 'git-passthrough', 'git-sluice 未知命令 = git 透传（git-sluice 是 git 的超集）');
    for (const side of [CLI_AUDIT, CLI_TOOL]) {
      const plan = resolveDispatch({ cliName: side, argv: ['status'] });
      assert.equal(plan.kind, 'unknown', `${side} 不得把未知命令透传给 git`);
      assert.match(plan.error, /unknown|未知命令/);
      assert.match(plan.error, /git-sluice status/, '应提示 git 相关命令去 git-sluice');
    }
  });

  test('[cli-split] 分发决策：help / version 三入口都有', () => {
    for (const side of SIDES) {
      assert.equal(resolveDispatch({ cliName: side, argv: [] }).kind, 'help');
      assert.equal(resolveDispatch({ cliName: side, argv: ['help'] }).kind, 'help');
      assert.equal(resolveDispatch({ cliName: side, argv: ['--help'] }).kind, 'help');
      assert.equal(resolveDispatch({ cliName: side, argv: ['version'] }).kind, 'version');
    }
  });

  // ── ③ 跨侧提示文案（真跑一条，断言可照抄） ──────────────────────────
  test('[cli-split] 跨侧提示：在 git-sluice 敲 audit → 报出 audit-sluice 与完整替代命令', async () => {
    const run = await runCliFile(CLI_GIT, ['audit', '/tmp/demo', '--full']);
    assert.equal(run.code, 1, '跨侧命令必须返回非 0（脚本能判失败）');
    assert.match(run.out, /"audit" 属于 audit-sluice/);
    assert.match(run.out, /请改用：audit-sluice audit \/tmp\/demo --full/, '必须给出可直接照抄的完整命令');
  });

  test('[cli-split] 跨侧提示：反向也成立（audit-sluice 敲 commit、tool-sluice 敲 audit）', async () => {
    const auditSide = await runCliFile(CLI_AUDIT, ['commit', '/tmp/x', '--message', 'm']);
    assert.match(auditSide.out, /属于 git-sluice/);
    assert.match(auditSide.out, /请改用：git-sluice commit \/tmp\/x --message m/);
    const toolSide = await runCliFile(CLI_TOOL, ['audit', '.']);
    assert.match(toolSide.out, /属于 audit-sluice/);
    assert.match(toolSide.out, /请改用：audit-sluice audit \./);
  });

  test('[cli-split] 注册表参数否定形式：--no-<布尔参数> 必须真的生效（HELP 写了就得能用）', async () => {
    // 背景：注册表解析器只认 `--<参数>`（出现即 true），没有否定形式。而 HELP 里
    //   `[--push|--no-push]` 这类写法用户照抄必失败（实测 `commit --no-push` 曾报「未知参数」）。
    //   CLI 层在进解析器前把 `--no-x` 翻译成「置 false」，本条盯住这个翻译。
    const { normalizeRegistryArgv } = await import('../../lib/cli/shared.mjs');
    const params = [
      { flag: 'push', type: 'boolean' },
      { flag: 'noDryRun', type: 'boolean' },
      { flag: 'repo', type: 'string' },
    ];
    const negated = normalizeRegistryArgv(['/tmp/x', '--no-push', '--repo', '/tmp/y'], params);
    assert.deepEqual(negated.argv, ['/tmp/x', '--repo', '/tmp/y'], '--no-push 必须被摘掉（转成显式 false）');
    assert.deepEqual(negated.negated.map((param) => param.flag), ['push']);
    // 已声明的参数名本身以 no- 开头（npm-publish 的 --no-dry-run）→ 原样放行，不得二次翻译
    const declared = normalizeRegistryArgv(['--no-dry-run'], params);
    assert.deepEqual(declared.argv, ['--no-dry-run'], '--no-dry-run 是真实参数名，不能被当成否定形式');
    assert.deepEqual(declared.negated, []);

    // 端到端：真跑一次带 --no-push 的 commit（临时仓库，不推送）
    const dir = mkdtempSync(join(tmpdir(), 'dshgp-split-commit-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
      git('init', '-q'); git('config', 'user.email', 't@e.com'); git('config', 'user.name', 't');
      writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
      git('add', '-A'); git('commit', '-qm', 'init');
      writeFileSync(join(dir, 'b.js'), 'export const b = 2;\n');
      const run = await runCliFile(CLI_GIT, ['commit', dir, '--message', 'chore: split 冒烟', '--no-push', '--requirements-confirmed', '--dry-run'], { cwd: dir });
      assert.doesNotMatch(run.out, /未知参数 --no-push/, `--no-push 必须被接受：${run.out.slice(0, 200)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // ── ④ 每侧 HELP 与自己的命令集/参数表一致 ───────────────────────────
  test('[cli-split] HELP：每个入口都列出自己全部命令，且不把别侧命令写成本侧用法', () => {
    const problems = [];
    for (const side of SIDES) {
      const source = readEntrySource(ENTRY_FILES[side]);
      const { help, flags } = parseEntrySourceMeta(source);
      assert.ok(help, `${ENTRY_FILES[side]} 未找到 HELP 常量`);
      // 自己的命令必须有用法行
      for (const cmd of CLI_ENTRIES[side].commands) {
        if (!help.includes(`${side} ${cmd}`)) problems.push(`${side} HELP 缺用法行：${side} ${cmd}`);
      }
      // 别侧命令不得写成「本侧用法行」（`<本侧CLI> <别侧命令>`）
      for (const otherSide of SIDES.filter((name) => name !== side)) {
        for (const cmd of CLI_ENTRIES[otherSide].commands) {
          if (help.includes(`${side} ${cmd}`)) problems.push(`${side} HELP 把 ${otherSide} 的命令 ${cmd} 写成了本侧用法`);
        }
      }
      // HELP ↔ 参数表机器比对（沿用既有 cli-help-sync 口径）
      const sync = helpSync(help, flags);
      assert.deepEqual(sync.missingInHelp, [], `${side}: KNOWN_FLAGS 有但 HELP 没写 ${sync.missingInHelp.join(' ')}`);
      assert.deepEqual(sync.missingInParse, [], `${side}: HELP 写了但 KNOWN_FLAGS 没有 ${sync.missingInParse.join(' ')}`);
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  test('[cli-split] HELP：每个入口都提示另外两个 CLI（用户敲错时知道去哪找）', () => {
    for (const side of SIDES) {
      const { help } = parseEntrySourceMeta(readEntrySource(ENTRY_FILES[side]));
      for (const otherSide of SIDES.filter((name) => name !== side)) {
        assert.ok(help.includes(otherSide), `${side} HELP 未提到 ${otherSide}（用户不知道还有别的入口）`);
      }
    }
  });

  // ── ⑤ version 三入口一致 ────────────────────────────────────────────
  test('[cli-split] version：三个入口输出同一个版本号', async () => {
    const outputs = await Promise.all(SIDES.map((side) => runCliFile(side, ['version'])));
    for (let index = 0; index < SIDES.length; index += 1) {
      assert.equal(outputs[index].code, 0, `${SIDES[index]} version 应成功`);
      assert.match(outputs[index].out, new RegExp(`${SIDES[index]} v${VERSION}`), `${SIDES[index]} version 输出异常：${outputs[index].out}`);
    }
    const versions = outputs.map((item) => (item.out.match(/v\d+\.\d+\.\d+/) || [])[0]);
    assert.deepEqual([...new Set(versions)], [`v${VERSION}`], `三入口版本不一致：${versions.join(' / ')}`);
  });

  // ── ⑥ 副作用接线（行为级证明，不是看 import 有没有写） ──────────────
  test('[cli-split] 副作用接线①：审计入口真的会报文档漂移（漏搬 host-doc-checks 时这条会红）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dshgp-split-doc-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-fixture', version: '0.0.0' }));
      mkdirSync(join(dir, 'lib'), { recursive: true });
      writeFileSync(join(dir, 'lib', 'sample.js'), 'export function alpha() { return 1; }\n');
      mkdirSync(join(dir, 'docs'), { recursive: true });
      // 故意写一份与真实扫描不符的函数列表块 → 必须报 functions-doc-drift
      writeFileSync(join(dir, 'docs', 'FUNCTIONS.md'),
        '# 函数列表\n\n<!-- dshgp-functions:start -->\n### lib/sample.js（1 行 · 1 个函数）\n\n| 函数 | 行号 | 行数 |\n|---|---|---|\n| `已经删掉的函数` | 1-1 | 1 |\n<!-- dshgp-functions:end -->\n');
      const run = await runCliFile(CLI_AUDIT, ['audit', dir, '--full', '--json']);
      assert.ok(run.out.includes('{'), `审计应有 JSON 输出：${run.out.slice(0, 300)}`);
      const json = JSON.parse(run.out.slice(run.out.indexOf('{')));
      const driftRules = (json.findings || []).map((finding) => finding.rule).filter((rule) => /doc-drift/.test(rule || ''));
      assert.ok(driftRules.length > 0,
        `审计入口未报任何 *doc-drift（host-doc-checks 副作用 import 丢失？）实际规则：${[...new Set((json.findings || []).map((f) => f.rule))].slice(0, 8).join(',')}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('[cli-split] 副作用接线②：ruleset 真的编译出规则（漏搬 rule/compilers 会编译 0 条却报 OK）', async () => {
    const run = await runCliFile(CLI_AUDIT, ['ruleset']);
    assert.equal(run.code, 0, `ruleset 应成功：${run.out}`);
    const match = run.out.match(/编译成功 (\d+)/);
    assert.ok(match, `ruleset 输出缺少「编译成功 N」：${run.out.slice(0, 300)}`);
    assert.ok(Number(match[1]) > 50, `编译出的规则数异常少（${match[1]} 条）——compilers 副作用 import 可能丢失`);
  });

  // ── ⑦ 每个入口每个命令逐个真跑 ──────────────────────────────────────
  test('[cli-split] 逐命令真跑：28 个命令都能被所属入口接住（不落到跨侧提示）', async () => {
    // 用「不存在的 flag」触发各命令的解析层报错：零副作用（不进业务逻辑、不碰网络），
    //   但足以证明分发放行到了该命令自己的处理链。少数命令不吃 flag，单独用无害调用。
    const PROBE_FLAG = '--dshgp-probe-flag-xyz';
    const harmlessCall = {
      [`${CLI_GIT} git`]: ['--version'], // 浅包装 git 的透传：直接用 git 自己的 --version 证明到达（无副作用）
      [`${CLI_AUDIT} ruleset`]: [],
      [`${CLI_TOOL} yaml-template`]: [],
      [`${CLI_TOOL} readme-template`]: [],
      [`${CLI_TOOL} self-check`]: [],
    };
    const tasks = [];
    const labels = [];
    for (const side of SIDES) {
      for (const cmd of CLI_ENTRIES[side].commands) {
        const key = `${side} ${cmd}`;
        labels.push(key);
        const argv = harmlessCall[key] || [cmd, PROBE_FLAG];
        tasks.push(() => runCliFile(side, argv));
      }
    }
    const results = await runInWaves(tasks);
    const problems = [];
    results.forEach((result, index) => {
      const label = labels[index];
      const reachedCommand = /未知参数|规则包编译 OK|规则模板示范|dsh-git-push|自身自检|git version/.test(result.out);
      const wentCrossSide = /属于 (git|audit|tool)-sluice/.test(result.out);
      if (wentCrossSide) problems.push(`${label}: 落到了跨侧提示（应在本侧执行）`);
      else if (!reachedCommand) problems.push(`${label}: 未见命令级响应（exit=${result.code} 输出：${result.out.slice(0, 120)}）`);
    });
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  test('[cli-split] 参数错必须让调用方能判定失败（exit 非 0，不能静默成功）', async () => {
    // 2026-11-13 审阅发现：parseVia 只 console.error 不设退出码 ⇒ exit 0，
    //   门禁脚本会把 `audit --bogus` 当成「审计通过」。修后 exit 2。
    const { execFileSync } = await import('node:child_process');
    const run = (file, args) => {
      try {
        execFileSync(process.execPath, [join(ROOT, file), ...args], { encoding: 'utf8', stdio: 'pipe' });
        return 0;
      } catch (e) { return typeof e.status === 'number' ? e.status : -1; }
    };
    // parseVia 路径（audit 不走注册表）→ 必须 exit 2
    assert.equal(run('cli-audit.mjs', ['audit', '--bogus']), 2, 'audit-sluice 参数错应 exit 2');
    // 注册表路径 → 非 0 即可（当前实现是 1，不强制等于 2）
    assert.notEqual(run('cli.mjs', ['scan', '--bogus']), 0, 'git-sluice 参数错应非 0');
    // 正常命令不受影响
    assert.equal(run('cli-audit.mjs', ['ruleset']), 0, '正常命令仍应 exit 0');
    assert.equal(run('cli-tool.mjs', ['self-check']), 0, 'self-check 仍应 exit 0');
  });
}

// ── 原 test-command-registry.mjs（块级作用域：只为隔离同名声明，不改求值时机/顺序）──
{

  // ---------- 命令注册表（方案 B——元数据驱动免维护 CLI，2026-09-30） ----------


  // 说明：工具**公开面形状**（数量固定 / 命名 provider-safe / 必需清单 / 两面一致 /
  //   package.json 声明真实存在）集中在 test/test-tool-contract.mjs 断言；
  //   本文件只保留**行为类**断言（唯一性、查找函数、参数解析、清单文本）。
  test('[command-registry] registry：name/cli 唯一（形状断言见 test-tool-contract.mjs）', () => {
    const names = new Set(TOOL_REGISTRY.map((t) => t.name));
    assert.equal(names.size, TOOL_REGISTRY.length, 'name 唯一');
    const clis = TOOL_REGISTRY.filter((t) => t.cli).map((t) => t.cli);
    assert.equal(new Set(clis).size, clis.length, 'cli 唯一');
  });

  test('[command-registry] registry：registryByName / registryByCli 查找', () => {
    assert.equal(registryByName('code_audit').name, 'code_audit');
    // code_audit 无 cli（CLI audit 特例走 lib/cli——独立审计 findings，不依赖宿主 API）
    assert.equal(registryByName('code_audit').cli, undefined);
    assert.equal(registryByCli('audit'), undefined, 'audit 不生成 CLI 命令');
    assert.equal(registryByCli('scan').name, 'git_scan');
    assert.equal(registryByCli('commit').name, 'git_commit_push');
    assert.equal(registryByName('nonexistent'), undefined);
  });

  test('[command-registry] parseRegistryArgs：positional + --flag + boolean + default', () => {
    const audit = registryByName('code_audit');
    const r1 = parseRegistryArgs(['/repo/a', '--scope', 'diff'], audit.params);
    assert.equal(r1.error, undefined);
    assert.equal(r1.args.repo, '/repo/a');
    assert.equal(r1.args.scope, 'diff');
    const r2 = parseRegistryArgs(['/repo/a', '--json'], audit.params);
    assert.equal(r2.args.json, true);
    assert.equal(r2.args.scope, 'full', 'default 填充');
    const r3 = parseRegistryArgs(['--scope=diff', '/repo/b'], audit.params);
    assert.equal(r3.args.scope, 'diff');
    assert.equal(r3.args.repo, '/repo/b');
  });

  test('[command-registry] parseRegistryArgs：required / enum / 未知参数校验', () => {
    const audit = registryByName('code_audit');
    assert.match(parseRegistryArgs([], audit.params).error || '', /缺少必填参数 repo/);
    const bad = parseRegistryArgs(['/x', '--scope', 'weird'], audit.params);
    assert.match(bad.error || '', /scope 取值必须为 full\|diff/);
    const unknown = parseRegistryArgs(['/x', '--nope'], audit.params);
    assert.match(unknown.error || '', /未知参数 --nope/);
    const extra = parseRegistryArgs(['/x', 'y'], audit.params);
    assert.match(extra.error || '', /多余的位置参数/);
  });

  test('[command-registry] parseRegistryArgs：boolean --flag=false 支持', () => {
    const commit = registryByCli('commit');
    const r = parseRegistryArgs(['/r', '--message', 'm', '--push=false'], commit.params);
    assert.equal(r.error, undefined);
    assert.equal(r.args.push, false);
  });

  test('[command-registry] buildToolsListText：工具清单同源生成（含 name + 描述）', () => {
    const txt = buildToolsListText();
    assert.match(txt, /code_audit/, '含 code_audit');
    assert.match(txt, /审计仓库/, '含描述');
    assert.match(txt, /git_scan/, '含 git_scan');
  });
}

// ── 原 test-client.mjs（块级作用域：只为隔离同名声明，不改求值时机/顺序）──
{
  /**
   * 侧边栏测试（0.1.8）：手写 createElement 无 JSX、零外部资源、开关默认关、配置即时生效。
   */


  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const clientSrc = readFileSync(join(ROOT, 'lib/client/index.js'), 'utf8');

  /** 最小 mock react（记录 createElement 调用形状）。 */
  function mockReact() {
    const calls = [];
    return {
      calls,
      createElement(type, props, children) { calls.push({ type, props, children }); return { type, props: props || {}, children }; },
    };
  }

  // ---------- 浏览器入口 client.js 的标识符完整性 ----------
  // clone 按钮报「dshgp_CLONE_TIMEOUT_MS is not defined」——1.4.1 为 clone
  //   放宽超时改用该常量，却漏了定义。这类「用了没定义」只在点到那个按钮时才炸：
  //   node --check 查不出（运行时 ReferenceError 不是语法错误），回归也覆盖不到。
  //
  //   判据**不手写正则剥离字符串/注释**。早期两次实现都栽在这上面：
  //     ① 行注释 /(^|[^:\\])\/\/[^\n]*/ 的「非冒号非反斜杠」会匹配换行符，从行首吞掉代码行；
  //     ② 双引号串 /"(?:[^"\\]|\\.)*"/ 遇到正则字面量里的未闭合引号会跨行失控——实测把
  //        2204 行砍成 478 行，含用法的代码整段消失，于是「未定义」检测恒为空、测试形同虚设。
  //   现改用项目自带 tokenizer（lib/ast/tokenizer.js）：它按类型标明 ident/str/comment，
  //   取 ident 类 token 即天然排除字符串与注释，不再依赖手写正则的脆弱假设。
  test('[client] client.js：dshgp_ 前缀标识符无「用了没定义」', () => {
    const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    const tokens = tokenize(src).filter((t) => t.type === 'ident');

    // 先自证取到的是代码而非被剥离后的残骸，否则下面断言恒真
    assert.ok(tokens.length > 1000, `ident token 仅 ${tokens.length} 个，tokenizer 结果可疑`);

    const names = new Set(tokens.map((t) => t.value).filter((v) => v.startsWith('dshgp_')));
    assert.ok(names.size >= 20, `仅收集到 ${names.size} 个 dshgp_ 标识符，判据可能失效`);

    // 定义：const/let/var/function/class NAME，或形参/解构/属性简写形态
    const defs = new Set();
    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i];
      if (['const', 'let', 'var', 'function', 'class'].includes(t.value)
          && tokens[i + 1] && tokens[i + 1].value.startsWith('dshgp_')) {
        defs.add(tokens[i + 1].value);
      }
    }
    // 形参/解构：{ dshgp_x } 或 (dshgp_x, 或 ,dshgp_x)
    for (let i = 0; i < tokens.length; i += 1) {
      const v = tokens[i].value;
      if (!v.startsWith('dshgp_')) continue;
      const prev = tokens[i - 1] && tokens[i - 1].value;
      const next = tokens[i + 1] && tokens[i + 1].value;
      if ((prev === '{' || prev === ',' || prev === '(') && (next === ',' || next === '}' || next === ')' || next === '=')) {
        // 排除上一 token 是 . 的属性访问（obj.dshgp_x 不是定义）
        if (tokens[i - 1] && tokens[i - 1].value !== '.') defs.add(v);
      }
    }

    const undef = [...names].filter((n) => !defs.has(n));
    assert.deepEqual(undef, [],
      'client.js 存在未定义的 dshgp_ 标识符（会在用户点击时抛 ReferenceError）');
  });

  // clone 超时必须真正放宽：默认 fetch 超时 30s 对上百 MB 仓库必然不够
  test('[client] client.js：clone 提交用短超时（后台化后不再阻塞下载）', () => {
    // 克隆后台化：repo-clone 现在是「提交即返回 202」，
    //   下载在服务端后台跑，前端靠轮询取进度与终态。
    //   故提交调用**不该**再背 30 分钟超时——那是旧「请求阻塞到克隆结束」设计的产物，
    //   长超时还会掩盖「提交阶段就卡死」的真实故障。
    const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    // 提交调用的超时必须是短超时：**字面量或命名常量都接受**——把裸魔数提取为命名常量是本仓库
    //   对 readability/magic-number-smart 的既定处理方式，故断言应按意图（短超时）而非按写法。
    //   命名常量则回溯其定义处的字面量值。
    const call = src.match(/repo-clone'[\s\S]*?\},\s*([A-Za-z_$][\w$]*|\d[\d_]*)\s*\)/);
    assert.ok(call, 'repo-clone 提交应显式传超时');
    let used = NaN;
    if (/^\d/.test(call[1])) {
      used = Number(call[1].replace(/_/g, ''));
    } else {
      const def = src.match(new RegExp(`const\\s+${call[1]}\\s*=\\s*([\\d_]+)`));
      assert.ok(def, `超时常量 ${call[1]} 应有字面量定义`);
      used = Number(def[1].replace(/_/g, ''));
    }
    assert.ok(used <= 120_000, `提交是快速返回的，超时应为短超时（实际 ${used}ms）——长超时会掩盖提交阶段卡死`);
    // 旧的长超时常量应已删除（提交不再阻塞，留着是死代码且误导）
    assert.ok(
      !/dshgp_CLONE_TIMEOUT_MS/.test(src),
      'dshgp_CLONE_TIMEOUT_MS 应已删除（后台化后提交不下载，长超时是死代码）',
    );
    // 且必须有页面加载后接续后台克隆的恢复路径
    assert.match(src, /resumeCloneIfRunning/, 'client.js 应能在页面加载后接续后台克隆');
  });

  // ---------- 默认关（关键安全默认） ----------
  test('[client] 默认关：审计开关/LLM/全量扫 全部默认 false', () => {
    const c = defaultConfig();
    assert.equal(c.auditEnabled, false);
    assert.equal(c.pushPermitEnabled, undefined, 'pushPermitEnabled 已移除（2026-09-11）');
    assert.equal(c.llmAudit, undefined, 'llmAudit 已移除（v2 不提供 LLM 深度审查）');
    // hardcodeFullScan / auditLevel / auditRuleset 已删除（非用户可配项）
    assert.equal(c.hardcodeFullScan, undefined, 'hardcodeFullScan 已移除（2026-09-17：硬编码扫描随审计范围走）');
    assert.equal(c.auditLevel, undefined, 'auditLevel 已移除（2026-09-17：审计固定完整流程）');
    assert.equal(c.auditRuleset, undefined, 'auditRuleset 已移除（2026-09-17：设置项删除，只认工具 ruleset 参数）');
    // injectFullSkill / injectRepoIndexFull 已按需求废弃移除（不做全量注入）
    assert.equal(c.injectFullSkill, undefined, 'injectFullSkill 已移除（2026-09-13：全量注入开关不要了）');
    assert.equal(c.injectRepoIndexFull, undefined, 'injectRepoIndexFull 已移除（2026-09-13）');
    // 新增：注入系统提示词总开关（默认开——注入目录/功能用法才能让 AI 用插件而非绕开）
    assert.equal(c.injectSystemPrompt, true, 'injectSystemPrompt 默认开（2026-09-13 新增）');
  });

  test('[client] 默认关：DEFAULT_CONFIG 与 schema 默认值一致', () => {
    const c = defaultConfig();
    for (const item of SETTINGS_SCHEMA) {
      assert.equal(c[item.key], item.default, `${item.key} 默认值不一致`);
    }
  });

  test('[client] 默认数值：审计范围默认 diff（不做全量）', () => {
    assert.equal(defaultConfig().auditScanScope, 'diff');
  });

  // ---------- 配置合并（即时生效语义） ----------
  test('[client] 合并：布尔严格取真值（"true" 字符串不算开）', () => {
    assert.equal(resolveConfig({ auditEnabled: true }).auditEnabled, true);
    assert.equal(resolveConfig({ auditEnabled: 'true' }).auditEnabled, false);
    assert.equal(resolveConfig({ auditEnabled: 1 }).auditEnabled, false);
  });

  test('[client] 合并：未知键丢弃（防配置漂移）', () => {
    const c = resolveConfig({ unknownKey: 1, auditEnabled: true });
    assert.equal(c.unknownKey, undefined);
    assert.equal(c.auditEnabled, true);
  });

  test('[client] 合并：enum 非法值回落默认', () => {
    assert.equal(resolveConfig({ auditScanScope: 'bogus' }).auditScanScope, 'diff');
    assert.equal(resolveConfig({ auditScanScope: 'full' }).auditScanScope, 'full');
  });

  test('[client] 合并：string 类型统一字符串', () => {
    // auditRuleset 已删除，改用仍存在的 string 键（weightOverrides）
    assert.equal(resolveConfig({ weightOverrides: 123 }).weightOverrides, '123');
  });

  test('[client] 合并：不改动基线对象（纯函数）', () => {
    const base = defaultConfig();
    resolveConfig({ auditEnabled: true }, base);
    assert.equal(base.auditEnabled, false);
  });

  // ---------- 手写 createElement（无 JSX） ----------
  test('[client] 组件：createSettingsCard 只用 createElement（无 JSX 语法）', () => {
    const react = mockReact();
    const el = createSettingsCard(react, { config: defaultConfig() });
    assert.equal(el.type, 'div');
    assert.ok(react.calls.length >= SETTINGS_SCHEMA.length, '每个设置项至少一次 createElement');
    assert.ok(react.calls.some((c) => c.type === 'input'));
    assert.ok(react.calls.some((c) => c.type === 'select'));
  });

  test('[client] 组件：无 react.createElement 时明确报错（禁止 JSX 构建假设）', () => {
    assert.throws(() => createSettingsCard(null, {}), /createElement/);
    assert.throws(() => createSettingsCard({}, {}), /createElement/);
  });

  test('[client] 组件：复选框 checked 反映配置真值（逐项等于 schema 默认值）', () => {
    // 不再假设「所有开关默认 false」——注入系统提示词默认 true（需求新增），
    //   改为逐项对照 SETTINGS_SCHEMA 默认值断言，新增开关无需再改本测试。
    const react = mockReact();
    const cfg = defaultConfig();
    createSettingsCard(react, { config: cfg });
    const boxes = react.calls.filter((c) => c.type === 'input' && c.props.type === 'checkbox');
    assert.ok(boxes.length > 0);
    const boolKeys = SETTINGS_SCHEMA.filter((i) => i.type === 'boolean').map((i) => i.key);
    assert.equal(boxes.length, boolKeys.length, '复选框数量应等于 schema 布尔项数量');
    for (const k of boolKeys) {
      const expected = cfg[k];
      const hit = boxes.filter((b) => b.props.checked === expected);
      assert.ok(hit.length > 0, `${k} 的 checked 应等于默认值 ${expected}`);
    }
  });

  test('[client] 组件：onChange 立即回调（配置即时生效）', () => {
    const react = mockReact();
    const changes = [];
    createSettingsCard(react, { config: defaultConfig(), onChange: (k, v) => changes.push([k, v]) });
    const box = react.calls.find((c) => c.type === 'input' && c.props.type === 'checkbox');
    box.props.onChange({ target: { checked: true } });
    assert.equal(changes.length, 1, 'onChange 应被立即调用一次');
    assert.equal(changes[0][1], true, '回调值应为勾选后的真值');
    assert.ok(typeof changes[0][0] === 'string' && changes[0][0].length > 0, '回调应带设置键名');
  });

  test('[client] 组件：enum 渲染选项齐全', () => {
    const react = mockReact();
    createSettingsCard(react, {});
    const opts = react.calls.filter((c) => c.type === 'option').map((c) => c.props.value);
    // 新增「推送通道」enum（ssh/api/auto）。
    // 审计强度 enum 已删除（quick/standard/deep 不再出现在界面），
    //   审计范围 enum（diff/full）与推送通道 enum（ssh/api/auto）保留。
    // 任务完成自动推送范围 enum（session/all）新增。
    assert.deepEqual(opts.sort(), ['all', 'api', 'auto', 'diff', 'full', 'session', 'ssh']);
  });

  // 回归：手写 UI（lib/client.js dshgp_PushDefaultsBlock）的 select 选项
  //   必须经 props.children 渲染——jsx(type, props, key) 的第三参数是 **key 不是 children**，
  //   选项数组放第三参数会整体丢失、下拉渲染为空（「自动推送范围」下拉无内容，
  //   与 2026-09-16 审计进阶下拉同因）。该路径不走 SETTINGS_SCHEMA，须源码级断言防回归。
  test('[client] client.js：select 选项必须经 props.children 渲染（防 jsx 第三参数坑）', () => {
    // 坏写法（已发生两次）：jsx('select', { …props… }, […].map(…)) —— 第三参数被当作 key
    assert.ok(!/jsx\.jsx\('select',\s*\{[\s\S]*?\}\s*,\s*\[/.test(rootClientSrc),
      '不得把选项数组作为 jsx.jsx 第三参数传给 select（第三参数是 key，children 会丢失、下拉渲染为空）');
    // 好写法：children: 数组 放进 props（pushMethod / 自动推送范围两处）
    // 原为三处，其中「审计进阶 sel」随审计 Tab 移出构建（2026-11-08 UI 与审计解耦）——
    //   审计侧分片归档在 lib/client-parts/audit/，不进产物，故阈值同步降为 2。
    const good = rootClientSrc.match(/jsx\.jsx\('select',\s*\{[\s\S]*?children:\s*\[/g) || [];
    assert.ok(good.length >= 2, `应有 ≥2 个 select 用 props.children 渲染选项，实际 ${good.length}`);
  });

  test('[client] 源码：不含 JSX 语法（无 <Tag> 形式）', () => {
    assert.ok(!/<[A-Z][A-Za-z]*[\s/>]/.test(clientSrc), '源码不应含 JSX 标签');
    assert.ok(!clientSrc.includes('jsx-runtime'), '不应依赖 jsx-runtime');
  });

  // ---------- 零外部资源 ----------
  test('[client] 零外部资源：内联 CSS 无外链/url()/@import', () => {
    assert.deepEqual(collectExternalRefs(INLINE_CSS), []);
    assert.ok(!INLINE_CSS.includes('@import'));
    assert.ok(!INLINE_CSS.includes('url('));
  });

  test('[client] 零外部资源：自检能抓出外链（自检有效性）', () => {
    const bad = '.a { background: url(https://cdn.example.com/x.png); } @import "http://x/y.css";';
    const refs = collectExternalRefs(bad);
    assert.ok(refs.length >= 2, `应抓出外部引用，实际 ${refs.length}`);
  });

  test('[client] 模块描述：jsx=false、外链为空、默认配置已带出', () => {
    const info = clientModuleInfo();
    assert.equal(info.jsx, false);
    assert.deepEqual(info.externalResources, []);
    assert.equal(info.defaultConfig.auditEnabled, false);
    assert.deepEqual(info.slots, ['settings.section']);
  });

  test('[client] 模块描述：不实现 viewer（0.1.8 决策）', () => {
    const info = clientModuleInfo();
    assert.ok(!JSON.stringify(info).includes('viewer'), '侧边栏不应含提交历史查看器入口');
  });
  // ---------- 根 client.js（DSH 客户端插件适配层，1.0.0） ----------
  const rootClientSrc = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');

  test('[client] client.js：DSH 模块加载器格式（2026-09-12 完全移植 v1 结构）', () => {
    assert.ok(rootClientSrc.includes('__ModuleLoader__.load'), '应为 DSH 客户端模块入口');
    assert.ok(rootClientSrc.includes("id: 'dsh-git-push'"));
    // v1 验证过的结构：jsx-runtime（jsx.jsx/jsxs）+ Controller + card.inject hooks 模式
    assert.ok(rootClientSrc.includes('jsx-runtime') || rootClientSrc.includes('react.createElement'), 'v1 结构：jsx-runtime 或手写 createElement');
  });

  test('[client] client.js：零外部资源（内联 CSS 无外链/url()/@import）', () => {
    // 三选项卡版：css 变量名 dshgp_css（字符串数组）；取数组元素拼起来检查
    const cssMatch = /const dshgp_css = \[([\s\S]*?)\n(\s*)\]\.join\(''\)/.exec(rootClientSrc);
    assert.ok(cssMatch, '应能取到 dshgp_css 数组');
    const css = cssMatch[1].split(',').join('\n');
    assert.deepEqual(collectExternalRefs(css), []);
    assert.ok(!css.includes('@import'));
    assert.ok(!css.includes('url('));
    // 源码整体不应出现真实外链字符串
    assert.ok(!/['"`]https?:\/\//.test(rootClientSrc), '不应引用外部 URL');
  });

  test('[client] client.js：审计相关开关默认关（2026-09-12 三选项卡版）', () => {
    // 三选项卡重写：v1 移植的注入/硬编码全量扫等开关已移出 client.js（纯展示/审计/设置三页）
    // 保留的审计默认关：Controller 初始 auditEnabled=false
    assert.ok(/this\.auditEnabled = false/.test(rootClientSrc), 'auditEnabled 应默认 false');
    assert.ok(!rootClientSrc.includes("'llmAudit'"), 'client.js 不应含 llmAudit（v2 不提供 LLM 深度审查）');
    assert.ok(!rootClientSrc.includes("'pushPermitEnabled'"), 'client.js 不应含 pushPermitEnabled（已移除 2026-09-11）');
  });

  test('[client] client.js：设置项键（2026-09-12 三选项卡：客户端写回键须在 Host Config）', () => {
    // 三选项卡版 client.js 写回的键（settingsScope.set）：token/ssh/审计开关/规则次序/权重覆盖
    const clientKeys = ['githubToken', 'sshPub', 'auditEnabled', 'auditRuleOrder', 'weightOverrides'];
    for (const k of clientKeys) {
      assert.ok(rootClientSrc.includes(k), `client.js 缺设置键引用 ${k}`);
    }
    // 与 Host Config 一致：客户端能写的键 Host 必须也有。
    // 1.1.4 起 Config 定义在 lib/app/schema.js（入口 lib/index.js 只做再导出），
    // 故两处都读——免得下次再挪位置又把测试改一遍。
    // 审计键已单独成文件（lib/app/schema-audit.js，文件隔离阶段）——读取列表跟着加，
    //   与上面「免得下次再挪位置又把测试改一遍」的意图一致。
    const hostSrc = ['lib/app/schema.js', 'lib/app/schema-audit.js', 'lib/index.js']
      .map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
    for (const k of clientKeys) {
      assert.ok(hostSrc.includes(`${k}:`), `Host Config 缺 ${k}`);
    }
  });

  test('[client] client.js：不实施 viewer', () => {
    assert.ok(!rootClientSrc.includes('viewer'));
  });

  // 1.0.10 回归：ctx.get('ruleSlotMeta') 对未 inject 声明抛 "cannot get property without inject"
  // （vendor/cordis/lib 675 行）曾导致 apply 崩溃 → 设置侧边栏空白。修复：try/catch 兜底。
  // 配置卡已删除，只保留 settings.section（三选项卡侧边栏页）。
  test('[client] client.js apply：ctx.get 抛错不崩，settings.section 注册且渲染不崩（1.0.10 回归 + 三选项卡）', () => {
    // 捕获 ModuleLoader.load 的 factory
    let captured = null;
    const prevWindow = globalThis.window;
    globalThis.window = { __ModuleLoader__: { load: ({ id, factory }) => { captured = { id, factory }; } } };
    const reactMock = {
      createElement: () => ({ __mock: 'el' }),
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: () => {},
      // 1.0.14：GitPushCard 用 uSES 桥接读取 settings 快照（scope.use 不存在）
      useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    };
    const req = (name) => {
      if (name === 'react') return reactMock;
   // v1 结构依赖（完全移植 v1）：jsx-runtime / primitives / store
      if (name === 'react/jsx-runtime') return { jsx: reactMock.createElement, jsxs: reactMock.createElement };
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconChevronDownOutline14: 'icon-mock' };
      if (name === '@deepseek-ai/dsh-client-store') return {
        createSnapshotStore: (initial) => {
          let value = initial;
          const listeners = new Set();
          return {
            getSnapshot: () => value,
            set: (v) => { value = v; listeners.forEach((l) => l()); },
            subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
          };
        },
      };
      throw new Error('require: ' + name);
    };
    // 执行根 client.js 顶层（触发 ModuleLoader.load）
    new Function('require', 'window', rootClientSrc)(req, globalThis.window); // dsh-skip-sensitive: 沙箱执行仓库内 client.js 顶层（受控源码，非外部输入）
    globalThis.window = prevWindow;
    assert.ok(captured, 'ModuleLoader.load 应被调用');
    const mod = captured.factory(req);
    assert.deepEqual(mod.inject, ['slots'], 'inject 依赖声明（2.3.1：DSH 0.2.0 已移除 settingsScope 服务，故不再声明依赖，改特性检测自动切换）');

    // mock ctx：get 必抛（模拟 cordis 未 inject 行为）
    const registered = [];
    const scopeMock = {
      // 官方 SettingsScope 契约：getSnapshot/subscribe/set（无 use()——1.0.14 修复点）
      getSnapshot: () => ({ status: 'ready', value: { auditEnabled: false, auditScanScope: 'diff', auditLevel: 'standard', auditRuleset: '', auditRuleOrder: ['nodejs'], weightOverrides: '' } }),
      subscribe: () => () => {},
      set: async () => {}, mutate: async () => {}, unset: async () => {},
    };
    const ctx = {
      effect: () => {},
      // 真实 cordis：已 inject 的服务可经 get() 取到（settingsScope）；未 inject 的仍抛（保留 1.0.10 回归断言）
      get: (name) => {
        if (name === 'settingsScope') return { bind: () => scopeMock };
        throw new Error('cannot get property "ruleSlotMeta" without inject');
      },
      slots: {
        register: (desc, component) => ({ ...desc, component }),
        inject: (name, registerFn) => { registered.push({ slot: name, desc: registerFn() }); },
      },
      settingsScope: { bind: () => scopeMock },
    };
    assert.doesNotThrow(() => mod.apply(ctx), 'apply 遇 ctx.get 抛错不得崩溃');

    // 三选项卡：只注册 settings.section；settings.plugin.item 已删除
    assert.ok(!registered.some((r) => r.slot === 'settings.plugin.item'), 'settings.plugin.item 不应注册（已删除）');
    const secReg = registered.find((r) => r.slot === 'settings.section');
    assert.ok(secReg, 'settings.section 应注册');
    assert.equal(secReg.desc.id, 'dsh-git-push');
    assert.doesNotThrow(() => secReg.desc.component(), '侧边栏 section 渲染不得抛错');
    assert.ok(registered.some((r) => r.slot === 'settings.section' && r.desc.id === 'dsh-git-push'), 'settings.section 应注册');
  });

  // 1.11.4 修复（反代/memory 模式）：宿主按 isLoopback 决定 settingsScope 的 persistence——
  //   非 loopback 访问时恒 memory 模式、scope 快照 status 恒 'unavailable'、writable 恒 false。
  //   旧实现 available = snap.status === 'ready' → 恒 false → SectionPage return null → 设置侧边栏整页空白，
  //   writable 恒 false → 输入框全禁用。插件数据/写入已全走 HTTP（settings-get/settings-set/account-check/rule-slots），
  //   scope 快照只作初值兜底，故 available/writable 与快照解耦、恒可用。
  test('[client] client.js：反代/memory 模式 scope（status 恒 unavailable）下设置页仍渲染（绕开 isLoopback=memory 陷阱）', () => {
    let captured = null;
    const prevWindow = globalThis.window;
    globalThis.window = { __ModuleLoader__: { load: ({ id, factory }) => { captured = { id, factory }; } } };
    // createElement 执行函数组件（SectionPage 会被真正调用），jsx-runtime 只返回 mock 元素
    //   （不递归渲染 GitPushPage 整树，避免缺 UI 依赖 mock 爆炸）
    const reactMock = {
      createElement: (type, props) => {
        if (typeof type === 'function') return type(props || {});
        return { __mock: 'el', type, props: props || {} };
      },
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: () => {},
      // uSES 桥：直接取 store 快照（与上方 apply 测试同构）
      useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    };
    const req = (name) => {
      if (name === 'react') return reactMock;
      if (name === 'react/jsx-runtime') return {
        jsx: (type, props) => ({ __mock: 'jsx-el', type, props: props || {} }),
        jsxs: (type, props) => ({ __mock: 'jsx-el', type, props: props || {} }),
      };
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconChevronDownOutline14: 'icon-mock' };
      if (name === '@deepseek-ai/dsh-client-store') return {
        createSnapshotStore: (initial) => {
          let value = initial;
          const listeners = new Set();
          return {
            getSnapshot: () => value,
            set: (v) => { value = v; listeners.forEach((l) => l()); },
            subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
          };
        },
      };
      throw new Error('require: ' + name);
    };
    new Function('require', 'window', rootClientSrc)(req, globalThis.window); // dsh-skip-sensitive: 沙箱执行仓库内 client.js 顶层（受控源码，非外部输入）
    globalThis.window = prevWindow;
    assert.ok(captured, 'ModuleLoader.load 应被调用');
    const mod = captured.factory(req);
    assert.deepEqual(mod.inject, ['slots'], 'inject 声明只剩 slots（2.3.1：settingsScope 服务在 0.2.0 已移除）');

    // memory 模式 scope：status 恒 'unavailable'、writable 恒 false（isLoopback=memory 陷阱形态）
    const scopeMock = {
      getSnapshot: () => ({ status: 'unavailable', writable: false, value: {} }),
      subscribe: () => () => {},
      set: async () => {}, mutate: async () => {}, unset: async () => {},
    };
    const registered = [];
    const ctx = {
      effect: () => {},
      // 真实 cordis：已 inject 的服务可经 get() 取到（settingsScope）；未 inject 的仍抛（保留 1.0.10 回归断言）
      get: (name) => {
        if (name === 'settingsScope') return { bind: () => scopeMock };
        throw new Error('cannot get property "ruleSlotMeta" without inject');
      },
      slots: {
        register: (desc, component) => ({ ...desc, component }),
        inject: (name, registerFn) => { registered.push({ slot: name, desc: registerFn() }); },
      },
      settingsScope: { bind: () => scopeMock },
    };
    assert.doesNotThrow(() => mod.apply(ctx), 'memory 模式 scope 下 apply 不得崩溃');
    const secReg = registered.find((r) => r.slot === 'settings.section');
    assert.ok(secReg, 'settings.section 应注册');
    // 关键断言：unavailable 快照下 SectionPage 必须渲染（不得 return null 空白页）
    const rendered = secReg.desc.component();
    assert.ok(rendered !== null && rendered !== undefined, 'SectionPage 在 memory 模式 scope 下必须渲染（不得 return null 空白）');
    assert.equal(rendered.__mock, 'jsx-el', '应渲染 GitPushPage 元素而非空白');
  });

  // 2.3.1（DSH 0.2.0 兼容）：0.2.0 宿主已移除 settingsScope 服务——apply 必须走「特性检测 fallback」：
  //   不崩、仍注册 settings.section。背景：若 inject 仍声明 settingsScope，0.2.0 上 entry 会停在
  //   pending（web boot: 1 entry did not activate / dsh-git-push: pending (waiting for service: settingsScope)）。
  test('[client] client.js：0.2.0 宿主（无 settingsScope 服务）下 apply 不崩且仍注册 settings.section（特性检测 fallback）', () => {
    let captured = null;
    const prevWindow = globalThis.window;
    globalThis.window = { __ModuleLoader__: { load: ({ id, factory }) => { captured = { id, factory }; } } };
    const reactMock = {
      createElement: (type, props) => (typeof type === 'function' ? type(props || {}) : { __mock: 'el', type, props: props || {} }),
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: () => {},
      useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    };
    const req = (name) => {
      if (name === 'react') return reactMock;
      if (name === 'react/jsx-runtime') return {
        jsx: (type, props) => ({ __mock: 'jsx-el', type, props: props || {} }),
        jsxs: (type, props) => ({ __mock: 'jsx-el', type, props: props || {} }),
      };
      if (name === '@deepseek-ai/dsh-client-store') return {
        createSnapshotStore: (initial) => {
          let value = initial;
          const listeners = new Set();
          return {
            getSnapshot: () => value,
            set: (v) => { value = v; listeners.forEach((l) => l()); },
            subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
          };
        },
      };
      throw new Error('require: ' + name);
    };
    new Function('require', 'window', rootClientSrc)(req, globalThis.window); // dsh-skip-sensitive: 沙箱执行仓库内 client.js 顶层（受控源码，非外部输入）
    globalThis.window = prevWindow;
    const mod = captured.factory(req);
    assert.deepEqual(mod.inject, ['slots'], 'inject 不得再声明 settingsScope（0.2.0 无此服务）');
    const registered = [];
    const ctx = {
      effect: () => {},
      // 真实 cordis 语义：get(未 inject 的服务) 返回 undefined（不抛）；抛的是「属性直读」
      get: () => undefined,
      slots: {
        register: (desc, component) => ({ ...desc, component }),
        inject: (name, registerFn) => { registered.push({ slot: name, desc: registerFn() }); },
      },
      // 关键：完全不提供 settingsScope —— 模拟 DSH 0.2.0 宿主形态
    };
    // cordis 同款语义：**读未 inject 的服务属性会直接抛**（cannot get property "x" without inject）。
    //   必须用这种 ctx 才能测出「用 ctx.settingsScope 做特性检测」这类 bug——普通对象上直读
    //   只是 undefined，测不出来（实测事故：0.2.0 上 client entry 因此 failed，页面报
    //   web boot: 1 entry did not activate / dsh-git-push: failed）。
    const cordisLike = new Proxy(ctx, {
      get(target, prop) {
        if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop);
        throw new Error(`cannot get property "${String(prop)}" without inject`);
      },
    });
    assert.doesNotThrow(() => mod.apply(cordisLike), '无 settingsScope 服务时 apply 不得崩溃（0.2.0 兼容）');
    const secReg = registered.find((r) => r.slot === 'settings.section');
    assert.ok(secReg, 'settings.section 仍应注册（设置页不得因版本差异消失）');
    assert.equal(secReg.desc.id, 'dsh-git-push');
  });
}
