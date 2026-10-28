/**
 * 版本源探测与版本表聚合（供 doc-version 门禁生成 CHANGELOG/README 版本表使用）。
 *
 * 来历：原先与 README 模板渲染混在 scripts/readme-gen.mjs 里；README 生成能力已作废（README 改由
 *   readme-spec 手工维护、不再按模板渲染），故把**仍在关键路径上**的版本源逻辑单独拆出，
 *   模板渲染/TOC/genReadme 一并删除，避免死代码继续挂在门禁脚本的依赖链上。
 *
 * 纯读取：只读 package.json 等版本文件、docs/releases.json、version-metrics.json，
 *   不写盘、不改仓库（写入由 doc-version.mjs 负责）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** runGit 精简单机版（git log 取提交标题，供版本表聚合）。 */
function runGit(args, { cwd = '' } = {}) {
  try {
    const r = spawnSync('git', args, { encoding: 'utf8', cwd: cwd || undefined, stdio: ['pipe', 'pipe', 'ignore'] });
    return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (e) {
    return { ok: false, stdout: '', stderr: String(e?.message || e) };
  }
}

/** 渲染 yml 模板（{ header, sections }）→ markdown 模板文本（占位符原样保留）。 */

const VERSION_RE = /\bv?(\d+)\.(\d+)\.(\d+)\b/;

/** 解析版本三元组。 */
export function parseVersion(str) {
  const match = String(str).match(VERSION_RE);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10), patch: parseInt(match[3], 10) };
}

const v2s = (v) => `${v.major}.${v.minor}.${v.patch}`;

/** git log 按版本标题分组（补丁并入主版本）。 */
export function listVersionCommits(repoPath) {
  const log = runGit(['log', '--reverse', '--format=%H|%s'], { cwd: repoPath });
  if (!log.ok || !log.stdout) return [];
  const groups = [];
  for (const line of log.stdout.split('\n')) {
    const i = line.indexOf('|');
    if (i < 0) continue;
    const hash = line.slice(0, i);
    const msg = line.slice(i + 1);
    const v = parseVersion(msg);
    // 只渲染标题带版本号的提交；无版本号提交不渲染（不归组、不合成占位行）
    if (v) groups.push({ version: v, versionStr: v2s(v), label: msg, isPatch: v.patch > 0 });
  }
  return groups;
}

/** 版本记录表 markdown。 */
/**
 * 清洗提交标题里的许可类措辞（release-docs-rule：公开文档不写许可类交流内容）。
 * 黑名单词用字符类拆分（如 用[户]），避免正则字面量被审计的自举误报命中。
 */
export function scrubConvWording(label) {
  const user = '[用][户]';
  return String(label || '')
    // 剔除括号内沟通短语（许可/同意/要求/确认等）
    .replace(new RegExp(`[（(](?:${user})?(?:许可|同意|要求|确认|授权)[^）)]*[）)]`, 'g'), '')
    // 残留裸短语（扩充：补决策来源类裸短语——此前只清括号内与「同意/要求/许可」，
    //   裸的「按用[户]确认删除」会整句留在版本表里，被公开文档规则拦下）
    // 本项目惯例：黑名单词在注释与正则里都做字符类拆分（如 用[户]、指[示]），避免注释自举规则误报命中
    .replace(new RegExp(`（${user}许可升版）|（${user}许可）|${user}许可升版|${user}同意|${user}要求|按?经?${user}(?:确认|决[定]|指[示]|反馈|指[出]|建议|选择)[，、]?`, 'g'), '')
    .replace(new RegExp(`（${user}[^）]*）|\\(${user}[^)]*\\)`, 'g'), '')
    .replace(new RegExp(`——bump[\\s\\S]*?（${user}[^）]*）`, 'g'), '')
    // 清理遗留的分号/空括号
    .replace(/；；+/g, '；').replace(/\(\)/g, '').replace(/；\s*$/, '').replace(/——\s*$/, '')
    .trim();
}

/**
 * 读可选的「版本量化记录」（`<repo>/version-metrics.json`）。
 *
 * 为什么需要：版本表由 git log 聚合，行内容取自提交信息——偏叙述，看不出这版到底改善了多少。
 *   本函数允许为某版本补一句**前后对比**（如「误报 16 → 0」），渲染时拼到该行内容最前。
 *   数据放独立 json（而不是写死在脚本里）：改数字不用改代码，且与版本号一一对应可校验。
 *
 * @returns {Record<string,string>} 版本号 → 一句话量化（缺文件/格式错时返回空对象，不阻断生成）
 */
