/**
 * 「豁免提示可信」机器门禁（2026-10-17 由「有人反应文件头豁免措辞无效」触发）
 *
 * 事故形态：exemptHint 是各检查器里**写死**的字符串，而能否生效取决于
 *   lib/exempt/index.js 的 blocked/细分清单。两者不一致时，用户**照提示写了文件头标记仍然照报** ✗。
 *   全量自证实测：24 种组合不一致（如 readability/vague-function-name 提示 dsh-skip-residue、
 *   maintainability/max-cyclomatic-complexity 提示 dsh-skip-quality、min-length 类无任何标记可豁免）。
 *
 * 本测试把这条不变量钉死（三组）：
 *   ① 反查得到的标记**必定真能豁免**该 finding（判定口径与提示口径同源）
 *   ② 安全类 finding **不得**被 dsh-skip-quality 顺手吞掉（必须走 dsh-skip-sensitive）
 *   ③ 端到端：对真实审计结果逐条校验「提示的标记 ⇒ 放到文件头确实豁免」
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { exemptForFinding, exemptHintForFinding, exemptMarkerCovers } from '../lib/exempt/index.js';
import { normalizeExemptHints } from '../lib/audit/finding.js';
import { auditWithScope } from '../lib/audit/orchestrate.js';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER_RE = /dsh-skip-[a-z-]+/;
/** 给文件头前 3 行加标记（模拟用户按提示写文件头豁免）。 */
const withHeader = (text, marker) => `// ${marker}\n${text}`;

// ① 反查 ⇔ 判定 必须一致（覆盖自证里抓到的全部不一致组合）
const CASES = [
  { rule: 'readability/vague-function-name', kind: 'regex' },
  { rule: 'readability/vague-variable-name', kind: 'regex' },
  { rule: 'robustness/timeout-on-external-api', kind: 'regex' },
  { rule: 'performance/memory-bomb', kind: 'regex' },
  { rule: 'performance/nested-linear-scan', kind: 'regex' },
  { rule: 'performance/long-sync-loop', kind: 'regex' },
  { rule: 'performance/repeat-identical-call', kind: 'regex' },
  { rule: 'comment/no-date-in-comment', kind: 'regex' },
  { rule: 'conv-user-decision', kind: 'regex' },
  { rule: 'npm/version-commit-mismatch', kind: 'regex' },
  { rule: 'button/event-delegation-detected', kind: 'regex' },
  { rule: 'dsh/client-module-loader-id', kind: 'regex' },
  { rule: 'maintainability/max-cyclomatic-complexity', kind: 'max-complexity' },
  { rule: 'readability/max-nesting-depth', kind: 'max-depth' },
  { rule: 'readability/max-file-length', kind: 'max-lines' },
  { rule: 'readability/variable-min-length', kind: 'min-length' },
  { rule: 'python/variable-min-length', kind: 'min-length' },
  { rule: 'python/max-nesting-depth', kind: 'max-depth' },
  { rule: 'python/max-file-length', kind: 'max-lines' },
  { rule: 'security/no-repeated-hardcoded-literals', kind: 'repeated-string' },
  { rule: 'dataflow/clear-then-access', kind: 'dataflow' },
  { rule: 'dependency/known-vulnerability', kind: 'semantic' },
  { rule: 'security/no-path-traversal', kind: 'semantic' },
  { rule: 'maintainability/duplicate-constant-def', kind: 'duplicate-const' },
];

test('反查到的标记必定真能豁免（文件头生效）——覆盖历史 24 种不一致组合', () => {
  const text = 'const a = 1;\nconst b = 2;\n';
  for (const c of CASES) {
    const f = { file: 'lib/x.js', line: 1, rule: c.rule, kind: c.kind };
    const truth = exemptHintForFinding(f);
    assert.ok(truth, `${c.rule}(kind=${c.kind}) 应有可用豁免标记（返回 null = 提示无标记可写）`);
    assert.ok(
      exemptForFinding(f, withHeader(text, truth.marker)),
      `${c.rule}(kind=${c.kind}) 反查标记 ${truth.marker} 放到文件头应豁免（否则又是「写了不生效」）`,
    );
  }
});

