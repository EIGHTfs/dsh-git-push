/**
 * test-module-splitter.mjs —— 同族测试合并（test-module-splitter.mjs · test-module-splitter-multiline.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（top-level test() 不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明（如两个文件都有 ROOT），
 *     不影响 test() 的注册时机与执行顺序；每个 test 名带 `[原文件名]` 前缀便于溯源。
 * 为什么不用 describe：它的回调是 async 函数作用域，会把顶层 await/const/exitCode 挪位（上轮实测 54 失败 / 少 17 条用例）。
 */
import { cmdModuleSplitter } from '../../cli-tool.mjs';
import { listTools } from '../../lib/app/tools.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-module-splitter.mjs（块级作用域：只为隔离同名声明，不改求值时机/顺序）──
{
  /**
   * module_splitter 工具 + CLI 接入测试（1.5.6）：
   *   工具契约（listTools 注册 / tool-call case / cli 命令 / HELP）+
   *   行为（cmdModuleSplitter 真实 spawn python3 跑 analyze / split --dry-run）+
   *   脚本随插件发布（scripts/module-splitter.py + SYNC_ENTRIES 覆盖）。
   */

  // module-splitter 属工具链侧命令 → 入口是 tool-sluice

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  // dirname 放最后引用的 ESM 静态 import 已提升——此处再导入一次会被去重，直接定义常量替代
  const rootDir = dirname(fileURLToPath(import.meta.url)) + '/../..';

  test('[module-splitter] module_splitter：工具清单注册（listTools 含 module_splitter 三参数）', () => {
    const tool = listTools().find((t) => t.name === 'module_splitter');
    assert.ok(tool, 'listTools 缺 module_splitter');
    assert.ok(tool.description && tool.description.includes('analyze'), '描述应含三子命令');
    for (const k of ['command', 'file', 'plan', 'dryRun']) {
      assert.ok(tool.parameters[k], `缺参数 ${k}`);
    }
  });

  test('[module-splitter] module_splitter：tool-call 分发 case 存在', () => {
    const src = readFileSync(join(rootDir, 'lib/app/tool-call.js'), 'utf8');
    assert.match(src, /case 'module_splitter':/, 'tool-call.js 缺 module_splitter case');
    assert.match(src, /runModuleSplitter\(/, '必须引用公共 runModuleSplitter（参数数组 spawn 防注入在公共模块）');
    // 公共实现必须在 lib/git/module-splitter.js（CLI 与工具共用，不各写一份）
    const impl = readFileSync(join(rootDir, 'lib/git/module-splitter.js'), 'utf8');
    assert.match(impl, /spawnSync\('python3'/, '公共模块必须 spawn python3（参数数组防注入）');
  });

  test('[module-splitter] module_splitter：CLI 命令 + HELP + parseArgv 兼容', () => {
    const cli = readFileSync(join(rootDir, 'cli-tool.mjs'), 'utf8');
    // 方案 B：module-splitter 走注册表驱动（registryByCli('module-splitter') 命中）
    const reg = readFileSync(join(rootDir, 'lib/app/command-registry.js'), 'utf8');
    assert.ok(/cli: 'module-splitter'/.test(reg), 'module-splitter 分派缺失（注册表 cli 声明）');
    assert.match(cli, /tool-sluice module-splitter <analyze\|split\|verify>/, '工具链侧 HELP 缺用法行');
    // 结构化：实现迁到 lib/cli/commands-doc.mjs，tool-sluice 入口 re-export 保持导出面
    assert.match(cli, /cmdModuleSplitter/, 'cli-tool.mjs 缺 cmdModuleSplitter 导出（re-export）');
    const doc = readFileSync(join(rootDir, 'lib/cli/commands-doc.mjs'), 'utf8');
    assert.match(doc, /export async function cmdModuleSplitter/, 'lib/cli/commands-doc.mjs 缺 cmdModuleSplitter 实现');
  });


  test('[module-splitter] module_splitter：analyze 真实跑通（python3）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dshgp-ms-'));
    try {
      const big = join(tmp, 'big.js');
      writeFileSync(big, [
        'import { a } from "../a.js";',
        '',
        'export function runGit() { return a(); }',
        '',
        'export function gitRaw() { return 1; }',
        '',
        'function helper() { return 2; }',
        '',
        'export { helper };',
        '',
      ].join('\n'));
      const r = await cmdModuleSplitter(['analyze', big], {});
      assert.equal(r.ok, true, `analyze 应成功：${JSON.stringify(r).slice(0, 200)}`);
      assert.ok(r.output.includes('runGit'), '输出应含顶层块名 runGit');
      assert.ok(r.output.includes('顶层块'), '输出应含块统计');
      // split --dry-run：预演不落盘
      const planFile = join(tmp, 'plan.json');
      writeFileSync(planFile, JSON.stringify({
        file: big, outdir: join(tmp, 'out'), index: 'index.js', index_header: '/** 出口 */',
        plan: { 'run.js': ['runGit', 'gitRaw'], 'util.js': ['helper'] },
        headers: { 'run.js': '/** 运行 */', 'util.js': '/** 工具 */' }, external: {},
      }));
      const s = await cmdModuleSplitter(['split', planFile], { dryRun: true });
      assert.equal(s.ok, true, `split --dry-run 应成功：${JSON.stringify(s).slice(0, 200)}`);
      assert.ok(s.output.includes('未写盘'), 'dry-run 应声明未写盘');
      assert.equal(existsSync(join(tmp, 'out')), false, 'dry-run 不得落盘');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

// ── 原 test-module-splitter-multiline.mjs（块级作用域：只为隔离同名声明，不改求值时机/顺序）──
{
  // module-splitter 的多行 import / 多行 export 子句支持回归。
  //
  // 事故（dsh-session-conductor 的 lib/index.js 实测）：
  //   · parse_imports 的两处正则都用 `.`（不跨行）——
  //     ① 整条 import 匹配不到 ⇒ 符号分发不到任何模块；
  //     ② 即使匹配到，`\{(.*)\}` 也取不到符号列表（clause 形如 "{\n  a,\n  b,\n}"）。
  //     实测 139 个 import 符号里只解析出 81 个，analyzeSession / cancelSessionTimers /
  //     patchSwitch 等全缺 ⇒ 出口文件里裸再导出 `export { x };` 因绑定不存在直接 SyntaxError。
  //   · audit_coverage 的 trivial 正则只认「以 import/export 开头」的行 ⇒ 多行 import 与
  //     多行 export 子句的**续行**被误报「没有任何模块承载」，正确的 plan 被拦下
  //     （实测先报 32 行、修完 import 后又报 9 行 export 续行）。
  // 本测试用一份含多行 import + 多行裸再导出的最小样例，锁住「analyze 能列出块 + dry-run 通过」。

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const SPLITTER = join(ROOT, 'scripts', 'module-splitter.py');

  /** 造一个含多行 import + 多行裸再导出的最小源文件（结构与真实文件同类） */
  function makeFixture(dir) {
    mkdirSync(join(dir, 'lib', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'sub', 'a.js'), 'export const aOne = 1;\nexport const aTwo = 2;\nexport const aThree = 3;\n');
    writeFileSync(join(dir, 'lib', 'sub', 'b.js'), 'export const bOne = 1;\nexport const bTwo = 2;\n');
    const src = [
      'import {',
      '  aOne, aTwo, aThree,',
      '} from "../sub/a.js";',
      'export {',
      '  aOne, aTwo, aThree,',
      '};',
      'import { bOne, bTwo } from "../sub/b.js";',
      'export { bOne, bTwo };',
      'export function useAll() { return [aOne, aTwo, aThree, bOne, bTwo]; }',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'lib', 'index.js'), src);
    return src;
  }

  test('[module-splitter-multiline] analyze 能解析多行 import 的符号（不是只取第一段）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-multiline-'));
    try {
      makeFixture(dir);
      const r = spawnSync('python3', [SPLITTER, 'analyze', join(dir, 'lib', 'index.js')], { encoding: 'utf8' });
      assert.equal(r.status, 0, `analyze 应成功（stderr: ${String(r.stderr).slice(0, 200)}）`);
      // analyze 的「顶部 import」展示是逐行截断的（多行 import 只显示首行 `import {`），
      //   故这里只断言它确实列出了顶层块（真正验「符号解析」的是下面那条 dry-run）。
      assert.match(r.stdout, /useAll/, 'analyze 应列出顶层块 useAll');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[module-splitter-multiline] split --dry-run 通过（多行 import/export 续行不被误报「未承载」）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ms-multiline-'));
    try {
      makeFixture(dir);
      // 必须用**绝对路径**：plan 里的 file/outdir 若写相对路径，会相对**当前工作目录**解析，
      //   在别处跑就会指到别的仓库的同名文件（实测踩到：指到了插件自己的 lib/index.js）。
      const plan = {
        file: join(dir, 'lib', 'index.js'),
        outdir: join(dir, 'lib'),
        index: 'index.js',
        plan: { 'impl.js': ['useAll'] },
      };
      writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
      const r = spawnSync('python3', [SPLITTER, 'split', join(dir, 'plan.json'), '--dry-run'], { encoding: 'utf8' });
      const out = String(r.stdout) + String(r.stderr);
      assert.equal(r.status, 0, `dry-run 应通过（实际输出：${out.slice(0, 300)}）`);
      assert.doesNotMatch(out, /没有任何模块承载/, '多行 import/export 的续行不该被报未承载');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
