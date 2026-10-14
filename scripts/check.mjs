#!/usr/bin/env node
/**
 * 语法检查脚本（npm run check）
 * 递归检查 lib/****.js + cli.mjs 语法；任一失败退出 1（checkSyncInAsync 的脚本侧实现）。
 *
 * 2026-10-09（任务.md C8 分片改造）新增两条：
 *   ① **跳过 `lib/client-parts/`**：那是客户端**分片源码**——单个分片是片段（首片开 `factory`、
 *      尾片收尾），单独 `node --check` 必然失败；语法检查只对**产物** `lib/client.js` 做。
 *   ② **产物新鲜度门禁**：`lib/client.js` 必须与分片按 PART_ORDER 拼出来的一致，
 *      防止有人直接手改产物（下次构建就被覆盖，改动静默丢失）。
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClient } from './build-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** 递归收集 .js 文件（跳过 node_modules、点开头目录，以及分片目录 client-parts）。 */
function collectJs(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (name === 'client-parts') continue; // 分片是片段，见文件头 ①
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectJs(p, acc);
    else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

/** 递归收集 .json（同样的跳过规则，但不跳过 client-parts——那里没有 .json）。 */
function collectJson(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectJson(p, acc);
    else if (name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

const files = [...collectJs(join(ROOT, 'lib')), join(ROOT, 'cli.mjs')];
// docs/*.json 也必须能解析：版本表与发版说明直接依赖 docs/releases.json，
//   而它曾在 2.8.4 因一个尾随逗号变成非法 JSON 却**四项门禁全绿**（缺口）——这类错误必须在门禁里变红 ✗
const jsonFiles = [...collectJson(join(ROOT, 'lib')), ...collectJson(join(ROOT, 'docs'))];
let fail = 0;
let jsonFail = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe', encoding: 'utf8' });
    console.log(`✔ ${f.replace(ROOT + '/', '')}`);
  } catch (e) {
    fail++;
    console.error(`✗ ${f.replace(ROOT + '/', '')}: ${String(e?.stderr || e).trim().split('\n')[0]}`);
  }
}

// JSON 可解析性门禁（独立计数，不并入上面的语法通过率）
for (const f of jsonFiles) {
  try {
    JSON.parse(readFileSync(f, 'utf8'));
    console.log(`✔ ${f.replace(ROOT + '/', '')}`);
  } catch (e) {
    jsonFail++;
    console.error(`✗ ${f.replace(ROOT + '/', '')}: JSON 解析失败——${String(e?.message || e).split('\n')[0]}`);
  }
}

// 产物新鲜度：client.js 必须是分片构建出来的那一份
try {
  const built = buildClient();
  const current = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
  if (built === current) {
    console.log('✔ lib/client.js 与分片一致（构建产物新鲜）');
  } else {
    fail++;
    console.error('✗ lib/client.js 与分片不一致——请运行 node scripts/build-client.mjs 重新生成（不要手改产物）');
  }
} catch (e) {
  fail++;
  console.error(`✗ 分片构建校验失败：${e.message}`);
}

console.log(`\n${files.length - fail}/${files.length} 文件语法通过`);
console.log(`${jsonFiles.length - jsonFail}/${jsonFiles.length} 个 JSON 可解析`);
process.exitCode = (fail > 0 || jsonFail > 0) ? 1 : 0;
