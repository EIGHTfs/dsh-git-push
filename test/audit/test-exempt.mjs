/**
 * test-exempt.mjs —— 同族测试合并（test-exempt-hint-classify.mjs · test-exempt-hint-effective.mjs · test-exempt-tool.mjs · test-exempt.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { normalizeExemptHints } from '../../lib/audit/finding.js';
import { auditFull } from '../../lib/audit/index.js';
import { auditWithScope } from '../../lib/audit/orchestrate.js';
import { pickExemptHint } from '../../lib/checks/regex.js';
import { EXEMPT_MARKERS, exemptForFinding, exemptHintForFinding, exemptMarkerCovers, hasHeaderExempt, hasLineExempt, exemptHintFor, isSampleExemptDir, isTestExemptDir } from '../../lib/exempt/index.js';
import { addExempt, removeExempt, listExempt, checkExempt } from '../../lib/exempt/tool.js';
import { scanSensitiveFiles } from '../../lib/git/index.js';
import { mkdtempTracked } from '../helpers/tmp-dir.mjs';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-exempt-hint-classify.mjs ──
{
  // 豁免提示分类回归：正则类 finding 的 exemptHint 必须与该规则**实际能被哪个标记豁免**一致。
  //
  // 事故（用户实测报告）：lib/checks/regex.js 此前只区分 `[FUNC]` / `credential-ref` 两种 kind，
  //   其余正则规则一律提示 `dsh-skip-residue` ⇒ 安全类（security/credential/secret/password/hardcoded）
  //   与风格类（min-length/max-lines…）按提示写了 residue 标记**并不会豁免**
  //   （residue 只覆盖 debugger/todo/console/io-risk/client-node-builtin-require），提示与行为不符。


  test('[exempt-hint-classify] 安全类正则规则 → dsh-skip-sensitive（不再误提示 residue）', () => {
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

  test('[exempt-hint-classify] 残留类 / 风格类正则规则各归其位', () => {
    assert.match(pickExemptHint({ id: 'nodejs/no-console-log', kind: 'regex' }), /dsh-skip-residue/);
    assert.match(pickExemptHint({ id: 'robustness/io-risk', kind: 'regex' }), /dsh-skip-residue/);
    assert.match(pickExemptHint({ id: 'readability/max-lines', kind: 'regex' }), /dsh-skip-style/);
  });

  test('[exempt-hint-classify] 提示词与行为一致：各 kind 按其提示写标记都能豁免', () => {
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

  test('[exempt-hint-classify] 提示关键词必须真的能豁免：blacklist 类写 dsh-skip-quality 生效', () => {
    const finding = {
      file: 'a.md', line: 2, rule: 'documentation/comment-suspicious-detection',
      kind: 'blacklist', severity: 'blocker', dimensions: ['文档'],
    };
    const text = '<!-- dsh-skip-quality -->\n正文\n';
    assert.equal(exemptForFinding(finding, text), true,
      '文件头写 dsh-skip-quality 应能豁免 blacklist 类 finding（提示与行为一致）');
  });

  test('[exempt-hint-classify] 提示关键词必须是豁免注册表里真实存在的标记（防写错关键词）', () => {
    const names = Object.keys(EXEMPT_MARKERS);
    for (const rule of [{ id: 'security/secret-x' }, { id: 'nodejs/todo-comment' }, { id: 'readability/min-length' }]) {
      const hint = pickExemptHint(rule);
      const marker = String(hint).split('（')[0].trim();
      assert.ok(names.includes(marker), `${rule.id} 的提示关键词 ${marker} 必须存在于 EXEMPT_MARKERS`);
    }
  });
}

// ── 原 test-exempt-hint-effective.mjs ──
{
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


  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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

  test('[exempt-hint-effective] 反查到的标记必定真能豁免（文件头生效）——覆盖历史 24 种不一致组合', () => {
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

  test('[exempt-hint-effective] 安全类 finding 不得被 dsh-skip-quality 吞掉（回归：质量兜底覆盖 regex 后的边界）', () => {
    const text = 'const k = "AKIA1234567890ABCDEF";\n';
    const securityFinding = { file: 'lib/x.js', line: 1, rule: 'security/credential-leak', kind: 'regex' };
    assert.equal(exemptMarkerCovers('dsh-skip-quality', securityFinding), false,
      'security/* 的 regex finding 不能被质量标记覆盖（必须走 dsh-skip-sensitive）');
    assert.equal(exemptForFinding(securityFinding, withHeader(text, 'dsh-skip-quality')), false,
      '写了 dsh-skip-quality 也不该豁免安全类 finding');
    assert.equal(exemptForFinding(securityFinding, withHeader(text, 'dsh-skip-sensitive')), true,
      '安全类应能由 dsh-skip-sensitive 豁免（原能力不能退化）');
  });

  test('[exempt-hint-effective] normalizeExemptHints：校正失效提示 + 幂等 + 保留仍有效的提示', () => {
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

  test('[exempt-hint-effective] 端到端：真实审计的每条 finding，其提示的标记放到文件头都能真豁免', async () => {
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
}

// ── 原 test-exempt-tool.mjs ──
{
  /** exempt 工具回归：add/remove/list/check（离线，临时目录）。 */


  function makeRepo() {
    return mkdtempSync(join(tmpdir(), 'dshgp-exempt-'));
  }

  test('[exempt-tool] add：header 模式按 rule 自动选标记并写入文件头', async () => {
    const dir = makeRepo();
    try {
      const f = join(dir, 'a.js');
      writeFileSync(f, 'const a = 1;\n');
      const r = await addExempt({ repoPath: dir, path: 'a.js', rule: 'maintainability/max-complexity', reason: '天然多分支' });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.match(readFileSync(f, 'utf8'), /^\/\/ dsh-skip-complexity: 天然多分支/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('[exempt-tool] add：显式 marker 与 rule 冲突 ⇒ 拒绝并给正确标记', async () => {
    const dir = makeRepo();
    try {
      const f = join(dir, 'a.js');
      writeFileSync(f, 'x\n');
      const r = await addExempt({ repoPath: dir, path: 'a.js', marker: 'dsh-skip-size', rule: 'maintainability/max-complexity' });
      assert.equal(r.ok, false);
      assert.match(r.error, /dsh-skip-complexity/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('[exempt-tool] add：line 越界拒绝（且不写入）', async () => {
    const dir = makeRepo();
    try {
      const f = join(dir, 'a.js');
      writeFileSync(f, 'a\nb\n');
      const r = await addExempt({ repoPath: dir, path: 'a.js', rule: 'maintainability/max-complexity', scope: 'line', line: 99 });
      assert.equal(r.ok, false);
      assert.equal(readFileSync(f, 'utf8'), 'a\nb\n', '校验失败时不应写盘');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('[exempt-tool] remove：幂等（没有标记也返回 unchanged）', () => {
    const dir = makeRepo();
    try {
      const f = join(dir, 'a.js');
      writeFileSync(f, 'x\n');
      const r1 = removeExempt({ repoPath: dir, path: 'a.js' });
      assert.equal(r1.ok, true);
      assert.equal(r1.results[0].unchanged, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('[exempt-tool] list：盘点文件里的 dsh-skip 标记', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'a.js'), '// dsh-skip-complexity: x\nconst a = 1;\n');
      writeFileSync(join(dir, 'b.js'), 'const b = 1; // dsh-skip-quality\n');
      const r = listExempt({ repoPath: dir });
      assert.equal(r.ok, true);
      assert.equal(r.total, 2);
      assert.ok(r.items.some((i) => i.marker === 'dsh-skip-complexity'));
      assert.ok(r.items.some((i) => i.marker === 'dsh-skip-quality'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('[exempt-tool] check：未知标记被判为 issue', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'a.js'), '// dsh-skip-nonsense: x\nconst a = 1;\n');
      const r = checkExempt({ repoPath: dir });
      assert.equal(r.ok, false);
      assert.ok(r.issues.some((i) => i.issue === 'unknown-marker'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// ── 原 test-exempt.mjs ──
{
  // dsh-skip-sensitive: 测试 fixture 含 mock token 字面量（ghp_ 非真实凭据）
  // dsh-skip-residue: 测试 fixture 含 debugger 关键词样本（规则定义示范文本）
  /**
   * 豁免总入口测试（0.1.6）：7 标记全消费 + 位置语义（文件头整文件 / 行内单点）逐类验证。
   * 场景对照：12 个豁免场景（文件头 sensitive/size/func-length/syntax/quality/residue/style
   * + 行尾 sensitive/residue/func-length 单点 + 豁免不越权 + 未豁免照常报）。
   */


  /** 构造最小 finding。 */
  function f(kind, rule, line = 3) {
    return { file: 'a.js', line, rule: rule || kind, kind, severity: kind.startsWith('[FUNC]') ? 'blocker' : 'warning', dimensions: [], exemptHint: '', scoreImpact: 1 };
  }

  const SENSITIVE_TEXT = '// dsh-skip-sensitive: 测试含 mock token\n// 第二行\n// 第三行\nconst x = 1;';

  // ---------- 注册表完整性 ----------
  test('[exempt] 注册表：9 个标记齐全', () => {
    const markers = Object.keys(EXEMPT_MARKERS);
    assert.deepEqual(markers.sort(), [
      'dsh-skip-complexity', 'dsh-skip-func-length', 'dsh-skip-i18n', 'dsh-skip-quality', 'dsh-skip-residue',
      'dsh-skip-sensitive', 'dsh-skip-size', 'dsh-skip-style', 'dsh-skip-syntax',
    ].sort());
  });

  test('[exempt] 注册表：每个标记都有 blocked 声明与 hint', () => {
    for (const [m, meta] of Object.entries(EXEMPT_MARKERS)) {
      assert.ok(Array.isArray(meta.blocked) && meta.blocked.length > 0, `${m} 缺 blocked`);
      assert.ok(typeof meta.hint === 'string' && meta.hint.length > 0, `${m} 缺 hint`);
    }
  });

  test('[exempt] 注册表：sensitive/quality/func-length/residue 支持行级', () => {
    assert.equal(EXEMPT_MARKERS['dsh-skip-sensitive'].lineLevel, true);
    assert.equal(EXEMPT_MARKERS['dsh-skip-quality'].lineLevel, false);
    assert.equal(EXEMPT_MARKERS['dsh-skip-residue'].lineLevel, true);
    assert.equal(EXEMPT_MARKERS['dsh-skip-func-length'].lineLevel, true);
  });

  // ---------- 文件头豁免（整文件）----------
  test('[exempt] 文件头 dsh-skip-sensitive → secret 整文件豁免', () => {
    assert.equal(hasHeaderExempt(SENSITIVE_TEXT, 'dsh-skip-sensitive'), true);
    assert.equal(exemptForFinding(f('[FUNC]', 'secret-aws-access-key'), SENSITIVE_TEXT), true);
    assert.equal(exemptForFinding(f('credential-ref', 'secret-generic-token'), SENSITIVE_TEXT), true);
    assert.equal(exemptForFinding(f('path-regex', 'path-private-key-location'), SENSITIVE_TEXT), true);
  });

  test('[exempt] 文件头 dsh-skip-sensitive → credential-file 豁免', () => {
    assert.equal(exemptForFinding(f('credential-file', 'credfile-key-file'), SENSITIVE_TEXT), true);
  });

  test('[exempt] 文件头 dsh-skip-func-length → func-lines 整文件豁免', () => {
    const t = '// dsh-skip-func-length\nfunction a() {}\nfunction b() {}';
    assert.equal(exemptForFinding(f('func-lines', 'func-lines', 2), t), true);
  });

  test('[exempt] 文件头 dsh-skip-quality → empty-catch/sync-fs/func-lines 豁免', () => {
    const t = '// dsh-skip-quality\nconst x = 1;';
    assert.equal(exemptForFinding(f('empty-catch', 'quality/empty-catch'), t), true);
    assert.equal(exemptForFinding(f('sync-fs', 'quality/sync-fs'), t), true);
    assert.equal(exemptForFinding(f('func-lines', 'func-lines'), t), true);
  });

  test('[exempt] 文件头 dsh-skip-residue → debugger/console/todo 残留豁免', () => {
    const t = '// dsh-skip-residue\nconst x = 1;';
    assert.equal(exemptForFinding(f('regex', 'style-debugger'), t), true);
    assert.equal(exemptForFinding(f('regex', 'style-console-log'), t), true);
    assert.equal(exemptForFinding(f('regex', 'style-todo-remark'), t), true);
  });

  test('[exempt] 文件头 dsh-skip-style → style-* 数值规则豁免', () => {
    const t = '// dsh-skip-style\nconst x = 1;';
    assert.equal(exemptForFinding(f('regex', 'style-min-length'), t), true);
    assert.equal(exemptForFinding(f('regex', 'style-max-complexity'), t), true);
    assert.equal(exemptForFinding(f('regex', 'style-repeated-string'), t), true);
  });

  test('[exempt] 文件头 dsh-skip-size → large-file/binary 豁免（位置语义：只能文件头）', () => {
    const t = '// dsh-skip-size\nconst x = 1;';
    assert.equal(exemptForFinding(f('large-file', 'binary-large-file'), t), true);
    assert.equal(exemptForFinding(f('binary', 'binary-file'), t), true);
    // 行级不支持（lineLevel=false）：标记写在第 4 行（前 3 行文件头之外）→ 不豁免
    const t2 = [
      'const a = 1;',
      'const b = 2;',
      'const c = 3;',
      'const x = 1; // dsh-skip-size（第 4 行，非文件头，无效）',
    ].join('\n');
    assert.equal(exemptForFinding(f('large-file', 'binary-large-file', 4), t2), false);
  });

  test('[exempt] 文件头 dsh-skip-i18n → i18n/* 整文件豁免 + 行尾单点豁免（1.0.4）', () => {
    const t = '// dsh-skip-i18n\nconst x = 1;';
    assert.equal(exemptForFinding(f('regex', 'i18n/hardcoded-user-visible'), t), true);
    assert.equal(exemptForFinding(f('regex', 'i18n/concat-in-t'), t), true);
    // 行尾单点：标记须在前 3 行之外（第 4 行起才是单点）
    const t2 = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst msg = "hello"; // dsh-skip-i18n\nconst d = 4;';
    const lineHit = exemptForFinding(f('regex', 'i18n/hardcoded-user-visible', 4), t2);
    assert.equal(lineHit, true, '标记行应豁免');
    // 其他行照报
    assert.equal(exemptForFinding(f('regex', 'i18n/hardcoded-user-visible', 5), t2), false, '其他行照报');
    // 文件头内（前 3 行）的标记=整文件豁免，第 4 行也豁免
    const t3 = 'const a = 1; // dsh-skip-i18n\nconst b = 2;\nconst c = 3;\nconst msg = "hello";';
    assert.equal(exemptForFinding(f('regex', 'i18n/hardcoded-user-visible', 4), t3), true, '前 3 行标记=整文件豁免');
    // 非 i18n 规则不受影响
    assert.equal(exemptForFinding(f('regex', 'debugger-statement'), t), false, '非 i18n 规则不豁免');
  });

  test('[exempt] 文件头 dsh-skip-syntax → syntax/json-parse/yaml-parse 豁免', () => {
    const t = '// dsh-skip-syntax\n{"bad": broken';
    assert.equal(exemptForFinding(f('syntax', 'syntax-js-error'), t), true);
    assert.equal(exemptForFinding(f('json-parse', 'syntax-json'), t), true);
    assert.equal(exemptForFinding(f('yaml-parse', 'syntax-yaml'), t), true);
  });

  // ---------- 行内单点豁免 ----------
  test('[exempt] 行尾 dsh-skip-sensitive → 仅本行豁免，其他行照报（标记须在前 3 行之外才是单点）', () => {
    const t = [
      'const a = 1;',
      'const b = 2;',
      'const c = 3;',
      'const token = "ghp_1234567890abcdefghij"; // dsh-skip-sensitive',
      'const d = token;',
    ].join('\n');
    assert.equal(exemptForFinding(f('[FUNC]', 'secret-generic-token', 4), t), true, '标记行应豁免');
    assert.equal(exemptForFinding(f('[FUNC]', 'secret-generic-token', 5), t), false, '无标记行不应豁免');
    // 标记在第 2 行（前 3 行内）= 文件头 → 整文件豁免（符合设计，非单点）
    const t2 = [
      'const a = 1;',
      'const token = "ghp_1234567890abcdefghij"; // dsh-skip-sensitive',
      'const b = token;',
    ].join('\n');
    assert.equal(exemptForFinding(f('[FUNC]', 'secret-generic-token', 3), t2), true, '前 3 行内标记=文件头豁免整文件');
  });

  test('[exempt] 行尾 dsh-skip-func-length → 函数定义行豁免单函数', () => {
    const t = [
      'function longFn() { // dsh-skip-func-length',
      '  x();',
      '}',
    ].join('\n');
    assert.equal(exemptForFinding(f('func-lines', 'func-lines', 1), t), true);
    // 文件头无标记、其他函数不受影响
    const t2 = 'function other() { x(); } // 无标记';
    assert.equal(exemptForFinding(f('func-lines', 'func-lines', 1), t2), false);
  });

  test('[exempt] 行尾 dsh-skip-residue → 本行 debugger 豁免', () => {
    const t = 'debugger; // dsh-skip-residue';
    assert.equal(exemptForFinding(f('regex', 'style-debugger', 1), t), true);
  });

  // ---------- 豁免不越权 ----------
  test('[exempt] 豁免不越权：sensitive 文件头不影响 func-lines/质量检查', () => {
    assert.equal(exemptForFinding(f('func-lines', 'func-lines', 3), SENSITIVE_TEXT), false);
    assert.equal(exemptForFinding(f('empty-catch', 'quality/empty-catch', 3), SENSITIVE_TEXT), false);
    assert.equal(exemptForFinding(f('sync-fs', 'quality/sync-fs', 3), SENSITIVE_TEXT), false);
  });

  test('[exempt] 豁免不越权：quality 文件头不影响 secret', () => {
    const t = '// dsh-skip-quality\nconst x = 1;';
    assert.equal(exemptForFinding(f('[FUNC]', 'secret-generic-token', 3), t), false);
  });

  test('[exempt] 豁免不越权：style 文件头不影响空 catch', () => {
    const t = '// dsh-skip-style\nconst x = 1;';
    assert.equal(exemptForFinding(f('empty-catch', 'quality/empty-catch', 3), t), false);
  });

  test('[exempt] 豁免不越权：文件头第 4 行标记不豁免（仅前 3 行）', () => {
    const t = [
      'const a = 1;',
      'const b = 2;',
      'const c = 3;',
      '// dsh-skip-sensitive（第 4 行无效）',
    ].join('\n');
    assert.equal(exemptForFinding(f('[FUNC]', 'secret-generic-token', 2), t), false);
  });

  test('[exempt] 无豁免标记 → 全部照报', () => {
    const t = 'const x = 1;';
    assert.equal(exemptForFinding(f('[FUNC]', 'secret-generic-token', 1), t), false);
    assert.equal(exemptForFinding(f('func-lines', 'func-lines', 1), t), false);
    assert.equal(exemptForFinding(f('empty-catch', 'quality/empty-catch', 1), t), false);
  });

  // ---------- exemptHintFor（查找提示） ----------
  test('[exempt] exemptHintFor：secret 反查 sensitive 提示', () => {
    const hint = exemptHintFor('[FUNC]');
    assert.ok(hint.includes('dsh-skip-sensitive'));
  });

  test('[exempt] exemptHintFor：func-lines 反查（sensitive 先命中 blocked 也含 func？应给敏感优先）', () => {
    // blocked 枚举顺序：sensitive 不含 func-lines → 应命中 func-length 或 quality
    const hint = exemptHintFor('func-lines');
    assert.ok(hint.includes('dsh-skip-func-length') || hint.includes('dsh-skip-quality'));
  });

  test('[exempt] exemptHintFor：未知 kind 给默认敏感提示', () => {
    assert.ok(exemptHintFor('unknown-kind').includes('dsh-skip-sensitive'));
  });

  // ---------- 12 场景计数 ----------
  test('[exempt] 场景矩阵：整文件 8 标记 + 行级 5 标记 = 13+ 场景全覆盖', () => {
    const headerMarkers = ['dsh-skip-sensitive', 'dsh-skip-size', 'dsh-skip-func-length', 'dsh-skip-syntax', 'dsh-skip-quality', 'dsh-skip-residue', 'dsh-skip-style', 'dsh-skip-i18n'];
    const lineMarkers = Object.entries(EXEMPT_MARKERS).filter(([, m]) => m.lineLevel).map(([k]) => k);
    // 整文件 8 场景
    for (const m of headerMarkers) {
      assert.equal(hasHeaderExempt(`// ${m}\nx`, m), true, `${m} 文件头应豁免`);
    }
    // 行级 5 场景（sensitive/func-length/complexity/residue/i18n）
    assert.deepEqual(lineMarkers.sort(), ['dsh-skip-complexity', 'dsh-skip-func-length', 'dsh-skip-i18n', 'dsh-skip-residue', 'dsh-skip-sensitive'].sort());
    // 对应位置标记应豁免（行级标记在行内生效）
    for (const m of lineMarkers) {
      assert.equal(hasLineExempt(`const x = 1; // ${m}`, m), true, `${m} 行内应生效`);
    }
  });

  // ---------- 端到端（auditFile 正确消费） ----------
  async function compileGrouped() {
    const { loadRuleFiles } = await import('../../lib/rule/loader.js');
    const { compileAllRules } = await import('../../lib/rule/registry.js');
    const { groupByKind } = await import('../../lib/audit/checks.js');
    import('../../lib/rule/compilers.js');
    const loaded = loadRuleFiles(['nodejs']);
    const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
    return groupByKind(compiled);
  }

  test('[exempt] 端到端：dsh-skip-sensitive 文件头 → secret 不进入 findings', async () => {
    const { auditFile } = await import('../../lib/audit/index.js');
    const grouped = await compileGrouped();
    const text = '// dsh-skip-sensitive: mock 测试\nconst token = "ghp_1234567890abcdefghij";\nconst aws = "AKIA1234567890ABCDEF";';
    const findings = auditFile({ file: 't.mjs', relPath: 't.mjs', text, grouped });
    const secrets = findings.filter((x) => x.kind.includes('[FUNC]') || x.kind === 'path-regex');
    assert.equal(secrets.length, 0, `sensitive 文件头应豁免全部 secret，实际 ${secrets.length}`);
  });

  test('[exempt] 端到端：无豁免 → secret 照常 block', async () => {
    const { auditFile } = await import('../../lib/audit/index.js');
    const grouped = await compileGrouped();
    const text = 'const token = "ghp_1234567890abcdefghij";';
    const findings = auditFile({ file: 't.mjs', relPath: 't.mjs', text, grouped });
    const secrets = findings.filter((x) => x.kind.includes('[FUNC]'));
    assert.ok(secrets.length > 0, '无豁免时应报 secret');
  });

  // ---------- 标记注册 / 头行判定 / 反查（原 test-framework）----------
  test('[exempt] 豁免：9 类标记注册齐全', () => {
    assert.equal(Object.keys(EXEMPT_MARKERS).length, 9);
    assert.ok(EXEMPT_MARKERS['dsh-skip-sensitive']);
    assert.ok(EXEMPT_MARKERS['dsh-skip-func-length']);
    assert.ok(EXEMPT_MARKERS['dsh-skip-complexity']);
  });

  test('[exempt] 豁免：文件头检测只看前 3 行', () => {
    const text = '// dsh-skip-sensitive: 测试\nconst a = 1;\n';
    assert.equal(hasHeaderExempt(text, 'dsh-skip-sensitive'), true);
    assert.equal(hasHeaderExempt('line1\nline2\nline3\nline4 dsh-skip-sensitive', 'dsh-skip-sensitive'), false);
  });

  test('[exempt] 豁免：行级检测', () => {
    assert.equal(hasLineExempt('const x = 1; // dsh-skip-sensitive', 'dsh-skip-sensitive'), true);
    assert.equal(hasLineExempt('const x = 1;', 'dsh-skip-sensitive'), false);
  });

  test('[exempt] 豁免：exemptHintFor 反查 non-empty', () => {
    const hint = exemptHintFor('func-lines');
    assert.ok(typeof hint === 'string' && hint.length > 0);
    assert.match(hint, /dsh-skip-func-length/);
  });

  // ---------- 2026-09-11：.samples 空文件目录豁免 ----------
  test('[exempt] 目录豁免：.samples 空文件豁免整个所在目录（含子目录）', () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-exempt-dir-'));
    try {
      // 标记目录 marked/ 放 .samples 空文件
      mkdirSync(join(root, 'marked', 'sub', 'deep'), { recursive: true });
      writeFileSync(join(root, 'marked', '.samples'), '');
      writeFileSync(join(root, 'marked', 'a.js'), 'const a = 1;');
      writeFileSync(join(root, 'marked', 'sub', 'b.js'), 'const b = 2;');
      writeFileSync(join(root, 'marked', 'sub', 'deep', 'c.js'), 'const c = 3;');
      // 非标记目录
      mkdirSync(join(root, 'plain'), { recursive: true });
      writeFileSync(join(root, 'plain', 'p.js'), 'const p = 4;');
      writeFileSync(join(root, 'root.js'), 'const r = 5;');

      assert.equal(isSampleExemptDir(root, 'marked/a.js'), true, '标记目录内文件豁免');
      assert.equal(isSampleExemptDir(root, 'marked/sub/b.js'), true, '标记目录子目录豁免');
      assert.equal(isSampleExemptDir(root, 'marked/sub/deep/c.js'), true, '标记目录孙目录豁免');
      assert.equal(isSampleExemptDir(root, 'plain/p.js'), false, '非标记目录不豁免');
      assert.equal(isSampleExemptDir(root, 'root.js'), false, '仓库根（无标记时）不豁免');
      assert.equal(isSampleExemptDir(root, 'marked/'), true, '标记目录本身豁免');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('[exempt] 目录豁免：仓库根放 .samples 空文件 → 全部豁免', () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-exempt-root-'));
    try {
      writeFileSync(join(root, '.samples'), '');
      mkdirSync(join(root, 'sub'), { recursive: true });
      writeFileSync(join(root, 'sub', 'x.js'), 'const x = 1;');
      assert.equal(isSampleExemptDir(root, 'sub/x.js'), true, '根标记传播到子目录');
      assert.equal(isSampleExemptDir(root, 'sub/y.js'), true, '根标记传播到任意文件');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('[exempt] 目录豁免：防逃逸 / 非空标记不豁免 / 空 relPath', () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-exempt-safe-'));
    try {
      mkdirSync(join(root, 'd'), { recursive: true });
      writeFileSync(join(root, 'd', '.samples'), 'not-empty'); // 非空 → 不是豁免标记
      writeFileSync(join(root, 'd', 'f.js'), 'const f = 1;');
      assert.equal(isSampleExemptDir(root, 'd/f.js'), false, '非空 .samples 不是豁免标记');
      assert.equal(isSampleExemptDir(root, '../outside.js'), false, '../ 逃逸不豁免');
      assert.equal(isSampleExemptDir(root, ''), false, '空 relPath 返回 false');
      assert.equal(isSampleExemptDir('', 'a.js'), false, '空 repoPath 返回 false');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ---------- 2026-09-11：.test 空文件目录豁免（扫描跳过，比 .samples 更强） ----------
  test('[exempt] 目录豁免：.test 空文件整目录扫描跳过（含子目录）', () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-testdir-'));
    try {
      mkdirSync(join(root, 'marked', 'sub', 'deep'), { recursive: true });
      writeFileSync(join(root, 'marked', '.test'), '');
      writeFileSync(join(root, 'marked', 'a.js'), 'const a = 1;');
      writeFileSync(join(root, 'marked', 'sub', 'b.js'), 'const b = 2;');
      writeFileSync(join(root, 'marked', 'sub', 'deep', 'c.js'), 'const c = 3;');
      mkdirSync(join(root, 'plain'), { recursive: true });
      writeFileSync(join(root, 'plain', 'p.js'), 'const p = 4;');
      writeFileSync(join(root, 'root.js'), 'const r = 5;');

      assert.equal(isTestExemptDir(root, 'marked/a.js'), true, '标记目录内文件跳过');
      assert.equal(isTestExemptDir(root, 'marked/sub/b.js'), true, '标记目录子目录跳过');
      assert.equal(isTestExemptDir(root, 'marked/sub/deep/c.js'), true, '标记目录孙目录跳过');
      assert.equal(isTestExemptDir(root, 'plain/p.js'), false, '非标记目录不跳过');
      assert.equal(isTestExemptDir(root, 'root.js'), false, '仓库根（无标记时）不跳过');
      assert.equal(isTestExemptDir(root, 'marked/'), true, '标记目录本身跳过');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('[exempt] 目录豁免：.test 仓库根标记全跳 + 非空/逃逸/空参数不跳', () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-testroot-'));
    try {
      writeFileSync(join(root, '.test'), '');
      mkdirSync(join(root, 'sub'), { recursive: true });
      writeFileSync(join(root, 'sub', 'x.js'), 'const x = 1;');
      assert.equal(isTestExemptDir(root, 'sub/x.js'), true, '根标记传播到子目录');

      const root2 = mkdtempSync(join(tmpdir(), 'gp-testroot2-'));
      try {
        mkdirSync(join(root2, 'd'), { recursive: true });
        writeFileSync(join(root2, 'd', '.test'), 'not-empty');
        writeFileSync(join(root2, 'd', 'f.js'), 'const f = 1;');
        assert.equal(isTestExemptDir(root2, 'd/f.js'), false, '非空 .test 不是跳过标记');
        assert.equal(isTestExemptDir(root2, '../outside.js'), false, '../ 逃逸不跳过');
        assert.equal(isTestExemptDir(root2, ''), false, '空 relPath 返回 false');
        assert.equal(isTestExemptDir('', 'a.js'), false, '空 repoPath 返回 false');
      } finally {
        rmSync(root2, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('[exempt] 集成：.test 目录在 auditFull 与 scanSensitiveFiles 均被跳过', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-testint-'));
    try {
      mkdirSync(join(root, 'bad'), { recursive: true });
      mkdirSync(join(root, 'tested'), { recursive: true });
      writeFileSync(join(root, 'tested', '.test'), '');
      writeFileSync(join(root, 'bad', 'bad.js'), 'API_KEY = "ghp_BADBADBAD"');
      writeFileSync(join(root, 'tested', 'bad.js'), 'API_KEY = "ghp_SKIPSKIPSKIP"');

      const auditRes = await auditFull(root);
      const testedAudit = auditRes.findings.filter((f) => String(f.file).includes('tested/'));
      assert.equal(testedAudit.length, 0, '.test 目录审计 0 finding');
      const badAudit = auditRes.findings.filter((f) => String(f.file).includes('bad/'));
      assert.ok(badAudit.length > 0, '非豁免目录照常出审计 finding');
      const hits = await scanSensitiveFiles(root);
      assert.equal(hits.filter((h) => h.path.includes('tested/')).length, 0, '.test 目录敏感扫描跳过');
      assert.equal(hits.filter((h) => h.path.includes('bad/')).length, 1, '非豁免目录敏感扫描照常命中');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  // 缓存实测标记：验证内容变会让缓存精确失效（保留无害）
}
