/**
 * 「推送到 GitHub 时自动指定正确的 remote」回归测试。
 *
 * 四种仓库形态（都是真实临时 git 仓，不依赖网络）：
 *   ① 只有 origin=https ⇒ 自动改成 ssh:443（本机实测可用形态），仍用 origin
 *   ② origin 指向别人的仓库 ⇒ **不动它**，新建 github-ssh 专用 remote
 *   ③ origin + github-ssh 并存（都指向目标）⇒ 选 origin（名字优先）且无需改址
 *   ④ 完全没有 remote ⇒ 新建 github-ssh
 * 另测：dryRun 只报告不写盘；非 GitHub remote（内网 gitlab）不参与判定。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveGithubRemote, parseGithubUrl, ssh443Url } from '../lib/git/remote-resolve.js';

const OWNER = 'EIGHTfs';
const REPO = 'dsh-git-push';
const SSH443 = ssh443Url(OWNER, REPO);

/** 建一个真实临时 git 仓（无提交，只挂 remote 即可测解析）。 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-remote-resolve-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}
function addRemote(dir, name, url) {
  execFileSync('git', ['remote', 'add', name, url], { cwd: dir });
}
function getUrl(dir, name) {
  try {
    return execFileSync('git', ['remote', 'get-url', name], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

test('URL 解析：四种写法都能认出 owner/repo 与形态', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/EIGHTfs/dsh-git-push.git'), { owner: 'EIGHTfs', repo: 'dsh-git-push', form: 'https' });
  assert.deepEqual(parseGithubUrl('git@github.com:EIGHTfs/dsh-git-push.git'), { owner: 'EIGHTfs', repo: 'dsh-git-push', form: 'scp' });
  assert.deepEqual(parseGithubUrl('ssh://git@ssh.github.com:443/EIGHTfs/dsh-git-push.git'), { owner: 'EIGHTfs', repo: 'dsh-git-push', form: 'ssh443' });
  assert.equal(parseGithubUrl('git@gitlab.internal:team/proj.git'), null);
});

test('形态①：只有 origin=https ⇒ 自动改址为 ssh:443，仍用 origin', () => {
  const dir = makeRepo();
  addRemote(dir, 'origin', 'https://github.com/EIGHTfs/dsh-git-push.git');
  const r = resolveGithubRemote({ repoPath: dir, owner: OWNER, repo: REPO });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.equal(r.remote, 'origin');
  assert.equal(r.action, 'fixed');
  assert.equal(r.url, SSH443);
  assert.equal(getUrl(dir, 'origin'), SSH443, '实际写盘应已改为 ssh:443');
});

test('形态②：origin 归属不符 ⇒ 不动它，另建 github-ssh', () => {
  const dir = makeRepo();
  addRemote(dir, 'origin', 'https://github.com/someone-else/their-repo.git');
  const r = resolveGithubRemote({ repoPath: dir, owner: OWNER, repo: REPO });
  assert.equal(r.remote, 'github-ssh');
  assert.equal(r.action, 'added');
  assert.equal(getUrl(dir, 'github-ssh'), SSH443);
  assert.equal(getUrl(dir, 'origin'), 'https://github.com/someone-else/their-repo.git', '别人的 origin 一个字节都不该动');
});

test('形态③：origin + github-ssh 并存且都指向目标 ⇒ 优先已可用形态（不起无谓改动）', () => {
  const dir = makeRepo();
  addRemote(dir, 'github-ssh', SSH443);
  addRemote(dir, 'origin', 'https://github.com/EIGHTfs/dsh-git-push.git');
  const r = resolveGithubRemote({ repoPath: dir, owner: OWNER, repo: REPO });
  // 设计口径：同仓库多 remote 时，优先「已经可用（ssh:443）且名字规范」的那个 —— 少改一次就少一个副作用；
  //   名字优先级只在**同等可用**的候选之间起作用（此时 github-ssh 已可用，故选中它、action=keep）。
  assert.equal(r.remote, 'github-ssh', 'ssh:443 已可用 ⇒ 选它，不为名字偏好去改一个本来能用的 remote');
  assert.equal(r.action, 'keep');
  assert.equal(r.url, SSH443);
  assert.equal(getUrl(dir, 'origin'), 'https://github.com/EIGHTfs/dsh-git-push.git', '未选中的 remote 不应被改动');
});

test('形态③b：两个都指向目标但都没用 ssh:443 ⇒ 选 origin 并改址', () => {
  const dir = makeRepo();
  addRemote(dir, 'github-ssh', 'https://github.com/EIGHTfs/dsh-git-push.git');
  addRemote(dir, 'origin', 'https://github.com/EIGHTfs/dsh-git-push.git');
  const r = resolveGithubRemote({ repoPath: dir, owner: OWNER, repo: REPO });
  assert.equal(r.remote, 'origin', '同等可用时名字优先：origin > github-ssh');
  assert.equal(r.action, 'fixed');
  assert.equal(getUrl(dir, 'origin'), SSH443);
});

test('形态④：完全没有 remote ⇒ 新建 github-ssh', () => {
  const dir = makeRepo();
  const r = resolveGithubRemote({ repoPath: dir, owner: OWNER, repo: REPO });
  assert.equal(r.ok, true);
  assert.equal(r.remote, 'github-ssh');
  assert.equal(r.action, 'added');
  assert.equal(getUrl(dir, 'github-ssh'), SSH443);
});

test('dryRun：只报告，不写盘（remote 保持原样）', () => {
  const dir = makeRepo();
  addRemote(dir, 'origin', 'https://github.com/EIGHTfs/dsh-git-push.git');
  const r = resolveGithubRemote({ repoPath: dir, owner: OWNER, repo: REPO, dryRun: true });
  assert.equal(r.action, 'fixed');
  assert.match(r.reasons.join(' '), /dryRun 未写盘/);
  assert.equal(getUrl(dir, 'origin'), 'https://github.com/EIGHTfs/dsh-git-push.git', 'dryRun 不得改 remote');
});

test('非 GitHub remote（内网 gitlab）不参与判定', () => {
  const dir = makeRepo();
  addRemote(dir, 'origin', 'git@gitlab.internal:team/proj.git');
  const r = resolveGithubRemote({ repoPath: dir, owner: OWNER, repo: REPO });
  assert.equal(r.remote, 'github-ssh', '既有 origin 非 GitHub ⇒ 不选它，另建 github-ssh');
  assert.equal(getUrl(dir, 'origin'), 'git@gitlab.internal:team/proj.git', '内网 remote 不动');
  assert.equal(getUrl(dir, 'github-ssh'), SSH443);
});

test('本仓库实况：解析应命中既有 remote（ssh 形态 keep / https 形态修复）', () => {
  const root = join(import.meta.dirname, '..');
  const r = resolveGithubRemote({ repoPath: root, owner: OWNER, repo: REPO });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  // 本地 remote 已是 ssh:443 → keep；CI checkout 默认 https → 应修复为 ssh:443（fixed）。
  //   两种都是正确行为，不能硬断言 keep（否则换环境即失败）。
  assert.ok(r.action === 'keep' || r.action === 'fixed', `应 keep 或 fixed（实得 ${r.action}：${r.reasons.join('；')}）`);
  assert.equal(r.url, SSH443);
});
