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
import {
  checkEmptyCatch, checkRegexRules, checkPathRegexRules, checkFuncLines, checkSyncFsInFile,
  checkCredentialFiles, checkMinLength, checkComplexity, checkDepth, checkMaxLines,
  checkRepeated, checkSemantic, groupByKind, runChecks, capSeverity,
} from '../lib/audit/checks.js';
import { CODE_EXTS } from '../lib/audit/index.js';

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
/* ───────────────── 检查器逐类覆盖（审计总入口全功能） ───────────────── */

test('checkRegexRules：命中报 + 未命中不报 + source 标注', () => {
  const rules = [{ id: 'r1', kind: 'regex', severity: 'warning', patterns: [/SECRET\d+/], message: '命中', dimensions: ['安全性'] }];
  const hit = checkRegexRules({ file: 'a.js', text: 'const a = "SECRET123";', rules });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].rule, 'r1');
  const miss = checkRegexRules({ file: 'a.js', text: 'const a = "public";', rules });
  assert.equal(miss.length, 0);
});

test('checkRegexRules：子模式（subPatterns）命中输出专属 message（文档 §13）', () => {
  const rules = [{
    id: 'performance/memory-bomb', kind: 'regex', severity: 'warning',
    message: '规则级 message',
    subPatterns: [
      { regex: /fs\.readFileSync\s*\(/, message: 'per-a 全量读入' },
      { regex: /\.push\s*\(/, message: 'per-b 无界 push' },
    ],
    dimensions: ['性能'],
  }];
  const hit = checkRegexRules({ file: 'a.js', text: 'const x = fs.readFileSync("/b");', rules });
  assert.equal(hit.length, 1, '应命中 1 条');
  assert.equal(hit[0].message, 'per-a 全量读入', '子模式专属 message 优先');
  const hit2 = checkRegexRules({ file: 'a.js', text: 'arr.push(1);', rules });
  assert.equal(hit2[0].message, 'per-b 无界 push');
  // 无 subPatterns 的旧结构仍走规则级 message（向后兼容）
  const legacy = [{ id: 'r9', kind: 'regex', severity: 'warning', patterns: [/TODO/], message: '旧结构', dimensions: ['可读性'] }];
  const lHit = checkRegexRules({ file: 'a.js', text: '// TODO fix', rules: legacy });
  assert.equal(lHit[0].message, '旧结构');
});

test('checkRegexRules：空规则数组返回空（不崩溃）', () => {
  assert.deepEqual(checkRegexRules({ file: 'a.js', text: 'x', rules: [] }), []);
  assert.deepEqual(checkRegexRules({ file: 'a.js', text: 'x', rules: undefined }), []);
});

test('checkPathRegexRules：文件路径命中与不命中', () => {
  const rules = [{ id: 'p1', kind: 'path-regex', severity: 'warning', pathPattern: '\\.key$', message: '私钥路径', dimensions: ['安全性'] }];
  assert.equal(checkPathRegexRules({ file: 'a', relPath: 'certs/a.key', rules }).length, 1);
  assert.equal(checkPathRegexRules({ file: 'a', relPath: 'src/a.js', rules }).length, 0);
});

test('checkCredentialFiles：按文件名与路径判定凭据文件', () => {
  const rules = [{ id: 'c1', kind: 'credential-file', severity: 'warning', patterns: [/^id_rsa$/, /\.pem$/], message: '凭据文件', dimensions: ['安全性'] }];
  assert.equal(checkCredentialFiles({ file: 'x', relPath: '.ssh/id_rsa', rules }).length, 1);
  assert.equal(checkCredentialFiles({ file: 'x', relPath: 'certs/server.pem', rules }).length, 1);
  assert.equal(checkCredentialFiles({ file: 'x', relPath: 'src/index.js', rules }).length, 0);
});

test('checkFuncLines：超阈函数报、未超不报', () => {
  const rules = [{ id: 'func-lines', kind: 'func-lines', severity: 'warning', threshold: 3, dimensions: ['可读性'] }];
  const long = 'function f() {\n' + 'let a = 1;\n'.repeat(6) + '}\n';
  assert.ok(checkFuncLines({ file: 'a.js', text: long, rules }).length >= 1);
  assert.equal(checkFuncLines({ file: 'a.js', text: 'function g() { return 1; }\n', rules }).length, 0);
});

test('checkSyncFsInFile：async 中的同步 fs 报、纯同步不报', () => {
  const viaPrefix = 'export async function f() {\n  const x = fs.readFileSync("a");\n}\n';
  assert.ok(checkSyncFsInFile({ file: 'a.mjs', text: viaPrefix }).length >= 1, 'fs. 前缀应报');
  const viaImport = 'import { readFileSync } from "node:fs";\nexport async function g() {\n  const x = readFileSync("a");\n}\n';
  assert.ok(checkSyncFsInFile({ file: 'a.mjs', text: viaImport }).length >= 1, 'named import 后直调应报（修旧项目假阴性）');
  const plain = 'const x = fs.readFileSync("a");\n';
  assert.equal(checkSyncFsInFile({ file: 'a.mjs', text: plain }).length, 0, '非 async 上下文不报');
  const custom = 'export async function h() {\n  const x = readFileSync("a");\n}\n';
  assert.equal(checkSyncFsInFile({ file: 'a.mjs', text: custom }).length, 0, '未 import 的同名自定义函数不误报');
});

test('checkMinLength：过短命名报、正常命名不报', () => {
  const rules = [{ id: 'min-length', kind: 'min-length', severity: 'warning', threshold: 3, dimensions: ['可读性'] }];
  const short = 'function fn(qq) {\n  const zz = 1;\n  return zz;\n}\n';
  assert.ok(checkMinLength({ file: 'a.js', text: short, rules }).length >= 1);
  const ok = 'function compute(length) {\n  const result = length;\n  return result;\n}\n';
  assert.equal(checkMinLength({ file: 'a.js', text: ok, rules }).length, 0);
});

test('checkComplexity：高复杂度报、简单函数不报', () => {
  const rules = [{ id: 'cx', kind: 'max-complexity', severity: 'warning', threshold: 2, dimensions: ['可维护性'] }];
  const complex = 'function f(a) {\n  if (a && a.b || a.c) return 1;\n  for (;;) { if (a) break; }\n  return 0;\n}\n';
  assert.ok(checkComplexity({ file: 'a.js', text: complex, rules }).length >= 1);
  assert.equal(checkComplexity({ file: 'a.js', text: 'function g() { return 1; }\n', rules }).length, 0);
});

test('checkDepth：深嵌套报、浅嵌套不报', () => {
  const rules = [{ id: 'd', kind: 'max-depth', severity: 'warning', threshold: 2, dimensions: ['可读性'] }];
  const deep = 'function f() {\n  if (1) {\n    if (2) {\n      if (3) { return 1; }\n    }\n  }\n}\n';
  assert.ok(checkDepth({ file: 'a.js', text: deep, rules }).length >= 1);
  assert.equal(checkDepth({ file: 'a.js', text: 'function g() { return 1; }\n', rules }).length, 0);
});

test('checkMaxLines：超行数报、未超不报', () => {
  const rules = [{ id: 'ml', kind: 'max-lines', severity: 'warning', threshold: 5, dimensions: ['可维护性'] }];
  assert.equal(checkMaxLines({ file: 'a.js', text: 'x\n'.repeat(3), rules }).length, 0);
  const big = checkMaxLines({ file: 'a.js', text: 'x\n'.repeat(20), rules });
  assert.equal(big.length, 1);
  assert.equal(big[0].line, 1, '文件级问题定位到第 1 行');
});

test('checkRepeated：重复硬编码串报、单次不报', () => {
  const rules = [{ id: 'rp', kind: 'repeated-string', severity: 'warning', threshold: 3, dimensions: ['可维护性'] }];
  const text = 'const a = "api.example.com";\nconst b = "api.example.com";\nconst c = "api.example.com";\n';
  assert.ok(checkRepeated({ file: 'a.js', text, rules }).length >= 1);
  assert.equal(checkRepeated({ file: 'a.js', text: 'const a = "once-only.example.com";\n', rules }).length, 0);
});

test('checkRepeated：ignoreValues 生效（忽略清单内的串不报）', () => {
  const rules = [{ id: 'rp', kind: 'repeated-string', severity: 'warning', threshold: 3, ignoreValues: ['ignore-me'], dimensions: ['可维护性'] }];
  const text = 'const a = "ignore-me";\nconst b = "ignore-me";\nconst c = "ignore-me";\n';
  assert.equal(checkRepeated({ file: 'a.js', text, rules }).length, 0);
});

test('checkSemantic：产出 notice 级提示（不升为拦截）', () => {
  const rules = [{ id: 'sem-1', kind: 'semantic', message: '需人工确认的语义规则', dimensions: ['健壮性'] }];
  const out = checkSemantic({ file: 'a.js', relPath: 'a.js', rules });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'notice');
});

test('capSeverity：规则声明 warning 时内部 blocker 不得越级', () => {
  assert.equal(capSeverity('warning', 'blocker'), 'warning');
  assert.equal(capSeverity('warning', 'warning'), 'warning');
  assert.equal(capSeverity('error', 'warning'), 'warning', '内部低风险按内部算');
  assert.equal(capSeverity('error', 'blocker'), 'error');
  assert.equal(capSeverity('info', 'blocker'), 'notice', 'info 归入 notice');
});

test('groupByKind：按 kind 分桶（同 kind 聚一组）', () => {
  const g = groupByKind([
    { kind: 'regex', id: 'a' }, { kind: 'regex', id: 'b' }, { kind: 'secret', id: 'c' },
  ]);
  assert.equal(g.regex.length, 2);
  assert.equal(g.secret.length, 1);
  assert.deepEqual(groupByKind([]), {});
  assert.deepEqual(groupByKind(undefined), {});
});

test('runChecks：多 kind 齐发（regex + 空 catch + sync-fs 同文件命中）', () => {
  const grouped = {
    regex: [{ id: 'r', kind: 'regex', severity: 'warning', patterns: [/TRIGGER/], message: 'm', dimensions: ['安全性'] }],
  };
  const text = 'export async function f() {\n  try { await g(); } catch (e) {}\n  const x = readFileSync("a");\n  const t = "TRIGGER";\n}\n';
  const out = runChecks({ file: 'a.mjs', relPath: 'a.mjs', text, grouped });
  const kinds = out.map((f) => f.kind);
  assert.ok(kinds.includes('regex'), '正则命中');
  assert.ok(kinds.filter((k) => k === undefined || k === 'empty-catch' || k === 'sync-fs').length >= 1, '内置检查命中');
});

test('runChecks：空 grouped 仍跑内置检查（不依赖 yml 规则）', () => {
  const out = runChecks({ file: 'a.mjs', relPath: 'a.mjs', text: 'export async function f() {\n  try { await g(); } catch (e) {}\n}\n', grouped: {} });
  assert.ok(out.length >= 1, '内置空 catch 检查不依赖规则包');
});

test('CODE_EXTS：含常见代码扩展名、不含文档扩展名', () => {
  for (const e of ['js', 'mjs', 'ts', 'py', 'go']) assert.ok(CODE_EXTS.has(e), `应含 ${e}`);
  for (const e of ['md', 'json', 'yml', 'txt']) assert.ok(!CODE_EXTS.has(e), `不应含 ${e}`);
});

test('summarize：error 归拦截级、notice 单列、total 与实际一致', () => {
  const s = summarize([
    { severity: 'blocker' }, { severity: 'error' }, { severity: 'warning' }, { severity: 'notice' },
  ]);
  assert.equal(s.blocker, 2, 'blocker + error 都算拦截级');
  assert.equal(s.warning, 1);
  assert.equal(s.notice, 1);
  assert.equal(s.total, 4, 'total 应等于问题总数（不再出现 0/0/3 矛盾）');
});

test('summarize：缺 severity 字段按 warning 计（不丢统计）', () => {
  const s = summarize([{}, { severity: undefined }]);
  assert.equal(s.warning, 2);
  assert.equal(s.total, 2);
});
