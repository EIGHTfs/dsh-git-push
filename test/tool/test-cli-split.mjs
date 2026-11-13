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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { helpSync, VERSION } from '../../lib/self/index.js';
import { TOOL_REGISTRY } from '../../lib/app/command-registry.js';
import {
  CLI_AUDIT, CLI_ENTRIES, CLI_GIT, CLI_TOOL, allCommands, commandOwner, parseEntrySourceMeta,
  readEntrySource, resolveDispatch,
} from '../../lib/cli/shared.mjs';

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
test('切割线：三侧命令并集 = 全部命令，且没有命令被两侧同时声明', () => {
  const commands = allCommands();
  const duplicated = commands.filter((cmd, index) => commands.indexOf(cmd) !== index);
  assert.deepEqual(duplicated, [], `同一命令被多个 CLI 声明：${duplicated.join(',')}`);
  assert.equal(new Set(commands).size, commands.length);
  assert.equal(commands.length, 28, `命令总数变了（现 ${commands.length}）：切割线需要同步更新 CLI_ENTRIES`);
  // 每个命令都能问到唯一归属
  for (const cmd of commands) assert.ok(commandOwner(cmd), `${cmd} 没有归属`);
  assert.equal(commandOwner('nope-cmd'), '', '未登记命令不应有归属');
});

test('切割线：注册表驱动命令必须全部有 CLI 归属（漏登记 = 该命令无处可敲）', () => {
  const registryCliNames = TOOL_REGISTRY.filter((entry) => entry.cli).map((entry) => entry.cli);
  const unowned = registryCliNames.filter((name) => !commandOwner(name));
  assert.deepEqual(unowned, [], `注册表命令没有 CLI 归属：${unowned.join(',')}`);
});

test('切割线：每侧 COMMANDS 表里的命令都必须在该侧切割线内（防「登记在 A、实现在 B」）', async () => {
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
test('分发决策：每个命令只在本侧可执行，异侧一律走跨侧提示', async () => {
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

test('分发决策：未知命令——git 侧透传给 git，另两侧报错并提示 git-sluice', () => {
  const gitPlan = resolveDispatch({ cliName: CLI_GIT, argv: ['status'] });
  assert.equal(gitPlan.kind, 'git-passthrough', 'git-sluice 未知命令 = git 透传（git-sluice 是 git 的超集）');
  for (const side of [CLI_AUDIT, CLI_TOOL]) {
    const plan = resolveDispatch({ cliName: side, argv: ['status'] });
    assert.equal(plan.kind, 'unknown', `${side} 不得把未知命令透传给 git`);
    assert.match(plan.error, /unknown|未知命令/);
    assert.match(plan.error, /git-sluice status/, '应提示 git 相关命令去 git-sluice');
  }
});

test('分发决策：help / version 三入口都有', () => {
  for (const side of SIDES) {
    assert.equal(resolveDispatch({ cliName: side, argv: [] }).kind, 'help');
    assert.equal(resolveDispatch({ cliName: side, argv: ['help'] }).kind, 'help');
    assert.equal(resolveDispatch({ cliName: side, argv: ['--help'] }).kind, 'help');
    assert.equal(resolveDispatch({ cliName: side, argv: ['version'] }).kind, 'version');
  }
});

// ── ③ 跨侧提示文案（真跑一条，断言可照抄） ──────────────────────────
test('跨侧提示：在 git-sluice 敲 audit → 报出 audit-sluice 与完整替代命令', async () => {
  const run = await runCliFile(CLI_GIT, ['audit', '/tmp/demo', '--full']);
  assert.equal(run.code, 1, '跨侧命令必须返回非 0（脚本能判失败）');
  assert.match(run.out, /"audit" 属于 audit-sluice/);
  assert.match(run.out, /请改用：audit-sluice audit \/tmp\/demo --full/, '必须给出可直接照抄的完整命令');
});

test('跨侧提示：反向也成立（audit-sluice 敲 commit、tool-sluice 敲 audit）', async () => {
  const auditSide = await runCliFile(CLI_AUDIT, ['commit', '/tmp/x', '--message', 'm']);
  assert.match(auditSide.out, /属于 git-sluice/);
  assert.match(auditSide.out, /请改用：git-sluice commit \/tmp\/x --message m/);
  const toolSide = await runCliFile(CLI_TOOL, ['audit', '.']);
  assert.match(toolSide.out, /属于 audit-sluice/);
  assert.match(toolSide.out, /请改用：audit-sluice audit \./);
});

test('注册表参数否定形式：--no-<布尔参数> 必须真的生效（HELP 写了就得能用）', async () => {
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
test('HELP：每个入口都列出自己全部命令，且不把别侧命令写成本侧用法', () => {
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

test('HELP：每个入口都提示另外两个 CLI（用户敲错时知道去哪找）', () => {
  for (const side of SIDES) {
    const { help } = parseEntrySourceMeta(readEntrySource(ENTRY_FILES[side]));
    for (const otherSide of SIDES.filter((name) => name !== side)) {
      assert.ok(help.includes(otherSide), `${side} HELP 未提到 ${otherSide}（用户不知道还有别的入口）`);
    }
  }
});

// ── ⑤ version 三入口一致 ────────────────────────────────────────────
test('version：三个入口输出同一个版本号', async () => {
  const outputs = await Promise.all(SIDES.map((side) => runCliFile(side, ['version'])));
  for (let index = 0; index < SIDES.length; index += 1) {
    assert.equal(outputs[index].code, 0, `${SIDES[index]} version 应成功`);
    assert.match(outputs[index].out, new RegExp(`${SIDES[index]} v${VERSION}`), `${SIDES[index]} version 输出异常：${outputs[index].out}`);
  }
  const versions = outputs.map((item) => (item.out.match(/v\d+\.\d+\.\d+/) || [])[0]);
  assert.deepEqual([...new Set(versions)], [`v${VERSION}`], `三入口版本不一致：${versions.join(' / ')}`);
});

// ── ⑥ 副作用接线（行为级证明，不是看 import 有没有写） ──────────────
test('副作用接线①：审计入口真的会报文档漂移（漏搬 host-doc-checks 时这条会红）', async () => {
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

test('副作用接线②：ruleset 真的编译出规则（漏搬 rule/compilers 会编译 0 条却报 OK）', async () => {
  const run = await runCliFile(CLI_AUDIT, ['ruleset']);
  assert.equal(run.code, 0, `ruleset 应成功：${run.out}`);
  const match = run.out.match(/编译成功 (\d+)/);
  assert.ok(match, `ruleset 输出缺少「编译成功 N」：${run.out.slice(0, 300)}`);
  assert.ok(Number(match[1]) > 50, `编译出的规则数异常少（${match[1]} 条）——compilers 副作用 import 可能丢失`);
});

// ── ⑦ 每个入口每个命令逐个真跑 ──────────────────────────────────────
test('逐命令真跑：28 个命令都能被所属入口接住（不落到跨侧提示）', async () => {
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

test('参数错必须让调用方能判定失败（exit 非 0，不能静默成功）', async () => {
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
