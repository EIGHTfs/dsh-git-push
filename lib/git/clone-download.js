/**
 * Git 执行层 · clone 下载器（并发 + 断点续传 + 体积守卫）
 *
 * 为什么单独成文件：clone.js 已承担「解析 target / 目录守卫 / git init / 编排」，
 *   再把并发调度、.part 续传、进度上报、体积过滤塞进去会远超单文件 400 行上限。
 *   本文件只做一件事：把一批 blob **可靠地**落到磁盘，并如实汇报过程与结果。
 *
 * 端点选择（实测结论，2026-09-18）：
 *   api.github.com/.../git/blobs/<sha>   → 忽略 Range（HTTP 200，无 Content-Range，整包重发）
 *   raw.githubusercontent.com/<o>/<r>/<branch>/<path> → 支持 Range（HTTP 206 + Content-Range）
 *   续传**必须**用后者——前者无法从断点续，只能整文件重下。
 *
 * 由此引入的取舍：raw 端点按「分支 + 路径」寻址，不按 sha，而 clone.js 原先特意用
 *   sha 形式规避「推送后 CDN 缓存未刷新拉到旧内容」。续传场景下该风险窗口大幅缩小
 *   （一次 clone 通常分钟级完成），但确实是把确定性换成了概率。缓解手段是 .part
 *   以 sha 命名——sha 变了自然换文件，不会把新旧内容拼成损坏文件。
 */

import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, unlink, chmod, symlink, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

/** 续传分片临时文件所在子目录（相对 clone 目标目录，随目标目录一起被残留清理） */
export const PARTS_DIR = '.dsh-parts';

/** 默认并发数：兼顾吞吐与 GitHub 限流（认证 5000 次/小时，百级请求安全） */
export const DEFAULT_CONCURRENCY = 6;

/** 单文件体积守卫默认阈值（MB）；0 表示不跳过任何文件 */
export const DEFAULT_MAX_FILE_MB = 10;

/**
 * 按体积阈值把 blob 分成「要下载」与「要跳过」两组。
 *
 * 为什么不静默跳过：用户点 clone 的预期是「拿到仓库」。悄悄少文件会让人以为
 *   克隆成功、直到使用时才发现缺东西。故这里只做分组，跳过项由调用方
 *   明确回传给用户界面（预览与结果都展示）。
 * @param {Array<{path:string,size?:number,type?:string}>} blobs tree 中的 blob 列表
 * @param {number} maxFileMB 阈值（MB）；<=0 表示不限制
 * @returns {{download:Array, skipped:Array}} 分组结果
 */
export function partitionBySize(blobs = [], maxFileMB = DEFAULT_MAX_FILE_MB) {
  if (!(maxFileMB > 0)) return { download: blobs.slice(), skipped: [] };
  const limit = maxFileMB * 1024 * 1024;
  const download = [];
  const skipped = [];
  for (const b of blobs) {
    const size = Number(b?.size) || 0;
    if (size > limit) skipped.push({ path: b.path, size, sha: b.sha });
    else download.push(b);
  }
  return { download, skipped };
}

/**
 * 并发下载一批 blob 到目标目录（带 .part 断点续传与进度回调）。
 *
 * 失败**不静默**：每个失败项连同成因进 failed 数组，由调用方决定如何呈现与清理。
 * @param {object} o
 * @param {Array} o.blobs 待下载 blob（tree 条目，需含 path/sha/size/mode）
 * @param {string} o.targetDir 目标目录
 * @param {string} o.owner GitHub owner
 * @param {string} o.repo GitHub repo
 * @param {string} o.branch 分支名（raw 端点寻址用）
 * @param {string} o.token 访问令牌
 * @param {number} [o.concurrency] 并发数
 * @param {(p:object)=>void} [o.onProgress] 进度回调（节流由调用方负责）
 * @returns {Promise<{files:number, failed:Array, modePreserved:boolean}>}
 */
