/**
 * node:fs/promises 计数 shim（与 hot-path-probe-fs-shim.mjs 成对；两者必须分开）。
 *
 * 【为什么不能合成一个】`node:fs` 与 `node:fs/promises` 的导出面**重叠但不同**
 *   （如 `access` 在两处都存在）⇒ 若把两个 `export *` 放进同一模块，
 *   会出现 **conflicting star exports** 直接报语法错误（实测：真实审计因此崩掉）。
 *
 * 做法同 fs shim：`export *` 透传全部导出（避免漏导出导致运行时报错），
 *   再对需计数的少数函数用显式导出**遮蔽**。
 */

import * as fsp from 'node:fs/promises';

const HP = (globalThis.__HOT_PATH_PROBE__ ||= { fn: {}, fs: {} });
const hit = (name) => { HP.fs[name] = (HP.fs[name] || 0) + 1; };
/** 包一层：先计数再转发（保留 this 与返回值语义）。 */
const wrap = (mod, name) => (...a) => { hit(name); return mod[name](...a); };

export * from 'node:fs/promises';
export const readFile = wrap(fsp, 'readFile');
export const writeFile = wrap(fsp, 'writeFile');
export const readdir = wrap(fsp, 'readdir');
export const stat = wrap(fsp, 'stat');
export const mkdir = wrap(fsp, 'mkdir');
export const rename = wrap(fsp, 'rename');
export const unlink = wrap(fsp, 'unlink');
export const rm = wrap(fsp, 'rm');
export const access = wrap(fsp, 'access');
export const symlink = wrap(fsp, 'symlink');
export const chmod = wrap(fsp, 'chmod');
export const rmdir = wrap(fsp, 'rmdir');
