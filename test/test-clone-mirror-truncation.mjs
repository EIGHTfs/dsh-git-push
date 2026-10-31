/**
 * 镜像坏缓存（截断响应）防御回归（2026-10-31 实测事故）。
 *
 * 事故：某镜像对一个 8MB 文件返回 total=590454 的截断资源（content-range 尾段），
 *   带 Range 续传时每轮「已到该源 total、无法增长」⇒ 长度校验永远失败、
 *   分片停在半截、clone 每轮死在同一文件（用户判定「没有续传」，实际是续传被坏镜像卡死）。
 *
 * 锁三件事：
 *   ① 坏镜像的截断字节**绝不能写进 .part**（脏数据拼接永远凑不出正确文件）；
 *   ② 声明总长与仓库记录不符 ⇒ 自动换候选通道（api 直连） rescue 成功；
 *   ③ 所有通道都异常 ⇒ 本轮判失败但分片保留（下轮重试），不是无限静默循环。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { downloadBlobs, PARTS_DIR } from '../lib/git/clone-download.js';

const SIZE = 10000;          // 仓库记录的期望大小
const TRUNC = 5904;          // 坏镜像声明的（截断）总长
/** 按 URL 判定通道并返回可控响应：raw=坏镜像（total 截断），api=正常全量。 */
function stubChannels({ rawBroken = true, apiBroken = false } = {}) {
  const orig = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    seen.push({ u, range: opts?.headers?.Range || null });
    const isRaw = u.includes('raw.githubusercontent.com');
    if (isRaw && rawBroken) {
      // 206（带 Range 续传请求时）/ 200（无 Range）：该源声明 total 恒为截断值
      const rangeReq = Boolean(opts?.headers?.Range);
      const body = 'x'.repeat(TRUNC - 100);
      return new Response(rangeReq ? Buffer.from(body.slice(100)) : body, {
        status: rangeReq ? 206 : 200,
        headers: rangeReq
          ? { 'content-range': `bytes 100-${TRUNC - 1}/${TRUNC}` }
          : { 'content-length': String(TRUNC - 100) }, // 声明值仍 < SIZE，触发防御
      });
    }
    if (isRaw) { // raw 正常：全量
      return new Response('r'.repeat(SIZE), { status: 200 });
    }
    if (apiBroken) { // api 也坏：total 同样对不上
      return new Response('a'.repeat(TRUNC), { status: 200, headers: { 'content-length': String(TRUNC) } });
    }
    return new Response(API_CONTENT, { status: 200 }); // api 正常：完整内容
  };
  return { restore: () => { globalThis.fetch = orig; }, seen };
}

// git blob 哈希（与 clone-download 增量校验同口径）：桩内容必须算得出匹配 sha，
//   否则测到的是「sha 校验必挂」而不是 rescue 路径本身
function blobSha(content, size) {
  return createHash('sha1').update(`blob ${size}\u0000`, 'latin1').update(content, 'utf8').digest('hex');
}
const API_CONTENT = 'A'.repeat(SIZE);                       // api 通道的完整内容
const RAW_SUFFIX = 'r'.repeat(SIZE - 3300);                  // raw 续传通道返回的部分
const blob = { path: 'big.json', size: SIZE, sha: blobSha(API_CONTENT, SIZE), mode: '100644' };

function newDir() { return mkdtempSync(join(tmpdir(), 'dshgp-trunc-')); }
function partOf(dir) { return join(dir, PARTS_DIR, `${blob.sha}.part`); }

test('分片已有半截 + 镜像截断 → 自动退 api 通道完成，内容全部来自 api（脏字节不拼接）', async () => {
  const dir = newDir();
  const { restore, seen } = stubChannels();
  try {
    mkdirSync(join(dir, PARTS_DIR), { recursive: true });
    writeFileSync(partOf(dir), 'x'.repeat(3300)); // 模拟上轮残留（脏半截）
    const r = await downloadBlobs({
      blobs: [blob], targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
    });
    assert.equal(r.failed.length, 0, `应经 api 通道 rescue 成功：${JSON.stringify(r.failed)}`);
    const got = readFileSync(join(dir, 'big.json'), 'utf8');
    assert.equal(got.length, SIZE);
    assert.match(got, /^A+$/, '内容必须全部来自 api 通道——坏镜像的 x 字节混进来就是脏文件');
    const rawReq = seen.find((s) => s.u.includes('raw.githubusercontent.com'));
    assert.ok(rawReq, '先试过 raw（have>0 优先 Range 续传）');
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('无分片起步 + 镜像截断 → api rescue 成功，.part 不落入截断字节', async () => {
  const dir = newDir();
  const { restore } = stubChannels();
  try {
    const r = await downloadBlobs({
      blobs: [blob], targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
    });
    assert.equal(r.failed.length, 0, `应 rescue 成功：${JSON.stringify(r.failed)}`);
    assert.match(readFileSync(join(dir, 'big.json'), 'utf8'), /^A+$/);
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('所有通道都截断 → 本轮判失败，错误点明「疑似代理截断缓存」，半截分片保留未污染', async () => {
  const dir = newDir();
  const { restore } = stubChannels({ apiBroken: true });
  try {
    mkdirSync(join(dir, PARTS_DIR), { recursive: true });
    writeFileSync(partOf(dir), 'x'.repeat(3300));
    const r = await downloadBlobs({
      blobs: [blob], targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
    });
    assert.equal(r.failed.length, 1, '两通道 total 都不符 → 必须报失败（不能假成功）');
    assert.match(r.failed[0].reason, /截断|数据异常/, `错误要能指根因：${r.failed[0].reason}`);
    assert.equal(existsSync(partOf(dir)), true, '分片保留供下轮重试');
    assert.equal(readFileSync(partOf(dir), 'utf8').length, 3300, '分片字节数不变 = 截断内容没被拼进去');
  } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
});

test('镜像正常（total 相符）→ 走 raw 续传路径不受本次改动影响', async () => {
  const dir = newDir();
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const rangeReq = Boolean(opts?.headers?.Range);
    if (String(url).includes('raw.githubusercontent.com')) {
      return new Response(RAW_SUFFIX, {
        status: rangeReq ? 206 : 200,
        headers: { 'content-range': `bytes 3300-${SIZE - 1}/${SIZE}` },
      });
    }
    return new Response('A'.repeat(SIZE), { status: 200 });
  };
  try {
    mkdirSync(join(dir, PARTS_DIR), { recursive: true });
    const joined = 'x'.repeat(3300) + RAW_SUFFIX;
    const shaJoined = blobSha(joined, SIZE);
    // 分片文件名是 <entry.sha>.part —— 预置前缀必须落在实际传入的那个 sha 上
    writeFileSync(join(dir, PARTS_DIR, `${shaJoined}.part`), 'x'.repeat(3300)); // 半截是真·前缀，拼接后恰等于预期内容
    const r = await downloadBlobs({
      blobs: [{ ...blob, sha: shaJoined }], targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
    });
    assert.equal(r.failed.length, 0, `total 相符应照常续传成功：${JSON.stringify(r.failed)}`);
    assert.equal(readFileSync(join(dir, 'big.json'), 'utf8').length, SIZE, '续传拼接后长度正确');
  } finally { globalThis.fetch = orig; rmSync(dir, { recursive: true, force: true }); }
});
