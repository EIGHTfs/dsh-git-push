/**
 * Git 执行层 · 路径与配置
 *
 * 职责：插件根目录定位（PLUGIN_ROOT）与开发者要求清单读取（loadRequirements）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialsDir } from './credentials.js';

/** 插件根（lib/git/index.js → lib → 插件根；requirements.json 内置清单定位用）。 */
export const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * 开发者特殊要求清单（D13）：
 * 三来源依次尝试（首个有效即返回）：
 *   1) credentialsDir()/requirements.json（用户外挂）
 *   2) PLUGIN_ROOT/lib/user-requirements.json（内置默认清单）
 *   3) PLUGIN_ROOT/user-requirements.json
 * 返回 { user, found, items, files }；无清单时 found:false（门禁放行）。
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
        return { user: String(parsed.user || '') || '默认开发者', found: true, items, files: [{ file: f, items }] };
      }
    } catch { /* 坏 JSON 换下一来源 */ }
  }
  return { user: '默认开发者', found: false, items: [], files: [] };
}
