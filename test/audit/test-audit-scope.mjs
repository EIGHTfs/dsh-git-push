/**
 * test-audit-scope.mjs —— 同族测试合并（test-audit-defaults.mjs · test-audit-empty.mjs · test-audit-ext.mjs · test-audit-scope.mjs · test-audit-slot-order.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { checkPlaceholderCredentialAst, isMeaningfulCredentialValue } from '../../lib/ast/index.js';
import { FUNC_LINES_DEFAULT, HEALTH_BASE_SCORE, HEALTH_MIN_SCORE, HEALTH_WARN_SCORE, HEALTH_BLOCK_SCORE } from '../../lib/audit-defaults.js';
import { filterRulesByExt } from '../../lib/audit/checks.js';
import { loadAuditExt, runAuditExt, DEFAULT_EXT_DIR } from '../../lib/audit/ext-runner.js';
import { auditFull } from '../../lib/audit/orchestrate.js';
import { findingsToYaml } from '../../lib/audit/report-yaml.js';
import '../../lib/rule/compilers.js';
import { loadRuleFiles } from '../../lib/rule/loader.js';
import { compileAllRules } from '../../lib/rule/registry.js';
import { scoreQuality } from '../../lib/score/index.js';
import { mkdtempTracked } from '../helpers/tmp-dir.mjs';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-audit-defaults.mjs ──
{
  // 审计默认值单一来源回归：同一默认阈值不得在检查层与规则编译层各写一份。
  //
  // 事故背景：FUNC_LINES_DEFAULT = 50 曾在 lib/checks/structural.js 与 lib/rule/compilers/func.js
  //   各写一份（自审 maintainability/duplicate-constant-def 报的真重复）——两处必须永远相等，
  //   漏改一处就会出现「编译器按 50 收口、检查器按别的值判定」这类静默不一致。


  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');

  test('[audit-defaults] 审计默认值是单一来源：两处都 import，不再各自定义', () => {
    assert.equal(FUNC_LINES_DEFAULT, 50, '默认值本身应为 50');
    const checker = read('lib/checks/structural.js');
    const compiler = read('lib/rule/compilers/func.js');
    assert.match(checker, /import \{[^}]*FUNC_LINES_DEFAULT[^}]*\} from '\.\.\/audit-defaults\.js'/, '检查层应从公共模块导入');
    assert.match(compiler, /import \{[^}]*FUNC_LINES_DEFAULT[^}]*\} from '\.\.\/\.\.\/audit-defaults\.js'/, '编译层应从公共模块导入');
    assert.ok(!/^const FUNC_LINES_DEFAULT = 50/m.test(checker), '检查层不得再本地定义');
    assert.ok(!/^const FUNC_LINES_DEFAULT = 50/m.test(compiler), '编译层不得再本地定义');
  });

  test('[audit-defaults] 健康度分档常量已收口到公共模块（供后续接入 file-health 两处）', () => {
    assert.deepEqual(
      [HEALTH_BASE_SCORE, HEALTH_MIN_SCORE, HEALTH_WARN_SCORE, HEALTH_BLOCK_SCORE],
      [10, 0.1, 9, 5],
      '分档默认值应与既有实现一致（10 / 0.1 / 9 / 5）',
    );
  });
}

// ── 原 test-audit-empty.mjs ──
{


  test('[audit-empty] scoreQuality：0 文件 → 不评分（emptyResult），防空扫描满分', () => {
    const r = scoreQuality([], {}, { files: 0 });
    assert.equal(r.score, null, '0 文件时 score 应为 null（不给满分 100）');
    assert.equal(r.level, null, '0 文件时 level 应为 null');
    assert.equal(r.emptyResult, true, '应标记 emptyResult');
    assert.ok(r.emptyReason && r.emptyReason.includes('未扫描'), 'emptyReason 应说明原因');
  });

  test('[audit-empty] scoreQuality：有文件但 0 问题 → 正常满分（不是空结果）', () => {
    const r = scoreQuality([], {}, { files: 5 });
    assert.ok(!r.emptyResult, '有文件时不应标记 emptyResult');
    assert.equal(r.score, 100, '0 问题且文件数>0 是正常满分');
  });

  test('[audit-empty] scoreQuality：不传 files 上下文 → 兼容旧行为（不判空）', () => {
    const r = scoreQuality([], {});
    assert.equal(r.emptyResult, undefined, '无 context 时不应有 emptyResult（旧调用兼容）');
    assert.equal(r.score, 100, '旧行为：空 findings 给满分（调用方负责判断空结果）');
  });

  test('[audit-empty] findingsToYaml：层级聚合（summary → 级别 → 目录 → 文件 → 规则明细）', () => {
    const yaml = findingsToYaml([
      { file: 'lib/a.js', line: 1, rule: 'r1', severity: 'warning', message: 'm1' },
      { file: 'lib/a.js', line: 2, rule: 'r2', severity: 'warning', message: 'm2' },
      { file: 'b.js', line: 3, rule: 'r3', severity: 'blocker', message: 'm3' },
    ]);
    assert.ok(yaml.includes('blocker: 1'), 'summary 应统计 blocker=1');
    assert.ok(yaml.includes('warning: 2'), 'summary 应统计 warning=2');
    assert.ok(yaml.includes('lib/:'), '应按目录聚合（lib/）');
    assert.ok(yaml.includes('a.js:'), '目录下应按文件聚合（a.js）');
    assert.ok(yaml.includes('rule: r1'), '文件下应列规则明细');
    assert.ok(yaml.includes('b.js:'), '根级文件应归 ./');
  });

  test('[audit-empty] auditFull：空目录返回 files=0 + yaml 字段', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-empty-'));
    try {
      const r = await auditFull(dir, {});
      assert.equal(r.files, 0, '空目录 files 应为 0');
      assert.equal(r.summary.total, 0, '空目录无 findings');
      assert.ok(typeof r.yaml === 'string' && r.yaml.includes('summary:'), '应返回 yaml 字符串');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// ── 原 test-audit-ext.mjs ──
{

  // ---------- 审计扩展自动接入（重构：统一入口动态加载） ----------


  test('[audit-ext] ext-runner：DEFAULT_EXT_DIR 指向插件根 scripts/audit-ext', () => {
    assert.ok(DEFAULT_EXT_DIR.endsWith('scripts/audit-ext'), DEFAULT_EXT_DIR);
  });

  test('[audit-ext] ext-runner：动态加载契约脚本 + _ 前缀示例不加载', async () => {
    const exts = await loadAuditExt(DEFAULT_EXT_DIR);
    // 真实扩展（非 _ 前缀）被加载：variable-min-length（内置规则抽出试点）
    assert.ok(exts.some((e) => e.name === 'variable-min-length'), 'variable-min-length 扩展加载');
    // 演示契约的 _ 前缀脚本不参与实际审计
    assert.ok(!exts.some((e) => e.name === 'example-readme-present'), '_ 前缀示例不加载');
  });

  test('[audit-ext] ext-runner：契约执行——有 README 不报，缺 README 报 info', async () => {
    const dir = mkdtempTracked(join(tmpdir(), 'audit-ext-test-'));
    writeFileSync(join(dir, 'ok-ext.mjs'), `
      export const auditExt = {
        name: 't-check-readme',
        match: (repo) => Boolean(repo),
        run: async (repo) => {
          const { existsSync } = await import('node:fs');
          const { join } = await import('node:path');
          if (!existsSync(join(repo, 'README.md'))) {
            return [{ file: 'README.md', line: 1, rule: 'ext/readme-present', severity: 'info', message: '缺 README', dimensions: ['文档'] }];
          }
          return [];
        },
      };
    `, 'utf8');
    const repo = mkdtempTracked(join(tmpdir(), 'repo-'));
    const findings = await runAuditExt(repo, { dir });
    assert.equal(findings.length, 1, '缺 README 应报 1 条');
    assert.ok(findings[0].source.startsWith('ext:t-check-readme'), 'source 标记 ext:<name>');
    // 有 README 不报
    writeFileSync(join(repo, 'README.md'), '# r\n', 'utf8');
    const findings2 = await runAuditExt(repo, { dir });
    assert.equal(findings2.length, 0);
  });

  test('[audit-ext] ext-runner：match 返回 false 跳过该扩展', async () => {
    const dir = mkdtempTracked(join(tmpdir(), 'audit-ext-match-'));
    writeFileSync(join(dir, 'skip.mjs'), `
      export const auditExt = {
        name: 't-skip',
        match: (repo) => repo === 'ONLY_THIS',
        run: async () => [{ file: 'x', line: 1, rule: 'ext/skip', severity: 'warning', message: '不应出现' }],
      };
    `, 'utf8');
    const f = await runAuditExt('/elsewhere', { dir });
    assert.equal(f.length, 0, 'match false 应跳过');
    const f2 = await runAuditExt('ONLY_THIS', { dir });
    assert.equal(f2.length, 1, 'match true 应执行');
  });

  test('[audit-ext] ext-runner：单脚本失败降级跳过（不中断其他扩展）', async () => {
    const dir = mkdtempTracked(join(tmpdir(), 'audit-ext-fail-'));
    writeFileSync(join(dir, 'bad.mjs'), 'export const auditExt = { name: "t-bad", run: async () => { throw new Error("boom"); } };\n', 'utf8');
    writeFileSync(join(dir, 'good.mjs'), `
      export const auditExt = { name: 't-good', run: async () => [{ file: 'g', line: 1, rule: 'ext/good', severity: 'warning', message: 'ok' }] };
    `, 'utf8');
    const f = await runAuditExt('/repo', { dir });
    assert.equal(f.length, 1, '坏脚本降级跳过，好脚本仍出结果');
    assert.equal(f[0].source, 'ext:t-good');
  });

  // ---------- auditFull 自动并入扩展（端到端） ----------

  test('[audit-ext] auditFull：扩展 findings 自动并入（auditExtDir 注入）', async () => {
    const { auditFull } = await import('../../lib/audit/orchestrate.js');
    await import('../../lib/rule/compilers.js');
    // 临时扩展目录（缺 README 报 info）
    const extDir = mkdtempTracked(join(tmpdir(), 'audit-ext-dir-'));
    writeFileSync(join(extDir, 'need-readme.mjs'), `
      export const auditExt = { name: 't-need-readme', run: async (repo) => {
        const { existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        return existsSync(join(repo, 'README.md')) ? [] : [{ file: 'README.md', line: 1, rule: 'ext/need-readme', severity: 'info', message: '缺 README', dimensions: ['文档'] }];
      } };
    `, 'utf8');
    // 临时仓库（无 README → 扩展报 info）
    const repo = mkdtempTracked(join(tmpdir(), 'audit-ext-full-'));
    const r = await auditFull(repo, { auditExtDir: extDir });
    const ext = (r.findings || []).filter((f) => f.source && f.source.startsWith('ext:'));
    assert.ok(ext.length >= 1, 'auditFull 应并入扩展 findings（缺 README 报 info）');
    assert.ok(ext.some((f) => f.source === 'ext:t-need-readme'), '注入扩展接入');
    assert.equal(ext.filter((f) => f.source === 'ext:t-need-readme').length, 1, '同 repo 只跑一次');
  });
}

// ── 原 test-audit-scope.mjs ──
{
  /**
   * 审计「作用域」与「凭据占位符」回归测试。
   *
   * 覆盖三类已修复的真实误报缺陷：
   *   ① 规则作用域字段（exts / astConfirmKind）声明后被静默忽略
   *   ② 前缀型密钥串（ghp_/sk-/AKIA）把文档与演示数据里的占位符报成真泄漏
   *   ③ HTML 规则包跑在非 HTML 文件上（.mjs 里生成网页的模板字符串被当真实网页）
   *
   * 这些缺陷的共同特征：只在实际跑审计时才暴露，且报出的都是 error/blocker 级，
   *   会把提交门禁卡死——故用确定性断言锁住，不依赖仓库当前状态。
   */


  /* ───────────── ① 凭据占位符判据 ───────────── */

  test('[audit-scope] 凭据占位符：空值/掩码/占位文案/演示数据不算真凭据', () => {
    const placeholders = [
      '', '   ', 'xxxxx', '****', '<your-token>',
      'your-token-here', 'CHANGE_ME', 'TODO', 'placeholder',
      'example', 'exampleToken123', 'demo-value', 'sampleKey', 'testtoken',
      'dummy', 'fakeToken', 'none', 'null', 'undefined',
    ];
    for (const v of placeholders) {
      assert.equal(isMeaningfulCredentialValue(v), false, `应判为占位符：${JSON.stringify(v)}`);
    }
  });

  test('[audit-scope] 凭据占位符：带 scheme 前缀的演示值也判为占位符（剥前缀后判定）', () => {
    // 这是原缺陷：值以 ghp_ 开头而非 example 开头，匹配不到 `example.*` 就被报成真泄漏
    for (const v of ['ghp_exampleToken12345', 'ghp_ExampleToken12345', 'ghp_testtokenplaceholder123']) {
      assert.equal(isMeaningfulCredentialValue(v), false, `应判为占位符：${v}`);
    }
  });

  test('[audit-scope] 凭据占位符：真凭据形状仍判为真（剥前缀不放过真密钥）', () => {
    const reals = [
      'ghp_9fA2kLm3QpR7sT1uV5wX8yZ0aB4cD6eF8gH2',
      'sk-proj-a1B2c3D4e5F6g7H8i9J0k1L2',
      'AKIA3XQZ7PLMN2KJ8VWY',
      // 正对照：scheme 段里带占位词但整体是真检出形状 —— 不做分段判定，必须照报。
      //   （仓库测试夹具就用这个形状证明「非豁免目录的 blocker 会拦截提交」）
      'sk-test-abcdef1234567890abcdef',
    ];
    for (const v of reals) {
      assert.equal(isMeaningfulCredentialValue(v), true, `应判为真凭据：${v}`);
    }
  });

  test('[audit-scope] 占位符精筛：只豁免占位符所在行，真凭据行照报', () => {
    const text = [
      "const doc = '测试用占位符 ghp_testtokenplaceholder123 而已';", // 第 1 行：占位符
      "const real = 'ghp_9fA2kLm3QpR7sT1uV5wX8yZ0aB4cD6eF8gH2';",   // 第 2 行：真形状
      'const none = 1;',                                          // 第 3 行：无命中
    ].join('\n');
    const exempt = checkPlaceholderCredentialAst(text);
    assert.ok(exempt.has(1), '占位符行应进豁免集');
    assert.ok(!exempt.has(2), '真凭据行不应被豁免');
    assert.ok(!exempt.has(3), '无命中行不应进豁免集');
  });

  /* ───────────── ② 规则作用域字段透传 ───────────── */

  test('[audit-scope] 作用域：compileAllRules 统一透传 exts（含原本漏传的 blacklist/semantic 等 kind）', () => {
    const compiled = compileAllRules(loadRuleFiles().merged.rules, { errors: [] });
    const withExts = compiled.filter((r) => Array.isArray(r.exts) && r.exts.length);
    assert.ok(withExts.length > 0, '应有规则声明并携带 exts');
    // 归一化：小写、无前导点
    for (const r of withExts) {
      for (const e of r.exts) {
        assert.equal(e, String(e).toLowerCase().replace(/^\./, ''), `exts 应归一化：${e}`);
      }
    }
    // blacklist kind 曾漏传：comment 包的该规则声明了 exts 就必须带上
    const bl = compiled.find((r) => r.id === 'documentation/comment-suspicious-detection');
    assert.ok(bl, '应加载到 comment 包的 blacklist 规则');
    assert.ok(Array.isArray(bl.exts) && bl.exts.length > 0, 'blacklist kind 也应携带 exts');
    assert.ok(!bl.exts.includes('json'), '该规则不应作用于 json（配置文件非注释载体）');
  });

  test('[audit-scope] 作用域：compileAllRules 统一透传 astConfirmKind（含原本漏传的 [FUNC] kind）', () => {
    const compiled = compileAllRules(loadRuleFiles().merged.rules, { errors: [] });
    const pat = compiled.find((r) => r.id === 'secret-github-pat');
    assert.ok(pat, '应加载到 secret-github-pat 规则');
    assert.equal(pat.kind, '[FUNC]', '该规则编译为 [FUNC] kind（原缺陷点）');
    assert.equal(pat.astConfirmKind, 'placeholder-credential', '[FUNC] kind 也应携带 astConfirmKind');
  });

  test('[audit-scope] 作用域：filterRulesByExt 按文件扩展名裁剪（HTML 规则不落到 .mjs）', () => {
    const grouped = {
      regex: [
        { id: 'html-only', exts: ['html', 'htm'] },
        { id: 'js-only', exts: ['js', 'mjs'] },
        { id: 'unscoped' },
      ],
    };
    const forMjs = filterRulesByExt(grouped, 'scripts/preview-gen.mjs').regex.map((r) => r.id);
    assert.ok(!forMjs.includes('html-only'), '.mjs 不应命中 HTML 规则');
    assert.ok(forMjs.includes('js-only'), '.mjs 应命中 JS 规则');
    assert.ok(forMjs.includes('unscoped'), '未声明 exts 的规则不受限');
    const forHtml = filterRulesByExt(grouped, 'index.html').regex.map((r) => r.id);
    assert.ok(forHtml.includes('html-only'), '.html 应命中 HTML 规则');
    assert.ok(!forHtml.includes('js-only'), '.html 不应命中 JS 规则');
  });
}

