#!/usr/bin/env node
/**
 * README 生成脚本（独立运行——自 lib/readme-gen/index.js 抽出，插件代码与文档生成脚本分离）
 *
 * 从插件工具 git_gen_readme 抽离为独立脚本；插件仅引用文档/skill，不再内置生成能力。
 * 用途：按模板生成仓库 README（占位符 {{name}}/{{description}}/{{version}}/{{toc}}/{{versionTable}}）。
 *
 * 用法：
 *   node scripts/readme-gen.mjs <repoPath> [--write <path>] [--template <path_or_yml>]
 *   缺省只打印生成内容（README 模板文本），--write 才落盘。
 *
 * 模板优先级：--template 指定 > <repo>/template/README.md > 本脚本附带的 readme.yml > 内置兜底。
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load as yamlLoad } from '../lib/vendor/js-yaml/js-yaml.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 插件根（scripts/readme-gen.mjs → ../../） */
const PLUGIN_ROOT = join(__dirname, '..');
/** yml 模板目录（复用插件 lib/readme-templates，脚本相对路径 = ../lib/readme-templates） */
const README_TEMPLATE_YML_DIR = join(__dirname, '..', 'lib', 'readme-templates');

/** 内置兜底模板 */
const DEFAULT_README_TEMPLATE = `# {{name}}

> {{description}}

## 目录

{{toc}}

## 架构设计

<!-- INSERT: 项目核心架构说明（分层/组件/模块/关键设计决策） -->

## 文件目录结构及作用

<!-- INSERT: 关键文件/目录清单 + 每项作用说明 -->

## 启动脚本

<!-- INSERT: start.sh 用法：start / stop / restart / status，含端口与环境要求 -->

## API 总览

<!-- INSERT: | 方法 | 路径 | 说明 | -->

## 版本列表

{{versionTable}}

## 注意事项

<!-- INSERT: 踩过的坑、边界条件、依赖环境要求、已知限制 -->

## 开发计划 / 疑难杂症

<!-- INSERT: 待办功能、已知问题、未解决的技术难题 -->
`;

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
export function renderReadmeTemplateYml(data) {
  const rawHeader = data?.header;
  const header = (typeof rawHeader === 'string' ? rawHeader
    : (rawHeader && typeof rawHeader === 'object') ? [rawHeader.title, rawHeader.intro].filter(Boolean).join('\n\n')
    : '').trim();
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const parts = [];
  if (header) parts.push(header);
  for (const s of sections) {
    const title = String(s?.title || '').trim();
    if (!title) continue;
    parts.push(`## ${title}\n\n${String(s?.body ?? '')}`);
  }
  return parts.join('\n\n') + '\n';
}

/** 装载 yml 模板（templates/*.yml 首个可用），失败返回 null。 */
export function loadReadmeTemplateYml(dir = README_TEMPLATE_YML_DIR) {
  let names = [];
  try { names = readdirSync(dir); } catch { return null; }
  const file = names.filter((f) => /\.ya?ml$/i.test(f)).sort()[0];
  if (!file) return null;
  const full = join(dir, file);
  try {
    const parsedYml = yamlLoad(readFileSync(full, 'utf8'));
    if (!parsedYml || typeof parsedYml !== 'object') return null;
    return { file: full, data: parsedYml, template: renderReadmeTemplateYml(parsedYml) };
  } catch { return null; }
}

/** 解析 README 模板：显式模板 > <repo>/template/README.md > yml > 内置兜底。 */
export function resolveReadmeTemplate({ repoPath = '', explicit = '' } = {}) {
  if (explicit) {
    try { const t = readFileSync(explicit, 'utf8'); if (t.trim()) return { source: explicit, template: t }; } catch { /* 忽略 */ }
  }
  for (const cand of [join(repoPath, 'template', 'README.md')]) {
    try { if (existsSync(cand)) { const t = readFileSync(cand, 'utf8'); if (t.trim()) return { source: cand, template: t }; } } catch { /* 忽略 */ }
  }
  const yml = loadReadmeTemplateYml();
  if (yml) return { source: yml.file, template: yml.template, yml: yml.data };
  return { source: 'builtin', template: DEFAULT_README_TEMPLATE };
}

