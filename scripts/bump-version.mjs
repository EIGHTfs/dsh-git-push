#!/usr/bin/env node
/**
 * dsh-git-push — 一键版本升版（bump-version）
 *
 * 为什么要有这个脚本：版本号散在三处手工同步，每次发版都要手改
 *   ① `package.json` 的 version
 *   ② `lib/self/index.js` 的 `export const VERSION = '<v>'; // <v>：说明。历史：…`
 *   ③ `docs/releases.json` 新增一条 `<v>: "说明"`
 *   少改一处就会被 doc-version / version-drift 门禁判为漂移，而这两处还各带长文本
 *   （VERSION 行还挂着历史链），手改既慢又容易写坏引号、破坏 JSON。
 *   第 4 处（README 版本表 / CHANGELOG）已由 doc-version.mjs 从上面两处生成，无需手改。
 *
 * 用法：
 *   node scripts/bump-version.mjs --message "本次做了什么"          # 预览（默认 dry-run）
 *   node scripts/bump-version.mjs --message "…" --apply             # 真写盘
 *   node scripts/bump-version.mjs --to 2.11.0 --message "…" --apply # 指定版本（默认 patch +1）
 *   node scripts/bump-version.mjs --message-file /tmp/msg.txt --apply
 *
 * 约定：
 *   · **默认 dry-run**——只打印将要改动的三处（旧值 → 新值），不落盘；确认无误再加 --apply。
 *     （与 npm_publish / install-plugin 同口径：有副作用的动作先看预览再执行）
 *   · `--message` 必填：发版说明不能凭空生成，属于「人写内容」，脚本只负责把它同步到三处。
 *   · VERSION 行的历史链保留最近 2 个版本摘要，避免注释无限变长（沿用既有风格）。
 *   · 写完自动重生成版本文档（doc-version apply / doc-func apply / doc-tree sync+apply），
 *     因为版本号一变，CHANGELOG 与函数索引必须跟着走，否则门禁立刻报漂移。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'package.json');
const SELF = join(ROOT, 'lib', 'self', 'index.js');
const RELEASES = join(ROOT, 'docs', 'releases.json');

/** 解析命令行参数（只认 --flag value 与布尔 --apply）。 */
function parseArgs(argv) {
  const out = { apply: false, to: '', message: '', messageFile: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') { out.apply = true; continue; }
    if (a === '--message' || a === '-m') { out.message = argv[++i] || ''; continue; }
    if (a === '--message-file') { out.messageFile = argv[++i] || ''; continue; }
    if (a === '--to') { out.to = argv[++i] || ''; continue; }
  }
  return out;
}

const fail = (msg) => { console.error('✗ ' + msg); process.exit(1); };

/** 语义化版本比较：a < b 返回负。只支持 x.y.z。 */
function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** patch +1：默认每次提交升第三位（version-discipline 的既有口径）。 */
function bumpPatch(v) {
  const [x, y, z] = String(v).split('.').map(Number);
  return `${x}.${y}.${(z || 0) + 1}`;
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { fail(`${p} 解析失败：${e.message}`); }
}

/**
 * 拼新的 VERSION 行。
 * 旧注释形如：`2.10.4：本次说明。历史：2.10.3：更早说明。` → 把「本次说明」降级进历史链，
 *   只保留最近 2 条，避免每版都把整串历史再抄一遍（实测 2.9.x 之后该行已接近不可读）。
 */
function buildVersionLine(oldLine, newVer, oldVer, message) {
  const m = /export const VERSION = '([^']+)';\s*\/\/(.*)$/.exec(oldLine);
  const oldComment = m ? m[2].trim() : '';
  // 旧版本的「本次说明」= 历史链之前的那一段
  const histIdx = oldComment.indexOf('历史：');
  const oldMain = (histIdx >= 0 ? oldComment.slice(0, histIdx) : oldComment).replace(/^[\d.]+\s*[:：]\s*/, '').trim();
  const oldHist = histIdx >= 0 ? oldComment.slice(histIdx + '历史：'.length).trim() : '';
  // 历史链：新压入的旧版摘要 + 原有最近 1 条
  const prev = oldMain ? [`${oldVer}：${oldMain}`] : [];
  const kept = oldHist ? oldHist.split(/。\s*(?=[\d.]+：)/).slice(0, 1).map((s) => s.replace(/。$/, '')) : [];
  const chain = [...prev, ...kept].join('。');
  const comment = `${newVer}：${message}。` + (chain ? `历史：${chain}。` : '');
  return `export const VERSION = '${newVer}'; // ${comment}`;
}

