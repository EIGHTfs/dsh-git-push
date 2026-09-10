// dsh-skip-sensitive: 测试 fixture 含 mock 凭据字面量（AKIA… 非真实凭据）
// dsh-skip-func-length: 测试 fixture 含超长函数样本（200 语句，故意触发 func-lines）
/**
 * 审计总入口测试：auditFull / auditChanged / 豁免 / gitignore 感知。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import '../lib/rule/compilers.js';
import { auditFull, auditWithScope, makeFinding, summarize } from '../lib/audit/index.js';
import { collectTextFiles, collectChangedFiles, isGitRepo, readText } from '../lib/audit/collector.js';
import { checkEmptyCatch } from '../lib/audit/checks.js';

let fixture = '';
let gitRepo = '';

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'v2-audit-'));
  // ① 非 git 目录 + 普通文本
  writeFileSync(join(fixture, 'a.js'), 'const x = "AKIA1234567890ABCDEF"; // should hit secret\n');
  writeFileSync(join(fixture, 'b.md'), '# doc\n');
  mkdirSync(join(fixture, 'sub'));
  writeFileSync(join(fixture, 'sub', 'c.js'), 'function tooLong() {\nlet i = 0; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; i++; return i;\n}\n');
  // ② gitignore 感知目录
  mkdirSync(join(fixture, 'repo'));
  writeFileSync(join(fixture, 'repo', '.gitignore'), 'secret.log\n');
  writeFileSync(join(fixture, 'repo', 'keep.js'), 'const ok = 1;\n');
  writeFileSync(join(fixture, 'repo', 'secret.log'), 'AKIA1234567890ABCDEF\n');
  // ③ 豁免文件：文件头 dsh-skip-sensitive
  writeFileSync(join(fixture, 'exempt.js'), '// dsh-skip-sensitive: fixture\nconst t = "AKIA1234567890ABCDEF";\n');
  // ④ git 仓库（auditChanged 真 diff 用）：init + 基线 commit → 再改 2 个文件
  gitRepo = join(fixture, 'gitrepo');
  mkdirSync(gitRepo);
  writeFileSync(join(gitRepo, 'clean.js'), 'const ok = 1;\n');
  const git = (args) => execFileSync('git', ['-C', gitRepo, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  git(['init', '-q']);
  git(['config', 'user.email', 'v2-test@local']);
  git(['config', 'user.name', 'v2 test']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'baseline']);
  writeFileSync(join(gitRepo, 'clean.js'), 'const ok = 2;\n'); // M
  writeFileSync(join(gitRepo, 'new.js'), 'const key = "AKIA1234567890ABCDEF";\n'); // ??
});

after(() => {
  try { rmSync(fixture, { recursive: true, force: true }); } catch { /* noop */ }
});

test('collector：非 git 目录全量收集（含深层）', () => {
  const files = collectTextFiles(fixture);
  assert.ok(files.some((f) => f.path === 'a.js'));
  assert.ok(files.some((f) => f.path === 'sub/c.js'));
  assert.ok(files.length >= 3);
});

test('collector：gitignore 感知——忽略文件不在收集列表', () => {
  const files = collectTextFiles(join(fixture, 'repo'), { gitIgnoreRoot: join(fixture, 'repo') });
  assert.ok(files.some((f) => f.path === 'keep.js'));
  assert.ok(!files.some((f) => f.path === 'secret.log'), '.gitignore 中的 secret.log 应被排除');
});

test('collector：isGitRepo / readText', () => {
  assert.equal(isGitRepo(join(fixture, 'repo')), false); // fixture 非 git 仓库
  assert.equal(readText(join(fixture, 'a.js'))?.includes('AKIA'), true);
  assert.equal(readText('/nonexistent-file'), null);
});

