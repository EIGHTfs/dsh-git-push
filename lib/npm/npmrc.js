/**
 * npm 凭据文件（npmrc）生成与参数拼装（Step 2/3 共用）。
 *
 * 为什么需要：npm token 存在插件凭据目录的 config.json（0600、不入库），而 npm CLI 只认 npmrc。
 *   ⇒ 调 npm 前把 token「物化」成一份 0600 的**独立** npmrc，用 `--userconfig` 指向它；
 *   绝不写用户的全局 ~/.npmrc、绝不把 token 落进仓库（依据 skill npm-publish-checklist 第 11 项）。
 */
import { join } from 'node:path';

import { credentialsDir } from '../core/credentials.js';
import { writeTextAtomic } from '../core/atomic-json.js';

export const NPMRC_FILE = 'npmrc';

/** 按 registry 推导 authToken 行前缀：`//host/path/`（用于 `//host/:_authToken=…`）。 */
export function registryAuthPrefix(registry = '') {
  try {
    const u = new URL(String(registry));
    return `//${u.host}${u.pathname.replace(/\/?$/, '/')}`;
  } catch {
    return '';
  }
}

/** 生成 npmrc 文本（纯函数，便于测试）：registry 行 +（有 token 时）authToken 行。 */
export function npmrcText({ registry = 'https://registry.npmjs.org/', token = '' } = {}) {
  const lines = [`registry=${registry}`];
  const t = String(token || '').trim();
  if (t) {
    const prefix = registryAuthPrefix(registry);
    if (prefix) lines.push(`${prefix}:_authToken=${t}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 物化 npmrc（0600）到凭据目录；返回文件路径。token 为空也写（只含 registry 行）。
 * @returns {{ok:boolean, file?:string, error?:string}}
 */
export function writeNpmrc({ workspaceRoot = '', registry = 'https://registry.npmjs.org/', token = '' } = {}) {
  try {
    const file = join(credentialsDir({ workspaceRoot }), NPMRC_FILE);
    writeTextAtomic(file, npmrcText({ registry, token }), { mode: 0o600 });
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e?.message || 'npmrc 写入失败' };
  }
}

/** 拼 npm 全局参数：统一走我们的 npmrc + 显式 registry（不改用户全局配置）。 */
export function npmArgs({ npmrcFile = '', registry = 'https://registry.npmjs.org/' } = {}) {
  const args = [];
  if (npmrcFile) args.push('--userconfig', npmrcFile);
  if (registry) args.push('--registry', registry);
  return args;
}
