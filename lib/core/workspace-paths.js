/**
 * 核心层 · AI 自设工作区路径（数组，多个）
 *
 * 背景：环境注入里的「当前工作目录 cwd」原先取自**会话文件**（agent.session.header.cwd）。
 *   实测问题：会话 header 里存的可能是**陈旧路径**（本机实测注入出 `…/0.1.6-alpha.1/工作区/dsh-git-push`，
 *   而真实工作区在 `…/VirtualDSM/DeepSeekHarness/工作区/dsh-git-push`）⇒ 注入反而误导 ✗。
 *
 * 设计：让 **AI 自己**登记真实工作区路径（可多个），注入时优先显示这份自设清单
 *   ⇒ AI 每轮看到的都是自己设的那份（这就是「自己提醒自己」的实际作用，不需要额外机制）。
 *
 * 存放：<配置目录>/workspace-paths.json（结构化列表用 JSON 承载，不走 env；配置目录见 credentialsDir()）
 *   { "paths": ["<绝对路径>", …], "updatedAt": "ISO", "updatedBy": "ai" | "user" }
 *
 * 校验口径（宁缺毋滥，避免把错路径写进去再误导自己）：
 *   · 只收**绝对路径**（相对路径没有稳定基准 ✗）
 *   · 必须**存在且是目录**
 *   · 去重（同一路径只留一次）+ 上限 20 条
 *   · 写入原子化（先写临时文件再 rename），坏 JSON 读取时降级为空清单
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { credentialsDir } from './credentials.js';

/** 自设路径上限（注入要短，太多会挤占上下文）。 */
export const MAX_WORKSPACE_PATHS = 20;

/** 自设路径状态文件路径。 */
export function workspacePathsFile() {
  return join(credentialsDir(), 'workspace-paths.json');
}

/**
 * 读自设工作区路径。
 * @returns {{paths: string[], updatedAt: string, updatedBy: string}} 读不到/坏 JSON ⇒ 空清单（不抛错）
 */
export function loadWorkspacePaths() {
  const empty = { paths: [], updatedAt: '', updatedBy: '' };
  try {
    const f = workspacePathsFile();
    if (!existsSync(f)) return empty;
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const paths = Array.isArray(j?.paths) ? j.paths.map((x) => String(x || '').trim()).filter(Boolean) : [];
    return { paths, updatedAt: String(j?.updatedAt || ''), updatedBy: String(j?.updatedBy || '') };
  } catch {
    return empty;
  }
}

/**
 * 写自设工作区路径（带校验）。
 * @param {string[]} paths 待写入的路径数组（绝对路径）
 * @param {{by?: string}} [opts] by: 写入方标识（'ai' / 'user'），默认 'ai'
 * @returns {{ok: boolean, paths: string[], rejected: Array<{path: string, reason: string}>, file: string}}
 */
export function saveWorkspacePaths(paths, { by = 'ai' } = {}) {
  const rejected = [];
  const kept = [];
  for (const raw of Array.isArray(paths) ? paths : []) {
    const p = String(raw || '').trim();
    if (!p) continue;
    if (!isAbsolute(p)) { rejected.push({ path: p, reason: '不是绝对路径' }); continue; }
    const abs = resolve(p);
    let ok = false;
    try { ok = statSync(abs).isDirectory(); } catch { ok = false; }
    if (!ok) { rejected.push({ path: p, reason: '不存在或不是目录' }); continue; }
    if (!kept.includes(abs)) kept.push(abs);
  }
  const over = kept.splice(MAX_WORKSPACE_PATHS);
  for (const p of over) rejected.push({ path: p, reason: `超过上限 ${MAX_WORKSPACE_PATHS} 条` });

  const file = workspacePathsFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ paths: kept, updatedAt: new Date().toISOString(), updatedBy: String(by || 'ai') }, null, 2) + '\n', 'utf8');
    renameSync(tmp, file); // 原子替换：避免读到半截 JSON
  } catch (e) {
    return { ok: false, paths: kept, rejected: [...rejected, { path: file, reason: `写入失败：${e?.message || e}` }], file };
  }
  return { ok: true, paths: kept, rejected, file };
}

/**
 * 生成注入用的「AI 自设工作区」文本块（无自设时返回 ''）。
 *
 * 措辞要点（缺一不可）：
 *   ① 明确这是 **AI 自己维护**的位置清单（不是宿主探测）——**维护责任在 AI**：
 *      工作区挪了/改名了/开始处理另一个目录，AI 自己要更新，否则下一轮看到的还是旧清单 ✗
 *   ② 给出修改入口（同一个 API）与读回方式，让下一轮的自己知道怎么改 ✓
 *   ③ 说明优先级：高于会话 cwd（会话 header 本身可能是陈旧路径）
 * @param {string} [sep] 行分隔符（默认换行）
 * @returns {string} 多行文本；无自设 ⇒ ''
 */
export function workspacePathsInjectionText(sep = '\n') {
  const { paths, updatedAt, updatedBy } = loadWorkspacePaths();
  if (!paths.length) return '';
  const L = [`【AI 自设工作区（${paths.length} 个 · 由 ${updatedBy || 'ai'} 于 ${String(updatedAt).slice(0, 16) || '未知时间'} 登记）】`];
  paths.forEach((p, i) => L.push(`- ${i + 1}. ${p}`));
  L.push('⚠️ 这是**由你（AI）自己维护**的工作区位置清单——不是宿主探测出来的：'
    + '工作区被移动/改名、或你开始处理另一个目录时，**你要主动更新它**，'
    + '否则下一轮你看到的仍是这份旧清单（下方会话 cwd 可能本身就是陈旧路径 ✗）。');
  L.push('维护方式（同一端点按方法分发）：'
    + "改/加/删 —— git_api({path:'workspace-paths', method:'POST', body:'{\"paths\":[\"<绝对路径>\", …]}'})"
    + '（可选 "mode":"add"｜"remove"；{"clear":true} 清空）；'
    + "读回 —— git_api({path:'workspace-paths'})"
    + '。只收绝对路径、必须存在且是目录，上限 20 条。');
  return L.join(sep);
}
