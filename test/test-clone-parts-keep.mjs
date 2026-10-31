// 分片保留回归：一轮下载**有失败项时**必须保留 .dsh-parts（下一轮才能 Range 续传）。
//
// 事故背景：clone-download 原先「成功与否都清」分片目录，而 clone.js 明确靠 .dsh-parts
//   跨轮续传大文件——两处设计冲突，导致大文件每轮从 0 重来、永远下不完。
//   实测：1.1GB 大 PNG（6~23MB/个）连跑两轮，失败项 105 → 78 几乎不变，且 .part 每轮归零。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { downloadBlobs, PARTS_DIR } from '../lib/git/clone-download.js';

// 打桩全局 fetch：'bad.png' 只回 5 字节（声明 size=10）→ 长度校验失败、留下半截 .part；
//   其余文件按声明长度返回 → 成功。两个通道（api/raw）都被同一桩接管，故失败是确定性的。
//   返回的字节流固定为 'x'*n（与 blobSha 同源），成功文件的 sha 校验因此真实可过——
//   桩必须与真实校验规则自洽，否则测的就不是「保留/清理」而是「校验必挂」。
function stubFetch() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const fname = decodeURIComponent(u.split('/').pop().split('?')[0]);
    // 内容含文件名首字符 ⇒ 不同 path 得到不同 git sha ⇒ 分片文件名 <sha>.part 不会互相撞车
    const body = fname.includes('bad') ? 'x'.repeat(5) : fname[0] + 'x'.repeat(9);
    return new Response(body, { status: 200 });
  };
  return () => { globalThis.fetch = orig; };
}

// git blob 对象哈希（header 的 \0 按 latin1 单字节，与 clone-download 的增量哈希同口径）
function blobSha(content, size) {
  return createHash('sha1')
    .update(`blob ${size}\u0000`, 'latin1')
    .update(content, 'utf8')
    .digest('hex');
}
const blob = (path, size) => ({ path, size, sha: blobSha(path[0] + 'x'.repeat(9), 10), mode: '100644' });

test('有失败项 → 保留 .dsh-parts 与半截分片（跨轮续传的前提）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-parts-keep-'));
  const restore = stubFetch();
  try {
    const r = await downloadBlobs({
      blobs: [blob('ok.png', 10), blob('bad.png', 10)],
      targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
    });
    assert.equal(r.files, 1, '应有 1 个文件成功');
    assert.equal(r.failed.length, 1, '应有 1 个文件失败');
    const partsDir = join(dir, PARTS_DIR);
    assert.equal(existsSync(partsDir), true, '有失败项时必须保留 .dsh-parts（否则大文件永远从 0 重来）');
    const parts = readdirSync(partsDir).filter((n) => n.endsWith('.part'));
    assert.equal(parts.length, 1, '失败项的 .part 必须留在分片目录里，供下轮 Range 续传');
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('全部成功 → 清理 .dsh-parts（不留空目录残留）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-parts-clean-'));
  const restore = stubFetch();
  try {
    const r = await downloadBlobs({
      blobs: [blob('a.png', 10), blob('b.png', 10)],
      targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 2,
    });
    assert.equal(r.failed.length, 0, '不应有失败项');
    assert.equal(r.files, 2, '两个文件都应成功');
    assert.equal(existsSync(join(dir, PARTS_DIR)), false, '全部成功应清掉分片目录');
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});
