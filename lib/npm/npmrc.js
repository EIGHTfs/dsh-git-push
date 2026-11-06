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
import { DEFAULT_REGISTRY } from './registry.js';

export const NPMRC_FILE = 'npmrc';

/**
 * 归一化 registry：空串、纯空白、undefined 都回落默认值。
 *
 * 为什么必须有这层：`registry=`（空值）写进 npmrc 后，npm 会在构建 nerf-dart 时
 * 用 `new URL('')` 直接抛 `ERR_INVALID_URL`，所有 npm 子命令全部不可用——
 * 而调用方很容易写成 `registry: cfg?.npmRegistry || ''`（未配置 → 空串），
 * 函数默认值又只在 `undefined` 时生效，于是空串一路穿到底。实测踩过：
 * 撤包工具因此完全跑不起来，报的还是「Invalid URL」这种看不出根因的错。
 */
function effectiveRegistry(registry) {
  const text = String(registry || '').trim();
  return text || DEFAULT_REGISTRY;
}

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
export function npmrcText({ registry = DEFAULT_REGISTRY, token = '' } = {}) {
  const effective = effectiveRegistry(registry);
  const lines = [`registry=${effective}`];
  const t = String(token || '').trim();
  if (t) {
    const prefix = registryAuthPrefix(effective);
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
export function npmArgs({ npmrcFile = '', registry = DEFAULT_REGISTRY } = {}) {
  const args = [];
  if (npmrcFile) args.push('--userconfig', npmrcFile);
  const effective = effectiveRegistry(registry);
  if (effective) args.push('--registry', effective);
  return args;
}
