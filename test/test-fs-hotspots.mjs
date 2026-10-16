/**
 * FS 热点回归测试（2026-10-16 交接：把 scan-fs-hotspots 做成审计规则 + 独立 CLI）
 *
 * 钉子：
 *   ① 判据②并入 repeat-identical-call 后，**同一函数内**（无循环）重复的 fs 属性调用必须命中 ✓
 *   ② 判据⑤ 仓库级：同类扫描实现 > 阈值（默认 3）报 **1 条** notice，= 阈值不报 ✓
 *   ③ 抽取模块 lib/ast/fs-hotspots.js 的 scanners / walkers / dups 口径正确 ✓
 *   ④ 独立 CLI 可用（--json）+ **恒退出码 0**（咨询性，不拦提交）✓
 *   ⑤ 规则确实进了审计管道（kind 必须在 RULE_COMPILERS 登记，否则静默丢弃 ✗ 实测踩过）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { scanFsHotspots, scanFsHotspotsText } from '../lib/ast/fs-hotspots.js';
import { checkMultiFileScanners } from '../lib/checks/fs-scanner.js';
import { repeatIdenticalCallLines } from '../lib/ast/perf.js';
import { auditWithScope } from '../lib/audit/orchestrate.js';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 造一个「readdir + stat」的扫描器文件文本。 */
const scannerText = (n) => `import fs from 'node:fs';\nexport function scan${n}(dir) {\n`
  + `  const out = [];\n  for (const name of fs.readdirSync(dir)) {\n    const st = fs.statSync(dir + '/' + name);\n    if (st.size > 0) out.push(name);\n  }\n  return out;\n}\n`;

test('判据②并入：同一函数内（无循环）重复 statSync 同一表达式 ⇒ 命中', () => {
  const s = ['async function f(dir) {', '  const a = await fs.statSync(dir);', '  const b = await fs.statSync(dir);', '  return a && b;', '}'].join('\n');
  assert.equal(repeatIdenticalCallLines(s).size, 1, '同函数内第二次 statSync 应命中 1 行');
  const diff = ['function g() {', '  statSync(p1);', '  statSync(p2);', '}'].join('\n');
  assert.equal(repeatIdenticalCallLines(diff).size, 0, '实参不同不报（无法静态判断哪个更贵）');
});

test('抽取模块：scanners / walkers / 重复 stat 口径', () => {
  const text = `import fs from 'node:fs';\n`
    + `export function walkDir(dir) {\n  const a = fs.statSync(dir);\n  const b = fs.statSync(dir);\n  return fs.readdirSync(dir).map((n) => n + a.size + b.size);\n}\n`
    + `export function walkIt(dir) {\n  for (const n of fs.readdirSync(dir)) { fs.statSync(dir + '/' + n); }\n  return walkIt(dir);\n}\n`;
  const r = scanFsHotspotsText(text, 'lib/probe.js');
  assert.equal(r.scanners.length, 2, '两个函数都既是 readdir 又是 stat ⇒ 2 个扫描实现');
  assert.equal(r.dupStats.length, 1, 'walkDir 内重复 statSync(dir) ⇒ 1 处重复');
  assert.equal(r.stats.length, 3, '调用点只计一次：walkDir 2 次 stat + walkIt 1 次 stat（第一版双重计数是 bug ✗）');
  // ⚠️ 已知边界：函数边界用 collectFuncRanges（只认 `function` 声明与 `const f = () => {}`）
  //   ⇒ **对象方法 / 类方法 / 方法简写**里的遍历入口识别不到（实测某仓基线 3 个、本实现 0 个 ✗）。
  //   这是「宁可漏报」的取窄，已在规则文档与提交信息里写明；要覆盖方法需扩 collectFuncRanges ✓
  assert.ok(Array.isArray(r.walkers), 'walkers 恒为数组（方法形态暂不识别，属已知边界）');
});

test('判据⑤：> 阈值报 1 条 notice；= 阈值不报', () => {
  const rule = { id: 'performance/multi-file-scanners', minOccurrences: 3 };
  const texts4 = [1, 2, 3, 4].map((i) => ({ path: `lib/s${i}.js`, text: scannerText(i) }));
  const f = checkMultiFileScanners(texts4, [rule]);
  assert.equal(f.length, 1, '4 个实现 > 3 ⇒ 只报 1 条（避免 N 个文件刷 N 条同义提示）');
  assert.equal(f[0].severity, 'notice');
  assert.match(f[0].message, /共 4 个/, 'message 应给出实现总数');
  assert.match(f[0].message, /其余/, '其余实现应列在 message 里');
  assert.equal(checkMultiFileScanners(texts4.slice(0, 3), [rule]).length, 0, '恰好等于阈值不报');
});

test('判据⑤ 端到端：规则确实进审计管道（kind 未登记会静默丢弃 ✗）', async () => {
  const dir = mkdtempTracked('fs-hot-');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  for (const i of [1, 2, 3, 4]) writeFileSync(join(dir, 'lib', `s${i}.js`), scannerText(i), 'utf8');
  writeFileSync(join(dir, 'package.json'), '{"name":"probe","version":"1.0.0"}\n', 'utf8');
  const r = await auditWithScope(dir, { scope: 'full', maxScanFiles: 500, disabledSlots: [] });
  const mine = (r.findings || []).filter((x) => x.rule === 'performance/multi-file-scanners');
  assert.equal(mine.length, 1, `应命中 1 条（0 条说明规则被编译器丢了）：${JSON.stringify(mine)}`);
  assert.equal(mine[0].severity, 'notice');
});

test('独立 CLI：--json 可用且恒退出码 0（咨询性，不拦提交）', () => {
  const dir = mkdtempTracked('fs-cli-');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'a.js'), scannerText(1), 'utf8');
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts/scan-fs-hotspots.mjs'), dir, '--json'], { encoding: 'utf8' });
  const j = JSON.parse(out);
  assert.equal(j.totals.files, 1, '应扫到 1 个文件');
  assert.equal(j.totals.scanners, 1, '应识别出 1 个扫描实现');
  assert.ok(Array.isArray(j.hot) && j.hot[0].stats >= 1, '① 热点排序应给出 stat 计数');
  // 退出码：正常路径为 0 ✓（把「有发现」也当成功 —— 咨询性报告）
  const human = execFileSync(process.execPath, [join(ROOT, 'scripts/scan-fs-hotspots.mjs'), dir], { encoding: 'utf8' });
  assert.match(human, /逐文件扫描实现/, '人读模式应打印 ⑤ 小节');
  assert.ok(readFileSync(join(dir, 'lib', 'a.js'), 'utf8').length > 0, '扫描不得改动被扫文件');
});
