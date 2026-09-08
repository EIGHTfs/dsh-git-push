// dsh-git-push v1.42.0 — 工作区上下文：skill 文档收集与注入、开发者要求清单（自 core.js 按功能拆分，行为零变化）

import { credentialsDir } from './token-credentials.js';
import { PLUGIN_ROOT } from './plugin-paths.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function collectRepoSkillDocs({ workspaceRoot = '', pluginRoot = PLUGIN_ROOT, maxFileBytes = 80_000, maxTotalBytes = 400_000 } = {}) {
  const files = [];
  let total = 0;
  const walk = (dir, relBase) => {
    if (!dir || !existsSync(dir) || total >= maxTotalBytes) return;
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (total >= maxTotalBytes) return;
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p, `${relBase}/${ent.name}`);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
      try {
        let text = readFileSync(p, 'utf8');
        if (text.length > maxFileBytes) text = `${text.slice(0, maxFileBytes)}\n…(truncated)`;
        total += text.length;
        files.push({ path: `${relBase}/${ent.name}`, text });
      } catch { /* 读不到跳过 */ }
    }
  };
  // v1.40.0：注入源 = 插件 skills/ + 技能仓库（原同级仓 dsh-git-push-User 已废除）
  for (const d of resolveSkillRepoDirs()) {
    if (d.walk === false) continue;
    walk(d.dir, d.base);
  }
  return files;
}

/**
 * 只收集 skill 目录与 .md 相对路径（不读内容）——「只注入 skill 目录」模式。
 * 递归全部来源目录，跳过 .git/node_modules；返回 [{ base, dir, files: [相对路径] }]。
 */

export function collectRepoSkillDirs({ workspaceRoot = '', pluginRoot = PLUGIN_ROOT } = {}) {
  const dirs = [];
  const walk = (dir, relParts, list) => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      if (ent.isDirectory()) {
        const rel = relParts.concat(ent.name);
        const files = [];
        walk(join(dir, ent.name), rel, files);
        for (const f of files) list.push(f);
        continue;
      }
      if (ent.isFile() && ent.name.endsWith('.md') && !ent.name.startsWith('.')) {
        list.push(relParts.concat(ent.name).join('/'));
      }
    }
  };
  const collect = (dir, base, { doWalk = true, loose = null } = {}) => {
    if (!dir || !existsSync(dir)) return;
    const files = [];
    if (doWalk) walk(dir, [], files);
    if (loose) {
      try {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          if (ent.isFile() && ent.name.endsWith('.md') && loose.test(ent.name)) files.push(ent.name);
        }
      } catch { /* 跳过 */ }
    }
    files.sort();
    if (files.length) dirs.push({ base, dir, files });
  };
  // v1.40.0：来源 = 插件 skills/ + 技能仓库（git-workflow 散文档只收 git-*.md，不全量递归）
  for (const d of resolveSkillRepoDirs()) {
    collect(d.dir, d.base, { doWalk: d.walk !== false, loose: d.loose || null });
  }
  return dirs;
}

/** 系统提示词里用的精简目录（v1.32.0）：不再塞整份说明书。 */

export const FUNCTION_MANUAL_COMPACT = [
  '【dsh-git-push 功能目录（精简注入）】完整说明书不注入以省 token。细节加载 skill `dsh-git-push-functions` 或读插件 `skills/dsh-git-push-functions.md`。',
  '工具：git_scan / git_commit_push / code_audit / git_gen_readme / git_remote_create / git_set_visibility / git_clone / git_rebuild_history / git_push_rules / push_permit_status / push_permit_config',
  '提交前必须核对 README（git_commit_push 返回 readmeCheck）。属主/权限噪声已忽略。审计拦截不提交。默认走 api.github.com，token 401 回退 SSH。',
].join('\n');

/**
 * 插件功能说明书注入文本（v1.28.0 全文 → v1.32.0 精简）。
 * 完整 md 仍在 skills/dsh-git-push-functions.md，按需加载；本函数只返回短目录。
 * compact=false 时仍返回全文（单测/排查用）。
 */

