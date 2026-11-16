/**
 * 斜杠命令（git 侧）：参数解析 + 会话 cwd 默认 + 文本格式。
 * 注：审计类斜杠命令（/git-audit、/git-io-scan、/link-check）已随审计能力迁出宿主。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { SLASH_COMMANDS, findGitRoot, formatClonePreviewCommandText, formatGitScanCommandText, parseCommandInput, registerSlashCommands, runGitClonePreviewCommand, runGitScanCommand, sessionCwdOf } from '../../lib/app/slash-commands.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function inv(cwd) {
  return { agent: { session: { header: cwd == null ? {} : { cwd } } } };
}

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

test('registerSlashCommands：注册全部只读命令', () => {
  const cmds = [];
  const n = registerSlashCommands({
    inject: (keys, fn) => {
      if (keys[0] === 'commands') fn({ commands: { register: (d) => cmds.push(d) } });
    },
  }, { env: {}, cfg: {}, log: { warn() {} } });
  assert.equal(n, SLASH_COMMANDS.length);
  assert.equal(cmds.length, SLASH_COMMANDS.length);
  // 逐条断言：名字与顺序都要与清单一致（漏挂/多挂都能查出来）
  assert.deepEqual(cmds.map((c) => c.name), SLASH_COMMANDS.map((c) => c.name));
  assert.ok(cmds.every((c) => typeof c.handler === 'function'), '每条都要有 handler');
  // 写类命令不得出现在斜杠命令里（输入框一条命令就改远端太危险）
  for (const banned of ['git-push', 'git-remote', 'git-visibility']) {
    assert.ok(!cmds.some((c) => c.name === banned), `不应注册写类命令 /${banned}`);
  }
});

test('只读命令清单：名称唯一且都带描述', () => {
  const names = SLASH_COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, '命令名不应重复');
  for (const c of SLASH_COMMANDS) {
    assert.ok(c.description && c.description.length > 4, `/${c.name} 应有描述`);
    assert.ok(c.input && typeof c.input.hint === 'string', `/${c.name} 应有 input.hint`);
  }
});

test('registerSlashCommands：无 inject 返回 0', () => {
  assert.equal(registerSlashCommands({}, {}), 0);
});

/* ── 新增只读命令── */

test('parseCommandInput：识别 flag 与带空格路径', () => {
  const r = parseCommandInput('/a b/repo --full', ['--full'], 'u');
  assert.equal(r.path, '/a b/repo');
  assert.equal(r.opts.full, true);
  assert.equal(r.error, undefined);
});

test('parseCommandInput：未知 flag 报错并带用法', () => {
  const r = parseCommandInput('--nope', ['--full'], '用法: /x');
  assert.ok(r.error && r.error.includes('/x'));
});

test('formatGitScanCommandText：列出仓库并标未提交', () => {
  const t = formatGitScanCommandText({
    ok: true, root: '/ws',
    repos: [
      { name: 'a', branch: 'main', changed: 2, ahead: 0 },
      { name: 'b', branch: 'master', changed: 0, ahead: 1 },
    ],
  });
  assert.match(t, /共 2 个仓库/);
  assert.match(t, /● a/);
  assert.match(t, /未提交 2/);
  assert.match(t, /未推送 1/);
  assert.match(t, /1 个仓库有未提交改动/);
});

test('formatGitScanCommandText：空仓库列表不崩', () => {
  assert.match(formatGitScanCommandText({ ok: true, root: '/ws', repos: [] }), /未发现 git 仓库/);
});

test('formatClonePreviewCommandText：下载与跳过清单', () => {
  const t = formatClonePreviewCommandText({
    ok: true, owner: 'EIGHTfs', repo: 'x', branch: 'main',
    willDownload: [{ path: 'a.js', size: 1024 * 1024 }],
    skipped: [{ path: 'big.bin', size: 80 * 1024 * 1024 }],
  });
  assert.match(t, /EIGHTfs\/x @ main/);
  assert.match(t, /将下载 1 个文件/);
  assert.match(t, /跳过 1 个/);
});

test('formatClonePreviewCommandText：全跳过要显式警告', () => {
  const t = formatClonePreviewCommandText({ ok: true, willDownload: [], skipped: [{ path: 'b' }] });
  assert.match(t, /空仓库/);
});

test('runGitClonePreviewCommand：无 target 报错带用法', async () => {
  const r = await runGitClonePreviewCommand({ rawInput: '' });
  assert.equal(r.kind, 'error');
  assert.match(r.text, /owner\/repo/);
});

test('runGitScanCommand：路径不存在报错', async () => {
  const r = await runGitScanCommand({ rawInput: '/no/such/dir/xyz', env: {} });
  assert.equal(r.kind, 'error');
  assert.match(r.text, /路径不存在/);
});