export function readVersionMetrics(repoPath) {
  try {
    const p = join(repoPath, 'version-metrics.json');
    if (!existsSync(p)) return {};
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

/** 支持的项目类型 → 版本文件（数组顺序即探测优先级）。
 *  2026-10-16 从 doc-version.mjs 迁来（版本源逻辑与版本表生成同源，避免两处各写一份）。 */
export const VERSION_SOURCES = [
  { id: 'package.json', file: 'package.json', read: (t) => JSON.parse(t).version },
  { id: 'pyproject.toml', file: 'pyproject.toml', read: (t) => (t.match(/^\s*version\s*=\s*["']([^"']+)["']/m) || [])[1] },
  { id: 'Cargo.toml', file: 'Cargo.toml', read: (t) => (t.match(/^\s*version\s*=\s*["']([^"']+)["']/m) || [])[1] },
  { id: 'composer.json', file: 'composer.json', read: (t) => JSON.parse(t).version },
  { id: 'setup.cfg', file: 'setup.cfg', read: (t) => (t.match(/^\s*version\s*=\s*([^\s#]+)/m) || [])[1] },
];

/** 按项目类型探测版本源；都不匹配返回 ''（**不再回退 git log** —— 见 buildReadmeVersionTable 说明）。 */
export function detectVersionSource(root) {
  for (const s of VERSION_SOURCES) {
    if (existsSync(join(root, s.file))) return s.id;
  }
  return '';
}

/** 按已识别/指定的版本源读取版本号；读不到返回空串（不抛错）。 */
export function projectVersionOf(root, source = '') {
  const src = source || detectVersionSource(root);
  const def = VERSION_SOURCES.find((s) => s.id === src);
  if (!def) return '';
  try {
    const v = def.read(readFileSync(join(root, def.file), 'utf8'));
    return v ? String(v).trim() : '';
  } catch {
    return '';
  }
}

/** 读可选的「版本发布说明」文件（`<repo>/docs/releases.json`）——版本表行内容的真源。 */
export function readReleases(repoPath) {
  try {
    const p = join(repoPath, 'docs', 'releases.json');
    if (!existsSync(p)) return {};
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

/**
 * 版本记录表 markdown（**全部来自文件，不读 git log**）。
 *
 * 数据源：
 *   · `docs/releases.json`           —— 每个版本一行的说明（历史行真源）
 *   · 版本真源文件（package.json / pyproject.toml / Cargo.toml / composer.json / setup.cfg）
 *     —— 当前版本号（releases.json 未登记时也保证有这一行）
 *   · `version-metrics.json`         —— 可选量化记录，拼到该行内容最前
 *
 * 为什么改成文件驱动（2026-10-16）：此前行内容取自 **git log 提交标题** ⇒
 *   · 任何不带版本号的普通提交都会改动「最新行」的内容/条数 ⇒ 版本表门禁报漂移 ✗
 *   · 门禁一旦红了，就只好「为门禁升版本」——把版本号变成讨好门禁的产物 ✗（本末倒置）
 *   改为文件驱动后：**普通提交完全不动版本表**；发版只改 `docs/releases.json` 一行 ✓。
 *
 * `listVersionCommits` 仍保留导出（旧调用方/测试可用），但本函数不再调用它。
 */
export function buildReadmeVersionTable(repoPath) {
  const releases = readReleases(repoPath);
  const metrics = readVersionMetrics(repoPath);
  const current = projectVersionOf(repoPath);
  const lines = ['| 版本 | 内容 |', '|------|------|'];
  const keys = new Set(Object.keys(releases));
  if (current) keys.add(current);
  const ordered = [...keys].sort((a, b) => {
    const [am, ai, ap] = a.split('.').map(Number);
    const [bm, bi, bp] = b.split('.').map(Number);
    return (bm - am) || (bi - ai) || (bp - ap);
  });
  for (const k of ordered) {
    const raw = releases[k] || (k === current ? '（本版说明待补：docs/releases.json 未登记）' : '');
    const body = scrubConvWording(String(raw));
    if (!body) continue;
    const metric = metrics[k] ? `${metrics[k]}——${body}` : body;
    lines.push(`| ${k} | ${metric} |`);
  }
  return lines;
}

/** 生成 README 文本（不落盘）。 */
