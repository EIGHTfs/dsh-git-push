// dsh-git-push v1.42.0 — 插件根路径常量（自 core.js 按功能拆分，行为零变化）

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // lib/.. → 插件根

/**
 * 从 remote URL 提取 GitHub owner（EIGHTfs/x.git → EIGHTfs）；无 remote 返回 ''。
 */
