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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPLITTER = join(ROOT, 'scripts', 'module-splitter.py');

/** 造一个含多行 import + 多行裸再导出的最小源文件（结构与真实文件同类） */
function makeFixture(dir) {
  mkdirSync(join(dir, 'lib', 'sub'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'sub', 'a.js'), 'export const aOne = 1;\nexport const aTwo = 2;\nexport const aThree = 3;\n');
  writeFileSync(join(dir, 'lib', 'sub', 'b.js'), 'export const bOne = 1;\nexport const bTwo = 2;\n');
  const src = [
    'import {',
    '  aOne, aTwo, aThree,',
    '} from "./sub/a.js";',
    'export {',
    '  aOne, aTwo, aThree,',
    '};',
    'import { bOne, bTwo } from "./sub/b.js";',
    'export { bOne, bTwo };',
    'export function useAll() { return [aOne, aTwo, aThree, bOne, bTwo]; }',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'lib', 'index.js'), src);
  return src;
}

test('analyze 能解析多行 import 的符号（不是只取第一段）', () => {
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

test('split --dry-run 通过（多行 import/export 续行不被误报「未承载」）', () => {
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
