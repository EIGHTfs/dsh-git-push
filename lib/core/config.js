/**
 * Git 执行层 · 路径与配置
 *
 * 职责：插件根目录定位（PLUGIN_ROOT）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialsDir } from './credentials.js';

/** 插件根（lib/git/index.js → lib → 插件根；requirements.json 内置清单定位用）。 */
export const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

