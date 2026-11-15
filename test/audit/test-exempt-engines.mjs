/**
 * 中间层豁免编排：第三方引擎标记映射（批 2）。
 *
 * 为什么必须有 fixture 测试（而不是只写映射表）：映射表是「声明」，能不能真的按各引擎的
 *   语义豁免到正确的那一行，只有拿**真实样例文件**跑一遍才知道。最容易错的是三种：
 *     ① `eslint-disable-next-line` 作用**下一行**（不是本行）
 *     ② 不同引擎标记不能串门（eslint 的标记对 semgrep 引擎无效）
 *     ③ 没有标记的 finding 必须**照常报**（映射写宽了会误豁免，比漏豁免更危险）
 * 另外两条本文件的硬约束：内置引擎行为与改造前**逐字一致**（deepEqual 对比）、
 *   全仓库只有 `lib/preprocess/exempt.js` 调用底层 `exemptForFinding`（自动门禁）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXEMPT_ENGINE_ADAPTERS, declaredExempts, exemptionOf, filterExempted,
  getEngineAdapter, loadIgnoreFingerprints, resolveExemptions, sourceMarkerExempts,
} from '../../lib/preprocess/exempt.js';
import { exemptForFinding } from '../../lib/exempt/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 造一个临时源码仓库，返回 { dir, path(file), text(file) }。 */
function makeFixtureRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-exempt-'));
  for (const [name, content] of Object.entries(files)) {
    const abs = join(dir, name);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return {
    dir,
    text: (name) => readFileSync(join(dir, name), 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('① 映射表 fixture：ESLint 标记作用「下一行」、Semgrep/Bandit 作用「本行」', () => {
  const repo = makeFixtureRepo({
    // ESLint：标记在上一行，finding 落下一行（2）⇒ 豁免；落第 3 行 ⇒ 不豁免
    'a-eslint.js': 'export const keep = 1;\n// eslint-disable-next-line no-console\nexport const risky = 2;\nexport const risky2 = 3;\n',
    // Semgrep：nosemgrep 与 finding 同行 ⇒ 豁免
    'b-semgrep.js': 'export const keep = 1;\nexport const risky = 2; // nosemgrep\n',
    // Bandit：`# nosec` 与 finding 同行 ⇒ 豁免
    'c-bandit.py': 'keep = 1\nrisky = 2  # nosec\n',
    // 无标记：必须照常报（防映射写宽导致误豁免）
    'd-plain.js': 'export const keep = 1;\nexport const risky = 2;\n',
  });
  try {
    const eslintText = repo.text('a-eslint.js');
    assert.equal(sourceMarkerExempts('eslint', eslintText, { line: 3 }), true, 'eslint-disable-next-line 应豁免下一行（3）');
    assert.equal(sourceMarkerExempts('eslint', eslintText, { line: 4 }), false, '只豁免紧接的一行（4 不该被豁免）');
    assert.equal(sourceMarkerExempts('eslint', eslintText, { line: 1 }), false, '标记之前的行不该被豁免');

    assert.equal(sourceMarkerExempts('semgrep', repo.text('b-semgrep.js'), { line: 2 }), true, 'nosemgrep 应豁免本行');
    assert.equal(sourceMarkerExempts('semgrep', repo.text('b-semgrep.js'), { line: 1 }), false, 'nosemgrep 不该豁免别的行');

    assert.equal(sourceMarkerExempts('bandit', repo.text('c-bandit.py'), { line: 2 }), true, '# nosec 应豁免本行');
    assert.equal(sourceMarkerExempts('bandit', repo.text('c-bandit.py'), { line: 1 }), false, '# nosec 不该豁免别的行');

    // 无标记：三种引擎都不豁免
    for (const engine of ['eslint', 'semgrep', 'bandit']) {
      assert.equal(sourceMarkerExempts(engine, repo.text('d-plain.js'), { line: 2 }), false, `${engine} 无标记时不得豁免`);
    }
  } finally { repo.cleanup(); }
});

test('① 标记不串门：别的引擎的标记对本引擎无效（不误豁免）', () => {
  const repo = makeFixtureRepo({
    'x.js': 'export const a = 1;\n// eslint-disable-next-line r\nexport const b = 2;\nexport const c = 3; // nosemgrep\nexport const d = 4; // nosemgrep\n',
  });
  try {
    const text = repo.text('x.js');
    // semgrep 引擎：只有 4 行的 nosemgrep 生效；3 行的 eslint 标记不生效
    assert.equal(sourceMarkerExempts('semgrep', text, { line: 3 }), false, 'eslint 标记对 semgrep 引擎无效');
    assert.equal(sourceMarkerExempts('semgrep', text, { line: 4 }), true, 'nosemgrep 对 semgrep 引擎生效');
    // eslint 引擎：3 行被 next-line 豁免；4/5 行的 nosemgrep 对 eslint 无效
    assert.equal(sourceMarkerExempts('eslint', text, { line: 3 }), true);
    assert.equal(sourceMarkerExempts('eslint', text, { line: 5 }), false, 'nosemgrep 对 eslint 引擎无效');
  } finally { repo.cleanup(); }
});

test('① 声明式（B）优先、读取式（A）兜底；supportsSuppressed=false 的引擎忽略声明', () => {
  const finding = { file: 'src/a.js', line: 12, rule: 'no-console' };
  // eslint 支持声明式：引擎自报 suppressed ⇒ 直接采信（哪怕源码里没有任何标记）
  const viaDeclared = exemptionOf(finding, { engine: 'eslint', text: 'const a = 1;\n', suppressed: [{ file: 'src/a.js', line: 12 }] });
  assert.deepEqual(viaDeclared, { exempted: true, reason: 'eslint:declared' });
  // 指纹形态也认（gitleaks 风格）
  assert.equal(declaredExempts([{ fingerprint: 'abc123' }], { fingerprint: 'abc123' }), true);
  assert.equal(declaredExempts([{ file: 'other.js', line: 12 }], finding), false, '文件不同不算命中');
  assert.equal(declaredExempts([{ file: 'src/a.js', line: 99 }], finding), false, '行号不同不算命中');
  // semgrep 不支持声明式：即便引擎自报 suppressed 也不采信（只能走读取式）
  assert.equal(getEngineAdapter('semgrep').supportsSuppressed, false);
  const ignored = exemptionOf(finding, { engine: 'semgrep', text: 'const a = 1;\n', suppressed: [{ file: 'src/a.js', line: 12 }] });
  assert.equal(ignored.exempted, false, '不支持声明式的引擎，自报 suppressed 应被忽略');
  // 单个 unknown 引擎：不崩、不猜（无标记即不豁免）
  assert.equal(exemptionOf(finding, { engine: 'mystery', text: 'x\n' }).exempted, false);
});

test('① 内置引擎行为与改造前逐字一致（resolveExemptions 结果与直接 exemptForFinding 等价）', () => {
  const qualityText = '<!-- dsh-skip-quality -->\n正文\n';
  const plainText = '正文\n';
  const findings = [
    { kind: 'blacklist', rule: 'x/y', line: 2, file: 'a.md' },
    { kind: 'min-occurrences', rule: 'docs/sep', line: 1, file: 'b.md' },
    { kind: 'regex', rule: 'readability/max-lines', line: 3, file: 'c.md' },
  ];
  // 改造前：逐条直接问底层
  const legacy = findings.map((finding) => {
    const text = finding.file === 'a.md' ? qualityText : plainText;
    return exemptForFinding(finding, text) === true;
  });
  // 改造后：经中间层（同一个 text 口径）
  const next = findings.map((finding) => {
    const text = finding.file === 'a.md' ? qualityText : plainText;
    return exemptionOf(finding, { engine: 'builtin', text }).exempted;
  });
  assert.deepEqual(next, legacy, '内置引擎下新旧判定必须逐条一致');
  assert.deepEqual(legacy, [true, false, false], '样本应至少命中一条（否则这条对比没意义）');

  // 数组级：filterExempted 与「逐条 exemptForFinding === false」等价
  const texts = { 'a.md': qualityText, 'b.md': plainText, 'c.md': plainText };
  const legacyFiltered = findings.filter((finding) => exemptForFinding(finding, texts[finding.file]) === false);
  const nextFiltered = filterExempted(findings, { engine: 'builtin', textOf: (file) => texts[file] || '' });
  assert.deepEqual(nextFiltered, legacyFiltered, 'filterExempted 必须与旧过滤写法等价');

  // 标注形态：不过滤，仅打标（供报告追溯）
  const annotated = resolveExemptions(findings, { engine: 'builtin', textOf: (file) => texts[file] || '' });
  assert.equal(annotated.length, findings.length, 'resolveExemptions 只标注不过滤');
  assert.equal(annotated[0].exempted, true);
  assert.equal(annotated[0].exemptReason, 'builtin:native');
  assert.equal(annotated[1].exempted, undefined, '未被豁免的不加字段（避免污染既有输出）');
});

test('① gitleaks 忽略文件：读指纹集合，缺失文件不崩', () => {
  const repo = makeFixtureRepo({
    '.gitleaksignore': '# 注释行\nabc123\n\ndef456\n',
  });
  try {
    const fingerprints = loadIgnoreFingerprints(repo.dir);
    assert.equal(fingerprints.has('abc123'), true);
    assert.equal(fingerprints.has('def456'), true);
    assert.equal(fingerprints.has('# 注释行'), false, '注释不进集合');
    assert.equal(loadIgnoreFingerprints(join(repo.dir, 'nope')).size, 0, '缺文件返回空集合');
  } finally { repo.cleanup(); }
});

test('① 适配器表覆盖文档 §4.3 的全部引擎（新增引擎只加一行）', () => {
  const ids = EXEMPT_ENGINE_ADAPTERS.map((adapter) => adapter.id);
  for (const expected of ['builtin', 'eslint', 'semgrep', 'bandit', 'gitleaks']) {
    assert.ok(ids.includes(expected), `适配器表应含 ${expected}`);
  }
  assert.equal(getEngineAdapter('eslint').supportsSuppressed, true);
  assert.equal(getEngineAdapter('builtin').native, true);
  assert.deepEqual(getEngineAdapter('gitleaks').ignoreFiles, ['.gitleaksignore']);
});

test('③ 自动门禁：全仓库只有 lib/preprocess/exempt.js 调用 exemptForFinding', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!/\.(js|mjs)$/.test(entry.name)) continue;
      const rel = abs.slice(ROOT.length + 1);
      if (rel === 'lib/exempt/index.js') continue;        // 定义处
      if (rel === 'lib/preprocess/exempt.js') continue;   // 唯一编排调用处
      for (const line of readFileSync(abs, 'utf8').split('\n')) {
        if (/exemptForFinding\s*\(/.test(line) && !/^\s*(\*|\/\/)/.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 80)}`);
      }
    }
  };
  walk(join(ROOT, 'lib'));
  walk(join(ROOT, 'scripts'));
  assert.deepEqual(offenders, [], `以下位置仍在直接调用 exemptForFinding：\n${offenders.join('\n')}`);
});
