#!/usr/bin/env node
/**
 * dsh-git-push — 版本列表文档生成器（doc-version：版本表由**文件**权威生成，防手写版本记录漂移）
 * dsh-skip-i18n: 用户可见文案硬编码为产品设计
 *
 * 分体式文档三兄弟之一（doc-tree 文件树 / doc-func 函数列表 / doc-version 版本列表）。
 * 版本表数据源 = `docs/releases.json`（每版一行说明）+ 版本真源文件（package.json 等）
 *   + `version-metrics.json`（可选量化记录）；**不读 git log**（2026-10-16 改，原因见
 *   readme-gen.mjs 的 buildReadmeVersionTable 注释）。
 * 写入宿主 md（README 有 dshgp-version 标记块用 README，否则 docs/ 带块 md）。
 * 复用 readme-gen.mjs 的 buildReadmeVersionTable（版本聚合逻辑单一事实源）。
 *
 * 用法：
 *   node scripts/doc-version.mjs gen   [--root <项目根>]   # 打印版本表文本
 *   node scripts/doc-version.mjs apply [--root <项目根>]   # 写入宿主 md（自动探测）
 *   node scripts/doc-version.mjs check [--root <项目根>]   # 比对宿主块与最新（漂移报错）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMarkedHostMd } from './doc-tree.mjs';
import { buildReadmeVersionTable, detectVersionSource, projectVersionOf, readReleases, VERSION_SOURCES } from './readme-gen.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'dshgp-version';
const MARK_START = `<!-- ${MARKER}:start -->`;
const MARK_END = `<!-- ${MARKER}:end -->`;

/**
 * 版本源探测与读取**已迁到 scripts/readme-gen.mjs**（版本表生成与版本源同源，避免两处各写一份）。
 * 这里只做再导出，保持旧调用方的 import 路径不变。
 *
 * ⚠️ 2026-10-16 起：版本表**不再读 git log**（`detectVersionSource` 不再回退 'git-log'）——
 *   表内容由 `docs/releases.json` + 版本真源文件生成，普通提交不再动表、也不再逼人「为门禁升版本」。
 */
// 本地再导出（`export … from` 不产生本地绑定 ⇒ 必须先 import 再导出）
export { VERSION_SOURCES, detectVersionSource, projectVersionOf, readReleases };

/** 兼容旧调用：等价于"按项目类型识别后取版本号"。 */
export function packageVersionOf(root) {
  return projectVersionOf(root, detectVersionSource(root));
}

/** 生成版本列表 markdown（宿主块内容）——**纯文件驱动，不读 git log**。
 *  行内容来自 buildReadmeVersionTable（docs/releases.json + 版本真源 + version-metrics.json）。 */
export function buildVersionListText(root, _opts = {}) {
  const rows = buildReadmeVersionTable(root);
  const source = detectVersionSource(root) || '（无版本源文件）';
  const pkg = projectVersionOf(root);
  return { text: `## 版本列表\n\n${rows.join('\n')}\n`, rows: rows.length - 2, source, packageVersion: pkg };
}

/** 找宿主 md 内的 dshgp-version 标记块。 */
function findBlock(text) {
  const s = text.indexOf(MARK_START);
  const e = text.indexOf(MARK_END);
  if (s === -1 || e === -1 || e <= s) return null;
  return { start: s, end: e, content: text.slice(s + MARK_START.length, e) };
}

/** 替换/插入标记块。无块时追加到文件尾。 */
export function applyVersionBlock(text, newContent) {
  const block = findBlock(text);
  if (block) return text.slice(0, block.start) + MARK_START + '\n' + newContent + '\n' + MARK_END + text.slice(block.end + MARK_END.length);
  return text.replace(/\s*$/, '\n') + `\n${MARK_START}\n${newContent}\n${MARK_END}\n`;
}

/** 比对宿主块与最新版本表。返回 { ok, issues, latest }。 */
export function checkVersionDrift({ hostPath, root, versionSource = '' } = {}) {
  const { text: latest, source } = buildVersionListText(root, { versionSource });
  const host = existsSync(hostPath) ? readFileSync(hostPath, 'utf8') : '';
  const block = findBlock(host);
  const issues = [];
  if (!block) issues.push({ type: 'no-block', msg: `${basename(hostPath)} 无版本列表标记块（${MARK_START} … ${MARK_END}），先 apply 生成` });
  else if (block.content.trim() !== latest.trim()) issues.push({ type: 'drift', msg: `版本列表与期望内容不一致（来源：${source}，运行 doc-version.mjs apply 更新）` });
  return { ok: issues.length === 0, issues, latest, source };
}

