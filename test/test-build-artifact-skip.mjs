import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 构建/混淆产物跳过专项测试（2026-10-05，Pawchive 混淆产物样本固化） ----------
// 背景：1.12.1 内置 hash 产物豁免失效（external 化后 ext 通道丢豁免）→ Pawchive 混淆产物
//   短名密爆 5896 条误报。抽取 Pawchive 真实 hash 产物样本（TimeZoneComboBox-CRnoCikG.js 407B）
//   作 fixture，固化「跳过混淆」判定与执行路径（内置 auditFile + ext 通道都不报混淆产物）。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'test/fixtures/TimeZoneComboBox-CRnoCikG.js');
const SAMPLE_TEXT = readFileSync(FIXTURE, 'utf8');

test('isBuildArtifactFile：hash 文件名产物判 true（Pawchive 样本）', async () => {
  const { isBuildArtifactFile } = await import('../lib/audit/audit-file.js');
  assert.equal(isBuildArtifactFile('webui-static/assets/TimeZoneComboBox-CRnoCikG.js', SAMPLE_TEXT), true, 'hash 文件名（大小写混合段）判为产物');
  assert.equal(isBuildArtifactFile('webui-static/assets/rolldown-runtime-CbXtAM7H.js', 'import{a as b}from"./x.js";'), true, '多行小文件 hash 名仍判产物');
});

test('isBuildArtifactFile：手写文件判 false（不误伤）', async () => {
  const { isBuildArtifactFile } = await import('../lib/audit/audit-file.js');
  assert.equal(isBuildArtifactFile('lib/client.js', 'export function add(a, b) { return a + b; }\n'), false, '普通源码不判产物');
  assert.equal(isBuildArtifactFile('scripts/KToolBox-env-compat.js', 'const x = 1;\n'), false, '纯小写连字符词（env-compat）不是产物 hash');
  assert.equal(isBuildArtifactFile('scripts/fast-skip-benchmark.js', 'const y = 2;\n'), false, 'benchmark 手写文件不误伤');
  assert.equal(isBuildArtifactFile('lib/helper.utils.js', 'const c = 3;\n'), false, '4 字符点分段（utils）不是产物 hash');
  assert.equal(isBuildArtifactFile('lib/my.module.helpers.js', 'const d = 4;\n'), false, 'helpers 纯小写段不是产物 hash');
});

test('isBuildArtifactFile：webpack 点分隔 hash 文件名判 true（2026-10-06 漏判修复）', async () => {
  const { isBuildArtifactFile } = await import('../lib/audit/audit-file.js');
  // pix-ezviewer 实测漏判源：webpack/CRA 标准产物是 *.<HASH>.js 点分隔（连字符正则匹配不到）
  assert.equal(isBuildArtifactFile('docs/static/js/runtime-main.d37830b0.js', 'const x=1;\n'), true, '点分隔 hash（runtime-main.d37830b0.js）判产物');
  assert.equal(isBuildArtifactFile('docs/static/js/main.83b810ac.chunk.js', 'const y=2;\n'), true, 'chunk 形态点分隔 hash 判产物');
  assert.equal(isBuildArtifactFile('docs/static/js/2.5d35b740.chunk.js', 'const z=3;\n'), true, '数字前缀 chunk 判产物');
});

test('isBuildArtifactFile：html 引用 hash 静态资源判 true（2026-10-06 新增）', async () => {
  const { isBuildArtifactFile } = await import('../lib/audit/audit-file.js');
  const cra = '<script defer="defer" src="/static/js/main.83b810ac.chunk.js"></script>\n<script src="/static/js/runtime-main.d37830b0.js"></script>';
  assert.equal(isBuildArtifactFile('docs/index.html', cra), true, 'CRA/docusaurus index.html 引用 hash js 判产物');
  assert.equal(isBuildArtifactFile('docs/index.html', '<script src="/static/js/main.js"></script>'), false, '引用普通 js 非产物');
  assert.equal(isBuildArtifactFile('index.html', ''), false, '空 html 非产物');
});

test('isBuildArtifactFile：单行混淆（>5000 字符）判 true', async () => {
  const { isBuildArtifactFile } = await import('../lib/audit/audit-file.js');
  const long = 'export const a=1;'.repeat(1000) + '\n'; // ~20000 字符单行
  assert.equal(isBuildArtifactFile('dist/bundle.js', long), true, '单行混淆产物判 true');
});

test('auditFile：混淆产物样本不产出行级 findings（variable-min-length 等跳过）', async () => {
  const { auditFile } = await import('../lib/audit/audit-file.js');
  const { loadRuleFiles } = await import('../lib/rule/loader.js');
  const { compileAllRules } = await import('../lib/rule/registry.js');
  await import('../lib/rule/compilers.js');
  const loaded = loadRuleFiles();
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const grouped = {};
  for (const r of compiled) (grouped[r.kind] ||= []).push(r);
  const findings = auditFile({ file: 'webui-static/assets/TimeZoneComboBox-CRnoCikG.js', relPath: 'webui-static/assets/TimeZoneComboBox-CRnoCikG.js', text: SAMPLE_TEXT, grouped }, { level: 'full', repoPath: ROOT });
  // 产物只保留凭据/路径安全（此样本无）——行级规则（variable-min-length/magic/复杂度）必须 0
  const lineRules = findings.filter((x) => /variable-min-length|magic-number|complexity|function-length|nesting|repeated/.test(x.rule || ''));
  assert.equal(lineRules.length, 0, `混淆产物不应有行级 findings：${findings.slice(0, 3).map((x) => x.rule).join(', ')}`);
});

test('audit-ext 通道：variable-min-length ext 脚本跳过混淆产物', async () => {
  const { runAuditExt } = await import('../lib/audit/ext-runner.js');
  // 用临时扩展目录：只放 variable-min-length（真实 ext 脚本）——指向包含 fixture 的仓库
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const extDir = mkdtempSync(join(tmpdir(), 'audit-ext-artifact-'));
  const { copyFileSync } = await import('node:fs');
  copyFileSync(join(ROOT, 'scripts/audit-ext/variable-min-length.mjs'), join(extDir, 'variable-min-length.mjs'));
  // 仓库 = 临时目录，里面放一个 hash 产物副本（真实文件名——触发 hash 判定）
  const repo = mkdtempSync(join(tmpdir(), 'repo-artifact-'));
  copyFileSync(FIXTURE, join(repo, 'TimeZoneComboBox-CRnoCikG.js'));
  const findings = await runAuditExt(repo, { dir: extDir });
  const onArtifact = findings.filter((x) => /-CRnoCikG\.js$/.test(x.file || ''));
  assert.equal(onArtifact.length, 0, 'ext 通道不得对混淆产物报 variable-min-length');
});