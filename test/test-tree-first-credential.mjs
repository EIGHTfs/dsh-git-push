/**
 * 「有树走树」双向样本回归（防再哑门禁，方向 E3）。
 *
 * 背景：审计引擎长期「有语法树却不建树、不消费」——树解析触发条件只认 astConfirmSpan，
 *   凭据类精筛（credential-value）永远走 token 级，导致两类失灵同时存在：
 *     · 误报：复合右值（"前缀:" + uuid）、函数参数默认值、三元表达式、主题令牌样式值
 *       都被「凭据标识符右侧字符串字面量」判成真硬编码凭据（外部 Python 仓库实测 10 条全误报）。
 *     · 漏报：Python bytes 字面量（SECRET = b"..."）在初筛正则（= 与引号间隔 b 前缀断链）
 *       与 token 精筛（b 被切成 ident，右侧非 str）两处都到不了报告路径，真凭据不报。
 *   修复（方向 E1）：凭据精筛以语法树为主路径（lib/ast/credential.js
 *   credentialLinesFromTree），无树/语法错误回退 token 级（D5 口径不变）。
 *
 * 防再哑职责（一旦树消费链路再次静默退化，本测试当场变红）：
 *   ① 有树路径：报必报（含 bytes 补漏报），不报必不报。
 *   ② 树使用状态进结果（treeUsage）：语法可用文件数与建树数同量级——杜绝「悄悄全回退」。
 *   ③ 无树对照（语法资产缺失）：回退 token 级仍工作，且回退态会**重新出现**主题令牌误报
 *      形态——证明 ① 的干净结果确实来自树路径，而不是规则本身变哑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import '../lib/rule/compilers.js';
import { auditFull } from '../lib/audit/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// 行号即语义（第 4 行是函数体）。注释刻意不写 `xxx = "yyy"` 形态——
//   那会命中 [FUNC] 兜底规则的初筛，测试只针对 no-hardcoded-credentials 主规则语义。
//   报 = 1（ghp_ 直存字面量）、6（bytes 直存字面量，原漏报样本）
//   不报 = 2（拼接复合右值）、3（参数默认值）、5（主题令牌样式值）、7（三元分支）、
//         8（字符串+变量拼接，**树独有**排除形态：回退态会报）
const PY_SRC = [
  'token = "ghp_1234567890ABCDEFGHIJ"',
  'token = "plugin-preset:" + uuid.uuid4().hex',
  'def _icon(name, token="text.secondary"):',
  '    return 1',
  'fill_token = "accent.subtle"',
  'SECRET_KEY = b"Sup3rRealBytesKey01"',
  'token = "text.primary" if enabled else "text.disabled"',
  'password = "Abcdefgh12345!" + suffix',
].join('\n');

const CRED_RULE = 'security/no-hardcoded-credentials';

async function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-treecred-'));
  writeFileSync(join(dir, 'a.py'), PY_SRC);
  return dir;
}

function hardLines(res) {
  return res.findings
    .filter((f) => f.rule === CRED_RULE)
    .map((f) => f.line)
    .sort((a, b) => a - b);
}

test('① 有树主路径：报必报（含 bytes）、不报必不报（复合/默认值/三元/主题令牌）', async () => {
  const dir = await makeFixture();
  try {
    const res = await auditFull(dir);
    const lines = hardLines(res);
    assert.deepEqual(lines, [1, 6],
      `期望只报真硬编码 [1,6]（bytes 补漏报），复合右值/默认参数/主题令牌/三元不报；实得 [${lines}]`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('② treeUsage 进审计结果：语法可用且建树数一致（杜绝静默全回退）', async () => {
  const dir = await makeFixture();
  try {
    const res = await auditFull(dir);
    assert.ok(res.treeUsage, '审计结果应携带 treeUsage 统计');
    assert.ok(res.treeUsage.parsed >= 1,
      `有语法就应真建树（parsed≥1），实得 parsed=${res.treeUsage.parsed} fallback=${res.treeUsage.tokenFallback}`);
    // 防再哑核心断言：语法资产完好时，凡「需要树且有语法」的文件都必须建出树（coverage=1）。
    //   ABI 不兼容 / 资产缺失 / 触发条件被改窄，都会让 parseFailed>0 当场变红。
    assert.equal(res.treeUsage.parseFailed, 0,
      `不应有「有语法却没建树」的文件（parseFailed），实得 ${res.treeUsage.parseFailed}`);
    assert.equal(res.treeUsage.coverage, 1,
      `hasGrammar 文件的建树覆盖率应为 1，实得 ${res.treeUsage.coverage}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('③ 无树对照：语法资产缺失 ⇒ 回退 token 级，主题令牌误报形态重现（证明主路径确吃树）', () => {
  const libEntry = join(HERE, '..', 'lib', 'audit', 'index.js');
  const script = [
    `import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';`,
    `import { join } from 'node:path'; import { tmpdir } from 'node:os';`,
    `import { auditFull } from ${JSON.stringify(libEntry)};`,
    `const dir = mkdtempSync(join(tmpdir(), 'dshgp-treecred-fb-'));`,
    `writeFileSync(join(dir, 'a.py'), ${JSON.stringify(PY_SRC)});`,
    `const res = await auditFull(dir);`,
    `const lines = res.findings.filter(f => f.rule === ${JSON.stringify(CRED_RULE)}).map(f => f.line);`,
    `rmSync(dir, { recursive: true, force: true });`,
    `console.log(JSON.stringify({ lines, treeUsage: res.treeUsage }));`,
  ].join('\n');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, DSH_GIT_PUSH_TS_ASSETS: '/nonexistent-tree-assets-' + process.pid },
    encoding: 'utf8',
    timeout: 180000,
  });
  const parsed = JSON.parse(out.trim().split('\n').pop());
  assert.equal(parsed.treeUsage.parsed, 0, '语法资产缺失时不应建树（全回退）');
  // L8 `password = "Abcdefgh12345!" + suffix` 是**树独有**的排除形态：
  //   token 级只看「凭据名右侧第一个 str」即判硬编码（回退态必报）；
  //   语法树上右值是 binary_operator（拼接）而非纯字面量，不报。
  //   因此「回退态报 L8、树态不报 L8」直接证明 ① 的干净结果来自树路径，而非规则变哑。
  //   （L2/L3/L5/L7 由值形状/边界豁免双端共同排除，不承担此证明职责。）
  assert.ok(parsed.lines.includes(8),
    `回退态应重现拼接复合右值误报（L8），树态已排除——若这里不报而 ① 也不报，说明精筛整体变哑；实得 [${parsed.lines}]`);
  assert.ok(parsed.lines.includes(1), '回退态真凭据(L1)仍必须报——回退路径没坏');
});
