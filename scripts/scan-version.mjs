#!/usr/bin/env node
/**
 * scan-version.mjs — 版本一致性校验（自身总入口 1.1.4）
 *
 * 校验三处版本必须一致：
 *   1) lib/self/index.js 的 VERSION（单一事实源）
 *   2) package.json 的 version
 *   3) cli.mjs HELP 文本里的 v${VERSION}
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
  const ok = errors.length === 0;
  if (json) {
    console.log(JSON.stringify({ ok, selfVersion: VERSION, pkgVersion: vi.pkgVersion, errors }, null, 2));
  } else {
    console.log(`版本一致性 ${ok ? '✅' : '❌'}: lib/self=${VERSION} / package.json=${vi.pkgVersion} / cli HELP 引用 v\${VERSION} 模板`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    if (!ok) console.error('\n修法：改 lib/self/index.js 的 VERSION 与 package.json version 同步（单一事实源在 lib/self）');
  }
  process.exitCode = ok ? 0 : 1;
}

main();
