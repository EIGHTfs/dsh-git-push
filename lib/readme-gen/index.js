/**
 * dsh-git-push — README 生成总入口（git_gen_readme 工具用）
 * dsh-skip-i18n: 用户可见文案硬编码为产品设计
 *
 * 迁移自旧版 lib/readme-gen.js（v1.42/v1.53）——行为对齐：
 *   - 模板优先级：插件 template/README.md（用户自定义整份）> lib/readme-templates/readme.yml
 *     （yml 章节模板）> 代码内置兜底 DEFAULT_README_TEMPLATE
 *   - 占位符：{{name}} / {{description}} / {{version}} / {{toc}} / {{versionTable}}
 *   - {{versionTable}} 由 git log 提交标题里的 X.Y.Z 版本号聚合生成（补丁并入主版本）
 * 只迁 genReadme 所需能力；rebuild（squash/drop/fresh）属另一功能，未迁移。
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

import { runGit } from '../git/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 插件根（compat：lib/readme-gen/../.. = 插件根） */
export const PLUGIN_ROOT = join(__dirname, '..', '..');
/** yml 模板目录（章节改动只改 yml，不碰代码） */
export const README_TEMPLATE_YML_DIR = join(__dirname, '..', 'readme-templates');

/** 内置兜底模板（template/README.md 与 readme.yml 均缺省时用）。 */
export const DEFAULT_README_TEMPLATE = `# {{name}}

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

<!-- INSERT: | 方法 | 路径 | 说明 |（每行路径跳转到对应详细说明锚点） -->

## 版本列表

{{versionTable}}

## 注意事项

<!-- INSERT: 踩过的坑、边界条件、依赖环境要求、已知限制 -->

## 开发计划 / 疑难杂症

<!-- INSERT: 待办功能、已知问题、未解决的技术难题 -->
`;

/**
 * 渲染 yml 模板（{ header, sections }）→ markdown 模板文本（占位符原样保留，生成时替换）。
 * header 支持字符串（整段封面）或对象 { title, intro }（结构化封面）。
 */
