// dsh-git-push v1.42.0 — README 模板生成（自 core.js 按功能拆分，行为零变化）

import { listVersionCommits } from './version-history.js';
import { PLUGIN_ROOT } from './plugin-paths.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
 * README 模板（v1.40.0）：不再读同级仓——优先插件 template/README.md（每人可改章节），缺省用内置骨架。
 */

export function resolveReadmeTemplate({ workspaceRoot = '' } = {}) {
  const candidates = [join(PLUGIN_ROOT, 'template', 'README.md')];
  for (const file of candidates) {
    try {
      if (existsSync(file)) {
        const template = readFileSync(file, 'utf8');
        if (template.trim()) return { source: file, template };
      }
    } catch { /* 下一份 */ }
  }
  return { source: 'builtin', template: DEFAULT_README_TEMPLATE };
}

function tocFromTemplate(template) {
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

/**
 * 规范化生成 README 骨架。
 *  - 模板：插件 template/README.md（v1.40.0 起不再读同级仓）
 *  - 自动填充：{{name}} {{description}} {{version}} {{toc}} {{versionTable}}
 *  - writePath 可选写入文件，默认只返回内容
 */

/** 版本记录表：git log 版本组按版本号聚合（补丁并入主版本，最新→最旧）。 */
function buildReadmeVersionTable(repoPath) {
  // 版本记录表：git log 版本组 → 按版本号聚合（同版本多 commit 并一行，补丁并入所属主版本，最新→最旧）
  const groups = listVersionCommits(repoPath);
  const versionTableLines = ['| 版本 | 内容 |', '|------|------|'];
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
      versionTableLines.push(`| ${k} | ${content || '(见提交)'} |`);
    }
  } else {
    versionTableLines.push('| 1.0.0 | （待填） |');
  }
  return versionTableLines;
}

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
  } catch {}

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

/**
 * 解析 git diff 文本，返回变更文件列表：
 * [{ path, addedLines: string[], deleted: number, isBinary: boolean }]
 */
