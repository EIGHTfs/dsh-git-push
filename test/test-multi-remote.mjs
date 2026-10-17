/** 多 remote（fork 场景）回归：remote 目标解析——离线可跑，不依赖 SSH/网络。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveRemoteTarget } from '../lib/git/transport.js';

/** 建临时仓库：origin=上游（https）、fork=自己的（ssh:443）。 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-multi-remote-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.name', 't']);
  git(['config', 'user.email', 't@example.invalid']);
  git(['remote', 'add', 'origin', 'https://github.com/upstream/proj.git']);
  git(['remote', 'add', 'fork', 'ssh://git@ssh.github.com:443/me/proj.git']);
  return dir;
}

test('resolveRemoteTarget：解析指定 remote（ssh:443 形态）', () => {
  const dir = makeRepo();
  try {
    const r = resolveRemoteTarget(dir, 'fork');
    assert.equal(r.owner, 'me');
    assert.equal(r.repo, 'proj');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolveRemoteTarget：https 形态同样解析', () => {
  const dir = makeRepo();
  try {
    const r = resolveRemoteTarget(dir, 'origin');
    assert.equal(r.owner, 'upstream');
    assert.equal(r.repo, 'proj');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resolveRemoteTarget：remote 不存在 → null', () => {
  const dir = makeRepo();
  try {
    assert.equal(resolveRemoteTarget(dir, 'nope'), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
