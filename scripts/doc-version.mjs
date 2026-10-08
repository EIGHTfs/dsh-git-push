#!/usr/bin/env node
/**
 * dsh-git-push — 版本列表文档生成器（doc-version：版本表由 git log 权威生成，聚合入表防手写版本记录漂移）
 * dsh-skip-i18n: 用户可见文案硬编码为产品设计
 *
 * 分体式文档三兄弟之一（doc-tree 文件树 / doc-func 函数列表 / doc-version 版本列表）。
 * 从 git log 聚合提交标题里的 X.Y.Z 版本号，生成版本记录表 markdown，
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
import { buildReadmeVersionTable } from './readme-gen.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'dshgp-version';
const MARK_START = `<!-- ${MARKER}:start -->`;
const MARK_END = `<!-- ${MARKER}:end -->`;

/**
 * 版本表「最新行」的来源：
 *   · npm 项目（项目根有 package.json）默认取 package.json.version —— 它才是版本号权威源
 *     （scan-version 门禁也正是比对 package.json），因此发版流程无需「先提交再生成再 amend」；
 *   · 其余项目退回 git log 聚合（老项目行为不变）。
 * @param {string} root 项目根
 * @param {string} [explicit] 'package.json' | 'git-log'（显式覆盖，留空则自动识别）
 */
export function resolveVersionSource(root, explicit = '') {
  if (explicit === 'package.json' || explicit === 'git-log') return explicit;
  return existsSync(join(root, 'package.json')) ? 'package.json' : 'git-log';
}

/** 读项目 package.json 的 version；读不到返回空串（不抛错，退回 git log 行）。 */
export function packageVersionOf(root) {
  try { return String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || ''); } catch { return ''; }
}

/** 生成版本列表 markdown（宿主块内容）。 */
export function buildVersionListText(root, { versionSource = '' } = {}) {
  const rows = buildReadmeVersionTable(root);
  const source = resolveVersionSource(root, versionSource);
  const pkg = source === 'package.json' ? packageVersionOf(root) : '';
  // 只改**最新数据行**的版本号（rows[0]=表头、rows[1]=分隔行 ⇒ 数据从 rows[2] 起）；
  //   日期与标题仍来自该行原本的 git 提交 —— 历史行完全不动。
  if (pkg && rows.length > 2) {
    const m = rows[2].match(/\d+\.\d+\.\d+/);
    if (m && m[0] !== pkg) rows[2] = rows[2].replace(m[0], pkg);
  }
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
export function checkVersionDrift({ hostPath, root } = {}) {
  const { text: latest } = buildVersionListText(root);
  const host = existsSync(hostPath) ? readFileSync(hostPath, 'utf8') : '';
  const block = findBlock(host);
  const issues = [];
  if (!block) issues.push({ type: 'no-block', msg: `${basename(hostPath)} 无版本列表标记块（${MARK_START} … ${MARK_END}），先 apply 生成` });
  else if (block.content.trim() !== latest.trim()) issues.push({ type: 'drift', msg: '版本列表与 git log 聚合不一致（运行 doc-version.mjs apply 更新）' });
  return { ok: issues.length === 0, issues, latest };
}

/* ─────────── CLI ─────────── */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const rootIdx = args.indexOf('--root');
  const root = rootIdx !== -1 && args[rootIdx + 1] ? resolve(args[rootIdx + 1]) : ROOT;
  const host = findMarkedHostMd(root, MARKER);
  const out = (msg) => console.log(msg);

  if (cmd === 'gen') {
    const r = buildVersionListText(root);
    out(r.text);
    out(`\n（${r.rows} 版本行；apply 写入 ${relative(root, host) || 'README.md'}）`);
    process.exit(0);
  }
  if (cmd === 'apply') {
    const r = buildVersionListText(root);
    const hostText = existsSync(host) ? readFileSync(host, 'utf8') : '';
    writeFileSync(host, applyVersionBlock(hostText, r.text), 'utf8');
    out(`✅ 已写入版本列表 → ${relative(root, host) || 'README.md'}（${r.rows} 版本行）`);
    process.exit(0);
  }
  if (cmd === 'check') {
    const r = checkVersionDrift({ hostPath: host, root });
    if (r.ok) { out(`✅ 版本列表与 git log 一致（${relative(root, host) || 'README.md'}）`); process.exit(0); }
    out('❌ 版本列表存在差异：');
    for (const i of r.issues) out('  - ' + i.msg);
    process.exit(1);
  }
  out('用法: node scripts/doc-version.mjs <gen|apply|check> [--root <项目根>]');
  process.exit(1);
}