export async function downloadBlobs(o) {
  const {
    blobs = [], targetDir, owner, repo, branch, token,
    concurrency = DEFAULT_CONCURRENCY, onProgress = null,
  } = o;
  const partsDir = join(targetDir, PARTS_DIR);
  const failed = [];
  let done = 0;
  let modePreserved = true;
  // 已传字节数：用于进度条计算（大文件占比高，按字节比按文件数更贴近观感）
  let transferred = 0;
  const totalBytes = blobs.reduce((s, b) => s + (Number(b.size) || 0), 0);

  const emit = () => { if (onProgress) onProgress({ done, total: blobs.length, transferred, totalBytes, failed: failed.length }); };
  emit();

  // 有并发才有必要建 parts 目录；纯小文件仓库不产生额外目录
  if (blobs.length) { try { await mkdir(partsDir, { recursive: true }); } catch { /* 目标不可写会在写文件时暴露 */ } }

  let cursor = 0;
  /**
   * 单个文件下载：先写 .part，成功后 rename 到最终路径。
   * rename 而后置是刻意的——避免「半个文件」出现在最终文件名上被当成完整文件。
   */
  const one = async (entry) => {
    const rel = String(entry.path || '');
    if (!rel) return;
    const out = join(targetDir, rel);
    try { await mkdir(dirname(out), { recursive: true }); } catch { /* 忽略 */ }
    // symlink（mode 120000）：内容即链接目标，raw 端点拿不到，仍走 blob API
    if (entry.mode === '120000') {
      try {
        const linkRes = await fetchBlobJson(owner, repo, entry.sha, token);
        if (linkRes.status !== 200) { failed.push({ path: rel, status: linkRes.status, reason: linkRes.error || `HTTP ${linkRes.status}` }); return; }
        await unlink(out).catch(() => { /* 目标可能不存在（首次写入），忽略即可 */ });
        await symlink(String(linkRes.json?.content ?? linkRes.text ?? ''), out);
        done++; transferred += Number(entry.size) || 0; emit();
      } catch (e) { failed.push({ path: rel, status: -1, reason: `symlink 失败: ${e?.message || e}` }); }
      return;
    }
    const size = Number(entry.size) || 0;
    const partPath = join(partsDir, entry.sha + '.part');
    try {
      const r = await fetchToFile({ owner, repo, branch, relPath: rel, token, out, partPath, size, onBytes: (n) => { transferred += n; emit(); } });
      if (!r.ok) { failed.push({ path: rel, status: r.status, reason: r.reason }); return; }
      // 可执行位保真：CIFS 上 chmod 可能 EPERM，失败只标记不阻断
      if (entry.mode === '100755') {
        try { await chmod(out, 0o755); } catch { modePreserved = false; }
      }
      done++; emit();
    } catch (e) {
      failed.push({ path: rel, status: -1, reason: `写盘失败: ${e?.message || e}` });
    }
  };

  // 并发池：固定 concurrency 个 worker 抢占式领取任务
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= blobs.length) return;
      await one(blobs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, blobs.length || 1)) }, worker));

  // 下载阶段结束即清理分片目录（成功与否都清：失败项的 .part 已无续传价值，
  //   保留反而占空间；下次重试会重新开始，因为无法确认远端是否已变）
  try { await rm(partsDir, { recursive: true, force: true }); } catch { /* 忽略 */ }

  return { files: done, failed, modePreserved };
}

/**
 * 取单个 blob 的 JSON（symlink 内容用；raw 端点返回原始字节，拿不到链接目标）。
 */
async function fetchBlobJson(owner, repo, sha, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`;
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'User-Agent': 'dsh-git-push',
      },
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
    return { status: r.status, json, text };
  } catch (e) { return { status: 0, json: null, text: '', error: String(e?.message || e) }; }
}

/**
 * 下载单个文件到 out（经 .part 中转，支持断点续传）。
 *
 * 续传流程：若 .part 已存在且小于远端大小 → 带 Range 从已有字节处续写；
 *   远端返回 206 则追加，返回 200 说明服务端忽略 Range/文件已变 → 从头覆盖。
 *   .part 以 sha 命名，sha 变了自然换文件，不会把新旧内容拼成损坏文件。
 * @returns {Promise<{ok:boolean,status?:number,reason?:string}>}
 */
async function fetchToFile({ owner, repo, branch, relPath, token, out, partPath, size, onBytes }) {
  let have = 0;
  try { if (existsSync(partPath)) have = statSync(partPath).size; } catch { have = 0; }
  // 已完整则直接用（上次 rename 前中断的情形）
  if (size > 0 && have === size) {
    try { await rename(partPath, out); return { ok: true }; } catch { have = 0; }
  }
  if (size > 0 && have > size) { // 异常：分片比远端还大 → 丢弃重下
    try { await unlink(partPath); } catch { /* 忽略 */ }
    have = 0;
  }

  const encoded = String(relPath).split('/').map(encodeURIComponent).join('/');
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encoded}`;
  const headers = { 'User-Agent': 'dsh-git-push' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (have > 0) headers.Range = `bytes=${have}-`;

  let resp;
  try {
    resp = await fetch(url, { headers });
  } catch (e) {
    return { ok: false, status: 0, reason: `请求失败: ${e?.message || e}` };
  }
  if (resp.status !== 200 && resp.status !== 206) {
    let detail = '';
    try { detail = (await resp.text()).slice(0, 120); } catch { /* 忽略 */ }
    return { ok: false, status: resp.status, reason: `HTTP ${resp.status}${detail ? ': ' + detail : ''}` };
  }
  // 请求了 Range 却回 200：服务端忽略续传（或文件已变）→ 清空重下，避免拼接错位
  const appending = have > 0 && resp.status === 206;
  if (!appending && have > 0) { try { await unlink(partPath); } catch { /* 忽略 */ } }
  try {
    const ws = createWriteStream(partPath, { flags: appending ? 'a' : 'w' });
    const src = Readable.fromWeb(resp.body);
    src.on('data', (c) => { if (onBytes) onBytes(c.length); });
    await pipeline(src, ws);
    // 长度校验：能校验则校验，避免「悄悄写了个残文件」
    if (size > 0) {
      let finalSize = 0;
      try { finalSize = statSync(partPath).size; } catch { finalSize = 0; }
      if (finalSize !== size) {
        return { ok: false, status: resp.status, reason: `长度不符（期望 ${size}，实得 ${finalSize}）` };
      }
    }
    await rename(partPath, out);
    return { ok: true };
  } catch (e) {
    return { ok: false, status: 0, reason: `写入失败: ${e?.message || e}` };
  }
}
