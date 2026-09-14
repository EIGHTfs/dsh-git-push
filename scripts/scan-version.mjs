#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * scan-version.mjs — 版本一致性校验（自身总入口 0.1.4）
 *
 * 校验四处版本必须一致：
 *   1) lib/self/index.js 的 VERSION（单一事实源）
 *   2) package.json 的 version
 *   3) cli.mjs HELP 文本里的 v${VERSION}
 *   4) README.md 版本列表里的当前版本（2026-09-13 新增）
 * 任一不一致 → exit 1（版本漂移拦截）。
 *
 * 用法：
 *   node scripts/scan-version.mjs            # 校验（npm run scan-version）
 *   node scripts/scan-version.mjs --json     # JSON 输出（机器可读）
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSION, versionInfo, helpSync } from '../lib/self/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const json = process.argv.includes('--json');

/**
 * 从 README 正文提取版本列表里的当前版本（2026-09-13 新增）。
 *
 * 策略：①先找「（当前）」标记行的版本（最精确：作者显式标注的当前版本）
 *       ②无标记 → 取「## 版本列表 / ## 版本记录 / ## 更新日志」章节内出现的最高版本
 * 返回 { found, version, source }；source 说明取值依据（便于排查）。
 * @param {string} text README 全文
 */
export function readmeVersion(text = '') {
  const src = String(text || '');
  if (!src) return { found: false, version: '', source: '' };
  // ① 显式「当前」标记：| **1.2.3**（当前） |  或  - **1.2.3**（当前）
  const cur = /\*{0,2}(\d+\.\d+\.\d+)\*{0,2}\s*[（(]\s*当前\s*[）)]/.exec(src);
  if (cur) return { found: true, version: cur[1], source: '（当前）标记行' };
  // ② 版本章节内取最高版本
  const heads = ['## 版本列表', '## 版本记录', '## 版本历史', '## 更新日志', '## Changelog'];
  let section = '';
  for (const h of heads) {
    const i = src.indexOf(h);
    if (i < 0) continue;
    const rest = src.slice(i + h.length);
    const next = rest.indexOf('\n## ');
    section = next >= 0 ? rest.slice(0, next) : rest;
    break;
  }
  const scope = section || src;
  const found = [...scope.matchAll(/\|\s*\*{0,2}(\d+\.\d+\.\d+)\*{0,2}/g)].map((m) => m[1]);
  if (!found.length) return { found: false, version: '', source: '' };
  const cmp = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
  };
  const max = found.reduce((a, b) => (cmp(b, a) > 0 ? b : a));
  return { found: true, version: max, source: section ? '版本列表章节最高版本' : '全文表格最高版本' };
}

function main() {
  const errors = [];
  // 1) lib/self VERSION（import 已拿） 2) package.json
  const pkgPath = join(ROOT, 'package.json');
  let pkgJson = '';
  try { pkgJson = readFileSync(pkgPath, 'utf8'); } catch (e) { errors.push(`读 package.json 失败: ${e?.message || e}`); }
  const vi = versionInfo(pkgJson);
  if (!vi.ok) errors.push(vi.error);
  // 3) cli.mjs HELP 文本（源码里是 v${VERSION} 模板，运行时渲染为 v<版本>）
  const cliPath = join(ROOT, 'cli.mjs');
  let cliText = '';
  if (existsSync(cliPath)) {
    try { cliText = readFileSync(cliPath, 'utf8'); } catch { /* 忽略 */ }
  }
  if (!cliText.includes('v${VERSION}')) {
    errors.push('cli.mjs HELP 未引用 v${VERSION} 模板（应在 HELP 首行 git-sluice v${VERSION}）');
  }
  // 4) README.md 版本列表（2026-09-13 新增：扫 README 版本号 vs package.json version）
  //    优先认「（当前）」标记行；无标记则取版本列表章节内最高版本。
  const readmePath = join(ROOT, 'README.md');
  let readmeText = '';
  if (existsSync(readmePath)) {
    try { readmeText = readFileSync(readmePath, 'utf8'); } catch (e) { errors.push(`读 README.md 失败: ${e?.message || e}`); }
  } else {
    errors.push('README.md 不存在');
  }
  const rv = readmeVersion(readmeText);
  if (!rv.found) {
    errors.push('README.md 版本列表未找到版本号（应有「## 版本列表」章节，行形如 | **1.2.3**（当前） | … |）');
  } else if (rv.version !== vi.pkgVersion) {
    errors.push(`README.md 版本列表当前版本 ${rv.version}（${rv.source}）与 package.json ${vi.pkgVersion} 不一致——发版后须同步 README 版本记录`);
  }
  const ok = errors.length === 0;
  if (json) {
    console.log(JSON.stringify({ ok, selfVersion: VERSION, pkgVersion: vi.pkgVersion, readmeVersion: rv.version || '', readmeSource: rv.source || '', errors }, null, 2));
  } else {
    console.log(`版本一致性 ${ok ? '✅' : '❌'}: lib/self=${VERSION} / package.json=${vi.pkgVersion} / README=${rv.version || '未找到'} / cli HELP 引用 v\${VERSION} 模板`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    if (!ok) console.error('\n修法：改 lib/self/index.js 的 VERSION 与 package.json version 同步（单一事实源在 lib/self）');
  }
  process.exitCode = ok ? 0 : 1;
}

main();
