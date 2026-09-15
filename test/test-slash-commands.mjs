/**
 * /git-audit 斜杠命令：参数解析 + 会话 cwd 默认 + 非 git 拒绝 + 文本格式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  parseGitAuditInput,
  sessionCwdOf,
  findGitRoot,
  resolveAuditRepo,
  formatGitAuditCommandText,
  runGitAuditCommand,
  registerSlashCommands,
} from '../lib/app/slash-commands.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function inv(cwd) {
  return { agent: { session: { header: cwd == null ? {} : { cwd } } } };
}

test('parseGitAuditInput：空输入 = 默认 diff、无路径', () => {
  const p = parseGitAuditInput('');
  assert.equal(p.path, '');
  assert.equal(p.scope, 'diff');
  assert.equal(p.auditLevel, undefined);
  assert.equal(p.error, undefined);
});

test('parseGitAuditInput：路径 + --full + --quick', () => {
  const p = parseGitAuditInput('工作区/dsh-git-push-v2 --full --quick');
  assert.equal(p.path, '工作区/dsh-git-push-v2');
  assert.equal(p.scope, 'full');
  assert.equal(p.auditLevel, 'quick');
});

test('parseGitAuditInput：路径可含空格（非 flag token 拼接）', () => {
  const p = parseGitAuditInput('foo bar/baz --deep');
  assert.equal(p.path, 'foo bar/baz');
  assert.equal(p.auditLevel, 'deep');
});

test('parseGitAuditInput：未知 flag → error', () => {
  const p = parseGitAuditInput('--nope');
  assert.match(p.error, /未知参数 --nope/);
});

test('sessionCwdOf：header.cwd 有值 / 空 / 缺失', () => {
  assert.equal(sessionCwdOf(inv('/work/repo')), '/work/repo');
  assert.equal(sessionCwdOf(inv('')), '');
  assert.equal(sessionCwdOf(inv(undefined)), '');
  assert.equal(sessionCwdOf(null), '');
});

test('findGitRoot：本仓库能找到；临时空目录找不到', () => {
  assert.equal(findGitRoot(join(ROOT, 'lib')), ROOT);
  const dir = mkdtempSync(join(tmpdir(), 'gp-nongit-'));
  try {
    mkdirSync(join(dir, 'sub'));
    assert.equal(findGitRoot(join(dir, 'sub')), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveAuditRepo：空路径 = 会话 cwd，不再回落家根', () => {
  assert.equal(resolveAuditRepo('', { sessionCwd: '/work/repo' }), '/work/repo');
  assert.equal(resolveAuditRepo('', {}), '');
  assert.equal(resolveAuditRepo('/abs/repo', {}), '/abs/repo');
  assert.equal(resolveAuditRepo('sub', { sessionCwd: '/work/repo' }), join('/work/repo', 'sub'));
  assert.equal(resolveAuditRepo('sub', {}), '');
});

test('formatGitAuditCommandText：失败走 error；成功含 block + blocker 文件', () => {
  assert.equal(formatGitAuditCommandText({ ok: false, error: '缺仓库' }), '缺仓库');
  const text = formatGitAuditCommandText({
    ok: true,
    block: '【审计】ok',
    findings: [
      { file: 'a.js', line: 3, rule: 'secret-key', severity: 'blocker' },
      { file: 'b.js', line: 1, rule: 'style', severity: 'warning' },
    ],
  });
  assert.match(text, /【审计】ok/);
  assert.match(text, /a\.js:3（secret-key）/);
  assert.doesNotMatch(text, /b\.js/);
});

test('runGitAuditCommand：未分类空路径 → error，不扫家根', async () => {
  const r = await runGitAuditCommand({ rawInput: '', invocation: inv('') });
  assert.equal(r.kind, 'error');
  assert.match(r.text, /未分类/);
  assert.doesNotMatch(r.text, /\.dsh-home$/);
});

test('runGitAuditCommand：路径不存在 → error', async () => {
  const r = await runGitAuditCommand({
    rawInput: '/no-such-repo-xyz',
    invocation: inv(ROOT),
  });
  assert.equal(r.kind, 'error');
  assert.match(r.text, /路径不存在/);
});

test('runGitAuditCommand：非 git 目录拒绝（不走 auditFull）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-nongit-'));
  try {
    const r = await runGitAuditCommand({
      rawInput: dir,
      invocation: inv(ROOT),
    });
    assert.equal(r.kind, 'error');
    assert.match(r.text, /不是 git 仓库/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runGitAuditCommand：空路径 + 会话 cwd 对本仓库 --quick 能出 success', async () => {
  const r = await runGitAuditCommand({
    rawInput: '--quick',
    invocation: inv(ROOT),
    env: { workspaceRoot: ROOT },
    cfg: { auditLevel: 'quick' },
  });
  assert.equal(r.kind, 'success', r.text);
  assert.match(r.text, /审计/);
});

test('registerSlashCommands：mock commands.register 收到 git-audit', () => {
  const cmds = [];
  const n = registerSlashCommands({
    inject: (keys, fn) => {
      if (keys[0] === 'commands') fn({ commands: { register: (d) => cmds.push(d) } });
    },
  }, { env: {}, cfg: {}, log: { warn() {} } });
  assert.equal(n, 1);
  assert.equal(cmds[0].name, 'git-audit');
});

test('registerSlashCommands：无 inject 返回 0', () => {
  assert.equal(registerSlashCommands({}, {}), 0);
});
