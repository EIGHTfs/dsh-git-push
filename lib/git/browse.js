/**
 * Git 执行层 · 目录浏览（账号卡片「手动指定路径」的路径选择器后端）
 *
 * 对接前端 PathPicker 弹窗：GET /api/git-push/browse?path=<dir> → { path, parent, dirs }。
 * 结构对齐 gamebanana-mods-downloader/server/public/path-picker.js 的 /api/browse 契约。
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * 浏览目录：列出直接子目录 + 上级目录。
 * @param {string} [p] 目标路径（空 = 用 root）
 * @param {object} [opts] { root } 默认根（空 p 且无 root 时用 process.cwd()）
 * @returns {{ok:boolean, path?, parent?, dirs?, error?}}
 */
export function browseDir(p = '', { root = '' } = {}) {
  const raw = String(p || '').trim();
  let start;
  if (!raw) {
    start = root ? resolve(root) : resolve('.');
  } else {
    start = isAbsolute(raw) ? resolve(raw) : resolve(String(root || ''), raw);
  }
  if (!existsSync(start)) return { ok: false, error: `目录不存在: ${start}` };
  let st;
  try { st = statSync(start); } catch { return { ok: false, error: `无法读取: ${start}` }; }
  if (!st.isDirectory()) return { ok: false, error: `不是目录: ${start}` };
  let dirs = [];
  try {
    dirs = readdirSync(start, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } catch { /* 无权限等：返回空列表 */ }
  const parent = start !== '/' ? dirname(start) : null;
  return { ok: true, path: start, parent, dirs };
}
