/**
 * /git-audit 斜杠命令：参数解析 + 会话 cwd 默认 + 非 git 拒绝 + 文本格式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { SLASH_COMMANDS, findGitRoot, formatClonePreviewCommandText, formatGitAuditCommandText, formatGitScanCommandText, formatIoScanCommandText, formatLinkCheckCommandText, parseCommandInput, parseGitAuditInput, registerSlashCommands, resolveAuditRepo, runGitAuditCommand, runGitClonePreviewCommand, runGitIoScanCommand, runGitScanCommand, sessionCwdOf } from '../lib/app/slash-commands.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function inv(cwd) {
  return { agent: { session: { header: cwd == null ? {} : { cwd } } } };
}

test('parseGitAuditInput：空输入 = 默认 diff、无路径', () => {
  const p = parseGitAuditInput('');
  assert.equal(p.path, '');
  assert.equal(p.scope, 'diff');
  assert.equal(p.error, undefined);
});

test('parseGitAuditInput：路径 + --full（强度参数已删除，--quick 视为未知参数）', () => {
  const ok = parseGitAuditInput('工作区/dsh-git-push-v2 --full');
  assert.equal(ok.path, '工作区/dsh-git-push-v2');
  assert.equal(ok.scope, 'full');
  assert.equal(ok.error, undefined);
  // 2026-09-17：审计固定完整流程，--quick/--standard/--deep 不再是合法参数
  const bad = parseGitAuditInput('工作区/dsh-git-push-v2 --quick');
  assert.match(bad.error || '', /未知参数 --quick/);
});

test('parseGitAuditInput：路径可含空格（非 flag token 拼接）', () => {
  const p = parseGitAuditInput('foo bar/baz --full');
  assert.equal(p.path, 'foo bar/baz');
  assert.equal(p.scope, 'full');
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

test('parseGitAuditInput：--force 解析为 force 开关', () => {
  const p = parseGitAuditInput('工作区/测试 --force');
  assert.equal(p.force, true);
  assert.equal(p.scope, 'diff'); // force 与 --full 独立
  const both = parseGitAuditInput('x --full --force');
  assert.equal(both.force, true);
  assert.equal(both.scope, 'full');
  assert.equal(parseGitAuditInput('x').force, false);
});

test('runGitAuditCommand：非 git 目录 + --force 放行（走 code_audit 全量）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-nongit-force-'));
  try {
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'a.js'), 'export const a = 1;\n');
    const r = await runGitAuditCommand({
      rawInput: dir + ' --force',
      invocation: inv(ROOT),
      env: { workspaceRoot: ROOT },
      cfg: {},
    });
    assert.equal(r.kind, 'success', r.text);
    assert.match(r.text, /审计/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runGitAuditCommand：空路径 + 会话 cwd 对本仓库能出 success', async () => {
  // 2026-09-17：不再传强度（--quick / cfg.auditLevel 均已删除），审计固定完整流程。
  const r = await runGitAuditCommand({
    rawInput: '',
    invocation: inv(ROOT),
    env: { workspaceRoot: ROOT },
    cfg: {},
  });
  assert.equal(r.kind, 'success', r.text);
  assert.match(r.text, /审计/);
});

test('registerSlashCommands：注册全部只读命令（含 git-audit）', () => {
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

/* ── 新增只读命令（2026-09-18）── */

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

test('formatIoScanCommandText：四级风险与高危清单', () => {
  const t = formatIoScanCommandText({
    ok: true, root: '/ws', total: 10, sync: 7,
    byRisk: { high: 2, medium: 1, low: 5, safe: 2 },
    items: [
      { file: 'a.js', line: 3, call: 'writeFile', risk: 'high', inLoop: true },
      { file: 'b.js', line: 9, call: 'readFileSync', risk: 'high', inAsync: true },
    ],
  });
  assert.match(t, /文件 I\/O 调用 10 处/);
  assert.match(t, /同步 7/);
  assert.match(t, /🔴 高 2/);
  assert.match(t, /a\.js:3.*循环内/);
});

test('formatIoScanCommandText：零命中给明确结论', () => {
  assert.match(formatIoScanCommandText({ ok: true, total: 0 }), /未发现文件 I\/O 调用/);
});

test('formatLinkCheckCommandText：全有效与有失效两种形态', () => {
  assert.match(formatLinkCheckCommandText({ ok: true, count: 5, findings: [] }), /全部有效/);
  const t = formatLinkCheckCommandText({
    ok: true, count: 3,
    findings: [{ url: 'https://x.invalid', ok: false, error: 'ENOTFOUND' }, { url: 'https://ok', ok: true }],
  });
  assert.match(t, /1 个无效/);
  assert.match(t, /x\.invalid/);
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

test('runGitIoScanCommand：非会话工作区+相对路径被拒', async () => {
  const r = await runGitIoScanCommand({ rawInput: 'some/rel', invocation: null, env: {} });
  assert.equal(r.kind, 'error');
  assert.match(r.text, /绝对路径/);
});

test('runGitScanCommand：路径不存在报错', async () => {
  const r = await runGitScanCommand({ rawInput: '/no/such/dir/xyz', env: {} });
  assert.equal(r.kind, 'error');
  assert.match(r.text, /路径不存在/);
});
