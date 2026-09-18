/**
 * 文件系统适配层 —— 兼容不支持元数据操作的挂载（CIFS/SMB 网络共享）。
 *
 * 背景（实测于 Synology NAS 挂载 Windows 共享的工作区）：
 *   挂载参数含 `nounix,forceuid,forcegid,file_mode=0777,dir_mode=0777`，
 *   SMB3 服务端（Windows 类实现）不声明 POSIX Extensions，故：
 *     ✓ 纯数据操作：writeFile / readFile / mkdir / readdir / rename / unlink
 *     ✗ 元数据操作：chmod / chown / utimes  →  EPERM（errno=-1，内核本地拒绝）
 *     ✗ 服务端复制：copyFile（目标在 CIFS 内）→  EPERM
 *   `nounix` 不是可关闭的开关：SMB1 的 UNIX Extensions 已被 SMB2/3 的
 *   POSIX Extensions 取代，而服务端不支持协商，去掉该参数仍会回落同样行为。
 *
 * 本模块的作用：把「在 CIFS 上会失败、但失败不影响正确性」的操作统一收口，
 *   让调用方无需每处手写 try/catch，也避免漏写导致整个同步流程抛错中断。
 */

import { chmodSync, copyFileSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 复制文件：优先 copyFileSync，遇 EPERM/ENOTSUP 回退到读写复制。
 *
 * copyFileSync 在 CIFS 上尝试服务端复制（SMB copychunk）会 EPERM；
 *   回退的 readFile+writeFile 是纯数据通道，实测可用。
 * @param {string} from 源路径
 * @param {string} to 目标路径
 * @param {object} [opts] { encoding } 缺省 utf8；传 'buffer' 走二进制
 * @returns {{ok: boolean, via: string, error?: string}}
 */
export function copyFileCompat(from, to, opts = {}) {
  try {
    copyFileSync(from, to);
    return { ok: true, via: 'copyFileSync' };
  } catch (e) {
    if (e?.code !== 'EPERM' && e?.code !== 'ENOTSUP' && e?.code !== 'EOPNOTSUPP') {
      return { ok: false, via: 'copyFileSync', error: `${e?.code || 'ERR'}: ${e?.message || e}` };
    }
    // 回退：纯数据读写（CIFS 上可用）
    try {
      const data = opts.encoding === 'buffer' ? readFileSync(from) : readFileSync(from, 'utf8');
      if (opts.encoding === 'buffer') writeFileSync(to, data);
      else writeFileSync(to, data, 'utf8');
      return { ok: true, via: 'readFile+writeFile' };
    } catch (e2) {
      return { ok: false, via: 'readFile+writeFile', error: `${e2?.code || 'ERR'}: ${e2?.message || e2}` };
    }
  }
}

/**
 * 尽力设置文件权限；失败静默返回 false。
 *   CIFS（nounix）上 chmod 必然 EPERM —— 权限由挂载参数统一决定
 *   （forceuid/forcegid/file_mode），调用方不应把失败当错误。
 * @returns {boolean} 是否真的设置成功
 */
export function chmodBestEffort(fn, mode) {
  try {
    fn(mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * 目标目录所在的文件系统是否支持元数据操作（chmod/utimes）。
 *   用于把「可执行位保真」这类能力降级写进结果，而不是静默失效。
 *
 * 判定方式：在目标目录内**建临时文件**再 chmod —— 不能直接探测目录本身：
 *   /tmp 这类带 sticky bit 的目录 chmod 会 EPERM，但其内文件完全正常，
 *   直接探测目录会把「支持元数据」误判为 false。
 * @param {string} dirPath 一个已存在的目录（通常是被写入的目标目录）
 * @returns {boolean}
 */
export function supportsMetadata(dirPath) {
  const probe = join(dirPath, `.fsx-probe-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(probe, '');
    const st = statSync(probe);
    chmodSync(probe, st.mode & 0o777);
    return true;
  } catch {
    return false;
  } finally {
    try { unlinkSync(probe); } catch { /* 清理失败不影响判定 */ }
  }
}
