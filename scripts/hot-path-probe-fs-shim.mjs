/**
 * node:fs 计数 shim（配合 scripts/hot-path-probe.mjs 的 loader 钩子）。
 *
 * ⚠️ 本文件**只负责 `node:fs`**：`node:fs/promises` 由 hot-path-probe-fsp-shim.mjs 负责。
 *   两者必须分开——两个 builtin 的导出面重叠但不同（如 `access`），
 *   若把两个 `export *` 塞进同一模块会触发 **conflicting star exports** 语法错误
 *   （实测：真实审计因此崩掉，本注释即该事故的记录）。
 *
 * 做法：`export *` 透传全部导出（避免漏导出导致运行时报错），
 *   再对需计数的少数函数用显式导出**遮蔽**（ESM 里显式导出优先于 star 导出）。
 */

import * as fs from 'node:fs';

const HP = (globalThis.__HOT_PATH_PROBE__ ||= { fn: {}, fs: {} });
const hit = (name) => { HP.fs[name] = (HP.fs[name] || 0) + 1; };
/** 包一层：先计数再转发（保留 this 与返回值语义）。 */
const wrap = (mod, name) => (...a) => { hit(name); return mod[name](...a); };

export * from 'node:fs';
export const existsSync = wrap(fs, 'existsSync');
export const readFileSync = wrap(fs, 'readFileSync');
export const statSync = wrap(fs, 'statSync');
export const lstatSync = wrap(fs, 'lstatSync');
export const readdirSync = wrap(fs, 'readdirSync');
export const writeFileSync = wrap(fs, 'writeFileSync');
export const mkdirSync = wrap(fs, 'mkdirSync');
export const realpathSync = wrap(fs, 'realpathSync');