test('安全类 finding 不得被 dsh-skip-quality 吞掉（回归：质量兜底覆盖 regex 后的边界）', () => {
  const text = 'const k = "AKIA1234567890ABCDEF";\n';
  const securityFinding = { file: 'lib/x.js', line: 1, rule: 'security/credential-leak', kind: 'regex' };
  assert.equal(exemptMarkerCovers('dsh-skip-quality', securityFinding), false,
    'security/* 的 regex finding 不能被质量标记覆盖（必须走 dsh-skip-sensitive）');
  assert.equal(exemptForFinding(securityFinding, withHeader(text, 'dsh-skip-quality')), false,
    '写了 dsh-skip-quality 也不该豁免安全类 finding');
  assert.equal(exemptForFinding(securityFinding, withHeader(text, 'dsh-skip-sensitive')), true,
    '安全类应能由 dsh-skip-sensitive 豁免（原能力不能退化）');
});

test('normalizeExemptHints：校正失效提示 + 幂等 + 保留仍有效的提示', () => {
  const stale = [{ file: 'lib/x.js', line: 3, rule: 'readability/vague-function-name', kind: 'regex', exemptHint: 'dsh-skip-residue（行尾=本行）' }];
  normalizeExemptHints(stale);
  assert.match(stale[0].exemptHint, MARKER_RE, '校正后仍应给出标记');
  const marker = stale[0].exemptHint.match(MARKER_RE)[0];
  assert.ok(exemptMarkerCovers(marker, stale[0]), `校正后的标记 ${marker} 必须真能豁免`);
  const after = stale[0].exemptHint;
  normalizeExemptHints(stale);
  assert.equal(stale[0].exemptHint, after, '幂等：再校正一次结果不变');

  const valid = [{ file: 'lib/x.js', line: 1, rule: 'x/todo-left', kind: 'regex', exemptHint: 'dsh-skip-residue（行尾=本行）' }];
  normalizeExemptHints(valid);
  assert.equal(valid[0].exemptHint, 'dsh-skip-residue（行尾=本行）', '仍然有效的提示应保留（不打扰既有用法）');
});

test('端到端：真实审计的每条 finding，其提示的标记放到文件头都能真豁免', async () => {
  const dir = mkdtempTracked('exempt-hint-');
  mkdirSync(join(dir, 'lib'), { recursive: true });
  // 造几个能触发 regex/结构类规则的文件（含 TODO 残留、console 输出、超长行）
  writeFileSync(join(dir, 'lib', 'a.js'), 'export function f() {\n  // TODO: 待补\n  console.log("debug");\n  return 1;\n}\n', 'utf8');
  writeFileSync(join(dir, 'lib', 'b.js'), `${'const x = 1; '.repeat(30)}\nexport const y = 2;\n`, 'utf8');
  writeFileSync(join(dir, 'package.json'), '{"name":"probe","version":"1.0.0"}\n', 'utf8');
  const r = await auditWithScope(dir, { scope: 'full', maxScanFiles: 200, disabledSlots: [] });
  const hinted = (r.findings || []).filter((f) => MARKER_RE.test(String(f.exemptHint || '')));
  assert.ok(hinted.length > 0, '探针应至少产出一条带豁免提示的 finding');
  const bad = [];
  for (const f of hinted) {
    const marker = String(f.exemptHint).match(MARKER_RE)[0];
    if (!exemptMarkerCovers(marker, f)) bad.push(`${f.rule}(kind=${f.kind}) → ${marker}`);
  }
  assert.deepEqual(bad, [], `以下 finding 提示的标记写了不生效：\n${bad.join('\n')}`);
});
