// 豁免提示分类回归：正则类 finding 的 exemptHint 必须与该规则**实际能被哪个标记豁免**一致。
//
// 事故（用户实测报告）：lib/checks/regex.js 此前只区分 `[FUNC]` / `credential-ref` 两种 kind，
//   其余正则规则一律提示 `dsh-skip-residue` ⇒ 安全类（security/credential/secret/password/hardcoded）
//   与风格类（min-length/max-lines…）按提示写了 residue 标记**并不会豁免**
//   （residue 只覆盖 debugger/todo/console/io-risk/client-node-builtin-require），提示与行为不符。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickExemptHint } from '../lib/checks/regex.js';
import { EXEMPT_MARKERS, exemptForFinding } from '../lib/exempt/index.js';

test('安全类正则规则 → dsh-skip-sensitive（不再误提示 residue）', () => {
  const cases = [
    { id: 'security/no-credential-in-url', kind: 'regex' },
    { id: 'security/hardcoded-token', kind: 'regex' },
    { id: 'x/credential-leak', kind: 'regex' },
    { id: 'any', kind: 'credential-ref' },
  ];
  for (const rule of cases) {
    assert.match(pickExemptHint(rule), /dsh-skip-sensitive/,
      `${rule.id}（kind=${rule.kind}）应提示 dsh-skip-sensitive，实得 ${pickExemptHint(rule)}`);
  }
});

test('残留类 / 风格类正则规则各归其位', () => {
  assert.match(pickExemptHint({ id: 'nodejs/no-console-log', kind: 'regex' }), /dsh-skip-residue/);
  assert.match(pickExemptHint({ id: 'robustness/io-risk', kind: 'regex' }), /dsh-skip-residue/);
  assert.match(pickExemptHint({ id: 'readability/max-lines', kind: 'regex' }), /dsh-skip-style/);
});

test('提示词与行为一致：各 kind 按其提示写标记都能豁免', () => {
  // 同类 bug 的完整清单（实测定位）：
  //   ① blacklist（措辞）提示 quality 但 kind 不在任何 blocked ⇒ 补进 quality
  //   ② comment-density / file-health 提示 quality 但同样不在清单 ⇒ 补进 quality
  //   ③ min-occurrences（orchestrate.js 分体文档提示）提示 quality；注册表里它是 style 类
  //      ⇒ 提示改 dsh-skip-style，并把该 kind 补进 style 的 blocked
  //   ④ residue/style 的 rule 前缀细分分支缺 `kind === 'regex'` 前置 ⇒ 非 regex kind
  //      即使列进 blocked 也会被细分误杀（③ 一度因此仍返回 false）⇒ 补前置
  const quality = '<!-- dsh-skip-quality -->\n正文\n';
  for (const kind of ['blacklist', 'comment-density', 'file-health', 'magic-number-smart']) {
    assert.equal(exemptForFinding({ kind, rule: 'x/y', line: 2 }, quality), true,
      `${kind} 写 dsh-skip-quality 应豁免`);
  }
  const style = '<!-- dsh-skip-style -->\n正文\n';
  assert.equal(exemptForFinding({ kind: 'min-occurrences', rule: 'docs/sep', line: 1 }, style), true,
    'min-occurrences（非 regex kind）写 dsh-skip-style 应豁免');
  // 反向确认：regex 宽声明的细分仍在（风格规则走 style、残留规则走 residue，互不串门）
  assert.equal(exemptForFinding({ kind: 'regex', rule: 'readability/max-lines', line: 3 }, style), true);
  assert.equal(exemptForFinding({ kind: 'regex', rule: 'nodejs/no-console-log', line: 3 }, '<!-- dsh-skip-residue -->\n正文\n'), true);
  assert.equal(exemptForFinding({ kind: 'regex', rule: 'readability/max-lines', line: 3 }, '<!-- dsh-skip-residue -->\n正文\n'), false,
    '风格规则不该被 residue 豁免（细分仍生效）');
});

test('提示关键词必须真的能豁免：blacklist 类写 dsh-skip-quality 生效', () => {
  const finding = {
    file: 'a.md', line: 2, rule: 'documentation/comment-suspicious-detection',
    kind: 'blacklist', severity: 'blocker', dimensions: ['文档'],
  };
  const text = '<!-- dsh-skip-quality -->\n正文\n';
  assert.equal(exemptForFinding(finding, text), true,
    '文件头写 dsh-skip-quality 应能豁免 blacklist 类 finding（提示与行为一致）');
});

test('提示关键词必须是豁免注册表里真实存在的标记（防写错关键词）', () => {
  const names = Object.keys(EXEMPT_MARKERS);
  for (const rule of [{ id: 'security/secret-x' }, { id: 'nodejs/todo-comment' }, { id: 'readability/min-length' }]) {
    const hint = pickExemptHint(rule);
    const marker = String(hint).split('（')[0].trim();
    assert.ok(names.includes(marker), `${rule.id} 的提示关键词 ${marker} 必须存在于 EXEMPT_MARKERS`);
  }
});