const args = parseArgs(process.argv.slice(2));
const pkg = readJson(PKG);
const cur = String(pkg.version || '');
const target = args.to || bumpPatch(cur);
let message = args.message;
if (args.messageFile) {
  try { message = readFileSync(args.messageFile, 'utf8').trim(); } catch (e) { fail(`--message-file 读取失败：${e.message}`); }
}
if (!/^\d+\.\d+\.\d+$/.test(target)) fail(`版本号必须为 x.y.z：${target}`);
if (cmpVer(target, cur) <= 0) fail(`目标版本 ${target} 必须大于当前 ${cur}`);
if (!message) fail('缺少 --message（发版说明需人写；或从 --message-file 读取）');

const releases = readJson(RELEASES);
if (releases[target]) fail(`docs/releases.json 已存在 ${target} 条目（不要重复升版）`);

const selfSrc = readFileSync(SELF, 'utf8');
const selfLines = selfSrc.split('\n');
const vi = selfLines.findIndex((l) => /^export const VERSION = '/.test(l));
if (vi < 0) fail('lib/self/index.js 未找到 VERSION 行');
const oldLine = selfLines[vi];
const newLine = buildVersionLine(oldLine, target, cur, message);

// ── 预览（默认 dry-run）
console.log(`升版：${cur} → ${target}${args.apply ? '（--apply 真写盘）' : '（dry-run，未写盘）'}`);
console.log('\n① package.json');
console.log(`   - "version": "${cur}"`);
console.log(`   + "version": "${target}"`);
console.log('\n② lib/self/index.js（VERSION 行）');
console.log(`   - ${oldLine.slice(0, 90)}…`);
console.log(`   + ${newLine.slice(0, 90)}…`);
console.log('\n③ docs/releases.json');
console.log(`   + "${target}": "${message.slice(0, 70)}${message.length > 70 ? '…' : ''}"`);
console.log('\n④ 随后自动重生成：docs/CHANGELOG.md（doc-version）、docs/FUNCTIONS.md（doc-func）、tree-doc.json（doc-tree）');

if (!args.apply) {
  console.log('\n确认无误后追加 --apply 才会写盘。');
  process.exit(0);
}

// ── 写盘
// 注意：本仓库在 CIFS 挂载上，write/edit 工具会因 chmod 报 EPERM；脚本用 fs 直接写
//   普通文件（不触发 chmod），这正是把它脚本化的额外收益。
const newPkgText = readFileSync(PKG, 'utf8').replace(
  /("version"\s*:\s*")[^"]+(")/,
  `$1${target}$2`,
);
if (newPkgText === readFileSync(PKG, 'utf8')) fail('package.json 的 version 未替换成功（正则未命中）');
writeFileSync(PKG, newPkgText);

selfLines[vi] = newLine;
writeFileSync(SELF, selfLines.join('\n'));

const merged = { ...releases };
merged[target] = message;
// 按语义化版本排序，保持文件可读（原文件即按版本升序）
const sorted = {};
for (const k of Object.keys(merged).sort(cmpVer)) sorted[k] = merged[k];
writeFileSync(RELEASES, JSON.stringify(sorted, null, 2) + '\n');

console.log('\n✔ 三处已写入，重生成派生文档…');
for (const cmd of [
  ['scripts/doc-version.mjs', ['apply']],
  ['scripts/doc-func.mjs', ['apply']],
  ['scripts/doc-tree.mjs', ['sync']],
  ['scripts/doc-tree.mjs', ['apply']],
]) {
  try {
    execFileSync(process.execPath, [join(ROOT, cmd[0]), ...cmd[1]], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    console.log(`  ✔ ${cmd[0]} ${cmd[1].join(' ')}`);
  } catch (e) {
    console.error(`  ✗ ${cmd[0]} 失败：${String(e?.stdout || e?.stderr || e).split('\n')[0]}`);
  }
}
console.log(`\n完成：${cur} → ${target}。请跑 node scripts/doc-version.mjs check 与全量回归确认门禁绿。`);