export function renderReadmeTemplateYml(data) {
  const h = data?.header;
  const header = (typeof h === 'string' ? h
    : (h && typeof h === 'object') ? [h.title, h.intro].filter(Boolean).join('\n\n')
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

/** 装载插件内置 yml 模板（lib/readme-templates/*.yml 首个可用），失败返回 null。 */
export function loadReadmeTemplateYml() {
  let names = [];
  try { names = readdirSync(README_TEMPLATE_YML_DIR); } catch { return null; }
  const file = names.filter((f) => /\.ya?ml$/i.test(f)).sort()[0];
  if (!file) return null;
  const full = join(README_TEMPLATE_YML_DIR, file);
  try {
    const d = yamlLoad(readFileSync(full, 'utf8'));
    if (!d || typeof d !== 'object') return null;
    return { file: full, data: d, template: renderReadmeTemplateYml(d) };
  } catch { return null; }
}

/**
 * 解析 README 模板：插件 template/README.md（用户自定义）> readme.yml > 内置兜底。
 * @returns {{source:string, template:string, yml?:object}}
 */
export function resolveReadmeTemplate({ workspaceRoot = '' } = {}) {
  const candidates = [join(PLUGIN_ROOT, 'template', 'README.md')];
  if (workspaceRoot && workspaceRoot !== PLUGIN_ROOT) {
    candidates.push(join(workspaceRoot, 'template', 'README.md'));
  }
  for (const file of candidates) {
    try {
      if (existsSync(file)) {
        const template = readFileSync(file, 'utf8');
        if (template.trim()) return { source: file, template };
      }
    } catch { /* 下一份 */ }
  }
  const yml = loadReadmeTemplateYml();
  if (yml) return { source: yml.file, template: yml.template, yml: yml.data };
  return { source: 'builtin', template: DEFAULT_README_TEMPLATE };
}

/** 从模板自动生成目录（## 标题 → 锚点列表，「目录」自身不列入）。 */
export function tocFromTemplate(template) {
  const titles = [];
  for (const line of String(template || '').split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (!m) continue;
    const title = m[1].trim();
    if (title === '目录') continue;
    titles.push(title);
  }
  return titles.map((t) => `- [${t}](#${t})`).join('\n');
}

/* ------------------------- 版本聚合（迁移自旧 version-history.js 的精简部分） ------------------------- */

const VERSION_RE = /\bv?(\d+)\.(\d+)\.(\d+)\b/;

/** 从字符串解析版本号三元组，失败返回 null。 */
export function parseVersion(str) {
  const m = String(str).match(VERSION_RE);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

function versionToStr(v) { return `${v.major}.${v.minor}.${v.patch}`; }

/**
 * 扫描仓库全部提交，按 commit 标题里的 X.Y.Z 分组返回（最新在后的 reverse 序）。
 * 无版本标题的前置提交归入合成 1.0.0 组（不丢弃）。
 * @returns {Array<{version:object, versionStr:string, label:string, isPatch:boolean}>}
 */
export function listVersionCommits(repoPath) {
  const log = runGit(['log', '--reverse', '--format=%H|%s'], { cwd: repoPath });
  if (!log.stdout) return [];
  const groups = [];
  let current = null;
  for (const line of log.stdout.split('\n')) {
    const i = line.indexOf('|');
    if (i < 0) continue;
    const hash = line.slice(0, i);
    const msg = line.slice(i + 1);
    const v = parseVersion(msg);
    if (v) {
      current = { version: v, versionStr: versionToStr(v), hash, label: msg.slice(0, 80), commits: [hash], isPatch: v.patch > 0 };
      groups.push(current);
    } else if (current) {
      current.commits.push(hash);
    } else {
      current = {
        version: { major: 1, minor: 0, patch: 0 },
        versionStr: '1.0.0',
        hash,
        label: '1.0.0 初始提交（标题无版本号的前缀）',
        commits: [hash],
        isPatch: false,
        synthetic: true,
      };
      groups.push(current);
    }
  }
  return groups;
}

/** 版本记录表：git log 版本组按版本号聚合（补丁并入主版本，最新→最旧）。 */
export function buildReadmeVersionTable(repoPath) {
  const groups = listVersionCommits(repoPath);
  const lines = ['| 版本 | 内容 |', '|------|------|'];
  if (groups.length) {
    const byVersion = new Map();
    for (const g of groups) {
      const key = g.isPatch ? `${g.version.major}.${g.version.minor}.0` : g.versionStr;
      if (!byVersion.has(key)) byVersion.set(key, []);
      byVersion.get(key).push(g.label);
    }
    const keys = [...byVersion.keys()].sort((a, b) => {
      const [am, ai, ap] = a.split('.').map(Number);
      const [bm, bi, bp] = b.split('.').map(Number);
      return (bm - am) || (bi - ai) || (bp - ap);
    });
    for (const k of keys) {
      const content = byVersion.get(k).map((l) => l.replace(/^\S+\s*/, '')).filter(Boolean).join('；');
      lines.push(`| ${k} | ${content || '(见提交)'} |`);
    }
  } else {
    lines.push('| 1.0.0 | （待填） |');
  }
  return lines;
}

/**
 * 按模板生成仓库 README（git_gen_readme 工具主函数）。
 * @param {object} p { repoPath, writePath?, workspaceRoot? }
 * @returns {{ok:boolean, content:string, name:string, description:string, version:string|null,
 *            written:boolean, writeError:string|null, templateSource:string,
 *            versionTable:string[], toc:string}}
 */
export function genReadme({ repoPath, writePath, workspaceRoot = '' } = {}) {
  if (!repoPath) return { ok: false, error: '缺少 repoPath' };
  let name = '项目名';
  let description = '一句话简介';
  let version = null;
  try {
    const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf8'));
    if (pkg.name) name = pkg.name;
    if (pkg.description) description = pkg.description;
    if (pkg.version) version = pkg.version;
  } catch { /* 非 npm 项目用默认值 */ }

  const versionTableLines = buildReadmeVersionTable(repoPath);
  const { source, template } = resolveReadmeTemplate({ workspaceRoot });
  const toc = tocFromTemplate(template);
  const versionTable = versionTableLines.join('\n');
  const content = template
    .replaceAll('{{name}}', name)
    .replaceAll('{{description}}', description)
    .replaceAll('{{version}}', version || '')
    .replaceAll('{{toc}}', toc)
    .replaceAll('{{versionTable}}', versionTable);

  let written = false;
  let writeError = null;
  if (writePath) {
    try { writeFileSync(writePath, content, 'utf8'); written = true; }
    catch (e) { writeError = String(e?.message || e); }
  }

  return {
    ok: true, content, name, description, version, written, writeError,
    templateSource: source,
    versionTable: versionTableLines,
    toc,
  };
}