test('auditFull：非 git 目录出 findings（secret 命中）', () => {
  const res = auditFull(fixture);
  assert.equal(res.ok, true);
  assert.equal(res.scope, 'full');
  const secret = res.findings.filter((f) => f.kind === '[FUNC]');
  assert.ok(secret.length >= 1, `应命中 secret（得 ${secret.length}）`);
  // 每 finding 带 exemptHint
  for (const f of res.findings) {
    assert.ok(typeof f.exemptHint === 'string' && f.exemptHint.length > 0, `${f.rule} 缺 exemptHint`);
  }
});

test('auditFull：exempt 文件头 dsh-skip-sensitive → 该文件无 secret 类', () => {
  const res = auditFull(fixture);
  const hits = res.findings.filter((f) => f.kind === '[FUNC]' && f.file === 'exempt.js');
  assert.equal(hits.length, 0, '豁免文件不应报 secret');
});

test('auditFull：func-lines 检测超长函数（sub/c.js 60+ 行函数）', () => {
  const res = auditFull(join(fixture, 'sub'));
  const fl = res.findings.filter((f) => f.kind === 'func-lines');
  assert.ok(fl.length >= 1, `应命中 func-lines（得 ${fl.length}）`);
});

test('auditWithScope：非 git 目录 full 与 diff 等价（退化）', () => {
  const full = auditWithScope(fixture, { scope: 'full' });
  const diff = auditWithScope(fixture, { scope: 'diff' });
  assert.equal(full.scope, 'full');
  assert.equal(diff.scope, 'changed'); // 非 git 退化 full 但 scope 标记 changed
  assert.equal(diff.summary.total, full.summary.total);
});

test('checkEmptyCatch：真空 catch 命中', () => {
  const findings = checkEmptyCatch({ file: 'x.js', text: 'try { a(); } catch (e) {\n}\n' });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'empty-catch');
  assert.deepEqual(findings[0].dimensions, ['健壮性', '可观测性']);
});

test('makeFinding / summarize：统一问题对象 + 统计', () => {
  const fs = [
    makeFinding({ file: 'a', line: 1, rule: 'r1', kind: '[FUNC]', severity: 'blocker' }),
    makeFinding({ file: 'b', line: 2, rule: 'r2', kind: 'regex', severity: 'warning' }),
  ];
  const s = summarize(fs);
  assert.equal(s.blocker, 1);
  assert.equal(s.warning, 1);
  assert.equal(s.total, 2);
  assert.equal(fs[0].scoreImpact, 0);
  assert.ok(Array.isArray(fs[0].dimensions));
});

test('auditFull：summary 结构完整 + files 计数', () => {
  const res = auditFull(fixture);
  assert.deepEqual(Object.keys(res.summary).sort(), ['blocker', 'notice', 'total', 'warning']);
  assert.ok(res.files >= 3);
});

test('collectChangedFiles：git 仓库变动列表（M + ??）', () => {
  const changed = collectChangedFiles(gitRepo);
  const rels = changed.map((c) => c.rel).sort();
  assert.deepEqual(rels, ['clean.js', 'new.js']);
  const statuses = changed.map((c) => c.status).sort();
  assert.deepEqual(statuses, ['??', 'M']);
});

test('auditChanged：git 仓库只审计变动文件（真 diff）', () => {
  const res = auditWithScope(gitRepo, { scope: 'diff' });
  assert.equal(res.scope, 'changed');
  assert.equal(res.files, 2, '只应审计 2 个变动文件');
  const secret = res.findings.filter((f) => f.kind === '[FUNC]');
  assert.ok(secret.length >= 1, 'new.js 中的 AKIA 应命中 secret');
  const files = new Set(res.findings.map((f) => f.file));
  assert.ok(!files.has('a.js'), '未变动文件 a.js 不应出现在变动审计中');
});

test('auditChanged：删除的文件跳过（status D 无可读内容）', () => {
  rmSync(join(gitRepo, 'clean.js'));
  const res = auditWithScope(gitRepo, { scope: 'diff' });
  const cleanHits = res.findings.filter((f) => f.file === 'clean.js');
  assert.equal(cleanHits.length, 0, '删除文件不应产出 findings');
  assert.ok(res.files <= 1);
});