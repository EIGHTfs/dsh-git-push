/**
 * 统一 JSON 文件原子读写（2026-09-16 收敛：多处重复的「读 JSON → 改 → 原子写回」抽成一份）。
 *
 * 消费方（原各自实现）：settings-bridge（config.json）、account-status（account-status.json）、
 *   scan-runner（scan-live.json）、repo-index（dsh-repo-index.json）、credentials 等。
 *
 * 原子写语义：写同目录 `.tmp` 再 rename（同卷原子替换，避免写一半崩溃留坏文件）；
 *   CIFS 可能改不了 mode，chmod 失败静默（与各原实现一致）。
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 读 JSON 文件：缺失 / 损坏 / 非对象 → null（不抛）。
 * @param {string} file 绝对路径
 * @returns {object|null}
 */
export function readJson(file) {
  try {
    if (!file || !existsSync(file)) return null;
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 读任意 JSON 值（数组/标量也允许；缺失/损坏返回 undefined）。
 * @param {string} file 绝对路径
 * @returns {unknown}
 */
export function readJsonAny(file) {
  try {
    if (!file || !existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * 原子写 JSON 文件（先 .tmp 后 rename）。
 * @param {string} file 目标绝对路径
 * @param {unknown} data 任意 JSON 可序列化值
 * @param {{mode?:number, pretty?:boolean}} [opts] mode 默认 0o600；pretty 默认 true（2 空格缩进 + 换行）
 * @returns {{ok:boolean, file:string, error?:string}}
 */
export function writeJsonAtomic(file, data, { mode = 0o600, pretty = true } = {}) {
  try {
    if (!file) return { ok: false, file: '', error: '路径为空' };
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
    const content = pretty ? JSON.stringify(data, null, 2) + '\n' : JSON.stringify(data);
    const tmpPath = `${file}.${process.pid}.tmp`;
    writeFileSync(tmpPath, content, { encoding: 'utf8', mode });
    try { chmodSync(tmpPath, mode); } catch { /* CIFS 可能改不了 mode，静默 */ }
    renameSync(tmpPath, file);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, file, error: String(e?.message || e) };
  }
}

/**
 * 读-改-写一步到位：读取（缺失返回空对象）→ 应用 updater → 原子写回。
 * @param {string} file 目标绝对路径
 * @param {(cur: object) => object} updater 输入当前对象，返回新对象
 * @param {{mode?:number}} [opts]
 * @returns {{ok:boolean, file:string, error?:string}}
 */
export function updateJsonAtomic(file, updater, { mode = 0o600 } = {}) {
  const cur = readJson(file) || {};
  const next = updater(cur);
  return writeJsonAtomic(file, next, { mode });
}

/**
 * 原子写**已序列化文本**（调用方已生成 JSON 字符串 / 非 JSON 文本），.tmp + rename。
 * 供 syncRepoIndex 等「内容是字符串」的写入收敛用。
 * @param {string} file 目标绝对路径
 * @param {string} text 已序列化内容
 * @param {{mode?:number}} [opts] mode 默认 0o600
 * @returns {{ok:boolean, file:string, error?:string}}
 */
export function writeTextAtomic(file, text, { mode = 0o600 } = {}) {
  try {
    if (!file) return { ok: false, file: '', error: '路径为空' };
    mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
    const tmpPath = `${file}.${process.pid}.tmp`;
    writeFileSync(tmpPath, String(text ?? ''), { encoding: 'utf8', mode });
    try { chmodSync(tmpPath, mode); } catch { /* CIFS 可能改不了 mode，静默 */ }
    renameSync(tmpPath, file);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, file, error: String(e?.message || e) };
  }
}
