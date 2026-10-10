#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * scan-hardcoded-paths 回归测试（改为断言「经审计引擎跑出的 findings」）
 *
 * 关键变化：脚本已**删除自带的 PATTERNS**，检测唯一来源 = 审计引擎
 *   （规则 lib/audit-rules/audit-rules-paths.yml 的 paths/hardcoded-absolute-path
 *    + 精筛 lib/checks/hardcoded-path.js）。本测试因此断言：
 *   ① 引擎**确实**对本规则报出这些行（阳性必命中）；
 *   ② 相对路径基准 = **文件所在目录**，且只有"本机可访问"者才给相对路径（不可访问仅警告）；
 *   ③ 默认 dry-run 不写盘、`--write` 才改（纪律）。
 * 用法：node test/test-scan-hardcoded-paths.mjs（退出码 0 = 通过）
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanHardcodedPaths, engineFindings } from '../scripts/scan-hardcoded-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'scripts', 'scan-hardcoded-paths.mjs');

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  ✅ ' + name);
  else { failed++; console.log('  ❌ ' + name + (extra ? ' —— ' + extra : '')); }
};

console.log('scan-hardcoded-paths 回归（经审计引擎）');

// ── 夹具：1 处真实存在（保证"可访问"可复现）+ 4 处各系统不存在 ──
const base = mkdtempSync(join(tmpdir(), 'hcpaths-'));
const realDir = join(base, 'real-target');
mkdirSync(realDir, { recursive: true });
const realFile = join(realDir, 'exists.txt');
writeFileSync(realFile, 'x\n');

// 用 String.raw 写夹具：反斜杠保持字面量，避免模板字面量转义歧义（曾因此让 UNC 样品实际写成别的字符）
const sample = [
  `const a = '${realFile}';`,                              // posix，可访问
  String.raw`const b = '/volume9/definitely-not-here/x';`,  // posix，不可访问
  String.raw`const c = 'C:\\NoSuchDir\\file.txt';`,         // windows，不可访问
  String.raw`const d = '\\nosuchserver\share\f';`,          // UNC，不可访问
  String.raw`const e = 'file:///volume9/nope.txt';`,        // file-url，不可访问
].join('\n');
const sampleFile = join(base, 'sample.mjs');
writeFileSync(sampleFile, sample);

// ── ① 引擎确实报出这些行（阳性必命中）──
const findings = await engineFindings(base);
ok('审计引擎对本规则报出 findings', findings.length >= 5, '实际 ' + findings.length);
const lines = new Set(findings.map((f) => f.line));
ok('5 行全部被引擎报出', [1, 2, 3, 4, 5].every((n) => lines.has(n)), [...lines].join(','));

// ── ② 报告口径：两态 + 基准 = 文件所在目录 ──
const { hits } = await scanHardcodedPaths(base);
ok('报告命中 5 处', hits.length === 5, '实际 ' + hits.length);
const acc = hits.filter((h) => h.accessible);
const inacc = hits.filter((h) => !h.accessible);
ok('可访问 1 处 / 不可访问 4 处', acc.length === 1 && inacc.length === 4, `acc=${acc.length} inacc=${inacc.length}`);
ok('可访问者相对路径基准 = 文件所在目录',
  !!acc[0] && acc[0].relative === relative(dirname(sampleFile), realFile).split('\\').join('/'),
  acc[0] && `${acc[0].raw} → ${acc[0].relative}`);
ok('不可访问者**不给**相对路径（仅警告）', inacc.every((h) => h.relative === ''));
const osSet = new Set(hits.map((h) => h.os));
ok('覆盖多系统分类（posix/windows/unc/file-url）', ['posix', 'windows', 'unc', 'file-url'].every((o) => osSet.has(o)), [...osSet].join(','));

// ── ③ 纪律：默认 dry-run 不写盘 ──
const before = readFileSync(sampleFile, 'utf8');
try { execFileSync(process.execPath, [SCRIPT, '--root', base], { encoding: 'utf8' }); } catch { /* 有命中时退出码非 0，属预期 */ }
ok('默认 dry-run 未修改文件', readFileSync(sampleFile, 'utf8') === before);

// ── ④ --write 才真改（只改可访问那条）──
let out = '';
try { out = execFileSync(process.execPath, [SCRIPT, '--root', base, '--write'], { encoding: 'utf8' }); } catch (e) { out = String(e.stdout || ''); }
const after = readFileSync(sampleFile, 'utf8');
ok('--write 后被改写（绝对路径→相对路径）', after !== before && after.includes(acc[0].relative) && !after.includes(realFile), after.split('\n')[0]);
ok('--write 只改可访问那条，不可访问的保持原样', after.includes('/volume9/definitely-not-here/x') && after.includes('C:\\\\NoSuchDir'));
ok('--write 输出含 old→new 记录', /→/.test(out), out.split('\n').find((l) => l.includes('→')) || '(无)');

// ── ⑤ 干净目录（只有相对路径）⇒ 引擎不报、脚本报 ✅ ──
const cleanDir = join(base, 'clean');
mkdirSync(cleanDir, { recursive: true });
writeFileSync(join(cleanDir, 'ok.mjs'), "const p = './relative/path.js';\n");
const clean = await scanHardcodedPaths(cleanDir);
ok('相对路径不误报（引擎 findings 为空）', clean.hits.length === 0, '实际 ' + clean.hits.length);

rmSync(base, { recursive: true, force: true });
console.log(failed === 0 ? '\n结果: 全部通过' : `\n结果: ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
