// 分片保留回归：一轮下载**有失败项时**必须保留 .dsh-parts（下一轮才能 Range 续传）。
//
// 事故背景：clone-download 原先「成功与否都清」分片目录，而 clone.js 明确靠 .dsh-parts
//   跨轮续传大文件——两处设计冲突，导致大文件每轮从 0 重来、永远下不完。
//   实测：1.1GB 大 PNG（6~23MB/个）连跑两轮，失败项 105 → 78 几乎不变，且 .part 每轮归零。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { downloadBlobs, PARTS_DIR } from '../lib/git/clone-download.js';

// 打桩全局 fetch：'bad.png' 只回 5 字节（声明 size=10）→ 长度校验失败、留下半截 .part；
//   其余文件按声明长度返回 → 成功。两个通道（api/raw）都被同一桩接管，故失败是确定性的。
function stubFetch() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('bad.png') ? 'x'.repeat(5) : 'x'.repeat(10);
    return new Response(body, { status: 200 });
  };
  return () => { globalThis.fetch = orig; };
}

const blob = (path, size) => ({ path, size, sha: path.padEnd(40, '0'), mode: '100644' });

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