/* ─────────── CLI ─────────── */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const rootIdx = args.indexOf('--root');
  const root = rootIdx !== -1 && args[rootIdx + 1] ? resolve(args[rootIdx + 1]) : ROOT;
  // 版本来源可显式指定（package.json | git-log）；不传则按项目类型自动识别（有 package.json 即 npm 项目）
  const srcIdx = args.indexOf('--version-source');
  const versionSource = srcIdx !== -1 && args[srcIdx + 1] ? String(args[srcIdx + 1]) : '';
  if (versionSource && versionSource !== 'package.json') {
    console.log(`❌ --version-source 只接受 package.json（版本表已改为文件驱动，不再支持 git-log），收到：${versionSource}`);
    process.exit(1);
  }
  const host = findMarkedHostMd(root, MARKER);
  const out = (msg) => console.log(msg);

  if (cmd === 'gen') {
    const r = buildVersionListText(root, { versionSource });
    out(r.text);
    out(`\n（${r.rows} 版本行；来源 ${r.source}；apply 写入 ${relative(root, host) || 'README.md'}）`);
    process.exit(0);
  }
  if (cmd === 'apply') {
    const r = buildVersionListText(root, { versionSource });
    const hostText = existsSync(host) ? readFileSync(host, 'utf8') : '';
    const force = args.includes('--force');
    // ── 预演（dry-run）：先看清"将写入几行、首行是什么"，再决定落盘 ──
    //   破坏性写入前必须能预演；`gen` 也能看内容，但 dry-run 额外报出目标文件与现有行数对比。
    if (args.includes('--dry-run')) {
      const curB = findBlock(hostText);
      const curN = curB ? (curB.content.match(/^\|\s*\d+\.\d+\.\d+\s*\|/gm) || []).length : 0;
      out(`[dry-run] 目标文件：${relative(root, host) || 'README.md'}`);
      out(`[dry-run] 将写入：${r.rows} 版本行（来源 ${r.source}）；现有：${curN} 行`);
      out(`[dry-run] 首行预览：${(r.text.split('\n').find((l) => /^\|\s*\d/.test(l)) || '（无数据行）').trim()}`);
      out('[dry-run] 未做任何写入。');
      process.exit(0);
    }
    // ── 安全闸（2026-10-10 真实事故：本工具静默把整张版本表清空）──
    //   0 行的常见原因**不是**"项目真的没有版本"，而是 git log 读不到（如本机 dubious ownership，
    //   git 直接拒绝该仓库）⇒ 此时必须拒绝写盘，绝不覆盖现有版本表。
    if (!force && !(r.rows > 0)) {
      out(`❌ 拒绝写盘：聚合出 0 条版本行（来源 ${r.source}）——现有版本表保持不变，未做任何修改。`);
      out('   常见原因：git log 读不到该仓库（例如 dubious ownership 被 git 拒绝）。先执行：');
      out("     git config --global --add safe.directory '*'");
      out('   再用 `node scripts/doc-version.mjs gen` 确认能输出真实版本行（非 0 行）后重试；');
      out('   确实要写空表时显式加 --force。');
      process.exit(2);
    }
    // ── 骤减保护：新表行数少于现有表行数 ⇒ 疑似聚合来源异常（log 不完整/换源），同样拒绝写盘 ──
    const curBlock = findBlock(hostText);
    const curRows = curBlock ? (curBlock.content.match(/^\|\s*\d+\.\d+\.\d+\s*\|/gm) || []).length : 0;
    if (!force && curRows > 0 && r.rows < curRows) {
      out(`❌ 拒绝写盘：本次聚合 ${r.rows} 行 < 现有 ${curRows} 行（疑似聚合来源异常，如 git log 不完整或换源）。`);
      out('   现有版本表保持不变；确认要缩减请先备份，再显式加 --force。');
      process.exit(2);
    }
    writeFileSync(host, applyVersionBlock(hostText, r.text), 'utf8');
    out(`✅ 已写入版本列表 → ${relative(root, host) || 'README.md'}（${r.rows} 版本行；来源 ${r.source}）`);
    process.exit(0);
  }
  if (cmd === 'check') {
    const r = checkVersionDrift({ hostPath: host, root, versionSource });
    if (r.ok) { out(`✅ 版本列表一致（来源 ${r.source}）`); process.exit(0); }
    out('❌ 版本列表存在差异：');
    for (const i of r.issues) out('  - ' + i.msg);
    process.exit(1);
  }
  out('用法: node scripts/doc-version.mjs <gen|apply|check> [--root <项目根>] [--version-source package.json|git-log]');
  process.exit(1);
}