// ── 原 test-audit-slot-order.mjs ──
{
  /**
   * 回归测试：`auditRuleOrder`（规则槽位**加载顺序**）不得被当成槽位白名单 ✗。
   *
   * 历史缺陷（实测）：lib/commit-push.js 把 cfg.auditRuleOrder 当 slots 传给 loadRuleFiles，
   *   而后者把 slots 当「只加载列出的包」⇒ 清单外的包（python/cpp/go/java/php/rust/swift/template）
   *   被**静默丢弃** ✗ —— 一个 105 个 .py 的项目上 7 条 python/* 规则零命中、连 python 槽位都没有；
   *   把该字段置空后同一项目 60 条 → 197 条、python/* 命中 0 → 5 ✓。
   *
   * 测试策略（为什么不用临时仓库夹具 ✗）：
   *   实测临时仓库（已 init/add/commit + full 范围）**任何规则都不命中**（files 未定义、总发现 0）——
   *   审计不采集那种裸仓库的文件，用它当夹具会得出「修复无效」的**假红** ✗。
   *   故改为：① 源码级断言（4 个调用点不再把顺序当白名单）+ ② 真实项目守卫式断言（克隆缺失则跳过）。
   */


  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');

  test('[audit-slot-order] 源码级：commit-push.js 的 slotOrder 不得再取 cfg.auditRuleOrder', () => {
    const src = read('lib/commit-push.js');
    assert.match(src, /const slotOrder = Array\.isArray\(slots\) && slots\.length \? slots : undefined;/,
      'slotOrder 只能取显式传入的 slots（配置里的顺序不是白名单）');
    assert.ok(!/: Array\.isArray\(cfg\.auditRuleOrder\)/.test(src),
      '不得把 cfg.auditRuleOrder 当作 slots 的来源 ✗');
  });

  test('[audit-slot-order] 源码级：工具与 API 两条路也不再把 auditRuleOrder 当 slots', () => {
    for (const f of ['lib/app/tool-call.js', 'lib/app/audit-api.js']) {
      const src = read(f);
      assert.ok(!/slots:\s*cfg\.auditRuleOrder/.test(src), `${f} 仍在把 auditRuleOrder 当白名单 ✗`);
      assert.match(src, /slots: undefined,/, `${f} 应显式传 slots: undefined（全加载）`);
    }
  });

  test('[audit-slot-order] 源码级：禁用机制仍走 auditDisabledSlots（不能一起删掉）', () => {
    assert.match(read('lib/commit-push.js'), /disabledSlots: Array\.isArray\(cfg\.auditDisabledSlots\)/,
      'auditDisabledSlots 才是禁用机制，必须保留');
  });

  // ── 规则加载回归：python 槽位必须被加载（auditRuleOrder 是「顺序」不是白名单）──
  //   为什么不用样本文件命中来验证：python 规则的数值/命名类判定走 token 级精筛，
  //   简单样本不一定触发（实测 audit-samples/py-bad.py 上只报占位规则 no-path-traversal）；
  //   「槽位是否被加载」才是该缺陷的直接判据，且任何环境都能跑（不依赖外部项目）。
  test('[audit-slot-order] 规则加载：python 槽位必须被加载（auditRuleOrder 置空后全加载）', () => {
    const loaded = loadRuleFiles(null, {});
    const py = loaded.merged.rules.filter((r) => String(r.id).startsWith('python/'));
    assert.ok(py.length > 0,
      `python/* 规则必须加载（该字段为「顺序」不是白名单 ✗）——实得 ${py.length} 条`);
  });
}