export function collectFunctionManual({ pluginRoot = PLUGIN_ROOT, compact = true } = {}) {
  const manualPath = join(pluginRoot, 'skills', 'dsh-git-push-functions.md');
  let text = '';
  try { text = readFileSync(manualPath, 'utf8'); } catch { /* 读不到走空 */ }
  if (compact) return FUNCTION_MANUAL_COMPACT;
  return text.trim() ? text : '';
}

/** 目录模式注入文本：只给路径 + 文件清单，正文由 AI 按需自行读取。 */

export function formatRepoSkillDirsInjection(dirs) {
  const list = Array.isArray(dirs) ? dirs.filter((d) => d.files && d.files.length) : [];
  if (!list.length) return '';
  const parts = [
    '【dsh-git-push 强制 skill 目录】调用本插件任一工具前，请先按需读取以下目录中的 skill（不全文注入，路径见下）：',
  ];
  for (const d of list) {
    parts.push('');
    parts.push('## ' + d.base + '（' + d.dir + '）');
    parts.push(d.files.map((f) => '- ' + f).join('\n'));
  }
  return parts.join('\n');
}

export function formatRepoSkillInjection(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) return '';
  const parts = [
    '【dsh-git-push 强制 skill】调用本插件任一工具前必须遵守下列两仓文档（插件 agent/pre-step 注入，见开发者文档 dsh-skill-mandatory 方案 A）。',
  ];
  for (const f of list) {
    parts.push('', `## ${f.path}`, '', f.text);
  }
  return parts.join('\n');
}

export function resolveSkillRepoDirs() {
  const dirs = [{ dir: join(PLUGIN_ROOT, 'skills'), base: 'dsh-git-push/skills' }];
  const roots = [];
  if (process.env.DSH_HOME) roots.push(join(process.env.DSH_HOME, '工作区'));
  if (process.env.HOME) roots.push(join(process.env.HOME, '工作区'));
  roots.push(process.cwd());
  for (const root of roots) {
    try {
      const skillsRoot = join(resolve(root), 'ai-work-archive', 'skills');
      if (!existsSync(skillsRoot)) continue;
      dirs.push({ dir: skillsRoot, base: 'ai-work-archive/skills', walk: false, loose: /^git-.*\.md$/i });
      const quality = join(skillsRoot, 'quality-质量', 'git-workflow-gitpush');
      if (existsSync(quality)) dirs.push({ dir: quality, base: 'ai-work-archive/skills/quality-质量/git-workflow-gitpush', walk: true });
      break; // 只取第一个命中的技能仓库根
    } catch { /* 跳过 */ }
  }
  return dirs;
}

/**
 * v1.40.0：开发者要求门禁（B4）——随插件内置 lib/user-requirements.json（归属 EIGHTfs），
 * 原同级仓 requirements.md 废除。可放 <credentialsDir>/requirements.json 覆盖（外挂别人清单）。
 */

export function loadRequirements() {
  const candidates = [
    join(credentialsDir(), 'requirements.json'),
    join(PLUGIN_ROOT, 'lib', 'user-requirements.json'),
    join(PLUGIN_ROOT, 'user-requirements.json'),
  ];
  for (const f of candidates) {
    try {
      if (!f || !existsSync(f)) continue;
      const parsed = JSON.parse(readFileSync(f, 'utf8'));
      const items = Array.isArray(parsed?.items) ? parsed.items.map((x) => String(x).trim()).filter(Boolean) : [];
      if (items.length) {
        return { user: String(parsed.user || '') || 'EIGHTfs', found: true, items, files: [{ file: f, items }] };
      }
    } catch { /* 坏 JSON 换下一来源 */ }
  }
  return { user: 'EIGHTfs', found: false, items: [], files: [] };
}

/**
 * 校验 GitHub token 是否可用（v1.36.2：双副本场景修复的核心）。
 * 调 GET /user 判断 token 有效性；带 60s 内存缓存，避免插件生命周期内重复探测。
 * 网络异常按「无效」处理（false）；调用方在单候选无竞争时不受影响（v1.40.0：候选=插件配置目录单一清单）。
 * 纯本地无 token / 空 token → false（不联网）。
 * @returns {Promise<boolean>}
 */
