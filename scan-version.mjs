#!/usr/bin/env node
/**
 * scan-version.mjs — 扫描文件中所有出现版本号的位置（v1.57.0 起随项目维护）
 *
 * 用途：bump 版本前先扫一遍，确认 package.json / cli.mjs / README / 测试断言
 *       等所有需要同步版本号的位置，避免漏改（历史教训：v1.54.0 时 README 滞后）。
 *
 * 用法：
 *   node scan-version.mjs                  # 扫当前目录全部文本文件，列出所有版本号位置
 *   node scan-version.mjs <目录>            # 扫指定目录
 *   node scan-version.mjs --version=1.57.0 # 只看指定版本号（精确匹配 1.57.0 / v1.57.0）
 *   node scan-version.mjs --v              # 只看 v 前缀版本（v1.57.0 形式）
 *   node scan-version.mjs --json           # JSON 输出（机器可读）
 *
 * 规则：
 *   - 版本号正则：\d+\.\d+\.\d+（可带 v 前缀、-rc.1 / -beta.2 后缀）
 *   - 跳过：.git / node_modules / .tmp-* / dist / log / 二进制大文件
 *   - 行内注释里的版本号也报（README 版本表、测试注释同样是要同步的位置）
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const VERSION_RE = /v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/g;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.tmp-build', '.tmp-run', '.tmp', 'dist', 'log', 'coverage', '.pnpm-store', '.npm']);
const SKIP_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.mp3', '.mp4', '.mov', '.wav', '.class', '.pyc', '.o', '.so', '.dll', '.exe',
]);
const MAX_FILE_BYTES = 1_000_000; // 大于 1MB 视为二进制/大文件跳过

function collectFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.gitignore' && e.name !== '.npmrc') continue; // 隐藏文件跳过（保留关键配置）
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collectFiles(full, out);
    } else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      if (SKIP_EXTS.has(ext)) continue;
      const st = statSync(full);
      if (st.size > MAX_FILE_BYTES) continue;
      out.push(full);
    }
  }
  return out;
}

function scanFile(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch { return []; } // 二进制/不可读跳过
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(VERSION_RE)) {
      hits.push({ file, line: i + 1, version: m[0], snippet: line.trim().slice(0, 90) });
    }
  }
  return hits;
}

function parseArgs(argv) {
  const args = { dir: process.cwd(), version: null, vPrefix: false, json: false, files: [] };
  for (const a of argv) {
    if (a.startsWith('--version=')) args.version = a.slice('--version='.length);
    else if (a === '--v') args.vPrefix = true;
    else if (a === '--json') args.json = true;
    else if (a.startsWith('--files=')) args.files = a.slice('--files='.length).split(',');
    else args.dir = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const files = args.files.length > 0
  ? args.files
  : collectFiles(args.dir);

let all = [];
for (const f of files) all = all.concat(scanFile(f));

// 过滤
if (args.version) all = all.filter((h) => h.version === args.version || h.version === 'v' + args.version);
if (args.vPrefix) all = all.filter((h) => h.version.startsWith('v'));

// 按文件分组统计
const byFile = new Map();
for (const h of all) {
  if (!byFile.has(h.file)) byFile.set(h.file, []);
  byFile.get(h.file).push(h);
}

if (args.json) {
  console.log(JSON.stringify({
    scanned: files.length,
    total: all.length,
    versions: [...new Set(all.map((h) => h.version))].sort(),
    hits: all.map((h) => ({ file: h.file, line: h.line, version: h.version })),
  }, null, 2));
  process.exit(0);
}

console.log(`════ 版本号扫描（${args.dir}）════`);
console.log(`扫描 ${files.length} 个文件，命中 ${all.length} 处，涉及版本：${[...new Set(all.map((h) => h.version))].sort().join(' / ') || '无'}\n`);

let prevFile = '';
for (const [file, hits] of [...byFile.entries()].sort()) {
  if (file !== prevFile) {
    if (prevFile) console.log('');
    console.log(`📄 ${file}`);
    prevFile = file;
  }
  for (const h of hits) {
    console.log(`  ${String(h.line).padStart(4)}  ${h.version.padEnd(12)} ${h.snippet}`);
  }
}
console.log(`\n共 ${byFile.size} 个文件含版本号。`);