/** 从模板自动生成目录（## 标题 → 锚点，'目录' 不列）。 */
export function tocFromTemplate(template) {
  const titles = [];
  for (const line of String(template || '').split('\n')) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (!match) continue;
    const t = match[1].trim();
    if (t === '目录') continue;
    titles.push(t);
  }
  return titles.map((t) => `- [${t}](#${t})`).join('\n');
}

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
    // 残留裸短语
    .replace(new RegExp(`（${user}许可升版）|（${user}许可）|${user}许可升版|${user}同意|${user}要求`, 'g'), '')
    .replace(new RegExp(`（${user}[^）]*）|\\(${user}[^)]*\\)`, 'g'), '')
    .replace(new RegExp(`——bump[\\s\\S]*?（${user}[^）]*）`, 'g'), '')
    // 清理遗留的分号/空括号
    .replace(/；；+/g, '；').replace(/\(\)/g, '').replace(/；\s*$/, '').replace(/——\s*$/, '')
    .trim();
}

export function buildReadmeVersionTable(repoPath) {
  const groups = listVersionCommits(repoPath);
  const lines = ['| 版本 | 内容 |', '|------|------|'];
  if (groups.length) {
    const by = new Map();
    for (const g of groups) {
      // 每个识别到的 X.Y.Z 独立成行（不把 patch>0 归并到 x.y.0）：
      //   归并会让 1.0.1~1.0.4 的内容并进 1.0.0 行，且 doc-version check 对
      //   真实逐版本记录（如 dsh-session-migrate）报漂移。
      const key = g.versionStr;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(scrubConvWording(g.label.replace(/^\S+\s*/, '')));
    }
    const keys = [...by.keys()].sort((a, b) => {
      const [am, ai, ap] = a.split('.').map(Number);
      const [bm, bi, bp] = b.split('.').map(Number);
      return (bm - am) || (bi - ai) || (bp - ap);
    });
    for (const k of keys) lines.push(`| ${k} | ${by.get(k).filter(Boolean).join('；')} |`);
  }
  return lines;
}

/** 生成 README 文本（不落盘）。 */
export function genReadme({ repoPath, template = '' } = {}) {
  let name = '项目名', description = '一句话简介', version = null;
  try {
    const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf8'));
    if (pkg.name) name = pkg.name;
    if (pkg.description) description = pkg.description;
    if (pkg.version) version = pkg.version;
  } catch { /* 非 npm 用默认 */ }
  const vtable = toString(buildReadmeVersionTable(repoPath));
  const { source, template: tpl } = resolveReadmeTemplate({ repoPath, template });
  const toc = tocFromTemplate(tpl);
  const content = tpl
    .replaceAll('{{name}}', name).replaceAll('{{description}}', description)
    .replaceAll('{{version}}', version || '').replaceAll('{{toc}}', toc)
    .replaceAll('{{versionTable}}', vtable);
  return { ok: true, content, name, description, version, templateSource: source, versionTable: buildReadmeVersionTable(repoPath), toc };
}

function toString(arr) { return Array.isArray(arr) ? arr.join('\n') : String(arr || ''); }

function main(argv) {
  const args = [...argv];
  const repoPath = args.find((a) => !a.startsWith('--'));
  const writeIdx = args.indexOf('--write');
  const writePath = writeIdx >= 0 ? args[writeIdx + 1] : '';
  const tplIdx = args.indexOf('--template');
  const template = tplIdx >= 0 ? args[tplIdx + 1] : '';
  if (!repoPath) { console.error('用法: node scripts/readme-gen.mjs <repoPath> [--write <path>] [--template <path>]'); process.exit(1); }
  const r = genReadme({ repoPath, template });
  if (!r.ok) { console.error(r.error); process.exit(1); }
  if (writePath) { try { writeFileSync(writePath, r.content, 'utf8'); console.error(`已生成: ${writePath}（模板：${r.templateSource}）`); } catch (e) { console.error('写入失败:', e?.message); process.exit(1); } }
  else process.stdout.write(r.content);
}

// 仅作为 CLI 直接运行时执行 main；作为模块 import 供测试时不自动跑（用 import.meta 判断是否入口）
if (process.argv[1] && import.meta.url && String(import.meta.url).startsWith('file:')) {
  try {
    const entry = fileURLToPath(import.meta.url);
    if (entry === String(process.argv[1])) main(process.argv.slice(2));
  } catch { /* 非 file url 不做入口判断 */ }
}