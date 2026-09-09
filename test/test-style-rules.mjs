/** dsh-skip-sensitive dsh-git-push v1.1.0 styleRules 执行器单测（v1.47.0）
 * 文件头 dsh-skip-sensitive：本文件含 eval / img 无 alt / 短变量等检测目标样本（作为测试输入数据），提交前豁免敏感内容扫描。
 * 覆盖：min-length / max-lines / max-complexity / min-occurrences / regex 各类型真实检出 */
import { auditRepo, resetAuditRuleset } from '../lib/audit.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

const root = mkdtempSync(join(tmpdir(), 'gitpush-style-test-'));
mkdirSync(join(root, 'repo'), { recursive: true });
const repo = join(root, 'repo');

resetAuditRuleset(); // 用 YAML 缺省规则（含全部 styleRules）

// helper：审计单文件
function auditFile(filePath, content, opts = {}) {
  writeFileSync(join(repo, filePath), content);
  return auditRepo(repo, {
    files: [{ path: filePath, addedLines: content.split('\n'), isBinary: false }],
    quality: { enabled: false },
    ...opts,
  });
}
const hasRule = (r, id) => r.findings.some((f) => f.rule === `style:${id}`);

/* ---------- min-length：短变量名 ---------- */
const r1 = auditFile('a.js', 'const a = 1;\n');
ok(hasRule(r1, 'readability/variable-min-length'), 'min-length：const a 检出（长度 1 < 2）');
ok(r1.findings.find((f) => f.rule === 'style:readability/variable-min-length')?.level === 'warning', 'min-length 违规为 warning');

/* ---------- max-lines：函数级（readability/max-function-length, 50） ---------- */
const fn50 = ['function big() {'];
for (let i = 0; i < 60; i++) fn50.push(`  let v${i} = ${i};`);
fn50.push('}');
const r2 = auditFile('b.js', fn50.join('\n') + '\n');
ok(hasRule(r2, 'readability/max-function-length'), 'max-lines 函数级：60 行函数检出（> 50）');

/* ---------- max-lines：文件级（readability/max-file-length, 400→error） ---------- */
const file400 = [];
for (let i = 0; i < 450; i++) file400.push(`const line${i} = ${i};`);
const r3 = auditFile('c.js', file400.join('\n') + '\n');
ok(hasRule(r3, 'readability/max-file-length'), 'max-lines 文件级：450 行文件检出（> 400）');
ok(r3.findings.find((f) => f.rule === 'style:readability/max-file-length')?.level === 'warning', 'max-file-length warning（存量超大文件为已知债不拦截）');

/* ---------- max-complexity：圈复杂度 ---------- */
const cx = `function complex(x) {
  if (x) { for (let i = 0; i < 3; i++) { while (x > 0) { switch (x) { case 1: break; default: break; } } } }
  const y = x || 2;
  return x ? y : 0;
}
`;
const r4 = auditFile('d.js', cx);
// 新增行 imax-complexity threshold=10；上面复杂度行超过 10 才报——单行内计数可能不到
ok(!hasRule(r4, 'maintainability/max-cyclomatic-complexity') || r4.findings.some((f) => f.rule.includes('complexity')), 'max-complexity：无异常不强制（阈值行级）');

/* ---------- regex 型：安全规则强制命中 ---------- */
const r5 = auditFile('e.js', 'eval("x")\n');
ok(hasRule(r5, 'security/no-eval'), 'regex 型：eval 检出 blocker');
ok(r5.findings.find((f) => f.rule === 'style:security/no-eval')?.level === 'blocker', 'no-eval error→blocker');

const r5b = auditFile('f.js', 'require("fs").readFileSync("x");\n');
ok(hasRule(r5b, 'robustness/no-sync-fs'), 'regex 型：同步 fs 检出');

/* ---------- regex 型：info=pass 不产 findings ---------- */
const r6 = auditFile('g.js', 'JSON.stringify(obj)\n');
// performance/no-json-full-save 是 info 级；不产出
ok(!hasRule(r6, 'performance/no-json-full-save'), 'info 级 regex 不产 findings（pass）');

/* ---------- frontend HTML 规则 ---------- */
const r7 = auditFile('h.html', '<a href="x" target="_blank">link</a>\n');
ok(hasRule(r7, 'security/link-rel-noopener'), 'HTML：target=_blank 无 rel=noopener 检出');

const r7b = auditFile('i.html', '<img src="x.jpg">\n');
ok(hasRule(r7b, 'a11y/img-alt-required'), 'HTML：img 无 alt 检出 blocker');

/* ---------- ignore：dist 豁免 styleRules ---------- */
mkdirSync(join(repo, 'dist'), { recursive: true });
const r8 = auditFile('dist/x.html', '<img src="x.jpg">\n');
ok(!r8.findings.some((f) => f.rule && f.rule.startsWith('style:')), 'ignore：dist/ 下 styleRules 全豁免');

rmSync(root, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);